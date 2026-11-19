// Package health is the `health` subcommand of the shop programs. The program runs in an image that holds nothing but the program (FROM scratch: no shell, no wget), so Docker's
// health check cannot call a tool; it calls the program itself: `["CMD", "/listings", "health", "http://127.0.0.1:8780/readyz"]` (bundle/generate/compose.ts). It asks the address once
// and the exit code is the answer: 0 for a 200, 1 for anything else (no answer, a refusal, a slow answer). It is the Go twin of the `wget -q -O /dev/null` the Node image used.
package health

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// Wait is how long one check waits for an answer; compose's own health check timeout (3 s) is the outer limit.
const Wait = 3 * time.Second

// Check asks the address once (a plain GET, no token: /readyz and /healthz need none) and returns the process exit code, telling `say` the reason when it is 1.
func Check(url string, say func(string)) int {
	client := http.Client{Timeout: Wait}
	resp, err := client.Get(url)
	if err != nil {
		say("no answer from " + url + ": " + err.Error())
		return 1
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusOK {
		say(fmt.Sprintf("%s answered %d", url, resp.StatusCode))
		return 1
	}
	return 0
}
