package words

// The WhatsApp templates in the form Meta approves them: the Go twin of templates/commerce/orders/src/language/meta-templates.ts and the mechanism it shares with Bookings and Fees
// (modules/language/meta-templates.ts: metaBody, fillBody, createMetaCatalogue's parametersFor, templateMessage and submissions). The bodies, their names and which message each
// carries the words of are GENERATED (<lang>.json.gz, go/scripts/gen_orders_words.ts); so is how each `{slot}` of a body is filled (a slot of the message: `{advance}` is the
// message's `{advanceInr}`, `{cutoff}` its `{cutAt}`), found by asking the TypeScript `parametersFor`. Here only the filling is done, and exampleFacts' own arithmetic.

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

// languageOrder is languages.ts LANGUAGES: the order a list of submissions walks the languages in (Hindi first).
var languageOrder = []string{"hi", "en", "ml", "kn"}

// MetaTemplates are the WhatsApp templates in one language, in the TypeScript's order (META_TEMPLATES).
func MetaTemplates(lang string) []MetaWord { return WordsFor(lang).Meta }

// MetaBody is meta-templates.ts metaBody: {slot} turned into {{1}}, {{2}} ... in order.
func MetaBody(body string) string {
	n := 0
	return slotRe.ReplaceAllStringFunc(body, func(string) string { n++; return "{{" + strconv.Itoa(n) + "}}" })
}

var numbered = regexp.MustCompile(`\{\{(\d+)\}\}`)

// FillBody is meta-templates.ts fillBody: a Meta body ({{1}} ...) filled with parameters, what the customer will read; a number with no parameter is left empty.
func FillBody(metaText string, parameters []string) string {
	return numbered.ReplaceAllStringFunc(metaText, func(m string) string {
		n, _ := strconv.Atoi(numbered.FindStringSubmatch(m)[1])
		if n >= 1 && n <= len(parameters) {
			return parameters[n-1]
		}
		return ""
	})
}

