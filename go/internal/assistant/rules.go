package assistant

// Reading the owner's words by rule: what kind of thing they want of the shop's assistant (modules/assistant/intents.ts `readOwnerRules`, with intents-leave.ts and intents-memory.ts), in
// English, Hindi (also typed in Latin letters), Malayalam and Kannada. Only the rules: the TypeScript runtime then asks a decision model and a language model to place a message the
// rules could not (the "router"); this runtime does not, so a message the rules cannot place goes to the not-understood answer (go/TRIAL.md says so).
//
// What is ported and what is not:
//   - every kind's word list, in the order TypeScript tries them (the first kind whose words are in the message wins), taken from the TypeScript source by go/scripts/gen_words.ts
//     (words/rules.json.gz), never retyped; the kinds a listings-only shop does not offer (a day's list, owes, orders, closing a day, moving a booking) are still read, because the
//     listing check (`Strong`) and the "message first" rule look at them, but `Offered` turns them into "unknown" as TypeScript's `coerce` does;
//   - the case reference (`b-14`), the message-first rule, the leave words ("get my shop's file", "change my Operator"), the memory words (remember, notes, forget) and the date a
//     "money" question names (today, tomorrow, the day after tomorrow; any other date phrase is flagged, see Date);
//   - NOT ported: the amount ("refund b-14 ₹500": a listings-only shop has no case to refund, so the amount never matters), the time of day (only a booking move reads one), and a message's
//     own words beyond "are there any" (a shop with no customers never sends one).
//
// JavaScript against Go: the TypeScript patterns lean on look-behind and look-ahead to find a whole word in Indian scripts. RE2 has neither, so each pattern here carries its own
// edge: the character before is matched (or the start), the character after is matched (or the end), and the word's own place is read from a group. `\s` is widened to what
// JavaScript's `\s` matches (U+00A0, U+FEFF and the Unicode spaces), and lengths are counted in UTF-16 units where TypeScript counts `.length`.

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf16"

	xnorm "golang.org/x/text/unicode/norm"
)

// OfferedKinds are the kinds a listings-only shop's assistant takes (conversation.ts kindsOf for a shop with no day, owes, open orders, close day or move skill).
var OfferedKinds = []string{"waiting", "money", "cancel", "refund", "message", "undo", "limit", "help", "remember", "notes", "forget", "leave_file", "leave_operator"}

// Strong are the kinds that are an act on a case, a limit or the memory: they win over a listing even with photos waiting (conversation.ts STRONG). This list includes kinds this shop
// does not offer: the reading looks at them before `coerce` takes them out.
var Strong = []string{"remember", "notes", "forget", "undo", "help", "limit", "cancel", "refund", "message", "close_day", "reopen_day", "move"}

// DatePhrase is the date a "money" question names: Offset days from today, or Other (a weekday, a written date: not read here).
type DatePhrase struct {
	Offset int
	Other  bool
}

// Intent is what the rules read.
type Intent struct {
	Kind  string
	Ref   string // "b-14", lower case
	Words string // remember: the note's words
	Note  string // forget: "n-3"
	Date  *DatePhrase
}

