// Package assistant is the owner's assistant for a listings-only shop: its state (the cards, the talk, the undo records), the card binding (the digest, the judge), the owner's words
// read by rule, what the page shows, and the words it says in four languages. The Go twin of modules/assistant (state.ts, cards.ts, intents*.ts, app/view.ts, mood.ts); the runtime
// package runs it inside a step and writes the record lines.
//
// This file is state.ts: the assistant's own part of the shop's snapshot (`assistant` in the saved JSON). Every member the TypeScript state has is carried:
//
//   - the ones this package works on are typed (seq, cards, refused, closedDays, undo, talk, chat);
//   - `limitChanges`, `listings`, `stock` and `memory` belong to other parts of the runtime and stay raw JSON here (the runtime's own code reads them);
//   - a member this version has never heard of stays raw, and so does a member of a card, an action, an undo record or a talk line that it does not know, so a shop that goes back
//     to the TypeScript runtime (or on to a newer Go one) loses nothing by a spell here.
//
// `seq` is ONE counter for the cards ("c-3"), the undo records ("u-2") and (TypeScript only today) the limit changes: never given twice, so a record line names one thing.
package assistant

import (
	"bytes"
	"encoding/json"
	"sort"
)

// Raw is a JSON object kept as its members' raw text.
type Raw = map[string]json.RawMessage

// Action is what a card does on a yes: the skill, the case and the exact fields the skill read from its store (cards.ts CardAction). Immutable once the card is made. A field is a
// string, a number or a boolean; it is kept as raw JSON so a number written by TypeScript digests exactly as it was written.
type Action struct {
	Kind   string
	Skill  string
	Case   string
	Fields Raw
	Extra  Raw
}

// Card is one card (state.ts CardRecord). The states are open, done, refused, void and expired.
type Card struct {
	ID          string
	CodeHash    string
	Action      Action
	Proposal    Raw
	Digest      string
	State       string
	CreatedAtMs int64
	ExpiresAtMs int64
	ClosedAtMs  *int64
	ReplacedBy  string
	Question    string
	Extra       Raw
}

// Refused is a no that is final for 24 hours.
type Refused struct {
	Digest string
	AtMs   int64
	Card   string
	Extra  Raw
}

// Undo is what can still be undone (state.ts UndoRecord). A listings-only shop makes none itself (it closes no day and moves no booking); the TypeScript runtime's "remember" does.
type Undo struct {
	ID      string
	Kind    string
	Skill   string
	Date    string
	Asked   []string
	Case    string
	HasCase bool
	FromMs  *int64
	ToMs    *int64
	AtMs    int64
	UntilMs int64
	Done    bool
	HasDone bool
	Extra   Raw
}

// TalkLine is one line of the owner's talk in the app (newest last).
type TalkLine struct {
	AtMs  int64
	From  string // "owner" or "assistant"
	Text  string
	Extra Raw
}

// State is the assistant's part of a snapshot.
type State struct {
	Seq        int64
	Cards      []Card
	Refused    []Refused
	ClosedDays []string
	Undo       []Undo
	Talk       []TalkLine
	// Chat is the talk turns kept for the prompt (left out until the first talk: nil means the member is absent).
	Chat []TalkLine
	// Rest is every member this package does not model: limitChanges, listings, stock, memory, and any member a later version adds. The runtime reads and writes the ones it owns.
	Rest Raw
}

// Fresh is what the TypeScript runtime makes on first use (state.ts emptyAssistantState).
func Fresh() *State {
	return &State{Cards: []Card{}, Refused: []Refused{}, ClosedDays: []string{}, Undo: []Undo{}, Talk: []TalkLine{}, Rest: Raw{"limitChanges": json.RawMessage("[]")}}
}

// ---- reading and writing --------------------------------------------------------------------------------------------------------------------------------

// extras returns the members of an object that are not in `known`.
func extras(o Raw, known ...string) Raw {
	var out Raw
	for k, v := range o {
		skip := false
		for _, n := range known {
			skip = skip || n == k
		}
		if !skip {
			if out == nil {
				out = Raw{}
			}
			out[k] = v
		}
	}
	return out
}

func str(o Raw, k string) string {
	var s string
	if v, ok := o[k]; ok {
		_ = json.Unmarshal(v, &s)
	}
	return s
}

func i64(o Raw, k string) int64 {
	var n float64
	if v, ok := o[k]; ok {
		_ = json.Unmarshal(v, &n)
	}
	return int64(n)
}

func optI64(o Raw, k string) *int64 {
	v, ok := o[k]
	if !ok || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
		return nil
	}
	n := i64(o, k)
	return &n
}

func obj(v json.RawMessage) Raw {
	var o Raw
	_ = json.Unmarshal(v, &o)
	return o
}

