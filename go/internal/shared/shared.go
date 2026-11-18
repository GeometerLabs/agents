// Package shared is the multi-shop host of the Go runtime: ONE process that holds many listings-only shops (the Go twin of modules/runtime/shared.ts, shared-pool.ts and
// templates/commerce/listings/server/shared-main.ts; decision 61: the Go process replaces the TypeScript shared process). Each shop is exactly what a single shop is (its own
// folder, store file, tokens, owner sign-in file and push store, built by internal/runtime); this package only FINDS the shops (a folder each), ROUTES `/shop/<name>/...` to the
// shop's own http.Handler, answers /healthz, /readyz and /shared/shops, and CONTAINS a shop that misbehaves. The host is generic over the small `Shop` interface, so the tests
// give it panicking and spinning fakes with tiny time constants; the shipped binary has no fault hooks.
//
// CRASH CONTAINMENT. Shops share one operating-system process, so one shop's failure must not become every shop's. Go gives less than the TypeScript pool of worker threads did:
// a goroutine cannot be stopped from outside, and there is no per-goroutine memory limit. What the host does instead is honest and simple:
//
//   - A PANIC in a request, in the shop's runner (a step or the clock) or in the push sender is recovered at that goroutine's own boundary (internal/runtime hands it to the
//     host through Options.OnPanic; the host's own request wrapper recovers anything else) and charged to that shop alone: one STRIKE. The runner's loop lives on.
//   - A SPINNING or stuck shop cannot be killed, so it is CONTAINED: a request that takes longer than RequestTimeout is answered 503 (Retry-After) and charged a strike, and its
//     goroutine is abandoned (and counted: it still holds what it holds); a watchdog looks at every runner every WatchEvery and a runner that has been inside ONE step for longer
//     than StuckAfter is charged a strike too (once per StuckAfter while it stays stuck). Other shops are never waited for: no lock of one shop is taken by another's request.
//   - The NUMBERS are shared-pool.ts's: 2 strikes within 30 minutes QUARANTINE a shop; 3 failures in quarantine within an hour PAUSE it; a pause lasts 6 hours, or until the
//     shop's files change (a new fingerprint is a clean sheet); strike memory is kept by shop name and fingerprint, and written to a small json file in the host's state dir, so it
//     survives a restart of the host.
//   - "QUARANTINE" in Go means: stop serving it IN THIS PROCESS. The shop is closed here and served from a CHILD PROCESS of the same binary (`listings-shared --one <shop>`).
//     A child is something the operating system CAN kill, so a child that panics, spins or is stuck simply exits (its own watchdog, or the parent's SIGKILL after a failed
//     /readyz), the exit is one failure, and the parent starts it again; the third failure within an hour pauses the shop ("back soon", named by the host: /readyz, /shared/shops
//     `paused`, `pausedDetail`, which is what the deployer reads), and it comes back after 6 hours on probation (two failures already counted).
//   - NEVER TWO OWNERS OF A STORE. A child is started ONLY after proof that the in-process copy let go: the shop's Close returned (its runner finished and its store is closed)
//     AND no request goroutine of that shop is still running (abandoned ones included). If that proof does not come within StopWait the shop is STRANDED: it answers "back soon",
//     is listed as paused with the reason, its name stays in /shared/shops, and it moves to a child only when the abandoned goroutine finally ends (the host looks), or at the next
//     start of the host, which reads the strike memory and starts a quarantined shop straight in a child (nothing in the new process holds its store). The same proof guards a
//     shop whose files changed: the new copy is not started while the old one still holds the store.
//   - A shop let go closes its store BEFORE /shared/shops stops naming it (a deployer must not move an open file): the shop's name is held until the release is proven.
//
// WHAT CANNOT BE RECOVERED. Go cannot recover from a stack overflow, running out of memory, a concurrent map write, a deadlock of every goroutine: each of those ends the WHOLE process and with it every shop in it. (The TypeScript pool turned an out-of-memory thread into a restart of one worker; Go has nothing like
// that.) The supervisor (the container's restart policy) brings the process back; the strike memory is not charged to anyone for such a death because nobody knows who it was.
// Quarantine in a child is the protection after the fact: a shop that keeps hurting the process is moved out only if it is caught by a recoverable fault (a panic, a timeout, a
// stuck step), and a shop that causes a fatal fault is a risk to every shop in the process until it is paused by hand (remove its folder, or its lock file).
// Also fatal: a panic in a goroutine of the shop's code that no guard wraps (internal/runtime guards its request, runner and push-sender goroutines; any goroutine added later
// must be guarded the same way, or one panic there ends every shop). os.Exit and log.Fatal in shop code end the process too (runtime.Goexit only ends its own goroutine).
// Not contained either: a shop that is only SLOW but under the deadlines, or that eats memory slowly (no per-shop limit exists); the host's memory is the container's limit.
package shared

import (
	"net/http"
	"regexp"
	"time"
)

// ShopName is a shop's name, as everywhere (fleet's page slugs, the compose names): lower case letters, digits and dashes.
var ShopName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)

// Paths is where one shop's files are. The tokens are FILES, handed to the shop's own start, never read from this process's environment (that would give every shop the same token).
type Paths struct {
	Name, ClientFolder, TokenFile, ChannelTokenFile, RecordKeyFile string
}

