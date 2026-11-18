package shared

// The host against FAKE shops (a panicking one, a spinning one, a stuck runner, a slow closer) and a fake child spawner, with time constants of tens of milliseconds. The real
// shop on the real binary is tested by the contract (templates/commerce/listings/contract/shared.contract.test.ts).

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// ---- fakes -------------------------------------------------------------------------------------------------------------------------------------------------

// registry knows every fake shop and child, and fails the test if a store is ever owned twice (the rule the host exists to keep).
type registry struct {
	t        *testing.T
	mu       sync.Mutex
	open     map[string]int // stores held right now, by shop: an in-process copy or a child
	starts   map[string]int
	spawns   map[string]int
	closed   map[string]bool
	order    []string // "close <shop>" / "spawn <shop>" in the order they happened
	behave   map[string]string
	closeDur map[string]time.Duration
	release  map[string]chan struct{} // a Close or a spinning request waits on it
	stepAt   map[string]*atomic.Int64
	failOnce map[string]bool
	children []*fakeChild
}

func newRegistry(t *testing.T) *registry {
	return &registry{t: t, open: map[string]int{}, starts: map[string]int{}, spawns: map[string]int{}, closed: map[string]bool{}, behave: map[string]string{}, closeDur: map[string]time.Duration{}, release: map[string]chan struct{}{}, stepAt: map[string]*atomic.Int64{}, failOnce: map[string]bool{}}
}

func (r *registry) rel(name string) chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.release[name] == nil {
		r.release[name] = make(chan struct{})
	}
	return r.release[name]
}

func (r *registry) grab(name, who string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.open[name]++
	if r.open[name] > 1 {
		r.t.Errorf("TWO OWNERS of %s's store (%s started while another still held it)", name, who)
	}
}

type fakeShop struct {
	r    *registry
	name string
	step *atomic.Int64
	once sync.Once
}

func (f *fakeShop) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/boom":
			panic("fake handler panic")
		case "/spin":
			<-f.r.rel(f.name) // an endless loop, until the test lets it end
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"shop": f.name, "path": req.URL.RequestURI(), "auth": req.Header.Get("authorization")})
	})
}
func (f *fakeShop) Ready() bool {
	f.r.mu.Lock()
	defer f.r.mu.Unlock()
	return f.r.behave[f.name] != "unready"
}
func (f *fakeShop) StepSince() int64 { return f.step.Load() }
func (f *fakeShop) Close() {
	f.once.Do(func() {
		f.r.mu.Lock()
		d, behave := f.r.closeDur[f.name], f.r.behave[f.name]
		f.r.mu.Unlock()
		if behave == "stuck-runner" {
			<-f.r.rel(f.name + "/close") // the runner's step never ends: Close cannot finish
		}
		time.Sleep(d)
		f.r.mu.Lock()
		f.r.open[f.name]--
		f.r.closed[f.name] = true
		f.r.order = append(f.r.order, "close "+f.name)
		f.r.mu.Unlock()
	})
}

func (r *registry) start(p Paths, h Hooks) (Shop, error) {
	r.mu.Lock()
	r.starts[p.Name]++
	fail := r.behave[p.Name] == "fail" || r.failOnce[p.Name]
	delete(r.failOnce, p.Name)
	step := r.stepAt[p.Name]
	if step == nil {
		step = &atomic.Int64{}
		r.stepAt[p.Name] = step
	}
	r.mu.Unlock()
	if fail {
		return nil, fmt.Errorf("%s: these settings need fixing\n- something", p.Name)
	}
	r.grab(p.Name, "an in-process copy")
	r.mu.Lock()
	r.closed[p.Name] = false
	r.mu.Unlock()
	return &fakeShop{r: r, name: p.Name, step: step}, nil
}

type fakeChild struct {
	r    *registry
	name string
	ln   net.Listener
	srv  *http.Server
	done chan struct{}
	once sync.Once
}

func (c *fakeChild) Port() int             { return c.ln.Addr().(*net.TCPAddr).Port }
func (c *fakeChild) Done() <-chan struct{} { return c.done }
func (c *fakeChild) Stop(_ time.Duration)  { c.crash() }
func (c *fakeChild) crash() {
	c.once.Do(func() {
		_ = c.srv.Close()
		c.r.mu.Lock()
		c.r.open[c.name]--
		c.r.mu.Unlock()
		close(c.done)
	})
}

