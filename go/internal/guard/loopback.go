package guard

// The hand check's shop only talks to this machine (24 Nov 2026). A "fakes" shop whose runtime.json says "standins": "http" (internal/runtime/config.go standInsProblems) runs the
// live clients against the go-live hand check's stand-ins, on the test clock. Its addresses are checked when the folder is read (127.0.0.1 or ::1 only); this file makes the
// process hold to it while it runs, whatever a name resolves to or a stand-in answers: once RestrictToLoopback is called, every connection the clients built here open must
// reach a loopback address (the dialled address is checked, so a name that resolves elsewhere is refused), and a redirect that leaves the loopback is not followed. A real
// shop never calls it, so nothing changes for one: its clients dial and follow redirects as before.

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"sync/atomic"
	"time"
)

var loopbackOnly atomic.Bool

// RestrictToLoopback holds every client of this package's making to this machine from now on (the hand check's shop, at start). It cannot be undone.
func RestrictToLoopback() { loopbackOnly.Store(true) }

// LoopbackOnly says whether the process is held to this machine.
func LoopbackOnly() bool { return loopbackOnly.Load() }

// ErrNotLoopback is a connection or redirect the hand check's shop refused.
var ErrNotLoopback = errors.New("the hand check's shop talks only to this machine (127.0.0.1 or ::1), and this address is elsewhere")

// IsLoopbackHost says whether a URL host (no port) is a loopback address written as one: 127.0.0.1 or ::1, never a name (a name may resolve anywhere).
func IsLoopbackHost(host string) bool {
	a, err := netip.ParseAddr(host)
	return err == nil && (a == netip.MustParseAddr("127.0.0.1") || a == netip.IPv6Loopback())
}

// dialContext dials as net.Dialer does and, when held to this machine, refuses a connection whose far end is not a loopback address.
func dialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	conn, err := (&net.Dialer{Timeout: 30 * time.Second}).DialContext(ctx, network, addr)
	if err != nil || !loopbackOnly.Load() {
		return conn, err
	}
	if ap, perr := netip.ParseAddrPort(conn.RemoteAddr().String()); perr != nil || !ap.Addr().Unmap().IsLoopback() {
		conn.Close()
		return nil, ErrNotLoopback
	}
	return conn, nil
}

// checkRedirect is net/http's own policy (at most 10 redirects) and, when held to this machine, refuses one to anywhere but a loopback address.
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return errors.New("stopped after 10 redirects")
	}
	if loopbackOnly.Load() && !IsLoopbackHost(req.URL.Hostname()) {
		return ErrNotLoopback
	}
	return nil
}

// HTTPClient is an http.Client with these two holds. `t` is the transport's settings (its dialer is replaced); nil is a plain transport with no proxy.
func HTTPClient(t *http.Transport, timeout time.Duration) *http.Client {
	if t == nil {
		t = &http.Transport{Proxy: nil}
	}
	t.DialContext = dialContext
	return &http.Client{Transport: t, Timeout: timeout, CheckRedirect: checkRedirect}
}
