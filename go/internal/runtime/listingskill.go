package runtime

// The shop's listings as a skill of the owner's assistant (modules/assistant/listing-card.ts createListings): a drafted listing's card ("Show this on your page?") and the morning
// question ("Still have it?"). Every shop's assistant has it (wire.ts puts it after the template's own skill), so a listing's card takes the same path as every other card. The
// listing code itself is internal/listings; this file only reads it for a card and acts through it on a tap.

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/listings"
)

var listingCase = regexp.MustCompile(`^listing:(l-\d{1,9})$`)

func caseOfListing(id string) string { return "listing:" + id }

// listingsSkill is listing-card.ts's skill, over the step's assistant.
type listingsSkill struct{ c *conv }

func (listingsSkill) Name() string           { return "listings" }
func (listingsSkill) Owns(ref string) bool   { return listingCase.MatchString(ref) }
func (listingsSkill) Waiting() []WaitingItem { return nil }
func (listingsSkill) Problems() int          { return 0 }

// PublicContext is listing-card.ts publicContext: each public listing as a setting the talk may rest on (talk.go listingSources).
func (k listingsSkill) PublicContext(string, int64) []assistant.TalkSource {
	return k.c.listingSources()
}

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

func (c *conv) findListing(id string) *listings.Listing {
	s := c.ls()
	for i := range s.Items {
		if s.Items[i].ID == id {
			return &s.Items[i]
		}
	}
	return nil
}

// Prepare is listing-card.ts `prepare`: the action as the store holds it NOW, and what the owner is shown; or why it cannot be done.
func (k listingsSkill) Prepare(p assistant.Raw) (Prepared, string) {
	c := k.c
	kind, cs := rawString(p["kind"]), rawString(p["case"])
	if kind != "listing" && kind != "listing_ask" {
		return Prepared{}, "not_here"
	}
	m := listingCase.FindStringSubmatch(cs)
	var l *listings.Listing
	if m != nil {
		l = c.findListing(m[1])
	}
	if l == nil {
		return Prepared{}, "no_case"
	}
	title := listings.TextIn(l, c.lang).Title
	if kind == "listing" {
		if l.State != "draft" {
			return Prepared{}, "not_live"
		}
		return Prepared{Action: assistant.Action{Kind: "listing", Skill: "listings", Case: cs, Fields: listingFields(l)},
			Shown: Shown{Who: c.pack.Category(l.Category), What: title, AmountPaise: l.PricePaise, Words: l.PriceNote}}, ""
	}
	confirmed := rawInt(p["confirmedMs"])
	if l.State != "live" || l.ConfirmedMs != confirmed {
		return Prepared{}, "not_live"
	}
	return Prepared{Action: assistant.Action{Kind: "listing_ask", Skill: "listings", Case: cs, Fields: assistant.Raw{"title": jstring(title), "confirmedMs": jnum(confirmed)}}, Shown: Shown{What: title}}, ""
}

// Execute is listing-card.ts `execute`: the saved action. A "no" to the morning question (`answer: "no"`) is "Sold".
func (k listingsSkill) Execute(act assistant.Action) Executed {
	c := k.c
	m := listingCase.FindStringSubmatch(act.Case)
	if m == nil {
		return Executed{false, "failed"}
	}
	l := c.findListing(m[1])
	if l == nil {
		return Executed{false, "failed"}
	}
	s := c.ls()
	switch act.Kind {
	case "listing":
		// the tap is the owner's: the authority comes from the door the draft came through, only after the card's digest matched the draft as it is now
		got, why := s.Publish(l.ID, c.now)
		if why != "" {
			return Executed{false, "failed"}
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
		return Executed{true, "done"}
	case "listing_ask":
		if rawString(act.Fields["answer"]) == "no" {
			got, why := s.MarkSold(l.ID, c.now)
			if why != "" {
				return Executed{false, "failed"}
			}
			c.logLine("listing", "confirmed", map[string]any{"listing": got.ID}, refsOf(got, "sold"), "the owner said it is sold; the listing is off the shop's page")
			return Executed{true, "done"}
		}
		confirmed := rawInt(act.Fields["confirmedMs"])
		got, why := s.Confirm(l.ID, c.now, confirmed)
		if why != "" {
			return Executed{false, "failed"}
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
		return Executed{true, "done"}
	}
	return Executed{false, "failed"}
}