func jstr(s string) json.RawMessage { b, _ := marshal(s); return b }
func jint(n int64) json.RawMessage  { b, _ := marshal(n); return b }

// marshal writes JSON with HTML escaping off, as the rest of the runtime does (the saved text is read by the TypeScript runtime, which does not escape `<`, `>` or `&`).
func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// pairs writes an object whose members are given in order, then the extra ones sorted by name.
func pairs(known []struct {
	k string
	v json.RawMessage
}, extra Raw) json.RawMessage {
	var b bytes.Buffer
	b.WriteByte('{')
	first := true
	put := func(k string, v json.RawMessage) {
		if !first {
			b.WriteByte(',')
		}
		first = false
		kb, _ := marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		b.Write(v)
	}
	for _, p := range known {
		if p.v != nil {
			put(p.k, p.v)
		}
	}
	names := make([]string, 0, len(extra))
	for k := range extra {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, k := range names {
		put(k, extra[k])
	}
	b.WriteByte('}')
	return b.Bytes()
}

type kv = struct {
	k string
	v json.RawMessage
}

func rawObj(o Raw) json.RawMessage {
	if o == nil {
		o = Raw{}
	}
	names := make([]string, 0, len(o))
	for k := range o {
		names = append(names, k)
	}
	sort.Strings(names)
	known := make([]kv, 0, len(names))
	for _, k := range names {
		known = append(known, kv{k, o[k]})
	}
	return pairs(known, nil)
}

func readAction(v json.RawMessage) Action {
	o := obj(v)
	return Action{Kind: str(o, "kind"), Skill: str(o, "skill"), Case: str(o, "case"), Fields: obj(o["fields"]), Extra: extras(o, "kind", "skill", "case", "fields")}
}

func (a Action) json() json.RawMessage {
	return pairs([]kv{{"kind", jstr(a.Kind)}, {"skill", jstr(a.Skill)}, {"case", jstr(a.Case)}, {"fields", rawObj(a.Fields)}}, a.Extra)
}

func readCard(v json.RawMessage) Card {
	o := obj(v)
	c := Card{ID: str(o, "id"), CodeHash: str(o, "codeHash"), Action: readAction(o["action"]), Proposal: obj(o["proposal"]), Digest: str(o, "digest"), State: str(o, "state"),
		CreatedAtMs: i64(o, "createdAtMs"), ExpiresAtMs: i64(o, "expiresAtMs"), ClosedAtMs: optI64(o, "closedAtMs"), ReplacedBy: str(o, "replacedBy"), Question: str(o, "question"),
		Extra: extras(o, "id", "codeHash", "action", "proposal", "digest", "state", "createdAtMs", "expiresAtMs", "closedAtMs", "replacedBy", "question")}
	return c
}

func (c Card) json() json.RawMessage {
	p := []kv{{"id", jstr(c.ID)}, {"codeHash", jstr(c.CodeHash)}, {"action", c.Action.json()}, {"proposal", rawObj(c.Proposal)}, {"digest", jstr(c.Digest)}, {"state", jstr(c.State)},
		{"createdAtMs", jint(c.CreatedAtMs)}, {"expiresAtMs", jint(c.ExpiresAtMs)}}
	if c.ClosedAtMs != nil {
		p = append(p, kv{"closedAtMs", jint(*c.ClosedAtMs)})
	}
	if c.ReplacedBy != "" {
		p = append(p, kv{"replacedBy", jstr(c.ReplacedBy)})
	}
	if c.Question != "" {
		p = append(p, kv{"question", jstr(c.Question)})
	}
	return pairs(p, c.Extra)
}

func readUndo(v json.RawMessage) Undo {
	o := obj(v)
	u := Undo{ID: str(o, "id"), Kind: str(o, "kind"), Skill: str(o, "skill"), Date: str(o, "date"), Case: str(o, "case"), FromMs: optI64(o, "fromMs"), ToMs: optI64(o, "toMs"), AtMs: i64(o, "atMs"), UntilMs: i64(o, "untilMs"),
		Extra: extras(o, "id", "kind", "skill", "date", "asked", "case", "fromMs", "toMs", "atMs", "untilMs", "done")}
	_, u.HasCase = o["case"]
	if d, ok := o["done"]; ok {
		u.HasDone = true
		_ = json.Unmarshal(d, &u.Done)
	}
	_ = json.Unmarshal(o["asked"], &u.Asked)
	if u.Asked == nil {
		u.Asked = []string{}
	}
	return u
}

func (u Undo) json() json.RawMessage {
	asked, _ := marshal(u.Asked)
	p := []kv{{"id", jstr(u.ID)}, {"kind", jstr(u.Kind)}, {"skill", jstr(u.Skill)}, {"date", jstr(u.Date)}, {"asked", asked}}
	if u.HasCase {
		p = append(p, kv{"case", jstr(u.Case)})
	}
	if u.FromMs != nil {
		p = append(p, kv{"fromMs", jint(*u.FromMs)})
	}
	if u.ToMs != nil {
		p = append(p, kv{"toMs", jint(*u.ToMs)})
	}
	p = append(p, kv{"atMs", jint(u.AtMs)}, kv{"untilMs", jint(u.UntilMs)})
	if u.HasDone {
		d, _ := marshal(u.Done)
		p = append(p, kv{"done", d})
	}
	return pairs(p, u.Extra)
}

func readTalk(v json.RawMessage) []TalkLine {
	var items []json.RawMessage
	_ = json.Unmarshal(v, &items)
	out := make([]TalkLine, 0, len(items))
	for _, it := range items {
		o := obj(it)
		out = append(out, TalkLine{AtMs: i64(o, "atMs"), From: str(o, "from"), Text: str(o, "text"), Extra: extras(o, "atMs", "from", "text")})
	}
	return out
}

func talkJSON(lines []TalkLine) json.RawMessage {
	parts := make([][]byte, 0, len(lines))
	for _, l := range lines {
		parts = append(parts, pairs([]kv{{"atMs", jint(l.AtMs)}, {"from", jstr(l.From)}, {"text", jstr(l.Text)}}, l.Extra))
	}
	return joinArray(parts)
}

func joinArray(parts [][]byte) json.RawMessage {
	return json.RawMessage("[" + string(bytes.Join(parts, []byte(","))) + "]")
}

// The members this package models; every other member of `assistant` is Rest.
var modelled = []string{"seq", "cards", "refused", "closedDays", "undo", "talk", "chat"}

// FromMembers reads the assistant's members (the saved `assistant` object). The members it models are taken out of the map it is given.
func FromMembers(m Raw) *State {
	s := &State{Rest: Raw{}}
	for k, v := range m {
		s.Rest[k] = v
	}
	for _, k := range modelled {
		delete(s.Rest, k)
	}
	s.Seq = i64(m, "seq")
	var items []json.RawMessage
	_ = json.Unmarshal(m["cards"], &items)
	s.Cards = make([]Card, 0, len(items))
	for _, it := range items {
		s.Cards = append(s.Cards, readCard(it))
	}
	items = nil
	_ = json.Unmarshal(m["refused"], &items)
	s.Refused = make([]Refused, 0, len(items))
	for _, it := range items {
		o := obj(it)
		s.Refused = append(s.Refused, Refused{Digest: str(o, "digest"), AtMs: i64(o, "atMs"), Card: str(o, "card"), Extra: extras(o, "digest", "atMs", "card")})
	}
	s.ClosedDays = []string{}
	_ = json.Unmarshal(m["closedDays"], &s.ClosedDays)
	if s.ClosedDays == nil {
		s.ClosedDays = []string{}
	}
	items = nil
	_ = json.Unmarshal(m["undo"], &items)
	s.Undo = make([]Undo, 0, len(items))
	for _, it := range items {
		s.Undo = append(s.Undo, readUndo(it))
	}
	s.Talk = readTalk(m["talk"])
	if c, ok := m["chat"]; ok && !bytes.Equal(bytes.TrimSpace(c), []byte("null")) {
		s.Chat = readTalk(c)
	}
	return s
}

// Members writes the state back as the saved `assistant` object's members.
func (s *State) Members() Raw {
	out := Raw{}
	for k, v := range s.Rest {
		out[k] = v
	}
	out["seq"] = jint(s.Seq)
	parts := make([][]byte, 0, len(s.Cards))
	for _, c := range s.Cards {
		parts = append(parts, c.json())
	}
	out["cards"] = joinArray(parts)
	parts = parts[:0]
	for _, r := range s.Refused {
		parts = append(parts, pairs([]kv{{"digest", jstr(r.Digest)}, {"atMs", jint(r.AtMs)}, {"card", jstr(r.Card)}}, r.Extra))
	}
	out["refused"] = joinArray(parts)
	days, _ := marshal(s.ClosedDays)
	out["closedDays"] = days
	parts = parts[:0]
	for _, u := range s.Undo {
		parts = append(parts, u.json())
	}
	out["undo"] = joinArray(parts)
	out["talk"] = talkJSON(s.Talk)
	if s.Chat != nil {
		out["chat"] = talkJSON(s.Chat)
	}
	return out
}

// NextID is state.ts `nextId`: "c-4", "u-5". The one counter is shared by cards, undo records and limit changes.
func (s *State) NextID(letter string) string {
	s.Seq++
	return letter + "-" + itoa(s.Seq)
}

func itoa(n int64) string { b, _ := marshal(n); return string(b) }
