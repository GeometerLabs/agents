package runtime

// The owner's assistant, run inside a step: the Go twin of modules/assistant/conversation.ts. One conversation for every shop, over the skills the shop has (assistantkit.go):
//   - the listings-only shop (no Kit) has one skill, its listings (a draft's card, and the morning "Still have it?"), and everything it says goes into the page's talk list
//     (`assistant.talk`, shown by GET /internal/channel/owner): it has no WhatsApp;
//   - a template's shop (Bookings) has [its own skill, the declared limits, the listings] (wire.ts), and answers the owner on WhatsApp through the shared say, or on the page
//     while the owner acts from there (conversation.ts `toPage`).
//
// What is here, and where it is copied from:
//   - the card binding (answerCard, onPageCard): one verdict for an answer to a card (assistant.JudgeCard = cards.ts judgeCard): unknown, closed, expired, a no, "gone", "changed" (the old
//     card is void and a new one is made), or do. A yes does the saved action only while the skill's action now has the card's digest;
//   - propose and offerCard: a card for a prepared action, unless the owner said no to this same action in the last day; a message only while the customer's window is open;
//   - the owner's words (onOwnerMessage, readIntent): a card's reply, a listing, then the router's reading and the answer: a day's list, who owes, what needs me, money, close or reopen a day,
//     move a booking, undo, cancel / refund / message by card, a limit by card, the memory and the leave asks, help;
//   - the clock's beat (onTick): cards past their time closed, what is no longer needed taken off, the limit changes that settled told, the morning question.
//
// The rest of the owner's assistant is beside this file: the seam and the ways out (assistantkit.go), the closed days, moves and limits (assistantacts.go), the shop's memory
// (notes.go), the router's reading and the owner's talk with the model (talk.go), the morning line (morning.go).

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/memory"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// conv is the assistant for one step: it works on the step's own state (so what it does is saved with the step, whole or not at all) and the step's record.
type conv struct {
	r      *Runtime
	snap   *Snap
	rec    *recorder
	now    int64
	a      *assistant.State
	pack   *assistant.Pack
	number string
	lang   string
	memory *memory.State // the step's notes, read on first use (notes.go)
	// hooks are a template's (nil: the listings-only shop); toPage is conversation.ts `toPage` (always on for the listings-only shop, which has no WhatsApp)
	hooks   *AssistantHooks
	toPage  bool
	skills  []OwnerSkill
	reading assistant.OwnerReading
	say_    *messaging.Say
	// tellSpy, when set (tests only), is handed each page line and its facts before the outgoing check
	tellSpy func(text string, facts language.Facts)
}

// assistantFor is the listings-only shop's assistant: its listings are its one skill, and it talks on the page.
func (r *Runtime) assistantFor(snap *Snap, rec *recorder, now int64) *conv {
	snap.ensureA()
	number, lang := r.owner()
	c := &conv{r: r, snap: snap, rec: rec, now: now, a: snap.A, pack: assistant.Words(lang), number: number, lang: lang, toPage: true}
	c.skills = []OwnerSkill{listingsSkill{c}}
	return c
}

func (c *conv) ls() *listings.State { return c.snap.Touch() }

// say writes a line of the assistant's from the packed words (conversation.ts `tell`): to the page's talk, or to the owner on WhatsApp.
func (c *conv) say(key string, vals ...string) {
	c.sayAbout("", key, vals...)
}

// sayAbout is say for a line about a case (the record's line names it).
func (c *conv) sayAbout(caseID, key string, vals ...string) {
	c.sayWith(c.pack.Writer(), caseID, key, vals...)
}

// sayWith is sayAbout over a writer in which the caller has already noted the values it put together (a list of names, a limit's value), as words.ts's callers write them
// through the same Writer.
func (c *conv) sayWith(w *assistant.Writer, caseID, key string, vals ...string) {
	c.tellText(idOf(key), w.Say(key, vals...), w.Facts(), caseID, nil)
}

// logLine is conversation.ts `logLine`: a line of the record for the owner, in the owner's language, about a case or none.
func (c *conv) logLine(action, outcome string, inputs any, refs map[string]string, notes string) {
	c.logCase("", action, outcome, inputs, refs, notes)
}

func (c *conv) logCase(caseID, action, outcome string, inputs any, refs map[string]string, notes string) {
	if c.hooks != nil {
		more := messaging.LogMore{Refs: refs, Language: c.lang}
		if notes != "" {
			more.Notes = &notes
		}
		c.hooks.Log(caseID, c.number, action, outcome, inputs, more)
		return
	}
	c.rec.append(NewLine{Conversation: c.number, Action: action, Outcome: outcome, Inputs: inputs, Language: c.lang, Refs: refs, Notes: notes})
}

func (c *conv) localTime(ms int64) string {
	t := time.UnixMilli(ms).In(c.r.loc)
	return c.pack.TimeOfDay(t.Hour(), t.Minute())
}

// slotText is format.ts formatSlot in the owner's language: "Wed 25 Nov, 3:00 pm".
func (c *conv) slotText(ms int64) string { return language.Formats(c.lang).Slot(ms, c.r.loc) }

// today is the shop's date now.
func (c *conv) today() LocalDate { return dateIn(c.now, c.r.loc) }

