package runtime

// The channel state a template keeps in its store under `channel` (modules/channels/state.ts ChannelState): the messages the shop gave to a channel's customers (the outbox, which a
// booking's page and a chat thread read back), the chat guests (W1: their lines, the day's counts, their number for the owner) and the sequence that numbers a thread's lines.
// Until now a template kept this block as raw JSON; the chat reads and writes it field for field, so it is typed here, once, for every template (Bookings, Orders and Fees share it).
//
// The same file on disk as TypeScript writes: the members and each object's keys come out in the order the TypeScript makes them (a member the TypeScript has not made yet is left out,
// as `chat` and `guests` are until the first guest writes), a key this version does not know is carried through raw after the known ones (a shop that goes back to the TypeScript runtime
// loses nothing), and the text is written without Go's HTML escaping (`<`, `>` and `&` are left as they are, as JSON.stringify does). `requests` is the template's own (a booking's
// request by its handle), so it stays raw here.

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strconv"
)

// The most a conversation keeps (state.ts OUTBOX_PER_CONVERSATION, CHAT_THREAD_MAX).
const (
	OutboxPerConversation = 20
	ChatThreadMax         = 60
)

// ChatChoice is a button or a list row as a chat thread keeps it (state.ts ChatChoice): the id the template gave it, the words, and a row's one-line note.
type ChatChoice struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Hint  string `json:"hint,omitempty"`
	List  bool   `json:"list,omitempty"` // true for a list row (WhatsApp's kind of reply), else a button
}

// OutboxMessage is one message the agent "sent" to a channel's customer (state.ts OutboxMessage).
type OutboxMessage struct {
	ID      string
	To      string
	Text    string
	AtMs    int64
	Choices []ChatChoice // a chat guest's thread only
	Moment  string       // "confirmed" or "paid": a chat line the record stands behind; "" is none
	Rest    []Member     // members this version does not know
}

// ChatSaid is what a guest typed or tapped (state.ts ChatSaid). `CID` is the page's own id for the send, so a retry is one line.
type ChatSaid struct {
	ID   string
	CID  string
	Text string
	AtMs int64
	Rest []Member
}

// ChatGuest is one guest's chat by its conversation (state.ts ChatGuest).
type ChatGuest struct {
	StartedMs, LastMs int64
	Said              []ChatSaid
	Day               string
	Turns, Messages   int64
	N                 int64   // the guest's number for the owner ("Chat guest 3"); 0: not given yet
	PingDay           *string // owner pings (chat.ts chatMayPing): the day they are counted for, and how many
	Pings             *int64
	Rest              []Member
}

// ChannelState is state.ts ChannelState.
type ChannelState struct {
	Seq      int64
	Outbox   []OutboxMessage
	Requests json.RawMessage // the template's own; nil: as emptyChannelState's `{}`
	guestKey []string        // the conversations of Chat, in the order the guests were made (a JavaScript object keeps insertion order)
	chat     map[string]*ChatGuest
	hasChat  bool
	Guests   int64 // how many chat guests the shop has had; 0 and !hasGuests: the member is left out
	hasGuest bool
	rest     []Member
	order    []string // the members in the order they were read, so a state written by either runtime is written back in its own order
}

// EmptyChannel is emptyChannelState.
func EmptyChannel() *ChannelState { return &ChannelState{Outbox: []OutboxMessage{}} }

// ParseChannel reads the `channel` member of a store; nil or empty is a fresh state.
func ParseChannel(raw json.RawMessage) (*ChannelState, error) {
	if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "null" {
		return EmptyChannel(), nil
	}
	members, ok := topMembers(raw)
	if !ok {
		return nil, errBadChannel
	}
	s := &ChannelState{Outbox: []OutboxMessage{}}
	for _, m := range members {
		s.order = append(s.order, m.Name)
		switch m.Name {
		case "seq":
			if err := json.Unmarshal(m.Raw, &s.Seq); err != nil {
				return nil, errBadChannel
			}
		case "outbox":
			var list []json.RawMessage
			if err := json.Unmarshal(m.Raw, &list); err != nil {
				return nil, errBadChannel
			}
			for _, r := range list {
				var o OutboxMessage
				if err := o.parse(r); err != nil {
					return nil, err
				}
				s.Outbox = append(s.Outbox, o)
			}
		case "requests":
			s.Requests = m.Raw
		case "chat":
			guests, ok := topMembers(m.Raw)
			if !ok {
				return nil, errBadChannel
			}
			s.hasChat, s.chat = true, map[string]*ChatGuest{}
			for _, g := range guests {
				gu := &ChatGuest{}
				if err := gu.parse(g.Raw); err != nil {
					return nil, err
				}
				s.guestKey = append(s.guestKey, g.Name)
				s.chat[g.Name] = gu
			}
		case "guests":
			if err := json.Unmarshal(m.Raw, &s.Guests); err != nil {
				return nil, errBadChannel
			}
			s.hasGuest = true
		default:
			s.rest = append(s.rest, m)
		}
	}
	return s, nil
}

