package runtime

// The chat on the shop's page, the shop's side of it (modules/channels/chat.ts; W1, 17 Nov 2026): what one guest's thread is, how a send is run as a step, and what the page may read back.
// Generic: Bookings, Orders and Fees share it (it is the runtime's, not a template's), as chat.ts is the channels module's.
//
// A guest on the shop's page is a second door to the SAME assistant a WhatsApp customer reaches, so a chat send is not handled here: ChatTurn only turns it into the InboundMessage a
// WhatsApp customer would have sent (from: the guest's own conversation, "chat:" and 16 hex digits of the guest's hash) and hands it to the template's own message step (`Run`).
// That step does what it always does: the template's flow first, then the customer's talk with all its checks, then the menu. Replies are written by the template's say and kept by the
// channel's outbox (chatstate.go Keep), which a chat thread reads back.
//
// What this adds, and nothing more: the guest's own lines (`said`, in order with the shop's by one counter), the retry that is answered once (a send's id), a tap checked against what the
// shop offered, and the day's caps that must be saved (typed sends that may ask the model, and sends in all). The per-minute rate is in memory, at the runtime's door (Rate), because a
// restart forgetting it costs nothing; a cap that must hold across restarts is in the saved state.
//
// Where Go differs from JavaScript on purpose: lengths of text are counted in UTF-16 units where chat.ts says `.length` and in code points where it says `[...x]`.

