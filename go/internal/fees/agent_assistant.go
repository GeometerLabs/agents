package fees

// Fees as a skill of the shop's assistant (item 11e): the Go twin of templates/education/fees/src/assistant.ts `feesSkill`, and agent.ts's part that hands the skill its acts
// (`feesActs`) and turns the assistant on (modules/assistant/wire.ts assistantForAgent, through runtime.StepContext.Assistant). The conversation itself, its cards and its words
// are the shared runtime's (internal/runtime assistant.go, assistantkit.go, assistantowes.go): there is one assistant, and this file is only what is Fees' own. Modelled on
// internal/orders/agent_assistant.go, with Fees' own rules where assistant.ts differs from Orders'.
//
// The reads (who owes, what waits, the numbers for the owner's talk) are pure over the step's store. What waits is read from the owner page's own list (channel.go ownerItems),
// so "what needs me", the morning line's count, the mood and the owner's page always show the same things: a payment a parent says they made and a refund the owner owes (a UPI
// centre; answered with the same button and one-use code the owner's WhatsApp message carries), a waiver or a refund a parent asked for ("approve q-3" / "deny q-3").
// The acts are the agent's own paths: "cancel f-3" is the owner's waiver of the whole balance (the very applyWaiver of "approve q-3", after the payment record is read again) and
// "refund f-3" is the owner's decision sent as the same refund as "approve q-4" (Guard holds it above the limit; a UPI centre's owner owes it). The card binds the fee's state,
// balance, payments counted, waiver and late fee, so a change since voids it, and the act reads the record again on the tap. Nothing here decides a refund's size beyond what
// was paid.
//
// HOW EACH LINE IS WRITTEN: this file writes no words. The owner reads the shared runtime's packed words (internal/assistant/words, made by go/scripts/gen_words.ts feesWords
// from modules/assistant/words.ts), filled with what this skill hands it: a row's and a card's who, what and case go into the key's literal slots; an amount goes in as paise.
// The sources for the owner's talk (Facts, PublicContext) are data for the model, never shown as they are; the talk's reply is checked against them. A student's name is the
// owner's own to read (the owner's chat, the owner's page), never a parent's or the model's: the talk's facts carry counts and money only, as assistant.ts talkReads does.

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// assistantOf is agent.ts `assistant` (assistantForAgent: on only with an "assistant" block), made once a step. Fees is its one skill; the declared limits and the listings are
// added by the runtime, in wire.ts's order.
func (a *Agent) assistantOf() *runtime.Assistant {
	if a.asstMade || a.settings.Assistant == nil {
		return a.asst
	}
	a.asstMade = true
	a.asst = a.c.Assistant(runtime.AssistantHooks{
		Skill: &feesSkill{a: a, acts: true}, Fees: true, Messaging: a.msg,
		Log: func(caseID, phone, action, outcome string, inputs any, more messaging.LogMore) {
			m := logMore{refs: more.Refs, language: more.Language}
			if more.Notes != nil {
				m.notes = *more.Notes
			}
			for _, d := range more.Decisions {
				m.decisions = append(m.decisions, Decision(d))
			}
			a.log(a.store.Due(caseID), phone, action, outcome, inputs, m)
		},
		LanguageOf: func(phone string) string { return a.languageOf(phone, nil) },
		OptedOut:   func(phone string) bool { c := a.store.FindCustomer(phone); return c != nil && c.OptedOut },
		// a limit the owner tightened by a tap is in force for the rest of the same step (runtime-limits.ts applyInForce)
		InForce: a.applyInForce,
		// Listen is left out: the owner's voice notes are not heard on Go for Fees (Deferred.md), so a voice note gets the line asking to type, as with voice off
	})
	return a.asst
}

// morning is the owner's morning line (morning.ts createMorningJob over the Fees skill, read-only), on the beat after the agent's own work, through the owner's route and with
// the beat's save so its claim is on disk before it goes. A failure is said in the log and never holds up the beat.
func (a *Agent) morning(owner messaging.Messaging, save func() error) {
	if err := a.c.Morning(runtime.MorningContext{Skill: &feesSkill{a: a}, Messaging: owner, Save: save}); err != nil {
		a.c.Log("The owner's morning line could not be made: " + err.Error())
	}
}

// feesSkill is assistant.ts feesSkill over the step's agent. acts: the agent's own cancel, refund and answer paths are handed in (false: a read-only skill, for the morning line
// and the owner's page, over the last saved state: cancel and refund are prepared and refused as "not_here").
type feesSkill struct {
	a    *Agent
	acts bool
}

