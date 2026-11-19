package runtime

// The shared runtime driving a template's Kit (template.go): one step (modules/runtime/core.ts `step`), the task that waits for its Guard and the one that ends without its work
// done (tasks.ts, guard-wait.ts, core.ts `endTask`), the status, and the events saved with the 24-hour window. The listings shop (no Kit) never comes here.
//
// A step builds a FRESH state from the last saved snapshot, runs the core's own kinds (a status report, the owner's sign-in lines, the limits' events) or hands the event to the
// template's agent, and saves the snapshot, the record lines and the task's mark in one transaction. An error throws the step away whole: nothing of it was saved.

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// guard-wait.ts GUARD_WAIT_MS and GUARD_LOOK_AGAIN_MS.
const guardWaitMs = 15 * 60_000

var guardLookAgainMs = []int64{2_000, 4_000, 8_000, 16_000, 30_000}

// kitRunner is tasks.ts's state for waiting: the Guard the head of the queue waits for (one line when found down, one when it answers), how many looks so far, and the Guards
// given up on in this outage (core.ts `givenUp`: tasks no longer wait for them until one answers).
type kitRunner struct {
	waitingOn string
	looks     int
	givenUp   map[string]bool
	wake      *time.Timer
}

func (r *Runtime) waitMs() int64 {
	if r.o.GuardWaitMs > 0 {
		return r.o.GuardWaitMs
	}
	return guardWaitMs
}

// nextLook is tasks.ts nextLook: a little later each time, up to the last delay.
func (r *Runtime) nextLook() int64 {
	looks := guardLookAgainMs
	if len(r.o.GuardLookAgainMs) > 0 {
		looks = r.o.GuardLookAgainMs
	}
	i := min(r.kitRun.looks, len(looks)-1)
	r.kitRun.looks++
	return looks[i]
}

// wakeAt starts the queue again at this time (tasks.ts wakeAt): armed fresh each time, so there is only ever one.
func (r *Runtime) wakeAt(atMs int64) {
	if r.kitRun.wake != nil {
		r.kitRun.wake.Stop()
	}
	d := time.Duration(max(atMs-r.o.Now(), 100)) * time.Millisecond
	r.kitRun.wake = time.AfterFunc(d, r.Kick)
}

// waitingTask is the drain's look at a task parked for its Guard: lastTry once its wait is over (it runs with waiting off), wait=true while its time to look again has not come
// (only that time, not an early kick, so a busy shop never loops).
func (r *Runtime) waitingTask(t *store.Task) (lastTry, wait bool) {
	if t.WaitingOn == nil {
		return false, false
	}
	if r.o.Now() >= t.Received+r.waitMs() {
		return true, false
	}
	if t.RetryAt != nil && r.o.Now() < *t.RetryAt {
		r.wakeAt(*t.RetryAt)
		return false, true
	}
	return false, false
}

// parked keeps a task waiting when its step found a Guard down (tasks.ts runTask): its try given back, the time to look again saved, the queue asleep until then.
func (r *Runtime) parked(id string, err error) bool {
	var w *WaitingForGuard
	if !errors.As(err, &w) {
		return false
	}
	delay := r.nextLook()
	if w.RetryAfterSeconds != nil {
		delay = max(int64(*w.RetryAfterSeconds)*1000, 1000)
	}
	if perr := r.o.Store.ParkTask(id, w.Service, r.o.Now()+delay, w.Msg); perr != nil {
		r.fail("The queue could not keep a task waiting for its Guard", perr)
	}
	if r.kitRun.waitingOn != w.Service {
		r.o.Log(fmt.Sprintf("The %s Guard cannot be reached or is not ready, so this shop's messages wait for it (at most %d minutes each): %s", w.Service, int(math.Round(float64(r.waitMs())/60_000)), w.Msg))
		r.kitRun.waitingOn = w.Service
	}
	r.wakeAt(r.o.Now() + delay)
	return true
}

// guardBack: a step went through, so a Guard that was being waited for answers again.
func (r *Runtime) guardBack() {
	if r.kitRun.waitingOn != "" {
		r.o.Log(fmt.Sprintf("The %s Guard answers again, so the queue goes on.", r.kitRun.waitingOn))
		r.kitRun.waitingOn, r.kitRun.looks = "", 0
	}
}

