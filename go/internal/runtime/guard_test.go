package runtime

// The runner's panic containment (guarded, panicked): with a host's OnPanic a panic in a pass is handed to it and the loop lives on; without one it propagates, as the single-shop
// binary always did.

import "testing"

func TestGuardedHandsAPanicToTheHostAndLivesOn(t *testing.T) {
	var where string
	var got any
	r := &Runtime{o: Options{Log: func(string) {}, OnPanic: func(w string, v any) { where, got = w, v }}}
	r.stepSince.Store(5)
	r.guarded("drain", func() { panic("boom") })
	if where != "drain" || got != "boom" {
		t.Fatalf("the host was told %q %v", where, got)
	}
	if r.StepSince() != 0 {
		t.Fatal("a panicked step is no longer 'in hand'")
	}
	ran := false
	r.guarded("tick", func() { ran = true })
	if !ran {
		t.Fatal("a normal pass still runs")
	}
}

func TestGuardedWithoutAHostPropagatesThePanic(t *testing.T) {
	r := &Runtime{o: Options{Log: func(string) {}}}
	defer func() {
		if recover() == nil {
			t.Fatal("the single-shop binary does not swallow a panic")
		}
	}()
	r.guarded("drain", func() { panic("boom") })
}
