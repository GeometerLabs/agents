package parts

// The shop's agent over one step: each part's own agent over its own state (made when it is first needed, on its own step context: its state, its view of the record, its
// settings, and the other parts' skills for the one assistant), and the router in front of them. An event goes to exactly ONE part, so one inbound message makes one
// receive_message line, by the part that reads it (what the cost meter counts), and a part's failure in its step is that step's alone.
//
// How each kind of event finds its part:
//   - a WhatsApp message (`message`) and the owner's words on their page (`owner_message`, the talk box and the credit book's box): the router (router.go), over each part's
//     claim (runtime.PartAgent ClaimOwner / ClaimCustomer); a tap on one of the shop's assistant's cards goes to the part whose skill made the card;
//   - the owner's press on their page (`owner_action`): the part that owns the case (a card's press: the part whose skill made the card);
//   - the page's request (`channel_request`): the part that takes its op; a chat guest's message (`chat_message`): the customer part (kit.go customerPart);
//   - a payment event, an approval's decision and the panel's recovery: the part that owns the case they name; when no single part does, nothing is done and the record says so
//     (a parts shop takes no payment gateway yet, so these do not come in normal running);
//   - anything else: the first part, as a single-part shop of it would take it.

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

type agent struct {
	k        *Kit
	c        *runtime.StepContext
	st       *State
	rec      *runtime.Recorder // the router's own lines (refs.part "parts"): no part reads them back
	ctxs     []*runtime.StepContext
	agents   []runtime.PartAgent
	creating []bool
}

// RouterPart is the name the router's own record lines carry in refs.part.
const RouterPart = "parts"

var (
	_ runtime.AfterTicker = (*agent)(nil)
	_ runtime.AfterSaver  = (*agent)(nil)
)

// NewAgent is the shop's agent over one step.
func (k *Kit) NewAgent(c *runtime.StepContext) runtime.Agent {
	st := k.stateOf(c.State)
	a := &agent{k: k, c: c, st: st, rec: c.Rec.Part(RouterPart, false, true), agents: make([]runtime.PartAgent, len(k.parts)), creating: make([]bool, len(k.parts))}
	for i, p := range k.parts {
		cc := *c
		cc.State = st.parts[i]
		cc.Rec = c.Rec.Part(p.Name, p.Name == k.carried, i != 0)
		cc.Settings = p.Shared
		var co []func() (runtime.AssistantHooks, bool)
		for j := range k.parts {
			if j == i {
				continue
			}
			co = append(co, func() (runtime.AssistantHooks, bool) {
				if pa := a.part(j); pa != nil {
					return pa.AssistantHooks()
				}
				return runtime.AssistantHooks{}, false
			})
		}
		cc.SetCoParts(co)
		cc.SetLimitPart(p.Name)
		cc.SetCaseHeldElsewhere(func(conversation string) bool { return a.holdsCase(conversation, i) })
		a.ctxs = append(a.ctxs, &cc)
	}
	return a
}

// part is part i's agent, made on first use. One that is being made (its template made its assistant while it was being made) is not there yet: its skill is left out of
// that assistant, never made twice.
func (a *agent) part(i int) runtime.PartAgent {
	if a.agents[i] == nil && !a.creating[i] {
		a.creating[i] = true
		ag := a.k.parts[i].Kit.NewAgent(a.ctxs[i])
		a.creating[i] = false
		pa, ok := ag.(runtime.PartAgent)
		if !ok {
			panic("internal/parts: the " + a.k.parts[i].Name + " template's agent cannot be a part (runtime.PartAgent)")
		}
		a.agents[i] = pa
	}
	return a.agents[i]
}

func (a *agent) now() int64 { return a.c.Now() }

// line writes one of the router's own lines.
func (a *agent) line(conversation, action, outcome string, inputs any, refs map[string]string, notes string) {
	a.rec.Append(runtime.NewLine{Conversation: conversation, Action: action, Outcome: outcome, Inputs: inputs, Refs: refs, Notes: notes})
}

