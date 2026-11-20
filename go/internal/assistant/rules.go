package assistant

// Reading the owner's words by rule: what kind of thing they want of the shop's assistant (modules/assistant/intents.ts `readOwnerRules`, with intents-leave.ts and intents-memory.ts), in
// English, Hindi (also typed in Latin letters), Malayalam and Kannada. Only the rules: the router (understanding/router.ts) asks the decision and language models about a message
// the rules could not place.
//
// What is ported and what is not:
//   - every kind's pattern, in the order TypeScript tries them (the first kind whose words are in the message wins): the TypeScript's built patterns themselves (internal/language,
//     patterns.json, from go/scripts/gen_patterns.ts), matched as JavaScript matches them (language.Regex); the kinds a listings-only shop does not offer (a day's list, owes,
//     orders, closing a day, moving a booking) are still read, because the listing check (`Strong`) and the "message first" rule look at them, but `Offered` turns them into
//     "unknown" as TypeScript's `coerce` does;
//   - the case reference (`b-14`), the message-first rule, the leave words ("get my shop's file", "change my Operator"), the memory words (remember, notes, forget) and the date a
//     message names (language.FindDatePhrase);
//   - the amount ("refund b-14 ₹500", intents.ts amountOf over its AMOUNT_RE, generated into patterns.json), the time of day (a booking's move: language.FindTimePhrase), and the
//     rule about a declared limit (`Context.LimitRule`, limits-card.ts looksLikeLimitRule), each only where the shop's kinds use it (wave 2, step 5: a Bookings shop).
//
// A shop's kinds come in a Context (conversation.ts kindsOf): the listings-only shop's are OfferedKinds (the zero Context), a Bookings shop's add a day's list, closing and opening a
// day and moving a booking (BookingsKinds, generated with the router's reading for them).
//
// JavaScript against Go: the memory patterns (intents-memory.ts) have a look-ahead in their middle, which language.Regex does not take, so here the keyword is a group and the
// character after it is checked by hand (`notLetterAfter`). `\s` is JavaScript's (language.JSSpace), and lengths are counted in UTF-16 units where TypeScript counts `.length`.

import (
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"github.com/GeometerLabs/agents/go/internal/language"
	xnorm "golang.org/x/text/unicode/norm"
)

// OfferedKinds are the kinds a listings-only shop's assistant takes (conversation.ts kindsOf for a shop with no day, owes, open orders, close day or move skill).
var OfferedKinds = []string{"waiting", "money", "cancel", "refund", "message", "undo", "limit", "help", "remember", "notes", "forget", "leave_file", "leave_operator"}

// Strong are the kinds that are an act on a case, a limit or the memory: they win over a listing even with photos waiting (conversation.ts STRONG). This list includes kinds this shop
// does not offer: the reading looks at them before `coerce` takes them out.
var Strong = []string{"remember", "notes", "forget", "undo", "help", "limit", "cancel", "refund", "message", "close_day", "reopen_day", "move"}

// Intent is what the rules read.
type Intent struct {
	Kind     string
	Language string // the language the words' script shows ("" for Latin letters: English or Hindi typed in Latin letters, not clear)
	Ref      string // "b-14", lower case
	Words    string // remember: the note's words; message: the words to send
	Note     string // forget: "n-3"
	Date     *language.DatePhrase
	Time     *language.TimePhrase // a time of day the words name (a move); nil when none
	// AmountPaise is a refund's amount written with a rupee sign or word; 0 when none (intents.ts leaves the member out)
	AmountPaise int64
}

// Context is intents.ts OwnerContext: the kinds this shop's assistant takes, and whether a text states a rule about one of its declared limits (nil: nothing is a limit rule).
type Context struct {
	Kinds     []string
	LimitRule func(text string) bool
}

// KindsOf is the context's kinds, the listings shop's when none are given.
func (c Context) KindsOf() []string {
	if c.Kinds == nil {
		return OfferedKinds
	}
	return c.Kinds
}

// AmountOf is intents.ts amountOf: the amount written with a rupee sign or word, in paise; 0 when there is none (a bare number is never money).
func AmountOf(text string) int64 {
	m := language.P("intents.amount").Find(text)
	if m == nil {
		return 0
	}
	whole, frac := m.Group(1), m.Group(2)
	if whole == "" {
		whole, frac = m.Group(3), m.Group(4)
	}
	rupees, err := strconv.ParseInt(strings.ReplaceAll(whole, ",", ""), 10, 64)
	if err != nil {
		return 0
	}
	for len(frac) < 2 {
		frac += "0" // `padEnd(2, "0")`
	}
	paise, _ := strconv.ParseInt(frac, 10, 64)
	total := rupees*100 + paise
	if total <= 0 || total > 9007199254740991 { // Number.isSafeInteger(total) && total > 0
		return 0
	}
	return total
}

