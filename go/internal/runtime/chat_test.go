// Tests of the chat (modules/channels/chat.ts, state.ts, outbox.ts): a send run as a step of the template, the day's caps, the rates, the thread and its retention, the owner pings, and the
// channel state written back as the TypeScript writes it. They are channels/test/chat.test.ts's own cases (the step world with a fake template step), plus the saved-state round trip.
package runtime

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/budget"
)

var (
	chatNow  = time.Date(2026, 11, 3, 4, 30, 0, 0, time.UTC).UnixMilli() // Tue 3 Nov 2026, 10:00 in India
	india, _ = time.LoadLocation("Asia/Kolkata")
	clockIST = budget.Clock{Now: func() int64 { return chatNow }, Loc: india}
)

const guestHash = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12"

type seenMsg struct {
	text, from string
	reply      *string
	noModel    bool
}

type world struct {
	state *ChannelState
	now   int64
	seen  []seenMsg
	langs []string
	asked bool
	model int64
	t     *testing.T
}

func newWorld(t *testing.T) *world { return &world{state: EmptyChannel(), now: chatNow, t: t} }

func (w *world) turn(e ChatMessage, b *budget.Config) ChatResult {
	e.Handle = guestHash
	if e.Language == "" {
		e.Language = "en"
	}
	if e.ID == "" {
		e.ID = "s-1"
	}
	res, err := ChatTurn(ChatTurnDeps{
		State: w.state, Now: w.now, Day: clockIST.Day, Kind: "bookings", Budget: b, ModelCalls: func() int64 { return w.model },
		Run: func(in ChatInbound) error {
			m := seenMsg{text: in.Text, from: in.From, noModel: in.NoModel}
			if in.Reply != nil {
				m.reply = &in.Reply.ID
				k := in.Reply.Kind
				m.reply = &[]string{in.Reply.ID + "/" + k}[0]
			}
			w.seen = append(w.seen, m)
			if w.asked {
				w.model++
			}
			return nil
		},
		SetLanguage: func(_, l string) { w.langs = append(w.langs, l) },
	}, e)
	if err != nil {
		w.t.Fatal(err)
	}
	return res
}

func text(s string) ChatMessage { return ChatMessage{Text: &s} }
func tap(s string) ChatMessage  { return ChatMessage{Tap: &s} }

func (w *world) thread(after int64, b *budget.Config) ChatThread {
	return ReadChatThread(w.state, guestHash, after, 30, clockIST.Day(w.now), b)
}

func whoText(t ChatThread, who string) []string {
	var out []string
	for _, l := range t.Lines {
		if l.Who == who {
			out = append(out, l.Text)
		}
	}
	return out
}

func TestSendReachesTheTemplatesStepFromTheGuestsConversation(t *testing.T) {
	w := newWorld(t)
	if got := w.turn(text("book a haircut"), nil); got != ChatDone {
		t.Fatal(got)
	}
	if len(w.seen) != 1 || w.seen[0].from != ChatConversationOf(guestHash) || w.seen[0].text != "book a haircut" {
		t.Fatalf("%+v", w.seen)
	}
	if !ChatKnown(w.state, guestHash) {
		t.Fatal("the guest is known after a send")
	}
	th := w.thread(0, nil)
	if !reflect.DeepEqual(whoText(th, "you"), []string{"book a haircut"}) || th.Answered {
		t.Fatalf("%+v", th)
	}
	if !reflect.DeepEqual(w.langs, []string{"en"}) {
		t.Fatal(w.langs)
	}
	if g := w.state.Guest(ChatConversationOf(guestHash)); g.N != 1 || w.state.Guests != 1 {
		t.Fatalf("the first guest is number 1: %+v", g)
	}
}

func TestTheSameSendAgainIsAnsweredOnce(t *testing.T) {
	w := newWorld(t)
	w.turn(ChatMessage{ID: "s-9", Text: ptr("hello")}, nil)
	if got := w.turn(ChatMessage{ID: "s-9", Text: ptr("hello")}, nil); got != ChatRepeat {
		t.Fatal(got)
	}
	if len(w.seen) != 1 || len(w.thread(0, nil).Lines) != 1 {
		t.Fatal("answered twice")
	}
}

func ptr(s string) *string { return &s }