type channelErr string

func (e channelErr) Error() string { return string(e) }

const errBadChannel = channelErr("the saved channel state is not one this version can read")

// members of an object, split into the ones this version knows (by name) and the rest.
func splitMembers(raw []byte, known ...string) (map[string]json.RawMessage, []Member, error) {
	members, ok := topMembers(raw)
	if !ok {
		return nil, nil, errBadChannel
	}
	have := map[string]json.RawMessage{}
	var rest []Member
	for _, m := range members {
		k := false
		for _, n := range known {
			k = k || n == m.Name
		}
		if k {
			have[m.Name] = m.Raw
		} else {
			rest = append(rest, m)
		}
	}
	return have, rest, nil
}

func (o *OutboxMessage) parse(raw []byte) error {
	have, rest, err := splitMembers(raw, "id", "to", "text", "atMs", "choices", "moment")
	if err != nil {
		return err
	}
	o.Rest = rest
	for name, dst := range map[string]any{"id": &o.ID, "to": &o.To, "text": &o.Text, "atMs": &o.AtMs, "choices": &o.Choices, "moment": &o.Moment} {
		if v, ok := have[name]; ok {
			if err := json.Unmarshal(v, dst); err != nil {
				return errBadChannel
			}
		}
	}
	return nil
}

func (g *ChatGuest) parse(raw []byte) error {
	have, rest, err := splitMembers(raw, "startedMs", "lastMs", "said", "day", "turns", "messages", "n", "pingDay", "pings")
	if err != nil {
		return err
	}
	g.Rest = rest
	for name, dst := range map[string]any{"startedMs": &g.StartedMs, "lastMs": &g.LastMs, "day": &g.Day, "turns": &g.Turns, "messages": &g.Messages, "n": &g.N, "pingDay": &g.PingDay, "pings": &g.Pings} {
		if v, ok := have[name]; ok {
			if err := json.Unmarshal(v, dst); err != nil {
				return errBadChannel
			}
		}
	}
	if v, ok := have["said"]; ok {
		var list []json.RawMessage
		if err := json.Unmarshal(v, &list); err != nil {
			return errBadChannel
		}
		for _, r := range list {
			var s ChatSaid
			have, rest, err := splitMembers(r, "id", "cid", "text", "atMs")
			if err != nil {
				return err
			}
			s.Rest = rest
			for name, dst := range map[string]any{"id": &s.ID, "cid": &s.CID, "text": &s.Text, "atMs": &s.AtMs} {
				if v, ok := have[name]; ok {
					if json.Unmarshal(v, dst) != nil {
						return errBadChannel
					}
				}
			}
			g.Said = append(g.Said, s)
		}
	}
	if g.Said == nil {
		g.Said = []ChatSaid{}
	}
	return nil
}

// ---- reading and writing the guests (an ordered map) ----

// Guest is the chat guest of a conversation, or nil.
func (s *ChannelState) Guest(conversation string) *ChatGuest {
	if s == nil {
		return nil
	}
	return s.chat[conversation]
}

// ChatLen is how many guests the shop holds.
func (s *ChannelState) ChatLen() int { return len(s.chat) }

// EachGuest calls f for each guest in the order they were made.
func (s *ChannelState) EachGuest(f func(conversation string, g *ChatGuest)) {
	for _, k := range s.guestKey {
		f(k, s.chat[k])
	}
}

// ensureGuest is `(state.chat ??= {})[conversation] ??= newGuest(now, day)`.
func (s *ChannelState) ensureGuest(conversation string, now int64, day string) *ChatGuest {
	if !s.hasChat {
		s.hasChat, s.chat = true, map[string]*ChatGuest{}
	}
	if g, ok := s.chat[conversation]; ok {
		return g
	}
	g := &ChatGuest{StartedMs: now, LastMs: now, Said: []ChatSaid{}, Day: day}
	s.chat[conversation] = g
	s.guestKey = append(s.guestKey, conversation)
	return g
}

// DeleteGuest is `delete state.chat[conversation]`, and the whole member goes with the last guest (chat.ts forgetChat, state.ts compactChannel).
func (s *ChannelState) DeleteGuest(conversation string) {
	if _, ok := s.chat[conversation]; !ok {
		return
	}
	delete(s.chat, conversation)
	for i, k := range s.guestKey {
		if k == conversation {
			s.guestKey = append(s.guestKey[:i], s.guestKey[i+1:]...)
			break
		}
	}
	if len(s.chat) == 0 {
		s.chat, s.guestKey, s.hasChat = nil, nil, false
	}
}