// Handle finds the event's part and hands it the event.
func (a *agent) Handle(ev map[string]any) error {
	kind, _ := ev["kind"].(string)
	switch kind {
	case "message":
		var m messaging.InboundMessage
		raw, _ := json.Marshal(ev["message"])
		if err := json.Unmarshal(raw, &m); err != nil {
			return err
		}
		return a.onMessage(ev, m)
	case "owner_message":
		id, _ := ev["id"].(string)
		text, _ := ev["text"].(string)
		number, _ := a.c.Owner()
		return a.onMessage(ev, messaging.InboundMessage{ID: "owner-page:" + id, From: number, Text: text})
	case "owner_action":
		return a.onOwnerAction(ev)
	case "chat_message":
		if i := a.k.customerPart(); i >= 0 {
			return a.give(i, ev)
		}
		return a.unrouted(ev, "a chat guest's message, and the shop has no part with a page that chats")
	case "channel_request":
		op, _ := ev["op"].(string)
		for i := range a.k.parts {
			if a.part(i).TakesChannel(op) {
				return a.give(i, ev)
			}
		}
		return a.unrouted(ev, "a page's request ("+op+") that no part of the shop takes")
	case "payment_event", "approval_decision", "recovery":
		if i := a.ownerOfRefs(ev); i >= 0 {
			return a.give(i, ev)
		}
		return a.unrouted(ev, "a "+kind+" whose case no single part of the shop owns")
	}
	return a.give(0, ev)
}

// give hands the event to part i. A step that can neither wait nor run again (runtime.EndTask) carries the state it threw away so its id counters are kept (B75): the part's
// own state is put into the shop's, so the runtime's KeepCounters reads it as the shop's.
func (a *agent) give(i int, ev map[string]any) error {
	err := a.part(i).Handle(ev)
	var end *runtime.EndTask
	if errors.As(err, &end) && end.Taken != nil {
		if _, isShop := end.Taken.(*State); !isShop {
			taken := *a.st
			taken.parts = append([]runtime.KitState(nil), a.st.parts...)
			taken.parts[i] = end.Taken
			end.Taken = &taken
		}
	}
	return err
}

// unrouted writes that an event was not handed to any part, and why; nothing else is done.
func (a *agent) unrouted(ev map[string]any, why string) error {
	kind, _ := ev["kind"].(string)
	number, _ := a.c.Owner()
	a.line(number, "route_event", "blocked", map[string]any{"kind": kind}, map[string]string{"kind": kind}, why+": nothing was done")
	return nil
}

