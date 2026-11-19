package assistant

// The owner's talk (modules/assistant/talk-owner.ts, talk-prompt.ts, talk-types.ts, talk-check.ts): where the owner's words are not an ask or an act the rules and the router know,
// the assistant answers as a conversation, from the shop's notes and its public listings only, in sentences that each name the sources they rest on. The model's answer is
// untrusted: ReadTalkAnswer takes it from `any` with its types checked by hand, and CheckOwnerTalk runs the checks the owner's turn has (talk-check.ts, in its order: every source
// named is in scope; no word saying something was done; every number, percentage and number word is one its sources state, through the outgoing check; no link and no phone
// number but the shop's own, the length, the owner's language). The checks a CUSTOMER's turn adds (claims, the pets' health words) are not here: this runtime has no customers.
//
// The prompt is the TypeScript's own, rendered per language and character by go/scripts/gen_words.ts; only the sources' lines are written here (talk-prompt.ts `sourceLines`).

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// OwnerChars, OwnerNotesBudget and OwnerHistoryLines are talk-prompt.ts OWNER_CHARS, talk-owner.ts OWNER_NOTES_BUDGET and OWNER_HISTORY_LINES.
const (
	OwnerChars        = 600
	OwnerNotesBudget  = 3000
	OwnerHistoryLines = 6
	maxSentences      = 8
)

// TalkSource is one thing a reply may rest on (talk-types.ts): a note ("n-3") or a setting ("s:l-1").
type TalkSource struct {
	ID, Kind, Text string
	AmountsInr     []float64
	Literals       []string
}

// TalkSentence is a sentence of the reply and the ids it rests on.
type TalkSentence struct {
	Text    string
	Sources []string
}

// TalkAnswer is the model's answer, read.
type TalkAnswer struct {
	Sentences []TalkSentence
	NoteKind  string // a note the model proposes (the owner's page makes no proposal: carried only)
	NoteText  string
	Limit     string // a declared limit the owner means, by id (never a value)
}

var collapse = regexp.MustCompile(`[` + language.JSSpace + `]+`)

// SourceLines is talk-prompt.ts `sourceLines`.
func SourceLines(sources []TalkSource) string {
	if len(sources) == 0 {
		return "(none)"
	}
	lines := make([]string, len(sources))
	for i, s := range sources {
		lines[i] = "[" + s.ID + "] " + language.TrimJS(collapse.ReplaceAllString(s.Text, " "))
	}
	return strings.Join(lines, "\n")
}

// HistoryText is talk-prompt.ts `historyText`: the last six lines of the talk as the user message's preface. `.slice(0, 300)` counts UTF-16 units: a cut through a pair, which
// JavaScript leaves as a lone surrogate, drops the half character here (a Go string cannot hold one).
func HistoryText(lines []TalkLine) string {
	if len(lines) > OwnerHistoryLines {
		lines = lines[len(lines)-OwnerHistoryLines:]
	}
	if len(lines) == 0 {
		return ""
	}
	parts := make([]string, len(lines))
	for i, l := range lines {
		who := "Assistant"
		if l.From == "owner" {
			who = "Owner"
		}
		parts[i] = who + ": " + language.UTF16Slice(collapse.ReplaceAllString(l.Text, " "), 300)
	}
	return "Earlier in this talk:\n" + strings.Join(parts, "\n") + "\n\nNow the owner says:\n"
}

// ReadTalkAnswer is talk-types.ts `readTalkAnswer` for the owner's turn: 1 to 8 sentences, each with non-blank text and a list of string ids (null or absent: none), ids made
// unique in order; a note when its kind and text are strings; a limit when it is a non-empty string. Anything else is nil.
func ReadTalkAnswer(raw any) *TalkAnswer {
	o, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	ss, ok := o["sentences"].([]any)
	if !ok || len(ss) == 0 || len(ss) > maxSentences {
		return nil
	}
	out := &TalkAnswer{}
	for _, s := range ss {
		so, ok := s.(map[string]any)
		if !ok {
			return nil
		}
		text, ok := so["text"].(string)
		if !ok || language.TrimJS(text) == "" {
			return nil
		}
		var ids []string
		switch src := so["sources"].(type) {
		case nil:
		case []any:
			seen := map[string]bool{}
			for _, x := range src {
				id, ok := x.(string)
				if !ok {
					return nil
				}
				if !seen[id] {
					seen[id] = true
					ids = append(ids, id)
				}
			}
		default:
			return nil
		}
		out.Sentences = append(out.Sentences, TalkSentence{Text: language.TrimJS(text), Sources: ids})
	}
	if n, ok := o["note"].(map[string]any); ok {
		k, kok := n["kind"].(string)
		t, tok := n["text"].(string)
		if kok && tok {
			out.NoteKind, out.NoteText = k, t
		}
	}
	if l, ok := o["limit"].(string); ok && l != "" {
		out.Limit = l
	}
	return out
}

// fold and norm are talk-check.ts's: decomposed with the Devanagari nukta dropped, so "मुफ़्त" and "मुफ्त" are one word.
func norm(s string) string { return language.Fold(language.Plain(s)) }

// numbersOf is talk-check.ts `numbersOf`: the numbers a text states (in any digit script).
var numberRe = regexp.MustCompile(`\d+(?:\.\d+)?`)

