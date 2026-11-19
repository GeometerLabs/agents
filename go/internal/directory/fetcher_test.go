// The directory's way out, carried over from bundle/test/directory-service.test.ts "its way out": this server's shops go through the door's own port with the pages domain as Host;
// anything else goes straight out and only to a public https name; a refused address is never called; an answer over the cap is "too big". No network: the two clients have a
// fake RoundTripper that records each request. Also addressAllowed and OriginProblem on their own (the door's rules for an outgoing address).
package directory

import (
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

type ttSeen struct {
	which, target, host, ifNoneMatch, body string
	contentLength                          int64
}

// ttTransport records each request and answers 200 with a body and some headers (one of them a cookie, which must not come back).
type ttTransport struct {
	which string
	log   *[]ttSeen
	body  string
}

func (tr ttTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	var b []byte
	if r.Body != nil {
		b, _ = io.ReadAll(r.Body)
	}
	*tr.log = append(*tr.log, ttSeen{tr.which, r.URL.String(), r.Host, r.Header.Get("If-None-Match"), string(b), r.ContentLength})
	h := http.Header{}
	h.Set("ETag", `"v1"`)
	h.Set("Content-Type", "application/json")
	h.Add("Set-Cookie", "session=1")
	return &http.Response{StatusCode: 200, Header: h, Body: io.NopCloser(strings.NewReader(tr.body)), Request: r}, nil
}

func TestFetcherItsWayOut(t *testing.T) {
	var log []ttSeen
	local := &http.Client{Transport: ttTransport{"door", &log, `{"ok":true}`}, CheckRedirect: noRedirect}
	remote := &http.Client{Transport: ttTransport{"direct", &log, `{"ok":true}`}, CheckRedirect: noRedirect}
	fetch := NewFetcher([]string{"pages.example", "old.example"}, "http://door:8798", local, remote)

	a, err := fetch("https://pages.example/rani-pets/listings.json?x=1", FetchRequest{Method: "GET", Headers: map[string]string{"accept": "application/json", "if-none-match": `"v1"`}, Timeout: time.Second, MaxBytes: 1_000_000})
	if err != nil {
		t.Fatal(err)
	}
	got := log[0]
	if got.which != "door" || got.target != "http://door:8798/rani-pets/listings.json?x=1" || got.host != "pages.example" || got.ifNoneMatch != `"v1"` {
		t.Fatalf("a served page must go to the door with the pages domain as Host: %+v", got)
	}
	if a.Status != 200 || a.Headers["etag"] != `"v1"` || a.Headers["content-type"] != "application/json" || a.Body != `{"ok":true}` {
		t.Fatalf("header names come back lower case and the body as text: %+v", a)
	}
	if _, bad := a.Headers["set-cookie"]; bad {
		t.Fatal("Set-Cookie must be dropped")
	}

	post := `{"format":"shop-check/1","ids":["l-3"]}`
	if _, err := fetch("https://pages.example/rani-pets/api/v1/check", FetchRequest{Method: "POST", Headers: map[string]string{"content-type": "application/json"}, Body: post, Timeout: time.Second, MaxBytes: 65536}); err != nil {
		t.Fatal(err)
	}
	if log[1].body != post || log[1].contentLength != int64(len(post)) || log[1].which != "door" {
		t.Fatalf("a POST carries its body and the right length: %+v", log[1])
	}

	if _, err := fetch("https://shops.example/s/ravi/listings.json", FetchRequest{Method: "GET", Timeout: time.Second, MaxBytes: 1_000_000}); err != nil {
		t.Fatal(err)
	}
	if log[2].which != "direct" || log[2].target != "https://shops.example/s/ravi/listings.json" {
		t.Fatalf("another public name goes out unchanged: %+v", log[2])
	}

	for _, bad := range []string{"https://10.0.0.5/x/listings.json", "https://localhost/x", "http://shops.example/x", "https://169.254.169.254/latest/meta-data", "https://shops.internal/x"} {
		_, err := fetch(bad, FetchRequest{Method: "GET", Timeout: time.Second, MaxBytes: 1000})
		if err == nil || !strings.Contains(err.Error(), "not an address the directory reads") {
			t.Fatalf("%s must be refused, got %v", bad, err)
		}
	}
	if len(log) != 3 {
		t.Fatalf("a refused address was never called: %d calls", len(log))
	}

	_, err = fetch("https://shops.example/s/ravi/listings.json", FetchRequest{Method: "GET", Timeout: time.Second, MaxBytes: 5})
	if err == nil || !strings.Contains(err.Error(), "too big") {
		t.Fatalf("an answer over MaxBytes is too big, got %v", err)
	}
}

// A redirect is not followed: the default clients use noRedirect, so a 302 is handed back as the answer (the TypeScript transport never followed one either).
func TestFetcherDoesNotFollowARedirect(t *testing.T) {
	calls := 0
	rt := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		h := http.Header{}
		h.Set("Location", "https://evil.example/")
		return &http.Response{StatusCode: 302, Header: h, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	c := &http.Client{Transport: rt, CheckRedirect: noRedirect}
	fetch := NewFetcher([]string{"pages.example"}, "http://door:1", c, c)
	res, err := fetch("https://shops.example/s/x/listings.json", FetchRequest{Method: "GET", Timeout: time.Second, MaxBytes: 1000})
	if err != nil || res.Status != 302 || calls != 1 {
		t.Fatalf("a redirect is an answer, not followed: %v %d calls=%d", err, res.Status, calls)
	}
	if res.Headers["location"] != "https://evil.example/" {
		t.Fatalf("location: %v", res.Headers)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestAddressAllowed(t *testing.T) {
	for _, ip := range []string{"10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fc00::1", "::ffff:10.0.0.1"} {
		if addressAllowed(net.ParseIP(ip)) {
			t.Errorf("%s must not be allowed", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "2606:4700::1"} {
		if !addressAllowed(net.ParseIP(ip)) {
			t.Errorf("%s must be allowed", ip)
		}
	}
}

func TestOriginProblem(t *testing.T) {
	cases := map[string]string{
		"https://shops.example":    "",
		"http://shops.example":     "not https",
		"https://10.0.0.5":         "an IP address, not a name",
		"https://localhost":        "not a public name",
		"https://shops.internal":   "not a public name",
		"https://printer.local":    "not a public name",
		"https://intranet":         "not a public name",
		"not an address":           "not an address",
		"https://[::1]:8443":       "an IP address, not a name",
		"https://SHOPS.example:99": "",
	}
	for in, want := range cases {
		if got := OriginProblem(in); got != want {
			t.Errorf("OriginProblem(%q) = %q, want %q", in, got, want)
		}
	}
}
