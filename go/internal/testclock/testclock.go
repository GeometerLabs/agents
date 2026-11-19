// Package testclock is the clock for the runtime CONTRACT tests only (templates/commerce/listings/contract/), word for word modules/runtime/test-clock.ts: the owner-control rules
// wait 48 hours, a day, 15 minutes, and a test that starts the shop as a separate process cannot hand it a fake clock. So a test may ask, through the environment, for the
// machine's clock PLUS an offset read from a file it writes; moving the offset moves the shop's time while time itself keeps running.
//
//	GEOMETER_TEST=1  GEOMETER_TEST_CLOCK_FILE=<file holding one integer: milliseconds to add>      honoured ONLY when runtime.json says "mode": "fakes"
//
// Why this can never be on for a real shop, in three independent ways:
//  1. the deployer never sets either variable: every runtime container's environment is written out in full in bundle/generate/compose.ts, nothing is passed through;
//  2. a shop the panel makes is "mode": "live", and a test clock asked for in a live shop, or with NODE_ENV=production, or without GEOMETER_TEST=1, STOPS THE START with a
//     sentence: it is never quietly ignored, and never quietly honoured;
//  3. it is read only by the single-shop command line (cmd/listings), at start, and only when the file variable is set; otherwise the runtime's clock is the machine's.
//
// The directory (cmd/directory) reads it too, for the directory contract's golden answers, which are replayed at the instant they were recorded: there the third guard is that the
// directory listens on 127.0.0.1 only (the deployer gives it HOST=0.0.0.0), and the first two are the same.
package testclock

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The two variables, the same names the TypeScript runtime reads.
const (
	Switch = "GEOMETER_TEST"
	File   = "GEOMETER_TEST_CLOCK_FILE"
)

// Refused is a test clock asked for where it is not allowed: the start stops with this sentence.
type Refused struct{ Msg string }

func (e Refused) Error() string { return e.Msg }

var offsetText = regexp.MustCompile(`^-?\d{1,15}$`)

// FromEnv is the test clock the environment asks for (epoch milliseconds), or nil when it asks for none (the file variable unset or empty: the machine's clock, nothing read).
// `mode` is runtime.json's mode. A clock asked for where it is not allowed is a Refused error.
func FromEnv(getenv func(string) string, mode string) (func() int64, error) {
	file := getenv(File)
	if file == "" {
		return nil, nil
	}
	if getenv(Switch) != "1" {
		return nil, Refused{fmt.Sprintf("%s is set but %s is not 1: a test clock is for the contract tests only, so the shop does not start.", File, Switch)}
	}
	if getenv("NODE_ENV") == "production" {
		return nil, Refused{fmt.Sprintf("%s is set with NODE_ENV=production: a production shop never runs on a test clock, so it does not start.", File)}
	}
	if mode != "fakes" {
		return nil, Refused{fmt.Sprintf("%s is set for a shop in %q mode: only a \"fakes\" shop may run on a test clock, so it does not start.", File, mode)}
	}
	// the offset is read on every call (the test moves it while the shop runs); a read that fails (the file mid-write) keeps the last value, so time never jumps back
	var mu sync.Mutex
	var offset int64
	read := func() int64 {
		mu.Lock()
		defer mu.Unlock()
		if b, err := os.ReadFile(file); err == nil {
			if t := strings.TrimSpace(string(b)); offsetText.MatchString(t) {
				offset, _ = strconv.ParseInt(t, 10, 64)
			}
		}
		return offset
	}
	read()
	return func() int64 { return time.Now().UnixMilli() + read() }, nil
}
