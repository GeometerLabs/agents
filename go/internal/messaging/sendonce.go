// Send once, for a message that COMMITS someone (send-once.ts, 17 Nov 2026): Stock orders' purchase order to a supplier and its reminder first. A repeat of an ordinary message is a
// nuisance; a repeat of a purchase order can mean goods delivered twice. A step saves only at its end, so a step that sends inside itself can die after WhatsApp took the message and
// before the save, and then runs again and sends it again. The protocol, in the TypeScript's words:
//
//  1. THE STEP DOES NOT SEND. It records an INTENT in the store (QueueSend): the message's id, who it goes to, the templates and the values, and the case. The step is saved whole.
//  2. AFTER THAT SAVE the runtime runs RunSendOnce: it writes the CLAIM (`claimed`, a record line `attempted`) and SAVES it; then it sends; then it writes the ENDING and saves that.
//  3. A claim with no ending is NEVER sent again: the next run finds it, cannot tell whether it went out, writes `unconfirmed` and sends nothing. A person decides.
//  4. Only `failed` (the provider or Guard said no BEFORE taking it: NothingWasSent) is tried again: after an hour, three tries in all, then `gave_up` and a person decides.
//  5. A person's "Send it again" on an unconfirmed message is a NEW intent made by their own press. "They got it" settles the old one without sending.
//
// The state is the store's own (SendOnceState, saved with the cases), so what is here is the logic over a state the runtime owns, with everything that touches the world (the clock, the
// record, the sender, the case, the owner, the save) in SendOnceDeps for the runtime to supply and a test to fake. A SendIntent keeps the members it does not know, so a state file
// moves between the TypeScript and Go runtimes and loses nothing (the project's rule); `values` is kept raw (numbers and strings, in their order).
package messaging

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// RetryAfterMs and MaxTries are send-once.ts RETRY_AFTER_MS and MAX_TRIES: after a refusal, how long before the next try, and how many tries in all.
const (
	RetryAfterMs int64 = Hour
	MaxTries           = 3
)

// NothingWasSent: did WhatsApp (or Guard in front of it) say no before anything was sent? Only then may the same message be sent again. A 5xx or a reply that is not understood can
// come after the message was taken, so those are never "nothing was sent". (`e instanceof ApiError && 400 <= status < 500`: a Guard refusal, a held call and a conflict are ApiErrors
// with their own 4xx, and a WindowClosedError is 400.)
func NothingWasSent(err error) bool {
	if guard.IsNotSent(err) {
		return true
	}
	if g, ok := guard.AsGuard(err); ok && g.Kind == guard.KindUnavailable {
		return true
	}
	st, ok := guard.IsAPI(err)
	return ok && st >= 400 && st < 500
}

// SendStatus is where an intent stands: queued, claimed, confirmed, unconfirmed, failed, gave_up or blocked.
type SendStatus = string

// SendEnding is how an intent ended, as the case's `settle` hears it: confirmed, unconfirmed, failed (not final), gave_up (final) or blocked.
type SendEnding = string

// SaidOutcome is how a message ended (say.ts): accepted, maybe, not_sent or held_back.
type SaidOutcome = string

// The SaidOutcome words.
const (
	Accepted SaidOutcome = "accepted"
	Maybe    SaidOutcome = "maybe"
	NotSent  SaidOutcome = "not_sent"
	HeldBack SaidOutcome = "held_back"
)

// SendIntent is one message asked for. Optional times and words are left out of the JSON when absent, and `lastTryMs` is a pointer because retryNow DELETES it: "no last try" is not 0.
type SendIntent struct {
	ID        string          `json:"id"`
	Kind      string          `json:"kind"`
	CaseID    string          `json:"caseId"`
	To        string          `json:"to"`
	ToName    string          `json:"toName"`
	Templates []string        `json:"templates"`
	Values    json.RawMessage `json:"values"` // numbers and short names only, kept as written
	CreatedMs int64           `json:"createdMs"`
	Status    SendStatus      `json:"status"`
	Tries     int             `json:"tries"`
	LastTryMs *int64          `json:"lastTryMs,omitempty"`
	EndedMs   *int64          `json:"endedMs,omitempty"`
	Note      string          `json:"note,omitempty"`
	Resolved  string          `json:"resolved,omitempty"` // owner_got_it | owner_send_again

	extra map[string]json.RawMessage // members this code does not know, carried through
}

type intentJSON SendIntent // the same fields without the methods, so the (un)marshalers do not call themselves

var intentKnown = map[string]bool{"id": true, "kind": true, "caseId": true, "to": true, "toName": true, "templates": true, "values": true, "createdMs": true, "status": true, "tries": true, "lastTryMs": true, "endedMs": true, "note": true, "resolved": true}

