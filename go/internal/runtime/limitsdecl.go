package runtime

// The limits a template lets its owner change ("Limits, tightened by a tap"): the Go twin of modules/limits/chat-limits.ts (inForce, judgeChange, the starting values) and the
// declared part of runtime-limits.ts (the view's rows, the owner's own page's `owner_limit`). The listings shop declares none and keeps limits.go's behaviour; a template declares
// its limits through Kit.Limits (Bookings: the refund limit, templates/commerce/bookings/src/chat-limits.ts).
//
// The words (each kind's name and rule, `{v}` where the value goes) are GENERATED from modules/limits/chat-limit-kinds.ts LIMIT_WORDS by go/scripts/gen_limit_words.ts into
// limitwords/words.json, never typed here.

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"sync"
)

//go:embed limitwords/words.json
var limitWordsJSON []byte

var (
	limitWordsOnce sync.Once
	limitWords     map[string]struct {
		Name  map[string]string `json:"name"`
		Rule  map[string]string `json:"rule"`
		Words []string          `json:"words"` // the words that name it in the owner's message (the assistant's limit card)
	}
)

// LimitDecl is one declared limit (chat-limits.ts ChatLimit): its id, where it sits in the settings, its unit, which way is tighter, its kind's words, its value in the settings
// file when the runtime started (the base), and its hard bounds.
type LimitDecl struct {
	ID, Path, Unit, Tighter, Kind string
	ZeroIsOff                     bool
	File                          int64
	Min, Max                      int64
}

// limitChange is one saved change (chat-limits.ts LimitChange), read for the judging; the list itself is carried raw.
type limitChange struct {
	ID        string `json:"id"`
	Limit     string `json:"limit"`
	From      int64  `json:"from"`
	To        int64  `json:"to"`
	Direction string `json:"direction"`
	State     string `json:"state"`
}

// looseness is chat-limits.ts looseness: bigger is looser, whichever way the limit runs (a "zero is off" limit's 0 is the loosest).
func (l *LimitDecl) looseness(v int64) float64 {
	if l.ZeroIsOff && v == 0 {
		return math.Inf(1)
	}
	if l.Tighter == "lower" {
		return float64(v)
	}
	return -float64(v)
}

func (l *LimitDecl) strictlyTighter(inForce, proposed int64) bool {
	return l.looseness(proposed) < l.looseness(inForce)
}

// inForce is chat-limits.ts inForce: the file's value, moved by each active change from it, then by any pending tightening.
func (l *LimitDecl) inForce(changes []limitChange) int64 {
	v := l.File
	for _, c := range changes {
		if c.Limit == l.ID && c.State == "active" && c.From == v {
			v = c.To
		}
	}
	for _, c := range changes {
		if c.Limit == l.ID && c.State == "pending" && c.Direction == "tighten" && l.strictlyTighter(v, c.To) {
			v = c.To
		}
	}
	return v
}

// judge is chat-limits.ts judgeChange for a whole number.
func (l *LimitDecl) judge(changes []limitChange, to int64, direction string) (ok bool, why string, from int64) {
	from = l.inForce(changes)
	if direction == "tighten" {
		if (l.Tighter == "lower" && to < l.Min) || (l.Tighter != "lower" && to > l.Max) {
			return false, "out_of_bounds", from
		}
		if l.strictlyTighter(from, to) {
			return true, "", from
		}
		return false, "not_tighter", from
	}
	if to < l.Min || to > l.Max {
		return false, "out_of_bounds", from
	}
	for _, c := range changes {
		if c.Limit == l.ID && c.State == "pending" {
			return false, "busy", from
		}
	}
	if l.strictlyTighter(to, from) {
		return true, "", from
	}
	return false, "not_looser", from
}

func (r *Runtime) declared() []LimitDecl {
	if r.o.Kit == nil {
		return nil
	}
	return r.o.Kit.Limits()
}

func changesOf(raw json.RawMessage) []limitChange {
	var cs []limitChange
	_ = json.Unmarshal(raw, &cs)
	return cs
}

