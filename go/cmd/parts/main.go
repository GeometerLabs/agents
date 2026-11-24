// parts runs ONE shop of several template parts behind one WhatsApp number (decision 65): the credit book, Stock orders and the pickup hold, or any of Fees, Orders and Stock
// orders together, over one store, one record, one stock count, one owner's sign-in and one assistant (internal/parts). There is no TypeScript twin: a shop of several parts
// is new, and every part is the template's own Go code, unchanged.
//
//	INTERNAL_TOKEN_FILE=token.txt CHANNEL_TOKEN_FILE=channel.txt RECORD_KEY_FILE=record.key parts --client <folder>
//	parts health <url>      one GET of the address (the container's health check: the image has no wget); exit 0 on a 200, else 1
//	parts get <url>         one GET, the body to standard output
//
// The folder, the token files, the environment and the test clock are every template program's (runtime.Serve). A panic inside one step is caught and said, and the runner goes
// on to the next task (OnPanic), so a part's bug that panics does not stop the other parts' work; the task that panicked is tried again as any failed task is, then failed.
package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/health"
	"github.com/GeometerLabs/agents/go/internal/parts"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

func main() {
	args := os.Args[1:]
	if len(args) == 2 && args[0] == "health" {
		os.Exit(health.Check(args[1], func(line string) { fmt.Fprintln(os.Stderr, line) }))
	}
	if len(args) == 2 && args[0] == "get" {
		os.Exit(health.Get(args[1], os.Stdout, func(line string) { fmt.Fprintln(os.Stderr, line) }))
	}
	for _, a := range args {
		if a == "--help" || a == "-h" {
			fmt.Println("Usage: INTERNAL_TOKEN_FILE=<file> parts --client <folder>")
			return
		}
	}
	if len(args) != 2 || args[0] != "--client" || strings.HasPrefix(args[1], "--") {
		fmt.Fprintln(os.Stderr, "Say which client to run: --client <folder>")
		os.Exit(2)
	}
	onPanic := func(where string, v any) {
		fmt.Printf("A panic in the %s was caught; the shop's other work goes on: %v\n", where, v)
	}
	if err := runtime.Serve(args[1], &parts.Kit{}, runtime.ServeOptions{Label: "Shop of several parts", Noun: "shop", OnPanic: onPanic}); err != nil {
		var ce runtime.ClientError
		if errors.As(err, &ce) {
			fmt.Fprintln(os.Stderr, ce.Error())
		} else {
			fmt.Fprintln(os.Stderr, "The agent could not start: "+err.Error())
		}
		os.Exit(1)
	}
}