var (
	_ runtime.OwnerSkill     = (*feesSkill)(nil)
	_ runtime.OweSkill       = (*feesSkill)(nil)
	_ runtime.TalkFactsSkill = (*feesSkill)(nil)
	_ runtime.PublicSkill    = (*feesSkill)(nil)
)

// readSkill is the read-only skill over a store with no step (server/runtime.ts skillOver): the owner's page, the page's character.
func (k *Kit) readSkill(st *Store) *feesSkill {
	a := &Agent{kit: k, store: st, settings: k.Settings, can: k.Ports.Capabilities}
	a.ownerConfirms, a.ownerRefunds = !a.can.ConfirmsAutomatically, !a.can.RefundsAutomatically
	return &feesSkill{a: a}
}

// feeRef is assistant.ts routing.refs: a fee (f-), a request to the owner (q-) or a chat guest (g-).
var feeRef = regexp.MustCompile(`^[fqg]-\d{1,6}$`)

func (*feesSkill) Name() string         { return "fees" }
func (*feesSkill) Owns(ref string) bool { return feeRef.MatchString(ref) }

// now is the step's clock, or the Kit's for a read-only skill (no step).
func (k *feesSkill) now() int64 {
	if k.a.c != nil {
		return k.a.now()
	}
	return k.a.kit.now()
}

// what is assistant.ts `what`: the fee's month in the owner's language ("Sep 2026").
func (k *feesSkill) what(d *Due) string { return monthLabel(d.Month, k.a.settings.Owner.Language) }

// Owes is skill.ts `owes`: the open fees past their due date that still owe something, the oldest due first (Array.prototype.sort is stable: ties keep the store's order).
func (k *feesSkill) Owes() []runtime.OweRow {
	now := k.now()
	var rows []runtime.OweRow
	for _, d := range k.a.store.Dues {
		if d.State == Open && d.DueMs <= now && balancePaise(d) > 0 {
			rows = append(rows, runtime.OweRow{Case: d.ID, Who: d.StudentName, What: k.what(d), AmountPaise: balancePaise(d), DueMs: d.DueMs})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].DueMs < rows[j].DueMs })
	return rows
}

// ---- what waits for the owner ---------------------------------------------------------------------------------------------------------------------------------------------

// waiting is assistant.ts Waiting: an item as a card shows it, the page item's digest its card is bound to, and what a yes sends: the UPI mark's button with its code, or the
// owner's own "approve q-3" (request is the q- id).
type waiting struct {
	runtime.WaitingItem
	digest  string
	button  string
	request string
}

// answers is assistant.ts ANSWERS: the owner's fixed replies for each kind ("" : a mark has no "no"; the owner who has not had the money simply does not press).
var answers = map[string][2]string{"waiver": {"approve", "deny"}, "refund_request": {"approve", "deny"}, "deposit": {"received", ""}, "refund_owed": {"refunded", ""}}

func (k *feesSkill) waitingNow() []waiting {
	var out []waiting
	for _, it := range ownerItems(k.a.settings, k.a.store) {
		ans := answers[it.Kind]
		w := waiting{WaitingItem: runtime.WaitingItem{Case: it.Case, Kind: it.Kind, AmountPaise: it.AmountPaise, Money: true, Yes: ans[0], No: ans[1]}, digest: it.Digest, request: it.request}
		if d := k.a.store.Due(it.Case); d != nil {
			w.Who, w.What = d.StudentName, k.what(d)
		} else {
			// `d?.studentName ?? i.customer.name ?? i.customer.phone`, and the page item's own words for what
			w.Who, w.What = "", it.What
			if name, ok := it.Customer["name"].(string); ok {
				w.Who = name
			} else if phone, ok := it.Customer["phone"].(string); ok {
				w.Who = phone
			}
		}
		if it.code != "" {
			kind := ownermarked.ReplyRefunded
			if it.Kind == "deposit" {
				kind = ownermarked.ReplyReceived
			}
			w.button = ownermarked.MarkButtonID(kind, it.code)
		}
		out = append(out, w)
	}
	return out
}

func (k *feesSkill) waitingOn(d *Due, kind string) *waiting {
	for _, w := range k.waitingNow() {
		if w.Case == d.ID && w.Kind == kind {
			return &w
		}
	}
	return nil
}

func (k *feesSkill) Waiting() []runtime.WaitingItem {
	var out []runtime.WaitingItem
	for _, w := range k.waitingNow() {
		out = append(out, w.WaitingItem)
	}
	return out
}