// jsSpace is what JavaScript's `\s` matches.
const jsSpace = `\s\x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// fixSpace widens `\s` in a pattern that came from JavaScript.
func fixSpace(p string) string {
	return strings.NewReplacer(`\\s`, `\\s`, `\s`, `[`+jsSpace+`]`).Replace(p)
}

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// ---- text, as language/format.ts makes it easy to match ----------------------------------------------------------------------------------------------------

var oldChillu = strings.NewReplacer("ണ്‍", "ൺ", "ന്‍", "ൻ", "ര്‍", "ർ", "ല്‍", "ൽ", "ള്‍", "ൾ", "ക്‍", "ൿ")

// plain is format.ts `plain`: composed, Indian digits as 0-9, old-style chillus made new-style, zero-width joiners removed. Case is kept.
func plain(text string) string {
	out := oldChillu.Replace(xnorm.NFC.String(text))
	var b strings.Builder
	for _, r := range out {
		switch {
		case r == 0x200c || r == 0x200d:
		case r >= 0x0966 && r <= 0x096f:
			b.WriteRune('0' + (r - 0x0966))
		case r >= 0x0d66 && r <= 0x0d6f:
			b.WriteRune('0' + (r - 0x0d66))
		case r >= 0x0ce6 && r <= 0x0cef:
			b.WriteRune('0' + (r - 0x0ce6))
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func canon(text string) string { return strings.ToLower(plain(text)) }

// ---- whole-word regexes, as dates.ts `wordRe` makes them --------------------------------------------------------------------------------------------------

const notWord = `[^\p{L}\p{M}\p{N}]`

var dravidian = regexp.MustCompile(`[ഀ-ൿಀ-೿]`)
var chilluBase = map[string]string{"ൺ": "ണ", "ൻ": "ന", "ർ": "രറ", "ൽ": "ല", "ൾ": "ള", "ൿ": "ക"}

func stemPattern(w string) string {
	rs := []rune(w)
	last := string(rs[len(rs)-1])
	if base, ok := chilluBase[last]; ok {
		return regexp.QuoteMeta(string(rs[:len(rs)-1])) + "[" + last + base + "]"
	}
	if last == "്" || last == "್" {
		return regexp.QuoteMeta(string(rs[:len(rs)-1]))
	}
	return regexp.QuoteMeta(w)
}

// wordRe is a regex for whole words: the match is the word itself in group 2, with one character of edge before (group 1) and after (group 3), as `wordRe` in dates.ts. Longest
// alternative first; a word in Malayalam or Kannada letters also matches with more letters stuck on its end unless `inflect` is false.
func wordRe(words []string, inflect bool) *regexp.Regexp {
	ws := make([]string, len(words))
	for i, w := range words {
		ws[i] = canon(w)
	}
	sort.SliceStable(ws, func(i, j int) bool { return utf16Len(ws[i]) > utf16Len(ws[j]) })
	alts := make([]string, len(ws))
	for i, w := range ws {
		if inflect && dravidian.MatchString(w) {
			alts[i] = stemPattern(w) + `[\p{L}\p{M}]*`
		} else {
			alts[i] = regexp.QuoteMeta(w)
		}
	}
	return regexp.MustCompile(`(?i)(^|` + notWord + `)(` + strings.Join(alts, "|") + `)(` + notWord + `|$)`)
}

// at is where the word starts in s, or -1.
func at(re *regexp.Regexp, s string) int {
	m := re.FindStringSubmatchIndex(s)
	if m == nil {
		return -1
	}
	return m[4]
}

// ---- the rules' compiled form, made the first time an owner's message is read -----------------------------------------------------------------------------

type kindRe struct {
	kind string
	re   *regexp.Regexp
}

type compiled struct {
	kinds                     []kindRe
	leaveFile, leaveOperator  *regexp.Regexp
	forget, forgetAfter, list *regexp.Regexp
	remember                  string
	lead, trail, bare         *regexp.Regexp
	today, tomorrow, dayAfter *regexp.Regexp
	yesterday                 *regexp.Regexp
	guest                     *regexp.Regexp
	ref                       *regexp.Regexp
	otherDate                 *regexp.Regexp
}

var (
	once sync.Once
	rx   *compiled
)

func rules() *compiled {
	once.Do(func() {
		w := Rules()
		c := &compiled{}
		for _, k := range w.Kinds {
			var kind string
			var words []string
			_ = jsonUnmarshal(k[0], &kind)
			_ = jsonUnmarshal(k[1], &words)
			c.kinds = append(c.kinds, kindRe{kind, wordRe(words, true)})
		}
		c.leaveFile = regexp.MustCompile(`(?i)` + fixSpace(strings.Join(w.LeaveFile, "|")))
		c.leaveOperator = regexp.MustCompile(`(?i)` + fixSpace(strings.Join(w.LeaveOperator, "|")))
		remember := fixSpace(strings.Join(w.Remember, "|"))
		c.remember = remember
		// intents-memory.ts: NOT_LETTER is a look-ahead; here the keyword is a group and the character after it is checked by `notLetterAfter`
		c.lead = regexp.MustCompile(`(?is)^[` + jsSpace + `]*(?:please[` + jsSpace + `]+|pls[` + jsSpace + `]+)?(` + remember + `)`)
		c.trail = regexp.MustCompile(`(?is)^(.+?)[` + jsSpace + `]*(?:എന്ന്|ಎಂದು|ki|कि|that)?[` + jsSpace + `]+(?:` + remember + `)[` + jsSpace + `]*[.!]*[` + jsSpace + `]*$`)
		c.bare = regexp.MustCompile(`(?is)^[` + jsSpace + `]*(` + remember + `)`)
		c.list = regexp.MustCompile(`(?i)` + fixSpace(strings.Join(w.List, "|")))
		c.forget = regexp.MustCompile(`(?i)(forget|delete[` + jsSpace + `]+note|remove[` + jsSpace + `]+note|bhool[` + jsSpace + `]+jao|bhul[` + jsSpace + `]+jao|भूल[` + jsSpace + `]*जाओ|भूल[` + jsSpace + `]*जा|नोट[` + jsSpace + `]+हटाओ|മറക്കൂ|മറക്കുക|ಮರೆತುಬಿಡಿ|ಮರೆಯಿರಿ)[` + jsSpace + `]*(?:note[` + jsSpace + `]*)?(?:n-?)?(\d+)`)
		c.forgetAfter = regexp.MustCompile(`(?i)(?:n-?)?(\d{1,4})[` + jsSpace + `]*(?:ko[` + jsSpace + `]+|को[` + jsSpace + `]+)?(forget|bhool[` + jsSpace + `]+jao|भूल[` + jsSpace + `]*जाओ|മറക്കൂ|ಮರೆತುಬಿಡಿ)`)
		c.guest = regexp.MustCompile(`(?i)(^|[^\p{L}\p{N}])chat[` + jsSpace + `]+guest[` + jsSpace + `]+(\d{1,6})([^\p{N}]|$)`)
		c.ref = regexp.MustCompile(`(?i)(^|[^\p{L}\p{N}])([bfqog])-(\d{1,6})([^\p{N}]|$)`)
		d := w.Dates
		c.today = wordRe(append([]string{"today", "आज", "aaj"}, d.Today...), true)
		c.tomorrow = wordRe(append([]string{"tomorrow", "tmrw", "tomorow", "कल", "kal"}, d.Tomorrow...), true)
		c.dayAfter = wordRe(append([]string{"day after tomorrow", "परसों", "परसो", "parso", "parson", "parsoon"}, d.DayAfter...), true)
		c.yesterday = regexp.MustCompile(`(?i)(^|` + notWord + `)(?:` + strings.Join(quoteAll(append([]string{}, d.Yesterday...)), "|") + `)(` + notWord + `|$)`)
		// a weekday or a written date (English and Hindi names): flagged as a date this port does not read
		c.otherDate = regexp.MustCompile(`(?i)(^|` + notWord + `)(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tue|tues|thu|thur|thurs|fri|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|रविवार|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|जनवरी|फरवरी|मार्च|अप्रैल|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर|ravivar|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar)(` + notWord + `|$)`)
		rx = c
	})
	return rx
}

func quoteAll(ws []string) []string {
	out := make([]string, len(ws))
	for i, w := range ws {
		out[i] = regexp.QuoteMeta(canon(w))
	}
	if len(out) == 0 {
		out = []string{`\x{e000}`} // nothing matches
	}
	return out
}

// letterAfter is `NOT_LETTER` of intents-memory.ts: no letter or mark right after index i of s.
func notLetterAfter(s string, i int) bool {
	if i >= len(s) {
		return true
	}
	return notWordRune(s[i:])
}

func notWordRune(rest string) bool {
	for _, r := range rest {
		return !(isLetter(r) || isMark(r))
	}
	return true
}

// findDate is dates.ts findDatePhrase for the phrases a "money" question uses: today, tomorrow, the day after tomorrow (a weekday or a written date is flagged `Other`).
func findDate(c *compiled, raw string) *DatePhrase {
	text := canon(raw)
	text = c.yesterday.ReplaceAllString(text, " ")
	if c.otherDate.MatchString(text) {
		return &DatePhrase{Other: true}
	}
	switch {
	case c.dayAfter.MatchString(text):
		return &DatePhrase{Offset: 2}
	case c.tomorrow.MatchString(text):
		return &DatePhrase{Offset: 1}
	case c.today.MatchString(text):
		return &DatePhrase{Offset: 0}
	}
	return nil
}

// messageWords is the "words" of a message are not needed by a shop with no customers, so only whether the message names one is read (a message with no words asks "what should I tell them?").
func messageWords(text, ref string) (string, bool) {
	i := strings.Index(strings.ToLower(text), ref)
	if i < 0 {
		return "", false
	}
	after := text[i+len(ref):]
	before := text[:i]
	c := rules()
	var msg *regexp.Regexp
	for _, k := range c.kinds {
		if k.kind == "message" {
			msg = k.re
		}
	}
	if m := msg.FindStringSubmatchIndex(after); m != nil && utf16Len(after[:m[4]]) <= 12 {
		after = after[m[5]:]
	} else if !msg.MatchString(before) {
		return "", false
	}
	after = regexp.MustCompile(`(?i)^[`+jsSpace+`:,;.\-–—]*(?:that|ki|कि|को|ko)?[`+jsSpace+`:,;.\-–—]*`).ReplaceAllString(after, "")
	after = strings.TrimFunc(after, func(r rune) bool { return isSpaceRune(r) })
	if len([]rune(after)) >= 2 {
		rs := []rune(after)
		if strings.ContainsRune("\"'“‘", rs[0]) && strings.ContainsRune("\"'”’", rs[len(rs)-1]) {
			after = strings.TrimFunc(string(rs[1:len(rs)-1]), isSpaceRune)
		}
	}
	return after, after != ""
}

// ReadOwnerRules is intents.ts `readOwnerRules` for this shop's kinds: the first kind whose words are in the message, and the values the words give.
func ReadOwnerRules(text string) Intent {
	c := rules()
	text = c.guest.ReplaceAllString(text, "${1}g-${2}${3}")
	plainText := canon(text)
	var ref string
	withoutRef := plainText
	if m := c.ref.FindStringSubmatchIndex(plainText); m != nil {
		n, _ := strconv.Atoi(plainText[m[6]:m[7]])
		ref = strings.ToLower(plainText[m[4]:m[5]]) + "-" + strconv.Itoa(n)
		// the reference itself is replaced by a space (not the characters around it, which belong to the match here)
		withoutRef = plainText[:m[4]] + " " + plainText[m[7]:]
	}
	date := findDate(c, withoutRef)
	// leaving with the shop: by rule only, before every other kind (not when a case is named); then the shop's memory, which a named case does not stop
	if ref == "" {
		if k := readLeave(c, text); k != "" {
			return Intent{Kind: k}
		}
	}
	if mem := readMemory(c, text); mem != nil {
		return *mem
	}
	if ref != "" {
		first := func(re *regexp.Regexp) int {
			if i := at(re, withoutRef); i >= 0 {
				return i
			}
			return 1 << 30
		}
		var atMsg int
		for _, k := range c.kinds {
			if k.kind == "message" {
				atMsg = first(k.re)
			}
		}
		if atMsg != 1<<30 {
			all := true
			for _, k := range c.kinds {
				if k.kind != "message" && first(k.re) <= atMsg {
					all = false
				}
			}
			if all {
				w, _ := messageWords(text, ref)
				return Intent{Kind: "message", Ref: ref, Words: w, Date: date}
			}
		}
	}
	// (intents.ts reads a rule about a declared limit here; a listings-only shop declares none)
	for _, k := range c.kinds {
		if !k.re.MatchString(withoutRef) {
			continue
		}
		if k.kind == "message" {
			if ref == "" {
				continue
			}
			w, _ := messageWords(text, ref)
			return Intent{Kind: "message", Ref: ref, Words: w, Date: date}
		}
		return Intent{Kind: k.kind, Ref: ref, Date: date}
	}
	// a day and nothing else ("Sunday?", "16 Nov") asks for that day's list: the kind "day", which this shop does not offer
	if date != nil && len([]rune(strings.Map(func(r rune) rune {
		if isSpaceRune(r) || r == '?' || r == '.' || r == '!' {
			return -1
		}
		return r
	}, withoutRef))) <= 24 {
		return Intent{Kind: "day", Ref: ref, Date: date}
	}
	return Intent{Kind: "unknown", Ref: ref, Date: date}
}

func readLeave(c *compiled, text string) string {
	t := xnorm.NFC.String(text)
	if utf16Len(t) > 90 {
		return ""
	}
	if c.leaveOperator.MatchString(t) {
		return "leave_operator"
	}
	if c.leaveFile.MatchString(t) {
		return "leave_file"
	}
	return ""
}

func trimQuotes(s string) string {
	s = strings.TrimFunc(s, isSpaceRune)
	rs := []rune(s)
	if len(rs) >= 2 && strings.ContainsRune("\"'“‘", rs[0]) && strings.ContainsRune("\"'”’", rs[len(rs)-1]) {
		s = strings.TrimFunc(string(rs[1:len(rs)-1]), isSpaceRune)
	}
	return s
}

var afterRemember = regexp.MustCompile(`(?is)^[` + jsSpace + `]*(?:that[` + jsSpace + `]+|ki[` + jsSpace + `]+|कि[` + jsSpace + `]+)?[:,\-–]?[` + jsSpace + `]*(.+)$`)
var restOfBare = regexp.MustCompile(`^[` + jsSpace + `]*[.!?]*[` + jsSpace + `]*$`)

// readMemory is intents-memory.ts readMemoryWords: forget, then the list of notes, then remember. The kinds are only RECOGNISED here: this runtime keeps no notes, so the caller answers them
// with "this shop's assistant doesn't handle that" rather than pretend (go/TRIAL.md).
func readMemory(c *compiled, text string) *Intent {
	t := xnorm.NFC.String(text)
	for _, m := range c.forget.FindAllStringSubmatchIndex(t, -1) {
		if notLetterAfter(t, m[3]) && len(t[m[4]:m[5]]) <= 4 {
			n, _ := strconv.Atoi(t[m[4]:m[5]])
			return &Intent{Kind: "forget", Note: "n-" + strconv.Itoa(n)}
		}
	}
	if utf16Len(t) <= 40 {
		for _, m := range c.forgetAfter.FindAllStringSubmatchIndex(t, -1) {
			if notLetterAfter(t, m[5]) {
				n, _ := strconv.Atoi(t[m[2]:m[3]])
				return &Intent{Kind: "forget", Note: "n-" + strconv.Itoa(n)}
			}
		}
	}
	if utf16Len(t) <= 80 && c.list.MatchString(t) {
		return &Intent{Kind: "notes"}
	}
	if m := c.lead.FindStringSubmatchIndex(t); m != nil && notLetterAfter(t, m[3]) {
		if r := afterRemember.FindStringSubmatch(t[m[3]:]); r != nil {
			return &Intent{Kind: "remember", Words: trimQuotes(r[1])}
		}
	}
	if m := c.trail.FindStringSubmatch(t); m != nil {
		return &Intent{Kind: "remember", Words: trimQuotes(m[1])}
	}
	if m := c.bare.FindStringSubmatchIndex(t); m != nil && notLetterAfter(t, m[3]) && restOfBare.MatchString(t[m[3]:]) {
		return &Intent{Kind: "remember"}
	}
	return nil
}

// Offered is conversation.ts `offered` after intents.ts `coerce`: a kind this shop's assistant does not take is read as unknown (the model reader does the same), except help and limit.
func Offered(kind string) string {
	if kind == "unknown" || kind == "help" || kind == "limit" {
		return kind
	}
	for _, k := range OfferedKinds {
		if k == kind {
			return kind
		}
	}
	return "unknown"
}

// ---- small helpers ----------------------------------------------------------------------------------------------------------------------------------------

func isSpaceRune(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\v', '\f', '\r', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}