func dateIn(ms int64, loc *time.Location) LocalDate {
	t := time.UnixMilli(ms).In(loc)
	return LocalDate{t.Year(), int(t.Month()), t.Day()}
}

// dateOf is conversation.ts dateOf: the date the words name, resolved against the shop's clock (nil when none, or one that does not exist).
func (c *conv) dateOf(in assistant.Intent) *LocalDate {
	if in.Date == nil {
		return nil
	}
	y, m, d, ok := language.ResolveDate(*in.Date, time.UnixMilli(c.now).In(c.r.loc))
	if !ok {
		return nil
	}
	return &LocalDate{y, int(m), d}
}

// ---- JSON helpers for a card's fields ------------------------------------------------------------------------------------------------------------------------

// jstring is a JSON string as the saved text writes it: Go's json.Marshal escapes `<`, `>` and `&` and TypeScript does not, so the encoder has HTML escaping off.
func jstring(s string) json.RawMessage {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(s)
	return json.RawMessage(strings.TrimRight(b.String(), "\n"))
}

func jnum(n int64) json.RawMessage { return json.RawMessage(strconv.FormatInt(n, 10)) }

func rawString(v json.RawMessage) string {
	var s string
	if json.Unmarshal(v, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(v)) // a number or a boolean, as JavaScript's String() writes it for the whole numbers a card holds
}

func rawInt(v json.RawMessage) int64 {
	var n float64
	_ = json.Unmarshal(v, &n)
	return int64(n)
}

// isNumber: the raw member is a JSON number (`typeof x === "number"`).
func isNumber(v json.RawMessage) bool {
	b := strings.TrimSpace(string(v))
	return b != "" && (b[0] == '-' || (b[0] >= '0' && b[0] <= '9'))
}

// ---- the skills -----------------------------------------------------------------------------------------------------------------------------------------

func (c *conv) skillOf(ref string) OwnerSkill {
	for _, s := range c.skills {
		if s.Owns(ref) {
			return s
		}
	}
	return nil
}

func (c *conv) skillNamed(name string) OwnerSkill {
	for _, s := range c.skills {
		if s.Name() == name {
			return s
		}
	}
	return nil
}

// kinds are conversation.ts kindsOf over the shop's skills.
func (c *conv) kinds() []string { return c.reading.Kinds() }

// ---- cards ----------------------------------------------------------------------------------------------------------------------------------------------

// buttonsFor is conversation.ts buttonsFor: a message's are Send / Don't send, a listing's its own words, every other card's Approve / Refuse; "no" only when it means something.
func (c *conv) buttonsFor(kind, code string, hasNo bool) []messaging.Choice {
	yes, no := c.pack.Say("label.approve"), c.pack.Say("label.refuse")
	switch kind {
	case "message":
		yes, no = c.pack.Say("label.send"), c.pack.Say("label.dont_send")
	case "listing":
		yes, no = c.pack.Say("label.listing.show"), c.pack.Say("label.listing.no")
	case "listing_ask":
		yes, no = c.pack.Say("label.listing.yes"), c.pack.Say("label.listing.sold")
	}
	out := []messaging.Choice{{ID: "card-yes:" + code, Title: yes}}
	if hasNo {
		out = append(out, messaging.Choice{ID: "card-no:" + code, Title: no})
	}
	return out
}

// cardQuestion is words.ts cardQuestion: the question a card asks, by its skill and what it does (the listings' own words, a limit's rule, or the shared ones).
func (c *conv) cardQuestion(w *assistant.Writer, skill, kind, itemKind, ref string, sh Shown) string {
	if sh.Limit != nil {
		return w.Say("card.limit", "rule", c.ruleText(w, sh.Limit.LimitView, sh.Limit.To), "now", c.valueText(w, sh.Limit.LimitView, sh.Limit.Now))
	}
	if skill == "listings" {
		switch kind {
		case "listing_ask":
			return w.Say("card.listing_ask", "title", sh.What)
		case "listing":
			if sh.AmountPaise > 0 {
				price := w.INR(sh.AmountPaise) // words-listings.ts listingCardLine: w.inr, then the owner's price words as w.lit
				if sh.Words != "" {
					price += " " + w.Lit(sh.Words)
				}
				return w.Say("card.listing.priced", "title", sh.What, "who", sh.Who, "price", price)
			}
			return w.Say("card.listing.ask", "title", sh.What, "who", sh.Who)
		}
	}
	inr := assistant.INR(sh.AmountPaise)
	switch {
	case kind == "cancel" && sh.AmountPaise > 0:
		return w.Say(skillKey(w.Pack(), "card.cancel.paid", skill), "ref", ref, "who", sh.Who, "what", sh.What, "inr", inr)
	case kind == "cancel":
		return w.Say(skillKey(w.Pack(), "card.cancel.free", skill), "ref", ref, "who", sh.Who, "what", sh.What)
	case kind == "refund":
		return w.Say(skillKey(w.Pack(), "card.refund", skill), "ref", ref, "who", sh.Who, "inr", inr)
	case kind == "message":
		return w.Say("card.message", "ref", ref, "who", sh.Who, "words", sh.Words)
	}
	if key := skillKey(w.Pack(), "card.answer."+itemKind, skill); w.Pack().Has(key) { // an Orders shop's late refund is its advance (SKILL_ASK.orders)
		return w.Say(key, "ref", ref, "who", sh.Who, "what", sh.What, "inr", inr)
	}
	return w.Say("card.answer", "ref", ref, "who", sh.Who, "what", sh.What, "inr", inr)
}

