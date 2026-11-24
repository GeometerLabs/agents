// stock-orders runs ONE Stock orders shop: the Go twin of templates/commerce/stock-orders/server/main.ts (decision 61, wave 2). The shared runtime (internal/runtime) with the
// Stock orders template (internal/stockorders).
//
//	INTERNAL_TOKEN_FILE=token.txt CHANNEL_TOKEN_FILE=channel.txt RECORD_KEY_FILE=record.key stock-orders --client <folder>
//	stock-orders health <url>      one GET of the address (the container's health check); exit 0 on a 200, else 1
//
// The folder, the token files, the environment and the test clock are the TypeScript runtime's (and cmd/bookings'), so a shop's folder starts on either runtime. A "live" shop
// refuses the test clock, and a live shop must name its WhatsApp Guard (config.ts STOCK_SERVICES: the order goes to a supplier on it). Press Ctrl+C (or send SIGTERM) to stop.
package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/health"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stockorders"
)

func main() {
	args := os.Args[1:]
	if len(args) == 2 && args[0] == "health" {
		os.Exit(health.Check(args[1], func(line string) { fmt.Fprintln(os.Stderr, line) }))
	}
	for _, a := range args {
		if a == "--help" || a == "-h" {
			fmt.Println("Usage: INTERNAL_TOKEN_FILE=<file> stock-orders --client <folder>")
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
	// the start of the shop (the folder, tokens, store, test clock, shop key, the runtime and its face) is runtime.Serve, and the Kit's own wiring internal/stockorders wire.go:
	// both shared with go/cmd/parts since 25 Nov 2026 (decision 65)
	return runtime.Serve(folder, &stockorders.Kit{}, runtime.ServeOptions{Label: "Stock orders agent", Noun: "shop"})
}
