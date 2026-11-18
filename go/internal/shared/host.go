package shared

// The host: finds the shops, routes to them, answers the process's own three paths, and moves a shop through its states (see the package comment in shared.go for the design).
//
//	up        served in this process (a guard in front of its handler)
//	moving    quarantined, being closed here; answers 503 "starting again" for a moment
//	stranded  quarantined, but the in-process copy has not let go of the store (a stuck step): "back soon", moved to a child the moment the release is proven
//	child     served by a child process of its own on a loopback port
//	childDown the child exited; it is started again after a short wait; 503 "starting again"
//	paused    kept stopping; "back soon" until the pause ends or the shop's files change
//
// Locking: `mu` guards the maps and the fields of the slots and is never held across a call into a shop or a wait. `opMu` serialises the slow things (a scan, a move to a child, a
// pause, a resume), so two of them never overlap, as the TypeScript scan's queue did.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type state int

const (
	stUp state = iota
	stMoving
	stStranded
	stChild
	stChildDown
	stPaused
)

const (
	maxShops          = 500
	failuresToRestart = 3
	maxBackoff        = 5 * time.Minute
	maxChildDelay     = 30 * time.Second
	notHereBody       = `{"error":"There is nothing here."}`
)

// Options start a host.
type Options struct {
	Source Source
	Start  Starter
	// Child starts a shop's own process for a quarantined shop. Nil: a shop that earns quarantine is paused instead (a host that cannot spawn has nothing safer to do).
	Child Spawner
	// Addr is the front's listen address ("0.0.0.0:8780" in the container); "127.0.0.1:0" picks a free port.
	Addr string
	// ScanEvery: how often to look for new, changed and removed shops (default 5 s). Folders are looked at, not watched: file watching on a bind mount is unreliable.
	ScanEvery time.Duration
	// StateDir: where the strike memory is kept (empty: in memory only).
	StateDir string
	Limits   Limits
	Log      func(string)
	// Now is the clock in Unix ms (default the real one).
	Now func() int64
}

// ScanResult is what one look did.
type ScanResult struct {
	Started, Restarted, LetGo []string
	Failed                    []Failed
}

// Failed is a shop that did not start, and why.
type Failed struct{ Shop, Why string }

// PausedDetail is what the deployer copies into a shop's status file: why, and when the pause ends (epoch ms).
type PausedDetail struct {
	Shop  string `json:"shop"`
	Why   string `json:"why"`
	Until int64  `json:"until"`
}

// Status is the host's account of its containment.
type Status struct {
	Paused       []string
	Quarantined  []string
	PausedDetail []PausedDetail
	// Abandoned is how many request goroutines were given up on and have not finished (Go cannot stop them).
	Abandoned int
}

type slot struct {
	name, fp string
	st       state
	shop     Shop
	g        *guard
	child    Child
	proxy    *httputil.ReverseProxy
	paths    Paths
	stuckAt  int64         // when the watchdog last charged this runner's stuck step
	released chan struct{} // closed when the in-process copy has let go of the store (set once the release began)
	timer    *time.Timer   // the end of a pause
	why      string        // why it is stranded
	stopping bool          // being let go: a child's exit is no failure
	delay    time.Duration // the wait before the next try of a child that keeps exiting
	upAt     time.Time     // when its child started
}

// Host is the shared process.
type Host struct {
	o   Options
	lim Limits
	log func(string)
	now func() int64

	mu      sync.RWMutex
	slots   map[string]*slot
	closing map[string]chan struct{} // a name whose store is not yet proven released: still named by /shared/shops, never started again meanwhile
	mem     map[string]*memory
	failed  map[string]string
	bad     map[string]int
	backoff map[string]backoffState

	opMu sync.Mutex

	ln      net.Listener
	front   *http.Server
	stop    chan struct{}
	stopped sync.Once
	wg      sync.WaitGroup
	URL     string
	Port    int
}

type backoffState struct {
	n         int
	notBefore int64
}

