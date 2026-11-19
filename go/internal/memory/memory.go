// Package memory is the shop's memory (the Go twin of modules/memory/memory.ts): short standing notes the owner (or the Operator or the builder) gave the shop's assistant, kept
// under `assistant.memory` in the shop's snapshot, field for field as the TypeScript writes them, so a shop can move between the two runtimes and lose nothing. Pure: no disk, no
// network, no model.
//
// What it promises, as memory.ts does:
//   - only a person with authority writes: every write takes an Authority, which only OwnerAuthority and PanelAuthority make (a Go type with no exported fields, so no other
//     package can forge one; TypeScript checks a WeakSet at run time for the same reason);
//   - every note has who, from where and when, an audience, an optional end; forget removes the text at once and keeps the id, the dates and a digest; closed notes lose their
//     text after 30 days;
//   - retrieval (Recall) applies the scope (open, not ended, the audience) BEFORE choosing, so a better chooser cannot widen what an audience sees.
//
// It imports only `language` (the layering is language <- memory <- understanding <- assistant).
package memory

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// The limits memory.ts names.
const (
	MaxNoteChars     = 280
	MaxOpenNotes     = 80
	day              = 24 * 60 * 60 * 1000
	ClosedTextKeptMs = 30 * day
	UndoNoteMs       = day
	ProposalMs       = day
	NoFinalMs        = day
	Action           = "memory" // MEMORY_ACTION: the record's action for a change to the memory
)

// Kinds are NOTE_KINDS, in TypeScript's order.
var Kinds = []string{"profile", "instruction", "fact", "goal", "experiment", "public"}

// defaultAudience is DEFAULT_AUDIENCE.
var defaultAudience = map[string]string{"profile": "everyone", "public": "everyone", "instruction": "owner", "goal": "owner", "experiment": "owner", "fact": "owner"}

// Raw is a JSON object kept as its members' raw text (unknown members are carried through).
type Raw = map[string]json.RawMessage

// Closed is how a note was closed.
type Closed struct {
	AtMs int64  `json:"atMs"`
	By   string `json:"by"`
	Why  string `json:"why"` // replaced, forgotten, ended
}

// Note is one note. Optional members are pointers or flags so a note is written back with exactly the members TypeScript would write.
type Note struct {
	ID, Kind, Text, Lang, Audience, By, From string
	AtMs                                     int64
	UntilMs                                  *int64
	Replaces                                 string
	Closed                                   *Closed
	Digest                                   string
	TextGone                                 bool
	Extra                                    Raw
}

// Proposal is a note the assistant proposed, saved only on the owner's tap.
type Proposal struct {
	ID, Kind, Text, Lang, Audience string
	AtMs, ExpiresAtMs              int64
	Extra                          Raw
}

// No is a proposal the owner said no to: the same text is not proposed again for a day.
type No struct {
	Digest string
	AtMs   int64
	Extra  Raw
}

// State is MemoryState.
type State struct {
	Seq       int64
	Notes     []Note
	Proposals []Proposal
	No        []No
	Extra     Raw
}

// Empty is emptyMemory.
func Empty() *State { return &State{Notes: []Note{}, Proposals: []Proposal{}, No: []No{}} }

// ---- authority ------------------------------------------------------------------------------------------------------------------------------------------

// Authority is who writes: made only by OwnerAuthority and PanelAuthority, at the place that authenticated the person.
type Authority struct{ by, from string }

// OwnerAuthority is the owner, on their own WhatsApp number or in their own app ("whatsapp" or "app"): the caller has checked the sender.
func OwnerAuthority(from string) Authority { return Authority{by: "owner", from: from} }

// PanelAuthority is the Operator or the builder, in the panel ("operator" or "builder").
func PanelAuthority(by string) Authority { return Authority{by: by, from: "panel"} }

// By is who the authority is.
func (a Authority) By() string { return a.by }

func (a Authority) valid() bool { return a.by != "" && a.from != "" }

// ---- writing --------------------------------------------------------------------------------------------------------------------------------------------