// jsSpace is what JavaScript's `\s` matches, as RE2 class content.
const jsSpace = language.JSSpace

func utf16Len(s string) int { return language.UTF16Len(s) }

// ---- the rules' compiled form, made the first time an owner's message is read -----------------------------------------------------------------------------

type kindRe struct {
	kind string
	re   *language.Regex
}

type compiled struct {
	kinds                    []kindRe
	leaveFile, leaveOperator *language.Regex
	list                     *language.Regex
	forget, forgetAfter      *regexp.Regexp
	lead, trail, bare        *regexp.Regexp
	guest, ref               *language.Regex
}

var (
	once sync.Once
	rx   *compiled
)

func rules() *compiled {
	once.Do(func() {
		w := Rules()
		c := &compiled{}
		for _, kind := range language.OwnerKinds() {
			c.kinds = append(c.kinds, kindRe{kind, language.P("intents.kind." + kind)})
		}
		// intents-leave.ts and intents-memory.ts join their lists with "|" into one pattern ("iu"): the same, from the same lists
		c.leaveFile = language.MustCompile(strings.Join(w.LeaveFile, "|"), "iu")
		c.leaveOperator = language.MustCompile(strings.Join(w.LeaveOperator, "|"), "iu")
		c.list = language.MustCompile(strings.Join(w.List, "|"), "iu")
		remember := toRE2(strings.Join(w.Remember, "|"))
		// intents-memory.ts: NOT_LETTER is a look-ahead; here the keyword is a group and the character after it is checked by `notLetterAfter`
		c.lead = regexp.MustCompile(`(?is)^[` + jsSpace + `]*(?:please[` + jsSpace + `]+|pls[` + jsSpace + `]+)?(` + remember + `)`)
		c.trail = regexp.MustCompile(`(?is)^(.+?)[` + jsSpace + `]*(?:എന്ന്|ಎಂದು|ki|कि|that)?[` + jsSpace + `]+(?:` + remember + `)[` + jsSpace + `]*[.!]*[` + jsSpace + `]*$`)
		c.bare = regexp.MustCompile(`(?is)^[` + jsSpace + `]*(` + remember + `)`)
		c.forget = regexp.MustCompile(`(?i)(forget|delete[` + jsSpace + `]+note|remove[` + jsSpace + `]+note|bhool[` + jsSpace + `]+jao|bhul[` + jsSpace + `]+jao|भूल[` + jsSpace + `]*जाओ|भूल[` + jsSpace + `]*जा|नोट[` + jsSpace + `]+हटाओ|മറക്കൂ|മറക്കുക|ಮರೆತುಬಿಡಿ|ಮರೆಯಿರಿ)[` + jsSpace + `]*(?:note[` + jsSpace + `]*)?(?:n-?)?(\d+)`)
		c.forgetAfter = regexp.MustCompile(`(?i)(?:n-?)?(\d{1,4})[` + jsSpace + `]*(?:ko[` + jsSpace + `]+|को[` + jsSpace + `]+)?(forget|bhool[` + jsSpace + `]+jao|भूल[` + jsSpace + `]*जाओ|മറക്കൂ|ಮರೆತುಬಿಡಿ)`)
		c.guest = language.P("intents.guest")
		c.ref = language.P("intents.ref")
		rx = c
	})
	return rx
}

// toRE2 writes JavaScript's `\s` in a word list as JavaScript's whitespace.
func toRE2(p string) string { return strings.ReplaceAll(p, `\s`, `[`+jsSpace+`]`) }

// letterAfter is `NOT_LETTER` of intents-memory.ts: no letter or mark right after index i of s.
func notLetterAfter(s string, i int) bool {
	if i >= len(s) {
		return true
	}
	return notWordRune(s[i:])
}

// digitAfter: a number (\p{N}, any script) right after index i of s.
func digitAfter(s string, i int) bool {
	for _, r := range s[i:] {
		return unicode.IsNumber(r)
	}
	return false
}

