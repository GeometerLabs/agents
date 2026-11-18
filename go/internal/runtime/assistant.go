package runtime

// The owner's assistant for a listings-only shop, run inside a step: the Go twin of modules/assistant/conversation.ts for the one skill this shop has (the listings: a draft's card, and
// the morning "Still have it?"). Everything it says goes into the page's talk list (`assistant.talk`, shown by GET /internal/channel/owner), nothing to WhatsApp: this shop has none.
//
// What is here, and where it is copied from:
//   - the card binding (answerCard, onPageCard): one verdict for an answer to a card (assistant.JudgeCard = cards.ts judgeCard): unknown, closed, expired, a no, "gone", "changed" (the old
//     card is void and a new one is made), or do. A yes publishes the draft through the existing listing code, but only while the draft still has exactly the fields the card showed;
//   - a draft makes a card (listingFromWords, in draft.go: the model, the checks, then `offerCard` here);
//   - the owner's other words, read by rule (onOwnerMessage, readIntent): help, what needs me, undo, a limit, the leave asks, a cancel or refund or message of a case (none here), money;
//   - the clock's beat (onTick): cards past their time closed, what is no longer needed taken off, the morning question.
//
// What is NOT here (and answers with "this shop's assistant doesn't handle that" or "Sorry, I didn't get that" instead of pretending): the shop's memory (remember, notes, forget: they
// need modules/memory), the router's decision and language models that TypeScript asks to place a message the rules could not, and the owner's free talk with the model (talk-owner.ts).
// go/TRIAL.md lists them. Also not here: the outgoing check TypeScript runs over every line it says (language/check.ts): the lines here are written from the shop's own saved values
// by the packed words, so the check has nothing to catch.
//
// Differences from TypeScript, on purpose: lines are written to the talk list only (TypeScript's `toPage` mode); the owner's own talk line is added first, as `onPageMessage` does.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/listings"
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
}

func (r *Runtime) assistantFor(snap *Snap, rec *recorder, now int64) *conv {
	snap.ensureA()
	number, lang := r.owner()
	return &conv{r: r, snap: snap, rec: rec, now: now, a: snap.A, pack: assistant.Words(lang), number: number, lang: lang}
}

func (c *conv) ls() *listings.State { return c.snap.Touch() }

// say writes a line of the assistant's into the page's talk (conversation.ts `tell` with toPage on).
func (c *conv) say(key string, vals ...string) {
	c.a.AddTalk("assistant", c.pack.Say(key, vals...), c.now)
}

// logLine is conversation.ts `logLine`: a line of the record for the owner, in the owner's language.
func (c *conv) logLine(action, outcome string, inputs any, refs map[string]string, notes string) {
	c.rec.append(NewLine{Conversation: c.number, Action: action, Outcome: outcome, Inputs: inputs, Language: c.lang, Refs: refs, Notes: notes})
}

func (c *conv) localTime(ms int64) string {
	t := time.UnixMilli(ms).In(c.r.loc)
	return c.pack.TimeOfDay(t.Hour(), t.Minute())
}

// ---- the listings skill (listing-card.ts) ------------------------------------------------------------------------------------------------------------------

var listingCase = regexp.MustCompile(`^listing:(l-\d{1,9})$`)

func caseOfListing(id string) string { return "listing:" + id }

// jstring is a JSON string as the saved text writes it: Go's json.Marshal escapes `<`, `>` and `&` and TypeScript does not, so the encoder has HTML escaping off.
func jstring(s string) json.RawMessage {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(s)
	return json.RawMessage(strings.TrimRight(b.String(), "\n"))
}

func jnum(n int64) json.RawMessage { return json.RawMessage(strconv.FormatInt(n, 10)) }

