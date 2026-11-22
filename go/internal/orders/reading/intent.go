package reading

// What a customer can mean when they write to a shop that takes pre-orders (src/adapters/model.ts Intent and ParseContext), the check that what a parser or a model returned is
// really one (coerceIntent: a model's answer is untrusted input, decoded to `any` and type-checked by hand), and how a tapped button or list row becomes an Intent with no model
// (src/language/interactive.ts intentFromReply).
//
// Numbers: a date's and a time's numbers are float64, as decoded JSON, because the readers of a date and a time take them so (the Bookings lesson); the quantity of a line and a
// price named are whole numbers in Go (int, int64) and are written to JSON exactly as the TypeScript's are.

import (
	"encoding/json"
	"math"
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// IntentKinds is model.ts KINDS, in its order (generated: reading.json "kinds").
func IntentKinds() []string { return words().Kinds }

// ModelKinds is model.ts MODEL_KINDS: what a language model may answer (every kind but "keep", which only the shop's own "No, keep it" button sets).
func ModelKinds() []string { return words().ModelKinds }

// IntentLine is model.ts IntentLine: an item and how many.
type IntentLine struct {
	ItemID string `json:"itemId"`
	Qty    int    `json:"qty"`
}

// Intent is model.ts Intent. Date and Time are the phrases the shared finders return, kept as the objects they came as (coerceIntent copies them whole), nil when absent.
// Items and SlotIDs: nil is "not said", an empty non-nil slice is "said, none" (a model's `items: []` stays `items: []`), as the TypeScript keeps them apart.
type Intent struct {
	Kind     string
	Language string
	Items    []IntentLine
	Date     map[string]any
	Time     map[string]any
	// SlotID is a slot named by a tap on the slot list; SlotIDs the slots a name the customer wrote ("lunch") stands for: one per mode, so the way picks between them.
	SlotID  string
	SlotIDs []string
	Mode    string // "pickup" or "delivery"
	// OfferInr is a price the customer proposed. The agent never accepts one below the menu price.
	OfferInr *int64
	Ask      *bool // set only by the shop's own "Cancel order" button, which asks "are you sure" first
	// OverrideAttempt: the message tried to change the rules ("ignore your rules"); it is treated as ordinary text and changes nothing.
	OverrideAttempt *bool
}

// MarshalJSON writes an Intent as the TypeScript's object: the members it has, by their TypeScript names.
func (i Intent) MarshalJSON() ([]byte, error) {
	type wire struct {
		Kind            string         `json:"kind"`
		Language        string         `json:"language,omitempty"`
		Items           *[]IntentLine  `json:"items,omitempty"`
		Date            map[string]any `json:"date,omitempty"`
		Time            map[string]any `json:"time,omitempty"`
		SlotID          string         `json:"slotId,omitempty"`
		SlotIDs         *[]string      `json:"slotIds,omitempty"`
		Mode            string         `json:"mode,omitempty"`
		OfferInr        *int64         `json:"offerInr,omitempty"`
		Ask             *bool          `json:"ask,omitempty"`
		OverrideAttempt *bool          `json:"overrideAttempt,omitempty"`
	}
	w := wire{Kind: i.Kind, Language: i.Language, Date: i.Date, Time: i.Time, SlotID: i.SlotID, Mode: i.Mode, OfferInr: i.OfferInr, Ask: i.Ask, OverrideAttempt: i.OverrideAttempt}
	if i.Items != nil {
		w.Items = &i.Items
	}
	if i.SlotIDs != nil {
		w.SlotIDs = &i.SlotIDs
	}
	return json.Marshal(w)
}

// MenuItem is what the reading needs of a menu item: its id and what customers call it, per language. Names are tried in the shop's languages' order (ParseContext.Languages), the
// order settings.ts fills `names` in.
type MenuItem struct {
	ID    string              `json:"id"`
	Names map[string][]string `json:"names"`
}

// Slot is what the reading needs of a slot (settings.ts allSlots, pickup slots first, then delivery): its id, what customers call it, and its mode ("pickup" or "delivery"; a
// tapped slot row says the way).
type Slot struct {
	ID    string              `json:"id"`
	Names map[string][]string `json:"names"`
	Mode  string              `json:"mode"`
}

// ParseContext is model.ts ParseContext: the menu, the slots (every slot of both modes) and the languages the shop speaks. The lead fills it from the Orders settings.
type ParseContext struct {
	Menu      []MenuItem `json:"menu"`
	Slots     []Slot     `json:"slots"`
	Languages []string   `json:"languages"`
}

func (c *ParseContext) hasItem(id string) bool {
	for i := range c.Menu {
		if c.Menu[i].ID == id {
			return true
		}
	}
	return false
}

func isWhole(v any) (float64, bool) {
	n, ok := v.(float64)
	return n, ok && n == math.Trunc(n) && !math.IsInf(n, 0)
}

var slotIDRe = regexp.MustCompile(`^[a-z0-9-]{1,60}$`)

// CoerceIntent is model.ts coerceIntent: nil for anything that is not an Intent of this shop (an unknown kind, an item it does not have, a quantity of 0, a negative price).
// `raw` is JSON decoded to `any`. One difference, on purpose: the TypeScript copies a `date` or a `time` of any shape (`raw.date as DatePhrase`); here a date or a time that is not
// an object is refused, since nothing but an object can be read as one (the model's answer never carries either: shape drops them; no vector has such a value).
func CoerceIntent(raw any, c *ParseContext) *Intent {
	m, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	kind, _ := m["kind"].(string)
	if !contains(IntentKinds(), kind) {
		return nil
	}
	in := &Intent{Kind: kind}
	if v, given := m["language"]; given {
		l, _ := v.(string)
		if !contains(runtime.LANGUAGES, l) {
			return nil
		}
		in.Language = l
	}
	if v, given := m["offerInr"]; given {
		n, whole := isWhole(v)
		if !whole || n < 0 || n > 1_000_000 {
			return nil
		}
		o := int64(n)
		in.OfferInr = &o
	}
	if v, given := m["items"]; given {
		list, isList := v.([]any)
		if !isList {
			return nil
		}
		lines := make([]IntentLine, 0, len(list))
		for _, e := range list {
			l, isObj := e.(map[string]any)
			if !isObj {
				return nil
			}
			id, isText := l["itemId"].(string)
			q, whole := isWhole(l["qty"])
			if !isText || !c.hasItem(id) || !whole || q < 1 || q > 1000 {
				return nil
			}
			lines = append(lines, IntentLine{ItemID: id, Qty: int(q)})
		}
		in.Items = lines
	}
	if v, given := m["date"]; given {
		d, isObj := v.(map[string]any)
		if !isObj {
			return nil
		}
		in.Date = d
	}
	if v, given := m["time"]; given {
		t, isObj := v.(map[string]any)
		if !isObj {
			return nil
		}
		in.Time = t
	}
	if v, given := m["slotId"]; given {
		s, isText := v.(string)
		if !isText || !slotIDRe.MatchString(s) {
			return nil
		}
		in.SlotID = s
	}
	if v, given := m["slotIds"]; given {
		list, isList := v.([]any)
		if !isList {
			return nil
		}
		ids := make([]string, 0, len(list))
		for _, e := range list {
			s, isText := e.(string)
			if !isText || !slotIDRe.MatchString(s) {
				return nil
			}
			ids = append(ids, s)
		}
		in.SlotIDs = ids
	}
	if v, given := m["mode"]; given {
		if v != "pickup" && v != "delivery" {
			return nil
		}
		in.Mode = v.(string)
	}
	if v, given := m["ask"]; given {
		b := v == true
		in.Ask = &b
	}
	if v, given := m["overrideAttempt"]; given {
		b := v == true
		in.OverrideAttempt = &b
	}
	return in
}

var (
	replyItem = regexp.MustCompile(`^item:([a-z0-9-]{1,60})$`)
	replySlot = regexp.MustCompile(`^slot:([a-z0-9-]{1,60})$`)
)

// IntentFromReply is interactive.ts intentFromReply: the Intent a button or list id stands for, or nil when the id is none of ours (an old message, or a forged one): the title is
// then read as ordinary words. A forged id changes nothing the typed word would not: a slot is checked against the cut-off, the stock and the day's limit like any typed one.
func IntentFromReply(id string, c *ParseContext) *Intent {
	yes := true
	switch id {
	case "yes", "no", "keep", "owner", "paid":
		return &Intent{Kind: id}
	case "cancel":
		return &Intent{Kind: "cancel", Ask: &yes}
	case "cancel_yes":
		return &Intent{Kind: "cancel"}
	case "menu":
		return &Intent{Kind: "greeting"}
	case "pickup", "delivery":
		return &Intent{Kind: "order", Mode: id}
	}
	if m := replyItem.FindStringSubmatch(id); m != nil {
		if !c.hasItem(m[1]) {
			return nil
		}
		return &Intent{Kind: "order", Items: []IntentLine{{ItemID: m[1], Qty: 1}}}
	}
	if m := replySlot.FindStringSubmatch(id); m != nil {
		for i := range c.Slots {
			if c.Slots[i].ID == m[1] {
				return &Intent{Kind: "order", SlotID: m[1], Mode: c.Slots[i].Mode}
			}
		}
	}
	return nil
}