func TestQuickTapIsTheTemplatesCommandAndTheGuestsOwnWords(t *testing.T) {
	w := newWorld(t)
	w.turn(ChatMessage{Quick: 2, Language: "ml"}, nil)
	if w.seen[0].text != chatWords.Quick["bookings"].Command[1] || w.seen[0].text != "book" {
		t.Fatal(w.seen[0].text)
	}
	if got := w.thread(0, nil).Lines[0].Text; got != "സമയം ബുക്ക് ചെയ്യൂ" {
		t.Fatal(got)
	}
}

func TestATapIsReadOnlyIfTheLatestLinesOfferedIt(t *testing.T) {
	w := newWorld(t)
	conv := ChatConversationOf(guestHash)
	w.state.Seq++
	w.state.Outbox = append(w.state.Outbox, OutboxMessage{ID: "ch-1", To: conv, Text: "Which service?", AtMs: chatNow, Choices: []ChatChoice{{ID: "svc:haircut", Title: "Haircut", Hint: "₹450"}, {ID: "slot:1", Title: "5 pm", List: true}}})
	if got := w.turn(ChatMessage{ID: "s-a", Tap: ptr("svc:nothing")}, nil); got != ChatRefused || len(w.seen) != 0 {
		t.Fatal("an id nothing offered does nothing")
	}
	if got := w.turn(ChatMessage{ID: "s-b", Tap: ptr("svc:haircut")}, nil); got != ChatDone {
		t.Fatal(got)
	}
	if *w.seen[0].reply != "svc:haircut/button" || w.seen[0].text != "" {
		t.Fatalf("%+v", w.seen[0])
	}
	w.turn(ChatMessage{ID: "s-c", Tap: ptr("slot:1")}, nil)
	if *w.seen[1].reply != "slot:1/list" {
		t.Fatalf("%+v", w.seen[1])
	}
	if got := whoText(w.thread(0, nil), "you"); !reflect.DeepEqual(got, []string{"Haircut", "5 pm"}) {
		t.Fatal(got)
	}
}

func TestADayOfModelTurnsThenTheRulesAloneThenANewDay(t *testing.T) {
	w := newWorld(t)
	w.asked = true
	for i := 0; i < GuestTurnsBefore62; i++ {
		w.turn(ChatMessage{ID: "s-" + itoa(int64(i)), Text: ptr("question")}, nil)
	}
	for _, m := range w.seen {
		if m.noModel {
			t.Fatal("up to the cap the model may be asked")
		}
	}
	if !w.thread(0, nil).Capped {
		t.Fatal("capped after the day's turns")
	}
	w.turn(ChatMessage{ID: "s-over", Text: ptr("one more")}, nil)
	if !w.seen[len(w.seen)-1].noModel {
		t.Fatal("past the cap the rules alone read")
	}
	w.state.Seq++
	w.state.Outbox = append(w.state.Outbox, OutboxMessage{ID: "ch-" + itoa(w.state.Seq), To: ChatConversationOf(guestHash), Text: "Pick", AtMs: chatNow, Choices: []ChatChoice{{ID: "owner", Title: "Talk to the owner"}}})
	w.turn(ChatMessage{ID: "s-tap", Tap: ptr("owner")}, nil)
	if w.seen[len(w.seen)-1].noModel {
		t.Fatal("a tap is never held back")
	}
	w.now += 24 * 3_600_000
	w.turn(ChatMessage{ID: "s-next", Text: ptr("good morning")}, nil)
	if w.seen[len(w.seen)-1].noModel {
		t.Fatal("tomorrow the model may be asked again")
	}
}

func TestOneGuestsDailyTurnsAreTheBudgetsNumber(t *testing.T) {
	if GuestTurnsPerDay(nil) != 20 || GuestTurnsPerDay(&budget.Config{}) != 20 {
		t.Fatal("the old 20 when the budget has none")
	}
	forty := int64(40)
	b := &budget.Config{MonthlyMicroInr: 30_000_000, GuestTurnsPerDay: &forty}
	if GuestTurnsPerDay(b) != 40 {
		t.Fatal("the budget's number")
	}
	w := newWorld(t)
	w.asked = true
	for i := 0; i < 40; i++ {
		w.turn(ChatMessage{ID: "s-" + itoa(int64(i)), Text: ptr("q")}, b)
	}
	for _, m := range w.seen {
		if m.noModel {
			t.Fatal("the 21st to the 40th may still ask the model")
		}
	}
	if !w.thread(0, b).Capped || !w.thread(0, nil).Capped {
		t.Fatal("capped with the budget, and past the fallback of 20 without it")
	}
	w.turn(ChatMessage{ID: "s-40", Text: ptr("q")}, b)
	if !w.seen[len(w.seen)-1].noModel {
		t.Fatal("the 41st is held back")
	}
}

