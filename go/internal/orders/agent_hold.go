package orders

// "Keep one for me", the no-advance pickup hold (24 Nov 2026; the shop starter's job 3, decision 63; catalogue "Where the hold is built" and "Retail hold pilot"). A shop whose
// advance mode is "none" (Settings.NoAdvance) runs the Orders flow with four changes, and only those:
//
//  1. No payment link is sent and no money moves: proceedToHold holds the unit (holdForPickup) instead of making a link, and nothing is posted to the books.
//  2. The hold lasts until the agreed pickup time: the END of the pickup slot the customer chose on the day they chose (HoldExpiresAt = SlotEndMs), not advance.holdMinutes.
//     The words say it from the same fact (slotToMs, the window in `when`), so "held for you" and the moment the tick lets it go are one number.
//  3. The owner, not the model, decides the item: a customer's photo or words the reader cannot place (a model number) start an ENQUIRY (startHoldEnquiry): the owner gets a
//     card and answers "pick o-3 <item as listed>" (or "deny o-3"); the listed item's price is the price. A customer who names a listed item themselves still waits for the
//     shop's yes ("approve o-3", askToHold). Either way the customer hears "held for you" only after the shop accepted AND the unit is reserved in the same step.
//  4. Staff mark it collected ("collected o-3" on WhatsApp, or the owner's page): the hold stands (confirmed, then completed) and the shared stock count is lowered once
//     (reconcileStock books a standing order under `sale:<order>:<item>`); expiry (the tick) or cancellation releases it once, by the order's one state change.
//
// The pilot rules held here: two people asking for the last unit get at most one active hold (availability counts every other active hold of the item on ANY day against
// the item's stock, HeldAnyDay, and the shared count's unbooked holds, CountedLeft; the check is run again in the step that reserves); a retry keeps the hold (onOrder's
// "same request" path answers with the hold as it is, never a second card or a new expiry); the words keep "we usually carry it" (hold_usually), "in stock" (hold_offer) and
// "held for you" (hold_held) apart.
//
// What the record says, for the monthly page (report/data.ts holdsOf, go/internal/ordersreport): one `pickup_hold` line per step, with refs.step = enquiry (once per
// order: the denominator of "collections per ten enquiries", unanswered ones included), held, collected, expired or cancelled. The shop's other lines are Orders' own
// (ask_owner, owner_decision, hold_stock, release_stock, cancel_order, complete_order), so the owner's part and the stock are counted as they always were.
//
// One shop number, several parts (owner decision 65, 24 Nov 2026): every kind, command and record line here is namespaced (pending "hold_pick"/"hold_ask", owner items
// "hold_pick"/"hold_ask"/"hold", the action "pickup_hold", the verbs "pick" and "collected" on an "o-" order). Whether a picture starts an enquiry is ONE predicate
// (photoStartsHold), so a bundle that puts the credit book (where a picture is a payment claim) beside this part has one place to route it.

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/orders/reading"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// holdAction is the record's action for a step of a pickup hold; holdKind its refs' kind (also on the owner's ask and answers, so the report can tell them apart).
const (
	holdAction = "pickup_hold"
	holdKind   = "pickup_hold"
)

// The owner's two fixed replies of the hold: "pick o-3 <the item's name or id as listed>" and "collected o-3". `\s` is JavaScript's (language.JSSpace); (?i) as the i flag.
var (
	holdPickCmd  = regexp.MustCompile(`(?is)^` + sp + `*pick` + sp + `+(o-[0-9]+)` + sp + `+(.+?)` + sp + `*$`)
	collectedCmd = regexp.MustCompile(`(?i)^` + sp + `*collected` + sp + `+(o-[0-9]+)` + sp + `*$`)
)

// pickupHold is the order's `pickupHold` member: how the enquiry started ("photo", "words" or "order"), when, the listed item the owner picked for a photo or a model number,
// when the shop accepted (the owner's pick or "approve"), and when staff marked it collected. Kept raw on the order like E1's deal (Order.Extra), so a store read and written
// back keeps its bytes and a shop without holds never has the member.
type pickupHold struct {
	From          string `json:"from"`
	AskedAtMs     int64  `json:"askedAtMs"`
	Picked        string `json:"picked,omitempty"`
	PickedQty     int64  `json:"pickedQty,omitempty"` // how many the owner's pick was a yes for; more needs the shop's yes again
	AcceptedAtMs  *int64 `json:"acceptedAtMs,omitempty"`
	CollectedAtMs *int64 `json:"collectedAtMs,omitempty"`
}

