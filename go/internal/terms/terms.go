// Package terms is the one-page shop terms of the Bookings, Orders and Fees runtimes, in English, Hindi, Malayalam and Kannada, and what it takes to agree to them on WhatsApp (B72,
// 12 Nov 2026): the Go twin of modules/terms/{terms.ts, owner.ts, reader.ts}. It is OFF unless the shop's runtime is handed a terms file; the file is only handed over when the server
// setting `panel.termsOnWhatsapp` is on.
//
// LEGAL STATUS, as the TypeScript says it plainly: this is a mechanism and a draft text. It has NOT had the owner's legal check. Signed paper is still what Geometer's sell guides tell
// a partner to use; nothing here may be described as legally sufficient until that check is done.
//
// What binds an agreement: the digest of the EXACT text sent (it contains the shop's name, the partner's name and number, and the two prices), the version, the language, the owner's
// number and the WhatsApp message id of the reply. Changed terms (a new price, a new version) are a different digest and need a new agreement.
//
// THE WORDS ARE NEVER TYPED HERE. The four languages' text, the buttons and the answers are written once, in TypeScript (modules/terms/terms.ts), and go/scripts/vectors/terms.ts RENDERS
// them with slots ({shop}, {partner}, {phone}, {monthly}, {setup}, {v}) into words.json, which this package embeds; Go only fills the slots. The same file holds the two patterns
// that read the owner's "terms" and "I agree" (the TypeScript's own RegExp sources). `node go/scripts/gen_guard_vectors.ts` writes it and `--check` fails when it is out of date.
// The digest is the same bytes as the TypeScript's: sha256 of "shop-terms:" and the text.
package terms

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"unicode"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
)

// Version is TERMS_VERSION; the generator checks it against the TypeScript's (it is in the text, so it is in the digest).
const Version = "2026-11-12"

// The record's words for what happened: their own actions, so a report never counts them as approvals or messages to customers.
const (
	SentAction   = "terms_sent"
	AgreedAction = "terms_agreed"
	// AgreePrefix starts the agree button's id, which carries the first 12 characters of the digest it was offered for.
	AgreePrefix = "terms-agree:"
	LaterID     = "terms-later"
	// ReviewState is the Hindi, Malayalam and Kannada text's review state (the same word as bundle/panel/languages.ts).
	ReviewState = "machine-written"
)

// Languages are the four the terms exist in.
var Languages = []string{"en", "hi", "ml", "kn"}

// File is TermsFile: what the partner enters for a shop (the panel writes it; the deployer copies it to the runtime as terms.json). Prices are the partner's own, whole rupees.
type File struct {
	Schema       int    `json:"schema"`
	PartnerName  string `json:"partnerName"`
	PartnerPhone string `json:"partnerPhone"`
	MonthlyInr   int64  `json:"monthlyInr"`
	SetupInr     int64  `json:"setupInr"`
}

// whole is `typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000`, with the number a decoded JSON number (guard.Int: a whole number JavaScript holds exactly).
func whole(v any) (int64, bool) {
	n, ok := guard.Int(v)
	return n, ok && n >= 0 && n <= 10_000_000
}

// line is `typeof v === "string" && v.trim() !== "" && v.length <= max && !/[\p{Cc}]/u.test(v)`: .length is UTF-16 units, trim is JavaScript's whitespace.
func line(v any, max int) (string, bool) {
	s, ok := v.(string)
	if !ok || language.TrimJS(s) == "" || language.UTF16Len(s) > max || strings.ContainsFunc(s, func(r rune) bool { return unicode.Is(unicode.Cc, r) }) {
		return "", false
	}
	return s, true
}

// ReadFile is readTermsFile: a terms file checked field by field (raw is decoded JSON, numbers as json.Number); anything else is no terms file (nil), so the feature stays off, never a
// half-filled one. Unknown members are dropped, as the TypeScript's rebuilt object drops them.
func ReadFile(raw any) *File {
	r, ok := guard.IsObject(raw)
	if !ok {
		return nil
	}
	schema, ok := guard.Int(r["schema"])
	if !ok || schema != 1 {
		return nil
	}
	name, ok1 := line(r["partnerName"], 60)
	phone, ok2 := line(r["partnerPhone"], 30)
	monthly, ok3 := whole(r["monthlyInr"])
	setup, ok4 := whole(r["setupInr"])
	if !ok1 || !ok2 || !ok3 || !ok4 {
		return nil
	}
	return &File{Schema: 1, PartnerName: language.TrimJS(name), PartnerPhone: language.TrimJS(phone), MonthlyInr: monthly, SetupInr: setup}
}