// New starts the front, looks at the folders once, and keeps looking.
func New(o Options) (*Host, error) {
	h := &Host{o: o, lim: o.Limits.filled(), log: o.Log, now: o.Now, slots: map[string]*slot{}, closing: map[string]chan struct{}{}, failed: map[string]string{}, bad: map[string]int{}, backoff: map[string]backoffState{}, stop: make(chan struct{})}
	if h.log == nil {
		h.log = func(string) {}
	}
	if h.now == nil {
		h.now = func() int64 { return time.Now().UnixMilli() }
	}
	if o.Start == nil || o.Source == nil {
		return nil, errors.New("a host needs a Source and a Starter")
	}
	h.mem = loadMemory(o.StateDir)
	ln, err := net.Listen("tcp", o.Addr)
	if err != nil {
		return nil, err
	}
	h.ln = ln
	h.Port = ln.Addr().(*net.TCPAddr).Port
	host := "127.0.0.1"
	if ta, ok := ln.Addr().(*net.TCPAddr); ok && !ta.IP.IsUnspecified() {
		host = ta.IP.String()
	}
	h.URL = "http://" + net.JoinHostPort(host, fmt.Sprint(h.Port))
	// the front's limits are the TypeScript router's (requestTimeout 60 s, headersTimeout 10 s, keepAlive 5 s)
	h.front = &http.Server{Handler: http.HandlerFunc(h.serve), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 60 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 64 << 10}
	go func() { _ = h.front.Serve(ln) }()
	h.Scan()
	every := o.ScanEvery
	if every <= 0 {
		every = 5 * time.Second
	}
	h.loop(every, func() { h.Scan() })
	h.loop(h.lim.WatchEvery, h.watch)
	return h, nil
}

func (h *Host) loop(every time.Duration, f func()) {
	h.wg.Add(1)
	go func() {
		defer h.wg.Done()
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-h.stop:
				return
			case <-t.C:
				func() {
					defer func() { // the host's own loops never die of a panic in a shop's Ready or StepSince
						if p := recover(); p != nil {
							h.log(fmt.Sprintf("the host's own loop recovered from: %v", p))
						}
					}()
					f()
				}()
			}
		}
	}()
}

// ---- the front ---------------------------------------------------------------------------------------------------------------------------------------------

var shopRoute = regexpMust(`^/shop/([a-z0-9][a-z0-9-]{0,39})(/.*)?$`)