func (o *Order) hold() *pickupHold {
	raw := o.ExtraOf("pickupHold")
	if raw == nil {
		return nil
	}
	var h pickupHold
	if json.Unmarshal(raw, &h) != nil {
		return nil
	}
	return &h
}

func (o *Order) setHold(h *pickupHold) {
	if h == nil {
		o.SetExtra("pickupHold", nil)
		return
	}
	o.SetExtra("pickupHold", jsonOf(h))
}

// HoldAsk is the pending entry `{kind: "hold_ask", totalInr, askedAtMs}`: a hold that waits for the shop's yes ("approve o-3" / "deny o-3"). HoldPick is
// `{kind: "hold_pick", askedAtMs}`: a photo or a model number that waits for the owner to pick the listed item ("pick o-3 <item>" / "deny o-3").
type HoldAsk struct {
	Kind      string `json:"kind"`
	TotalInr  int64  `json:"totalInr"`
	AskedAtMs int64  `json:"askedAtMs"`
}

type HoldPick struct {
	Kind      string `json:"kind"`
	AskedAtMs int64  `json:"askedAtMs"`
}

// HoldAskOf and HoldPickOf are the entry as that kind, or nil.
func HoldAskOf(p payments.Pending) *HoldAsk {
	o, ok := p.(*payments.OtherPending)
	if !ok || o.Kind != "hold_ask" {
		return nil
	}
	var h HoldAsk
	if json.Unmarshal(o.Raw, &h) != nil {
		return nil
	}
	return &h
}

func HoldPickOf(p payments.Pending) *HoldPick {
	o, ok := p.(*payments.OtherPending)
	if !ok || o.Kind != "hold_pick" {
		return nil
	}
	var h HoldPick
	if json.Unmarshal(o.Raw, &h) != nil {
		return nil
	}
	return &h
}

// holdPickOn is the photo's or model number's ask waiting on the order, or nil.
func holdPickOn(o *Order) *HoldPick {
	for _, p := range o.Pending {
		if h := HoldPickOf(p); h != nil {
			return h
		}
	}
	return nil
}

// withoutHoldKinds is the order's pending list less the hold's own asks (both are answered, or no longer stand, when the unit is reserved or the order changes).
func withoutHoldKinds(ps []payments.Pending) []payments.Pending {
	keep := []payments.Pending{}
	for _, p := range ps {
		if k := p.PendingKind(); k != "hold_ask" && k != "hold_pick" {
			keep = append(keep, p)
		}
	}
	return keep
}

func holdRefs(step string, more ...string) map[string]string {
	r := map[string]string{"kind": holdKind, "step": step}
	for i := 0; i+1 < len(more); i += 2 {
		r[more[i]] = more[i+1]
	}
	return r
}

// photoStartsHold is THE one predicate for a customer's picture on this shop: on a pickup-hold shop it starts an item enquiry (never a payment claim: nothing is paid
// ahead). A bundle that runs another part on the same number (the credit book reads a picture as "I paid") routes the picture here only when this says yes.
func (a *Agent) photoStartsHold(phone string) bool {
	return a.settings.NoAdvance() && !a.store.Customer(phone).OptedOut
}

// wordsStartHold is THE predicate for words on this shop that the reader could not place: they start an item enquiry only when they look like a model number (a digit
// in them: "6205 bearing", "philips 9w led"), so "thanks" or "what time do you close" do not ping the owner or count as an enquiry; and never from a chat guest, whose
// words the owner cannot see in their own WhatsApp. A bundle that runs other parts on the same number routes unplaced words here only when this says yes.
func (a *Agent) wordsStartHold(phone, text string) bool {
	return a.settings.NoAdvance() && !a.store.Customer(phone).OptedOut && !runtime.IsChatConversation(phone) && strings.ContainsAny(text, "0123456789")
}

// noteEnquiry gives the order its hold member the first time and records the enquiry once (the report's denominator).
func (a *Agent) noteEnquiry(o *Order, from string) *pickupHold {
	if h := o.hold(); h != nil {
		return h
	}
	h := &pickupHold{From: from, AskedAtMs: a.now()}
	o.setHold(h)
	a.log(o, o.Customer, holdAction, "confirmed", map[string]any{"from": from}, logMore{refs: holdRefs("enquiry", "from", from),
		notes: "a customer asked the shop to keep an item for pickup; counted once per order, answered or not"})
	return h
}