// NextGuestNumber is chat-guest.ts nextGuestNumber: it never goes down, so a number is not given twice.
func (s *ChannelState) NextGuestNumber() int64 {
	s.Guests++
	s.hasGuest = true
	return s.Guests
}

// ---- writing ----

// text is a JSON string as JSON.stringify writes it (no HTML escaping).
func jtext(v any) string {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
	return string(bytes.TrimRight(b.Bytes(), "\n"))
}

type objWriter struct {
	b     bytes.Buffer
	first bool
}

func newObj() *objWriter { o := &objWriter{first: true}; o.b.WriteByte('{'); return o }
func (o *objWriter) put(name, raw string) {
	if !o.first {
		o.b.WriteByte(',')
	}
	o.first = false
	o.b.WriteString(jtext(name))
	o.b.WriteByte(':')
	o.b.WriteString(raw)
}
func (o *objWriter) rest(ms []Member) {
	for _, m := range ms {
		o.put(m.Name, string(m.Raw))
	}
}
func (o *objWriter) done() []byte { o.b.WriteByte('}'); return o.b.Bytes() }

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func (c ChatChoice) json() string {
	o := newObj()
	o.put("id", jtext(c.ID))
	o.put("title", jtext(c.Title))
	if c.Hint != "" {
		o.put("hint", jtext(c.Hint))
	}
	if c.List {
		o.put("list", "true")
	}
	return string(o.done())
}

func (m *OutboxMessage) json() string {
	o := newObj()
	o.put("id", jtext(m.ID))
	o.put("to", jtext(m.To))
	o.put("text", jtext(m.Text))
	o.put("atMs", itoa(m.AtMs))
	if len(m.Choices) > 0 {
		o.put("choices", choicesJSON(m.Choices))
	}
	if m.Moment != "" {
		o.put("moment", jtext(m.Moment))
	}
	o.rest(m.Rest)
	return string(o.done())
}

func choicesJSON(cs []ChatChoice) string {
	parts := make([]string, len(cs))
	for i, c := range cs {
		parts[i] = c.json()
	}
	return "[" + joinComma(parts) + "]"
}

func joinComma(parts []string) string {
	var b bytes.Buffer
	for i, p := range parts {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(p)
	}
	return b.String()
}

func (g *ChatGuest) json() string {
	o := newObj()
	o.put("startedMs", itoa(g.StartedMs))
	o.put("lastMs", itoa(g.LastMs))
	said := make([]string, len(g.Said))
	for i, s := range g.Said {
		so := newObj()
		so.put("id", jtext(s.ID))
		so.put("cid", jtext(s.CID))
		so.put("text", jtext(s.Text))
		so.put("atMs", itoa(s.AtMs))
		so.rest(s.Rest)
		said[i] = string(so.done())
	}
	o.put("said", "["+joinComma(said)+"]")
	o.put("day", jtext(g.Day))
	o.put("turns", itoa(g.Turns))
	o.put("messages", itoa(g.Messages))
	if g.N != 0 {
		o.put("n", itoa(g.N))
	}
	if g.PingDay != nil { // `guest.pingDay = day; guest.pings = 0` (chat.ts chatMayPing): the day is written first
		o.put("pingDay", jtext(*g.PingDay))
	}
	if g.Pings != nil {
		o.put("pings", itoa(*g.Pings))
	}
	o.rest(g.Rest)
	return string(o.done())
}

// Marshal is the state as the TypeScript writes it. Members come out in the order they were read, then any a step made new (chat, then guests) in the order the TypeScript makes them.
func (s *ChannelState) Marshal() json.RawMessage {
	made := map[string]string{}
	msgs := make([]string, len(s.Outbox))
	for i := range s.Outbox {
		msgs[i] = s.Outbox[i].json()
	}
	made["seq"] = itoa(s.Seq)
	made["outbox"] = "[" + joinComma(msgs) + "]"
	if s.Requests != nil {
		made["requests"] = string(s.Requests)
	} else {
		made["requests"] = "{}"
	}
	if s.hasChat {
		o := newObj()
		for _, k := range s.guestKey {
			o.put(k, s.chat[k].json())
		}
		made["chat"] = string(o.done())
	}
	if s.hasGuest {
		made["guests"] = itoa(s.Guests)
	}
	out := newObj()
	done := map[string]bool{}
	emit := func(name string) {
		if v, ok := made[name]; ok && !done[name] {
			done[name] = true
			out.put(name, v)
		}
	}
	for _, name := range s.order {
		emit(name)
	}
	for _, name := range []string{"seq", "outbox", "requests", "chat", "guests"} {
		emit(name)
	}
	out.rest(s.rest)
	return json.RawMessage(out.done())
}

