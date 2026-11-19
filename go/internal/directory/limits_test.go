// Per-address limits, carried over from modules/discovery/test/notices.test.ts "per-address limits are counted in memory ...": N requests are allowed and the next is refused; a
// minute later the window has reset; another address has its own count; a kind with no limit is always allowed; and old windows are swept so the memory stays small.
package directory

import "testing"

func TestLimiterWindow(t *testing.T) {
	var now int64
	lim := NewLimiter(map[string]Limit{"notice": {Max: 3, PerMs: 60_000}}, func() int64 { return now })
	var got []bool
	for i := 0; i < 4; i++ {
		got = append(got, lim.Take("notice", "203.0.113.9"))
	}
	if got[0] != true || got[1] != true || got[2] != true || got[3] != false {
		t.Fatalf("three allowed then refused: %v", got)
	}
	if !lim.Take("notice", "198.51.100.7") {
		t.Fatal("another address has its own count")
	}
	now = 61_000
	if !lim.Take("notice", "203.0.113.9") {
		t.Fatal("a minute later the window has reset")
	}
	if !lim.Take("unlisted kind", "x") {
		t.Fatal("a kind with no limit is allowed")
	}
}

func TestLimiterSweepsOldWindows(t *testing.T) {
	var now int64
	lim := NewLimiter(map[string]Limit{"notice": {Max: 3, PerMs: 60_000}}, func() int64 { return now })
	for _, who := range []string{"a", "b", "c", "d"} {
		lim.Take("notice", who)
	}
	if lim.Held() != 4 {
		t.Fatalf("held %d", lim.Held())
	}
	now = 200_000
	lim.Take("notice", "z")
	if lim.Held() > 1 {
		t.Fatalf("old windows are swept: held %d", lim.Held())
	}
}
