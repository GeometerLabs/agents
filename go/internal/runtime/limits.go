package runtime

// "Limits, tightened by a tap" for a listings-only shop (modules/limits/runtime-limits.ts, the routes in modules/runtime/http.ts): the owner's limits page (GET/POST
// /internal/channel/owner-limits) and the deployer's word about a change (GET/POST /internal/limit-changes).
//
// A listings shop declares NO limits (templates/commerce/listings/src/chat-limits.ts is an empty list), so the view is always `limits: []` and the changes are whatever the saved
// state's `assistant.limitChanges` holds (carried through raw: this runtime models none of their fields). The two events are still saved and run as steps, because that is what the
// TypeScript runtime does and what its record shows: a `limit_settled` for a change the store does not have (or one already settled) writes a `limit_change` line with outcome
// "blocked"; one for a pending change settles it; an `owner_limit` for a limit the shop does not declare changes nothing (the page cannot ask for more than the template allows).
//
// Statuses and bodies are the TypeScript routes': 401 for no internal token (limit-changes), 403 for no owner (owner-limits), 403 {state: "passkey_needed"} for a POST with a session
// that was not made with a passkey, 400 for a body of the wrong shape, 405 for another method (after the credential, as TypeScript checks), 413 past the body's bound.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/access"
)

var (
	limitID  = regexp.MustCompile(`^[a-z_]{1,40}$`)
	changeID = regexp.MustCompile(`^l-\d{1,9}$`)
)

// limitsView is what both routes answer: the limits (none) and the changes as saved; `passkey` only on the owner's page.
type limitsView struct {
	Limits  []any           `json:"limits"`
	Changes json.RawMessage `json:"changes"`
	Passkey *bool           `json:"passkey,omitempty"`
}

// LimitsView is modules/limits runtime-limits.ts `view`: no declared limits, the saved changes untouched (a copy of the list, so a caller never changes the state).
func (r *Runtime) limitsView() limitsView {
	changes := json.RawMessage("[]")
	if c, ok := r.current().assistant["limitChanges"]; ok && len(bytes.TrimSpace(c)) > 0 && string(bytes.TrimSpace(c)) != "null" {
		changes = c
	}
	return limitsView{Limits: []any{}, Changes: changes}
}

