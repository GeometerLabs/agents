// Package health is the `health` and `get` subcommands of the shop programs. The program runs in an image that holds nothing but the program (FROM scratch: no shell, no wget), so Docker's
// health check cannot call a tool; it calls the program itself: `["CMD", "/listings", "health", "http://127.0.0.1:8780/readyz"]` (bundle/generate/compose.ts). It asks the address once
// and the exit code is the answer: 0 for a 200, 1 for anything else (no answer, a refusal, a slow answer). It is the Go twin of the `wget -q -O /dev/null` the Node image used. `get <url>` is the same ask with the answer printed: the deployer asks the shared process which shops it holds
// (`/shared/shops`) from inside its container, where there is no wget either (bundle/lib/listings-move.ts).
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
func Check(url string, say func(string)) int { return Get(url, io.Discard, say) }

// Get is Check that copies the answer's body to out (a 200 only is exit 0).
func Get(url string, out io.Writer, say func(string)) int {
	client := http.Client{Timeout: Wait}
	resp, err := client.Get(url)
	if err != nil {
		say("no answer from " + url + ": " + err.Error())
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		say(fmt.Sprintf("%s answered %d", url, resp.StatusCode))
		return 1
	}
	_, _ = io.Copy(out, resp.Body)
	return 0
}