// ownerOfRefs is the one part that owns a case the event names ("case", or the receipt or approval's case before its ":"), or -1.
func (a *agent) ownerOfRefs(ev map[string]any) int {
	var refs []string
	var walk func(v any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, val := range x {
				if s, ok := val.(string); ok && (k == "case" || k == "booking" || k == "approval" || k == "receipt" || k == "reference") {
					refs = append(refs, s)
					if i := strings.IndexByte(s, ':'); i > 0 {
						refs = append(refs, s[:i])
					}
				}
				walk(val)
			}
		case []any:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(ev)
	found := -1
	for i := range a.k.parts {
		for _, r := range refs {
			if a.part(i).OwnsCase(r) {
				if found >= 0 && found != i {
					return -1
				}
				found = i
			}
		}
	}
	return found
}

// onOwnerAction: the press's case decides the part; a card's press goes to the part whose skill made the card, else the first part (whose assistant hosts every skill).
func (a *agent) onOwnerAction(ev map[string]any) error {
	action, _ := ev["action"].(string)
	cs, _ := ev["case"].(string)
	if action == "card_yes" || action == "card_no" {
		if i := a.cardPart(a.cardByID(cs)); i >= 0 {
			return a.give(i, ev)
		}
		return a.give(0, ev)
	}
	found := -1
	for i := range a.k.parts {
		if a.part(i).OwnsCase(cs) {
			if found >= 0 {
				return a.unrouted(ev, "the owner's press on "+cs+", which two parts could own")
			}
			found = i
		}
	}
	if found < 0 {
		return a.unrouted(ev, "the owner's press on "+cs+", which no part of the shop owns")
	}
	return a.give(found, ev)
}

// cardByID and cardByCode find a card of the shop's one assistant.
func (a *agent) cardByID(id string) *assistant.Card {
	if a.c.Snap == nil || a.c.Snap.A == nil {
		return nil
	}
	for i := range a.c.Snap.A.Cards {
		if a.c.Snap.A.Cards[i].ID == id {
			return &a.c.Snap.A.Cards[i]
		}
	}
	return nil
}

func (a *agent) cardByCode(code string) *assistant.Card {
	if a.c.Snap == nil || a.c.Snap.A == nil || code == "" {
		return nil
	}
	hash := assistant.CodeHash(strings.ToUpper(code))
	for i := range a.c.Snap.A.Cards {
		if a.c.Snap.A.Cards[i].CodeHash == hash {
			return &a.c.Snap.A.Cards[i]
		}
	}
	return nil
}

// cardPart is the part whose skill made the card, or -1 (a card of the shop's own: a limit, a listing). Each template's skill is named as the part is ("fees", "orders",
// "stock-orders"), so a part's cards are found whether or not the shop has the assistant (Stock orders makes its order cards without it).
func (a *agent) cardPart(c *assistant.Card) int {
	if c == nil {
		return -1
	}
	return a.k.partIndex(c.Action.Skill)
}

// refInWords is a case reference written in the owner's words ("approve o-3", "cancel po-4", "f-2"); the router hands words that name one part's case to that part first.
var refInWords = regexp.MustCompile(`(?i)\b([a-z]{1,2}-[0-9]{1,9})\b`)

// ownerOfWords is the one part that owns a case the words name, or -1 (none, or two parts' cases).
func (a *agent) ownerOfWords(text string) int {
	found := -1
	for _, m := range refInWords.FindAllStringSubmatch(text, -1) {
		ref := strings.ToLower(m[1])
		for i := range a.k.parts {
			if a.part(i).OwnsCase(ref) {
				if found >= 0 && found != i {
					return -1
				}
				found = i
			}
		}
	}
	return found
}

// onMessage routes a WhatsApp message (or the owner's words on their page).
func (a *agent) onMessage(ev map[string]any, m messaging.InboundMessage) error {
	r := a.st.router
	if part, known := r.partOf(m.ID); known {
		if part == "" || a.k.partIndex(part) < 0 {
			a.line(m.From, "receive_message", "blocked", map[string]any{"id": m.ID}, map[string]string{"messageId": m.ID}, "the same message was delivered again while the shop asks which part it is for, so it is ignored")
			return nil
		}
		return a.give(a.k.partIndex(part), ev) // the part it went to drops it as delivered twice
	}
	number, lang := a.c.Owner()
	owner := m.From == number
	if q := r.takeAsked(m.From); q != nil {
		replyID := ""
		if m.Reply != nil {
			replyID = m.Reply.ID
		}
		if a.now()-q.AtMs <= askWindowMs {
			if name := answerIn(m.Text, replyID, a.partsNamed(q.Parts)); name != "" {
				return a.answered(q, m, name)
			}
		}
		a.line(m.From, "route_message", "blocked", map[string]any{"asked": q.ID}, map[string]string{"messageId": q.ID, "why": "not_answered"}, "the shop asked which part an earlier message was for and the next message did not say, so the earlier one was not acted on (it can be sent again)")
	}
	claims := make([]runtime.Claim, len(a.k.parts))
	if owner {
		// a tap on one of the assistant's cards: the part whose skill made it
		if c := a.cardByCode(runtime.CardCode(m)); c != nil {
			i := a.cardPart(c)
			if i < 0 {
				i = 0
			}
			r.remember(m.ID, a.k.parts[i].Name)
			return a.give(i, ev)
		}
		// words that name one part's case are that part's ("cancel o-3" is the hold's even while Stock orders has an order open)
		if i := a.ownerOfWords(m.Text); i >= 0 {
			r.remember(m.ID, a.k.parts[i].Name)
			return a.give(i, ev)
		}
		for i := range a.k.parts {
			claims[i] = a.part(i).ClaimOwner(m)
		}
	} else {
		for i := range a.k.parts {
			claims[i] = a.part(i).ClaimCustomer(m)
		}
		// a STOP is the shop's: every part that knows the number hears it (each stops its own messages to them), never a question back
		if understanding.IsStop(language.Canon(m.Text)) {
			var knows []int
			for i, c := range claims {
				if c >= runtime.ClaimWords {
					knows = append(knows, i)
				}
			}
			if len(knows) > 1 {
				r.remember(m.ID, a.k.parts[knows[0]].Name)
				for _, i := range knows {
					if err := a.give(i, ev); err != nil {
						return err
					}
				}
				return nil
			}
		}
	}
	// a case asked about from a number that holds no case in ANY part: the part whose record holds the case it names (runtime CaseHolder), which gives its one line
	if !owner {
		if i := a.caseAskedPart(m); i >= 0 {
			r.remember(m.ID, a.k.parts[i].Name)
			return a.give(i, ev)
		}
	}
	d := decide(claims, 0)
	if len(d.ask) > 0 {
		return a.ask(ev, m, d.ask, owner, lang)
	}
	r.remember(m.ID, a.k.parts[d.part].Name)
	return a.give(d.part, ev)
}

// holdsCase: a part other than `except` (-1: any part) holds a case of this conversation (runtime CaseHolder). A part being made is not asked (part returns nil).
func (a *agent) holdsCase(conversation string, except int) bool {
	for j := range a.k.parts {
		if j == except {
			continue
		}
		if ch, ok := a.part(j).(runtime.CaseHolder); ok && ch.HoldsCase(conversation) {
			return true
		}
	}
	return false
}

// caseAskedPart is the part a customer's message goes to as a case asked about from another conversation (refund-paths, runtime/caseasked.go): when the number holds no
// case in any part, the first part (in the shop's order) whose own reading finds its case named; -1 otherwise, and the message is routed by the claims as before.
func (a *agent) caseAskedPart(m messaging.InboundMessage) int {
	if a.holdsCase(m.From, -1) {
		return -1
	}
	for i := range a.k.parts {
		if ch, ok := a.part(i).(runtime.CaseHolder); ok && ch.NamesCase(m) {
			return i
		}
	}
	return -1
}

func (a *agent) partsNamed(names []string) []*Part {
	var out []*Part
	for _, n := range names {
		if i := a.k.partIndex(n); i >= 0 {
			out = append(out, a.k.parts[i])
		}
	}
	return out
}

// answered: the answer names a part. The answer itself is a message the shop read (its receive line, the router's); the message asked about goes to that part now, which reads
// it as if it had come to it first (its own receive line, its own reply).
func (a *agent) answered(q *asked, m messaging.InboundMessage, name string) error {
	r := a.st.router
	r.remember(m.ID, RouterPart)
	in := map[string]any{"id": m.ID}
	if m.Reply != nil {
		in["reply"] = m.Reply.ID
	}
	a.line(m.From, "receive_message", "confirmed", in, map[string]string{"messageId": m.ID, "step": "rules", "answer": "part"}, "the answer to the shop's question about which part an earlier message was for")
	a.line(m.From, "route_message", "confirmed", map[string]any{"asked": q.ID, "part": name}, map[string]string{"messageId": q.ID, "to": name, "why": "answered"}, "the earlier message went to the part the answer named")
	var ev map[string]any
	if err := json.Unmarshal(q.Event, &ev); err != nil {
		return err
	}
	r.remember(q.ID, name)
	return a.give(a.k.partIndex(name), ev)
}

// ask keeps the message and asks its writer which part it is for: the parts' names, with a button each. Nothing else is done with it until the answer comes.
func (a *agent) ask(ev map[string]any, m messaging.InboundMessage, tied []int, owner bool, ownerLang string) error {
	r := a.st.router
	raw, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	var names []string
	for _, i := range tied {
		names = append(names, a.k.parts[i].Name)
	}
	r.ask(&asked{ID: m.ID, From: m.From, Owner: owner, Parts: names, AtMs: a.now(), Event: raw})
	r.remember(m.ID, "")
	in := map[string]any{"id": m.ID}
	if m.Reply != nil {
		in["reply"] = m.Reply.ID
	}
	a.line(m.From, "receive_message", "held", in, map[string]string{"messageId": m.ID, "step": "rules", "asked": strings.Join(names, "+")}, "two parts of the shop could take this message, so the shop asks which one it is for and keeps it until the answer (it is counted when a part reads it)")
	// the owner's words on their page are answered on the page: the question goes into the assistant's talk there
	if strings.HasPrefix(m.ID, "owner-page:") {
		text := a.questionText(tied, "owner", ownerLang)
		a.c.Snap.EnsureAssistant().AddTalk("assistant", text, a.now())
		return nil
	}
	return a.sayQuestion(m, tied, owner, ownerLang)
}

// questionText is the question in a language, with the parts' names (the owner's names for the owner, the customer's for a customer).
func (a *agent) questionText(tied []int, to, lang string) string {
	var names []string
	for _, i := range tied {
		n := namesOf(a.k.parts[i], lang)
		if to == "owner" {
			names = append(names, n.Owner)
		} else {
			names = append(names, n.Customer)
		}
	}
	return question(lang, to, names)
}

// sayQuestion sends the question on WhatsApp through the first tied part's own WhatsApp: a reply inside the window the message just opened, with a button per part; the
// outgoing check reads it (it holds no amount, count, date or link, so nothing can disagree with the record).
func (a *agent) sayQuestion(m messaging.InboundMessage, tied []int, owner bool, ownerLang string) error {
	to, lang := "customer", a.customerLanguage(m.Text)
	if owner {
		to, lang = "owner", ownerLang
	}
	text := a.questionText(tied, to, lang)
	var buttons []messaging.Choice
	for _, i := range tied {
		n := namesOf(a.k.parts[i], lang)
		title := n.CustomerButton
		if owner {
			title = n.Button
		}
		buttons = append(buttons, messaging.Choice{ID: answerButton + a.k.parts[i].Name, Title: title})
	}
	number, _ := a.c.Owner()
	say := messaging.NewSay(messaging.SayDeps{
		Messaging:  a.part(tied[0]).PartMessaging(),
		Voice:      questionVoice{},
		Owner:      messaging.OwnerInfo{WhatsApp: number, Language: ownerLang},
		LanguageOf: func(string, any) string { return lang },
		OptedOut:   func(phone string) bool { return phone != number && a.optedOut(phone) },
		FactsFor:   func(*messaging.SayArgs, string) (any, error) { return text, nil },
		InteractiveFor: func(*messaging.SayArgs, any, string) (*messaging.InteractiveMessage, error) {
			return &messaging.InteractiveMessage{Body: text, Buttons: buttons[:min(3, len(buttons))]}, nil
		},
		Log: func(_ any, phone, action, outcome string, inputs map[string]any, more messaging.LogMore) {
			refs := more.Refs
			if refs == nil {
				refs = map[string]string{}
			}
			notes := ""
			if more.Notes != nil {
				notes = *more.Notes
			}
			a.rec.Append(runtime.NewLine{Conversation: phone, Action: action, Outcome: outcome, Inputs: inputs, Language: more.Language, Notes: notes, Refs: refs, Decisions: decisionsOf(more.Decisions)})
		},
		HeldBack: func(context.Context, *messaging.SayArgs) error { return nil },
	})
	phone := m.From
	if owner {
		phone = number
	}
	_, err := say.Say(context.Background(), &messaging.SayArgs{Phone: phone, To: to, Templates: []string{"parts_which"}, Offer: &messaging.Offer{Kind: "parts"}})
	var w *runtime.WaitingForGuard
	if errors.As(err, &w) {
		return err // the task waits for the WhatsApp Guard; nothing of this step is kept, and the same question is asked when it is back
	}
	if err != nil {
		a.c.Log("The shop's question about which part a message is for could not be sent: " + err.Error())
	}
	return nil
}

func decisionsOf(ds []messaging.Decision) []json.RawMessage {
	var out []json.RawMessage
	for _, d := range ds {
		if b, err := json.Marshal(d); err == nil {
			out = append(out, b)
		}
	}
	return out
}

// optedOut: any part has this number opted out (a STOP is the shop's, whichever part heard it).
func (a *agent) optedOut(phone string) bool {
	for i := range a.k.parts {
		if h, ok := a.part(i).AssistantHooks(); ok && h.OptedOut != nil && h.OptedOut(phone) {
			return true
		}
	}
	return false
}

// customerLanguage is the language a customer wrote in when the shop speaks it, else the shop's first language.
func (a *agent) customerLanguage(text string) string {
	langs := a.c.Settings.Language
	if l := understanding.DetectLanguage(text); l != "" {
		for _, x := range langs {
			if x == l {
				return l
			}
		}
	}
	if len(langs) > 0 {
		return langs[0]
	}
	return "en"
}

// questionVoice is the say path's voice for the router's question: the words are written already; outside the window there is no approved template, so it goes only inside it.
type questionVoice struct{}

func (questionVoice) Render(_ string, facts any) (string, error) { return facts.(string), nil }

func (questionVoice) TemplateMessage(messaging.TemplateArgs) (messaging.TemplateMessage, error) {
	return messaging.TemplateMessage{}, errors.New("the shop's question about which part a message is for has no approved WhatsApp template, so it goes only inside the 24-hour window the message opened")
}

func (questionVoice) GenericNames() messaging.GenericNames {
	return messaging.GenericNames{Customer: "parts_no_template", Reminder: "parts_no_template", Owner: "parts_no_template"}
}

func (questionVoice) Matches(text string, _ any) messaging.Decision {
	if problems := language.CheckText(text, language.Facts{}); len(problems) > 0 {
		return messaging.Decision{RuleID: "message-matches-record", Verdict: "block", Reason: strings.Join(problems, " ")}
	}
	return messaging.Decision{RuleID: "message-matches-record", Verdict: "allow", Reason: "the question holds no value the record could disagree with"}
}

// Tick is the beat of the part whose beat this step is (the runtime beats once per part, runtime/parts.go); a step with no part named beats every part.
func (a *agent) Tick() error {
	if name := a.c.TickPart(); name != "" {
		if i := a.k.partIndex(name); i >= 0 {
			return a.part(i).Tick()
		}
		return nil
	}
	for i := range a.k.parts {
		if err := a.part(i).Tick(); err != nil {
			return err
		}
	}
	return nil
}

// AfterTick is the beat's after-work of the part whose beat it is (its licence notice, monthly report and morning line; the shared ones only on the first part's view).
func (a *agent) AfterTick(save func() error) {
	for i := range a.k.parts {
		if name := a.c.TickPart(); name != "" && name != a.k.parts[i].Name {
			continue
		}
		if at, ok := runtime.Agent(a.part(i)).(runtime.AfterTicker); ok {
			at.AfterTick(save)
		}
	}
}

// AfterSave runs each part's send-once after the step's save (only the parts made in this step can have asked for a send).
func (a *agent) AfterSave(save func() error) {
	for i := range a.k.parts {
		if a.agents[i] == nil {
			continue
		}
		if as, ok := runtime.Agent(a.agents[i]).(runtime.AfterSaver); ok {
			as.AfterSave(save)
		}
	}
}

// GiveUp goes to the part the event went to: a message by the router's memory, any other event as Handle would route it.
func (a *agent) GiveUp(ev map[string]any, service string, tell bool) error {
	if ev["kind"] == "message" {
		if msg, ok := ev["message"].(map[string]any); ok {
			id, _ := msg["id"].(string)
			if part, known := a.st.router.partOf(id); known && part != "" {
				if i := a.k.partIndex(part); i >= 0 {
					return a.part(i).GiveUp(ev, service, tell)
				}
			}
		}
	}
	return a.part(0).GiveUp(ev, service, tell)
}

// digitsOf is a number's digits alone.
func digitsOf(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