func TestATurnWithNoModelAskedDoesNotUseUpTheDay(t *testing.T) {
	w := newWorld(t)
	for i := 0; i < GuestTurnsBefore62+5; i++ {
		w.turn(ChatMessage{ID: "s-" + itoa(int64(i)), Text: ptr("menu")}, nil)
	}
	for _, m := range w.seen {
		if m.noModel {
			t.Fatal("no model asked, no turn used")
		}
	}
}

func TestTheDaysSendsInAllAreCapped(t *testing.T) {
	w := newWorld(t)
	for i := 0; i < ChatMessagesPerDay; i++ {
		w.turn(ChatMessage{ID: "s-" + itoa(int64(i)), Text: ptr("hi")}, nil)
	}
	if got := w.turn(ChatMessage{ID: "s-last", Text: ptr("hi")}, nil); got != ChatRefused {
		t.Fatal(got)
	}
}

func TestRatesCountInMemoryAndForgetWithTheWindow(t *testing.T) {
	var now int64
	r := NewRate(func() int64 { return now })
	for i := 0; i < ChatPerMinute; i++ {
		if !r.Take("g", ChatPerMinute, 60_000) {
			t.Fatal("within the minute")
		}
	}
	if r.Take("g", ChatPerMinute, 60_000) {
		t.Fatal("the ninth is refused")
	}
	if !r.Take("other", ChatPerMinute, 60_000) {
		t.Fatal("another guest is counted apart")
	}
	now += 61_000
	if !r.Take("g", ChatPerMinute, 60_000) {
		t.Fatal("the window forgets")
	}
	// the door's order: a refused guest does not use up the shop's count
	r2 := NewRate(func() int64 { return 0 })
	for i := 0; i < ChatPerMinute; i++ {
		r2.ChatAllowed("h", true)
	}
	if r2.ChatAllowed("h", true) {
		t.Fatal("the guest's own minute")
	}
	if len(r2.seen["shop"]) != ChatPerMinute {
		t.Fatalf("the refused send was counted against the shop: %d", len(r2.seen["shop"]))
	}
	r3 := NewRate(func() int64 { return 0 })
	ok := 0
	for i := 0; i < 13; i++ {
		if r3.ChatAllowed("h"+itoa(int64(i)), false) {
			ok++
		}
	}
	if ok != ChatNewGuestsPerHour {
		t.Fatalf("12 new guests an hour, got %d", ok)
	}
}

func TestShopRepliesAreKeptAndOnlyTheLatestLineCarriesItsChoices(t *testing.T) {
	s := EmptyChannel()
	to := ChatConversationOf(guestHash)
	s.Keep(to, "Hello", nil, chatNow)
	s.Keep(to, "Pick one", []ChatChoice{{ID: "a", Title: "A"}, {ID: "b", Title: "B"}}, chatNow)
	s.Keep(to, "Which time?", []ChatChoice{{ID: "t1", Title: "5 pm", Hint: "free", List: true}}, chatNow)
	s.Keep("web:0123456789abcdef", "A booking's page line", []ChatChoice{{ID: "x", Title: "X"}}, chatNow)
	th := ReadChatThread(s, guestHash, 0, 30, "x", nil)
	if got := whoText(th, "shop"); !reflect.DeepEqual(got, []string{"Hello", "Pick one", "Which time?"}) {
		t.Fatal(got)
	}
	if th.Lines[0].Choices != nil || th.Lines[1].Choices != nil {
		t.Fatal("an older line's buttons are no longer on offer")
	}
	if !reflect.DeepEqual(th.Lines[2].Choices, []ChatChoice{{ID: "t1", Title: "5 pm", Hint: "free", List: true}}) || !th.Answered || !ChatAnswered(s, guestHash) {
		t.Fatalf("%+v", th)
	}
	if s.Outbox[3].Choices != nil {
		t.Fatal("only a chat thread keeps the choices")
	}
}