// cardFoot is words.ts CARD_FOOT: the line under every card on WhatsApp, with the card's code (never on the page).
func (c *conv) cardFoot(w *assistant.Writer, code string, hasNo, aboveLimit bool) string {
	key := "card.foot."
	if aboveLimit {
		key += "above."
	}
	if hasNo {
		key += "yesno"
	} else {
		key += "yes"
	}
	return w.Say(key, "code", code)
}

// offerCard is conversation.ts `offerCard`: a card for a prepared action, unless the owner said no to this same action in the last day. Returns whether a card went.
func (c *conv) offerCard(skill OwnerSkill, proposal assistant.Raw, prep Prepared) bool {
	act, sh := prep.Action, prep.Shown
	cs := rawString(proposal["case"])
	digest := assistant.ActionDigest(act)
	if no := c.a.RefusedBefore(digest, c.now); no != nil {
		c.sayAbout(cs, "refused_before", "time", c.localTime(no.AtMs))
		return false
	}
	card, code, _ := c.a.MakeCard(act, proposal, c.now)
	hasNo := card.HasNo()
	kind := rawString(proposal["kind"])
	refs := map[string]string{"card": card.ID, "skill": skill.Name(), "kind": kind, "digest": digest, "case": cs}
	if sh.AmountPaise > 0 {
		refs["amountPaise"] = strconv.FormatInt(sh.AmountPaise, 10)
	}
	c.logCase(cs, "owner_card", "held_for_owner", map[string]any{"card": card.ID, "kind": kind}, refs, "a card with the exact change was shown to the owner; nothing is done until they tap it")
	itemKind := ""
	if kind == "answer" {
		itemKind = rawString(proposal["itemKind"])
	}
	// the owner's page shows the same question beside the card's buttons, without the code (items 11d and 11e together)
	w := c.pack.Writer()
	q := c.cardQuestion(w, skill.Name(), kind, itemKind, cs, sh)
	card.Question = q
	c.tellText("card", q+"\n"+c.cardFoot(w, code, hasNo, prep.AboveLimit), w.Facts(), cs, c.buttonsFor(kind, code, hasNo))
	return true
}

// refusal is conversation.ts tell("refusal", ...): why a proposal cannot become a card, by the skill's words.
func (c *conv) refusal(why, ref, who string) { c.refusalPaid(why, ref, who, 0) }

// refusalPaid is refusal with the refusal's `paidPaise` (the "too_much" sentence's amount, words.ts `d.paidPaise ?? 0`).
func (c *conv) refusalPaid(why, ref, who string, paidPaise int64) {
	key := "refusal." + why
	if !c.pack.Has(key) {
		key = "refusal.not_here"
	}
	if s := c.skillOf(ref); s != nil {
		key = skillKey(c.pack, key, s.Name()) // words.ts SKILL_REFUSAL: the skill's own wording where it has one
	}
	if who == "" {
		who = ref
	}
	c.sayAbout(ref, key, "ref", ref, "who", who, "inr", assistant.INR(paidPaise))
}

// propose is conversation.ts `propose`: prepare and offer; a refusal is said in words. A message is offered only while the customer's window is open.
func (c *conv) propose(proposal assistant.Raw) {
	cs := rawString(proposal["case"])
	skill := c.skillOf(cs)
	if skill == nil {
		c.say("refusal.no_case", "ref", cs) // "Nothing has the number b-14."
		return
	}
	prep, why := skill.Prepare(proposal)
	if why != "" {
		c.refusalPaid(why, cs, "", prep.RefusedPaidPaise)
		return
	}
	if prep.Action.Kind == "message" && !c.windowOpen(rawString(prep.Action.Fields["phone"])) {
		c.refusal("no_window", cs, prep.Shown.Who)
		return
	}
	c.offerCard(skill, proposal, prep)
}

