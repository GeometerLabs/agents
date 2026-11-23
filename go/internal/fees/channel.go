package fees

// What Fees' part of the shop page and the owner's page may READ (item 11h): the Go twin of templates/education/fees/src/channel.ts, from the centre's saved state and settings. A
// typed phone number never opens a student's fees: a parent's page is found ONLY by the hash of their private link (parentOf), a confirmation page only by the hash of the handle
// the parent's own press made. Everything is an allowlist: never the owner's one-use code, never another parent, never a record line. The digests are channel.ts digestOf
// (`sha256(JSON.stringify(parts))`, the first 32 hex digits), written with JSON.stringify's bytes (no HTML escaping).

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
)

type channelKit struct{ kit *Kit }

var (
	_ runtime.ChannelKit      = (*channelKit)(nil)
	_ runtime.ParentReader    = (*channelKit)(nil)
	_ runtime.MaterialReader  = (*channelKit)(nil)
	_ runtime.AccountantFiler = (*channelKit)(nil)
)

// jsJSON is JSON.stringify of plain values: Go's encoding without HTML escaping.
func jsJSON(v any) string {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	_ = e.Encode(v)
	return string(bytes.TrimRight(b.Bytes(), "\n"))
}

func digestOf(parts ...any) string {
	sum := sha256.Sum256([]byte(jsJSON(parts)))
	return hex.EncodeToString(sum[:])[:32]
}

func mustJSON(v any) json.RawMessage { return json.RawMessage(jsJSON(v)) }

func (k *channelKit) settings() *Settings { return k.kit.Settings }

// batchNames is channel.ts batchNames: a batch's name in every language.
func batchNames(s *Settings, batchID string) map[string]string {
	out := map[string]string{}
	b := s.BatchByID(batchID)
	for _, l := range runtime.LANGUAGES {
		if batchID == CreditBatch && s.Credit != nil {
			out[l] = WordsFor(l).Labels["creditBook"] // a credit account's entry is named "Credit book" where a batch's name would go
		} else if b != nil {
			out[l] = BatchName(b, l)
		} else {
			out[l] = batchID
		}
	}
	return out
}

// Offer is channel.ts feesOffer: the centre's name, address, languages and how parents pay; paused in the licence's wind-down; the assistant's character when it is on.
func (k *channelKit) Offer(st runtime.KitState, _ runtime.OfferQuery) (any, error) {
	s := k.settings()
	shop := map[string]any{"name": s.Name, "timezone": s.Timezone, "languages": s.Languages, "paused": k.kit.licence() != ""}
	if s.HasAddress {
		shop["address"] = s.Address
	}
	if s.OwnerMarked() {
		shop["payment"] = map[string]any{"kind": "upi", "payee": s.Payment.Payee}
	} else {
		shop["payment"] = map[string]any{"kind": "link"}
	}
	// item 11i: with the centre's assistant on, the page's head shows its character in the mood the public sees now (the front adds the picture)
	if centre, ok := st.(*Store); ok {
		if character := k.kit.publicCharacter(centre); character != nil {
			shop["character"] = character
		}
	}
	return map[string]any{"kind": "fees", "shop": shop}, nil
}

// payOf is channel.ts payOf: how to pay what is owed now, or nil.
func payOf(s *Settings, st *Store, d *Due) map[string]any {
	if d.State != Open || balancePaise(d) <= 0 {
		return nil
	}
	link := d.linkOf()
	if link == nil {
		return nil
	}
	if s.OwnerMarked() {
		led := st.ledger(false)
		if led == nil {
			return nil
		}
		for _, r := range led.Requests {
			if r.ID != link.ID {
				continue
			}
			if !liveRequest(r) || ownermarked.LeftOn(r) != balancePaise(d) {
				return nil
			}
			return map[string]any{"kind": "upi", "link": r.Link, "payTo": map[string]any{"id": s.Payment.UpiID, "name": s.Payment.Payee}, "amountPaise": r.AmountPaise, "leftPaise": ownermarked.LeftOn(r), "note": r.Reference}
		}
		return nil
	}
	if link.AmountPaise-d.paidOnLink(link.ID) == balancePaise(d) {
		return map[string]any{"kind": "link", "url": link.URL}
	}
	return nil
}