func (r *registry) Spawn(name string) (Child, error) {
	r.mu.Lock()
	r.spawns[name]++
	r.order = append(r.order, "spawn "+name)
	r.mu.Unlock()
	r.grab(name, "a child")
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	c := &fakeChild{r: r, name: name, ln: ln, done: make(chan struct{})}
	c.srv = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"shop": name, "via": "child", "path": req.URL.RequestURI()})
	})}
	go func() { _ = c.srv.Serve(ln) }()
	r.mu.Lock()
	r.children = append(r.children, c)
	r.mu.Unlock()
	return c, nil
}

func (r *registry) lastChild(name string) *fakeChild {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := len(r.children) - 1; i >= 0; i-- {
		if r.children[i].name == name {
			return r.children[i]
		}
	}
	return nil
}

func (r *registry) count(m map[string]int, name string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return m[name]
}

// ---- the setup -----------------------------------------------------------------------------------------------------------------------------------------------

func tiny() Limits {
	return Limits{StrikeWindow: time.Minute, StrikesToQuarantine: 2, QuarantineWindow: time.Minute, FailuresToPause: 3, Pause: 600 * time.Millisecond, RequestTimeout: 150 * time.Millisecond,
		StuckAfter: 150 * time.Millisecond, WatchEvery: 30 * time.Millisecond, StopWait: 250 * time.Millisecond, StartWait: 2 * time.Second, ChildDelay: 10 * time.Millisecond, Backoff: 50 * time.Millisecond}
}

func folder(t *testing.T, root, name, text string) {
	t.Helper()
	client := filepath.Join(root, "clients", name, "client")
	secrets := filepath.Join(root, "secrets", name)
	for _, d := range []string{client, secrets} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range []string{"internal_token", "channel_token", "record_key"} {
		_ = os.WriteFile(filepath.Join(secrets, f), []byte(f+"-"+name), 0o644)
	}
	_ = os.WriteFile(filepath.Join(client, "settings.json"), []byte(`{"name":"`+name+`","text":"`+text+`"}`), 0o644)
	_ = os.WriteFile(filepath.Join(client, "runtime.json"), []byte("{}"), 0o644)
	_ = os.WriteFile(filepath.Join(client, "pathway.lock"), []byte("listings@0.1.0\n"), 0o644)
}

type rig struct {
	t    *testing.T
	root string
	reg  *registry
	h    *Host
	logs *logSink
	now  *atomic.Int64
}

type logSink struct {
	mu    sync.Mutex
	lines []string
}

func (l *logSink) add(s string) { l.mu.Lock(); l.lines = append(l.lines, s); l.mu.Unlock() }
func (l *logSink) has(sub string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, s := range l.lines {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func boot(t *testing.T, names []string, mod func(*registry), lim func(*Limits), o ...func(*Options)) *rig {
	t.Helper()
	root := t.TempDir()
	for _, n := range names {
		folder(t, root, n, "a")
	}
	reg := newRegistry(t)
	if mod != nil {
		mod(reg)
	}
	l := tiny()
	if lim != nil {
		lim(&l)
	}
	sink := &logSink{}
	now := &atomic.Int64{}
	now.Store(time.Now().UnixMilli())
	opts := Options{Source: FolderSource{ClientsDir: filepath.Join(root, "clients"), SecretsDir: filepath.Join(root, "secrets")}, Start: reg.start, Child: reg, Addr: "127.0.0.1:0",
		ScanEvery: time.Hour, Limits: l, Log: sink.add, StateDir: filepath.Join(root, "state")}
	for _, f := range o {
		f(&opts)
	}
	h, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		reg.mu.Lock()
		for _, c := range reg.release {
			select {
			case <-c:
			default:
				close(c)
			}
		}
		reg.mu.Unlock()
		h.Stop()
	})
	return &rig{t: t, root: root, reg: reg, h: h, logs: sink, now: now}
}

type reply struct {
	status int
	body   map[string]any
	raw    string
	header http.Header
}

