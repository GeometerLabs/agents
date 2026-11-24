// The hand check's shop is held to this machine while it runs (loopback.go): a connection elsewhere and a redirect off the loopback are refused; a loopback one goes through.
package guard

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLoopbackHold(t *testing.T) {
	away := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer away.Close()
	// the redirecting stand-in sends the client to an address that is not a loopback written as one (a name), which the hold refuses
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, port, _ := net.SplitHostPort(away.Listener.Addr().String())
		http.Redirect(w, r, "http://localhost:"+port+"/", http.StatusFound)
	}))
	defer redirect.Close()
	RestrictToLoopback()
	c := HTTPClient(nil, 0)
	if res, err := c.Get(away.URL); err != nil {
		t.Fatalf("a loopback stand-in was refused: %v", err)
	} else {
		res.Body.Close()
	}
	if res, err := c.Get(redirect.URL); err == nil {
		res.Body.Close()
		t.Fatal("a redirect off the loopback (to a name) was followed")
	}
	for _, h := range []string{"127.0.0.1", "::1"} {
		if !IsLoopbackHost(h) {
			t.Errorf("%s is the loopback", h)
		}
	}
	for _, h := range []string{"localhost", "0.0.0.0", "127.0.0.2", "fe80::1", "::ffff:8.8.8.8", "127.0.0.1.example.com"} {
		if IsLoopbackHost(h) {
			t.Errorf("%s was taken for the loopback", h)
		}
	}
	// a connection whose far end is not a loopback address is refused at the dial (a name that resolves elsewhere): tried on the machine's own outside address when it has one
	if addrs, _ := net.InterfaceAddrs(); len(addrs) > 0 {
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() && ipn.IP.To4() != nil {
				l, err := net.Listen("tcp", ipn.IP.String()+":0")
				if err != nil {
					continue
				}
				go func() {
					conn, _ := l.Accept()
					if conn != nil {
						conn.Close()
					}
				}()
				if res, err := c.Get("http://" + l.Addr().String() + "/"); err == nil {
					res.Body.Close()
					t.Error("a connection to a non-loopback address was let through")
				}
				l.Close()
				break
			}
		}
	}
}