import (
	_ "embed"
	"encoding/json"
	"sort"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

// The limits of the chat (chat.ts CHAT_LIMITS). The door's per-address limits are the front's; these are the runtime's. A guest's handle costs nothing to make, so none of them rests on
// the handle alone: the shop-wide ones bound a flood of new handles.
const (
	ChatMessagesPerDay   = 150 // sends of any kind per guest per day: a saved cap, so a restart does not forget it
	ChatPerMinute        = 8   // sends per guest per minute, in memory
	ChatNewGuestsPerHour = 12  // guests never seen before, per shop per hour, in memory
	ChatShopPer10Min     = 300 // sends from every guest of the shop together, per ten minutes, in memory
	ChatPingsPerDay      = 3   // times one guest may make the shop tell the owner (on WhatsApp) per day: a saved cap
)

// GuestTurnsBefore62 is chat.ts GUEST_TURNS_BEFORE_62: used only for a shop whose runtime.json has no `budget.guestTurnsPerDay` (decision 62); it goes when every price list in force has the entry.
const GuestTurnsBefore62 = 20

// GuestTurnsPerDay is chat.ts guestTurnsPerDay: typed sends that may ask the model, per guest per day; after it the rules and the buttons answer.
func GuestTurnsPerDay(b *budget.Config) int64 {
	if b != nil && b.GuestTurnsPerDay != nil {
		return *b.GuestTurnsPerDay
	}
	return GuestTurnsBefore62
}

// tapWindow is how many of the shop's latest lines a tap may name: a button from the line before last is still fair, one from an hour ago is not.
const tapWindow = 4

// The chat's own words (words-chat.ts CHAT.rate, QUICK, words-chat-more.ts voiceNote), written by go/scripts/gen_chat_words.ts.
//
//go:embed chatwords/words.json
var chatWordsJSON []byte

var chatWords = func() (w struct {
	Rate      map[string]string `json:"rate"`
	VoiceNote map[string]string `json:"voiceNote"`
	Guest     map[string]string `json:"guest"`
	Quick     map[string]struct {
		Command []string            `json:"command"`
		Label   map[string][]string `json:"label"`
	} `json:"quick"`
}) {
	if err := json.Unmarshal(chatWordsJSON, &w); err != nil {
		panic("runtime: chatwords/words.json: " + err.Error())
	}
	return
}()

// ChatRateWords is chat.ts chatRateWords: the page's own words for a send that failed to start, in the guest's language.
func ChatRateWords(lang string) string { return chatWords.Rate[lang] }

// ChatMessage is a chat_message event (channels/events.ts ChatMessage), read from the saved event.
type ChatMessage struct {
	ID, Handle, Language string
	Text                 *string
	Tap                  *string
	Quick                int // 1 to 3; 0: none
	Forget               bool
	Parent               string
	Voice                *string // the reference of a recording the runtime holds in memory: set only by the runtime's own HTTP layer
}

// ChatMessageOf reads the saved event (already checked by CheckChannelEvent).
func ChatMessageOf(ev map[string]any) ChatMessage {
	str := func(k string) *string {
		if s, ok := ev[k].(string); ok {
			return &s
		}
		return nil
	}
	m := ChatMessage{Text: str("text"), Tap: str("tap"), Voice: str("voice")}
	m.ID, _ = ev["id"].(string)
	m.Handle, _ = ev["handle"].(string)
	m.Language, _ = ev["language"].(string)
	m.Parent, _ = ev["parent"].(string)
	if q, ok := ev["quick"].(float64); ok {
		m.Quick = int(q)
	}
	m.Forget = ev["forget"] == true
	return m
}

// PageAudio is a guest's recording (voice/turn.ts PageAudio): the bytes and the type the runtime wrote.
type PageAudio struct {
	Bytes []byte
	Mime  string
	// Ref is the reference the event carried (the owner's page recording: the voice service answers a step that runs again from memory by it)
	Ref string
}

// ChatInbound is what a chat send turns into: the message a WhatsApp customer would have sent, and what only a chat has (messaging.go leaves `Audio` and `OnHeard` to the chat channel).
type ChatInbound struct {
	messaging.InboundMessage
	// Audio is the guest's recording, handed over only while the day's model turns last (listening is paid).
	Audio *PageAudio
	// OnHeard is told the words heard in a recording, so the guest's bubble shows them.
	OnHeard func(heard string)
}

// ChatResult is what a send turned into: Done, Repeat (this id was already answered), or Refused (a tap nothing offered, or the day's sends are used up).
type ChatResult string

const (
	ChatDone    ChatResult = "done"
	ChatRepeat  ChatResult = "repeat"
	ChatRefused ChatResult = "refused"
)

// ChatTurnDeps is chat.ts ChatTurnDeps.
type ChatTurnDeps struct {
	State *ChannelState
	// ModelCalls is the month's model-asking steps counted so far (the decision step and the language model; the rules cost nothing): `s.decision + s.model` of the AI state. A turn counts
	// against the day's model turns only when a model was really asked during it.
	ModelCalls func() int64
	Now        int64
	// Day is chat.ts chatDay: the shop's day for a moment (budget.Clock.Day).
	Day  func(ms int64) string
	Kind string // "bookings", "orders" or "fees": which quick taps
	// Run is the template's own message step: the same step a WhatsApp customer's message takes.
	Run func(in ChatInbound) error
	// SetLanguage sets the guest's language (the page's) before the step, so the first answer is in it.
	SetLanguage func(conversation, language string)
	// Audio is hold-to-talk: the recording a send's `voice` reference names, from the runtime's memory. Nil: the shop has no voice service.
	Audio  func(ref string) *PageAudio
	Budget *budget.Config
}

// ChatTurn is chat.ts chatTurn: run one send as a step of the template. Idempotent: a send with an id the thread already has is answered once (Repeat). A tap must name a choice among the
// shop's latest lines. The guest's line is kept first, so the thread shows it whatever the step then does; NoModel is set on the message once the day's model turns are used, so the rules and
// the buttons answer and the talk model is not asked. An error is the template's step's: the caller's step is then thrown away whole, as in TypeScript.
func ChatTurn(d ChatTurnDeps, e ChatMessage) (ChatResult, error) {
	conversation := ChatConversationOf(e.Handle)
	if e.Forget { // before anything is made or counted: a deleted chat leaves no guest behind
		ForgetChat(d.State, conversation)
		return ChatDone, nil
	}
	day := d.Day(d.Now)
	guest := d.State.ensureGuest(conversation, d.Now, day)
	for _, m := range guest.Said {
		if m.CID == e.ID {
			return ChatRepeat, nil
		}
	}
	if guest.Day != day {
		guest.Day, guest.Turns, guest.Messages = day, 0, 0
	}
	if guest.Messages >= ChatMessagesPerDay {
		return ChatRefused, nil
	}

	text, say := "", ""
	var reply *messaging.Reply
	switch {
	case e.Voice != nil:
		// hold-to-talk: the bubble says "Voice message" until the agent's own listener has heard it (OnHeard below puts the words in), so the guest never sees a blank
		say = chatWords.VoiceNote[e.Language]
	case e.Tap != nil:
		var offered *ChatChoice
		var mine []ChatChoice
		var lines []OutboxMessage
		for _, m := range d.State.Outbox {
			if m.To == conversation {
				lines = append(lines, m)
			}
		}
		if len(lines) > tapWindow {
			lines = lines[len(lines)-tapWindow:]
		}
		for _, m := range lines {
			mine = append(mine, m.Choices...)
		}
		for i := range mine {
			if mine[i].ID == *e.Tap {
				offered = &mine[i]
				break
			}
		}
		if offered == nil {
			return ChatRefused, nil // nothing offered this: it is not read as words either, so a made-up id does nothing
		}
		say, text = offered.Title, offered.Title
		kind := "button"
		if offered.List {
			kind = "list"
		}
		reply = &messaging.Reply{ID: offered.ID, Kind: kind}
	case e.Quick != 0:
		q := chatWords.Quick[d.Kind]
		text = q.Command[e.Quick-1]
		say = q.Label[e.Language][e.Quick-1]
	default:
		if e.Text != nil {
			text, say = *e.Text, *e.Text
		}
	}

	d.State.Seq++
	guest.Said = append(guest.Said, ChatSaid{ID: "ch-" + itoa(d.State.Seq), CID: e.ID, Text: say, AtMs: d.Now})
	if len(guest.Said) > ChatThreadMax {
		guest.Said = append(guest.Said[:0:0], guest.Said[len(guest.Said)-ChatThreadMax:]...)
	}
	line := &guest.Said[len(guest.Said)-1] // the bubble OnHeard may rewrite
	guest.Messages++
	guest.LastMs = d.Now
	if guest.N == 0 {
		guest.N = d.State.NextGuestNumber() // the owner's name for this guest, "Chat guest 3", given once at the first send
	}
	if d.SetLanguage != nil {
		d.SetLanguage(conversation, e.Language)
	}

	capped := guest.Turns >= GuestTurnsPerDay(d.Budget)
	before := d.ModelCalls()
	// a recording is listened to only while the day's model turns last, and always counts as one of them (listening is paid, whatever the words then need); a capped guest's recording is not
	// handed over, so the agent answers it as it answers a note it could not use: with the line asking them to type
	var audio *PageAudio
	if e.Voice != nil && !capped && d.Audio != nil {
		audio = d.Audio(*e.Voice)
	}
	in := ChatInbound{InboundMessage: messaging.InboundMessage{ID: conversation + ":" + e.ID, From: conversation, Timestamp: d.Now, Reply: reply}}
	if reply == nil {
		in.Text = text
		in.NoModel = capped
	}
	if e.Voice != nil {
		in.VoiceNote = true
		if audio != nil {
			in.Audio = audio
			sayWas := say
			in.OnHeard = func(heard string) { // `[...heard.trim()].slice(0, CHAT_TEXT_MAX).join("")`: code points
				words := []rune(language.TrimJS(heard))
				if len(words) > ChatTextMax {
					words = words[:ChatTextMax]
				}
				if len(words) == 0 {
					line.Text = sayWas
				} else {
					line.Text = string(words)
				}
			}
		}
	}
	if err := d.Run(in); err != nil {
		return ChatDone, err
	}
	if reply == nil && ((e.Voice != nil && audio != nil) || d.ModelCalls() > before) {
		guest.Turns++
	}
	return ChatDone, nil
}

// ForgetChat is chat.ts forgetChat, W2 "delete my chat": the thread's words go, the guest's own lines and the shop's lines to it, with the day's counts. The record keeps its digests and the
// bookings and payments keep what the law needs.
func ForgetChat(s *ChannelState, conversation string) {
	s.DeleteGuest(conversation)
	kept := s.Outbox[:0:0]
	for _, m := range s.Outbox {
		if m.To != conversation {
			kept = append(kept, m)
		}
	}
	s.Outbox = kept
}

// ---- the caps that must be saved: the owner pings ----

// GuestPings are the owner notices a chat guest can start (chat.ts GUEST_PINGS): they asked to talk, sent STOP, a UPI hold was made, they say they paid.
var GuestPings = []string{"owner_wants_to_talk", "owner_opted_out", "owner_upi_expected", "owner_upi_claim"}

// ChatPingBlock is chat.ts chatPingGate for a message to the owner about a chat guest: the owner notices a guest can start are bounded per guest per day (ChatPingsPerDay). It returns the
// reason of the "chat-pings-per-guest" block, or "" when the message is not held here. Work the owner must see anyway (a refund, a payment already marked) is not in the list and is never held.
// It counts the ping when it says yes (as chatMayPing does), so call it once per message.
func ChatPingBlock(s *ChannelState, to, phone string, templates []string, now int64, day func(ms int64) string) string {
	if to != "owner" || !IsChatConversation(phone) {
		return ""
	}
	listed := false
	for _, t := range templates {
		for _, p := range GuestPings {
			listed = listed || t == p
		}
	}
	if !listed || ChatMayPing(s, phone, now, day) {
		return ""
	}
	return "this chat guest has already made the shop tell the owner " + itoa(ChatPingsPerDay) + " times today; no more today (the owner's page still lists whatever waits for them)"
}

// ChatMayPing is chat.ts chatMayPing: may the shop tell the owner about this chat guest now? Counts the ping when it says yes. A conversation the shop does not hold is not limited.
func ChatMayPing(s *ChannelState, conversation string, now int64, day func(ms int64) string) bool {
	g := s.Guest(conversation)
	if g == nil {
		return true
	}
	today := day(now)
	if g.PingDay == nil || *g.PingDay != today {
		zero := int64(0)
		g.PingDay, g.Pings = &today, &zero
	}
	if g.Pings != nil && *g.Pings >= ChatPingsPerDay {
		return false
	}
	var n int64
	if g.Pings != nil {
		n = *g.Pings
	}
	n++
	g.Pings = &n
	return true
}

// ---- reading a thread ----

// ChatLine is one line of a thread as the page reads it: N is its place in the conversation (the shared counter), Who which side.
type ChatLine struct {
	N       int64
	Who     string // "you" or "shop"
	Text    string
	AtMs    int64
	CID     string
	Choices []ChatChoice
	Moment  string
}

// ChatThread is what a thread read gives the page (chat.ts ChatThread).
type ChatThread struct {
	Lines         []ChatLine
	Answered      bool // the guest has had at least one answer: only then are alerts offered
	Capped        bool // the guest's own counts for today, so the page can say "the buttons still work" before the guest hits the cap
	RetentionDays int
}

func numberOf(id string) int64 {
	n := int64(0)
	if len(id) < 3 {
		return 0
	}
	for _, c := range id[3:] {
		if c < '0' || c > '9' {
			return 0 // `Number("x") || 0`
		}
		n = n*10 + int64(c-'0')
	}
	return n
}

// ChatKnown is chat.ts chatKnown: a conversation the runtime knows (a guest who has sent something and whose thread has not been cleared).
func ChatKnown(s *ChannelState, hash string) bool { return s.Guest(ChatConversationOf(hash)) != nil }

// ChatAnswered is chat.ts chatAnswered: has the shop said anything to this guest yet?
func ChatAnswered(s *ChannelState, hash string) bool {
	if s == nil {
		return false
	}
	c := ChatConversationOf(hash)
	for _, m := range s.Outbox {
		if m.To == c {
			return true
		}
	}
	return false
}

// ReadChatThread is chat.ts chatThread: the shop's lines (the outbox) and the guest's own, in order, after `after` (0: all). Only the latest line carries its choices (an older line's buttons
// are no longer on offer to draw). An unknown guest has an empty thread: the same answer for a guest never seen and for one at another shop, so a made-up handle learns nothing.
func ReadChatThread(s *ChannelState, hash string, after int64, retentionDays int, day string, b *budget.Config) ChatThread {
	conversation := ChatConversationOf(hash)
	guest := s.Guest(conversation)
	var lines []ChatLine
	shops := 0
	if s != nil {
		for _, m := range s.Outbox {
			if m.To == conversation {
				shops++
				lines = append(lines, ChatLine{N: numberOf(m.ID), Who: "shop", Text: m.Text, AtMs: m.AtMs, Choices: m.Choices, Moment: m.Moment})
			}
		}
	}
	if guest != nil {
		for _, m := range guest.Said {
			lines = append(lines, ChatLine{N: numberOf(m.ID), Who: "you", Text: m.Text, AtMs: m.AtMs, CID: m.CID})
		}
	}
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].N < lines[j].N })
	out := []ChatLine{}
	for i, l := range lines {
		if l.N <= after {
			continue
		}
		if i != len(lines)-1 {
			l.Choices = nil
		}
		out = append(out, l)
	}
	return ChatThread{Lines: out, Answered: shops > 0, Capped: guest != nil && guest.Day == day && guest.Turns >= GuestTurnsPerDay(b), RetentionDays: retentionDays}
}