// feeLine is channel.ts feeLine.
func feeLine(s *Settings, st *Store, d *Due) map[string]any {
	out := map[string]any{
		"id": d.ID, "student": d.StudentName, "batch": batchNames(s, d.BatchID), "month": d.Month, "dueMs": d.DueMs,
		"feeInr": d.FeeInr, "lateFeeInr": d.LateFeeInr, "waivedInr": d.WaivedInr, "owedInr": owedPaise(d) / 100, "paidInr": float64(paidPaise(d)) / 100, "balanceInr": balanceInr(d),
		"state": d.State, "canSayPaid": d.State == Open && balancePaise(d) > 0, "claimed": d.State == Open && d.ClaimAtMs != nil,
	}
	if p := payOf(s, st, d); p != nil {
		out["pay"] = p
	}
	return out
}

// SettledShown is channel.ts SETTLED_SHOWN.
const SettledShown = 6

// Parent is channel.ts parentView: what a parent's private link opens.
func (k *channelKit) Parent(sv runtime.KitState, linkHash string) any {
	s, st := k.settings(), sv.(*Store)
	parent := st.parentOf(linkHash)
	if parent == "" {
		return nil
	}
	var open, settled []*Due
	for _, d := range st.Dues {
		if d.Customer != parent {
			continue
		}
		if d.State == Open {
			open = append(open, d)
		} else {
			settled = append(settled, d)
		}
	}
	sort.SliceStable(open, func(i, j int) bool { return open[i].DueMs < open[j].DueMs })
	sort.SliceStable(settled, func(i, j int) bool { return settled[i].DueMs > settled[j].DueMs })
	if len(settled) > SettledShown {
		settled = settled[:SettledShown]
	}
	students := []any{}
	for _, x := range s.Students {
		if x.Parent == parent {
			students = append(students, map[string]any{"name": x.Name, "batch": batchNames(s, x.BatchID)})
		}
	}
	dues := []any{}
	for _, d := range append(open, settled...) {
		dues = append(dues, feeLine(s, st, d))
	}
	return map[string]any{"ref": ParentRef(parent), "students": students, "dues": dues}
}

func confirmedDue(st *Store, handleHash string) *Due {
	cs := st.confirmationsOf(false)
	if cs == nil {
		return nil
	}
	c := cs.get(handleHash)
	if c == nil || c.Refused != nil {
		return nil
	}
	d := st.Due(c.DueID)
	if d == nil || d.Customer != c.Parent {
		return nil
	}
	return d
}

// View is channel.ts feeConfirmView: a payment's confirmation page, by its handle's hash.
func (k *channelKit) View(sv runtime.KitState, handleHash string) any {
	st := sv.(*Store)
	cs := st.confirmationsOf(false)
	if cs == nil || cs.get(handleHash) == nil {
		return nil
	}
	c := cs.get(handleHash)
	if c.Refused != nil {
		return map[string]any{"status": "refused", "reason": *c.Refused}
	}
	d := confirmedDue(st, handleHash)
	if d == nil {
		return nil
	}
	status := "waiting"
	switch {
	case d.State == Paid:
		status = "confirmed"
	case d.State == Closed:
		status = "closed"
	case paidPaise(d) > 0:
		status = "part"
	}
	return map[string]any{"status": status, "ref": d.ID, "op": "paid", "atMs": c.AtMs, "due": feeLine(k.settings(), st, d)}
}

// ownerItem is channel.ts OwnerItem.
type ownerItem struct {
	Kind        string         `json:"kind"`
	Case        string         `json:"case"`
	Digest      string         `json:"digest"`
	Actions     []string       `json:"actions"`
	AmountPaise int64          `json:"amountPaise"`
	Customer    map[string]any `json:"customer"`
	Channel     string         `json:"channel"`
	What        string         `json:"what"`
	Why         string         `json:"why,omitempty"`
	ClaimedAtMs *int64         `json:"claimedAtMs,omitempty"`
	UpiRef      string         `json:"upiRef,omitempty"`
	code        string
	request     string
}

func whatOf(s *Settings, d *Due) string {
	l := s.Owner.Language
	return batchNames(s, d.BatchID)[l] + ", " + monthLabel(d.Month, l)
}

