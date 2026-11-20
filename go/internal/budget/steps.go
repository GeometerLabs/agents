package budget

// The pause on a model step that keeps failing (modules/understanding/ai-state.ts `pausedSteps`, `noteStep`): when only the decision model (step 1) is down and the language model
// (step 2) answers, every message would wait out the decision model's timeout and then pay step 2 anyway. So after `failures` failures within `windowMinutes` the decision model is
// left out for `pauseMinutes` and step 2 reads the message at once; the next message after the pause is a try, and a try that fails pauses it again at once.
//
// Kept in the month's AI state as `steps` (`AI.Steps`, raw JSON so a member this version does not know is carried through), field for field as TypeScript writes it:
// { "decision": { "fails": [ms...], "pausedUntilMs": ms, "announce": ["paused" | "resumed"] } }. Moments only, never a word of a message. The announcements are taken by a
// customer's reader (TakeAnnouncements, which writes them to the record, once each); the owner's reader never takes them.

import (
	"bytes"
	"encoding/json"
	"sort"
)

// Breaker is DEFAULT_BREAKER (runtime.json has no breaker of its own).
var Breaker = struct{ Failures, WindowMinutes, PauseMinutes int64 }{3, 15, 10}

// StepHealth is how one step has been doing.
type StepHealth struct {
	Fails         []int64  `json:"fails,omitempty"`
	PausedUntilMs *int64   `json:"pausedUntilMs,omitempty"`
	Announce      []string `json:"announce,omitempty"`
}

func readSteps(raw json.RawMessage) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	if len(bytes.TrimSpace(raw)) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

// PausedSteps is `pausedSteps`: the steps to leave out of the next message because their pause is running.
func PausedSteps(ai **AI, c Clock, nowMs int64) []string {
	steps := readSteps(For(ai, c, nowMs).Steps)
	var h StepHealth
	if json.Unmarshal(steps["decision"], &h) == nil && h.PausedUntilMs != nil && *h.PausedUntilMs > nowMs {
		return []string{"decision"}
	}
	return nil
}

// NoteStep is `noteStep`: the step was asked and answered (ok, even if unsure) or failed.
func NoteStep(ai **AI, step string, ok bool, c Clock, nowMs int64) {
	a := For(ai, c, nowMs)
	steps := readSteps(a.Steps)
	var was StepHealth
	_ = json.Unmarshal(steps[step], &was)
	pending := was.Announce
	var next StepHealth
	if ok {
		if was.PausedUntilMs != nil {
			pending = append(append([]string{}, pending...), "resumed")
		}
		next = StepHealth{Announce: pending}
	} else {
		var fails []int64
		for _, t := range was.Fails {
			if nowMs-t < Breaker.WindowMinutes*60_000 {
				fails = append(fails, t)
			}
		}
		fails = append(fails, nowMs)
		if len(fails) > 20 {
			fails = fails[len(fails)-20:]
		}
		tried := was.PausedUntilMs != nil // paused before, so this was the try after the pause
		if tried || int64(len(fails)) >= Breaker.Failures {
			if !tried {
				pending = append(append([]string{}, pending...), "paused")
			}
			until := nowMs + Breaker.PauseMinutes*60_000
			next = StepHealth{Fails: fails, PausedUntilMs: &until, Announce: pending}
		} else {
			next = StepHealth{Fails: fails, Announce: pending}
		}
	}
	b, _ := json.Marshal(next)
	steps[step] = b
	a.Steps = writeSteps(steps)
}

// writeSteps writes the steps' health back, by step name.
func writeSteps(steps map[string]json.RawMessage) json.RawMessage {
	keys := make([]string, 0, len(steps))
	for k := range steps {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out bytes.Buffer
	out.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			out.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		out.Write(kb)
		out.WriteByte(':')
		out.Write(steps[k])
	}
	out.WriteByte('}')
	return out.Bytes()
}

// StepEvent is ai-state.ts StepEvent: a step's pause or its resumption, to be put in the record once.
type StepEvent struct {
	Step, Event string
	UntilMs     *int64 // a pause: until when
}

// breakerSteps is ai-state.ts BREAKER_STEPS.
var breakerSteps = []string{"decision"}

// TakeAnnouncements is ai-state.ts takeAnnouncements: each step's pending pauses and resumptions, taken off the state so each is put in the record once.
func TakeAnnouncements(ai **AI, c Clock, nowMs int64) []StepEvent {
	a := For(ai, c, nowMs)
	steps := readSteps(a.Steps)
	var out []StepEvent
	for _, step := range breakerSteps {
		var h StepHealth
		if json.Unmarshal(steps[step], &h) != nil || len(h.Announce) == 0 {
			continue
		}
		for _, e := range h.Announce {
			ev := StepEvent{Step: step, Event: e}
			if e == "paused" && h.PausedUntilMs != nil {
				ev.UntilMs = h.PausedUntilMs
			}
			out = append(out, ev)
		}
		h.Announce = nil
		b, _ := json.Marshal(h)
		steps[step] = b
		a.Steps = writeSteps(steps)
	}
	return out
}

// TakeDayNotice is budget.ts `takeDayNotice`: true (and noted) the first time today a feature is told it reached its daily cap; false after.
func TakeDayNotice(ai **AI, feature string, c Clock, nowMs int64) bool {
	b := stateOf(ai, c, nowMs)
	day := c.Day(nowMs)
	if b.Told.Days[feature] == day {
		return false
	}
	if b.Told.Days == nil {
		b.Told.Days = map[string]string{}
	}
	b.Told.Days[feature] = day
	return true
}