// answerCard is conversation.ts `answerCard`: an answer to a card, whichever door it came through (WhatsApp: a tap or a typed code; the owner's page). via is "button", "typed" or
// "page".
func (c *conv) answerCard(found *assistant.Card, answer, via string) {
	cur := func(cd *assistant.Card) (assistant.Action, string, bool) {
		skill := c.skillNamed(cd.Action.Skill)
		if skill == nil {
			return assistant.Action{}, "not_yours", false
		}
		prep, why := skill.Prepare(cd.Proposal)
		return prep.Action, why, why == ""
	}
	v := assistant.JudgeCard(found, answer, c.now, cur)
	refs := func(cd *assistant.Card, decision string) map[string]string {
		return map[string]string{"card": cd.ID, "skill": cd.Action.Skill, "kind": cd.Action.Kind, "digest": cd.Digest, "decision": decision, "via": via}
	}
	if v.Kind == "unknown" {
		c.logLine("owner_card", "blocked", map[string]any{"via": via}, map[string]string{"decision": answer, "via": via}, "a reply with a card code no card has")
		c.say("card_unknown")
		return
	}
	card := v.Card
	cs := card.Action.Case
	cardIn := map[string]any{"card": card.ID}
	switch v.Kind {
	case "closed":
		c.logCase(cs, "owner_card", "blocked", cardIn, refs(card, answer), "the card is already "+card.State+": nothing was done")
		c.sayAbout(cs, "card_closed")
	case "expired":
		c.a.Close(card, "expired", c.now)
		c.logCase(cs, "owner_card", "blocked", cardIn, refs(card, answer), "the card ran out before the tap: nothing was done")
		c.sayAbout(cs, "card_expired")
	case "refuse":
		c.refuse(card, refs, cardIn)
	case "gone":
		c.a.Close(card, "void", c.now)
		c.logCase(cs, "owner_card", "blocked", cardIn, refs(card, "yes"), fmt.Sprintf("the action can no longer be done (%s): nothing was done", v.Why))
		c.refusal(v.Why, cs, "")
	case "changed":
		// The fields are not what the card showed. Nothing is done: the old card is void and a new one shows the action as it is now.
		c.a.Close(card, "void", c.now)
		c.logCase(cs, "owner_card", "blocked", cardIn, refs(card, "yes"), "what the card showed is not what the store holds now (a changed amount, payment or customer): nothing was done, and a new card was made")
		c.sayAbout(cs, "card_changed")
		if skill := c.skillNamed(card.Action.Skill); skill != nil {
			if prep, why := skill.Prepare(card.Proposal); why == "" {
				c.offerCard(skill, card.Proposal, prep)
			}
		}
	case "do":
		skill := c.skillNamed(card.Action.Skill)
		var ex Executed
		if card.Action.Kind == "message" {
			ex = c.sendWords(card)
		} else {
			ex = skill.Execute(card.Action)
		}
		c.a.Close(card, "done", c.now)
		outcome := "confirmed"
		if !ex.OK {
			outcome = "failed"
		}
		r := refs(card, "yes")
		r["result"] = ex.Note
		c.logCase(cs, "owner_card", outcome, cardIn, r, "the owner tapped yes; the skill did the card's saved action")
		c.afterDo(card, ex)
	}
}

// afterDo is the owner's answer after a card's yes (conversation.ts, the end of answerCard).
func (c *conv) afterDo(card *assistant.Card, ex Executed) {
	cs := card.Action.Case
	switch card.Action.Kind {
	case "listing", "listing_ask":
		if !ex.OK {
			c.say("listing_line.gone")
		} else if card.Action.Kind == "listing" {
			c.say("listing_line.published", "title", c.listingTitle(card))
		} else {
			c.say("listing_line.confirmed", "title", rawString(card.Action.Fields["title"]))
		}
		return
	case "limit":
		// a limit's tap makes a Pending change: the owner's words say so (and say Active, or that the previous limit stays, when the deployer reports, on the beat)
		l := c.declaredLimit(rawString(card.Action.Fields["limit"]))
		if ex.OK && l != nil {
			c.sayLimit("pending", l.view(), rawInt(card.Action.Fields["to"]), 0)
		} else {
			c.say("refusal.limit_not_tighter")
		}
		return
	}
	var amount int64
	if v, ok := card.Action.Fields["amountPaise"]; ok && isNumber(v) {
		amount = rawInt(v)
	}
	// "done" in the owner's words: a cancel that gave money back says the money is on its way, a cancel with nothing paid says cancelled
	kind, note := card.Action.Kind, ex.Note
	if note == "done" {
		switch {
		case kind == "refund" || (kind == "cancel" && amount > 0):
			note = "refund_sent"
		case kind == "cancel":
			note = "cancelled"
		case kind == "message":
			note = "sent"
		default:
			note = "answered"
		}
	}
	who := cs
	if v, ok := card.Action.Fields["who"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil {
			who = s
		}
	}
	c.sayAbout(cs, "done."+note, "who", who, "ref", cs, "inr", assistant.INR(amount))
}

// sendWords is conversation.ts sendWords: a message card's yes, only while the customer's window is open (checked again: it may have closed since the card).
func (c *conv) sendWords(card *assistant.Card) Executed {
	phone := rawString(card.Action.Fields["phone"])
	if !c.windowOpen(phone) {
		return Executed{false, "not_sent"}
	}
	if c.tellCustomerWords(card.Action.Case, phone, rawString(card.Action.Fields["words"])) {
		return Executed{true, "sent"}
	}
	return Executed{false, "not_sent"}
}

// listingTitle is the title a listing card names, in the owner's language first (conversation.ts, after a tap).
func (c *conv) listingTitle(card *assistant.Card) string {
	f := card.Action.Fields
	for _, k := range []string{"title_" + c.lang, "title_" + rawString(f["ownerLang"]), "title_en"} {
		if v, ok := f[k]; ok {
			return rawString(v)
		}
	}
	return card.Action.Case
}