func writeJSON(w http.ResponseWriter, status int, v any, extra ...string) {
	b, _ := json.Marshal(v)
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	for i := 0; i+1 < len(extra); i += 2 {
		w.Header().Set(extra[i], extra[i+1])
	}
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

func names(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for n := range set {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func (h *Host) serve(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if p := recover(); p != nil {
			h.log(fmt.Sprintf("the router recovered from: %v", p))
			writeJSON(w, 500, map[string]any{"error": "The runtime could not handle that. Send it again."})
		}
	}()
	switch {
	case r.URL.Path == "/healthz" || r.URL.Path == "/readyz":
		st := h.Status()
		h.mu.RLock()
		n := len(h.slots)
		h.mu.RUnlock()
		writeJSON(w, 200, struct {
			OK          bool     `json:"ok"`
			Shops       int      `json:"shops"`
			Paused      []string `json:"paused"`
			Quarantined []string `json:"quarantined"`
		}{true, n, st.Paused, st.Quarantined})
		return
	case r.URL.Path == "/shared/shops" && r.Method == "GET":
		st := h.Status()
		writeJSON(w, 200, struct {
			Shops        []string       `json:"shops"`
			Paused       []string       `json:"paused"`
			PausedDetail []PausedDetail `json:"pausedDetail"`
		}{h.Held(), st.Paused, st.PausedDetail})
		return
	}
	if m := shopRoute.FindStringSubmatch(r.URL.Path); m != nil {
		rest := m[2]
		if rest == "" {
			rest = "/"
		}
		h.forward(w, r, m[1], rest)
		return
	}
	writeJSON(w, 404, json.RawMessage(notHereBody))
}

// forward hands the request to the shop's own handler (or its child's port) byte for byte, with the shop's own credential still on it: the check is the shop's.
func (h *Host) forward(w http.ResponseWriter, r *http.Request, name, rest string) {
	h.mu.RLock()
	s := h.slots[name]
	var st state
	var g *guard
	var proxy *httputil.ReverseProxy
	var p Paths
	if s != nil {
		st, g, proxy, p = s.st, s.g, s.proxy, s.paths
	}
	h.mu.RUnlock()
	switch {
	case s == nil:
		writeJSON(w, 404, json.RawMessage(notHereBody))
	case st == stPaused || st == stStranded:
		writeBackSoon(w, r, p)
	case st == stMoving || st == stChildDown:
		busy(w, 503, "This shop is starting again. Please try in a moment.", "2")
	case st == stChild:
		proxy.ServeHTTP(w, r)
	default:
		r2 := r.Clone(r.Context())
		r2.URL.Path, r2.URL.RawPath = rest, ""
		r2.RequestURI = rest
		if r.URL.RawQuery != "" {
			r2.RequestURI += "?" + r.URL.RawQuery
		}
		g.ServeHTTP(w, r2)
	}
}

func (h *Host) proxyTo(port int) *httputil.ReverseProxy {
	target := &url.URL{Scheme: "http", Host: net.JoinHostPort("127.0.0.1", fmt.Sprint(port))}
	rp := httputil.NewSingleHostReverseProxy(target)
	d := rp.Director
	rp.Director = func(r *http.Request) {
		m := shopRoute.FindStringSubmatch(r.URL.Path)
		rest := "/"
		if m != nil && m[2] != "" {
			rest = m[2]
		}
		d(r)
		r.URL.Path, r.URL.RawPath, r.Host = rest, "", target.Host
	}
	rp.Transport = &http.Transport{ResponseHeaderTimeout: h.lim.RequestTimeout, MaxIdleConnsPerHost: 4, IdleConnTimeout: 5 * time.Second}
	// a child that cannot be reached is almost always one that just exited and is being started again
	rp.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		busy(w, 503, "This shop is busy. Please try in a moment.", "2")
	}
	return rp
}

// ---- who is named and what is paused ---------------------------------------------------------------------------------------------------------------------

// Held is every shop the host names: held, or let go with the store not yet proven closed. Sorted.
func (h *Host) Held() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	set := map[string]struct{}{}
	for n := range h.slots {
		set[n] = struct{}{}
	}
	for n := range h.closing {
		set[n] = struct{}{}
	}
	return names(set)
}

// Status lists the paused (stranded shops are listed with their reason), the quarantined and the abandoned goroutines.
func (h *Host) Status() Status {
	h.mu.RLock()
	defer h.mu.RUnlock()
	st := Status{Paused: []string{}, Quarantined: []string{}, PausedDetail: []PausedDetail{}}
	for n, s := range h.slots {
		if m := h.mem[n]; m != nil && m.Quarantined {
			st.Quarantined = append(st.Quarantined, n)
		}
		switch s.st {
		case stPaused:
			st.Paused = append(st.Paused, n)
			st.PausedDetail = append(st.PausedDetail, PausedDetail{n, h.mem[n].PausedWhy, h.mem[n].PausedUntil})
		case stStranded:
			st.Paused = append(st.Paused, n)
			st.PausedDetail = append(st.PausedDetail, PausedDetail{n, s.why, h.now() + h.lim.Pause.Milliseconds()})
		}
		if s.g != nil {
			st.Abandoned += int(s.g.abandon.Load())
		}
	}
	sort.Strings(st.Paused)
	sort.Strings(st.Quarantined)
	sort.Slice(st.PausedDetail, func(i, j int) bool { return st.PausedDetail[i].Shop < st.PausedDetail[j].Shop })
	return st
}

// ---- strikes -------------------------------------------------------------------------------------------------------------------------------------------------

func (h *Host) memOf(name string) *memory {
	m := h.mem[name]
	if m == nil {
		m = &memory{}
		h.mem[name] = m
	}
	return m
}

func (h *Host) save() {
	if err := saveMemory(h.o.StateDir, h.mem); err != nil {
		h.log("the strike memory could not be written: " + err.Error())
	}
}

func (h *Host) op(f func()) {
	h.opMu.Lock()
	defer h.opMu.Unlock()
	f()
}