// Problems is skill.ts `problems`: refunds that need the builder.
func (k *feesSkill) Problems() int {
	n := 0
	for _, d := range k.a.store.Dues {
		n += len(d.RefundIssues)
	}
	return n
}

// ---- prepare: the exact action from the store, or why it cannot be done --------------------------------------------------------------------------------------------------

// rawStr is a proposal's or a field's string (a JSON string; anything else as its raw text, which no case or kind ever is).
func rawStr(v json.RawMessage) string {
	var s string
	if json.Unmarshal(v, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(v))
}

// rawNum is a field's number (`Number(...)`; 0 when it is not one).
func rawNum(v json.RawMessage) int64 {
	var f float64
	_ = json.Unmarshal(v, &f)
	return int64(f)
}

func jnum(n int64) json.RawMessage { return json.RawMessage(strconv.FormatInt(n, 10)) }

// Prepare is assistant.ts prepare.
func (k *feesSkill) Prepare(p assistant.Raw) (runtime.Prepared, string) {
	a := k.a
	kind, cs := rawStr(p["kind"]), rawStr(p["case"])
	optedOut := func(phone string) bool { c := a.store.FindCustomer(phone); return c != nil && c.OptedOut }
	// a chat guest ("g-3") has no fee: only a message to them
	if prep, why, ok := runtime.PrepareGuestMessage(a.store.chanState(), "fees", kind, cs, rawStr(p["words"]), a.settings.Owner.Language, optedOut); ok {
		return prep, why
	}
	d := a.store.Due(cs)
	if d == nil {
		return runtime.Prepared{}, "no_case"
	}
	switch kind {
	case "answer":
		item := k.waitingOn(d, rawStr(p["itemKind"]))
		if item == nil {
			return runtime.Prepared{}, "nothing_waiting"
		}
		// a mark has no "no": the owner who has not had the money simply does not press
		if rawStr(p["answer"]) == "no" && item.No == "" {
			return runtime.Prepared{}, "nothing_waiting"
		}
		f := assistant.Raw{"who": mustJSON(d.StudentName), "itemKind": mustJSON(item.Kind), "pageDigest": mustJSON(item.digest), "amountPaise": jnum(item.AmountPaise)}
		if v, ok := p["answer"]; ok {
			f["answer"] = v
		}
		return runtime.Prepared{Action: assistant.Action{Kind: "answer", Skill: "fees", Case: d.ID, Fields: f}, Shown: runtime.Shown{Who: item.Who, What: item.What, AmountPaise: item.AmountPaise}}, ""
	case "message":
		// wire.ts checkWords: not to a parent who sent STOP; an amount in the words must be this fee's balance, its fee or its late fee (money back is a refund, with its own card)
		words := rawStr(p["words"])
		if optedOut(d.Customer) {
			return runtime.Prepared{}, "opted_out"
		}
		if amount := assistant.AmountOf(words); amount > 0 && amount != balancePaise(d) && amount != d.FeeInr*100 && amount != d.LateFeeInr*100 {
			return runtime.Prepared{}, "amount_not_on_record"
		}
		act := assistant.Action{Kind: "message", Skill: "fees", Case: d.ID, Fields: assistant.Raw{"who": mustJSON(d.StudentName), "phone": mustJSON(d.Customer), "words": mustJSON(words)}}
		return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: d.StudentName, What: k.what(d), Words: words, HasWords: true}}, ""
	}
	if !k.acts {
		return runtime.Prepared{}, "not_here"
	}
	return k.prepareMoney(p, kind, d)
}

// alreadyBack is money already going back on a payment: refunds the record confirmed (none for a read-only skill, which has no record), and UPI refunds owed or marked sent.
func (k *feesSkill) alreadyBack(paymentID string) int64 {
	var paise int64
	if k.a.c != nil {
		for _, e := range k.a.c.Rec.Entries() {
			if e.Action == "refund" && e.Refs["paymentId"] == paymentID && e.Outcome == "confirmed" {
				n, _ := strconv.ParseFloat(e.Refs["amountPaise"], 64) // `Number(...) || 0`
				paise += int64(n)
			}
		}
	}
	if l := k.a.store.ledger(false); l != nil {
		for _, r := range l.Refunds {
			if r.PaymentID == paymentID && r.State != ownermarked.RefundKept {
				paise += r.AmountPaise
			}
		}
	}
	return paise
}