// ---- the generated words -------------------------------------------------------------------------------------------------------

//go:embed words.json
var wordsJSON []byte

// Answers are the short words around the terms in one language: the question under them, the buttons, the answers. Ask, Done and Already hold a {v} slot for the version.
type Answers struct {
	Ask      string `json:"ask"`
	Agree    string `json:"agree"`
	Later    string `json:"later"`
	Done     string `json:"done"`
	AskFirst string `json:"askFirst"`
	OK       string `json:"ok"`
	Already  string `json:"already"`
}

type pattern struct{ Source, Flags string }

type pack struct {
	Constants struct {
		Version, SentAction, AgreedAction, AgreePrefix, LaterID, ReviewState string
	} `json:"constants"`
	Request pattern            `json:"request"`
	Agree   pattern            `json:"agree"`
	Bodies  map[string]string  `json:"bodies"`
	Words   map[string]Answers `json:"words"`
}

var (
	loadOnce sync.Once
	loaded   pack
	request  *language.Regex
	agree    *language.Regex
)

func load() {
	loadOnce.Do(func() {
		if err := json.Unmarshal(wordsJSON, &loaded); err != nil {
			panic("terms/words.json: " + err.Error())
		}
		request = language.MustCompile(loaded.Request.Source, loaded.Request.Flags)
		agree = language.MustCompile(loaded.Agree.Source, loaded.Agree.Flags)
	})
}

// fill is the slots replaced in one pass (a shop whose name holds "{partner}" is not expanded twice).
func fill(template string, pairs ...string) string {
	return strings.NewReplacer(pairs...).Replace(template)
}

// Text is termsText: the terms for one shop, as the owner reads them, in the owner's language. A language that is not one of the four is an error (the TypeScript's table has no row
// for it and throws).
func Text(lang, shopName string, f File) (string, error) {
	load()
	body, ok := loaded.Bodies[lang]
	if !ok {
		return "", fmt.Errorf("no terms in the language %q", lang)
	}
	return fill(body, "{shop}", shopName, "{partner}", f.PartnerName, "{phone}", f.PartnerPhone, "{monthly}", language.FormatInr(float64(f.MonthlyInr)), "{setup}", language.FormatInr(float64(f.SetupInr))), nil
}

// Digest is termsDigest: what an agreement is bound to, the sha256 of the exact text (so of the names, prices, version and language in it).
func Digest(text string) string {
	h := sha256.Sum256([]byte("shop-terms:" + text))
	return hex.EncodeToString(h[:])
}

// IsTermsRequest is isTermsRequest: the owner's request to read the terms, one word in the four languages (JavaScript's `\s` and case-insensitive `u` matching, by the language package).
func IsTermsRequest(text string) bool { load(); return request.Test(text) }

// IsAgreeWords is isAgreeWords: "I agree", typed, in the four languages. A bare "ok", "yes" or a thumbs-up is not an agreement.
func IsAgreeWords(text string) bool { load(); return agree.Test(text) }

// Words is TERMS_WORDS for a language, with the version filled in for Ask, Done and Already. ok is false for a language that is not one of the four.
func Words(lang, version string) (a Answers, ok bool) {
	load()
	a, ok = loaded.Words[lang]
	if !ok {
		return a, false
	}
	a.Ask, a.Done, a.Already = fill(a.Ask, "{v}", version), fill(a.Done, "{v}", version), fill(a.Already, "{v}", version)
	return a, true
}

// Constants are what the generator read from the TypeScript, for a test to hold the constants above to.
func Constants() (version, sent, agreed, prefix, later, review string) {
	load()
	c := loaded.Constants
	return c.Version, c.SentAction, c.AgreedAction, c.AgreePrefix, c.LaterID, c.ReviewState
}