func (g *rig) get(path string, headers ...string) reply {
	g.t.Helper()
	req, _ := http.NewRequest("GET", g.h.URL+path, nil)
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		g.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	out := reply{status: res.StatusCode, raw: string(b), header: res.Header}
	_ = json.Unmarshal(b, &out.body)
	return out
}

func until(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for i := 0; i < 400; i++ {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting until %s", what)
}

func (g *rig) status() Status { return g.h.Status() }
func (g *rig) paused(n string) bool {
	for _, p := range g.status().Paused {
		if p == n {
			return true
		}
	}
	return false
}

// ---- tests ---------------------------------------------------------------------------------------------------------------------------------------------------

func TestRoutesAndTheProcessPaths(t *testing.T) {
	g := boot(t, []string{"glow-pets", "sree-cycles"}, nil, nil)
	if got := g.h.Held(); strings.Join(got, ",") != "glow-pets,sree-cycles" {
		t.Fatalf("held %v", got)
	}
	r := g.get("/shop/glow-pets/anything?x=1", "authorization", "Bearer t")
	if r.body["shop"] != "glow-pets" || r.body["path"] != "/anything?x=1" || r.body["auth"] != "Bearer t" {
		t.Fatalf("routing: %v", r.body)
	}
	if g.get("/shop/sree-cycles").body["path"] != "/" {
		t.Fatal("a bare /shop/<name> is the shop's /")
	}
	if g.get("/shop/nobody/x").status != 404 || g.get("/nothing").status != 404 {
		t.Fatal("an unknown shop and an unknown path are 404")
	}
	for _, p := range []string{"/healthz", "/readyz"} {
		r := g.get(p)
		if r.raw != `{"ok":true,"shops":2,"paused":[],"quarantined":[]}` {
			t.Fatalf("%s: %s", p, r.raw)
		}
	}
	if r := g.get("/shared/shops"); r.raw != `{"shops":["glow-pets","sree-cycles"],"paused":[],"pausedDetail":[]}` {
		t.Fatalf("/shared/shops: %s", r.raw)
	}
}

func TestNewShopsAreFoundAndShopsWithoutAllFilesAreNot(t *testing.T) {
	g := boot(t, []string{"a1"}, nil, nil)
	folder(t, g.root, "b2", "x")
	_ = os.Remove(filepath.Join(g.root, "secrets", "b2", "channel_token")) // a missing token file: never started, never on another's token
	folder(t, g.root, "c3", "x")
	res := g.h.Scan()
	if strings.Join(res.Started, ",") != "c3" || strings.Join(g.h.Held(), ",") != "a1,c3" {
		t.Fatalf("started %v held %v", res.Started, g.h.Held())
	}
	if g.reg.count(g.reg.starts, "a1") != 1 {
		t.Fatal("the shop already held was not touched")
	}
	folder(t, g.root, "Bad_Name", "x") // not a shop name
	if g.h.Scan(); strings.Contains(strings.Join(g.h.Held(), ","), "Bad") {
		t.Fatal("a folder whose name is not a shop name is never started")
	}
}

func TestAFailedStartIsSkippedAndTriedAgainAfterABackoff(t *testing.T) {
	g := boot(t, []string{"good", "broken"}, func(r *registry) { r.behave["broken"] = "fail" }, nil)
	if strings.Join(g.h.Held(), ",") != "good" || g.get("/shop/good/").status != 200 || g.get("/healthz").status != 200 {
		t.Fatal("the other shop runs and the process is healthy")
	}
	res := g.h.Scan() // inside the back-off: not tried again
	if len(res.Failed) != 1 || res.Failed[0].Why != "waiting to be tried again" || g.reg.count(g.reg.starts, "broken") != 1 {
		t.Fatalf("%v", res.Failed)
	}
	g.reg.mu.Lock()
	g.reg.behave["broken"] = ""
	g.reg.mu.Unlock()
	time.Sleep(80 * time.Millisecond)
	if res := g.h.Scan(); strings.Join(res.Started, ",") != "broken" {
		t.Fatalf("after the back-off it is started: %+v", res)
	}
}

func TestAChangedShopRestartsAloneAndARemovedShopIsLetGo(t *testing.T) {
	g := boot(t, []string{"a1", "b2"}, nil, nil)
	folder(t, g.root, "a1", "changed")
	if res := g.h.Scan(); strings.Join(res.Restarted, ",") != "a1" || g.reg.count(g.reg.starts, "b2") != 1 {
		t.Fatalf("%+v", res)
	}
	_ = os.Remove(filepath.Join(g.root, "clients", "b2", "client", "pathway.lock"))
	if res := g.h.Scan(); strings.Join(res.LetGo, ",") != "b2" || g.get("/shop/b2/").status != 404 || g.get("/shop/a1/").status != 200 {
		t.Fatalf("%+v", res)
	}
}

// the store is closed BEFORE /shared/shops stops naming the shop
func TestLetGoClosesTheStoreBeforeTheNameLeavesTheList(t *testing.T) {
	g := boot(t, []string{"slow", "other"}, func(r *registry) { r.closeDur["slow"] = 120 * time.Millisecond }, nil)
	_ = os.Remove(filepath.Join(g.root, "clients", "slow", "client", "pathway.lock"))
	done := make(chan struct{})
	go func() { g.h.Scan(); close(done) }()
	namedWhileOpen, closedWhenUnnamed := false, false
	until(t, "the name leaves the list", func() bool {
		named := strings.Contains(g.get("/shared/shops").raw, `"slow"`)
		g.reg.mu.Lock()
		closed := g.reg.closed["slow"]
		g.reg.mu.Unlock()
		if named {
			if !closed {
				namedWhileOpen = true
			}
			return false
		}
		closedWhenUnnamed = closed
		return true
	})
	<-done
	if !namedWhileOpen || !closedWhenUnnamed {
		t.Fatalf("named while open: %v; closed when unnamed: %v", namedWhileOpen, closedWhenUnnamed)
	}
	if g.get("/shop/slow/").status != 404 || g.get("/shop/other/").status != 200 {
		t.Fatal("slow is gone and other is not disturbed")
	}
}

func TestAPanicInARequestIsContainedThenTwoStrikesMoveTheShopToItsOwnProcess(t *testing.T) {
	g := boot(t, []string{"hog", "calm"}, nil, nil)
	r := g.get("/shop/hog/boom")
	if r.status != 500 {
		t.Fatalf("a panic is a 500 for that request alone, got %d", r.status)
	}
	if g.get("/shop/hog/").status != 200 || g.get("/shop/calm/").status != 200 {
		t.Fatal("the process and the other shop go on; one strike is only bad luck")
	}
	if g.get("/shop/hog/boom").status != 500 { // the second strike
		t.Fatal("second panic")
	}
	until(t, "hog is served by its own process", func() bool { return g.get("/shop/hog/x").body["via"] == "child" })
	g.reg.mu.Lock()
	order := strings.Join(g.reg.order, ",")
	g.reg.mu.Unlock()
	if order != "close hog,spawn hog" {
		t.Fatalf("the child started only AFTER the store was let go: %s", order)
	}
	if st := g.status(); strings.Join(st.Quarantined, ",") != "hog" {
		t.Fatalf("quarantined %v", st.Quarantined)
	}
	if g.get("/shop/calm/").body["shop"] != "calm" || !strings.Contains(g.get("/healthz").raw, `"quarantined":["hog"]`) {
		t.Fatal("calm untouched; healthz names the quarantined shop")
	}
}

func TestAPanicInTheRunnerOrTheClockIsChargedToItsShop(t *testing.T) {
	var hooks Hooks
	g := boot(t, []string{"hog"}, nil, nil, func(o *Options) {
		inner := o.Start
		o.Start = func(p Paths, h Hooks) (Shop, error) { hooks = h; return inner(p, h) }
	})
	hooks.OnPanic("drain", "boom") // what internal/runtime does after it recovered a panic in its runner
	hooks.OnPanic("tick", "boom")
	until(t, "the second strike moves it", func() bool { return g.get("/shop/hog/").body["via"] == "child" })
}

func TestASpinningRequestGets503AndAbandonedWorkMustEndBeforeAChildStarts(t *testing.T) {
	g := boot(t, []string{"spin", "calm"}, nil, nil)
	t0 := time.Now()
	r := g.get("/shop/spin/spin")
	if r.status != 503 || r.header.Get("retry-after") == "" || time.Since(t0) > time.Second {
		t.Fatalf("a spinning request is answered 503 at the deadline: %d after %s", r.status, time.Since(t0))
	}
	if g.get("/shop/calm/").status != 200 {
		t.Fatal("the other shop answers throughout")
	}
	if g.get("/shop/spin/spin").status != 503 { // second strike
		t.Fatal("second")
	}
	until(t, "it is stranded", func() bool { return g.paused("spin") })
	if st := g.status(); st.Abandoned != 2 || len(st.PausedDetail) != 1 || !strings.Contains(st.PausedDetail[0].Why, "stuck") {
		t.Fatalf("two goroutines abandoned and the reason said: %+v", st)
	}
	if p := g.get("/shop/spin/x", "accept", "text/html"); p.status != 503 || p.header.Get("x-back-soon") != "1" || !strings.Contains(p.raw, "back soon") {
		t.Fatalf("stranded shops answer back soon: %d %q", p.status, p.raw)
	}
	if g.reg.count(g.reg.spawns, "spin") != 0 {
		t.Fatal("NO child while the abandoned goroutines may still hold the store")
	}
	if !strings.Contains(g.get("/shared/shops").raw, `"spin"`) {
		t.Fatal("it is still named")
	}
	close(g.reg.rel("spin")) // the spinning requests end at last
	until(t, "it moves to a child", func() bool { return g.get("/shop/spin/x").body["via"] == "child" })
	if g.status().Abandoned != 0 {
		t.Fatal("nothing abandoned any more")
	}
}

func TestAStuckRunnerIsStruckByTheWatchdogAndNeverGetsAChildWhileItHoldsTheStore(t *testing.T) {
	g := boot(t, []string{"wedge", "calm"}, func(r *registry) {
		r.behave["wedge"] = "stuck-runner"
		s := &atomic.Int64{}
		s.Store(time.Now().UnixMilli()) // a step that began now and never ends
		r.stepAt["wedge"] = s
	}, nil)
	until(t, "stranded by two watchdog strikes", func() bool { return g.paused("wedge") })
	if g.reg.count(g.reg.spawns, "wedge") != 0 || g.get("/shop/calm/").status != 200 || g.get("/healthz").status != 200 {
		t.Fatal("no child; the others and the process are fine")
	}
	g.reg.stepAt["wedge"].Store(0)
	close(g.reg.rel("wedge/close")) // the step ends: the store is let go
	until(t, "it moves to a child", func() bool { return g.get("/shop/wedge/").body["via"] == "child" })
}

func crashChild(g *rig, name string, nth int) {
	g.t.Helper()
	until(g.t, "a child is up", func() bool {
		c := g.reg.lastChild(name)
		return c != nil && g.get("/shop/" + name + "/").body["via"] == "child"
	})
	g.reg.lastChild(name).crash()
	until(g.t, fmt.Sprintf("crash %d is counted", nth), func() bool { return g.logs.has(fmt.Sprintf("failure %d of 3", nth)) || g.paused(name) })
}

func TestThreeFailuresInItsOwnProcessPauseTheShopAndItComesBackOnProbation(t *testing.T) {
	g := boot(t, []string{"hog", "calm"}, nil, nil)
	g.get("/shop/hog/boom")
	g.get("/shop/hog/boom")
	crashChild(g, "hog", 1)
	crashChild(g, "hog", 2)
	until(t, "child up", func() bool { return g.get("/shop/hog/").body["via"] == "child" })
	g.reg.lastChild("hog").crash()
	until(t, "paused", func() bool { return g.paused("hog") })
	p := g.get("/shop/hog/anything", "accept", "text/html")
	if p.status != 503 || p.header.Get("retry-after") != "3600" || p.header.Get("x-back-soon") != "1" || !strings.Contains(p.raw, "back soon") {
		t.Fatalf("back soon: %d %v %q", p.status, p.header, p.raw)
	}
	j := g.get("/shop/hog/x?lang=ml")
	msg := j.body["error"].(map[string]any)
	if j.body["backSoon"] != true || msg["code"] != "unavailable" || msg["message"] != BackSoon[2].Text {
		t.Fatalf("json form: %s", j.raw)
	}
	var shops struct {
		Paused       []string       `json:"paused"`
		PausedDetail []PausedDetail `json:"pausedDetail"`
	}
	_ = json.Unmarshal([]byte(g.get("/shared/shops").raw), &shops)
	if len(shops.Paused) != 1 || shops.PausedDetail[0].Shop != "hog" || shops.PausedDetail[0].Until <= time.Now().UnixMilli() || shops.PausedDetail[0].Why == "" {
		t.Fatalf("%+v", shops)
	}
	if g.get("/shop/calm/").status != 200 || !strings.Contains(g.get("/readyz").raw, `"paused":["hog"]`) || !g.logs.has("hog: PAUSED") {
		t.Fatal("calm answers; ready as a process; the pause is said in the log")
	}
	// the pause ends by itself; on probation one failure pauses it again at once
	until(t, "tried again", func() bool { return !g.paused("hog") && g.get("/shop/hog/").body["via"] == "child" })
	g.reg.lastChild("hog").crash()
	until(t, "paused again at once", func() bool { return g.paused("hog") })
}

func TestChangedFilesGiveACleanSheetAndAnInProcessCopy(t *testing.T) {
	g := boot(t, []string{"hog"}, nil, func(l *Limits) { l.Pause = time.Hour })
	g.get("/shop/hog/boom")
	g.get("/shop/hog/boom")
	for n := 1; n <= 2; n++ {
		crashChild(g, "hog", n)
	}
	until(t, "child up", func() bool { return g.get("/shop/hog/").body["via"] == "child" })
	g.reg.lastChild("hog").crash()
	until(t, "paused", func() bool { return g.paused("hog") })
	folder(t, g.root, "hog", "someone fixed it")
	if res := g.h.Scan(); strings.Join(res.Restarted, ",") != "hog" {
		t.Fatalf("%+v", res)
	}
	if st := g.status(); len(st.Paused) != 0 || len(st.Quarantined) != 0 {
		t.Fatalf("a clean sheet: %+v", st)
	}
	if g.get("/shop/hog/").body["via"] == "child" || g.get("/shop/hog/").status != 200 {
		t.Fatal("back in the shared process")
	}
}

func TestStrikesExpireAndTheMemoryIsKeptByFingerprint(t *testing.T) {
	clock := &atomic.Int64{}
	clock.Store(1_000_000)
	g := boot(t, []string{"hog"}, nil, func(l *Limits) { l.StrikeWindow = time.Second }, func(o *Options) { o.Now = clock.Load })
	g.get("/shop/hog/boom")
	clock.Add(2000) // past the window: forgotten
	g.get("/shop/hog/boom")
	time.Sleep(100 * time.Millisecond)
	if g.get("/shop/hog/").body["via"] == "child" {
		t.Fatal("two strikes further apart than the window are not a quarantine")
	}
	g.get("/shop/hog/boom")
	until(t, "two within the window", func() bool { return g.get("/shop/hog/").body["via"] == "child" })
}

func TestQuarantineSurvivesARestartOfTheHostAndStartsStraightInAChild(t *testing.T) {
	g := boot(t, []string{"hog"}, nil, nil)
	g.get("/shop/hog/boom")
	g.get("/shop/hog/boom")
	until(t, "child", func() bool { return g.get("/shop/hog/").body["via"] == "child" })
	state := filepath.Join(g.root, "state")
	g.h.Stop()
	reg2 := newRegistry(t)
	sink := &logSink{}
	h2, err := New(Options{Source: FolderSource{ClientsDir: filepath.Join(g.root, "clients"), SecretsDir: filepath.Join(g.root, "secrets")}, Start: reg2.start, Child: reg2, Addr: "127.0.0.1:0", ScanEvery: time.Hour, Limits: tiny(), Log: sink.add, StateDir: state})
	if err != nil {
		t.Fatal(err)
	}
	defer h2.Stop()
	if reg2.count(reg2.starts, "hog") != 0 || reg2.count(reg2.spawns, "hog") != 1 {
		t.Fatalf("starts %d spawns %d: nothing in the new process held its store, so it went straight to a child", reg2.count(reg2.starts, "hog"), reg2.count(reg2.spawns, "hog"))
	}
}

func TestWithoutAChildSpawnerAQuarantinedShopIsPausedNotLeftHurting(t *testing.T) {
	g := boot(t, []string{"hog"}, nil, nil, func(o *Options) { o.Child = nil })
	g.get("/shop/hog/boom")
	g.get("/shop/hog/boom")
	until(t, "paused", func() bool { return g.paused("hog") })
}

func TestBackSoonWordsAreTheTypeScriptOnes(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "modules", "channels", "words-back-soon.ts"))
	if err != nil {
		t.Skip("the TypeScript file is not beside this checkout")
	}
	for _, b := range BackSoon {
		m := regexp.MustCompile(`(?m)^\s+` + b.Lang + `: "([^"]+)"`).FindSubmatch(raw)
		if m == nil || string(m[1]) != b.Text {
			t.Fatalf("%s differs from modules/channels/words-back-soon.ts", b.Lang)
		}
	}
}