// busy is assistant.ts busy: a refund Guard holds, one that could not be sent, one the parent asked for and waits for the owner, a waiver waiting, or one with an unclear
// outcome: answered first, not stacked on.
func busy(d *Due) bool { return len(d.Pending) > 0 || len(d.RefundIssues) > 0 }

// aboveLimit is assistant.ts aboveLimit: `!deps.acts?.ownerRefunds && paise > limit` (a UPI owner's own refund is theirs to send, so never above their limit).
func (k *feesSkill) aboveLimit(paise int64) bool {
	return !(k.acts && k.a.ownerRefunds) && paise > k.a.settings.RefundLimitInr*100
}

// standing is assistant.ts standing: what the card is bound to; if any of it changes, the card made before is void.
func standing(d *Due) assistant.Raw {
	return assistant.Raw{"state": mustJSON(d.State), "balancePaise": jnum(balancePaise(d)), "payments": jnum(int64(len(d.Payments))), "waivedInr": jnum(d.WaivedInr), "lateFeeInr": jnum(d.LateFeeInr)}
}

func (k *feesSkill) action(kind string, d *Due, fields assistant.Raw) assistant.Action {
	f := standing(d)
	f["who"] = mustJSON(d.StudentName)
	for key, v := range fields {
		f[key] = v
	}
	return assistant.Action{Kind: kind, Skill: "fees", Case: d.ID, Fields: f}
}

// prepareMoney is assistant.ts prepareMoney: a cancel (the owner waives what is still owed) or a refund of money paid.
func (k *feesSkill) prepareMoney(p assistant.Raw, kind string, d *Due) (runtime.Prepared, string) {
	if busy(d) {
		return runtime.Prepared{}, "busy"
	}
	if kind == "cancel" {
		// cancelling a fee is taking off what is still owed on it: only an open fee, owing whole rupees
		if d.State != Open || balancePaise(d) <= 0 {
			return runtime.Prepared{}, "not_live"
		}
		if balancePaise(d)%100 != 0 {
			return runtime.Prepared{}, "too_much"
		}
		// the card shows no money coming back (a cancel takes off what is owed; it refunds nothing: that is "refund f-3"), so its shown amount is 0; it is still bound to the
		// balance (assistant.ts, word for word: the card then reads "Nothing is owed", TRIAL.md's TypeScript findings)
		return runtime.Prepared{Action: k.action("cancel", d, assistant.Raw{"amountPaise": jnum(balancePaise(d))}), Shown: runtime.Shown{Who: d.StudentName, What: k.what(d)}}, ""
	}
	if kind != "refund" {
		return runtime.Prepared{}, "not_here"
	}
	online := false // a payment through a payments service or a UPI request: cash marked by hand is never refunded from here
	for _, x := range d.Payments {
		online = online || x.LinkID != CashLink
	}
	// a refund of money paid: once the fee no longer asks for money (a fee that is still open is cancelled first, with its own card); one refund for a payment, and never cash
	if d.State == Open {
		if online {
			return runtime.Prepared{}, "cancel_first"
		}
		return runtime.Prepared{}, "nothing_paid"
	}
	var candidates []CountedPayment
	for _, x := range d.Payments {
		if x.LinkID != CashLink && k.alreadyBack(x.ID) == 0 {
			candidates = append(candidates, x)
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].AmountPaise > candidates[j].AmountPaise })
	if len(candidates) == 0 {
		if online {
			return runtime.Prepared{}, "already_back"
		}
		return runtime.Prepared{}, "nothing_paid"
	}
	target := candidates[0]
	amount := target.AmountPaise
	if v, ok := p["amountPaise"]; ok {
		amount = rawNum(v)
	}
	if amount < 100 || amount > target.AmountPaise || amount%100 != 0 { // refunds go in whole rupees, never above the payment
		return runtime.Prepared{}, "too_much"
	}
	act := k.action("refund", d, assistant.Raw{"paymentId": mustJSON(target.ID), "amountPaise": jnum(amount), "availablePaise": jnum(target.AmountPaise)})
	return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: d.StudentName, What: k.what(d), AmountPaise: amount}, AboveLimit: k.aboveLimit(amount)}, ""
}

// ---- execute: the card's saved action, through the agent's own paths ------------------------------------------------------------------------------------------------------