// listingFields is listing-card.ts `listingFields`: flat, everything the owner is shown and everything a tap publishes.
func listingFields(l *listings.Listing) assistant.Raw {
	ids := make([]string, len(l.Photos))
	for i, p := range l.Photos {
		ids[i] = p.ID
	}
	f := assistant.Raw{"category": jstring(l.Category), "ownerLang": jstring(l.OwnerLang), "from": jstring(l.From), "photos": jstring(strings.Join(ids, ","))}
	for _, k := range listings.Langs {
		if w, ok := l.Words[k]; ok {
			f["title_"+k], f["text_"+k] = jstring(w.Title), jstring(w.Text)
		}
	}
	if l.PricePaise != 0 {
		f["pricePaise"] = jnum(l.PricePaise)
	}
	if l.PriceNote != "" {
		f["priceNote"] = jstring(l.PriceNote)
	}
	if l.Qty != 0 {
		f["qty"] = jnum(l.Qty)
	}
	if len(l.Claims) > 0 {
		f["claims"] = jstring(strings.Join(l.Claims, " | "))
	}
	return f
}

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

type shown struct {
	who, what, words string
	amountPaise      int64
}

func (c *conv) findListing(id string) *listings.Listing {
	s := c.ls()
	for i := range s.Items {
		if s.Items[i].ID == id {
			return &s.Items[i]
		}
	}
	return nil
}

// prepare is listing-card.ts `prepare`: the action as the store holds it NOW, and what the owner is shown; or why it cannot be done.
func (c *conv) prepare(p assistant.Raw) (assistant.Action, shown, string) {
	kind, cs := rawString(p["kind"]), rawString(p["case"])
	if kind != "listing" && kind != "listing_ask" {
		return assistant.Action{}, shown{}, "not_here"
	}
	m := listingCase.FindStringSubmatch(cs)
	var l *listings.Listing
	if m != nil {
		l = c.findListing(m[1])
	}
	if l == nil {
		return assistant.Action{}, shown{}, "no_case"
	}
	title := listings.TextIn(l, c.lang).Title
	if kind == "listing" {
		if l.State != "draft" {
			return assistant.Action{}, shown{}, "not_live"
		}
		return assistant.Action{Kind: "listing", Skill: "listings", Case: cs, Fields: listingFields(l)}, shown{who: c.pack.Category(l.Category), what: title, amountPaise: l.PricePaise, words: l.PriceNote}, ""
	}
	confirmed := rawInt(p["confirmedMs"])
	if l.State != "live" || l.ConfirmedMs != confirmed {
		return assistant.Action{}, shown{}, "not_live"
	}
	return assistant.Action{Kind: "listing_ask", Skill: "listings", Case: cs, Fields: assistant.Raw{"title": jstring(title), "confirmedMs": jnum(confirmed)}}, shown{what: title}, ""
}

// offerCard is conversation.ts `offerCard`: a card for a prepared action, unless the owner said no to this same action in the last day. In the page's talk a card is not a line (it is
// shown in the page's own list of cards, with its buttons); the question is kept on the card.
func (c *conv) offerCard(proposal assistant.Raw, act assistant.Action, sh shown) bool {
	digest := assistant.ActionDigest(act)
	if no := c.a.RefusedBefore(digest, c.now); no != nil {
		c.say("refused_before", "time", c.localTime(no.AtMs))
		return false
	}
	card, _ := c.a.MakeCard(act, proposal, c.now)
	refs := map[string]string{"card": card.ID, "skill": "listings", "kind": rawString(proposal["kind"]), "digest": digest, "case": rawString(proposal["case"])}
	if sh.amountPaise > 0 {
		refs["amountPaise"] = strconv.FormatInt(sh.amountPaise, 10)
	}
	c.logLine("owner_card", "held_for_owner", map[string]any{"card": card.ID, "kind": rawString(proposal["kind"])}, refs, "a card with the exact change was shown to the owner; nothing is done until they tap it")
	switch act.Kind {
	case "listing_ask":
		card.Question = c.pack.Say("card.listing_ask", "title", sh.what)
	default:
		if sh.amountPaise > 0 {
			price := assistant.INR(sh.amountPaise)
			if sh.words != "" {
				price += " " + sh.words
			}
			card.Question = c.pack.Say("card.listing.priced", "title", sh.what, "who", sh.who, "price", price)
		} else {
			card.Question = c.pack.Say("card.listing.ask", "title", sh.what, "who", sh.who)
		}
	}
	return true
}