// Source says where the shops are and when one is complete (folderSource in shared.ts is the real one; a test gives its own).
type Source interface {
	List() []string
	Paths(name string) Paths
	// Ready: is the shop's folder complete? The deployer writes pathway.lock LAST, so a folder with a lock is a folder whole.
	Ready(name string) bool
	// Fingerprint is a short text that changes when the files that decide how the shop runs change: that shop is restarted on its own, the others untouched.
	Fingerprint(name string) string
}

// Shop is what the host needs of a started shop. The real one wraps internal/runtime (goshop.go); the tests give fakes.
type Shop interface {
	// Handler is the shop's routes ("/readyz", "/internal/channel/...", the path as the shop itself would see it, without the "/shop/<name>" prefix).
	Handler() http.Handler
	// Ready: would the shop's /readyz say 200 (its store can be read, its queue is going)?
	Ready() bool
	// StepSince is when the runner's step in hand began (Unix ms), 0 between steps. A step that has lasted long is a stuck one.
	StepSince() int64
	// Close finishes the step in hand, stops the runner and closes the store. It returns when the store is released. It may never return (a stuck step): the host does not wait for it.
	Close()
}

// Hooks are what the host gives a shop when it starts it.
type Hooks struct {
	// Log writes a line, already marked with the shop's name.
	Log func(string)
	// OnPanic is told of a recovered panic in the shop's own goroutines (a request, the runner, the push sender): the host charges it to this shop.
	OnPanic func(where string, v any)
}

// Starter starts one shop from its folder and token files. The shop's HTTP face has NO listener of its own: the host routes to Shop.Handler.
type Starter func(p Paths, h Hooks) (Shop, error)

// Child is a shop served from a process of its own, on a loopback port.
type Child interface {
	Port() int
	// Done is closed when the process has exited (and so released everything it held).
	Done() <-chan struct{}
	// Stop asks the process to finish (SIGTERM) and kills it after grace; it returns when the process is gone.
	Stop(grace time.Duration)
}

// Spawner starts a child for one shop. The real one runs `<this binary> --one <shop>`; a test gives a fake.
type Spawner interface {
	Spawn(name string) (Child, error)
}

// Limits are every number of the containment, named, with the reason (the strike numbers are shared-pool.ts's). Tests shrink them to tens of milliseconds.
type Limits struct {
	StrikeWindow        time.Duration // 30 min: a strike is forgotten after this long; one bad request is bad luck, two close together is the shop
	StrikesToQuarantine int           // 2
	QuarantineWindow    time.Duration // 1 hour: failures in quarantine within this long pause the shop
	FailuresToPause     int           // 3: it had a process of its own and still failed again and again
	Pause               time.Duration // 6 hours: long enough to stop the churn, short enough that nobody has to remember it
	RequestTimeout      time.Duration // 10 s (PROXY_TIMEOUT_MS): listing pages are quick; a hang must never hold a visitor for the front's whole minute
	StuckAfter          time.Duration // 60 s: a runner inside one step this long is stuck. Not the TypeScript 10 s: there a step waiting on the model did not block the loop, here it is inside the step the whole time, and a model call may last its timeout (12 s by default, more when runtime.json says so). A spinning step in Go only burns a core and holds nobody else up, so slow detection costs little
	WatchEvery          time.Duration // 2 s (PING_MS)
	StopWait            time.Duration // 10 s: how long a shop may take to let go of its store before it is called stranded
	StartWait           time.Duration // 30 s: how long a shop (or a child) may take to start
	ChildDelay          time.Duration // 250 ms: the wait before a child that exited is started again; doubles with each failure in a row, up to 30 s
	Backoff             time.Duration // 5 s: the first wait before a shop that failed to start is tried again; doubles up to 5 min
}

// DefaultLimits are the shipped numbers.
func DefaultLimits() Limits {
	return Limits{
		StrikeWindow: 30 * time.Minute, StrikesToQuarantine: 2, QuarantineWindow: time.Hour, FailuresToPause: 3, Pause: 6 * time.Hour,
		RequestTimeout: 10 * time.Second, StuckAfter: 60 * time.Second, WatchEvery: 2 * time.Second, StopWait: 10 * time.Second, StartWait: 30 * time.Second,
		ChildDelay: 250 * time.Millisecond, Backoff: 5 * time.Second,
	}
}

func (l Limits) filled() Limits {
	d := DefaultLimits()
	if l.StrikeWindow == 0 {
		l.StrikeWindow = d.StrikeWindow
	}
	if l.StrikesToQuarantine == 0 {
		l.StrikesToQuarantine = d.StrikesToQuarantine
	}
	if l.QuarantineWindow == 0 {
		l.QuarantineWindow = d.QuarantineWindow
	}
	if l.FailuresToPause == 0 {
		l.FailuresToPause = d.FailuresToPause
	}
	if l.Pause == 0 {
		l.Pause = d.Pause
	}
	if l.RequestTimeout == 0 {
		l.RequestTimeout = d.RequestTimeout
	}
	if l.StuckAfter == 0 {
		l.StuckAfter = d.StuckAfter
	}
	if l.WatchEvery == 0 {
		l.WatchEvery = d.WatchEvery
	}
	if l.StopWait == 0 {
		l.StopWait = d.StopWait
	}
	if l.StartWait == 0 {
		l.StartWait = d.StartWait
	}
	if l.ChildDelay == 0 {
		l.ChildDelay = d.ChildDelay
	}
	if l.Backoff == 0 {
		l.Backoff = d.Backoff
	}
	return l
}