// refuse is the "no" half of answerCard: a no to a drafted listing drops the draft (nothing was ever public); a no to the morning question IS "Sold"; a no to something already
// waiting IS the owner's own "deny", sent to the skill while the item is still the one the card showed; any other no changes nothing.
func (c *conv) refuse(card *assistant.Card, refs func(*assistant.Card, string) map[string]string, cardIn map[string]any) {
	cs := card.Action.Case
	skill := c.skillNamed(card.Action.Skill)
	if skill != nil && card.Action.Kind == "listing" {
		if m := listingCase.FindStringSubmatch(cs); m != nil {
			if l := c.findListing(m[1]); l != nil {
				c.ls().Remove(l.ID, c.now)
			}
		}
		c.a.Close(card, "refused", c.now)
		c.logCase(cs, "owner_card", "confirmed", cardIn, refs(card, "no"), "the owner said no; the draft listing was dropped and was never public")
		c.say("listing_line.dropped")
		return
	}
	sameNow := func() bool {
		prep, why := skill.Prepare(card.Proposal)
		return why == "" && assistant.ActionDigest(prep.Action) == card.Digest
	}
	answerNo := func() assistant.Action {
		a := card.Action
		f := assistant.Raw{}
		for k, v := range a.Fields {
			f[k] = v
		}
		f["answer"] = jstring("no")
		a.Fields = f
		return a
	}
	if skill != nil && card.Action.Kind == "listing_ask" && sameNow() {
		ex := skill.Execute(answerNo())
		c.a.Close(card, "refused", c.now)
		outcome := "confirmed"
		if !ex.OK {
			outcome = "failed"
		}
		r := refs(card, "no")
		r["result"] = ex.Note
		c.logCase(cs, "owner_card", outcome, cardIn, r, "the owner said it is sold: the listing is off the shop's page")
		c.say("listing_line.sold", "title", rawString(card.Action.Fields["title"]))
		return
	}
	denied := ""
	if skill != nil && card.Action.Kind == "answer" {
		for _, it := range skill.Waiting() {
			if it.Case == cs && it.Kind == rawString(card.Action.Fields["itemKind"]) && it.No != "" && sameNow() {
				skill.Execute(answerNo())
				denied = it.No
				break
			}
		}
	}
	c.a.Close(card, "refused", c.now)
	r := refs(card, "no")
	note := "the owner said no; the same action is not offered again for 24 hours"
	if denied != "" {
		r["sent"] = denied
		note = fmt.Sprintf("the owner said no; their %q was sent to the skill, so it no longer waits", denied)
	}
	c.logCase(cs, "owner_card", "confirmed", cardIn, r, note)
	if denied == "" {
		c.sayAbout(cs, "refused")
	}
}

// onPageCard is conversation.ts `onPageCard`: the owner answered a card on their page (an `owner_action` card_yes / card_no, checked at the runtime against the owner's link or session
// before it was saved). The page posts the card's id and the digest it showed; a card with another digest is not the one shown, and nothing is done.
func (c *conv) onPageCard(id, digest, answer string) {
	card := c.a.CardByID(id)
	if card == nil || card.Digest != digest {
		cs := ""
		if card != nil {
			cs = card.Action.Case
		}
		c.logCase(cs, "owner_card", "blocked", map[string]any{"card": id}, map[string]string{"card": id, "decision": answer, "via": "page"}, "the owner's page posted a card that is not one the assistant holds with that digest: nothing was done")
		c.say("card_unknown")
		return
	}
	c.answerCard(card, answer, "page")
}

// ---- the owner's words ---------------------------------------------------------------------------------------------------------------------------------

var (
	relayReply = regexp.MustCompile(`(?i)^[\s\x{00a0}\x{feff}]*(approve|deny)[\s\x{00a0}\x{feff}]+[A-HJKMNP-Za-hjkmnp-z2-9]{4,6}[\s\x{00a0}\x{feff}]*$`)
	typedReply = regexp.MustCompile(`(?i)^[\s\x{00a0}\x{feff}]*(yes|no)[\s\x{00a0}\x{feff}]+([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})[\s\x{00a0}\x{feff}]*$`)
	// cards.ts BUTTON_RE: a tap on a card's button, "card-yes:K7M2QX"
	buttonReply = regexp.MustCompile(`^card-(yes|no):([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})$`)
)

// ownerMessage is the listings-only shop's `onPageMessage`: the owner's words from the talk box, the owner's line kept first. The key is TypeScript's: o:<the page's message id>, and
// the page's id is owner-page:<event id>.
func (r *Runtime) ownerMessage(snap *Snap, rec *recorder, ev map[string]any, now int64) error {
	text, _ := ev["text"].(string)
	id, _ := ev["id"].(string)
	c := r.assistantFor(snap, rec, now)
	c.a.AddTalk("owner", text, now)
	return c.onOwnerMessage(messaging.InboundMessage{ID: "owner-page:" + id, From: c.number, Text: text, Timestamp: now}, "o:owner-page:"+id)
}

// onOwnerMessage is conversation.ts `onOwnerMessage` after the sender is known to be the owner: the relay's replies dropped, a card's reply, a listing, then the reading.
func (c *conv) onOwnerMessage(msg messaging.InboundMessage, key string) error {
	text := msg.Text
	if relayReply.MatchString(text) {
		return nil // the approvals relay's own reply, not ours: dropped without a word
	}
	// a tap is always a card's; typed, "no thanks" has the shape of "no <code>": it is a card's reply only when a card has that code, otherwise it is words to read
	if msg.Reply != nil {
		if m := buttonReply.FindStringSubmatch(msg.Reply.ID); m != nil {
			c.answerCard(c.cardByCode(m[2]), m[1], "button")
			return nil
		}
	}
	if m := typedReply.FindStringSubmatch(text); m != nil {
		if card := c.cardByCode(m[2]); card != nil {
			c.answerCard(card, strings.ToLower(m[1]), "typed")
			return nil
		}
	}
	// a tap on a proposed note: Remember saves it, No is final for a day (notes.ts parseNoteReply)
	if msg.Reply != nil {
		if m := noteButton.FindStringSubmatch(msg.Reply.ID); m != nil {
			c.onProposalReply(m[1], m[2])
			return nil
		}
	}
	taken, err := c.listingFromWords(text, key)
	if err != nil || taken {
		return err
	}
	c.readIntent(text, key)
	return nil
}

