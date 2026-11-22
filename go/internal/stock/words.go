package stock

// STOCK_LINE_WORDS (modules/stock/words.ts) for the Go runtime: every line people read about the stock count in English, Hindi, Malayalam and Kannada. The text is GENERATED into
// words.json by go/scripts/gen_stock_words.ts (never retyped); the words that are functions of a value carry `{n}`, `{name}`, `{unit}` and `{supplier}` slots, and the methods here only
// substitute them. The number is written as JavaScript's template literal writes an integer (base ten, no grouping), which is strconv's.

import (
	_ "embed"
	"encoding/json"
	"strconv"
	"strings"
)

//go:embed words.json
var wordsJSON []byte

// LineWords is one language's StockLineWords. The plain words are fields; the others are methods.
type LineWords struct {
	Title, Back, Intro, Empty, SoldOut, Low, SetCount, NewCount, Save, SoldOne, Stop, StopHelp string
	AddTitle, AddItem, AddCount, AddLow, AddButton, NothingToAdd, History, Saved               string
	Moves                                                                                      struct{ Started, Sold, Returned, Received, Corrected string }
	Kinds                                                                                      struct{ Listing, Menu, Supply string }
	Notices                                                                                    struct {
		Stale, BadCount, BadLow, BadID, BadText, Exists, Full, NoSuchLine, Unit string
	}
	left, leftUnit, lowMark, short, runningLow, reorderAsk, morningLow, unitRefused string
}

// rawWords is the JSON member by member.
type rawWords struct {
	Title        string `json:"title"`
	Back         string `json:"back"`
	Intro        string `json:"intro"`
	Empty        string `json:"empty"`
	SoldOut      string `json:"soldOut"`
	Low          string `json:"low"`
	SetCount     string `json:"setCount"`
	NewCount     string `json:"newCount"`
	Save         string `json:"save"`
	SoldOne      string `json:"soldOne"`
	Stop         string `json:"stop"`
	StopHelp     string `json:"stopHelp"`
	AddTitle     string `json:"addTitle"`
	AddItem      string `json:"addItem"`
	AddCount     string `json:"addCount"`
	AddLow       string `json:"addLow"`
	AddButton    string `json:"addButton"`
	NothingToAdd string `json:"nothingToAdd"`
	History      string `json:"history"`
	Saved        string `json:"saved"`
	Moves        struct {
		Started   string `json:"started"`
		Sold      string `json:"sold"`
		Returned  string `json:"returned"`
		Received  string `json:"received"`
		Corrected string `json:"corrected"`
	} `json:"moves"`
	Kinds struct {
		Listing string `json:"listing"`
		Menu    string `json:"menu"`
		Supply  string `json:"supply"`
	} `json:"kinds"`
	Notices struct {
		Stale      string `json:"stale"`
		BadCount   string `json:"bad_count"`
		BadLow     string `json:"bad_low"`
		BadID      string `json:"bad_id"`
		BadText    string `json:"bad_text"`
		Exists     string `json:"exists"`
		Full       string `json:"full"`
		NoSuchLine string `json:"no_such_line"`
		Unit       string `json:"unit"`
	} `json:"notices"`
	Left        string `json:"left"`
	LeftUnit    string `json:"leftUnit"`
	LowMark     string `json:"lowMark"`
	Short       string `json:"short"`
	RunningLow  string `json:"runningLow"`
	ReorderAsk  string `json:"reorderAsk"`
	MorningLow  string `json:"morningLow"`
	UnitRefused string `json:"unitRefused"`
}

var words = func() map[string]*LineWords {
	var raw map[string]rawWords
	if err := json.Unmarshal(wordsJSON, &raw); err != nil {
		panic("stock words.json: " + err.Error())
	}
	out := map[string]*LineWords{}
	for lang, r := range raw {
		out[lang] = &LineWords{
			Title: r.Title, Back: r.Back, Intro: r.Intro, Empty: r.Empty, SoldOut: r.SoldOut, Low: r.Low, SetCount: r.SetCount, NewCount: r.NewCount, Save: r.Save, SoldOne: r.SoldOne,
			Stop: r.Stop, StopHelp: r.StopHelp, AddTitle: r.AddTitle, AddItem: r.AddItem, AddCount: r.AddCount, AddLow: r.AddLow, AddButton: r.AddButton, NothingToAdd: r.NothingToAdd,
			History: r.History, Saved: r.Saved,
			Moves: struct{ Started, Sold, Returned, Received, Corrected string }{r.Moves.Started, r.Moves.Sold, r.Moves.Returned, r.Moves.Received, r.Moves.Corrected},
			Kinds: struct{ Listing, Menu, Supply string }{r.Kinds.Listing, r.Kinds.Menu, r.Kinds.Supply},
			Notices: struct {
				Stale, BadCount, BadLow, BadID, BadText, Exists, Full, NoSuchLine, Unit string
			}{r.Notices.Stale, r.Notices.BadCount, r.Notices.BadLow, r.Notices.BadID, r.Notices.BadText, r.Notices.Exists, r.Notices.Full, r.Notices.NoSuchLine, r.Notices.Unit},
			left: r.Left, leftUnit: r.LeftUnit, lowMark: r.LowMark, short: r.Short, runningLow: r.RunningLow, reorderAsk: r.ReorderAsk, morningLow: r.MorningLow, unitRefused: r.UnitRefused,
		}
	}
	return out
}()

// Words is STOCK_LINE_WORDS[lang]; an unknown language answers English (as the agents' own fallbacks do).
func Words(lang string) *LineWords {
	if w, ok := words[lang]; ok {
		return w
	}
	return words["en"]
}

// fill substitutes {slot} names.
func fill(tpl string, pairs ...string) string {
	return strings.NewReplacer(brace(pairs)...).Replace(tpl)
}

func brace(pairs []string) []string {
	out := make([]string, len(pairs))
	for i := 0; i+1 < len(pairs); i += 2 {
		out[i], out[i+1] = "{"+pairs[i]+"}", pairs[i+1]
	}
	return out
}

func num(n int64) string { return strconv.FormatInt(n, 10) }

// Left is `left(n, unit)`: "12 kg left"; unit "" is "no unit".
func (w *LineWords) Left(n int64, unit string) string {
	if unit == "" {
		return fill(w.left, "n", num(n))
	}
	return fill(w.leftUnit, "n", num(n), "unit", unit)
}

// LowMark is `lowMark(n)`.
func (w *LineWords) LowMark(n int64) string { return fill(w.lowMark, "n", num(n)) }

// Short is `short(n)`: "short by 2".
func (w *LineWords) Short(n int64) string { return fill(w.short, "n", num(n)) }

// RunningLow is `runningLow(name, n)`: the owner's talk line when a count reaches the low mark and there is no supplier to ask.
func (w *LineWords) RunningLow(name string, n int64) string {
	return fill(w.runningLow, "name", name, "n", num(n))
}

// ReorderAsk is `reorderAsk(name, n, supplier)`: the question that starts the reorder.
func (w *LineWords) ReorderAsk(name string, n int64, supplier string) string {
	return fill(w.reorderAsk, "name", name, "n", num(n), "supplier", supplier)
}

// MorningLow is `morningLow(n)`: n is already text ("2").
func (w *LineWords) MorningLow(n string) string { return fill(w.morningLow, "n", n) }

// UnitRefused is `unitRefused(name, unit)`: a delivery that was not added because its unit is not the unit counted.
func (w *LineWords) UnitRefused(name, unit string) string {
	return fill(w.unitRefused, "name", name, "unit", unit)
}
