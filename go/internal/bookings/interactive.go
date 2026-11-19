package bookings

// WhatsApp reply buttons and list messages for Bookings: the Go twin of templates/commerce/bookings/src/language/interactive.ts (the labels, the list of services and of free
// times, the buttons) over the shared limits of modules/language/interactive.ts (Meta's: a button title up to 20 characters, a row title up to 24, a description up to 72, a list
// button up to 20). The labels and the limits are GENERATED (words/<lang>.json.gz); the ids are the ones intent.go reads (IntentFromReply). The UPI owner's buttons
// (`ownerMarkButtons`) are not here: the owner-marked ledger is not modelled yet (Deferred.md).
//
// Where Go and JavaScript differ: clip counts characters the way the TypeScript's `[...text]` does (code points), and trims with JavaScript's white space.

import (
	"strconv"
	"time"

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

// Label is interactive.ts LABELS[language][key] ("yes", "no", "owner", "cancel", "cancelYes", "keep", "pickService", "pickTime", "paid", "received", "refundSent", "keptForBooking").
func Label(lang, key string) string { return WordsFor(lang).Labels[key] }

// buttonID is interactive.ts ID: the id each button carries.
var buttonID = map[string]string{"yes": "yes", "no": "no", "owner": "owner", "cancel": "cancel", "cancelYes": "cancel_yes", "keep": "keep", "paid": "paid"}

// Clip is interactive.ts clip: a label cut to fit, with an ellipsis. Labels written for the pack already fit; a shop's own service name might not.
func Clip(text string, max int) string {
	chars := []rune(language.TrimJS(text))
	if len(chars) <= max {
		return string(chars)
	}
	return string(chars[:max-1]) + "…"
}

// ButtonsFor is interactive.ts buttonsFor: the buttons named (by the keys of buttonID), in the language, in this order.
func ButtonsFor(lang string, keys ...string) []Choice {
	w := WordsFor(lang)
	out := make([]Choice, len(keys))
	for i, k := range keys {
		out[i] = Choice{ID: buttonID[k], Title: Clip(w.Labels[k], w.Limits.ButtonTitle)}
	}
	return out
}

// ServiceList is interactive.ts serviceList: the shop's services with the price on each row and, last, a row to reach the owner. At most 9 services fit beside it; a tenth is
// reached by typing its name.
func ServiceList(s *Settings, lang string) List {
	w := WordsFor(lang)
	var rows []Choice
	for i := range s.Services {
		if i >= w.Limits.Rows-1 {
			break
		}
		sv := &s.Services[i]
		rows = append(rows, Choice{ID: "svc:" + sv.ID, Title: Clip(ServiceName(sv, lang), w.Limits.RowTitle), Description: language.FormatInr(float64(sv.PriceInr))})
	}
	rows = append(rows, Choice{ID: buttonID["owner"], Title: Clip(w.Labels["owner"], w.Limits.RowTitle)})
	return List{Clip(w.Labels["pickService"], w.Limits.ListButton), rows}
}

// SlotList is interactive.ts slotList: the list of free times, the time as the row's title and the day as its description, and a last row to reach the owner. At most 9 times.
func SlotList(slots []int64, loc *time.Location, lang string) List {
	w := WordsFor(lang)
	fm := language.Formats(lang)
	var rows []Choice
	for i, ms := range slots {
		if i >= w.Limits.Rows-1 {
			break
		}
		rows = append(rows, Choice{ID: "slot:" + strconv.FormatInt(ms, 10), Title: Clip(fm.SlotTime(ms, loc), w.Limits.RowTitle), Description: Clip(fm.SlotDate(ms, loc), w.Limits.RowDescription)})
	}
	rows = append(rows, Choice{ID: buttonID["owner"], Title: Clip(w.Labels["owner"], w.Limits.RowTitle)})
	return List{Clip(w.Labels["pickTime"], w.Limits.ListButton), rows}
}