// cardByCode is cards.ts cardByCode: the card with this code's hash, whatever its state (nil when none).
func (c *conv) cardByCode(code string) *assistant.Card {
	hash := assistant.CodeHash(code)
	for i := range c.a.Cards {
		if c.a.Cards[i].CodeHash == hash {
			return &c.a.Cards[i]
		}
	}
	return nil
}

// readIntent is conversation.ts `onOwnerMessage` after the fixed phrases and a listing: the router's reading (talk.go readOwner), its owner_assistant line, and the answer.
func (c *conv) readIntent(text, key string) {
	read, note, refs := c.readOwner(text)
	kind := read.Kind
	refs["intent"] = kind
	if read.Ref != "" {
		refs["case"] = read.Ref
	}
	c.logLine("owner_assistant", "confirmed", map[string]any{"intent": kind}, refs, note)
	switch kind {
	case "help":
		p := c.r.o.Client.Settings.Assistant
		suffix := c.profile()
		if p.Name != "" {
			c.say("help."+p.Personality+".named"+suffix, "name", p.Name, "shop", c.r.o.Client.Settings.Name)
		} else {
			c.say("help."+p.Personality+".plain"+suffix, "shop", c.r.o.Client.Settings.Name)
		}
	case "limit":
		c.onLimit(text, "")
	case "remember":
		c.remember(read.Words)
	case "notes":
		c.listNotes()
	case "forget":
		c.forgetNote(read.Note)
	case "leave_file":
		c.leave("file")
	case "leave_operator":
		c.leave("operator")
	case "day":
		d := c.today()
		if p := c.dateOf(read); p != nil {
			d = *p
		}
		var rows []DayRow
		for _, s := range c.skills {
			if ds, ok := s.(DaySkill); ok {
				rows = append(rows, ds.Day(d)...)
			}
		}
		sort.SliceStable(rows, func(i, j int) bool { return rows[i].StartMs < rows[j].StartMs })
		w := c.pack.Writer()
		c.tellText("day_list", c.dayList(w, d, rows, c.isClosedDay(d)), w.Facts(), "", nil)
	case "waiting":
		c.showWaiting()
	case "open_orders":
		c.openOrders()
	case "owes":
		c.owes()
	case "money":
		c.money(read.Date)
	case "close_day", "reopen_day":
		d := c.dateOf(read)
		if d == nil {
			c.say("need_date." + kind)
		} else if kind == "close_day" {
			c.closeDay(*d)
		} else {
			c.reopenDay(*d)
		}
	case "undo":
		c.undoLast()
	case "move":
		c.move(read)
	case "cancel", "refund", "message":
		if read.Ref == "" {
			c.needRef(kind, read)
			return
		}
		if kind == "message" && read.Words == "" {
			c.say("need_words", "ref", read.Ref)
			return
		}
		p := assistant.Raw{"kind": jstring(kind), "case": jstring(read.Ref)}
		if kind == "refund" && read.AmountPaise > 0 {
			p["amountPaise"] = jnum(read.AmountPaise)
		}
		if kind == "message" {
			p["words"] = jstring(read.Words)
		}
		c.propose(p)
	default:
		// the words no rule or model could place: answered as a conversation when the talk may ask a model (talk.go), otherwise the fixed answer
		if !c.talkToOwner(text, key) {
			c.say("not_understood" + c.profile())
		}
	}
}

// profile is the packed words' suffix for this shop's kinds ("" for a listings-only shop, "@bookings" for a Bookings shop, "@orders" for an Orders shop, "@fees" for a Fees
// centre).
func (c *conv) profile() string {
	if c.reading.Bookings {
		return "@bookings"
	}
	if c.reading.Orders {
		return "@orders"
	}
	if c.reading.Fees {
		return "@fees"
	}
	return ""
}

// needRef is conversation.ts tell("need_ref", {kind, rows: candidates(intent)}): which one, with the cases the owner might mean (the named day's, or today's and the next two days').
func (c *conv) needRef(kind string, read assistant.Intent) {
	var rows []DayRow
	for _, s := range c.skills {
		ds, ok := s.(DaySkill)
		if !ok {
			continue
		}
		days := []LocalDate{c.today(), c.today().AddDays(1), c.today().AddDays(2)}
		if d := c.dateOf(read); d != nil {
			days = []LocalDate{*d}
		}
		for _, d := range days {
			rows = append(rows, ds.Day(d)...)
		}
		break // conversation.ts `skills.find((s) => s.day)`: the first skill with a day
	}
	c.needRefLine(kind, rows)
}

// ownKey is a key in the shop's own skill's wording when it has one (conversation.ts `ownSkill`, the template's skill first in wire.ts's order), else the shared key.
func (c *conv) ownKey(key string) string {
	if len(c.skills) == 0 {
		return key
	}
	return skillKey(c.pack, key, c.skills[0].Name())
}