// startHoldEnquiry is a photo, or words the reader could not place (a model number), from a customer of a pickup-hold shop: the owner is asked which listed item it is.
// One enquiry at a time per customer: a retry while the shop is asked is told so, with no second card; a customer whose hold waits hears where it stands.
func (a *Agent) startHoldEnquiry(phone, from string) error {
	if !a.takesNewWork() {
		a.pausedReply(phone, "order", nil)
		return nil
	}
	if w := a.store.LatestOrder(phone, []string{AwaitingAdvance, AwaitingOwner}); w != nil {
		a.tellAlreadyWaiting(w)
		return nil
	}
	o := a.store.LatestOrder(phone, []string{Enquiry})
	if o != nil && holdPickOn(o) != nil {
		a.log(o, phone, holdAction, "blocked", map[string]any{"from": from}, logMore{refs: holdRefs("enquiry", "from", from),
			notes: "the shop is already asked which item this customer means; no second card"})
		a.tellCustomer(o, phone, []string{"hold_still_asking"}, sayOpts{})
		return nil
	}
	if o == nil {
		o = a.store.Register(NewDraft(phone, a.languageOf(phone, nil)))
	}
	o.Language = a.languageOf(phone, nil)
	a.noteEnquiry(o, from)
	o.Pending = append(withoutHoldKinds(o.Pending), otherPending("hold_pick", HoldPick{Kind: "hold_pick", AskedAtMs: a.now()}))
	a.log(o, phone, "ask_owner", "held_for_owner", map[string]any{"from": from}, logMore{refs: map[string]string{"to": "owner", "kind": holdKind},
		notes: "the owner picks the listed item a photo or a model number shows, and so its price; the assistant only passes it on, and nothing is held until then"})
	a.tellOwner(o, phone, "owner_hold_enquiry", sayOpts{})
	a.tellCustomer(o, phone, []string{"hold_enquiry_asked"}, sayOpts{})
	return nil
}

// holdWord is a blocked template as a pickup-hold shop says it: a listed item with none to keep is "we usually carry it", fewer than asked is "only so many can be kept".
func (a *Agent) holdWord(t string) string {
	if !a.settings.NoAdvance() {
		return t
	}
	switch t {
	case "sold_out":
		return "hold_usually"
	case "out_of_stock":
		return "hold_only_left"
	}
	return t
}

// askToHold is proceed's last step on a pickup-hold shop: the shop's yes first, unless the owner already gave it by picking this very item for a photo or a model number.
func (a *Agent) askToHold(o *Order, ctx *flowCtx, total int64) error {
	h := a.noteEnquiry(o, "order")
	if h.AcceptedAtMs != nil && h.Picked != "" && onlyItem(o.Lines, h.Picked) && CountOf(o.Lines) <= h.PickedQty {
		return a.proceedToHold(o, ctx) // the owner's pick was the yes for this item and this many (one reservation: a blocked try clears it, holdBlocked)
	}
	now := a.now()
	if o.State == Enquiry {
		_ = o.MoveTo(AwaitingOwner)
	}
	o.Pending = append(withoutHoldKinds(o.Pending), otherPending("hold_ask", HoldAsk{Kind: "hold_ask", TotalInr: total, AskedAtMs: now}))
	a.log(o, o.Customer, "ask_owner", "held_for_owner", map[string]any{"totalInr": total}, logMore{decisions: catD(ctx.shown), refs: map[string]string{"to": "owner", "kind": holdKind},
		notes: "a pickup hold waits for the shop's yes; nothing is held until then, so the customer is not told it is held"})
	a.tellOwner(o, o.Customer, "owner_hold_ask", sayOpts{})
	a.tellCustomer(o, o.Customer, cat(ctx.prefix, "hold_asked_shop"), sayOpts{shown: catD(ctx.shown)})
	return nil
}

func onlyItem(lines []OrderLine, id string) bool {
	if len(lines) == 0 {
		return false
	}
	for _, l := range lines {
		if l.ItemID != id {
			return false
		}
	}
	return true
}

