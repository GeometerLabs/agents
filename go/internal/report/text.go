// The small helpers every report's text uses: modules/report/text.ts. Which languages a choice means, amounts in rupees, one-line text, the Innovator badge, a period's label, and the
// words for refunds a person settled by their word and for the signed summary's check link. The words themselves come from the TypeScript (words.go); the Hindi, Malayalam and
// Kannada ones are machine-written there and wait for a native reader.
package report

import (
	"fmt"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/locale"
	"github.com/GeometerLabs/agents/go/internal/slots"
)

// LanguagesOf is languagesOf: "both" is Hindi then English, one message after the other; any other value is itself.
func LanguagesOf(lang string) []string {
	if lang == "both" {
		return []string{"hi", "en"}
	}
	return []string{lang}
}

// Rupees is rupees(paise) = formatInr(paise / 100): the TypeScript divides as a float, and so does this (the one place a float is right).
func Rupees(paise int64) string { return language.FormatInr(float64(paise) / 100) }

// OneLine is oneLine: every run of JavaScript whitespace one space, then trimmed, so a line break in a shop's name cannot make a sixth line.
func OneLine(text string) string {
	var b strings.Builder
	in := false
	for _, r := range text {
		if language.IsJSSpace(r) {
			if !in {
				b.WriteByte(' ')
			}
			in = true
			continue
		}
		in = false
		b.WriteRune(r)
	}
	return language.TrimJS(b.String())
}

// BadgeSymbol is BADGE_SYMBOL: a plain symbol, not an emoji, so every phone draws it the same way.
const BadgeSymbol = "★"

// Innovator is INNOVATOR[language]: the word on the Innovator badge.
func Innovator(lang string) string { return loadWords().Innovator[lang] }

// BadgeText is badgeText: "★ Innovator" in a language.
func BadgeText(lang string) string { return BadgeSymbol + " " + Innovator(lang) }

// PeriodLabel is periodLabel: "Nov 2026" for a whole month, otherwise "Tue 3 Nov – Mon 9 Nov 2026".
func PeriodLabel(p ReportPeriod, lang string) string {
	if p.Month != nil {
		return fmt.Sprintf("%s %d", locale.Month(lang, p.Month.Month), p.Month.Year)
	}
	return fmt.Sprintf("%s – %s %d", locale.FormatDate(p.FirstDay, lang), locale.FormatDate(p.LastDay, lang), p.LastDay.Year)
}

// SettledByWord is SETTLED_BY_WORD[language](who): "Settled by asha, by their word". who is as SettledWho shows it.
func SettledByWord(lang, who string) string { return slots.Fill(loadWords().SettledByWord[lang], who) }

// SettledBySomeone is SETTLED_BY_SOMEONE[language]: the same without a name.
func SettledBySomeone(lang string) string { return loadWords().SettledBySomeone[lang] }

// CheckGenuine is CHECK_GENUINE[language]: the label before the check link in the owner's WhatsApp message.
func CheckGenuine(lang string) string { return loadWords().CheckGenuine[lang] }

// ScanSummary is SCAN_SUMMARY[language]: what a paper with a signed summary in its QR says under it.
func ScanSummary(lang string) string { return loadWords().ScanSummary[lang] }

// SettledWho is settledWho: who settled it, as a document shows them: the id alone (Guard's "operator:" left off), on one line, at most 40 UTF-16 units (longer is cut to 39 and "…";
// a cut inside a surrogate pair drops the half character, where JavaScript would leave a lone surrogate).
func SettledWho(by string) string {
	who := OneLine(strings.TrimPrefix(by, "operator:"))
	if who == "" {
		who = OneLine(by)
	}
	if language.UTF16Len(who) > 40 {
		return language.UTF16Slice(who, 39) + "…"
	}
	return who
}

// SettledRow is one person's settlements: who (as the record names them), how many payments, and the amount the record kept for them, in paise.
type SettledRow struct {
	By    string
	Count int
	Paise int64
}

// SettledByWordWords is settledByWordWords: the words the owner's monthly WhatsApp message adds for refunds people settled by their word, or ok=false when nobody did (or when not
// even the shortest fits). The longest of these that fits: each person named (two at most, then more(n)), then without the names with the count and amount, then the count alone.
func SettledByWordWords(rows []SettledRow, lang string, more func(n int) string, fits func(words string) bool) (string, bool) {
	if len(rows) == 0 {
		return "", false
	}
	var parts []string
	for _, r := range rows[:min(2, len(rows))] {
		parts = append(parts, fmt.Sprintf("%s: %d (%s)", SettledByWord(lang, SettledWho(r.By)), r.Count, Rupees(r.Paise)))
	}
	if len(rows) > 2 {
		parts = append(parts, more(len(rows)-2))
	}
	named := strings.Join(parts, " · ")
	count, paise := 0, int64(0)
	for _, r := range rows {
		count += r.Count
		paise += r.Paise
	}
	someone := SettledBySomeone(lang)
	for _, candidate := range []string{named, fmt.Sprintf("%s: %d (%s)", someone, count, Rupees(paise)), fmt.Sprintf("%s: %d", someone, count)} {
		if fits(candidate) {
			return candidate, true
		}
	}
	return "", false
}