func numbersOf(text string) []float64 {
	var out []float64
	for _, n := range numberRe.FindAllString(language.Plain(text), -1) {
		f, _ := strconv.ParseFloat(n, 64)
		out = append(out, f)
	}
	return out
}

// TalkFacts is what the outgoing check reads for a set of sources (talk-check.ts `factsFor`): their amounts and every number their words state; the shop's literals and theirs.
func TalkFacts(sources []TalkSource, literals []string) language.Facts {
	f := language.Facts{Literals: append([]string{}, literals...)}
	var numbers []float64
	for _, s := range sources {
		numbers = append(numbers, numbersOf(s.Text)...)
	}
	for _, s := range sources {
		f.AmountsInr = append(f.AmountsInr, s.AmountsInr...)
	}
	f.AmountsInr = append(f.AmountsInr, numbers...)
	f.Counts = numbers
	for _, s := range sources {
		f.Literals = append(f.Literals, s.Literals...)
	}
	return f
}

// TalkCheck is what CheckOwnerTalk says: the reply's text and the facts the outgoing check reads, or the check that failed (1, 2, 4 or 5) and why.
type TalkCheck struct {
	OK    bool
	Text  string
	Facts language.Facts
	Check int
	Why   string
}

// CheckOwnerTalk is talk-check.ts `checkTalk` for the owner's turn.
func CheckOwnerTalk(a *TalkAnswer, scope []TalkSource, speakerText, speakerLanguage string, literals []string) TalkCheck {
	byID := map[string]TalkSource{}
	for _, s := range scope {
		byID[s.ID] = s
	}
	fail := func(n int, why string) TalkCheck { return TalkCheck{Check: n, Why: why} }
	texts := make([]string, len(a.Sentences))
	for i, s := range a.Sentences {
		texts[i] = s.Text
	}
	text := strings.Join(texts, " ")
	// 1. every named source exists and is in this speaker's scope
	for _, s := range a.Sentences {
		for _, id := range s.Sources {
			if _, ok := byID[id]; !ok {
				return fail(1, fmt.Sprintf(`a sentence names the source "%s", which is not one this speaker may see`, id))
			}
		}
	}
	// 4. completion words, whatever they rest on
	for _, s := range a.Sentences {
		if language.P("talk.completion").Test(norm(s.Text)) {
			return fail(4, "a sentence says that something was done; only the shop's own messages, written from the record, say that")
		}
	}
	// 2. numbers, amounts, percentages and number words: only what the sentence's own sources state
	for _, s := range a.Sentences {
		var own []string
		var sources []TalkSource
		for _, id := range s.Sources {
			sources = append(sources, byID[id])
			own = append(own, language.Plain(byID[id].Text))
		}
		ownText := strings.Join(own, " \n ")
		for _, m := range language.P("talk.percent").All(language.Plain(s.Text)) {
			same := language.MustCompile(strings.ReplaceAll(m.Group(1), ".", `\.`)+`\s*(?:%|per ?cent|प्रतिशत|ശതമാനം|ಶೇಕಡಾ|ಪ್ರತಿಶತ|ಶೇ)`, "iu")
			if !same.Test(ownText) {
				return fail(2, fmt.Sprintf("a sentence says %s%%, which none of its sources states", m.Group(1)))
			}
		}
		ownNorm := strings.ToLower(norm(ownText))
		for _, m := range language.P("talk.number_words").Global(true).All(norm(s.Text)) {
			if !strings.Contains(ownNorm, strings.ToLower(m.Group(0))) {
				return fail(2, fmt.Sprintf(`a sentence uses the number word "%s", which none of its sources uses`, m.Group(0)))
			}
		}
		if problems := language.CheckText(s.Text, TalkFacts(sources, literals)); len(problems) > 0 {
			return fail(2, strings.Join(problems, " "))
		}
	}
	// 5. no link and no phone number but the shop's own (a listings shop's talk has no links of its own), the length, the language
	shown := language.Plain(text)
	for _, l := range literals {
		if l != "" {
			shown = strings.ReplaceAll(shown, language.Plain(l), " ")
		}
	}
	for _, m := range language.P("talk.link").All(shown) {
		return fail(5, fmt.Sprintf(`the reply has the link "%s", which is not one of the shop's own`, m.Group(0)))
	}
	for _, m := range language.P("talk.long_digits").All(shown) {
		if len(digitsOnly(m.Group(0))) >= 7 {
			return fail(5, "the reply has a phone number that is not the shop's own")
		}
	}
	if n := language.UTF16Len(text); n > OwnerChars {
		return fail(5, fmt.Sprintf("the reply is %d characters, over the %d the talk allows", n, OwnerChars))
	}
	spoke, answered := language.LanguageOfScript(speakerText), language.LanguageOfScript(text)
	if (spoke != "en" && answered != spoke) || (spoke == "en" && answered != "en") {
		return fail(5, "the reply is not in the language the speaker wrote in")
	}
	_ = speakerLanguage
	return TalkCheck{OK: true, Text: text, Facts: TalkFacts(usedSources(a, byID), literals)}
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// usedSources is talk-check.ts `wholeReplyFacts`'s set: every source some sentence names, once, in the order first named.
func usedSources(a *TalkAnswer, byID map[string]TalkSource) []TalkSource {
	seen := map[string]bool{}
	var out []TalkSource
	for _, s := range a.Sentences {
		for _, id := range s.Sources {
			if !seen[id] {
				seen[id] = true
				out = append(out, byID[id])
			}
		}
	}
	return out
}