// JSON writes a thread as the page reads it (the keys in the order chat.ts makes them).
func (t ChatThread) JSON() *objWriter {
	o := newObj()
	lines := make([]string, len(t.Lines))
	for i, l := range t.Lines {
		lo := newObj()
		lo.put("n", itoa(l.N))
		lo.put("who", jtext(l.Who))
		lo.put("text", jtext(l.Text))
		lo.put("atMs", itoa(l.AtMs))
		if l.CID != "" {
			lo.put("cid", jtext(l.CID))
		}
		if len(l.Choices) > 0 {
			lo.put("choices", choicesJSON(l.Choices))
		}
		if l.Moment != "" {
			lo.put("moment", jtext(l.Moment))
		}
		lines[i] = string(lo.done())
	}
	o.put("lines", "["+joinComma(lines)+"]")
	o.put("answered", jbool(t.Answered))
	o.put("capped", jbool(t.Capped))
	o.put("retentionDays", itoa(int64(t.RetentionDays)))
	return o
}

func jbool(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// ---- the rates, in memory ----

// Rate is chat.ts createRate: a rate counter by key (a guest's hash, or the shop), in memory. Take says whether one more is allowed in the window and counts it. Used at the runtime's door,
// before a send is saved as a task, so a flood saves nothing and costs no step.
type Rate struct {
	now  func() int64
	mu   sync.Mutex
	seen map[string][]int64
}

// NewRate makes a counter over a clock (nil: the system's).
func NewRate(now func() int64) *Rate { return &Rate{now: now, seen: map[string][]int64{}} }

// Take is `take(key, max, perMs)`.
func (r *Rate) Take(key string, max int, perMs int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.now()
	var times []int64
	for _, x := range r.seen[key] {
		if t-x < perMs {
			times = append(times, x)
		}
	}
	if len(times) >= max {
		r.seen[key] = times
		return false
	}
	r.seen[key] = append(times, t)
	if len(r.seen) > 5_000 { // a flood of keys cannot grow it without bound
		for k, v := range r.seen {
			all := true
			for _, x := range v {
				all = all && t-x >= perMs
			}
			if all {
				delete(r.seen, k)
			}
		}
	}
	return true
}

// ChatAllowed is the runtime's door for a chat send (http.ts chatAllowed): the guest's own minute, the shop's ten minutes and, for a guest the shop has never seen, the hour's new guests. The
// calls are made in this order and stop at the first that says no, as the TypeScript's `&&` chain does (a refused guest does not use up the shop's count).
func (r *Rate) ChatAllowed(handle string, known bool) bool {
	return r.Take("g "+handle, ChatPerMinute, 60_000) && r.Take("shop", ChatShopPer10Min, 10*60_000) && (known || r.Take("new", ChatNewGuestsPerHour, 60*60_000))
}