func notWordRune(rest string) bool {
	for _, r := range rest {
		return !(unicode.IsLetter(r) || unicode.IsMark(r))
	}
	return true
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
	var msg *language.Regex
	for _, k := range c.kinds {
		if k.kind == "message" {
			msg = k.re
		}
	}
	if m := msg.Find(after); m != nil && utf16Len(after[:m.Start()]) <= 12 {
		after = after[m.End():]
	} else if !msg.Test(before) {
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

// ReadOwnerRules is intents.ts `readOwnerRules` for a listings-only shop (no limit rule).
func ReadOwnerRules(text string) Intent { return ReadOwnerRulesIn(text, Context{}) }

// ReadOwnerRulesIn is intents.ts `readOwnerRules` for this shop's context: the first kind whose words are in the message, and the values the words give, with the language the
// words' script shows.
func ReadOwnerRulesIn(text string, ctx Context) Intent {
	text = rules().guest.Replace(text, "g-$1")
	in := readOwnerRules(text, ctx)
	if l := language.LanguageOfScript(text); l != "en" {
		in.Language = l
	}
	return in
}

func readOwnerRules(text string, ctx Context) Intent {
	c := rules()
	plainText := language.Canon(text)
	var ref string
	withoutRef := plainText
	if m := c.ref.Find(plainText); m != nil {
		n, _ := strconv.Atoi(m.Group(2))
		ref = strings.ToLower(m.Group(1)) + "-" + strconv.Itoa(n)
		withoutRef = plainText[:m.Start()] + " " + plainText[m.End():]
	}
	date := language.FindDatePhrase(withoutRef)
	tm := language.FindTimePhrase(withoutRef)
	amount := AmountOf(withoutRef)
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
		first := func(re *language.Regex) int {
			if i := re.Index(withoutRef); i >= 0 {
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
				return Intent{Kind: "message", Ref: ref, Words: w, Date: date, Time: tm}
			}
		}
	}
	// a rule about a limit ("refunds above ₹500 need my OK") names no case: it is read as a limit before the kind words can take it for a refund or a list
	if ref == "" && ctx.LimitRule != nil && ctx.LimitRule(text) {
		return Intent{Kind: "limit", Date: date, Time: tm}
	}
	for _, k := range c.kinds {
		if !k.re.Test(withoutRef) {
			continue
		}
		if k.kind == "message" {
			if ref == "" {
				continue
			}
			w, _ := messageWords(text, ref)
			return Intent{Kind: "message", Ref: ref, Words: w, Date: date, Time: tm}
		}
		if k.kind == "refund" {
			return Intent{Kind: k.kind, Ref: ref, Date: date, Time: tm, AmountPaise: amount}
		}
		return Intent{Kind: k.kind, Ref: ref, Date: date, Time: tm}
	}
	// a day and nothing else ("Sunday?", "16 Nov") asks for that day's list; a time alone says nothing
	if date != nil && tm == nil && len([]rune(strings.Map(func(r rune) rune {
		if isSpaceRune(r) || r == '?' || r == '.' || r == '!' {
			return -1
		}
		return r
	}, withoutRef))) <= 24 {
		return Intent{Kind: "day", Ref: ref, Date: date}
	}
	return Intent{Kind: "unknown", Ref: ref, Date: date, Time: tm}
}

func readLeave(c *compiled, text string) string {
	t := xnorm.NFC.String(text)
	if utf16Len(t) > 90 {
		return ""
	}
	if c.leaveOperator.Test(t) {
		return "leave_operator"
	}
	if c.leaveFile.Test(t) {
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
		// (\d{1,4})(?![\p{N}]): at most four digits, and no digit of any script after them
		if notLetterAfter(t, m[3]) && len(t[m[4]:m[5]]) <= 4 && !digitAfter(t, m[5]) {
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
	if utf16Len(t) <= 80 && c.list.Test(t) {
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

// Offered is OfferedIn for a listings-only shop.
func Offered(kind string) string { return OfferedIn(kind, OfferedKinds) }

// OfferedIn is intents.ts `coerce`'s kind: a kind this shop's assistant does not take is read as unknown (the model reader does the same), except help and limit.
func OfferedIn(kind string, kinds []string) string {
	if kind == "unknown" || kind == "help" || kind == "limit" {
		return kind
	}
	for _, k := range kinds {
		if k == kind {
			return kind
		}
	}
	return "unknown"
}

// ---- small helpers ----------------------------------------------------------------------------------------------------------------------------------------

func isSpaceRune(r rune) bool { return language.IsJSSpace(r) }