// holdForPickup is proceedToHold on a pickup-hold shop, after the checks passed in this same step: the unit is reserved until the end of the agreed pickup slot, and only
// then is the customer told "held for you". No link, no money.
func (a *Agent) holdForPickup(o *Order, ctx *flowCtx, av availability) error {
	now := a.now()
	phone := o.Customer
	if o.SlotEndMs == nil || *o.SlotEndMs <= now {
		// the pickup time is already over (a slot whose cut-off is after its end): nothing is held, and the customer is asked for another time
		d := checkBeforeCutoff(now, now)
		if o.SlotEndMs != nil {
			d = checkBeforeCutoff(now, *o.SlotEndMs)
		}
		a.log(o, phone, "check_order", "blocked", inputs("date", o.Date, "slot", optS(o.SlotID)), logMore{decisions: []Decision{d}, notes: "the agreed pickup time has already ended"})
		if o.State != Enquiry {
			_ = o.MoveTo(Enquiry)
		}
		o.Pending, o.SlotID = withoutHoldKinds(o.Pending), ""
		a.tellCustomer(o, phone, cat(ctx.prefix, "after_cutoff"), sayOpts{shown: catD(ctx.shown, d)})
		return nil
	}
	until := *o.SlotEndMs
	o.HoldExpiresAt = &until
	if o.State == Enquiry || o.State == AwaitingOwner || o.State == Expired {
		_ = o.MoveTo(AwaitingAdvance)
	}
	o.Pending = withoutHoldKinds(o.Pending)
	h := a.noteEnquiry(o, "order")
	if h.AcceptedAtMs == nil {
		h.AcceptedAtMs = &now
	}
	o.setHold(h)
	a.log(o, phone, "hold_stock", "confirmed", inputs("lines", o.Lines, "date", o.Date, "slot", optS(o.SlotID), "until", until), logMore{decisions: av.decisions,
		notes: "the shop accepted: the item is kept for this customer until the end of the agreed pickup time; no payment link is made and no money moves"})
	a.log(o, phone, holdAction, "confirmed", map[string]any{"until": until}, logMore{refs: holdRefs("held", "until", i64(until))})
	a.tellCustomer(o, phone, cat(ctx.prefix, "hold_held"), sayOpts{shown: catD(ctx.shown, av.decisions...), itemID: ctx.itemID, offer: cancelOrOwner})
	a.tellOwner(o, phone, "owner_hold_held", sayOpts{})
	return nil
}

// HeldAnyDay is what other orders hold of an item on ANY day (a pickup hold is a unit on the shelf, not a day's batch): confirmed ones and ones whose hold has not run out.
func (st *Store) HeldAnyDay(itemID string, nowMs int64, exceptID string) int64 {
	var n int64
	for _, o := range st.Orders {
		if o.ID == exceptID || !HoldsStock(o, nowMs) {
			continue
		}
		for _, l := range o.Lines {
			if l.ItemID == itemID {
				n += l.Qty
			}
		}
	}
	return n
}

// keepableNow is how many of an item could be kept for this order now: its stock less every other active hold, and the shop's count less what holds take of it.
func (a *Agent) keepableNow(item *MenuItem, o *Order) int64 {
	a.reconcileStock()
	now := a.now()
	left := max(0, item.DailyStock-a.store.HeldAnyDay(item.ID, now, o.ID))
	if shelf, counted := a.store.CountedLeft(a.stockCount(), item.ID, now, o.ID); counted {
		left = min(left, shelf)
	}
	return left
}

// matchListed is the listed item the owner names: its id, one of its names in any language (letter case aside), or the one item the rule reader finds in the words.
// strings.ToLower is JavaScript's toLowerCase for the names a shop lists (no Turkish or final-sigma cases among them).
func (a *Agent) matchListed(name string) *MenuItem {
	want := strings.ToLower(language.TrimJS(name))
	for i := range a.settings.Menu {
		it := &a.settings.Menu[i]
		if strings.ToLower(it.ID) == want {
			return it
		}
		for _, ns := range it.Names {
			for _, n := range ns {
				if strings.ToLower(n) == want {
					return it
				}
			}
		}
	}
	in := reading.ParseIntent(name, a.parse)
	if len(in.Items) == 1 {
		return a.settings.ItemOf(in.Items[0].ItemID)
	}
	return nil
}

