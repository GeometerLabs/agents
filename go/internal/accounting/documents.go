// What a customer's document says, as plain data: a receipt, a bill, a bill of supply or a refund note (modules/accounting/documents.ts and case-documents.ts). A pure function: no page, no
// clock, no store. The page itself is internal/accounting/render (it needs the report package's escaping, and the report package imports this one for the record's entry type, so the HTML
// cannot live here without an import cycle).
//
// What the shop's tax status decides: an unregistered shop's document has no GSTIN, no tax line and no word "tax", ever; a composition shop's BILL is a "Bill of supply" and its documents
// begin with the legend of CGST rule 5(1)(f). This file has no field for a tax line. A Document may carry a customer's or student's name (`Person`) for drawing on the private page only:
// the caller must not keep or log a Document (it is rebuilt on every view).
package accounting

import (
	"fmt"
	"sort"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// DocKind is words-documents.ts DocKind: "receipt", "bill", "bill_of_supply" or "refund_note".
type DocKind string

// DocumentShop is the shop's name, address, phone, time zone and tax status for a document.
type DocumentShop struct {
	Name, Address, Phone, Timezone string
	Status                         TaxStatus
}

// DocumentShopLine is the three lines of the shop printed on a document.
type DocumentShopLine struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	Phone   string `json:"phone"`
}

// DocumentCite is a refund note's citation of its receipt.
type DocumentCite struct {
	Number string `json:"number"`
	At     string `json:"at"`
}

// Document is documents.ts Document.
type Document struct {
	Language    string           `json:"language"`
	Kind        DocKind          `json:"kind"`
	Number      string           `json:"number"`
	At          string           `json:"at"`
	TimeZone    string           `json:"timeZone"`
	AmountPaise int64            `json:"amountPaise"`
	Shop        DocumentShopLine `json:"shop"`
	Legend      bool             `json:"legend"`
	WhatFor     string           `json:"whatFor"`
	Person      string           `json:"person,omitempty"`
	Method      Method           `json:"method,omitempty"`
	Evidence    Evidence         `json:"evidence,omitempty"`
	Cites       *DocumentCite    `json:"cites,omitempty"`
}

// DocKindOf is documents.ts kindOf: the title's kind, by series, and for a BILL by the shop's status.
func DocKindOf(series Series, status TaxStatus) DocKind {
	switch series {
	case "RCT":
		return "receipt"
	case "CN":
		return "refund_note"
	}
	if status == "composition" {
		return "bill_of_supply"
	}
	return "bill"
}

// FormatPaise is formatPaise: whole rupees and paise from integer paise, by integer arithmetic only: 45000 is "₹450", 45050 is "₹450.50". The grouping is en-IN's (language.FormatInrWhole).
func FormatPaise(paise int64) (string, error) {
	if paise < 0 || paise > 9007199254740991 {
		return "", fmt.Errorf("An amount is a whole number of paise, 0 or more (got %d).", paise)
	}
	base := language.FormatInrWhole(paise / 100)
	if rest := paise % 100; rest != 0 {
		return fmt.Sprintf("%s.%02d", base, rest), nil
	}
	return base, nil
}

// DocumentInput is what MakeDocument needs (see the TypeScript's comment on documents.ts: the caller hands in all of the journal's documents so a refund note can cite its receipt).
type DocumentInput struct {
	Doc       DocRef
	Documents []DocRef
	Shop      DocumentShop
	Language  string
	WhatFor   func(caseID, language string) string
	// Person is optional (nil): a name by case id, or "" for none.
	Person func(caseID string) string
}

// MakeDocument is makeDocument.
func MakeDocument(o DocumentInput) Document {
	status := o.Shop.Status
	if status == "" {
		status = "unregistered"
	}
	d := o.Doc
	var receipt *DocRef
	if d.Series == "CN" && d.PaymentID != "" {
		for i := range o.Documents {
			x := o.Documents[i]
			if x.Series == "RCT" && x.PaymentID == d.PaymentID && sameCase(x.Case, d.Case) {
				receipt = &o.Documents[i]
				break
			}
		}
	}
	out := Document{
		Language: o.Language, Kind: DocKindOf(d.Series, status), Number: d.Number, At: d.At, TimeZone: o.Shop.Timezone, AmountPaise: d.AmountPaise,
		Shop: DocumentShopLine{o.Shop.Name, o.Shop.Address, o.Shop.Phone}, Legend: status == "composition",
		Method: d.Method, Evidence: d.Evidence,
	}
	if d.Case != nil {
		out.WhatFor = o.WhatFor(*d.Case, o.Language)
		if o.Person != nil {
			out.Person = o.Person(*d.Case)
		}
	}
	if receipt != nil {
		out.Cites = &DocumentCite{receipt.Number, receipt.At}
	}
	return out
}

// CaseDocuments is caseDocuments: the documents of ONE page's cases, ready to draw, newest first (by record sequence; equal sequences keep the journal's order, as a stable sort does). A
// document of a case the page does not own is never in the list, which is what makes "another case's number" a plain not-found at the front. The phone is left empty: the front adds the
// shop's phone from pages.json.
func CaseDocuments(j *Journal, cases []string, shop DocumentShop, language string, whatFor func(caseID, language string) string, person func(caseID string) string) []Document {
	mine := map[string]bool{}
	for _, c := range cases {
		mine[c] = true
	}
	all := j.Documents
	picked := []DocRef{}
	for _, d := range all {
		if d.Case != nil && mine[*d.Case] {
			picked = append(picked, d)
		}
	}
	sort.SliceStable(picked, func(a, b int) bool { return picked[b].Seq < picked[a].Seq })
	shop.Phone = ""
	out := make([]Document, 0, len(picked))
	for _, doc := range picked {
		out = append(out, MakeDocument(DocumentInput{Doc: doc, Documents: all, Shop: shop, Language: language, WhatFor: whatFor, Person: person}))
	}
	return out
}