// propose is conversation.ts `propose`: prepare and offer; a refusal is said in words.
func (c *conv) propose(proposal assistant.Raw) {
	cs := rawString(proposal["case"])
	if !listingCase.MatchString(cs) {
		c.say("refusal.no_case", "ref", cs) // no skill's references match: "Nothing has the number b-14."
		return
	}
	act, sh, why := c.prepare(proposal)
	if why != "" {
		c.say("refusal."+why, "ref", cs)
		return
	}
	c.offerCard(proposal, act, sh)
}

// execute is listing-card.ts `execute`: the saved action, by the skill that owns it. Returns whether it worked.
func (c *conv) execute(act assistant.Action, answerNo bool) bool {
	m := listingCase.FindStringSubmatch(act.Case)
	if m == nil {
		return false
	}
	l := c.findListing(m[1])
	if l == nil {
		return false
	}
	s := c.ls()
	switch act.Kind {
	case "listing":
		// the tap is the owner's: the authority comes from the door the draft came through, only after the card's digest matched the draft as it is now
		got, why := s.Publish(l.ID, c.now)
		if why != "" {
			return false
		}
		if rawString(act.Fields["from"]) == "whatsapp" {
			got.From = "whatsapp"
		}
		words := map[string]any{}
		for k, w := range got.Words {
			words[k] = map[string]any{"title": w.Title, "text": w.Text}
		}
		inputs := map[string]any{"listing": got.ID, "category": got.Category, "words": words}
		if got.PricePaise != 0 {
			inputs["pricePaise"] = got.PricePaise
		}
		c.logLine("listing", "confirmed", inputs, refsOf(got, "published"), "the owner tapped Show it; the listing is on the shop's page now, with the fields the card showed")
		return true
	case "listing_ask":
		if answerNo {
			got, why := s.MarkSold(l.ID, c.now)
			if why != "" {
				return false
			}
			c.logLine("listing", "confirmed", map[string]any{"listing": got.ID}, refsOf(got, "sold"), "the owner said it is sold; the listing is off the shop's page")
			return true
		}
		confirmed := rawInt(act.Fields["confirmedMs"])
		got, why := s.Confirm(l.ID, c.now, confirmed)
		if why != "" {
			return false
		}
		c.logLine("listing", "confirmed", map[string]any{"listing": got.ID}, refsOf(got, "confirmed"), "the owner said the shop still has it; the listing was confirmed today")
		// a counted listing that had sold itself at 0: "Yes, I still have it" is the owner's correction of the count
		if c.snap.Stock != nil && c.snap.Stock.RestoreAfterYes(got.ID, got.Qty, fmt.Sprintf("ask-%s-%d", got.ID, confirmed), c.now) {
			item := listings.ListingStockID(got.ID)
			to := got.Qty
			if to == 0 {
				to = 1
			}
			c.logLine("stock", "confirmed", map[string]any{"op": "correct", "item": item, "to": to}, listings.StockRefs(item, "corrected", "owner"), "the owner said the shop still has a listing that had sold itself at 0, so the count was set to the number they first said")
		}
		return true
	}
	return false
}

