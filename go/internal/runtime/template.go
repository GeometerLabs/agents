package runtime

// A template's part of the shared shop runtime: the Go twin of modules/runtime/core.ts `RuntimeKit` and `ChannelKit`. The runtime in this package is the one every shop runs (the
// queue, the one-at-a-time step saved whole or not at all, the record, the owner's sign-in, passkeys, phones, push, the limits page, the owner's file, the HTTP face); a template
// gives it what is its own: how its store is read and written, the agent that handles one event, how its cases are counted, how a held refund is found, and what its channels read.
//
// A runtime made with no Kit (Options.Kit nil) is the listings-only shop, exactly as before this file existed: its listings, stock and owner's assistant are this package's own
// code (the listings shop was the first runtime written in Go, wave 1). Bookings (internal/bookings, wave 2) is the first Kit; Orders and Fees follow it. The package never imports
// a template: a template imports this one and implements these interfaces.

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/store"
)

// Kit is a template's part (core.ts RuntimeKit).
type Kit interface {
	// Pathway and Version are what the folder's pathway.lock must name ("bookings", the number in the template's package.json).
	Pathway() string
	Version() string
	// CasesName is what /status calls the template's cases: "bookings".
	CasesName() string
	// ReadSettings checks settings.json the template's way (every problem in plain words, all at once) and fills the part every shop shares (name, time zone, owner, assistant,
	// languages). What it returns is the template's own settings, kept in Settings.Own.
	// raw is the file's bytes (a template may say its problems in the order the file names its keys).
	ReadSettings(in map[string]any, raw []byte, shared *Settings) (own any, errs []string)
	// ParseState reads the template's members of a saved snapshot (every top-level member but format, assistant and ai), in the order they were written; nil is a fresh store
	// (createStore). An error is a snapshot this version cannot read.
	ParseState(members []Member) (KitState, error)
	// NewAgent is the agent over one step's state (createAgent): it keeps nothing of its own between steps.
	NewAgent(c *StepContext) Agent
	// CountCases is the cases by state; a state with none is left out (countCases).
	CountCases(s KitState) map[string]int
	// Refunds is the refunds of the cases, counted (core.ts countRefunds over casesOf).
	Refunds(s KitState) RefundCounts
	// RefundContext is what the approvals relay may know of the refund held under this receipt; nil when none is held (refundContext).
	RefundContext(s KitState, sh *Settings, receipt string) any
	// SkipCounters moves every id counter on by gap (once, after a restore: restored.ts); KeepCounters puts every counter at least where `taken` (a thrown-away step's state) had
	// it, so an id that step gave out is never given out again (core.ts endTask, B75). It says whether anything moved.
	SkipCounters(s KitState, gap int64)
	KeepCounters(s KitState, taken KitState) bool
	// Channel is the template's channel reads (ChannelKit); nil: the shop has no booking page, API or owner's page beyond the shared routes.
	Channel() ChannelKit
	// Limits are the limits the owner may change (the template's chat-limits.ts declaration), with their values in the settings file (limitsdecl.go).
	Limits() []LimitDecl
}

// KitState is a template's store, parsed. Members writes it back in the codec's order; the members named "ai" and "assistant" are placeholders where the runtime puts the shared
// parts (the month's AI counts, the owner's assistant), so the snapshot's order is the TypeScript codec's (templates/commerce/bookings/server/snapshot.ts).
type KitState interface {
	Members() ([]Member, error)
}

// Member is one top-level member of a snapshot, as raw JSON (nil Raw: the member is left out, as the codec leaves out an optional field that is not set).
type Member struct {
	Name string
	Raw  json.RawMessage
}

// Agent handles one event of the template's own kinds, or the clock's beat, over the step's state (RunnableAgent). An event it cannot take yet returns ErrUnported (the task ends
// failed at once, with the sentence); a Guard found down returns a *WaitingForGuard (the task waits); a step that can neither wait nor run again returns an *EndTask.
type Agent interface {
	Handle(ev map[string]any) error
	Tick() error
	// GiveUp writes the to-do line for a task whose wait for its Guard is over, and with tell gives the customer the template's words for it (giveUp).
	GiveUp(ev map[string]any, service string, tell bool) error
}

// ChannelKit is what a template's channels read, each from the last saved state (core.ts ChannelKit). A read answers a value the route writes as JSON.
type ChannelKit interface {
	// Offer is the shop, its services and, for one service, its free starts; it may read the calendar.
	Offer(s KitState, q OfferQuery) (any, error)
	// View is one request by its handle's hash; nil when the saved state has none (the runtime then says whether its task waits).
	View(s KitState, handleHash string) any
	// Owner is what waits for the owner.
	Owner(s KitState, sn *Snap, entries []store.Entry) any
	// Documents are one page's case documents, newest first; nil when the template has none.
	Documents(s KitState, entries []store.Entry, handleHash, language string) ([]any, bool)
	// ChatWork is how many bookings a chat conversation has made.
	ChatWork(s KitState, conversation string) int
}

// OfferQuery is what the booking page asks for (core.ts OfferQuery).
type OfferQuery struct {
	ServiceID string
	FromDate  string
	Days      int
}

// RefundCounts is core.ts RefundCounts.
type RefundCounts struct {
	WaitingForOwner int            `json:"waitingForOwner"`
	BeingSentAgain  int            `json:"beingSentAgain"`
	NeedBuilder     map[string]int `json:"needBuilder"`
}

// NoRefunds is the counts of a store with none.
func NoRefunds() RefundCounts { return RefundCounts{NeedBuilder: map[string]int{"total": 0}} }

// StepContext is what a template's agent is given for one step.
type StepContext struct {
	State    KitState
	Snap     *Snap
	Rec      *Recorder
	Settings *Settings
	Now      func() int64
	Log      func(string)
	// Owner is the owner's number for this step (the effective one, read at every step: the settings' number, or the locked one while the shop is locked) and language.
	Owner func() (number, language string)
	// Licence is the shop's licence now: "" (in order), "paused" (the wind-down) or "stopped" (the final stop) (modules/licence/rules.ts state).
	Licence func() string
	// LastTry: the wait for a Guard is over, so this step runs with waiting off (tasks.ts lastTry).
	LastTry bool
	// Task is the step's task id ("" for a tick).
	Task string
	// rt is the runtime that made the step: a customer's talk (talkcustomer.go) asks it for the model, the budget and the clock. Unset in a step a test builds by hand.
	rt *Runtime
}

// ErrUnported is a kind of event this Go runtime does not take yet. The task ends failed at once (no retries: it would fail the same way), with the sentence in the task's error.
var ErrUnported = errors.New("the Go runtime does not take this kind of event yet")

// Unported says which event could not be taken.
func Unported(what string) error { return fmt.Errorf("%w: %s", ErrUnported, what) }

// WaitingForGuard is guard-wait.ts WaitingForGuard: a step found its Guard down and nothing of it was saved; the task waits for the Guard, its try given back.
type WaitingForGuard struct {
	Service           string
	RetryAfterSeconds *int
	Msg               string
}

func (w *WaitingForGuard) Error() string { return w.Msg }

// EndTask is core.ts endTask's reason: the step can neither wait nor run again (its wait is over, or a one-time call went out before the Guard was found down). Tell: the customer
// heard nothing from the step, so the template's words for it may be given.
type EndTask struct {
	Service string
	Tell    bool
	// Taken is the thrown-away step's state: its id counters are kept (B75).
	Taken KitState
}

func (e *EndTask) Error() string { return "the " + e.Service + " Guard could not be reached, and the wait for it is over" }