// UnmarshalJSON reads the known members and keeps the rest raw.
func (i *SendIntent) UnmarshalJSON(b []byte) error {
	var k intentJSON
	if err := json.Unmarshal(b, &k); err != nil {
		return err
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(b, &all); err != nil {
		return err
	}
	*i = SendIntent(k)
	i.extra = nil
	for name, raw := range all {
		if !intentKnown[name] {
			if i.extra == nil {
				i.extra = map[string]json.RawMessage{}
			}
			i.extra[name] = raw
		}
	}
	return nil
}

// MarshalJSON writes the known members in the TypeScript's order, then the unknown ones.
func (i SendIntent) MarshalJSON() ([]byte, error) {
	b, err := json.Marshal(intentJSON(i))
	if err != nil || len(i.extra) == 0 {
		return b, err
	}
	var order []struct {
		k string
		v json.RawMessage
	}
	for name, raw := range i.extra {
		order = append(order, struct {
			k string
			v json.RawMessage
		}{name, raw})
	}
	// a stable order for the unknown members (their relative order in the source file is not kept by a map)
	for a := 1; a < len(order); a++ {
		for c := a; c > 0 && order[c].k < order[c-1].k; c-- {
			order[c], order[c-1] = order[c-1], order[c]
		}
	}
	out := b[:len(b)-1]
	for _, o := range order {
		kb, _ := json.Marshal(o.k)
		out = append(out, ',')
		out = append(out, kb...)
		out = append(out, ':')
		out = append(out, o.v...)
	}
	return append(out, '}'), nil
}

// SendOnceState is the store's `sendOnce`: its intents, in order. Pointers, so a pass that queues another intent while it runs does not lose an update to a copy.
type SendOnceState struct {
	Intents []*SendIntent `json:"intents"`
}

// NextIntentID is the id the next intent of this kind for this case gets: "po-3:order:2" is the case's second purchase-order message (the owner's "Send it again").
func NextIntentID(s *SendOnceState, caseID, kind string) string {
	n := 0
	for _, i := range s.Intents {
		if i.CaseID == caseID && i.Kind == kind {
			n++
		}
	}
	return caseID + ":" + kind + ":" + strconv.Itoa(n+1)
}

// QueueSend records that a message is wanted. It is only a line in the store until the runtime sends it after the step's save. It returns nil when the id is already there.
func QueueSend(s *SendOnceState, i SendIntent) *SendIntent {
	for _, x := range s.Intents {
		if x.ID == i.ID {
			return nil
		}
	}
	i.Status, i.Tries = "queued", 0
	made := &i
	s.Intents = append(s.Intents, made)
	return made
}

// OpenUnknowns are the messages that may or may not have gone out and that nobody has dealt with yet (the owner's to-do list reads these). kind "" is any kind.
func OpenUnknowns(s *SendOnceState, kind string) []*SendIntent {
	out := []*SendIntent{}
	if s == nil {
		return out
	}
	for _, i := range s.Intents {
		if i.Status == "unconfirmed" && i.Resolved == "" && (kind == "" || i.Kind == kind) {
			out = append(out, i)
		}
	}
	return out
}

// ResolveUnknown is a person's word on an unconfirmed message ("owner_got_it" or "owner_send_again"). Only an unconfirmed, unresolved intent can be resolved, and only once. It sends
// nothing: "send again" is a new QueueSend. It returns nil when it did nothing.
func ResolveUnknown(s *SendOnceState, id, how string) *SendIntent {
	for _, i := range s.Intents {
		if i.ID == id {
			if i.Status != "unconfirmed" || i.Resolved != "" {
				return nil
			}
			i.Resolved = how
			return i
		}
	}
	return nil
}

// OpenRefusals are the messages the provider refused (nothing went out) that will be tried again: the owner is told at once, with the time of the next try.
func OpenRefusals(s *SendOnceState, kind string) []*SendIntent {
	out := []*SendIntent{}
	if s == nil {
		return out
	}
	for _, i := range s.Intents {
		if i.Status == "failed" && i.Tries < MaxTries && (kind == "" || i.Kind == kind) {
			out = append(out, i)
		}
	}
	return out
}

// NextTryMs is when a refused message is next tried by itself: `(lastTryMs ?? 0) + RETRY_AFTER_MS`.
func NextTryMs(i *SendIntent) int64 {
	if i.LastTryMs == nil {
		return RetryAfterMs
	}
	return *i.LastTryMs + RetryAfterMs
}

// RetryNow is the owner's "Try now" on a refused message: the SAME intent is due at the next run (no last try = nothing to wait for), and only while it is `failed` with tries left. It
// counts as a try, so the bound of three holds. nil when it did nothing.
func RetryNow(s *SendOnceState, id string) *SendIntent {
	for _, i := range OpenRefusals(s, "") {
		if i.ID == id {
			i.LastTryMs = nil
			return i
		}
	}
	return nil
}

// SendOnceDeps is everything RunSendOnce touches beside the state.
type SendOnceDeps struct {
	State *SendOnceState
	Now   func() int64
	// RecordClaim is the claim's record line (`attempted`), written before the claim is saved.
	RecordClaim func(i *SendIntent)
	// RecordEnding is an ending the sender did not write itself: a crash found, or a send that threw. (A send that returns has written its own line.)
	RecordEnding func(i *SendIntent, ending, note string)
	// Deliver sends it, exactly as the case's one way out (say) does, and says how it ended. It must not return an error for a refusal: that is NotSent.
	Deliver func(ctx context.Context, i *SendIntent) (SaidOutcome, error)
	// Settle moves the case on, synchronously, in the store. Saved together with the ending.
	Settle func(i *SendIntent, ending SendEnding)
	// Notify tells the owner after the ending is saved. Best effort: a crash here costs a message, never a duplicate order. nil: nobody is told.
	Notify func(ctx context.Context, i *SendIntent, ending SendEnding) error
	// Save saves the store and the record as they are now: after every claim and every ending.
	Save func()
	// Log is an optional line for the server's log.
	Log func(line string)
}

var endingOf = map[SaidOutcome]string{Accepted: "confirmed", Maybe: "unconfirmed", NotSent: "failed", HeldBack: "blocked"}

// due: is this intent waiting to be claimed: asked for and not tried, or refused and due again?
func due(i *SendIntent, now int64) bool {
	return i.Status == "queued" || (i.Status == "failed" && i.Tries < MaxTries && (i.LastTryMs == nil || *i.LastTryMs+RetryAfterMs <= now))
}

// finish writes an ending, moves the case, saves. It returns the ending the case heard (a third refusal is `gave_up`).
func finish(d SendOnceDeps, i *SendIntent, ending, note string) SendEnding {
	heard := ending
	if ending == "failed" && i.Tries >= MaxTries {
		heard = "gave_up"
	}
	if heard == "gave_up" {
		i.Status = "gave_up"
	} else {
		i.Status = ending
	}
	now := d.Now()
	i.EndedMs = &now
	if note != "" {
		i.Note = note
	}
	d.Settle(i, heard)
	d.Save()
	return heard
}

type told struct {
	intent *SendIntent
	ending SendEnding
}

func (d SendOnceDeps) log(line string) {
	if d.Log != nil {
		d.Log(line)
	}
}

// RunSendOnce is one pass: first the claims a dead process left (never sent again), then every intent that is due, each claimed and saved before it is sent and ended and saved after.
// Called by the runtime after each saved step and each tick. Both loops run over the intents that matched when the loop began (a pass that queues another does not send it in this pass).
func RunSendOnce(ctx context.Context, d SendOnceDeps) {
	var queue []told
	notify := func() {
		all := queue
		queue = nil
		for _, t := range all {
			if d.Notify == nil {
				continue
			}
			if err := d.Notify(ctx, t.intent, t.ending); err != nil {
				d.log("The owner could not be told that " + t.intent.ID + " ended as " + t.ending + " (" + err.Error() + "). It is on their list all the same.")
			}
		}
		if len(all) > 0 && d.Notify != nil {
			d.Save() // the words to the owner are in the record: keep them with the rest
		}
	}

	// ---- a claim with no ending: the process stopped somewhere between the claim and the ending. It may have gone out. It is never sent again.
	var claimed []*SendIntent
	for _, i := range d.State.Intents {
		if i.Status == "claimed" {
			claimed = append(claimed, i)
		}
	}
	for _, i := range claimed {
		note := "The process stopped while this message was being sent, so it may or may not have reached them. It is not sent again."
		d.RecordEnding(i, "unconfirmed", note)
		queue = append(queue, told{i, finish(d, i, "unconfirmed", note)})
		d.log("The message " + i.ID + " was being sent when the process stopped. It may or may not have gone out, and it will not be sent again by itself.")
	}

	// ---- the intents that are due, oldest first
	var dueNow []*SendIntent
	for _, i := range d.State.Intents {
		if due(i, d.Now()) {
			dueNow = append(dueNow, i)
		}
	}
	for _, i := range dueNow {
		// 1. claim, and save the claim before anything goes out
		i.Status = "claimed"
		i.Tries++
		now := d.Now()
		i.LastTryMs = &now
		d.RecordClaim(i)
		d.Save()
		// 2. send
		var ending, note string
		outcome, err := d.Deliver(ctx, i)
		if err != nil { // the sender writes its own line for what it catches; anything else that comes out of it is a send of unknown outcome unless it is a plain refusal
			if NothingWasSent(err) {
				ending = "failed"
			} else {
				ending = "unconfirmed"
			}
			note = err.Error()
			d.RecordEnding(i, ending, note)
		} else {
			ending = endingOf[outcome]
		}
		// 3. the ending, saved
		queue = append(queue, told{i, finish(d, i, ending, note)})
		if ending == "failed" {
			why := "the provider refused it" // `note ?? "..."`: only a missing note (a send that returned), not an empty one (a send that threw with no words)
			if err != nil {
				why = note
			}
			next := "That was the last try."
			if i.Tries < MaxTries {
				next = "It is tried again in an hour (try " + strconv.Itoa(i.Tries) + " of " + strconv.Itoa(MaxTries) + ")."
			}
			d.log("The message " + i.ID + " could not be sent (" + why + "). " + next)
		}
	}
	notify()
}