// needRefLine is words.ts need_ref: the question, then the candidates (at most 12) as rows.
func (c *conv) needRefLine(kind string, rows []DayRow) {
	w := c.pack.Writer()
	text := w.Say(c.ownKey("need_ref." + kind)) // an Orders shop's "cancel o-14", a Fees centre's "cancel f-14" (words.ts EXAMPLE_REF)
	for i, r := range rows {
		if i >= listRows {
			break
		}
		text += "\n" + w.Say("need_ref.row", "slot", c.slotText(r.StartMs), "what", r.What, "who", r.Who, "case", r.Case)
	}
	c.tellText("need_ref", text, w.Facts(), "", nil)
}

// listRows is words.ts LIST_ROWS: how many rows a list shows; the rest are counted ("and 4 more").
const listRows = 12

// dayList is words.ts day_list: none, or the head and the rows (at most 12, then "and N more"), and the closed-day line.
func (c *conv) dayList(w *assistant.Writer, d LocalDate, rows []DayRow, closed bool) string {
	date := c.pack.DateText(d.Year, d.Month, d.Day)
	var text string
	if len(rows) == 0 {
		text = w.Say("day_list.none", "date", date)
	} else {
		text = w.Say("day_list.head", "date", date, "n", strconv.Itoa(len(rows)))
		for i, r := range rows {
			if i >= listRows {
				break
			}
			text += "\n" + w.Say("day_list.row", "time", c.localTime(r.StartMs), "what", r.What, "who", r.Who, "case", r.Case)
		}
		if len(rows) > listRows {
			text += "\n" + w.Say("day_list.more", "n", strconv.Itoa(len(rows)-listRows))
		}
	}
	if closed {
		text += w.Say("day_list.closed")
	}
	return text
}

// showWaiting is conversation.ts `showWaiting`: each skill's waiting items as cards (the oldest first), and any card the owner was shown and has not answered, shown again as a NEW
// card (the old is void).
func (c *conv) showWaiting() {
	type offer struct {
		skill    OwnerSkill
		proposal assistant.Raw
	}
	var offers []offer
	for _, s := range c.skills {
		for _, it := range s.Waiting() {
			offers = append(offers, offer{s, assistant.Raw{"kind": jstring("answer"), "case": jstring(it.Case), "answer": jstring("yes"), "itemKind": jstring(it.Kind)}})
		}
	}
	for _, cd := range c.a.OpenCards(c.now) {
		s := c.skillNamed(cd.Action.Skill)
		if s == nil {
			continue
		}
		dup := false
		for _, o := range offers {
			dup = dup || (rawString(o.proposal["case"]) == rawString(cd.Proposal["case"]) && rawString(o.proposal["kind"]) == rawString(cd.Proposal["kind"]))
		}
		if !dup {
			offers = append(offers, offer{s, cd.Proposal})
		}
	}
	if len(offers) == 0 {
		c.say("waiting_head.zero")
	} else {
		c.say("waiting_head.n", "n", strconv.Itoa(len(offers)))
	}
	for i, o := range offers {
		if i >= 5 { // CARDS_PER_ASK
			break
		}
		if prep, why := o.skill.Prepare(o.proposal); why == "" {
			c.offerCard(o.skill, o.proposal, prep)
		}
	}
}

// money is "money in" for a date (conversation.ts, the "money" kind): the payments the record holds on it. The date is the one the words name (language.FindDatePhrase, resolved by
// language.ResolveDate with dates.ts's rules), or today; a date that does not exist (31 November) is today, as `dateOf(intent) ?? today()` makes it.
func (c *conv) money(d *language.DatePhrase) {
	t := time.UnixMilli(c.now).In(c.r.loc)
	y, m, day := t.Date()
	if d != nil {
		if ry, rm, rd, ok := language.ResolveDate(*d, t); ok {
			y, m, day = ry, rm, rd
		}
	}
	from := time.Date(y, m, day, 0, 0, 0, 0, c.r.loc).UnixMilli()
	to := time.Date(y, m, day+1, 0, 0, 0, 0, c.r.loc).UnixMilli()
	var paise, payments int64
	for _, e := range c.entries() {
		if e.Outcome != "confirmed" || (e.Action != "record_deposit" && e.Action != "record_payment" && e.Action != "owner_marked_paid") {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, e.Time)
		amount, aerr := strconv.ParseInt(e.Refs["amountPaise"], 10, 64)
		if err != nil || aerr != nil || at.UnixMilli() < from || at.UnixMilli() >= to || amount <= 0 {
			continue
		}
		paise += amount
		payments++
	}
	date := c.pack.DateText(y, int(m), day)
	if payments == 0 {
		c.say("money_in.zero", "date", date)
		return
	}
	c.say("money_in.some", "date", date, "inr", assistant.INR(paise), "n", strconv.FormatInt(payments, 10))
}

// entries is the record as this step sees it: the saved lines, then the step's own (the shop's whole record: in a shop of several parts the one assistant reads every
// part's lines, so the step's own are its one recorder's, under whichever part's view the assistant was made).
func (c *conv) entries() []store.Entry {
	c.r.mu.RLock()
	defer c.r.mu.RUnlock()
	return append(append(c.r.entries[:0:0], c.r.entries...), c.rec.top().fresh...)
}

// ---- leaving with the shop (approvals/leave.ts) ---------------------------------------------------------------------------------------------------------

