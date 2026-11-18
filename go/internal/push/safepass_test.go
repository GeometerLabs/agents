package push

// A panic in a sender pass: contained when the host gave OnPanic, propagated when it did not (the single-shop binary's behaviour).

import "testing"

func TestSafePassHandsThePanicToTheHost(t *testing.T) {
	var got any
	s := &Sender{o: SenderOptions{OnPanic: func(p any) { got = p }}} // no store: Pass panics on its first line
	s.safePass()
	if got == nil {
		t.Fatal("the host was not told")
	}
}

func TestSafePassWithoutAHostPropagates(t *testing.T) {
	s := &Sender{o: SenderOptions{}}
	defer func() {
		if recover() == nil {
			t.Fatal("it must propagate")
		}
	}()
	s.safePass()
}
