package assistant

// The facts the outgoing check reads for a line the assistant says (modules/assistant/words.ts `Writer`). In TypeScript every value is written through a Writer, which formats it AND
// notes it, and conversation.ts runs language/check.ts checkText over the final words with those notes (message-matches-record). The Go runtime fills the packed words instead, so
// this Writer notes the same things from two sources:
//
//   - the key's own facts, generated from the TypeScript (gen_words.ts factsOf, the pack's `f`): the literals the words always carry ("cancel b-14", "cancel {ref}", "{who}"), filled
//     with the same slot values as the words, and the fixed counts ("the last 24 hours");
//   - the slot values that are numbers: {n} is a count (TypeScript's w.n) and {inr} an amount (w.inr), read back from the text this code put there; {date}, {time} and {slot} are
//     noted as the literal text written. TypeScript notes the moment, which allows that date or time as each language writes it; the literal allows exactly the text the line
//     carries, which is the same for these words (they state each moment once, in the owner's language). The difference: a line that wrote the same moment in another language
//     would be held back here, where TypeScript lets it go.
//
// A slot whose value is put together by the caller (a list of names, a limit's rule with its value, a price with its words) is noted by the caller with Lit, INR and N, as
// TypeScript's callers do. A value nobody notes is checked like any other words: a digit in it holds the line back, which is TypeScript's answer too.

import (
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// KeyFacts are the facts a packed key always carries (gen_words.ts KeyFacts): literal templates, fixed counts and fixed amounts in rupees.
type KeyFacts struct {
	L []string  `json:"l"`
	C []float64 `json:"c"`
	A []float64 `json:"a"`
}

// Writer writes one line (or the pieces of one line, joined by the caller) in one language and notes what the outgoing check may find in it.
type Writer struct {
	p *Pack
	f language.Facts
}

// Writer is a new, empty writer over this pack.
func (p *Pack) Writer() *Writer { return &Writer{p: p} }

// Pack is the language the writer writes in.
func (w *Writer) Pack() *Pack { return w.p }

// Say is Pack.Say, noting the key's facts and its number slots.
func (w *Writer) Say(key string, vals ...string) string {
	text := w.p.Say(key, vals...)
	if kf, ok := w.p.F[key]; ok {
		fill := strings.NewReplacer(slotPairs(vals)...)
		for _, l := range kf.L {
			w.f.Literals = append(w.f.Literals, fill.Replace(l))
		}
		w.f.Counts = append(w.f.Counts, kf.C...)
		w.f.AmountsInr = append(w.f.AmountsInr, kf.A...)
	}
	for i := 0; i+1 < len(vals); i += 2 {
		switch vals[i] {
		case "n":
			if v, err := strconv.ParseFloat(vals[i+1], 64); err == nil {
				w.f.Counts = append(w.f.Counts, v)
			}
		case "inr":
			if v, ok := RupeesOf(vals[i+1]); ok {
				w.f.AmountsInr = append(w.f.AmountsInr, v)
			}
		case "date", "time", "slot":
			w.f.Literals = append(w.f.Literals, vals[i+1])
		}
	}
	return text
}

// Lit is words.ts w.lit: a name, a reference or words repeated as they are.
func (w *Writer) Lit(s string) string {
	w.f.Literals = append(w.f.Literals, s)
	return s
}

// INR is words.ts w.inr: an amount in paise, written as rupees and noted.
func (w *Writer) INR(paise int64) string {
	w.f.AmountsInr = append(w.f.AmountsInr, float64(paise)/100)
	return INR(paise)
}

// N is words.ts w.n: a count, written as digits and noted.
func (w *Writer) N(n int64) string {
	w.f.Counts = append(w.f.Counts, float64(n))
	return strconv.FormatInt(n, 10)
}

// Note adds facts noted elsewhere: words-memory.ts talkReply, the talk's reply with the facts its own checks used (the amounts, counts, moments, links and literals; not the
// conversation's one shown moment, which TypeScript does not carry over either). The zone the moments are read in comes along.
func (w *Writer) Note(f language.Facts) {
	w.f.AmountsInr = append(w.f.AmountsInr, f.AmountsInr...)
	w.f.Counts = append(w.f.Counts, f.Counts...)
	w.f.Links = append(w.f.Links, f.Links...)
	w.f.Literals = append(w.f.Literals, f.Literals...)
	w.f.MomentsMs = append(w.f.MomentsMs, f.MomentsMs...)
	if f.Loc != nil {
		w.f.Loc = f.Loc
	}
}

// Facts are what was noted, as language.CheckText takes them.
func (w *Writer) Facts() language.Facts { return w.f }

// RupeesOf reads back an amount written by format.ts formatInr ("₹1,23,456", "₹150.5"): check.ts AMOUNT_RE's value, Number of the digits without commas.
func RupeesOf(text string) (float64, bool) {
	s, ok := strings.CutPrefix(strings.TrimSpace(text), "₹")
	if !ok {
		return 0, false
	}
	v, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(s), ",", ""), 64)
	return v, err == nil
}