// charge counts one strike (in this process) or one failure (in its own process) against a shop, and acts on the numbers. Safe from any goroutine.
func (h *Host) charge(s *slot, why string) {
	now := h.now()
	h.mu.Lock()
	if h.slots[s.name] != s {
		h.mu.Unlock()
		return
	}
	m := h.memOf(s.name)
	var move, pause bool
	switch s.st {
	case stUp:
		m.Strikes = recent(append(m.Strikes, now), now, h.lim.StrikeWindow.Milliseconds())
		h.log(fmt.Sprintf("%s: strike %d of %d: %s", s.name, len(m.Strikes), h.lim.StrikesToQuarantine, why))
		if len(m.Strikes) >= h.lim.StrikesToQuarantine {
			m.Quarantined, s.st, move = true, stMoving, true
			h.log(fmt.Sprintf("%s: it struck %d times within %s; it now leaves this process.", s.name, len(m.Strikes), h.lim.StrikeWindow))
		}
	case stChild, stChildDown:
		m.Failures = recent(append(m.Failures, now), now, h.lim.QuarantineWindow.Milliseconds())
		h.log(fmt.Sprintf("%s: failure %d of %d in its own process: %s", s.name, len(m.Failures), h.lim.FailuresToPause, why))
		pause = len(m.Failures) >= h.lim.FailuresToPause
	}
	h.save()
	h.mu.Unlock()
	switch {
	case move:
		go h.op(func() { h.move(s) })
	case pause:
		go h.op(func() {
			h.pause(s, fmt.Sprintf("it failed %d times in a process of its own within %s (last: %s)", h.lim.FailuresToPause, h.lim.QuarantineWindow, why))
		})
	}
}

// ---- release: the proof that a store is let go -----------------------------------------------------------------------------------------------------------

// release begins closing an in-process shop (once) and returns a channel that is closed when it has let go: Close returned AND no request goroutine of the shop runs. A Close that
// panics counts as returned (what it held is gone with the panic's unwinding no better than a return; it is logged).
func (h *Host) release(s *slot) <-chan struct{} {
	h.mu.Lock()
	if s.released == nil {
		rel := make(chan struct{})
		s.released = rel
		shop, g := s.shop, s.g
		go func() {
			func() {
				defer func() {
					if p := recover(); p != nil {
						h.log(fmt.Sprintf("%s: closing it panicked: %v", s.name, p))
					}
				}()
				shop.Close()
			}()
			for !g.idle() {
				time.Sleep(2 * time.Millisecond)
			}
			close(rel)
		}()
	}
	rel := s.released
	h.mu.Unlock()
	return rel
}

func waitFor(ch <-chan struct{}, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ch:
		return true
	case <-t.C:
		return false
	}
}

// hold keeps a name listed until its release is proven.
func (h *Host) hold(name string, rel <-chan struct{}) {
	ch := make(chan struct{})
	h.mu.Lock()
	h.closing[name] = ch
	h.mu.Unlock()
	go func() {
		<-rel
		h.mu.Lock()
		if h.closing[name] == ch {
			delete(h.closing, name)
		}
		h.mu.Unlock()
		close(ch)
	}()
}

// letGo stops serving a shop and proves its store is let go before the name leaves /shared/shops. (opMu held.)
func (h *Host) letGo(name, why string) {
	h.mu.Lock()
	s := h.slots[name]
	if s == nil {
		h.mu.Unlock()
		return
	}
	delete(h.slots, name) // first: a request that arrives now gets "nothing here", never a half-closed shop
	s.stopping = true
	delete(h.bad, name)
	if s.timer != nil {
		s.timer.Stop()
	}
	child, shop := s.child, s.shop
	h.mu.Unlock()
	switch {
	case child != nil:
		h.mu.Lock()
		h.closing[name] = make(chan struct{}) // named until the process is gone
		ch := h.closing[name]
		h.mu.Unlock()
		child.Stop(h.lim.StopWait)
		h.mu.Lock()
		if h.closing[name] == ch {
			delete(h.closing, name)
		}
		h.mu.Unlock()
		close(ch)
	case shop != nil:
		rel := h.release(s)
		h.hold(name, rel)
		if waitFor(rel, h.lim.StopWait) {
			h.mu.Lock() // proven: the name may leave the list now, not a moment later when hold's goroutine gets to it
			delete(h.closing, name)
			h.mu.Unlock()
		} else {
			h.log(fmt.Sprintf("%s: it has not let go of its store after %s; it stays named, and is not started again, until it has.", name, h.lim.StopWait))
		}
	}
	h.log(fmt.Sprintf("%s: let go (%s).", name, why))
}

