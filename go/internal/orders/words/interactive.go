package words

// WhatsApp reply buttons and list messages for Orders: the Go twin of templates/commerce/orders/src/language/interactive.ts EXCEPT intentFromReply (a tap becomes an Intent: the
// Orders runtime's). The labels, the ids, the shape of a row's id and of a window's title, and Meta's limits (a button title up to 20 characters, a row title up to 24, a description
// up to 72, a list button up to 20) are GENERATED (<lang>.json.gz); this file builds the buttons and lists from them over the shop's menu and the day's windows.
//
// Where Go and JavaScript differ: Clip counts characters the way the TypeScript's `[...text]` does (code points) and trims with JavaScript's white space (language.TrimJS).

import (
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// Choice is interactive.ts Choice: a button or a list row.
type Choice struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

// List is the list of an interactive message: its button and its rows.
type List struct {
	Button string   `json:"button"`
	Rows   []Choice `json:"rows"`
}

// WindowRow is one slot window of a day for SlotList: its id and its start and end instants.
type WindowRow struct {
	ID     string `json:"id"`
	FromMs int64  `json:"fromMs"`
	ToMs   int64  `json:"toMs"`
}

// Label is interactive.ts LABELS[language][key]: yes, no, owner, cancel, cancelYes, keep, pickItem, pickTime, pickup, delivery, paid, received, refundSent, keptForBooking.
func Label(lang, key string) string { return WordsFor(lang).Labels[key] }

// ButtonID is interactive.ts ID[key]: the id the button of that key carries (yes, no, owner, cancel, cancelYes, keep, menu, paid, pickup, delivery).
func ButtonID(key string) string { return WordsFor("en").IDs[key] }

// ItemRowID is interactive.ts itemRowId: "item:<id>".
func ItemRowID(itemID string) string {
	return strings.Replace(WordsFor("en").RowIDs.Item, "{id}", itemID, 1)
}

// SlotRowID is interactive.ts slotRowId: "slot:<id>".
func SlotRowID(slotID string) string {
	return strings.Replace(WordsFor("en").RowIDs.Slot, "{id}", slotID, 1)
}

// Clip is interactive.ts clip: a label cut to fit, with an ellipsis. Labels written for the pack already fit; a shop's own item name might not.
func Clip(text string, max int) string {
	chars := []rune(language.TrimJS(text))
	if len(chars) <= max {
		return string(chars)
	}
	return string(chars[:max-1]) + "…"
}

// ButtonsFor is interactive.ts buttonsFor: the buttons named (by the keys yes, no, cancel, cancelYes, keep, owner, paid, pickup, delivery), in the language, in this order.
func ButtonsFor(lang string, keys ...string) []Choice {
	w := WordsFor(lang)
	out := make([]Choice, len(keys))
	for i, k := range keys {
		out[i] = Choice{ID: w.IDs[k], Title: Clip(w.Labels[k], w.Limits.ButtonTitle)}
	}
	return out
}

// MarkAsk is what OwnerMarkButtons is asked for (payments/owner-marked/buttons.ts): Kind "received" with the Code and the AmountInr, or Kind "refund" with the Code and whether
// "kept for order" is offered.
type MarkAsk struct {
	Kind        string // "received" or "refund"
	Code        string
	AmountInr   float64
	KeepAllowed bool
}

// OwnerMarkButtons is interactive.ts ownerMarkButtons (ownerMarkChoices): the owner's buttons for a UPI payment ("Received ₹200") or a refund ("Refund sent", and "Kept for order"
// where that is offered). Each carries its one-use code in its id.
func OwnerMarkButtons(lang string, a MarkAsk) []Choice {
	w := WordsFor(lang)
	if a.Kind == "received" {
		return []Choice{{ID: w.MarkIDs["received"] + ":" + a.Code, Title: Clip(w.Labels["received"]+" "+language.FormatInr(a.AmountInr), w.Limits.ButtonTitle)}}
	}
	out := []Choice{{ID: w.MarkIDs["refunded"] + ":" + a.Code, Title: Clip(w.Labels["refundSent"], w.Limits.ButtonTitle)}}
	if a.KeepAllowed && w.Labels["keptForBooking"] != "" {
		out = append(out, Choice{ID: w.MarkIDs["kept"] + ":" + a.Code, Title: Clip(w.Labels["keptForBooking"], w.Limits.ButtonTitle)})
	}
	return out
}

// ItemList is interactive.ts itemList: the shop's menu with the price on each row and, last, a row to reach the owner. At most 9 items fit beside it; a tenth is reached by typing
// its name.
func ItemList(s *Shop, lang string) List {
	w := WordsFor(lang)
	var rows []Choice
	for i := range s.Menu {
		if i >= w.Limits.Rows-1 {
			break
		}
		it := &s.Menu[i]
		rows = append(rows, Choice{ID: ItemRowID(it.ID), Title: Clip(ItemName(it, lang), w.Limits.RowTitle), Description: language.FormatInr(float64(it.PriceInr))})
	}
	rows = append(rows, Choice{ID: w.IDs["owner"], Title: Clip(w.Labels["owner"], w.Limits.RowTitle)})
	return List{Clip(w.Labels["pickItem"], w.Limits.ListButton), rows}
}

// SlotList is interactive.ts slotList: the list of a day's windows of one mode, the window ("6:00 pm – 7:30 pm") as the row's title, and a last row to reach the owner. At most 9
// windows. The zone is the shop's time zone name.
func SlotList(windows []WindowRow, timeZone, lang string) List {
	w := WordsFor(lang)
	f := &MessageFacts{Language: lang, TimeZone: timeZone}
	var rows []Choice
	for i, win := range windows {
		if i >= w.Limits.Rows-1 {
			break
		}
		a, _ := f.moment("time", win.FromMs)
		b, _ := f.moment("time", win.ToMs)
		rows = append(rows, Choice{ID: SlotRowID(win.ID), Title: Clip(fill(w.SlotTitle, "{from}", a, "{to}", b), w.Limits.RowTitle)})
	}
	rows = append(rows, Choice{ID: w.IDs["owner"], Title: Clip(w.Labels["owner"], w.Limits.RowTitle)})
	return List{Clip(w.Labels["pickTime"], w.Limits.ListButton), rows}
}