// PlainDigest is memory.ts `plainDigest`: the first 16 hex digits of sha256("geometer/note/1\n" + text).
func PlainDigest(text string) string {
	h := sha256.Sum256([]byte("geometer/note/1\n" + text))
	return hex.EncodeToString(h[:])[:16]
}

// Input is NoteInput. Audience "" takes the kind's default; UntilMs nil has no end.
type Input struct {
	Kind, Text, Lang, Audience string
	UntilMs                    *int64
}

// clean is `text.replace(/\s+/gu, " ").trim()` with JavaScript's `\s`.
func clean(s string) string { return strings.Join(strings.FieldsFunc(s, language.IsJSSpace), " ") }

func kindOK(k string) bool {
	for _, x := range Kinds {
		if x == k {
			return true
		}
	}
	return false
}

// Open is openNotes.
func (m *State) Open() []*Note {
	var out []*Note
	for i := range m.Notes {
		if m.Notes[i].Closed == nil {
			out = append(out, &m.Notes[i])
		}
	}
	return out
}

func (m *State) find(id string) *Note {
	for i := range m.Notes {
		if m.Notes[i].ID == id {
			return &m.Notes[i]
		}
	}
	return nil
}

// make is memory.ts `make`: the reason ("bad_kind", "empty", "too_long") or the note.
func (m *State) make(a Authority, in Input, now int64, digest func(string) string, replaces string) (*Note, string) {
	text := clean(in.Text)
	if !kindOK(in.Kind) {
		return nil, "bad_kind"
	}
	if text == "" {
		return nil, "empty"
	}
	if language.UTF16Len(text) > MaxNoteChars {
		return nil, "too_long"
	}
	m.Seq++
	audience := in.Audience
	if audience == "" {
		audience = defaultAudience[in.Kind]
	}
	m.Notes = append(m.Notes, Note{ID: "n-" + strconv.FormatInt(m.Seq, 10), Kind: in.Kind, Text: text, Lang: in.Lang, Audience: audience, By: a.by, From: a.from, AtMs: now, UntilMs: in.UntilMs, Replaces: replaces, Digest: digestWith(digest, text)})
	return &m.Notes[len(m.Notes)-1], ""
}

func digestWith(d func(string) string, text string) string {
	if d == nil {
		return PlainDigest(text)
	}
	return d(text)
}

// Add is addNote: at most 80 open notes ("full").
func (m *State) Add(a Authority, in Input, now int64, digest func(string) string) (*Note, string) {
	if !a.valid() {
		panic("Only the owner, the Operator or the builder can change the shop's memory.")
	}
	if len(m.Open()) >= MaxOpenNotes {
		return nil, "full"
	}
	return m.make(a, in, now, digest, "")
}

// Forget is forgetNote: the text goes at once, from a note open or closed ("no_such_note", "already_closed").
func (m *State) Forget(a Authority, id string, now int64, digest func(string) string) (*Note, string) {
	if !a.valid() {
		panic("Only the owner, the Operator or the builder can change the shop's memory.")
	}
	n := m.find(id)
	if n == nil {
		return nil, "no_such_note"
	}
	if n.TextGone && n.Closed != nil && n.Closed.Why == "forgotten" {
		return nil, "already_closed"
	}
	if n.Digest == "" {
		n.Digest = digestWith(digest, n.Text)
	}
	n.Text = ""
	n.TextGone = true
	if n.Closed == nil {
		n.Closed = &Closed{AtMs: now, By: a.by, Why: "forgotten"}
	}
	return n, ""
}

// EndExpired is endExpired: open notes past their end are closed ("ended"); returns them.
func (m *State) EndExpired(now int64) []*Note {
	var out []*Note
	for i := range m.Notes {
		n := &m.Notes[i]
		if n.Closed != nil || n.UntilMs == nil || *n.UntilMs > now {
			continue
		}
		n.Closed = &Closed{AtMs: now, By: n.By, Why: "ended"}
		out = append(out, n)
	}
	return out
}