// onHoldPick is the owner's "pick o-3 <item>": the listed item (and so its price) a customer's photo or model number shows. The pick is the shop's yes for that item; the
// customer then hears it is in stock and is asked when they will pick it up (or that it cannot be kept now).
func (a *Agent) onHoldPick(ref, name string) error {
	o := a.store.Order(ref)
	said := map[string]string{"command": "pick", "kind": holdKind}
	if o == nil || o.State != Enquiry || holdPickOn(o) == nil {
		a.log(o, a.owner(), "owner_decision", "blocked", map[string]any{"command": "pick", "ref": ref}, logMore{refs: said, notes: "no photo or model number waits on this order"})
		a.tellOwner(nil, a.owner(), "owner_unknown_command", sayOpts{})
		return nil
	}
	item := a.matchListed(name)
	if item == nil {
		a.log(o, a.owner(), "owner_decision", "blocked", map[string]any{"command": "pick", "ref": ref}, logMore{refs: said, notes: "the words name no listed item, or more than one"})
		a.tellOwner(o, o.Customer, "owner_hold_pick_unclear", sayOpts{})
		return nil
	}
	now := a.now()
	o.Pending = withoutHoldKinds(o.Pending)
	h := a.noteEnquiry(o, "photo")
	var qty int64 = 1
	if onlyItem(o.Lines, item.ID) {
		qty = CountOf(o.Lines)
	}
	h.Picked, h.PickedQty, h.AcceptedAtMs = item.ID, qty, &now
	o.setHold(h)
	o.Lines = []OrderLine{{ItemID: item.ID, Qty: qty}}
	said["item"] = item.ID
	a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"command": "pick", "item": item.ID}, logMore{refs: said,
		notes: "the owner picked the listed item, and so its price; the model decided nothing"})
	if left := a.keepableNow(item, o); left < qty {
		// a listed item with none to keep now: "we usually carry it", and nothing is held
		_ = o.MoveTo(Cancelled)
		a.log(o, o.Customer, holdAction, "blocked", map[string]any{"item": item.ID, "left": left}, logMore{refs: holdRefs("declined"), notes: "the item the owner picked has none to keep now"})
		t := "hold_usually"
		var lc *int64
		if left > 0 {
			t, lc = "hold_only_left", &left
		}
		a.tellCustomer(o, o.Customer, []string{t}, sayOpts{itemID: item.ID, leftCount: lc})
		return nil
	}
	return a.proceed(o, &flowCtx{prefix: []string{"hold_offer"}, itemID: item.ID})
}

// onHoldAnswer is the owner's "approve o-3" / "deny o-3" on a hold's ask (pending hold_ask) or a photo's ("deny" only: a pick names the item). The page's buttons send the
// same words (agent_channel.go onOwnerAction), so there is one decision path.
func (a *Agent) onHoldAnswer(o *Order, pending payments.Pending, command string) error {
	said := map[string]string{"command": command, "kind": holdKind}
	if HoldPickOf(pending) != nil && command == "approve" {
		a.log(o, a.owner(), "owner_decision", "blocked", map[string]any{"command": command}, logMore{refs: said, notes: "a photo or model number is answered by picking the listed item"})
		a.tellOwner(o, o.Customer, "owner_hold_pick_unclear", sayOpts{})
		return nil
	}
	o.Pending = without(o.Pending, pending)
	if command == "deny" {
		_ = o.MoveTo(Cancelled)
		a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said, notes: "the shop cannot keep this item"})
		a.log(o, o.Customer, holdAction, "confirmed", map[string]any{"by": "owner"}, logMore{refs: holdRefs("declined")})
		a.tellCustomer(o, o.Customer, []string{"hold_declined"}, sayOpts{})
		return nil
	}
	now := a.now()
	h := a.noteEnquiry(o, "order")
	h.AcceptedAtMs = &now
	o.setHold(h)
	a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said,
		notes: "the shop said yes; the unit is reserved now only if it is still there"})
	return a.proceedToHold(o, &flowCtx{})
}

