package runtime

// A case asked about from another conversation (25 Nov 2026): the Go twin of modules/record/case-asked.ts, shared by every template. Someone writes from a number (or a page
// chat) that holds no case of the shop and names a case's reference ("b-3", "B3", "booking 3", "f-3.2", a receipt's number) or a payment id the shop's record holds. The
// template answers with one plain line that shows nothing of the case, tells the owner at most once an hour per asking conversation and case (read from the record, so a
// restart keeps it), and writes one CaseAsked line. The file's head in case-asked.ts says how the words are read; this file reads them the same way, and
// testdata/caseasked-vectors.json (go/scripts/gen_caseasked_vectors.ts) holds the two equal.
//
// Where Go and JavaScript differ: the TypeScript's /[\p{L}\p{M}\p{N}...]/u is unicode.IsLetter/IsMark/IsNumber here; only ASCII letters are lower-cased on both sides
// (JavaScript's and Go's full-Unicode lower-casing differ at the edges); Number("007") is strconv.Atoi; Date.parse of the record's ISO time is time.Parse.

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// CaseAsked is case-asked.ts CASE_ASKED: the record line of one ask (the asking conversation, booking null, refs.case the case, refs.via how it was named).
const CaseAsked = "case_asked_elsewhere"

// CaseAskedEveryMs is CASE_ASKED_EVERY_MS: the owner is told at most once in this time about the same asking conversation and case.
const CaseAskedEveryMs = int64(3_600_000)

// CaseForms is case-asked.ts CaseForms: the letter of a template's references and the words a customer puts before the number, lower case.
type CaseForms struct {
	Prefix string
	Words  []string
}

// Named is case-asked.ts Named: the case the words name and how ("receipt", "reference", "payment").
type Named struct {
	Case string `json:"case"`
	Via  string `json:"via"`
}

var (
	caseFillers = map[string]bool{"no": true, "number": true, "num": true, "nr": true, "ref": true, "id": true, "नंबर": true, "नम्बर": true, "संख्या": true, "നമ്പർ": true, "നം": true, "ಸಂಖ್ಯೆ": true, "ನಂಬರ್": true}
	caseReceipt = regexp.MustCompile(`^(rct|bill|cn)/?(\d{2})-(\d{2})/?(\d{1,6})$`)
	caseShort   = regexp.MustCompile(`^([a-z])[-#]?(\d{1,7})(?:\.(\d{1,4}|[a-z]))?$`)
	caseDigits  = regexp.MustCompile(`^\d{1,7}$`)
)

// caseMinKey is MIN_KEY: a key shorter than this is never matched as a token.
const caseMinKey = 6

func asciiLower(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + 32
		}
		return r
	}, s)
}

// CaseKey is case-asked.ts caseKey: a key as NamedCase compares it (what a template adds to RecordCaseKeys goes through this).
func CaseKey(v string) string { return asciiLower(v) }

func tokenChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsMark(r) || unicode.IsNumber(r) || r == '-' || r == '#' || r == '.' || r == '/' || r == '_'
}

func edgeChar(r rune) bool { return r == '-' || r == '#' || r == '.' || r == '/' }

// CaseTokens is case-asked.ts tokensOf: the words as tokens.
func CaseTokens(text string) []string {
	var out []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			if t := strings.TrimFunc(cur.String(), edgeChar); t != "" {
				out = append(out, t)
			}
			cur.Reset()
		}
	}
	for _, r := range asciiLower(language.Plain(text)) {
		if tokenChar(r) {
			cur.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	return out
}

// RecordCaseKeys is case-asked.ts recordKeys: each line's refs.reference, refs.doc and refs.paymentId, lower case, to the line's case.
func RecordCaseKeys(entries []store.Entry) map[string]string {
	keys := map[string]string{}
	for _, e := range entries {
		if e.Booking == nil || *e.Booking == "" {
			continue
		}
		for _, k := range []string{"reference", "doc", "paymentId"} {
			if v := e.Refs[k]; v != "" {
				keys[asciiLower(v)] = *e.Booking
			}
		}
	}
	return keys
}

func receiptKey(token string) string {
	m := caseReceipt.FindStringSubmatch(token)
	if m == nil {
		return ""
	}
	n := m[4]
	for len(n) < 4 {
		n = "0" + n
	}
	return m[1] + "/" + m[2] + "-" + m[3] + "/" + n
}

// NamedCase is case-asked.ts namedCase: the case these words name, or nil. isCase says whether the shop holds a case by this id; keys are the record's (RecordCaseKeys) and
// any the template adds, lower case; words allows the word form ("booking 3"), which a template allows only when its reading found nothing to do.
func NamedCase(text string, forms CaseForms, isCase func(string) bool, keys map[string]string, words bool) *Named {
	tokens := CaseTokens(text)
	prefix := asciiLower(forms.Prefix)
	caseOfKey := func(key string) string {
		if c, ok := keys[key]; ok && isCase(c) {
			return c
		}
		return ""
	}
	for _, t := range tokens {
		if r := receiptKey(t); r != "" {
			if c := caseOfKey(r); c != "" {
				return &Named{c, "receipt"}
			}
		}
	}
	for _, t := range tokens {
		m := caseShort.FindStringSubmatch(t)
		if m == nil || m[1] != prefix {
			continue
		}
		n, _ := strconv.Atoi(m[2])
		base := prefix + "-" + strconv.Itoa(n)
		whole := base
		if m[3] != "" {
			whole = base + "." + m[3]
		}
		c := ""
		switch {
		case isCase(whole):
			c = whole
		case caseOfKey(whole) != "":
			c = caseOfKey(whole)
		case isCase(base):
			c = base
		}
		if c != "" {
			return &Named{c, "reference"}
		}
	}
	for _, t := range tokens {
		if len([]rune(t)) < caseMinKey { // JavaScript's length counts UTF-16 units; a key is ASCII, so a token that could match has the same length either way
			continue
		}
		if c := caseOfKey(t); c != "" {
			return &Named{c, "payment"}
		}
	}
	if !words {
		return nil
	}
	ws := map[string]bool{}
	for _, w := range forms.Words {
		ws[asciiLower(w)] = true
	}
	for i := range tokens {
		if !ws[tokens[i]] {
			continue
		}
		j := i + 1
		if j < len(tokens) && caseFillers[tokens[j]] {
			j++
		}
		if j >= len(tokens) || !caseDigits.MatchString(tokens[j]) {
			continue
		}
		n, _ := strconv.Atoi(tokens[j])
		if id := prefix + "-" + strconv.Itoa(n); isCase(id) {
			return &Named{id, "reference"}
		}
	}
	return nil
}

// ToldLately is case-asked.ts toldLately: was the owner told about this asking conversation and this case within CaseAskedEveryMs, by the record.
func ToldLately(entries []store.Entry, conversation, caseID string, nowMs int64) bool {
	for _, e := range entries {
		if e.Action != CaseAsked || e.Outcome != "confirmed" || e.Conversation != conversation || e.Refs["case"] != caseID {
			continue
		}
		t, err := time.Parse(time.RFC3339Nano, e.Time)
		if err == nil && nowMs-t.UnixMilli() < CaseAskedEveryMs {
			return true
		}
	}
	return false
}
