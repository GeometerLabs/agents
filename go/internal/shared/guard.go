package shared

// One in-process shop's request wrapper. It does what a shop's own server cannot do for itself: answer when the handler does not (a deadline), survive a handler that panics, and
// count the handler goroutines still alive so the host can prove a shop has let go of its store before it moves it. The handler runs in a goroutine of its own, writing into a
// buffer; on a timeout the visitor gets a 503 at once and the goroutine is ABANDONED (Go cannot stop it): it is counted, and when it ends it is counted out. Nothing is
// streamed (listing pages, feeds and photos are small), so buffering is cheap and means an abandoned handler can never write into a connection that moved on.

import (
	"bytes"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"
)

type guard struct {
	inner    http.Handler
	timeout  time.Duration
	charge   func(why string)
	stalled  func() bool  // the host itself stalled: a deadline missed then is nobody's fault
	inflight atomic.Int64 // handler goroutines running now (abandoned ones included)
	abandon  atomic.Int64 // of those, the ones whose visitor was already answered 503
}

type recorder struct {
	h    http.Header
	code int
	buf  bytes.Buffer
}

func (r *recorder) Header() http.Header { return r.h }
func (r *recorder) WriteHeader(c int) {
	if r.code == 0 {
		r.code = c
	}
}
func (r *recorder) Write(b []byte) (int, error) {
	if r.code == 0 {
		r.code = 200
	}
	return r.buf.Write(b)
}

func busy(w http.ResponseWriter, status int, msg string, retry string) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.Header().Set("retry-after", retry)
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, `{"error":%q}`, msg)
}

func (g *guard) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	type result struct {
		panicked bool
		v        any
	}
	rec := &recorder{h: http.Header{}}
	done := make(chan result, 1) // buffered: an abandoned handler's late answer never blocks
	var abandoned atomic.Bool
	g.inflight.Add(1)
	go func() {
		defer g.inflight.Add(-1)
		defer func() {
			if abandoned.Load() {
				g.abandon.Add(-1)
			}
		}()
		res := result{}
		func() {
			defer func() {
				if p := recover(); p != nil {
					res = result{true, p}
				}
			}()
			g.inner.ServeHTTP(rec, r)
		}()
		done <- res
	}()
	timer := time.NewTimer(g.timeout)
	defer timer.Stop()
	select {
	case res := <-done:
		if res.panicked {
			g.charge(fmt.Sprintf("a panic in a request: %v", res.v))
			busy(w, 500, "The runtime could not handle that. Send it again.", "2")
			return
		}
		for k, v := range rec.h {
			w.Header()[k] = v
		}
		if rec.code == 0 {
			rec.code = 200
		}
		w.WriteHeader(rec.code)
		_, _ = w.Write(rec.buf.Bytes())
	case <-timer.C:
		abandoned.Store(true)
		g.abandon.Add(1)
		select { // it may have finished in the same instant: then it is not abandoned after all
		case <-done:
			abandoned.Store(false)
			g.abandon.Add(-1)
		default:
		}
		if g.stalled == nil || !g.stalled() {
			g.charge(fmt.Sprintf("a request took longer than %s", g.timeout))
		}
		busy(w, 503, "This shop is busy. Please try in a moment.", "2")
	}
}

// idle: no handler goroutine of this shop is running (none abandoned either).
func (g *guard) idle() bool { return g.inflight.Load() == 0 }