// stepTask runs a saved task's step.
func (r *Runtime) stepTask(ev map[string]any, taskID string, lastTry bool) error {
	if r.o.Kit == nil {
		return r.step(ev, taskID)
	}
	return r.kitStep(ev, taskID, lastTry)
}

// statusCtx is whose number a status report names.
func (r *Runtime) statusCtx() statusContext {
	number, lang := r.owner()
	ctx := statusContext{ownerNumber: number, ownerLanguage: lang}
	if ap, ok := r.o.Client.Settings.Raw["approvers"].(map[string]any); ok {
		if people, ok := ap["people"].([]any); ok {
			for _, p := range people {
				if m, ok := p.(map[string]any); ok {
					if w, ok := m["whatsapp"].(string); ok {
						ctx.approvers = append(ctx.approvers, w)
					}
				}
			}
		}
	}
	return ctx
}

// LicenceNow is the shop's licence now, for a template's reads (the page's `paused`).
func (r *Runtime) LicenceNow() string { return r.licenceNow() }

// licenceNow is the shop's licence as a step reads it: "" in order, "paused" in the wind-down, "stopped" in the final stop.
func (r *Runtime) licenceNow() string {
	switch r.licenceState(r.o.Now()) {
	case "wind_down":
		return "paused"
	case "stopped":
		return "stopped"
	}
	return ""
}

func (r *Runtime) stepContext(snap *Snap, rec *Recorder, taskID string, lastTry bool) *StepContext {
	return &StepContext{
		State: snap.T, Snap: snap, Rec: rec, Settings: &r.o.Client.Settings, Now: r.o.Now, Log: r.o.Log,
		Owner: r.owner, Licence: r.licenceNow, LastTry: lastTry, Task: taskID,
	}
}

// kitStep is core.ts `step` for a template: nil ev is the clock's beat.
func (r *Runtime) kitStep(ev map[string]any, taskID string, lastTry bool) (err error) {
	defer access.Recover(&err)
	r.stepSince.Store(r.o.Now())
	defer r.stepSince.Store(0)
	r.mu.RLock()
	text := r.snapshot
	r.mu.RUnlock()
	snap, err := ParseSnapKit(text, r.o.Kit)
	if err != nil {
		return err
	}
	rec := r.recorder()
	agent := r.o.Kit.NewAgent(r.stepContext(snap, rec, taskID, lastTry))
	var told []string
	if ev == nil {
		if err := agent.Tick(); err != nil {
			return err
		}
		if told, err = r.ownerBeat(rec); err != nil {
			return err
		}
	} else {
		switch ev["kind"] {
		case "message_status":
			st, _ := ev["status"].(map[string]any)
			recordMessageStatus(rec, st, r.statusCtx())
		case "owner_access":
			r.ownerAccess(rec, ev)
		case "limit_settled", "owner_limit":
			r.limitEvent(snap, rec, ev)
		default:
			if err := agent.Handle(ev); err != nil {
				var end *EndTask
				if errors.As(err, &end) && taskID != "" {
					return r.endTask(ev, taskID, end)
				}
				return err
			}
		}
	}
	if err := r.save(snap, rec, taskID); err != nil {
		return err
	}
	r.markTold(told)
	return nil
}

// endTask is core.ts endTask: a task whose step can neither wait nor run again ends here, once. A fresh state from the saved one, with its id counters kept where the thrown-away
// step left them (B75: those ids may already name a calendar hold or a payment link at a provider), then the to-do line (and the customer's words when they heard nothing) and the
// failed mark, in one transaction.
func (r *Runtime) endTask(ev map[string]any, taskID string, end *EndTask) error {
	if r.kitRun.givenUp == nil {
		r.kitRun.givenUp = map[string]bool{}
	}
	r.kitRun.givenUp[end.Service] = true
	r.mu.RLock()
	text := r.snapshot
	r.mu.RUnlock()
	snap, err := ParseSnapKit(text, r.o.Kit)
	if err != nil {
		return err
	}
	if end.Taken != nil {
		r.o.Kit.KeepCounters(snap.T, end.Taken)
	}
	rec := r.recorder()
	agent := r.o.Kit.NewAgent(r.stepContext(snap, rec, taskID, true))
	if err := agent.GiveUp(ev, end.Service, end.Tell); err != nil {
		r.o.Log("The note that a task gave up waiting for its Guard could not be written: " + err.Error())
	}
	after, err := snap.Serialize()
	if err != nil {
		return err
	}
	if err := r.o.Store.CommitStep(store.Step{TaskID: taskID, Snapshot: after, Entries: rec.fresh, NowMs: r.o.Now(), FailedWith: fmt.Sprintf("The %s Guard could not be reached, and the wait for it is over.", end.Service)}); err != nil {
		return err
	}
	r.mu.Lock()
	r.snapshot, r.snap = after, snap
	r.entries = append(r.entries, rec.fresh...)
	r.mu.Unlock()
	return nil
}