func TestAReloadIsTheSameAndAReaderWithTheLastNumberGetsOnlyWhatIsNewer(t *testing.T) {
	w := newWorld(t)
	to := ChatConversationOf(guestHash)
	w.turn(ChatMessage{ID: "s-1", Text: ptr("hi")}, nil)
	w.state.Keep(to, "Hello!", nil, chatNow+1)
	w.turn(ChatMessage{ID: "s-2", Text: ptr("price?")}, nil)
	all := w.thread(0, nil)
	var texts []string
	for _, l := range all.Lines {
		texts = append(texts, l.Text)
	}
	if !reflect.DeepEqual(texts, []string{"hi", "Hello!", "price?"}) {
		t.Fatal(texts)
	}
	after := w.thread(all.Lines[1].N, nil)
	if len(after.Lines) != 1 || after.Lines[0].Text != "price?" {
		t.Fatalf("%+v", after)
	}
}

func TestAnUnknownGuestHasAnEmptyThread(t *testing.T) {
	w := newWorld(t)
	other := strings.Repeat("e", 64)
	if th := ReadChatThread(w.state, other, 0, 30, "x", nil); len(th.Lines) != 0 || ChatKnown(w.state, other) || th.Answered || th.Capped {
		t.Fatalf("%+v", th)
	}
	if th := ReadChatThread(nil, other, 0, 30, "x", nil); len(th.Lines) != 0 {
		t.Fatal("no state at all")
	}
}

func TestTheThreadIsCappedAndRetentionForgetsAGuestWithNoLineLeft(t *testing.T) {
	w := newWorld(t)
	for i := 0; i < ChatThreadMax+10; i++ {
		w.turn(ChatMessage{ID: "s-" + itoa(int64(i)), Text: ptr("m")}, nil)
	}
	if n := len(w.state.Guest(ChatConversationOf(guestHash)).Said); n != ChatThreadMax {
		t.Fatalf("%d lines kept", n)
	}
	if changed := w.state.Compact(chatNow+1, func(string) bool { return true }, nil); changed == 0 {
		t.Fatal("nothing changed")
	}
	if w.state.ChatLen() != 0 || ChatKnown(w.state, guestHash) {
		t.Fatal("the guest, its day and its counts are gone")
	}
	if strings.Contains(string(w.state.Marshal()), `"chat"`) {
		t.Fatal("and the member goes with the last guest")
	}
}

func TestDeleteMyChatTakesTheWordsAndTheGuestOff(t *testing.T) {
	w := newWorld(t)
	to := ChatConversationOf(guestHash)
	w.turn(ChatMessage{ID: "s-1", Text: ptr("hi")}, nil)
	w.state.Keep(to, "Hello!", nil, chatNow)
	w.state.Keep("web:0123456789abcdef", "keep me", nil, chatNow)
	if got := w.turn(ChatMessage{ID: "f-1", Forget: true}, nil); got != ChatDone {
		t.Fatal(got)
	}
	if len(w.thread(0, nil).Lines) != 0 || len(w.state.Outbox) != 1 || w.state.Outbox[0].Text != "keep me" || ChatKnown(w.state, guestHash) {
		t.Fatalf("%+v", w.state)
	}
}

func TestAGuestCanMakeTheShopTellTheOwnerOnlyAFewTimesADay(t *testing.T) {
	w := newWorld(t)
	w.turn(ChatMessage{ID: "s-1", Text: ptr("hi")}, nil)
	to := ChatConversationOf(guestHash)
	for i := 0; i < ChatPingsPerDay; i++ {
		if r := ChatPingBlock(w.state, "owner", to, []string{"owner_wants_to_talk"}, chatNow, clockIST.Day); r != "" {
			t.Fatalf("ping %d held: %s", i, r)
		}
	}
	if r := ChatPingBlock(w.state, "owner", to, []string{"owner_upi_claim"}, chatNow, clockIST.Day); !strings.Contains(r, "3 times today") {
		t.Fatalf("the fourth is held: %q", r)
	}
	if ChatPingBlock(w.state, "owner", to, []string{"refund_owed"}, chatNow, clockIST.Day) != "" || ChatPingBlock(w.state, "customer", to, []string{"owner_wants_to_talk"}, chatNow, clockIST.Day) != "" ||
		ChatPingBlock(w.state, "owner", "+919811111111", []string{"owner_wants_to_talk"}, chatNow, clockIST.Day) != "" {
		t.Fatal("other messages and other conversations are not limited")
	}
	tomorrow := chatNow + 24*3_600_000
	if r := ChatPingBlock(w.state, "owner", to, []string{"owner_wants_to_talk"}, tomorrow, clockIST.Day); r != "" {
		t.Fatalf("the next day counts again: %q", r)
	}
}

