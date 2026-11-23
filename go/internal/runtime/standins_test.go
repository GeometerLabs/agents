// The hand check's shop: runtime.json "standins" is honoured only for a fakes shop whose services are stand-ins on this machine (config.go standInsProblems).
package runtime

import (
	"strings"
	"testing"
)

// The hand check's shop (runtime.json "standins": "http") is a fakes shop whose services must be stand-ins on this machine: anything else is refused at start.
func TestStandInsProblems(t *testing.T) {
	ok := map[string]any{"payments": map[string]any{"baseUrl": "http://127.0.0.1:4100"}, "messaging": map[string]any{"baseUrl": "http://localhost:4101"}}
	if got := standInsProblems("http", "fakes", ok); len(got) != 0 {
		t.Fatalf("loopback stand-ins in a fakes shop were refused: %v", got)
	}
	for _, c := range []struct {
		name, mode, base string
		v                any
	}{
		{"a live shop", "live", "http://127.0.0.1:4100", "http"},
		{"another value", "fakes", "http://127.0.0.1:4100", "yes"},
		{"another host", "fakes", "http://example.com:4100", "http"},
		{"a host hidden after user info", "fakes", "http://127.0.0.1:1@elsewhere.example:80", "http"},
		{"https", "fakes", "https://127.0.0.1:4100", "http"},
		{"no port", "fakes", "http://127.0.0.1", "http"},
	} {
		got := standInsProblems(c.v, c.mode, map[string]any{"calendar": map[string]any{"baseUrl": c.base}})
		if len(got) == 0 {
			t.Errorf("%s was accepted", c.name)
		}
		if strings.Join(got, " ") == "" {
			t.Errorf("%s: no sentence", c.name)
		}
	}
}