// ---- moving a quarantined shop to a process of its own -----------------------------------------------------------------------------------------------------

// move closes the in-process copy and, only when it has let go, starts the child. (opMu held.)
func (h *Host) move(s *slot) {
	h.mu.RLock()
	ok := h.slots[s.name] == s && s.st == stMoving
	h.mu.RUnlock()
	if !ok {
		return
	}
	rel := h.release(s)
	if !waitFor(rel, h.lim.StopWait) {
		h.mu.Lock()
		s.st = stStranded
		s.why = fmt.Sprintf("it is stuck: its store is still held by a step that has not finished, so it cannot move to a process of its own yet (%d request(s) given up on); it moves when that ends, or when this process is restarted", s.g.abandon.Load())
		h.mu.Unlock()
		h.log(fmt.Sprintf("%s: STRANDED: %s.", s.name, s.why))
		go func() {
			<-rel
			h.op(func() {
				h.mu.RLock()
				ok := h.slots[s.name] == s && s.st == stStranded
				h.mu.RUnlock()
				if ok {
					h.log(fmt.Sprintf("%s: its abandoned work has ended; it moves to a process of its own.", s.name))
					h.startChild(s)
				}
			})
		}()
		return
	}
	h.startChild(s)
}

// startChild serves the shop from a process of its own. The caller has proven the in-process copy let go (or never made one). (opMu held.)
func (h *Host) startChild(s *slot) {
	h.mu.Lock()
	if h.slots[s.name] != s || s.stopping {
		h.mu.Unlock()
		return
	}
	s.shop, s.g, s.child = nil, nil, nil
	if h.o.Child == nil {
		h.mu.Unlock()
		h.pause(s, "it kept failing and this process cannot start a process of its own for it")
		return
	}
	h.mu.Unlock()
	c, err := h.o.Child.Spawn(s.name)
	if err != nil {
		h.log(fmt.Sprintf("%s: its own process did not start (%v).", s.name, err))
		h.mu.Lock()
		s.st = stChildDown
		h.mu.Unlock()
		h.charge(s, "its own process did not start")
		h.retryChild(s)
		return
	}
	h.mu.Lock()
	if h.slots[s.name] != s || s.stopping {
		h.mu.Unlock()
		c.Stop(h.lim.StopWait)
		return
	}
	s.child, s.proxy, s.st, s.paths, s.upAt = c, h.proxyTo(c.Port()), stChild, h.o.Source.Paths(s.name), time.Now()
	h.mu.Unlock()
	h.log(fmt.Sprintf("%s: running in a process of its own on port %d.", s.name, c.Port()))
	go h.watchChild(s, c)
}

// watchChild: the process exiting is one failure; it is started again after a wait that doubles while it keeps failing.
func (h *Host) watchChild(s *slot, c Child) {
	<-c.Done()
	h.mu.Lock()
	if h.slots[s.name] != s || s.child != c || s.stopping {
		h.mu.Unlock()
		return
	}
	s.st, s.child = stChildDown, nil
	if time.Since(s.upAt) > time.Minute {
		s.delay = 0 // it lived a while: the wait starts over
	}
	h.mu.Unlock()
	h.charge(s, "its own process exited")
	h.retryChild(s)
}

func (h *Host) retryChild(s *slot) {
	h.mu.Lock()
	if h.slots[s.name] != s || s.st != stChildDown {
		h.mu.Unlock()
		return
	}
	if s.delay == 0 {
		s.delay = h.lim.ChildDelay
	} else if s.delay *= 2; s.delay > maxChildDelay {
		s.delay = maxChildDelay
	}
	d := s.delay
	h.mu.Unlock()
	time.AfterFunc(d, func() {
		h.op(func() {
			h.mu.RLock()
			ok := h.slots[s.name] == s && s.st == stChildDown && !s.stopping
			h.mu.RUnlock()
			if ok {
				h.startChild(s)
			}
		})
	})
}