var askID = regexp.MustCompile(`^ask_[0-9a-f]{12}$`)

// leave: the ask goes into the shop's record and nothing else happens here (the deployer reads it); the same kind of ask is taken once an hour.
func (c *conv) leave(kind string) {
	action, again, asked := "owner_file_asked", "leave_file_again", "leave_file_asked"
	if kind == "operator" {
		action, again, asked = "operator_change_asked", "leave_operator_again", "leave_operator_asked"
	}
	if !c.mayAskAgain(action) {
		c.say(again)
		return
	}
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	note := "the owner asked for their shop's file (no Operator needed)"
	if kind == "operator" {
		note = "the owner asked for another Operator; the move itself still needs the owner's code"
	}
	via := "page"
	if !c.toPage {
		via = "whatsapp"
	}
	c.logLine(action, "confirmed", map[string]any{"kind": kind}, map[string]string{"ask": "ask_" + hex.EncodeToString(b), "via": via}, note)
	c.say(asked)
}

// mayAskAgain is leave.ts: not within an hour of the latest confirmed ask of this kind in the record (this step's lines included).
func (c *conv) mayAskAgain(action string) bool {
	var last int64 = -1 << 62
	for _, e := range c.entries() {
		if e.Action != action || e.Outcome != "confirmed" || !askID.MatchString(e.Refs["ask"]) {
			continue
		}
		if at, ok := parseTime(e.Time); ok && at.UnixMilli() >= last {
			last = at.UnixMilli()
		}
	}
	return last == -1<<62 || c.now-last >= 60*60_000
}

// ---- the clock's beat ----------------------------------------------------------------------------------------------------------------------------------

// onTick is conversation.ts `onTick`: cards past their time are closed, what is no longer needed is taken off, the month's budget notices, the limit changes that settled, and
// the morning question.
func (c *conv) onTick() {
	for _, cd := range c.a.Expire(c.now) {
		c.logCase(cd.Action.Case, "owner_card", "blocked", map[string]any{"card": cd.ID}, map[string]string{"card": cd.ID, "skill": cd.Action.Skill, "kind": cd.Action.Kind, "digest": cd.Digest, "decision": "none"}, "the card ran out without a tap: nothing was done")
	}
	c.a.Compact(c.now, c.r.today(c.now))
	c.notesTick()
	if c.snap.hasList {
		c.snap.Listings.Tidy(c.now)
	}
	if c.snap.Stock != nil {
		c.snap.Stock.Tidy(c.now)
	}
	c.budgetBeat()
	c.announceLimits()
	c.askFresh()
}

// budgetBeat is conversation.ts `budgetBeat`: the month's two notices, each once ("most of the budget is used", "used up"). To the owner's page (its talk list), and then to WhatsApp:
// a listings-only shop has none, and TypeScript's attempt fails and says so in the record ("send_message failed"), so this writes that line too, to leave the same record.
func (c *conv) budgetBeat() {
	cfg := c.r.policy.Budget
	if cfg == nil {
		return
	}
	for _, line := range budget.TakeNotices(&c.snap.AI, cfg, c.r.clock, c.now) {
		c.tellBudget(line, "")
		if c.hooks == nil {
			c.logLine("send_message", "failed", map[string]any{"to": "owner", "templates": []string{"assistant_budget_line"}}, map[string]string{"to": "owner"}, "this reply has no approved WhatsApp template, so it goes only while the person's 24-hour window is open")
		}
		notes := "the owner was told that most of this month's model budget is used"
		if line == "full" {
			notes = "the owner was told that this month's model budget is used up: the language model is off until the 1st; buttons, rules and fixed answers go on"
		}
		month := budget.For(&c.snap.AI, c.r.clock, c.now).Month
		c.logLine("ai_mode", "confirmed", map[string]any{"reason": "budget", "notice": line}, map[string]string{"mode": "budget_" + line, "reason": "budget", "month": month}, notes)
	}
}

// askFresh is the morning question: at most 3 a day, only after the owner's morning hour, each a card ("Still have it?" Yes / Sold) bound to the listing and the confirm the owner was last shown.
func (c *conv) askFresh() {
	if !c.snap.hasList {
		return
	}
	ls := c.ls()
	set := c.r.o.Client.Settings.Assistant
	hour, minute := set.MorningHour, set.MorningMinute
	if set.MorningOff {
		hour, minute = 9, 0 // TypeScript: `settings.morningAt ?? { hour: 9, minute: 0 }`
	}
	t := time.UnixMilli(c.now).In(c.r.loc)
	y, m, d := t.Date()
	from := time.Date(y, m, d, hour, minute, 0, 0, c.r.loc).UnixMilli()
	if c.now < from+10*60_000 || c.now > from+8*3_600_000 {
		return
	}
	day := c.r.today(c.now)
	askedToday := 0
	for _, l := range ls.Items {
		if l.AskedMs != 0 && c.r.today(l.AskedMs) == day {
			askedToday++
		}
	}
	for _, id := range listings.DueAsks(ls, c.now, askedToday) {
		l := c.findListing(id)
		l.AskedMs = c.now
		c.propose(assistant.Raw{"kind": jstring("listing_ask"), "case": jstring(caseOfListing(l.ID)), "confirmedMs": jnum(l.ConfirmedMs)})
	}
}