// onCollected is staff's "collected o-3" (WhatsApp, or the owner's page): the hold stands and is done, and the shared count is lowered once in this step. A hold that ran out
// may still be collected (the customer came late and the unit was there): it is recorded against the original hold. Anything else is refused and changes nothing.
func (a *Agent) onCollected(ref string) error {
	o := a.store.Order(ref)
	var h *pickupHold
	if o != nil {
		h = o.hold()
	}
	if o == nil || h == nil || h.CollectedAtMs != nil || (o.State != AwaitingAdvance && o.State != Expired) {
		a.log(o, a.owner(), holdAction, "blocked", map[string]any{"ref": ref}, logMore{refs: holdRefs("collected"),
			notes: "no hold with this number waits to be collected (never held, already collected, or cancelled)"})
		a.tellOwner(nil, a.owner(), "owner_hold_none", sayOpts{})
		return nil
	}
	late := o.State == Expired
	if late {
		// the unit was released at the end of the pickup time: if another customer's hold has it now, a late mark would promise one unit twice, so it is refused
		for _, l := range o.Lines {
			if it := a.settings.ItemOf(l.ItemID); it != nil && a.keepableNow(it, o) < l.Qty {
				a.log(o, a.owner(), holdAction, "blocked", map[string]any{"ref": ref, "late": true}, logMore{refs: holdRefs("collected", "late", "true"),
					notes: "the pickup time had ended and another customer's hold has this unit now: the late collection is not recorded"})
				a.tellOwner(nil, a.owner(), "owner_hold_none", sayOpts{})
				return nil
			}
		}
		_ = o.MoveTo(AwaitingAdvance)
	}
	_ = o.MoveTo(Confirmed)
	_ = o.MoveTo(Completed)
	o.HoldExpiresAt = nil
	now := a.now()
	h.CollectedAtMs = &now
	o.setHold(h)
	refs := holdRefs("collected")
	notes := "staff marked the item collected: the hold stands, and the shop's stock count is lowered once"
	if late {
		refs["late"] = "true"
		notes = "staff marked the item collected after its pickup time ended: recorded against the original hold, and the shop's stock count is lowered once"
	}
	a.log(o, a.owner(), holdAction, "confirmed", map[string]any{"late": late}, logMore{refs: refs, notes: notes})
	end := int64(0)
	if o.SlotEndMs != nil {
		end = *o.SlotEndMs
	}
	a.log(o, o.Customer, "complete_order", "confirmed", map[string]any{"endMs": end})
	a.reconcileStock() // the standing order is booked off the shop's count in this same step
	a.tellOwner(o, o.Customer, "owner_hold_collected", sayOpts{})
	return nil
}

// endHold is expireHold on a pickup-hold shop: the agreed pickup time ended and the item was not collected. It is released once (the one state change), the customer and
// the owner are told, and there is no money to look for.
func (a *Agent) endHold(o *Order) error {
	if o.State != AwaitingAdvance {
		return nil
	}
	_ = o.MoveTo(Expired)
	a.log(o, o.Customer, "release_stock", "confirmed", inputs("until", o.HoldExpiresAt), logMore{notes: "the agreed pickup time ended and the item was not collected, so it is free for others again"})
	a.log(o, o.Customer, holdAction, "confirmed", inputs("until", o.HoldExpiresAt), logMore{refs: holdRefs("expired")})
	a.tellCustomer(o, o.Customer, []string{"hold_ended"}, sayOpts{})
	a.tellOwner(o, o.Customer, "owner_hold_ended", sayOpts{})
	return nil
}

// letGoHold is onCancel on a held item of a pickup-hold shop: it is free for others at once, the customer hears so, and the owner is told so it goes back on the shelf.
func (a *Agent) letGoHold(o *Order) error {
	a.dropHold(o, "the customer let go of the hold before collecting it")
	a.tellCustomer(o, o.Customer, []string{"hold_cancelled"}, sayOpts{})
	return nil
}

// dropHold is cancelWaiting on a pickup-hold shop (the customer's cancel, a changed request, the owner's cancel through the assistant): the order ends at once, and a hold that
// held a unit records its release and tells the owner the item is free. There is no link to close and no payment to look for.
func (a *Agent) dropHold(o *Order, why string) {
	held := o.State == AwaitingAdvance
	state := o.State
	o.HoldExpiresAt = nil
	_ = o.MoveTo(Cancelled)
	o.Pending = []payments.Pending{}
	a.log(o, o.Customer, "cancel_order", "confirmed", map[string]any{"state": state}, logMore{notes: why})
	if held {
		a.log(o, o.Customer, holdAction, "confirmed", map[string]any{"why": why}, logMore{refs: holdRefs("cancelled")})
		a.tellOwner(o, o.Customer, "owner_hold_cancelled", sayOpts{})
	}
}

// holdBlocked is proceedToHold's refusal on a pickup-hold shop: the shop's yes (or the owner's pick) was for ONE reservation, so a later try asks the shop again.
func (a *Agent) holdBlocked(o *Order) {
	if h := o.hold(); h != nil && h.AcceptedAtMs != nil {
		h.AcceptedAtMs, h.PickedQty = nil, 0
		o.setHold(h)
	}
}