func TestAVoiceSendCountsAsAModelTurnAndTheHeardWordsBecomeTheBubble(t *testing.T) {
	w := newWorld(t)
	var heard func(string)
	res, err := ChatTurn(ChatTurnDeps{
		State: w.state, Now: w.now, Day: clockIST.Day, Kind: "bookings", ModelCalls: func() int64 { return 0 },
		Audio: func(ref string) *PageAudio { return &PageAudio{Bytes: []byte("x"), Mime: "audio/ogg; codecs=opus"} },
		Run:   func(in ChatInbound) error { heard = in.OnHeard; return nil },
	}, ChatMessage{ID: "v-1", Handle: guestHash, Language: "hi", Voice: ptr("ref-1")})
	if err != nil || res != ChatDone {
		t.Fatal(res, err)
	}
	g := w.state.Guest(ChatConversationOf(guestHash))
	if g.Said[0].Text != "आवाज़ का संदेश" || g.Turns != 1 {
		t.Fatalf("%+v", g)
	}
	heard("  I want a haircut  ")
	if g.Said[0].Text != "I want a haircut" {
		t.Fatalf("%q", g.Said[0].Text)
	}
	heard("   ")
	if g.Said[0].Text != "आवाज़ का संदेश" {
		t.Fatalf("a blank hearing keeps the words the bubble had: %q", g.Said[0].Text)
	}
}

// the saved state: the TypeScript's own text (members in its order, no HTML escaping, a key this version does not know carried through) comes back as it was
func TestChannelStateRoundTrips(t *testing.T) {
	in := `{"seq":3,"outbox":[{"id":"ch-2","to":"chat:0123456789abcdef","text":"Tea <free> & more","atMs":5,"choices":[{"id":"a","title":"A"},{"id":"t","title":"5 pm","hint":"free","list":true}],"moment":"confirmed","future":{"x":1}}],"requests":{"h":{"atMs":1,"channel":"web"}},"chat":{"chat:0123456789abcdef":{"startedMs":1,"lastMs":2,"said":[{"id":"ch-1","cid":"s-1","text":"hi","atMs":1,"extra":true}],"day":"2026-11-03","turns":1,"messages":2,"n":1,"pingDay":"2026-11-03","pings":2,"more":[1]}},"guests":1,"another":"kept"}`
	s, err := ParseChannel([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(s.Marshal()); got != in {
		t.Fatalf("round trip:\n%s\nwant\n%s", got, in)
	}
	// a state with no chat yet is written without one, as emptyChannelState is
	fresh, _ := ParseChannel(nil)
	if got := string(fresh.Marshal()); got != `{"seq":0,"outbox":[],"requests":{}}` {
		t.Fatal(got)
	}
	// and a step that makes the first guest adds chat, then guests, after what was there
	w := newWorld(t)
	w.turn(ChatMessage{ID: "s-1", Text: ptr("hi")}, nil)
	if got := string(w.state.Marshal()); !strings.HasPrefix(got, `{"seq":1,"outbox":[],"requests":{},"chat":{"chat:`) || !strings.HasSuffix(got, `,"guests":1}`) {
		t.Fatal(got)
	}
	if _, err := ParseChannel([]byte(`[1]`)); err == nil {
		t.Fatal("not an object")
	}
}

func TestEventsAreReadIntoAChatMessage(t *testing.T) {
	ev, why := CheckChannelEvent(map[string]any{"kind": "chat_message", "id": "s-1", "handle": guestHash, "language": "hi", "quick": float64(3)})
	if why != "" {
		t.Fatal(why)
	}
	m := ChatMessageOf(ev)
	if m.ID != "s-1" || m.Handle != guestHash || m.Language != "hi" || m.Quick != 3 || m.Text != nil || m.Forget {
		t.Fatalf("%+v", m)
	}
	ev, _ = CheckChannelEvent(map[string]any{"kind": "chat_message", "id": "s-2", "handle": guestHash, "language": "en", "forget": true, "voice": "from the outside"})
	if m := ChatMessageOf(ev); !m.Forget || m.Voice != nil {
		t.Fatalf("a voice from outside is dropped: %+v", m)
	}
}
