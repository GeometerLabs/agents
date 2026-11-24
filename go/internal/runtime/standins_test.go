// The hand check's shop: runtime.json "standins" is honoured only for a fakes shop whose every address is this machine, written as an address (config.go standInsProblems);
// this ships in the production program, so each way out is tried here.
package runtime

import (
	"testing"
)

func TestStandInsProblems(t *testing.T) {
	ok := map[string]any{"payments": map[string]any{"baseUrl": "http://127.0.0.1:4100"}, "messaging": map[string]any{"baseUrl": "http://[::1]:4101/v1"}}
	if got := standInsProblems("http", "fakes", ok, map[string]any{"parser": map[string]any{"baseUrl": "http://127.0.0.1:4102/v1"}}); len(got) != 0 {
		t.Fatalf("loopback stand-ins in a fakes shop were refused: %v", got)
	}
	for _, c := range []struct {
		name, mode, base string
		v                any
	}{
		{"a live shop", "live", "http://127.0.0.1:4100", "http"},
		{"another value", "fakes", "http://127.0.0.1:4100", "yes"},
		{"another host", "fakes", "http://example.com:4100", "http"},
		{"localhost, a name that may resolve anywhere", "fakes", "http://localhost:4100", "http"},
		{"0.0.0.0", "fakes", "http://0.0.0.0:4100", "http"},
		{"another IPv6 address", "fakes", "http://[fe80::1]:4100", "http"},
		{"an IPv6 address that maps an outside one", "fakes", "http://[::ffff:8.8.8.8]:4100", "http"},
		{"a look-alike host", "fakes", "http://127.0.0.1.example.com:4100", "http"},
		{"another 127 address written short", "fakes", "http://127.1:4100", "http"},
		{"a host hidden after user info", "fakes", "http://127.0.0.1:1@elsewhere.example:80", "http"},
		{"https", "fakes", "https://127.0.0.1:4100", "http"},
		{"no port", "fakes", "http://127.0.0.1", "http"},
	} {
		if got := standInsProblems(c.v, c.mode, map[string]any{"calendar": map[string]any{"baseUrl": c.base}}, map[string]any{}); len(got) == 0 {
			t.Errorf("%s was accepted", c.name)
		}
	}
	if got := standInsProblems("http", "fakes", map[string]any{}, map[string]any{"decision": map[string]any{"baseUrl": "https://api.example.com"}}); len(got) == 0 {
		t.Error("a model elsewhere was accepted")
	}
	if got := standInsProblems("http", "fakes", map[string]any{"push": map[string]any{"baseUrl": "http://push.example:80"}}, map[string]any{}); len(got) == 0 {
		t.Error("a push Guard elsewhere was accepted")
	}
}

// A hand-check shop may beat faster than a real one (down to 0.1 s); a real shop keeps the one-second floor.
func TestStandInsBeat(t *testing.T) {
	for _, c := range []struct {
		in      map[string]any
		want    float64
		because string
	}{
		{map[string]any{"mode": "fakes", "standins": "http", "tickSeconds": 0.2}, 0.2, "the hand check's beat"},
		{map[string]any{"mode": "fakes", "standins": "http", "tickSeconds": 0.05}, 30, "below 0.1 s: the default"},
		{map[string]any{"mode": "fakes", "tickSeconds": 0.2}, 30, "a fakes shop without stand-ins keeps the one-second floor"},
	} {
		cl := &Client{Folder: t.TempDir()}
		_ = cl.readRuntime(c.in)
		if cl.Config.TickSeconds != c.want {
			t.Errorf("%s: tickSeconds %v, want %v", c.because, cl.Config.TickSeconds, c.want)
		}
	}
}
