package assistant

// The card binding (modules/assistant/cards.ts): an act that touches the owner's page, money or a limit is not done when it is asked for. The assistant shows it as a card with the exact
// change and does it only when the owner taps yes. The point, copied from TypeScript:
//   - a card is a saved, immutable action (the skill, the case and the exact fields the skill read from its store); no value ever comes from a model;
//   - its digest is over those fields, and the owner's page posts the id AND the digest it showed;
//   - on a tap the skill reads the action again as it is NOW: the same digest and the saved action is done; another digest and nothing is done, the card is void and a new one is made;
//   - a no is final for that action (the same digest) for 24 hours; a tap on a closed card does nothing.
//
// The digest is the one place the two runtimes must agree to the byte: a card TypeScript made is answered by Go and the reverse, on the same folder. TypeScript computes
// sha256(JSON.stringify(["card", skill, kind, case, [[field, value], ...]])) over the fields sorted by key. So this file writes JSON the way JavaScript's JSON.stringify does
// (quote, jsQuote), not the way Go's encoder does: Go escapes U+2028 and U+2029 and (with HTML escaping on) `<`, `>` and `&`, and writes control characters its own way; JavaScript writes
// the two separators and `<>&` as they are, `\b` and `\f` as short escapes, other control characters as `\u00xx` in lower case, and a lone surrogate as `\udxxx`.

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"sort"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const (
	// Day is a day in ms.
	Day = 24 * 60 * 60 * 1000
	// CardForMs: how long a card can be tapped. A day.
	CardForMs = Day
	// RefusedForMs: a no is final for that exact action this long.
	RefusedForMs = Day
	// UndoForMs: how long an act can be undone.
	UndoForMs = Day
	// TalkLines is how many lines of talk the page shows; ChatLines how many turns the prompt keeps.
	TalkLines = 20
	ChatLines = 12
	// KeepClosedCards: closed cards kept for the record's sake (a tap on an old one is answered "already done").
	KeepClosedCards = 30
)

// jsQuote is JSON.stringify of a string.
func jsQuote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\b':
			b.WriteString(`\b`)
		case r == '\f':
			b.WriteString(`\f`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < 0x20:
			b.WriteString(`\u00`)
			b.WriteByte("0123456789abcdef"[r>>4])
			b.WriteByte("0123456789abcdef"[r&15])
		case r == utf8.RuneError:
			// Go cannot hold a lone surrogate: a JSON "\ud800" was read as U+FFFD, which JavaScript would have written as itself (a real U+FFFD) or as "\ud800". A real U+FFFD is the
			// common case and is written as itself; the lone-surrogate card is a TypeScript-only edge (a title with half an emoji) that digests differently here.
			b.WriteRune(r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// lessUTF16 orders strings as JavaScript's default sort does: by UTF-16 code unit.
func lessUTF16(a, b string) bool {
	ua, ub := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			return ua[i] < ub[i]
		}
	}
	return len(ua) < len(ub)
}

// scalar is JSON.stringify of a field's value: a string is re-quoted the JavaScript way; a number or a boolean was written by JavaScript (or by this runtime in the same form) and is kept as it is.
func scalar(v json.RawMessage) string {
	t := bytes.TrimSpace(v)
	if len(t) > 0 && t[0] == '"' {
		var s string
		if json.Unmarshal(t, &s) == nil {
			return jsQuote(s)
		}
	}
	return string(t)
}

// ActionDigest is cards.ts `actionDigest`: the first 32 hex digits of sha256 over JSON.stringify(["card", skill, kind, case, [[key, value], ...]]), keys sorted. The order the fields
// were stored in does not matter.
func ActionDigest(a Action) string {
	keys := make([]string, 0, len(a.Fields))
	for k := range a.Fields {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return lessUTF16(keys[i], keys[j]) })
	var b strings.Builder
	b.WriteString(`["card",` + jsQuote(a.Skill) + `,` + jsQuote(a.Kind) + `,` + jsQuote(a.Case) + `,[`)
	for i, k := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`[` + jsQuote(k) + `,` + scalar(a.Fields[k]) + `]`)
	}
	b.WriteString(`]]`)
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])[:32]
}