// answerCard is conversation.ts `answerCard`: an answer to a card, whichever door it came through (the owner's page, or a typed code). `via` is "page" or "typed".
func (c *conv) answerCard(found *assistant.Card, answer, via string) {
	cur := func(cd *assistant.Card) (assistant.Action, string, bool) {
		if cd.Action.Skill != "listings" {
			return assistant.Action{}, "not_yours", false
		}
		act, _, why := c.prepare(cd.Proposal)
		return act, why, why == ""
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
		c.logLine("owner_card", "blocked", cardIn, refs(card, answer), "the card is already "+card.State+": nothing was done")
		c.say("card_closed")
	case "expired":
		c.a.Close(card, "expired", c.now)
		c.logLine("owner_card", "blocked", cardIn, refs(card, answer), "the card ran out before the tap: nothing was done")
		c.say("card_expired")
	case "refuse":
		c.refuse(card, refs, cardIn)
	case "gone":
		c.a.Close(card, "void", c.now)
		c.logLine("owner_card", "blocked", cardIn, refs(card, "yes"), fmt.Sprintf("the action can no longer be done (%s): nothing was done", v.Why))
		c.say("refusal."+v.Why, "ref", cs)
	case "changed":
		// The fields are not what the card showed. Nothing is done: the old card is void and a new one shows the action as it is now.
		c.a.Close(card, "void", c.now)
		c.logLine("owner_card", "blocked", cardIn, refs(card, "yes"), "what the card showed is not what the store holds now (a changed amount, payment or customer): nothing was done, and a new card was made")
		c.say("card_changed")
		if act, sh, why := c.prepare(card.Proposal); why == "" {
			c.offerCard(card.Proposal, act, sh)
		}
	case "do":
		ok := c.execute(card.Action, false)
		c.a.Close(card, "done", c.now)
		outcome, note := "confirmed", "done"
		if !ok {
			outcome, note = "failed", "failed"
		}
		r := refs(card, "yes")
		r["result"] = note
		c.logLine("owner_card", outcome, cardIn, r, "the owner tapped yes; the skill did the card's saved action")
		if !ok {
			c.say("listing_line.gone")
			return
		}
		if card.Action.Kind == "listing" {
			c.say("listing_line.published", "title", c.listingTitle(card))
		} else {
			c.say("listing_line.confirmed", "title", rawString(card.Action.Fields["title"]))
		}
	}
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

// refuse is the "no" half of answerCard: a no to a drafted listing drops the draft (nothing was ever public); a no to the morning question IS "Sold"; any other no changes nothing.
func (c *conv) refuse(card *assistant.Card, refs func(*assistant.Card, string) map[string]string, cardIn map[string]any) {
	cs := card.Action.Case
	if card.Action.Skill == "listings" && card.Action.Kind == "listing" {
		if m := listingCase.FindStringSubmatch(cs); m != nil {
			if l := c.findListing(m[1]); l != nil {
				c.ls().Remove(l.ID, c.now)
			}
		}
		c.a.Close(card, "refused", c.now)
		c.logLine("owner_card", "confirmed", cardIn, refs(card, "no"), "the owner said no; the draft listing was dropped and was never public")
		c.say("listing_line.dropped")
		return
	}
	if card.Action.Skill == "listings" && card.Action.Kind == "listing_ask" {
		if act, _, why := c.prepare(card.Proposal); why == "" && assistant.ActionDigest(act) == card.Digest {
			ok := c.execute(card.Action, true)
			c.a.Close(card, "refused", c.now)
			outcome, note := "confirmed", "done"
			if !ok {
				outcome, note = "failed", "failed"
			}
			r := refs(card, "no")
			r["result"] = note
			c.logLine("owner_card", outcome, cardIn, r, "the owner said it is sold: the listing is off the shop's page")
			c.say("listing_line.sold", "title", rawString(card.Action.Fields["title"]))
			return
		}
	}
	c.a.Close(card, "refused", c.now)
	c.logLine("owner_card", "confirmed", cardIn, refs(card, "no"), "the owner said no; the same action is not offered again for 24 hours")
	c.say("refused")
}

// onPageCard is conversation.ts `onPageCard`: the owner answered a card on their page (an `owner_action` card_yes / card_no, checked at the runtime against the owner's link or session
// before it was saved). The page posts the card's id and the digest it showed; a card with another digest is not the one shown, and nothing is done.
func (c *conv) onPageCard(id, digest, answer string) {
	card := c.a.CardByID(id)
	if card == nil || card.Digest != digest {
		c.logLine("owner_card", "blocked", map[string]any{"card": id}, map[string]string{"card": id, "decision": answer, "via": "page"}, "the owner's page posted a card that is not one the assistant holds with that digest: nothing was done")
		c.say("card_unknown")
		return
	}
	c.answerCard(card, answer, "page")
}

// ---- the owner's words ---------------------------------------------------------------------------------------------------------------------------------

var (
	relayReply = regexp.MustCompile(`(?i)^[\s\x{00a0}\x{feff}]*(approve|deny)[\s\x{00a0}\x{feff}]+[A-HJKMNP-Za-hjkmnp-z2-9]{4,6}[\s\x{00a0}\x{feff}]*$`)
	typedReply = regexp.MustCompile(`(?i)^[\s\x{00a0}\x{feff}]*(yes|no)[\s\x{00a0}\x{feff}]+([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})[\s\x{00a0}\x{feff}]*$`)
)

// ownerMessage is `onPageMessage` + `onOwnerMessage`: the owner's words from the talk box. The owner's line is kept first; then a typed card reply, then a listing, then the rules' reading.
func (r *Runtime) ownerMessage(snap *Snap, rec *recorder, ev map[string]any, now int64) error {
	text, _ := ev["text"].(string)
	id, _ := ev["id"].(string)
	c := r.assistantFor(snap, rec, now)
	c.a.AddTalk("owner", text, now)
	if relayReply.MatchString(text) {
		return nil // the approvals relay's own reply, not ours: dropped without a word
	}
	// A typed "yes K7M2QX" is a card's reply only when a card has that code; otherwise it is words to read ("no thanks")
	if m := typedReply.FindStringSubmatch(text); m != nil {
		hash := assistant.CodeHash(m[2])
		for i := range c.a.Cards {
			if c.a.Cards[i].CodeHash == hash {
				c.answerCard(&c.a.Cards[i], strings.ToLower(m[1]), "typed")
				return nil
			}
		}
	}
	// the key is TypeScript's: o:<the page's message id>, and the page's id is owner-page:<event id>
	taken, err := c.listingFromWords(text, "o:owner-page:"+id)
	if err != nil || taken {
		return err
	}
	c.readIntent(text)
	return nil
}

// readIntent is the rules' reading and what the assistant does with it.
func (c *conv) readIntent(text string) {
	read := assistant.ReadOwnerRules(text)
	kind := assistant.Offered(read.Kind)
	// the read is counted in the month's AI counts (reader.countUnderstood) and written to the record (conversation.ts, the owner_assistant line)
	budget.For(&c.snap.AI, c.r.clock, c.now).Rules++
	refs := map[string]string{"intent": kind, "step": "rules", "provider": "rules", "model": "rule-parser", "inputTokens": "0", "outputTokens": "0", "costMicroInr": "0", "tried": "rules"}
	if read.Ref != "" {
		refs["case"] = read.Ref
	}
	c.logLine("owner_assistant", "confirmed", map[string]any{"intent": kind}, refs, "")
	switch kind {
	case "help":
		p := c.r.o.Client.Settings.Assistant
		if p.Name != "" {
			c.say("help."+p.Personality+".named", "name", p.Name, "shop", c.r.o.Client.Settings.Name)
		} else {
			c.say("help."+p.Personality+".plain", "shop", c.r.o.Client.Settings.Name)
		}
	case "limit":
		// a listings-only shop declares no limit, so "which limit?" lists none (TypeScript's own line, empty list and all)
		c.say("limit_which")
	case "remember", "notes", "forget":
		c.say("not_offered") // the shop's memory is not in this runtime (go/TRIAL.md)
	case "leave_file":
		c.leave("file")
	case "leave_operator":
		c.leave("operator")
	case "waiting":
		c.showWaiting()
	case "money":
		c.money(read.Date)
	case "undo":
		c.undoLast()
	case "cancel", "refund", "message":
		if read.Ref == "" {
			c.say("need_ref." + kind)
			return
		}
		if kind == "message" && read.Words == "" {
			c.say("need_words", "ref", read.Ref)
			return
		}
		c.say("refusal.no_case", "ref", read.Ref) // no skill of this shop holds a case: "Nothing has the number b-14."
	default:
		// TypeScript answers with the owner-talk model first (talk-owner.ts); that is not in this runtime, so the fixed answer
		c.say("not_understood")
	}
}

// undoLast is conversation.ts `undoLast`. A listings-only shop makes no undo record of its own (it closes no day and moves no booking); the ones TypeScript's "remember" made are not
// undone here.
func (c *conv) undoLast() {
	for i := len(c.a.Undo) - 1; i >= 0; i-- {
		u := c.a.Undo[i]
		if !u.Done && u.UntilMs > c.now {
			c.say("not_offered")
			return
		}
	}
	c.say("undo_none")
}

// showWaiting is conversation.ts `showWaiting`: each skill's waiting items (none here) and any card the owner was shown and has not answered, shown again as a NEW card (the old is void).
func (c *conv) showWaiting() {
	var offers []assistant.Raw
	for _, cd := range c.a.OpenCards(c.now) {
		if cd.Action.Skill == "listings" {
			offers = append(offers, cd.Proposal)
		}
	}
	if len(offers) == 0 {
		c.say("waiting_head.zero")
	} else {
		c.say("waiting_head.n", "n", strconv.Itoa(len(offers)))
	}
	for i, p := range offers {
		if i >= 5 { // CARDS_PER_ASK
			break
		}
		if act, sh, why := c.prepare(p); why == "" {
			c.offerCard(p, act, sh)
		}
	}
}

// money is "money in" for a date: the payments the record holds on it (a listings-only shop takes none, so it is "nothing recorded"). A date other than today, tomorrow or the day after
// is not read by this port: the owner is told so with TypeScript's "doesn't handle that".
func (c *conv) money(d *assistant.DatePhrase) {
	t := time.UnixMilli(c.now).In(c.r.loc)
	if d != nil {
		if d.Other {
			c.say("not_offered")
			return
		}
		t = t.AddDate(0, 0, d.Offset)
	}
	y, m, day := t.Date()
	from := time.Date(y, m, day, 0, 0, 0, 0, c.r.loc).UnixMilli()
	to := time.Date(y, m, day+1, 0, 0, 0, 0, c.r.loc).UnixMilli()
	var paise, payments int64
	c.r.mu.RLock()
	entries := append(append(c.r.entries[:0:0], c.r.entries...), c.rec.fresh...)
	c.r.mu.RUnlock()
	for _, e := range entries {
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
	c.logLine(action, "confirmed", map[string]any{"kind": kind}, map[string]string{"ask": "ask_" + hex.EncodeToString(b), "via": "page"}, note)
	c.say(asked)
}

// mayAskAgain is leave.ts: not within an hour of the latest confirmed ask of this kind in the record (this step's lines included).
func (c *conv) mayAskAgain(action string) bool {
	var last int64 = -1 << 62
	c.r.mu.RLock()
	entries := append(append(c.r.entries[:0:0], c.r.entries...), c.rec.fresh...)
	c.r.mu.RUnlock()
	for _, e := range entries {
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

// onTick is conversation.ts `onTick`: cards past their time are closed, what is no longer needed is taken off, and the morning question is asked.
func (c *conv) onTick() {
	for _, cd := range c.a.Expire(c.now) {
		c.logLine("owner_card", "blocked", map[string]any{"card": cd.ID}, map[string]string{"card": cd.ID, "skill": cd.Action.Skill, "kind": cd.Action.Kind, "digest": cd.Digest, "decision": "none"}, "the card ran out without a tap: nothing was done")
	}
	c.a.Compact(c.now, c.r.today(c.now))
	if c.snap.hasList {
		c.snap.Listings.Tidy(c.now)
	}
	if c.snap.Stock != nil {
		c.snap.Stock.Tidy(c.now)
	}
	c.askFresh()
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