// pause: "back soon" for the length of the pause, then probation. (opMu held.)
func (h *Host) pause(s *slot, why string) {
	h.mu.Lock()
	if h.slots[s.name] != s {
		h.mu.Unlock()
		return
	}
	m := h.memOf(s.name)
	m.PausedUntil, m.PausedWhy, m.Failures = h.now()+h.lim.Pause.Milliseconds(), why, nil
	c := s.child
	s.st, s.child, s.shop, s.g = stPaused, nil, nil, nil
	s.timer = time.AfterFunc(h.lim.Pause, func() { h.op(func() { h.resume(s) }) })
	h.save()
	h.mu.Unlock()
	if c != nil {
		c.Stop(h.lim.StopWait) // the exit of a child is no failure once it is paused (watchChild sees s.child != c)
	}
	h.log(fmt.Sprintf("%s: PAUSED: %s. Its pages say \"back soon\"; it is tried again in %s or when its files change. The Operator should look at it.", s.name, why, h.lim.Pause))
}

// resume: on probation, in a process of its own with two failures already counted, so one more pauses it again at once. (opMu held.)
func (h *Host) resume(s *slot) {
	h.mu.Lock()
	if h.slots[s.name] != s || s.st != stPaused {
		h.mu.Unlock()
		return
	}
	now := h.now()
	m := h.memOf(s.name)
	m.PausedUntil, m.Failures, m.Quarantined = 0, []int64{now, now}, true
	s.st = stChildDown
	h.save()
	h.mu.Unlock()
	h.log(fmt.Sprintf("%s: tried again after its pause.", s.name))
	h.startChild(s)
}

// ---- the scan --------------------------------------------------------------------------------------------------------------------------------------------

// Scan looks at the folders now: starts what is new, restarts what changed, lets go of what is gone, and looks at the shops that are held but not well. Serialised.
func (h *Host) Scan() ScanResult {
	h.opMu.Lock()
	defer h.opMu.Unlock()
	res := ScanResult{}
	wanted := map[string]bool{}
	for _, n := range h.o.Source.List() {
		if ShopName.MatchString(n) && h.o.Source.Ready(n) {
			wanted[n] = true
		}
	}
	h.mu.RLock()
	var held []string
	for n := range h.slots {
		held = append(held, n)
	}
	h.mu.RUnlock()
	sort.Strings(held)
	for _, n := range held {
		if !wanted[n] {
			h.letGo(n, "its folder is gone or not whole")
			res.LetGo = append(res.LetGo, n)
		}
	}
	h.mu.Lock()
	for n := range h.failed {
		if !wanted[n] {
			delete(h.failed, n)
		}
	}
	h.mu.Unlock()
	var order []string
	for n := range wanted {
		order = append(order, n)
	}
	sort.Strings(order)
	for _, name := range order {
		fp := h.o.Source.Fingerprint(name)
		h.mu.RLock()
		have := h.slots[name]
		_, closing := h.closing[name]
		wait, waiting := h.backoff[name]
		count := len(h.slots)
		h.mu.RUnlock()
		if have != nil && have.fp == fp {
			continue
		}
		if closing && have == nil {
			res.Failed = append(res.Failed, Failed{name, "its previous copy has not let go of its store yet"})
			continue
		}
		if have == nil && waiting && h.now() < wait.notBefore {
			res.Failed = append(res.Failed, Failed{name, "waiting to be tried again"})
			continue
		}
		if have == nil && count >= maxShops {
			res.Failed = append(res.Failed, Failed{name, fmt.Sprintf("this process holds at most %d shops", maxShops)})
			continue
		}
		if have != nil {
			h.letGo(name, "its files changed")
			h.mu.RLock()
			_, still := h.closing[name]
			h.mu.RUnlock()
			if still {
				res.Failed = append(res.Failed, Failed{name, "its previous copy has not let go of its store yet"})
				continue
			}
		}
		if err := h.startShop(name, fp); err != nil {
			why := strings.SplitN(err.Error(), "\n", 2)[0]
			h.mu.Lock()
			if h.failed[name] != fp {
				delete(h.backoff, name) // changed files: a fresh count
			}
			h.failed[name] = fp
			h.mu.Unlock()
			res.Failed = append(res.Failed, Failed{name, why})
			h.hurt(name, "it did not start ("+why+")")
			continue
		}
		h.mu.Lock()
		delete(h.failed, name)
		h.mu.Unlock()
		if have != nil {
			res.Restarted = append(res.Restarted, name)
		} else {
			res.Started = append(res.Started, name)
		}
	}
	h.look(&res)
	return res
}

