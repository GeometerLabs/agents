package shared

// Waiting for Ctrl+C or SIGTERM, shared by the child's main (child.go).

import (
	"os"
	"os/signal"
	"syscall"
)

// waitSignal blocks until Ctrl+C or SIGTERM (or `also` is closed), then runs `then` (the step in hand finishes and the store is closed).
func waitSignal(also <-chan struct{}, then func()) error {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case <-stop:
	case <-also: // a nil channel never fires
	}
	then()
	return nil
}