// squash is JavaScript's `text.replace(/\s+/gu, " ").trim()`.
func squash(s string) string {
	var b strings.Builder
	space := false
	for _, c := range s {
		if isSpace(c) {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(c)
	}
	return b.String()
}

// checkOwnerLimit is runtime-limits.ts `checkOwnerLimit`: {id, limit, to} with a whole number that JavaScript holds exactly.
func checkOwnerLimit(body any) (map[string]any, bool) {
	o, _ := body.(map[string]any)
	id, ok1 := o["id"].(string)
	limit, ok2 := o["limit"].(string)
	to, ok3 := o["to"].(float64)
	if !ok1 || !requestID.MatchString(id) || !ok2 || !limitID.MatchString(limit) || !ok3 || to != math.Trunc(to) || math.Abs(to) > 9007199254740991 {
		return nil, false
	}
	return map[string]any{"kind": "owner_limit", "id": id, "limit": limit, "to": int64(to)}, true
}

// checkSettled is runtime-limits.ts `checkSettled`: the deployer's word. The reason is plain words, cut to 160 letters (UTF-16 units, as JavaScript counts).
func checkSettled(body any) (map[string]any, bool) {
	o, _ := body.(map[string]any)
	id, ok1 := o["id"].(string)
	change, ok2 := o["change"].(string)
	result, _ := o["result"].(string)
	if !ok1 || !requestID.MatchString(id) || !ok2 || !changeID.MatchString(change) || (result != "active" && result != "failed") {
		return nil, false
	}
	ev := map[string]any{"kind": "limit_settled", "id": id, "change": change, "result": result}
	if why, ok := o["why"].(string); ok {
		if w := cut(squash(why), 160); w != "" {
			ev["why"] = w
		}
	}
	return ev, true
}

const settledShape = `Send {"id": a request id, "change": "l-3", "result": "active" or "failed", "why"?: words}.`

// limitChangesRoute is GET/POST /internal/limit-changes, the deployer's: the internal token first, then the method, as TypeScript does.
func (s *Server) limitChangesRoute(w http.ResponseWriter, r *http.Request) error {
	if !authorised(r, &s.token) {
		unauthorised(w)
		return nil
	}
	if r.Method == "GET" {
		send(w, 200, s.rt.limitsView())
		return nil
	}
	if err := only(r, "POST"); err != nil {
		return err
	}
	body, ok := readJSON(w, r, 4096)
	if !ok {
		return nil
	}
	ev, ok := checkSettled(body)
	if !ok {
		send(w, 400, errBody(settledShape))
		return nil
	}
	return s.submitAndAnswer(w, ev)
}

// ownerLimitsRoute is GET/POST /internal/channel/owner-limits: reading needs the owner's credential (link or session); CHANGING needs a session made with a PASSKEY, checked here against
// this runtime's own sessions (a link on WhatsApp is not enough: decision 27, loosening is outside the chat).
func (s *Server) ownerLimitsRoute(w http.ResponseWriter, r *http.Request) error {
	if !s.ownerAuthorised(r) {
		send(w, 403, errBody(ownerRefused))
		return nil
	}
	passkey := s.rt.PasskeySession(r.Header.Get(access.OwnerSessionHeader))
	if r.Method == "GET" {
		v := s.rt.limitsView()
		v.Passkey = &passkey
		send(w, 200, v)
		return nil
	}
	if err := only(r, "POST"); err != nil {
		return err
	}
	if !passkey {
		send(w, 403, map[string]any{"state": "passkey_needed", "error": "Changing a limit needs you signed in with your passkey."})
		return nil
	}
	body, ok := readJSON(w, r, 2048)
	if !ok {
		return nil
	}
	ev, ok := checkOwnerLimit(body)
	if !ok {
		send(w, 400, errBody(`Send {"id": a request id, "limit": a limit id, "to": a whole number}.`))
		return nil
	}
	return s.submitAndAnswer(w, ev)
}

// submitAndAnswer saves one event, says how many were saved, and lets the queue run.
func (s *Server) submitAndAnswer(w http.ResponseWriter, ev map[string]any) error {
	saved, dup, err := s.rt.Submit([]map[string]any{ev})
	if err != nil {
		return err
	}
	send(w, 200, map[string]any{"saved": saved, "duplicates": dup})
	s.rt.Kick()
	return nil
}

// ---- the steps -------------------------------------------------------------------------------------------------------------------------------------------

// ensureAssistant is state.ts `assistantOf`: the assistant's state made on first use (a store from before it has none), with its list of limit changes. Unlike Touch it does not make the
// listings: the TypeScript step for a limit event does not either.
func (s *Snap) ensureAssistant() {
	if s.assistant == nil {
		s.assistant = freshAssistant()
	}
	if c, ok := s.assistant["limitChanges"]; !ok || string(bytes.TrimSpace(c)) == "null" {
		s.assistant["limitChanges"] = json.RawMessage("[]")
	}
}

// limitEvent runs one of the two events (runtime-limits.ts `run`) for a shop that declares no limits.
func (r *Runtime) limitEvent(snap *Snap, rec *recorder, ev map[string]any) {
	snap.ensureAssistant() // TypeScript's run opens with assistantOf(store), whatever the event is
	if ev["kind"] != "limit_settled" {
		return // an owner_limit names a limit this shop does not declare: nothing is changed and nothing is said
	}
	number, lang := r.owner()
	id, _ := ev["change"].(string)
	result, _ := ev["result"].(string)
	var changes []map[string]any
	dec := json.NewDecoder(bytes.NewReader(snap.assistant["limitChanges"]))
	dec.UseNumber() // a change's numbers go back exactly as they came
	if dec.Decode(&changes) != nil {
		changes = nil
	}
	var c map[string]any
	for _, x := range changes {
		if x["id"] == id {
			c = x
		}
	}
	// a word about a change this store does not have, or one already settled, changes nothing (a redelivery, or a deployer that lost its place)
	if c == nil || c["state"] != "pending" {
		notes := "no such change: nothing was changed"
		if c != nil {
			notes = fmt.Sprintf("the change was already %v: nothing was changed", c["state"])
		}
		rec.append(NewLine{Conversation: number, Action: "limit_change", Outcome: "blocked", Inputs: map[string]any{"change": id}, Language: lang, Notes: notes, Refs: map[string]string{"change": id, "result": result}})
		return
	}
	c["state"], c["settledAtMs"] = result, r.o.Now()
	if why, ok := ev["why"].(string); ok && why != "" {
		c["why"] = why
	}
	raw, err := marshalChanges(changes)
	if err != nil {
		r.o.Log("A limit change could not be saved: " + err.Error())
		return
	}
	snap.assistant["limitChanges"] = raw
	outcome, notes := "confirmed", "Guard reported the new value: the change is Active"
	if result != "active" {
		outcome, notes = "failed", "the change did not go through: the previous limit is still in force, and the runtime dropped its tighter value"
	}
	refs := map[string]string{"limit": js(c["limit"]), "path": js(c["path"]), "change": js(c["id"]), "from": js(c["from"]), "to": js(c["to"]), "direction": js(c["direction"]), "by": js(c["by"]), "state": js(c["state"])}
	if w, ok := c["why"].(string); ok && w != "" {
		refs["why"] = w
	}
	rec.append(NewLine{Conversation: number, Action: "limit_change", Outcome: outcome, Inputs: map[string]any{"limit": c["limit"], "change": c["id"]}, Language: lang, Notes: notes, Refs: refs})
}

// js is JavaScript's String(value) for the few kinds a change holds (a missing member reads "undefined").
func js(v any) string {
	if v == nil {
		return "undefined"
	}
	return fmt.Sprint(v)
}

func marshalChanges(changes []map[string]any) (json.RawMessage, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if changes == nil {
		changes = []map[string]any{}
	}
	if err := enc.Encode(changes); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}