// Tidy is tidyMemory: closed notes older than 30 days lose their text; proposals past their day and a no past its day go.
func (m *State) Tidy(now int64) int {
	dropped := 0
	for i := range m.Notes {
		n := &m.Notes[i]
		if n.Closed != nil && !n.TextGone && now-n.Closed.AtMs >= ClosedTextKeptMs {
			n.Text, n.TextGone = "", true
			dropped++
		}
	}
	ps := m.Proposals[:0:0]
	for _, p := range m.Proposals {
		if p.ExpiresAtMs > now {
			ps = append(ps, p)
		}
	}
	m.Proposals = ps
	no := m.No[:0:0]
	for _, x := range m.No {
		if now-x.AtMs < NoFinalMs {
			no = append(no, x)
		}
	}
	m.No = no
	return dropped
}

// ---- reading --------------------------------------------------------------------------------------------------------------------------------------------

// InScope is inScope: open, not past the end, with text, and for the audience ("owner" sees every note; "everyone" only the notes for everyone).
func (m *State) InScope(audience string, now int64) []*Note {
	var out []*Note
	for i := range m.Notes {
		n := &m.Notes[i]
		if n.Closed == nil && !n.TextGone && n.Text != "" && (n.UntilMs == nil || *n.UntilMs > now) && (audience == "owner" || n.Audience == "everyone") {
			out = append(out, n)
		}
	}
	return out
}

var kindRank = map[string]int{"profile": 0, "public": 1, "instruction": 2, "fact": 3, "experiment": 4, "goal": 5}

// Recall is `recall` with the first retriever (everyNoteByKind): the notes in scope, by kind and then newest first, as many as fit `budget` characters (UTF-16, as `.length`).
func (m *State) Recall(audience string, budget int, now int64) []*Note {
	scoped := m.InScope(audience, now)
	sort.SliceStable(scoped, func(i, j int) bool {
		if kindRank[scoped[i].Kind] != kindRank[scoped[j].Kind] {
			return kindRank[scoped[i].Kind] < kindRank[scoped[j].Kind]
		}
		return scoped[i].AtMs > scoped[j].AtMs
	})
	var out []*Note
	used := 0
	for _, n := range scoped {
		l := language.UTF16Len(n.Text)
		if used+l > budget {
			continue
		}
		used += l
		out = append(out, n)
	}
	return out
}

// Refs is memoryRefs: what a `memory` line of the record carries (never the words).
func Refs(n *Note, change string) map[string]string {
	r := map[string]string{"note": n.ID, "kind": n.Kind, "by": n.By, "from": n.From, "audience": n.Audience, "change": change}
	if n.Replaces != "" {
		r["replaces"] = n.Replaces
	}
	return r
}

// ---- the saved form -------------------------------------------------------------------------------------------------------------------------------------

func obj(raw json.RawMessage) Raw {
	var o Raw
	_ = json.Unmarshal(raw, &o)
	return o
}

func str(o Raw, k string) string {
	var s string
	_ = json.Unmarshal(o[k], &s)
	return s
}

func num(o Raw, k string) int64 {
	var f float64
	_ = json.Unmarshal(o[k], &f)
	return int64(f)
}

