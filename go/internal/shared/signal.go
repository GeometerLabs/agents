package shared

import (
	"os"
	"os/signal"
	"syscall"
)

// waitSignal blocks until Ctrl+C or SIGTERM, then runs `then` (the step in hand finishes and the store is closed).
func waitSignal(then func()) error {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	then()
	return nil
}
