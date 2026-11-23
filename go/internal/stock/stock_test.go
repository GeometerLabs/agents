package stock

// Tests of the one stock count (moved here from internal/listings with the count itself, 22 Nov 2026): what the contract cannot reach in a short run: the daily tidy and the prune of old keys (they depend on days passing), the keys keeping their order through a read and a
// write of a state the TypeScript runtime wrote, and an alias naming a line.

import (
	"encoding/json"
	"strings"
	"testing"
)

const tsStock = `{"lines":[{"id":"listing:l-1","name":"Kittens","count":3,"low":2,"lowFlag":false,"crossings":0,"aliases":["menu:kit"],` +
	`"applied":{"sale:o-9:listing:l-1":{"qty":2,"took":2,"atMs":1000},"delivery:p-1":{"qty":4,"took":4,"atMs":2000},"req:zz":{"qty":1,"took":0,"atMs":3000}},` +
	`"moves":[{"kind":"started","delta":5,"after":5,"atMs":10,"by":"owner"},{"kind":"sold","delta":-2,"after":3,"atMs":20,"by":"shop","short":1}],"startedMs":10}],` +
	`"alerts":[{"line":"listing:l-1","crossing":1,"count":2,"atMs":5,"asked":2}]}`

func TestStockRoundTripKeepsTypeScriptsMembersAndKeyOrder(t *testing.T) {
	var st Stock
	if err := json.Unmarshal([]byte(tsStock), &st); err != nil {
		t.Fatal(err)
	}
	st.Fix()
	out, _ := json.Marshal(&st)
	if string(out) != tsStock {
		t.Fatalf("the state did not come back as it was read:\n%s\n%s", out, tsStock)
	}
	if n, ok := st.Count("l-1"); !ok || n != 3 {
		t.Fatalf("count by id: %d %v", n, ok)
	}
	if st.LineOf("menu:kit") == nil {
		t.Fatal("an alias names its line")
	}
}

func TestTidyForgetsOldKeysAndAlerts(t *testing.T) {
	var st Stock
	_ = json.Unmarshal([]byte(tsStock), &st)
	st.Fix()
	st.Tidy(1500 + AppliedKeptMs)
	l := st.Lines[0]
	if _, ok := l.Applied.Get("sale:o-9:listing:l-1"); ok {
		t.Fatal("a key older than 120 days stays")
	}
	if _, ok := l.Applied.Get("delivery:p-1"); !ok {
		t.Fatal("a younger key went")
	}
	if len(st.Alerts) != 0 {
		t.Fatal("an alert over 30 days old stays")
	}
	var fresh Stock
	_ = json.Unmarshal([]byte(tsStock), &fresh)
	fresh.Tidy(5 + 30*day - 1)
	if len(fresh.Alerts) != 1 {
		t.Fatal("an alert just under 30 days old went")
	}
	fresh.Tidy(5 + 30*day)
	if len(fresh.Alerts) != 0 {
		t.Fatal("an alert 30 days old stays")
	}
	out, _ := json.Marshal(&st)
	if !strings.Contains(string(out), `"alerts":[]`) {
		t.Fatalf("an empty list is written as [], not null: %s", out)
	}
}

func TestPruneDropsOnlyOldKeysPastTheCapOldestFirst(t *testing.T) {
	l := Line{Applied: appliedMap{m: map[string]Applied{}}}
	now := int64(1000 * day)
	for i := 0; i < MaxApplied+3; i++ {
		l.Applied.set("k"+string(rune('a'+i%26))+string(rune('a'+i/26%26))+string(rune('a'+i/676)), Applied{AtMs: now - SafeKeepMs - int64(i)*1000})
	}
	l.prune(now)
	if len(l.Applied.keys) != MaxApplied {
		t.Fatalf("kept %d, want %d", len(l.Applied.keys), MaxApplied)
	}
	if _, gone := l.Applied.Get("kaaa"); !gone {
		// the oldest are the ones with the largest i: the first key stays
		t.Fatal("the newest of the old keys was dropped")
	}
	// keys younger than the safe horizon are never dropped, even past the cap
	l2 := Line{Applied: appliedMap{m: map[string]Applied{}}}
	for i := 0; i < MaxApplied+3; i++ {
		l2.Applied.set(string(rune(0x4e00+i)), Applied{AtMs: now})
	}
	l2.prune(now)
	if len(l2.Applied.keys) != MaxApplied+3 {
		t.Fatal("a key a fact can still name was dropped")
	}
}

func TestRestoreAfterYesOnlyAtZero(t *testing.T) {
	st := New()
	st.Start(Owner("owner"), "listing:l-1", StartInput{Count: 0}, 1)
	if st.RestoreAfterYes("l-2", 0, "c-1", 2) {
		t.Fatal("an uncounted listing was set")
	}
	if !st.RestoreAfterYes("l-1", 0, "c-1", 2) || st.Lines[0].Count != 1 {
		t.Fatal("a listing at 0 with no quantity goes to 1")
	}
	if st.RestoreAfterYes("l-1", 5, "c-2", 3) || st.Lines[0].Count != 1 {
		t.Fatal("a listing above 0 was changed")
	}
}