// limitRows is the view's `limits` (runtime-limits.ts view): each declared limit with its words, its value in force and its bounds.
func (r *Runtime) limitRows(changesRaw json.RawMessage) []any {
	decl := r.declared()
	if len(decl) == 0 {
		return []any{}
	}
	limitWordsOnce.Do(func() { _ = json.Unmarshal(limitWordsJSON, &limitWords) })
	changes := changesOf(changesRaw)
	rows := make([]any, 0, len(decl))
	for i := range decl {
		l := &decl[i]
		w := limitWords[l.Kind]
		rows = append(rows, map[string]any{
			"id": l.ID, "path": l.Path, "unit": l.Unit, "tighter": l.Tighter, "zeroIsOff": l.ZeroIsOff, "name": w.Name, "rule": w.Rule,
			"inForce": l.inForce(changes), "file": l.File, "bounds": map[string]any{"min": l.Min, "max": l.Max},
		})
	}
	return rows
}

// InForce is a declared limit's value in force now, from the saved changes (what the agent reads before every step: runtime-limits.ts apply); ok=false for a limit not declared.
func (r *Runtime) inForceIn(snap *Snap, id string) (int64, bool) {
	for _, l := range r.declared() {
		if l.ID == id {
			return l.inForce(changesOf(snap.assistant["limitChanges"])), true
		}
	}
	return 0, false
}

// ownerLimit is runtime-limits.ts run for an `owner_limit` from the owner's own page: a declared limit, the numbers decide the direction, and a change is kept pending with its
// record line; a change that is not allowed writes a "blocked" line and changes nothing.
func (r *Runtime) ownerLimit(snap *Snap, rec *recorder, ev map[string]any) {
	name, _ := ev["limit"].(string)
	var l *LimitDecl
	decl := r.declared()
	for i := range decl {
		if decl[i].ID == name {
			l = &decl[i]
		}
	}
	if l == nil {
		return // a limit the shop does not declare: nothing is changed and nothing is said
	}
	to := toInt(ev["to"])
	number, lang := r.owner()
	typed := changesOf(snap.assistant["limitChanges"])
	from := l.inForce(typed)
	direction := "loosen"
	if ok, _, _ := l.judge(typed, to, "tighten"); ok {
		direction = "tighten"
	}
	ok, why, _ := l.judge(typed, to, direction)
	if !ok {
		rec.append(NewLine{Conversation: number, Action: "limit_change", Outcome: "blocked", Inputs: map[string]any{"limit": l.ID}, Language: lang,
			Notes: fmt.Sprintf("the owner's page asked for %d, which is not allowed (%s): nothing was changed", to, why),
			Refs:  map[string]string{"limit": l.ID, "from": strconv.FormatInt(from, 10), "to": strconv.FormatInt(to, 10), "by": "owner_app", "why": why}})
		return
	}
	id, err := r.pushLimitChange(snap, l, from, to, direction, "owner_app")
	if err != nil {
		r.o.Log("A limit change could not be saved: " + err.Error())
		return
	}
	notes := "the owner loosened it in their app behind their passkey, within the template's bounds; it is Pending until Guard reports the new value, and the Operator is told, never asked"
	if direction == "tighten" {
		notes = "the owner tightened it in their app behind their passkey; the runtime obeys it now and the deployer is asked to put it where Guard's spec is made"
	}
	refs := map[string]string{"limit": l.ID, "path": l.Path, "change": id, "from": strconv.FormatInt(from, 10), "to": strconv.FormatInt(to, 10), "direction": direction, "by": "owner_app", "state": "pending"}
	rec.append(NewLine{Conversation: number, Action: "limit_change", Outcome: "unconfirmed", Inputs: map[string]any{"limit": l.ID, "change": id}, Language: lang, Notes: notes, Refs: refs})
}

// pushLimitChange keeps a new Pending change (chat-limits.ts LimitChange) in the assistant's list, by the owner's own page ("owner_app") or a card's tap ("owner_chat"), and gives
// its id. The list is carried raw, so every other change keeps its bytes.
func (r *Runtime) pushLimitChange(snap *Snap, l *LimitDecl, from, to int64, direction, by string) (string, error) {
	snap.ensureAssistant()
	var changes []map[string]any
	dec := json.NewDecoder(bytes.NewReader(snap.assistant["limitChanges"]))
	dec.UseNumber()
	_ = dec.Decode(&changes)
	id := snap.A.NextID("l")
	changes = append(changes, map[string]any{"id": id, "limit": l.ID, "path": l.Path, "from": from, "to": to, "direction": direction, "by": by, "state": "pending", "atMs": r.o.Now()})
	raw, err := marshalChanges(changes)
	if err != nil {
		return "", err
	}
	snap.assistant["limitChanges"] = raw
	return id, nil
}

func toInt(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case float64:
		return int64(x)
	case json.Number:
		n, _ := x.Int64()
		return n
	}
	return 0
}