func (h *Host) hurt(name, why string) {
	h.mu.Lock()
	b := h.backoff[name]
	b.n++
	d := h.lim.Backoff << (b.n - 1)
	if d > maxBackoff || d <= 0 {
		d = maxBackoff
	}
	b.notBefore = h.now() + d.Milliseconds()
	h.backoff[name] = b
	h.mu.Unlock()
	h.log(fmt.Sprintf("%s: %s; it will be tried again after a pause (the other shops go on).", name, why))
}

// startShop starts one shop where its strike memory says it belongs. (opMu held.)
func (h *Host) startShop(name, fp string) error {
	now := h.now()
	h.mu.Lock()
	m := h.mem[name]
	if m != nil && m.Fingerprint != fp {
		delete(h.mem, name) // its files changed: a clean sheet
		m = nil
	}
	m = h.memOf(name)
	m.Fingerprint = fp
	h.save()
	paused, quarantined := m.PausedUntil > now, m.Quarantined && h.o.Child != nil
	pausedUntil := m.PausedUntil
	h.mu.Unlock()
	s := &slot{name: name, fp: fp, paths: h.o.Source.Paths(name)}
	if paused {
		s.st = stPaused
		h.mu.Lock()
		s.timer = time.AfterFunc(time.Duration(pausedUntil-now)*time.Millisecond, func() { h.op(func() { h.resume(s) }) })
		h.slots[name] = s
		h.mu.Unlock()
		return nil
	}
	if quarantined {
		// a quarantined shop starts straight in a process of its own: nothing in this process holds its store
		s.st = stChildDown
		h.mu.Lock()
		h.slots[name] = s
		h.mu.Unlock()
		h.startChild(s)
		return nil
	}
	hooks := Hooks{Log: func(l string) { h.log("[" + name + "] " + l) }, OnPanic: func(where string, v any) { h.charge(s, fmt.Sprintf("a panic in its %s: %v", where, v)) }}
	shop, err := h.startWithin(name, s.paths, hooks)
	if err != nil {
		return err
	}
	s.shop, s.st = shop, stUp
	s.g = &guard{inner: shop.Handler(), timeout: h.lim.RequestTimeout, charge: func(why string) { h.charge(s, why) }}
	h.mu.Lock()
	h.slots[name] = s
	h.mu.Unlock()
	h.log(fmt.Sprintf("%s: started.", name))
	return nil
}

// startWithin runs the shop's start with a deadline and a recover. A start that outlives the deadline is an error, its late shop is closed when it arrives, and the name is held
// (not started again) until then.
func (h *Host) startWithin(name string, p Paths, hooks Hooks) (Shop, error) {
	type result struct {
		shop Shop
		err  error
	}
	ch := make(chan result, 1)
	rel := make(chan struct{})
	go func() {
		var r result
		func() {
			defer func() {
				if v := recover(); v != nil {
					r = result{err: fmt.Errorf("its start panicked: %v", v)}
				}
			}()
			r.shop, r.err = h.o.Start(p, hooks)
		}()
		ch <- r // buffered: never blocks
		close(rel)
	}()
	t := time.NewTimer(h.lim.StartWait)
	defer t.Stop()
	select {
	case r := <-ch:
		return r.shop, r.err
	case <-t.C:
		h.hold(name, rel)
		go func() { // a start that finishes late: let the shop go at once, so its store is not left open
			if r := <-ch; r.shop != nil {
				r.shop.Close()
			}
		}()
		return nil, fmt.Errorf("its start took longer than %s", h.lim.StartWait)
	}
}

