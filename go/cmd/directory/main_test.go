// The directory program's two start-up helpers, carried over from bundle/test/directory-service.test.ts "its signing key ..." and the test-clock rules the TypeScript service had
// (bundle/services/directory.ts loadKey, and the refusals a test clock has outside the contract tests): loadKey makes directory.key with mode 0600 on the first start and reads the
// same key after; clockFrom gives the machine's clock unless a test clock is asked for, and refuses a test clock on a public address, without GEOMETER_TEST=1, or in production.
package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadKeyMakesItOnceWithMode0600(t *testing.T) {
	dir := t.TempDir()
	first, err := loadKey(dir)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "directory.key")
	st, err := os.Stat(file)
	if err != nil {
		t.Fatal("the key file was not made")
	}
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o, want 600", st.Mode().Perm())
	}
	second, err := loadKey(dir)
	if err != nil || second.KeyID != first.KeyID {
		t.Fatalf("the same key is read after: %v %v", err, second)
	}
}

func fakeEnv(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestClockFromRefusesATestClockWhereItIsNotAllowed(t *testing.T) {
	file := filepath.Join(t.TempDir(), "offset")
	if err := os.WriteFile(file, []byte("5000"), 0o600); err != nil {
		t.Fatal(err)
	}
	ok := map[string]string{"GEOMETER_TEST_CLOCK_FILE": file, "GEOMETER_TEST": "1", "HOST": "127.0.0.1"}
	with := func(over map[string]string) map[string]string {
		m := map[string]string{}
		for k, v := range ok {
			m[k] = v
		}
		for k, v := range over {
			m[k] = v
		}
		return m
	}
	for name, env := range map[string]map[string]string{
		"HOST=0.0.0.0":        with(map[string]string{"HOST": "0.0.0.0"}),
		"no GEOMETER_TEST=1":  with(map[string]string{"GEOMETER_TEST": ""}),
		"NODE_ENV=production": with(map[string]string{"NODE_ENV": "production"}),
	} {
		if clock, err := clockFrom(fakeEnv(env)); err == nil || clock != nil {
			t.Errorf("%s: must be refused", name)
		}
	}
	clock, err := clockFrom(fakeEnv(ok))
	if err != nil {
		t.Fatal(err)
	}
	if d := clock() - time.Now().UnixMilli(); d < 4000 || d > 7000 {
		t.Fatalf("the test clock runs 5 s ahead, got %d ms", d)
	}
}

func TestClockFromGivesTheMachinesClockWhenNoTestClockIsAsked(t *testing.T) {
	// even a public HOST is fine when no test clock is asked for
	clock, err := clockFrom(fakeEnv(map[string]string{"HOST": "0.0.0.0"}))
	if err != nil {
		t.Fatal(err)
	}
	if d := clock() - time.Now().UnixMilli(); d < -2000 || d > 2000 {
		t.Fatalf("the machine's clock, got %d ms off", d)
	}
}