// CodeHash is cards.ts `codeHash`: salted with its purpose so it can never match a relay code's hash.
func CodeHash(code string) string {
	sum := sha256.Sum256([]byte("assistant-card:" + strings.ToUpper(code)))
	return hex.EncodeToString(sum[:])
}

// codeAlphabet is modules/approvals/code.ts: no 0 O 1 I L, no hyphen, so a code can never be read as a booking reference.
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// NewCode is a random one-use code. The owner's page never shows it; a card's only trace is its hash.
func NewCode() string {
	out := make([]byte, 6)
	for i := range out {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
		if err != nil {
			panic(err) // the system's random source failed: nothing safe to do
		}
		out[i] = codeAlphabet[n.Int64()]
	}
	return string(out)
}

// RefusedBefore is a no to this exact action in the last 24 hours, if there is one.
func (s *State) RefusedBefore(digest string, now int64) *Refused {
	for i := range s.Refused {
		if s.Refused[i].Digest == digest && s.Refused[i].AtMs > now-RefusedForMs {
			return &s.Refused[i]
		}
	}
	return nil
}

// MakeCard is cards.ts `makeCard`: a new card for this action. Any open card for the same skill, kind and case is void first (one live card per thing). Returns the card, its
// one-use code (only its hash is kept: the code goes into the WhatsApp text and the button ids, never to the page), and the cards it voided.
func (s *State) MakeCard(a Action, proposal Raw, now int64) (*Card, string, []*Card) {
	digest := ActionDigest(a)
	id := s.NextID("c")
	var voided []*Card
	for i := range s.Cards {
		c := &s.Cards[i]
		if c.State != "open" || c.Action.Skill != a.Skill || c.Action.Kind != a.Kind || c.Action.Case != a.Case {
			continue
		}
		c.State, c.ClosedAtMs, c.ReplacedBy = "void", &now, id
		voided = append(voided, c)
	}
	code := NewCode()
	for tries := 0; tries < 20; tries++ {
		clash := false
		for _, c := range s.Cards {
			clash = clash || (c.State == "open" && c.CodeHash == CodeHash(code))
		}
		if !clash {
			break
		}
		code = NewCode()
	}
	fields := Raw{}
	for k, v := range a.Fields {
		fields[k] = v
	}
	a.Fields = fields
	s.Cards = append(s.Cards, Card{ID: id, CodeHash: CodeHash(code), Action: a, Proposal: proposal, Digest: digest, State: "open", CreatedAtMs: now, ExpiresAtMs: now + CardForMs})
	return &s.Cards[len(s.Cards)-1], code, voided
}

// CardByID is the card with this id ("c-3"), whatever its state; the owner's page answers by id and digest, never by code.
func (s *State) CardByID(id string) *Card {
	for i := range s.Cards {
		if s.Cards[i].ID == id {
			return &s.Cards[i]
		}
	}
	return nil
}

// Verdict is what an answer to a card comes to, before anything is done.
type Verdict struct {
	Kind string // do, refuse, unknown, closed, expired, changed, gone
	Card *Card
	Now  *Action // changed: the action as it is now
	Why  string  // gone: why it cannot be done
}

// Current reads a card's action again from the store as it is now: the action, or why it cannot be done (cards.ts `current`).
type Current func(c *Card) (Action, string, bool)

// JudgeCard is cards.ts `judgeCard`: the one verdict for an answer to a card, whichever door it came through. A no needs no fresh read.
func JudgeCard(card *Card, answer string, now int64, current Current) Verdict {
	if card == nil {
		return Verdict{Kind: "unknown"}
	}
	if card.State != "open" {
		return Verdict{Kind: "closed", Card: card}
	}
	if now >= card.ExpiresAtMs {
		return Verdict{Kind: "expired", Card: card}
	}
	if answer == "no" {
		return Verdict{Kind: "refuse", Card: card}
	}
	act, why, ok := current(card)
	if !ok {
		return Verdict{Kind: "gone", Card: card, Why: why}
	}
	if ActionDigest(act) != card.Digest {
		return Verdict{Kind: "changed", Card: card, Now: &act}
	}
	return Verdict{Kind: "do", Card: card}
}

