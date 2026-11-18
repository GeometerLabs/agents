package testclock

// The test clock is honoured only for a "fakes" shop with GEOMETER_TEST=1, and refused (the start stops) everywhere else it is asked for.

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestTheTestClockIsRefusedOutsideATest(t *testing.T) {
	file := filepath.Join(t.TempDir(), "clock")
	if now, err := FromEnv(env(map[string]string{}), "live"); now != nil || err != nil {
		t.Error("not asked for: the machine's clock, nothing read, no error")
	}
	for _, c := range []struct {
		env  map[string]string
		mode string
	}{
		{map[string]string{File: file}, "fakes"},                                        // no GEOMETER_TEST=1
		{map[string]string{File: file, Switch: "1"}, "live"},                            // a real shop
		{map[string]string{File: file, Switch: "1", "NODE_ENV": "production"}, "fakes"}, // a production marker
	} {
		if now, err := FromEnv(env(c.env), c.mode); now != nil || err == nil {
			t.Errorf("%v %s: must refuse to start", c.env, c.mode)
		} else if _, ok := err.(Refused); !ok {
			t.Errorf("a Refused sentence, not %T", err)
		}
	}
}

func TestTheOffsetIsReadOnEveryCallAndKeptWhenUnreadable(t *testing.T) {
	file := filepath.Join(t.TempDir(), "clock")
	_ = os.WriteFile(file, []byte("172800000\n"), 0o600)
	now, err := FromEnv(env(map[string]string{File: file, Switch: "1"}), "fakes")
	if err != nil || now == nil {
		t.Fatal(err)
	}
	if d := now() - time.Now().UnixMilli(); d < 172800000-1000 || d > 172800000+1000 {
		t.Errorf("48 hours ahead: %d", d)
	}
	_ = os.WriteFile(file, []byte("half a numb"), 0o600)
	if d := now() - time.Now().UnixMilli(); d < 172800000-1000 {
		t.Errorf("a file that does not read keeps the last offset: %d", d)
	}
	_ = os.WriteFile(file, []byte("0"), 0o600)
	if d := now() - time.Now().UnixMilli(); d > 1000 {
		t.Errorf("moved back to 0: %d", d)
	}
}
