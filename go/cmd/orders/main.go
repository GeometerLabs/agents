// orders runs ONE Orders shop: the Go twin of templates/commerce/orders/server/main.ts (decision 61, wave W4). The shared runtime (internal/runtime) with the Orders template
// (internal/orders). Copied from cmd/bookings, less the calendar (Orders has none).
//
//	INTERNAL_TOKEN_FILE=token.txt CHANNEL_TOKEN_FILE=channel.txt RECORD_KEY_FILE=record.key orders --client <folder>
//	orders health <url>      one GET of the address (the container's health check: the image has no wget); exit 0 on a 200, else 1
//
// The folder, the token files, the environment and the test clock are the TypeScript runtime's, so a shop's folder starts on either runtime. A "live" shop refuses the test clock.
// Press Ctrl+C (or send SIGTERM) to stop: the step in hand finishes and the store is closed.
//
// What is wired: the start of the shop is runtime.Serve (serve.go) and the Kit's own wiring (the services, the owner's route, the report, the terms, voice,
// the reader of customers' words) is internal/orders wire.go since 25 Nov 2026, shared with go/cmd/parts (decision 65).
package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/health"
	"github.com/GeometerLabs/agents/go/internal/orders"
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
			fmt.Println("Usage: INTERNAL_TOKEN_FILE=<file> orders --client <folder>")
			return
		}
	}
	if len(args) != 2 || args[0] != "--client" || strings.HasPrefix(args[1], "--") {
		fmt.Fprintln(os.Stderr, "Say which client to run: --client <folder>")
		os.Exit(2)
	}
	if err := run(args[1]); err != nil {
		var ce runtime.ClientError
		if errors.As(err, &ce) {
			fmt.Fprintln(os.Stderr, ce.Error())
		} else {
			fmt.Fprintln(os.Stderr, "The agent could not start: "+err.Error())
		}
		os.Exit(1)
	}
}

func run(folder string) error {
	// the start of the shop (the folder, tokens, store, test clock, shop key, the runtime and its face) is runtime.Serve, and the Kit's own wiring internal/orders wire.go: both
	// shared with go/cmd/parts since 25 Nov 2026 (decision 65)
	return runtime.Serve(folder, &orders.Kit{}, runtime.ServeOptions{Label: "Orders agent", Noun: "shop"})
}
