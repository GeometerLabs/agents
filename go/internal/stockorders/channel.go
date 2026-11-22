package stockorders

// What the owner's private page shows for a Stock orders shop, read from the saved store only: the Go twin of src/channel.ts (ownerItems, ownerView). The orders that wait for
// the owner's yes (the agent's own approval card: its case is the card's id, its digest the card's own), the order messages that may not have arrived ("They got it" / "Send it
// again"), the ones WhatsApp refused ("Try now" / "Cancel order", with the time of the next try), the suppliers who stayed silent ("ask again"), and the deliveries to mark. Each
// carries a digest of what it shows, so a press for something that has changed since does nothing (agent.go onOwnerAction).
//
// The digest is channel.ts digestOf: sha256 of the parts joined with "|" (a missing part is ""), the first 32 hex digits; numbers are written as JavaScript's String(n).

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

type ownerCustomer struct {
	Phone string `json:"phone"`
	Name  string `json:"name"`
}

// ownerItem is channel.ts OwnerItem (backend.ts OwnerItemView).
type ownerItem struct {
	Kind        string        `json:"kind"`
	Case        string        `json:"case"`
	Digest      string        `json:"digest"`
	Actions     []string      `json:"actions"`
	AmountPaise int64         `json:"amountPaise"`
	Customer    ownerCustomer `json:"customer"`
	Channel     string        `json:"channel"`
	StartMs     *int64        `json:"startMs,omitempty"`
	What        string        `json:"what"`
}

func digestOf(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:])[:32]
}

func optMs(p *int64) string {
	if p == nil {
		return ""
	}
	return strconv.FormatInt(*p, 10)
}

// whatOf is channel.ts whatOf: "10 box hair colour", in the owner's language.
func whatOf(s *Settings, o *Order) string {
	l := s.Owner.Language
	return strconv.FormatInt(o.Qty, 10) + " " + nameIn(s.unitOf(o.Unit).Names, l) + " " + nameIn(s.itemOf(o.Item).Names, l)
}

func ownerItems(s *Settings, st *Store, now int64, cards *assistant.State) []ownerItem {
	out := []ownerItem{}
	if cards != nil {
		for _, c := range cards.OpenCards(now) {
			if c.Action.Skill != skillName || c.Action.Kind != "order" {
				continue
			}
			o := st.order(c.Action.Case)
			if o == nil || o.State != "awaiting_approval" {
				continue
			}
			sp := s.supplierOf(o.Supplier)
			out = append(out, ownerItem{Kind: "po_approval", Case: c.ID, Digest: c.Digest, Actions: []string{"card_yes", "card_no"}, AmountPaise: o.TotalPaise,
				Customer: ownerCustomer{sp.WhatsApp, sp.Name}, Channel: "whatsapp", What: o.ID + ": " + whatOf(s, o)})
		}
	}
	for _, o := range st.Orders {
		sp := s.supplierOf(o.Supplier)
		cust := ownerCustomer{sp.WhatsApp, sp.Name}
		var unsure, refused *messaging.SendIntent
		if o.State == "send_unknown" && o.Ack == "none" && st.SendOnce != nil {
			for _, i := range messaging.OpenUnknowns(st.SendOnce, orderKind) {
				if i.CaseID == o.ID {
					unsure = i
					break
				}
			}
		}
		if o.State == "approved" && st.SendOnce != nil {
			for _, i := range messaging.OpenRefusals(st.SendOnce, orderKind) {
				if i.CaseID == o.ID {
					refused = i
					break
				}
			}
		}
		what := o.ID + ": " + whatOf(s, o)
		switch {
		case refused != nil:
			next := messaging.NextTryMs(refused)
			out = append(out, ownerItem{Kind: "po_refused", Case: o.ID, Digest: digestOf(o.ID, refused.ID, strconv.Itoa(refused.Tries)), Actions: []string{"try_now", "cancel_order"},
				AmountPaise: o.TotalPaise, Customer: cust, Channel: "whatsapp", StartMs: &next, What: what})
		case unsure != nil:
			out = append(out, ownerItem{Kind: "po_unsure", Case: o.ID, Digest: digestOf(o.ID, unsure.ID, unsure.Status, unsure.Resolved), Actions: []string{"got_it", "send_again"},
				AmountPaise: o.TotalPaise, Customer: cust, Channel: "whatsapp", What: what})
		case o.Ack == "none" && (o.State == "sent" || o.State == "send_unknown") && o.SilentTold != nil:
			sent := 0
			for _, r := range o.Asks {
				if r.Sent {
					sent++
				}
			}
			out = append(out, ownerItem{Kind: "po_silent", Case: o.ID, Digest: digestOf(o.ID, o.State, o.Ack, optMs(o.AskedMs), strconv.Itoa(sent)), Actions: []string{"retry"},
				AmountPaise: o.TotalPaise, Customer: cust, Channel: "whatsapp", What: what})
		case o.Ack == "accepted" && isOpen(o):
			w := what
			if o.ReceivedQty > 0 {
				w += " (" + strconv.FormatInt(o.ReceivedQty, 10) + "/" + strconv.FormatInt(o.Qty, 10) + ")"
			}
			out = append(out, ownerItem{Kind: "po_receive", Case: o.ID, Digest: digestOf(o.ID, o.State, o.Receipt, strconv.FormatInt(o.ReceivedQty, 10), strconv.FormatInt(o.Qty, 10)),
				Actions: []string{"received"}, AmountPaise: o.TotalPaise, Customer: cust, Channel: "whatsapp", What: w})
		}
	}
	return out
}

type upcomingRow struct {
	Case     string        `json:"case"`
	StartMs  int64         `json:"startMs"`
	What     string        `json:"what"`
	Customer ownerCustomer `json:"customer"`
	Channel  string        `json:"channel"`
	State    string        `json:"state"`
}

// ownerView is channel.ts ownerView: the items, and the orders now with suppliers as the page's "coming" list.
func ownerView(s *Settings, st *Store, now int64, cards *assistant.State) map[string]any {
	up := []upcomingRow{}
	for _, o := range st.Orders {
		if (o.State != "sent" && o.State != "send_unknown") || !isOpen(o) {
			continue
		}
		sp := s.supplierOf(o.Supplier)
		start := o.CreatedMs
		if o.SentMs != nil {
			start = *o.SentMs
		}
		up = append(up, upcomingRow{Case: o.ID, StartMs: start, What: o.ID + ": " + whatOf(s, o) + " · " + sp.Name, Customer: ownerCustomer{sp.WhatsApp, sp.Name}, Channel: "whatsapp", State: o.State})
	}
	return map[string]any{
		"shop": map[string]any{"name": s.Name, "timezone": s.Timezone, "ownerLanguage": s.Owner.Language}, "kind": "stock", "services": []any{},
		"items": ownerItems(s, st, now, cards), "upcoming": up,
	}
}