// ownerItems is channel.ts ownerItems.
func ownerItems(s *Settings, st *Store) []ownerItem {
	var items []ownerItem
	led := st.ledger(false)
	find := func(id string) *ownermarked.MarkedRequest {
		if led == nil {
			return nil
		}
		for _, r := range led.Requests {
			if r.ID == id {
				return r
			}
		}
		return nil
	}
	for _, d := range st.Dues {
		if d.State != Open || d.ClaimAtMs == nil {
			continue
		}
		r := find(d.CurrentLinkID)
		if r == nil || codeOf(r.Code) == "" || !liveRequest(r) {
			continue
		}
		left := ownermarked.LeftOn(r)
		items = append(items, ownerItem{Kind: "deposit", Case: d.ID, Digest: digestOf("fee_claim", d.ID, r.ID, left, len(r.Marks), len(r.UsedCodes)), Actions: []string{"received"}, AmountPaise: left,
			Customer: map[string]any{"phone": d.Customer, "name": d.StudentName}, Channel: "whatsapp", What: whatOf(s, d), ClaimedAtMs: d.ClaimAtMs, UpiRef: d.ClaimRef, code: *r.Code})
	}
	if led != nil {
		for _, r := range led.Refunds {
			if r.State != ownermarked.RefundOwed || codeOf(r.Code) == "" {
				continue
			}
			d := st.Due(r.CaseID)
			cust := map[string]any{"phone": r.Customer}
			what := ""
			if d != nil {
				cust["name"], what = d.StudentName, whatOf(s, d)
			}
			items = append(items, ownerItem{Kind: "refund_owed", Case: r.CaseID, Digest: digestOf("refund_owed", r.CaseID, r.ID, r.AmountPaise, len(r.UsedCodes)), Actions: []string{"refunded"}, AmountPaise: r.AmountPaise,
				Customer: cust, Channel: "whatsapp", What: what, Why: r.Why, code: *r.Code})
		}
	}
	for _, d := range st.Dues {
		if len(d.Pending) == 0 {
			continue
		}
		switch p := d.Pending[0].(type) {
		case *Waiver:
			items = append(items, ownerItem{Kind: "waiver", Case: d.ID, Digest: digestOf("waiver", d.ID, p.ID, p.AmountInr, p.BalanceAtAskInr), Actions: []string{"approve", "deny"}, AmountPaise: p.AmountInr * 100,
				Customer: map[string]any{"phone": d.Customer, "name": d.StudentName}, Channel: "whatsapp", What: whatOf(s, d), request: p.ID})
		case *RefundRequest:
			items = append(items, ownerItem{Kind: "refund_request", Case: d.ID, Digest: digestOf("refund_request", d.ID, p.ID, p.AmountInr, p.PaymentID), Actions: []string{"approve", "deny"}, AmountPaise: p.AmountInr * 100,
				Customer: map[string]any{"phone": d.Customer, "name": d.StudentName}, Channel: "whatsapp", What: whatOf(s, d), request: p.ID})
		}
	}
	return items
}

// CashListMax is channel.ts CASH_LIST_MAX.
const CashListMax = 60

type cashRow struct {
	Case        string `json:"case"`
	Digest      string `json:"digest"`
	Student     string `json:"student"`
	What        string `json:"what"`
	AmountPaise int64  `json:"amountPaise"`
}

// cashList is channel.ts cashList: the open fees the owner may mark as paid by hand, soonest due first.
func cashList(s *Settings, st *Store) []cashRow {
	var open []*Due
	for _, d := range st.Dues {
		if d.State == Open && balancePaise(d) > 0 {
			open = append(open, d)
		}
	}
	sort.SliceStable(open, func(i, j int) bool { return open[i].DueMs < open[j].DueMs })
	if len(open) > CashListMax {
		open = open[:CashListMax]
	}
	out := []cashRow{}
	for _, d := range open {
		out = append(out, cashRow{Case: d.ID, Digest: digestOf("cash", d.ID, balancePaise(d), len(d.Payments), d.WaivedInr, d.LateFeeInr), Student: d.StudentName, What: whatOf(s, d), AmountPaise: balancePaise(d)})
	}
	return out
}

type parentRow struct {
	Ref      string   `json:"ref"`
	Phone    string   `json:"phone"`
	Students []string `json:"students"`
	Link     string   `json:"link"`
	SinceMs  *int64   `json:"sinceMs,omitempty"`
	Digest   string   `json:"digest"`
}

// parentsList is channel.ts parentsList: one entry per number, in the settings' order.
func parentsList(s *Settings, st *Store) []parentRow {
	var order []string
	by := map[string][]string{}
	for _, x := range s.Students {
		if _, has := by[x.Parent]; !has {
			order = append(order, x.Parent)
		}
		by[x.Parent] = append(by[x.Parent], x.Name)
	}
	links := st.parentLinks(false)
	out := []parentRow{}
	for _, phone := range order {
		row := parentRow{Ref: ParentRef(phone), Phone: phone, Students: by[phone], Link: "none"}
		hash, at := "", int64(0)
		if links != nil {
			if l := links.get(phone); l != nil {
				row.Link, row.SinceMs, hash, at = "active", N(l.AtMs), l.Hash, l.AtMs
			}
		}
		row.Digest = digestOf("parent", phone, hash, at)
		out = append(out, row)
	}
	return out
}