// Execute is assistant.ts execute.
func (k *feesSkill) Execute(act assistant.Action) runtime.Executed {
	a := k.a
	d := a.store.Due(act.Case)
	if d != nil && k.acts && (act.Kind == "cancel" || act.Kind == "refund") {
		return k.executeMoney(act, d)
	}
	if !k.acts || d == nil || act.Kind != "answer" {
		return runtime.Executed{OK: false, Note: "failed"}
	}
	item := k.waitingOn(d, rawStr(act.Fields["itemKind"]))
	if item == nil {
		return runtime.Executed{OK: false, Note: "failed"}
	}
	// the very reply the owner could give on WhatsApp (wire.ts ownerReply): the mark's button (with its code), or "approve q-3" / "deny q-3"
	now := a.now()
	msg := messaging.InboundMessage{ID: "assistant:" + d.ID + ":" + strconv.FormatInt(now, 10), From: a.owner(), Timestamp: now}
	if item.button != "" {
		msg.Reply = &messaging.Reply{ID: item.button, Kind: "button"}
	} else {
		reply := item.Yes
		if rawStr(act.Fields["answer"]) == "no" {
			reply = item.No
		}
		msg.Text = reply + " " + item.request
	}
	if err := a.onOwnerMessage(msg); err != nil {
		a.stepErr = err
	}
	return runtime.Executed{OK: true, Note: "done"}
}

// executeMoney is assistant.ts executeMoney: the same facts as when the card was made (a card made before a payment, a waiver, a late fee or an answer to a parent is void; the
// module also checks the digest), nothing waiting on the fee, then the agent's own act.
func (k *feesSkill) executeMoney(act assistant.Action, d *Due) runtime.Executed {
	a := k.a
	for key, now := range standing(d) {
		if strings.TrimSpace(string(act.Fields[key])) != string(now) {
			return runtime.Executed{OK: false, Note: "failed"}
		}
	}
	if busy(d) {
		return runtime.Executed{OK: false, Note: "failed"}
	}
	amountInr := rawNum(act.Fields["amountPaise"]) / 100
	if act.Kind == "cancel" {
		done, err := a.ownerCancelFee(d, amountInr)
		if err != nil {
			a.stepErr = err
			return runtime.Executed{OK: false, Note: "failed"}
		}
		if done {
			return runtime.Executed{OK: true, Note: "done"} // the parent was told, as for any waiver
		}
		return runtime.Executed{OK: false, Note: "failed"}
	}
	result, err := a.ownerRefund(d, rawStr(act.Fields["paymentId"]), amountInr, "refunded by the owner through the shop's assistant")
	switch {
	case err != nil:
		a.stepErr = err
	case result == "owed":
		return runtime.Executed{OK: true, Note: "owed_by_owner"}
	case result == "done":
		return runtime.Executed{OK: true, Note: "done"}
	case result == "held":
		return runtime.Executed{OK: true, Note: "held_by_guard"}
	}
	return runtime.Executed{OK: false, Note: "failed"}
}

// ownerCancelFee is agent.ts feesActs.cancelFee: the owner waives exactly `amountInr`, the whole balance the card showed, after the payment record is read again. False when the
// fee is no longer open or no longer owes that amount (nothing is done then). The parent is told as for any waiver, and the fee's open links are closed.
func (a *Agent) ownerCancelFee(d *Due, amountInr int64) (bool, error) {
	if _, _, err := a.look(d); err != nil {
		return false, err
	}
	// only this exact action: the fee is still open and still owes what the card showed
	if d.State != Open || balanceInr(d) != amountInr || amountInr < 1 {
		return false, nil
	}
	decision := checkWaiver(amountInr, balanceInr(d), d.WaivedInr, a.settings.WaiverLimitInr, true)
	if decision.Verdict != "allow" {
		a.log(d, a.owner(), "waive_fee", "blocked", map[string]any{"amountInr": amountInr}, logMore{decisions: []Decision{decision}, notes: "the owner's cancel of this fee was not applied"})
		return false, nil
	}
	if err := a.applyWaiver(d, amountInr, "owner", []Decision{decision}); err != nil {
		return false, err
	}
	if d.State != Open {
		a.closeOpenLinks(d) // nothing more is asked on this fee
	}
	return d.State != Open, nil
}