func rest(o Raw, known ...string) Raw {
	var out Raw
	for k, v := range o {
		if !contains(known, k) {
			if out == nil {
				out = Raw{}
			}
			out[k] = v
		}
	}
	return out
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

// Parse reads `assistant.memory` (nil or absent: an empty memory).
func Parse(raw json.RawMessage) *State {
	m := Empty()
	o := obj(raw)
	if o == nil {
		return m
	}
	m.Seq = num(o, "seq")
	var notes, props, nos []json.RawMessage
	_ = json.Unmarshal(o["notes"], &notes)
	_ = json.Unmarshal(o["proposals"], &props)
	_ = json.Unmarshal(o["no"], &nos)
	for _, r := range notes {
		n := obj(r)
		note := Note{ID: str(n, "id"), Kind: str(n, "kind"), Text: str(n, "text"), Lang: str(n, "lang"), Audience: str(n, "audience"), By: str(n, "by"), From: str(n, "from"), AtMs: num(n, "atMs"), Replaces: str(n, "replaces"), Digest: str(n, "digest")}
		if _, ok := n["untilMs"]; ok {
			u := num(n, "untilMs")
			note.UntilMs = &u
		}
		if c, ok := n["closed"]; ok && string(c) != "null" {
			note.Closed = &Closed{}
			_ = json.Unmarshal(c, note.Closed)
		}
		var gone bool
		_ = json.Unmarshal(n["textGone"], &gone)
		note.TextGone = gone
		note.Extra = rest(n, "id", "kind", "text", "lang", "audience", "by", "from", "atMs", "untilMs", "replaces", "closed", "digest", "textGone")
		m.Notes = append(m.Notes, note)
	}
	for _, r := range props {
		p := obj(r)
		m.Proposals = append(m.Proposals, Proposal{ID: str(p, "id"), Kind: str(p, "kind"), Text: str(p, "text"), Lang: str(p, "lang"), Audience: str(p, "audience"), AtMs: num(p, "atMs"), ExpiresAtMs: num(p, "expiresAtMs"), Extra: rest(p, "id", "kind", "text", "lang", "audience", "atMs", "expiresAtMs")})
	}
	for _, r := range nos {
		x := obj(r)
		m.No = append(m.No, No{Digest: str(x, "digest"), AtMs: num(x, "atMs"), Extra: rest(x, "digest", "atMs")})
	}
	m.Extra = rest(o, "seq", "notes", "proposals", "no")
	return m
}

// ordered writes an object's members in the order given, then the extra ones sorted (JSON with HTML escaping off, as JSON.stringify writes).
type ordered struct {
	keys []string
	vals []any
}

func (o *ordered) add(k string, v any) { o.keys, o.vals = append(o.keys, k), append(o.vals, v) }

func (o *ordered) extra(x Raw) {
	ks := make([]string, 0, len(x))
	for k := range x {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	for _, k := range ks {
		o.add(k, x[k])
	}
}

func (o *ordered) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		vb, err := marshal(o.vals[i])
		if err != nil {
			return nil, err
		}
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func marshal(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(b.Bytes(), "\n"), nil
}

// JSON writes the memory back with TypeScript's member order (memory.ts writes a note as id, kind, text, lang, audience, by, from, atMs, untilMs, replaces, digest; `closed` and
// `textGone` are added later in the order they happened, which the saved form does not keep: they are written after `digest`).
func (m *State) JSON() json.RawMessage {
	notes := make([]any, 0, len(m.Notes))
	for i := range m.Notes {
		n := &m.Notes[i]
		o := &ordered{}
		o.add("id", n.ID)
		o.add("kind", n.Kind)
		o.add("text", n.Text)
		o.add("lang", n.Lang)
		o.add("audience", n.Audience)
		o.add("by", n.By)
		o.add("from", n.From)
		o.add("atMs", n.AtMs)
		if n.UntilMs != nil {
			o.add("untilMs", *n.UntilMs)
		}
		if n.Replaces != "" {
			o.add("replaces", n.Replaces)
		}
		o.add("digest", n.Digest)
		if n.TextGone {
			o.add("textGone", true)
		}
		if n.Closed != nil {
			o.add("closed", n.Closed)
		}
		o.extra(n.Extra)
		notes = append(notes, o)
	}
	props := make([]any, 0, len(m.Proposals))
	for _, p := range m.Proposals {
		o := &ordered{}
		o.add("id", p.ID)
		o.add("kind", p.Kind)
		o.add("text", p.Text)
		o.add("lang", p.Lang)
		o.add("audience", p.Audience)
		o.add("atMs", p.AtMs)
		o.add("expiresAtMs", p.ExpiresAtMs)
		o.extra(p.Extra)
		props = append(props, o)
	}
	nos := make([]any, 0, len(m.No))
	for _, x := range m.No {
		o := &ordered{}
		o.add("digest", x.Digest)
		o.add("atMs", x.AtMs)
		o.extra(x.Extra)
		nos = append(nos, o)
	}
	o := &ordered{}
	o.add("seq", m.Seq)
	o.add("notes", notes)
	o.add("proposals", props)
	o.add("no", nos)
	o.extra(m.Extra)
	b, _ := marshal(o)
	return b
}