// MetaParameters is meta-templates.ts parametersFor: the values of a template's slots in the facts' language, read from the record; a *MissingFact if the record lacks one.
func MetaParameters(t MetaWord, f *MessageFacts) ([]string, error) {
	w := WordsFor(f.Language)
	var out []string
	for _, m := range slotRe.FindAllStringSubmatch(t.Body, -1) {
		slot, ok := w.MetaSlots[m[1]]
		if !ok {
			return nil, fmt.Errorf("The template body has an unknown value {%s}.", m[1])
		}
		v, err := f.value(w, slot)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// TemplateMessage is what goes out as a template: its name, language, the text and the parameters.
type TemplateMessage struct {
	Name       string   `json:"name"`
	Language   string   `json:"language"`
	Text       string   `json:"text"`
	Parameters []string `json:"parameters,omitempty"`
}

// MetaTemplateMessage is meta-templates.ts templateMessage: the template message for text that must go out as a template. A message that is exactly one of the templates goes as
// that template with its parameters, but only if filling it gives back the very text the outgoing check read. Anything else goes as the generic name with no parameters (a provider
// that knows only the real templates then refuses it). Generic is Words.Generic.Owner for a message to the owner and Words.Generic.Customer for one to a customer.
func MetaTemplateMessage(ids []string, f *MessageFacts, text, generic string) TemplateMessage {
	if len(ids) == 1 {
		for _, t := range MetaTemplates(f.Language) {
			if t.UsedFor != ids[0] {
				continue
			}
			if params, err := MetaParameters(t, f); err == nil && FillBody(MetaBody(t.Body), params) == text {
				return TemplateMessage{t.Name, f.Language, text, params}
			}
			break // the first template for the message is the one (a Map keeps the last; none of ours is named twice: the generator refuses it)
		}
	}
	return TemplateMessage{Name: generic, Language: f.Language, Text: text}
}

// MetaSubmission is meta-templates.ts MetaSubmission: one entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates).
type MetaSubmission struct {
	Name            string          `json:"name"`
	Language        string          `json:"language"`
	Category        string          `json:"category"`
	ParameterFormat string          `json:"parameter_format"`
	Components      []MetaComponent `json:"components"`
}

// MetaComponent is the body of a submission: its text with {{n}} and an example for each parameter.
type MetaComponent struct {
	Type    string `json:"type"`
	Text    string `json:"text"`
	Example struct {
		BodyText [][]string `json:"body_text"`
	} `json:"example"`
}

// MetaSubmissions is meta-templates.ts metaSubmissions: every template in every language, with example values from the shop's own settings. A template whose example record lacks a
// value is an error (the TypeScript throws).
func MetaSubmissions(s *Shop) ([]MetaSubmission, error) {
	// the TypeScript walks the templates (their order is the same in every language) and, for each, the languages
	first := MetaTemplates("en")
	var out []MetaSubmission
	for i := range first {
		for _, lang := range languageOrder {
			t := MetaTemplates(lang)[i]
			params, err := MetaParameters(t, ExampleFacts(s, lang))
			if err != nil {
				return nil, err
			}
			c := MetaComponent{Type: "BODY", Text: MetaBody(t.Body)}
			c.Example.BodyText = [][]string{params}
			out = append(out, MetaSubmission{t.Name, lang, "UTILITY", "positional", []MetaComponent{c}})
		}
	}
	return out, nil
}

// MenuItem is one item of the shop's menu as the words read it (settings.ts MenuItem without its stock): its id, what it is called per language (the first name is the one the agent
// says) and its price in whole rupees.
type MenuItem struct {
	ID       string              `json:"id"`
	Names    map[string][]string `json:"names"`
	PriceInr int64               `json:"priceInr"`
}

// Shop is the small part of the Orders settings the words read, for ItemList and ExampleFacts. HOW THE LEAD FILLS IT from settings.ts Settings: Name = name, Timezone = timezone,
// Menu = menu (id, names, priceInr), AdvancePercent = advance.percent, PickupFrom and PickupTo = pickup.slots[0].from and .to ("HH:MM"), CutoffTime = cutoff.time ("HH:MM"),
// DeliveryArea = delivery.area[0] (empty when the shop does not deliver), WindowHours = cancellation.windowHours. ItemList needs only Menu; ExampleFacts needs all of it.
type Shop struct {
	Name           string     `json:"name"`
	Timezone       string     `json:"timezone"`
	Menu           []MenuItem `json:"menu"`
	AdvancePercent int64      `json:"advancePercent"`
	PickupFrom     string     `json:"pickupFrom"`
	PickupTo       string     `json:"pickupTo"`
	CutoffTime     string     `json:"cutoffTime"`
	DeliveryArea   string     `json:"deliveryArea"`
	WindowHours    int64      `json:"windowHours"`
}

// ItemName is settings.ts itemName: the name the agent says for an item in a language, falling back to English, Hindi, Malayalam, Kannada and then the id. An empty list of names
// is as no names (JavaScript's `names[l]?.[0]` is undefined for it); a first name that is the empty string is a name (`??` does not skip it).
func ItemName(i *MenuItem, lang string) string {
	for _, l := range []string{lang, "en", "hi", "ml", "kn"} {
		if names := i.Names[l]; len(names) > 0 {
			return names[0]
		}
	}
	return i.ID
}

// clock is "H:M" as hour and minute (the shop's settings were checked as 24-hour times).
func clock(text string) (int, int) {
	h, m, _ := strings.Cut(text, ":")
	hh, _ := strconv.Atoi(h)
	mm, _ := strconv.Atoi(m)
	return hh, mm
}

// ExampleFacts is meta-templates.ts exampleFacts: example values for Meta's review, a believable order of the shop in the template's own language. The shop must have a menu.
// The constants (the address, the link, the order's reference ...) are read from the generated pack, and the example's day (12 Nov 2026 and the days around it) is the TypeScript's.
func ExampleFacts(s *Shop, lang string) *MessageFacts {
	ex := &WordsFor(lang).Example
	item := &s.Menu[0]
	day := func(d [3]int, hhmm string) int64 {
		h, m := clock(hhmm)
		return zone.ZonedToMs(zone.Date{Year: d[0], Month: d[1], Day: d[2]}, h, m, s.Timezone)
	}
	total := item.PriceInr * ex.Qty
	advance := (total*s.AdvancePercent + 99) / 100 // Math.ceil(total * percent / 100) over whole rupees
	area := s.DeliveryArea
	if area == "" {
		area = ex.DefaultArea
	}
	return &MessageFacts{
		Language: lang, TimeZone: s.Timezone, BusinessName: s.Name, Menu: []MenuPrice{},
		ItemsText: S(strings.Replace(ex.ItemsText, "{item}", ItemName(item, lang), 1)), TotalInr: N(total), AdvanceInr: N(advance), BalanceInr: N(total - advance), RefundInr: N(advance),
		MarkedInr: N(advance), LeftInr: N(ex.LeftInr),
		DateMs: N(day(ex.Date, "00:00")), SlotFromMs: N(day(ex.Date, s.PickupFrom)), SlotToMs: N(day(ex.Date, s.PickupTo)), CutoffMs: N(day(ex.CutoffDate, s.CutoffTime)),
		Mode: S(ex.Mode), Area: S(area), Address: S(ex.Address),
		Link: S(ex.Link), OrderRef: S(ex.OrderRef), CustomerPhone: S(ex.CustomerPhone), ApprovalCode: S(ex.ApprovalCode), ApprovalHours: N(ex.ApprovalHours), ApprovalsLeft: N(ex.ApprovalsLeft),
		UpiCode: S(ex.UpiCode), Payee: S(s.Name), WindowHours: N(s.WindowHours), Partner: S(ex.Partner), UpcomingCount: N(ex.UpcomingCount),
		Plan: &PlanFacts{Meals: N(ex.Meals), FromMs: N(day(ex.Date, "00:00")), ToMs: N(day(ex.PlanToDate, "00:00"))},
		// E1: the item, its price, the price asked and the card's code (meta-templates.ts exampleFacts)
		ItemName: S(ItemName(item, lang)), PriceInr: N(item.PriceInr), OfferedInr: N(item.PriceInr - ex.OfferedLess), DiscountCode: S(ex.DiscountCode),
	}
}