// Close is cards.ts `closeCard`: a refusal is remembered by its digest, so the same action is not shown again for 24 hours.
func (s *State) Close(c *Card, to string, now int64) {
	c.State, c.ClosedAtMs = to, &now
	if to == "refused" {
		s.Refused = append(s.Refused, Refused{Digest: c.Digest, AtMs: now, Card: c.ID})
	}
}

// Expire closes the cards past their time (on the tick) and returns them.
func (s *State) Expire(now int64) []*Card {
	var out []*Card
	for i := range s.Cards {
		c := &s.Cards[i]
		if c.State == "open" && now >= c.ExpiresAtMs {
			c.State, c.ClosedAtMs = "expired", &now
			out = append(out, c)
		}
	}
	return out
}

// OpenCards are the open cards, oldest first: what the owner's app and "what needs me" show.
func (s *State) OpenCards(now int64) []*Card {
	var out []*Card
	for i := range s.Cards {
		if s.Cards[i].State == "open" && now < s.Cards[i].ExpiresAtMs {
			out = append(out, &s.Cards[i])
		}
	}
	return out
}

// HasNo is cards.ts `cardHasNo`: a deposit to mark and a refund sent have only the one answer. A listings-only shop has neither, so every card here has a no, but a card TypeScript made
// goes through the same test.
func (c *Card) HasNo() bool {
	var kind, item string
	_ = json.Unmarshal(c.Proposal["kind"], &kind)
	_ = json.Unmarshal(c.Proposal["itemKind"], &item)
	return !(kind == "answer" && (item == "deposit" || item == "refund_owed"))
}

// Compact is state.ts `compactAssistant`, the part that belongs to this package: closed cards beyond the last few and older than a day, refusals older than 24 hours, undo records past
// their time, past closed days and old talk. (The runtime tidies the listings and the stock count in the same step.) Returns how much went.
func (s *State) Compact(now int64, todayIso string) int {
	gone := 0
	var closed []*Card
	for i := range s.Cards {
		if s.Cards[i].State != "open" {
			closed = append(closed, &s.Cards[i])
		}
	}
	if len(closed) > KeepClosedCards {
		closed = closed[len(closed)-KeepClosedCards:]
	}
	keep := map[string]bool{}
	for _, c := range closed {
		at := c.CreatedAtMs
		if c.ClosedAtMs != nil {
			at = *c.ClosedAtMs
		}
		if at > now-Day {
			keep[c.ID] = true
		}
	}
	cards := make([]Card, 0, len(s.Cards))
	for _, c := range s.Cards {
		if c.State == "open" || keep[c.ID] {
			cards = append(cards, c)
		}
	}
	gone += len(s.Cards) - len(cards)
	s.Cards = cards
	refused := make([]Refused, 0, len(s.Refused))
	for _, r := range s.Refused {
		if r.AtMs > now-RefusedForMs {
			refused = append(refused, r)
		}
	}
	gone += len(s.Refused) - len(refused)
	s.Refused = refused
	undo := make([]Undo, 0, len(s.Undo))
	for _, u := range s.Undo {
		if !u.Done && u.UntilMs > now {
			undo = append(undo, u)
		}
	}
	gone += len(s.Undo) - len(undo)
	s.Undo = undo
	days := make([]string, 0, len(s.ClosedDays))
	for _, d := range s.ClosedDays {
		if d >= todayIso {
			days = append(days, d)
		}
	}
	gone += len(s.ClosedDays) - len(days)
	s.ClosedDays = days
	if len(s.Chat) > ChatLines {
		gone += len(s.Chat) - ChatLines
		s.Chat = s.Chat[len(s.Chat)-ChatLines:]
	}
	gone += s.compactChanges()
	if len(s.Talk) > TalkLines {
		gone += len(s.Talk) - TalkLines
		s.Talk = s.Talk[len(s.Talk)-TalkLines:]
	}
	return gone
}