// ownerRefund is agent.ts feesActs.refund: `amountInr` of one payment on this fee, the way "approve q-4" does it (one refund for a payment, the limit with the owner's yes),
// through sendOwnerRefund. "denied" when a check blocks it (said in the record).
func (a *Agent) ownerRefund(d *Due, paymentID string, amountInr int64, why string) (string, error) {
	var refunded int64
	paid := 0.0
	if p, err := a.pay.FetchPayment(a.ctx, paymentID); err == nil && p != nil { // `.catch(() => null)`
		refunded, paid = p.AmountRefunded, float64(p.Amount)/100
	}
	once := checkOneRefundPerPayment(paymentID, refunded)
	limit := checkRefundLimit(amountInr, a.settings.RefundLimitInr, paid, true)
	if once.Verdict == "block" || limit.Verdict == "block" {
		a.log(d, a.owner(), "refund", "blocked", map[string]any{"paymentId": paymentID, "amountInr": amountInr}, logMore{decisions: []Decision{once, limit},
			refs: map[string]string{"paymentId": paymentID, "amountPaise": itoa(amountInr * 100)}, notes: "the owner's refund from the shop's assistant was not sent"})
		return "denied", nil
	}
	return a.sendOwnerRefund(d, paymentID, amountInr, why, []Decision{once, limit})
}

// ---- the reads the owner's talk rests on (assistant.ts talkReads) ---------------------------------------------------------------------------------------------------------

// PublicContext is skill.ts `publicContext`: what a parent may be told (agent_customertalk.go publicContext), which the owner's talk reads with no parent.
func (k *feesSkill) PublicContext(phone string, _ int64) []assistant.TalkSource {
	return k.a.publicContext(phone)
}

// Facts is skill.ts `facts` for Fees (talkReads): the owner's numbers, counts and money only (no student's or parent's name or number); word for word TypeScript's English
// (data for the model, never shown as they are). Money is formatInr of rupees with paise (inrF), as `formatInr(paise / 100)`.
func (k *feesSkill) Facts(nowMs int64) []assistant.TalkSource {
	st := k.a.store
	var open, late, thisMonth []*Due
	var owed, lateOwed int64
	latest := ""
	for _, d := range st.Dues {
		if d.State == Open {
			open = append(open, d)
			owed += balancePaise(d)
			if d.DueMs < nowMs {
				late = append(late, d)
				lateOwed += balancePaise(d)
			}
		}
		if d.Month > latest { // the months sorted as strings ("2026-09" < "2026-11"), the last one
			latest = d.Month
		}
	}
	paid, stillOpen := 0, 0
	for _, d := range st.Dues {
		if d.Month == latest {
			thisMonth = append(thisMonth, d)
			if d.State == Paid {
				paid++
			}
			if d.State == Open {
				stillOpen++
			}
		}
	}
	n := strconv.Itoa
	return []assistant.TalkSource{
		{ID: "r:owed", Kind: "record", Text: "Fees still open: " + n(len(open)) + ", " + inrF(float64(owed)/100) + " in total. Past their due date: " + n(len(late)) + ", " + inrF(float64(lateOwed)/100) + ".",
			AmountsInr: []float64{float64(owed) / 100, float64(lateOwed) / 100}},
		{ID: "r:month", Kind: "record", Text: "The latest month's fees: " + n(len(thisMonth)) + " in all, " + n(paid) + " paid, " + n(stillOpen) + " still open."},
		{ID: "r:waiting", Kind: "record", Text: "Waiting for the owner's answer: " + n(len(ownerItems(k.a.settings, st))) + "."},
	}
}

// ---- the views over the last saved state (server/runtime.ts channel.offer and channel.owner) ------------------------------------------------------------------------------

// publicCharacter is app/view.ts publicCharacter over the Fees skill, read-only: the character's name when the Operator gave one, and the face the PUBLIC sees now. nil for a
// centre without the assistant, or before the runtime has a saved state to read.
func (k *Kit) publicCharacter(st *Store) json.RawMessage {
	if k.Settings == nil || k.Settings.Assistant == nil || k.shared == nil || k.LastSnap == nil {
		return nil
	}
	sn := k.LastSnap()
	if sn == nil {
		return nil
	}
	out := struct {
		Name string `json:"name,omitempty"`
		Face string `json:"face"`
	}{k.shared.Assistant.Name, runtime.PublicFace(sn, k.readSkill(st), k.now(), k.Settings.Loc)}
	return mustJSON(out)
}

// appView is app/view.ts ownerAppView over the Fees skill, read-only, with `listen` false (the owner's voice is not heard on Go for Fees: Deferred.md). nil for a centre without
// the assistant.
func (k *Kit) appView(st *Store, sn *runtime.Snap) any {
	if k.Settings == nil || k.Settings.Assistant == nil || k.shared == nil || sn == nil {
		return nil
	}
	return runtime.OwnerAppView(sn, k.shared, k.readSkill(st), k.now(), k.Settings.Loc, false)
}