// Owner is channel.ts ownerView: the items without their codes, the parents and their links, the cash list and the Money section from the record, the Classes section, and
// with the centre's assistant on its app view (ownerAppView over the Fees skill and the last saved state's assistant part: agent_assistant.go).
func (k *channelKit) Owner(sv runtime.KitState, sn *runtime.Snap, entries []store.Entry) any {
	s, st := k.settings(), sv.(*Store)
	items := ownerItems(s, st)
	if items == nil {
		items = []ownerItem{}
	}
	var untold []accounting.UntoldInput
	for _, d := range st.Dues {
		for _, u := range d.RefundsUntold {
			untold = append(untold, accounting.UntoldInput{Case: d.ID, AmountInr: float64(u.AmountPaise) / 100})
		}
	}
	now := k.kit.now()
	out := map[string]any{
		"shop": map[string]any{"name": s.Name, "timezone": s.Timezone, "ownerLanguage": s.Owner.Language},
		"kind": "fees", "services": []any{}, "items": items, "upcoming": []any{}, "parents": parentsList(s, st), "cash": cashList(s, st),
		"money": accounting.OwnerMoney(accounting.MoneyViewInput{Journal: accounting.FeesJournal(entries), Entries: entries, RefundsUntold: untold, NowMs: now, TimeZone: s.Timezone}),
	}
	if s.Classes != nil {
		out["classes"] = ownerClassesView(s, st, now)
	}
	if s.Credit != nil {
		out["credit"] = creditRows(st) // the credit book (credit.go): who owes what, the owner's alone; left out for a centre without it, so its view is as it was
	}
	if app := k.kit.appView(st, sn); app != nil {
		out["app"] = app
	}
	return out
}

// feeFor is channel.ts FEE_FOR: "Fee for November 2026", the words of a fee's document (machine-written in hi, ml, kn, as the documents' words are).
var feeFor = map[string]func(string) string{
	"en": func(m string) string { return "Fee for " + m },
	"hi": func(m string) string { return m + " की फ़ीस" },
	"ml": func(m string) string { return m + "-ലെ ഫീസ്" },
	"kn": func(m string) string { return m + " ರ ಶುಲ್ಕ" },
}

// Documents is channel.ts documentsOf: for a parent's link (its hash) all of that parent's fees, for a confirmation page's handle that one fee. The front sends one hash; a parent's
// link and a confirmation handle are told apart by which one the saved state knows.
func (k *channelKit) Documents(sv runtime.KitState, entries []store.Entry, key, lang string) ([]any, bool) {
	s, st := k.settings(), sv.(*Store)
	var cases []string
	if parent := st.parentOf(key); parent != "" {
		for _, d := range st.Dues {
			if d.Customer == parent {
				cases = append(cases, d.ID)
			}
		}
	} else if d := confirmedDue(st, key); d != nil {
		cases = []string{d.ID}
	}
	whatFor := func(caseID, l string) string {
		d := st.Due(caseID)
		if d == nil {
			return ""
		}
		return feeFor[l](monthLabel(d.Month, l))
	}
	person := func(caseID string) string {
		if d := st.Due(caseID); d != nil {
			return d.StudentName
		}
		return ""
	}
	docs := accounting.CaseDocuments(accounting.FeesJournal(entries), cases, accounting.DocumentShop{Name: s.Name, Address: s.Address, Timezone: s.Timezone}, lang, whatFor, person)
	out := make([]any, len(docs))
	for i, d := range docs {
		out[i] = d
	}
	return out, true
}

// AccountantFiles is channel.ts exportFilesOf, with the old dues marked.
func (k *channelKit) AccountantFiles(_ runtime.KitState, entries []store.Entry, period string) (any, error) {
	months := accounting.OldDueMonths(entries)
	oldDue := func(e accounting.Entry) string {
		if e.Booking == nil {
			return ""
		}
		return months[*e.Booking]
	}
	return accounting.AccountantFiles(accounting.ExportInput{Journal: accounting.FeesJournal(entries), Entries: entries, Period: period, TimeZone: k.kit.Settings.Timezone, Tally: &accounting.TallyOptions{}, OldDueOf: oldDue})
}

// ChatWork is how many fees a chat conversation has made (none: a chat never makes a fee).
func (k *channelKit) ChatWork(runtime.KitState, string) int { return 0 }

// Material is runtime.ts's material read (Classes): materials.go.
func (k *channelKit) Material(sv runtime.KitState, linkHash, batch, file string) any {
	return k.kit.material(sv.(*Store), linkHash, batch, file)
}