// look checks the shops that are held: a shop not ready three looks in a row is restarted ALONE (in this process) or killed (in its own), after a back-off that doubles. (opMu held.)
func (h *Host) look(res *ScanResult) {
	h.mu.RLock()
	var all []*slot
	for _, s := range h.slots {
		all = append(all, s)
	}
	h.mu.RUnlock()
	sort.Slice(all, func(i, j int) bool { return all[i].name < all[j].name })
	for _, s := range all {
		h.mu.RLock()
		st, shop, child := s.st, s.shop, s.child
		h.mu.RUnlock()
		if st != stUp && st != stChild {
			h.mu.Lock()
			delete(h.bad, s.name)
			h.mu.Unlock()
			continue // moving, paused, stranded or starting again: the host is looking after it
		}
		var ok bool
		if shop != nil {
			ok = safeReady(shop)
		} else if child != nil {
			ok = probe(child.Port(), h.lim.RequestTimeout)
		}
		h.mu.Lock()
		if ok {
			delete(h.bad, s.name)
			if _, has := h.backoff[s.name]; has && h.failed[s.name] == "" {
				delete(h.backoff, s.name)
			}
			h.mu.Unlock()
			continue
		}
		h.bad[s.name]++
		n := h.bad[s.name]
		h.mu.Unlock()
		if n < failuresToRestart {
			continue
		}
		if child != nil {
			h.log(fmt.Sprintf("%s: its own process has not been ready for several looks; it is stopped (and started again).", s.name))
			child.Stop(time.Second)
			continue
		}
		h.letGo(s.name, "it has not been ready for several looks")
		res.LetGo = append(res.LetGo, s.name)
		h.hurt(s.name, "it was not ready")
	}
}

func safeReady(s Shop) (ok bool) {
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	return s.Ready()
}

func probe(port int, timeout time.Duration) bool {
	ctx, cancel := context.WithTimeout(context.Background(), min(timeout, 2*time.Second))
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("http://127.0.0.1:%d/readyz", port), nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	return res.StatusCode == 200
}

// watch is the watchdog: a runner that has been inside ONE step for longer than StuckAfter is stuck. The step cannot be killed, so it is charged a strike (once per StuckAfter while
// it stays stuck: a second strike is how a shop whose runner is stuck for good reaches quarantine).
func (h *Host) watch() {
	type look struct {
		s       *slot
		shop    Shop
		stuckAt int64
	}
	h.mu.RLock()
	var all []look
	for _, s := range h.slots {
		if s.st == stUp && s.shop != nil {
			all = append(all, look{s, s.shop, s.stuckAt})
		}
	}
	h.mu.RUnlock()
	now := h.now()
	for _, l := range all {
		since := stepSince(l.shop)
		if since == 0 || now-since < h.lim.StuckAfter.Milliseconds() || now-l.stuckAt < h.lim.StuckAfter.Milliseconds() {
			continue
		}
		h.mu.Lock()
		l.s.stuckAt = now
		h.mu.Unlock()
		h.charge(l.s, fmt.Sprintf("its runner has been inside one step for %s", time.Duration(now-since)*time.Millisecond))
	}
}

func stepSince(s Shop) (since int64) {
	defer func() {
		if recover() != nil {
			since = 0
		}
	}()
	return s.StepSince()
}

// Stop ends the host: the front closes, every shop is let go (its store proven closed, within StopWait each), every child stopped.
func (h *Host) Stop() {
	h.stopped.Do(func() {
		close(h.stop)
		h.wg.Wait()
		_ = h.front.Close()
		h.opMu.Lock()
		defer h.opMu.Unlock()
		h.mu.RLock()
		var all []string
		for n := range h.slots {
			all = append(all, n)
		}
		h.mu.RUnlock()
		var wg sync.WaitGroup
		for _, n := range all {
			// each let go in a goroutine: letGo takes only h.mu briefly, and the slow part (waiting for a store) must not be one after another
			wg.Add(1)
			go func() { defer wg.Done(); h.letGo(n, "the process is stopping") }()
		}
		wg.Wait()
	})
}

func regexpMust(s string) *regexp.Regexp { return regexp.MustCompile(s) }