func TestAShopNotReadyForThreeLooksIsRestartedAlone(t *testing.T) {
	g := boot(t, []string{"sick", "well"}, func(r *registry) { r.behave["sick"] = "unready" }, nil)
	g.h.Scan() // the start's own look was the first
	if g.reg.count(g.reg.starts, "sick") != 1 || len(g.h.Held()) != 2 {
		t.Fatal("two bad looks are not enough")
	}
	res := g.h.Scan() // the third
	if strings.Join(res.LetGo, ",") != "sick" || g.get("/shop/sick/").status != 404 || g.get("/shop/well/").status != 200 {
		t.Fatalf("%+v", res)
	}
	g.reg.mu.Lock()
	g.reg.behave["sick"] = ""
	g.reg.mu.Unlock()
	time.Sleep(80 * time.Millisecond) // the back-off
	if res := g.h.Scan(); strings.Join(res.Started, ",") != "sick" || g.reg.count(g.reg.starts, "well") != 1 {
		t.Fatalf("it starts again, alone: %+v", res)
	}
}

// a host that stalled (everything's timers fire late) strikes nobody; the next ordinary round judges again
func TestAHostStallStrikesNobody(t *testing.T) {
	clock := &atomic.Int64{}
	clock.Store(time.Now().UnixMilli())
	g := boot(t, []string{"spin"}, nil, func(l *Limits) { l.WatchEvery = time.Minute }, func(o *Options) { o.Now = clock.Load })
	clock.Add(10 * 60_000) // ten minutes pass in a blink: the host was stalled
	if g.get("/shop/spin/spin").status != 503 {
		t.Fatal("the visitor is still answered at the deadline")
	}
	g.reg.mu.Lock()
	step := g.reg.stepAt["spin"] // the one the running fake reads
	g.reg.mu.Unlock()
	step.Store(clock.Load() - 1000)
	g.h.watch() // stalled: judges nobody
	if g.logs.has("strike") {
		t.Fatal("a stall is nobody's fault")
	}
	g.h.watch() // an ordinary round: the step has been going for a second, StuckAfter is 150 ms
	if !g.logs.has("spin: strike 1") {
		t.Fatal("judged again after the stall")
	}
}

func TestBackSoonPageHasTheMachineNoteAndTheOperator(t *testing.T) {
	g := boot(t, []string{"hog"}, nil, nil, func(o *Options) { o.Child = nil })
	_ = os.WriteFile(filepath.Join(g.root, "clients", "hog", "client", "pages.json"), []byte(`{"partner":{"name":"Anu","phone":"+91 98765 43210"}}`), 0o644)
	g.get("/shop/hog/boom")
	g.get("/shop/hog/boom")
	until(t, "paused", func() bool { return g.paused("hog") })
	p := g.get("/shop/hog/?lang=ml", "accept", "text/html")
	for _, want := range []string{`lang="ml"`, BackSoon[2].Text, pageWords["ml"].Machine, "tel:+919876543210", "https://wa.me/919876543210", "Anu"} {
		if !strings.Contains(p.raw, want) {
			t.Fatalf("the page lacks %q: %s", want, p.raw)
		}
	}
}