// ---- the outbox (channels/outbox.ts) ----

// ChoicesOf is outbox.ts choicesOf for the parts a template hands over: a message's buttons, or a list's rows with their notes.
func ChoicesOf(buttons []ChatChoice, rows []ChatChoice) []ChatChoice {
	if len(buttons) > 0 {
		return buttons
	}
	return rows
}

// Keep is outbox.ts channelMessaging's `keep`: the message is kept in the step's store and the conversation keeps its latest lines (a chat thread more than a booking's page). Only a
// chat thread keeps the choices. It returns the message's id ("ch-<seq>") and time.
func (s *ChannelState) Keep(to, words string, choices []ChatChoice, now int64) OutboxMessage {
	s.Seq++
	m := OutboxMessage{ID: "ch-" + itoa(s.Seq), To: to, Text: words, AtMs: now}
	if len(choices) > 0 && IsChatConversation(to) {
		m.Choices = choices
	}
	s.Outbox = append(s.Outbox, m)
	n := 0
	for _, x := range s.Outbox {
		if x.To == to {
			n++
		}
	}
	capacity := OutboxPerConversation
	if IsChatConversation(to) {
		capacity = ChatThreadMax
	}
	if n > capacity {
		drop := n - capacity // the oldest of this conversation go
		kept := s.Outbox[:0:0]
		for _, x := range s.Outbox {
			if x.To == to && drop > 0 {
				drop--
				continue
			}
			kept = append(kept, x)
		}
		s.Outbox = kept
	}
	return m
}

// MarkMoment is outbox.ts markMoment: the record stands behind this kept chat line ("confirmed" or "paid").
func (s *ChannelState) MarkMoment(id, moment string) {
	for i := range s.Outbox {
		if s.Outbox[i].ID == id {
			s.Outbox[i].Moment = moment
			return
		}
	}
}

// Compact is state.ts compactChannel: what a channel keeps of conversations that ended before `before` is taken off. `ended` says whether a booking (or order) is over, `keepGuest`
// whether a guest's booking or order still lives. It returns how many things it changed.
func (s *ChannelState) Compact(before int64, ended func(id string) bool, keepGuest func(conversation string) bool) int {
	if s == nil {
		return 0
	}
	changed := 0
	if s.Requests != nil {
		members, ok := topMembers(s.Requests)
		if ok {
			var keep []Member
			for _, m := range members {
				var r struct {
					AtMs    int64   `json:"atMs"`
					Booking *string `json:"booking"`
				}
				_ = json.Unmarshal(m.Raw, &r)
				if r.AtMs >= before || (r.Booking != nil && !ended(*r.Booking)) {
					keep = append(keep, m)
					continue
				}
				changed++
			}
			if len(keep) != len(members) {
				o := newObj()
				o.rest(keep)
				s.Requests = o.done()
			}
		}
	}
	kept := s.Outbox[:0:0]
	for _, m := range s.Outbox {
		if m.AtMs >= before {
			kept = append(kept, m)
		}
	}
	changed += len(s.Outbox) - len(kept)
	s.Outbox = kept
	for _, k := range append([]string{}, s.guestKey...) {
		g := s.chat[k]
		said := g.Said[:0:0]
		for _, m := range g.Said {
			if m.AtMs >= before {
				said = append(said, m)
			}
		}
		changed += len(g.Said) - len(said)
		g.Said = said
		has := false
		for _, m := range s.Outbox {
			has = has || m.To == k
		}
		if len(said) == 0 && !has && (keepGuest == nil || !keepGuest(k)) {
			s.DeleteGuest(k)
			changed++
		}
	}
	return changed
}

// ---- conversations (channels/conversation.ts) ----

// ChatConversationOf is conversation.ts chatConversationOf: "chat:" and 16 hex digits of the guest's hash.
func ChatConversationOf(hash string) string {
	if len(hash) > 16 {
		hash = hash[:16]
	}
	return "chat:" + hash
}

// IsChatConversation is conversation.ts isChatConversation.
func IsChatConversation(c string) bool { return chatConv.MatchString(c) }

// IsChannelConversation is conversation.ts isChannelConversation: a web, MCP or chat conversation (its messages never go to WhatsApp).
func IsChannelConversation(c string) bool { return channelConv.MatchString(c) }

var (
	chatConv    = regexp.MustCompile(`^chat:[0-9a-f]{16}$`)
	channelConv = regexp.MustCompile(`^(?:web|mcp|chat):[0-9a-f]{16}$`)
)