// MarkChangesTold is limits-card.ts `unannounced` for a shop that declares no limit (a listings-only shop): every settled change the owner was not told of is marked told, and
// there is nothing to say (a change of a limit the shop does not declare has no words). Run on the beat after the budget's notices, as conversation.ts `onTick` does.
func (s *State) MarkChangesTold() {
	var changes []json.RawMessage
	if json.Unmarshal(s.Rest["limitChanges"], &changes) != nil {
		return
	}
	touched := false
	for i, c := range changes {
		var head struct {
			State string `json:"state"`
			Told  any    `json:"told"`
		}
		_ = json.Unmarshal(c, &head)
		if head.State == "pending" || truthy(head.Told) {
			continue
		}
		changes[i] = setMember(c, "told", json.RawMessage("true"))
		touched = true
	}
	if touched { // written as compactChanges writes them: each change's bytes as they are (json.Marshal would escape <, > and & in them)
		s.Rest["limitChanges"] = json.RawMessage(append(append([]byte("["), bytes.Join(func() [][]byte {
			out := make([][]byte, len(changes))
			for i, c := range changes {
				out[i] = bytes.TrimSpace(c)
			}
			return out
		}(), []byte(","))...), ']'))
	}
}

// truthy is JavaScript's truthiness of a JSON value.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0
	case string:
		return x != ""
	}
	return true
}

// setMember sets one member of a JSON object, keeping the order of the others: in place when it is there, at the end when it is not (as a JavaScript assignment does).
func setMember(obj json.RawMessage, key string, val json.RawMessage) json.RawMessage {
	dec := json.NewDecoder(bytes.NewReader(obj))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return obj
	}
	var b bytes.Buffer
	b.WriteByte('{')
	n, found := 0, false
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return obj
		}
		k, _ := t.(string)
		var v json.RawMessage
		if dec.Decode(&v) != nil {
			return obj
		}
		if k == key {
			v, found = val, true
		}
		if n > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		b.Write(v)
		n++
	}
	if !found {
		if n > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(key)
		b.Write(kb)
		b.WriteByte(':')
		b.Write(val)
	}
	b.WriteByte('}')
	return b.Bytes()
}

// KeepSettledChanges is modules/limits/chat-limits.ts KEEP_SETTLED_CHANGES.
const KeepSettledChanges = 30

// compactChanges is chat-limits.ts `compactChanges` over `limitChanges` (`state.limitChanges ??= []` first): settled changes are taken off, keeping the newest 30; a pending one is
// never taken. Only `id` and `state` of a change are read; every change kept is written back exactly as it was.
func (s *State) compactChanges() int {
	raw, ok := s.Rest["limitChanges"]
	if !ok || string(bytes.TrimSpace(raw)) == "null" {
		s.Rest["limitChanges"] = json.RawMessage("[]")
		return 0
	}
	var changes []json.RawMessage
	if json.Unmarshal(raw, &changes) != nil {
		return 0
	}
	type head struct {
		ID    string `json:"id"`
		State string `json:"state"`
	}
	heads := make([]head, len(changes))
	var settled []string
	for i, c := range changes {
		_ = json.Unmarshal(c, &heads[i])
		if heads[i].State != "pending" {
			settled = append(settled, heads[i].ID)
		}
	}
	if len(settled) <= KeepSettledChanges {
		return 0
	}
	drop := map[string]bool{}
	for _, id := range settled[:len(settled)-KeepSettledChanges] {
		drop[id] = true
	}
	var b bytes.Buffer
	b.WriteByte('[')
	n := 0
	for i, c := range changes {
		if drop[heads[i].ID] {
			continue
		}
		if n > 0 {
			b.WriteByte(',')
		}
		b.Write(bytes.TrimSpace(c))
		n++
	}
	b.WriteByte(']')
	s.Rest["limitChanges"] = json.RawMessage(b.Bytes())
	return len(drop)
}

// AddTalk is conversation.ts `talk`: one line of the page's talk, the oldest going once there are more than the page shows.
func (s *State) AddTalk(from, text string, now int64) {
	s.Talk = append(s.Talk, TalkLine{AtMs: now, From: from, Text: text})
	if len(s.Talk) > TalkLines {
		s.Talk = s.Talk[len(s.Talk)-TalkLines:]
	}
}