// SubmitKit saves events as tasks with the TypeScript's keys (events.go EventKey), and opens the 24-hour window for a message (store.ts saveEvents), all or nothing.
func (r *Runtime) SubmitKit(events []map[string]any) (saved, duplicates int, err error) {
	keys, kinds, payloads := make([]string, len(events)), make([]string, len(events)), make([]string, len(events))
	inbound := make([]*store.Inbound, len(events))
	for i, e := range events {
		b, err := json.Marshal(e)
		if err != nil {
			return 0, 0, err
		}
		keys[i], payloads[i] = EventKey(e), string(b)
		kinds[i], _ = e["kind"].(string)
		if kinds[i] == "message" {
			m, _ := e["message"].(map[string]any)
			from, _ := m["from"].(string)
			ts, _ := m["timestamp"].(float64)
			inbound[i] = &store.Inbound{Phone: from, AtMs: int64(ts)}
		}
	}
	return r.o.Store.SaveEventsInbound(keys, kinds, payloads, inbound, r.o.Now())
}

// kitStatus is core.ts status: counts only.
func (r *Runtime) kitStatus() (map[string]any, error) {
	counts, err := r.o.Store.TaskCounts()
	if err != nil {
		return nil, err
	}
	oldest, err := r.o.Store.OldestPendingAt()
	if err != nil {
		return nil, err
	}
	head, err := r.o.Store.NextPending()
	if err != nil {
		return nil, err
	}
	var oldestISO, waiting any
	if oldest != nil {
		oldestISO = iso(*oldest)
	}
	if head != nil && head.WaitingOn != nil {
		waiting = *head.WaitingOn
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var lastStep, lastFail any
	if r.lastStep != 0 {
		lastStep = iso(r.lastStep)
	}
	if r.lastFail != 0 {
		lastFail = iso(r.lastFail)
	}
	ai := r.snap.AI
	kit := r.o.Kit
	return map[string]any{
		"pathway": kit.Pathway(), "version": kit.Version(), kit.CasesName(): kit.CountCases(r.snap.T), "refunds": kit.Refunds(r.snap.T),
		"tasks": counts, "oldestPendingAt": oldestISO, "waitingForGuard": waiting, "lastStepAt": lastStep, "lastFailureAt": lastFail, "recordLength": len(r.entries),
		"steps": r.steps, "errors": r.errors, "startedAt": iso(r.started), "ai": budget.Summary(&ai, r.policy, r.clock, r.o.Now()),
	}, nil
}

// KitState is the last saved state's template part (a read: never changed by the caller).
func (r *Runtime) KitState() (KitState, *Snap, []store.Entry) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.snap.T, r.snap, r.entries
}

// FreshKitState is a fresh parse of the last saved state, for a read that may change what it is given (the channel's offer runs the agent's own free-time reading over it).
func (r *Runtime) FreshKitState() (KitState, error) {
	r.mu.RLock()
	text := r.snapshot
	r.mu.RUnlock()
	s, err := ParseSnapKit(text, r.o.Kit)
	if err != nil {
		return nil, err
	}
	return s.T, nil
}

// TaskState is one task's state by its key ("" when there is none).
func (r *Runtime) TaskState(key string) string {
	st, err := r.o.Store.TaskState(key)
	if err != nil {
		r.o.Log("A task's state could not be read: " + err.Error())
	}
	return st
}
