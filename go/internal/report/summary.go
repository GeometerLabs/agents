// The signed summary a shop paper carries in its link: modules/report/summary.ts. The format is explained there (the link `https://geometer.dev/verify/#s1.<payload>.<signature>`, the
// payload's bytes, ONE SPELLING ONLY: a parser refuses anything the encoder would not write byte for byte). This file is the same encoder and parser in Go, byte for byte: the
// vectors the Go tests compare with were made by running the TypeScript.
//
// Where Go and JavaScript differ, and what is copied:
//   - `\s`, `trim()` and `trimEnd()` are JavaScript's (language.IsJSSpace: Unicode White_Space plus U+FEFF and the line and paragraph separators, not U+0085).
//   - A text's length in bytes counts UTF-16 code units for the wide form (two bytes a unit), so a character outside the BMP costs four.
//   - A "lone surrogate" cannot be in a Go string; the nearest thing is invalid UTF-8, and that is what is refused (encode), cut out (fitText) or cannot be read (decode).
//   - Intl.Segmenter's grapheme clusters are graphemes.go (where the two can differ is listed there).
//   - The TypeScript counts figures as doubles (safe integers up to 2^53-1); Go uses int64 with the same bound.
package report

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// The format's version, what the signature covers before the payload, the page, and the sizes (all the TypeScript's constants).
const (
	SummaryVersion = "s1"
	SummaryDomain  = "geo-summary/1\n"
	VerifyPage     = "https://geometer.dev/verify/"
	KeyHintBytes   = 8
	MaxShopBytes   = 64
	MaxByBytes     = 64
	MaxPathway     = 32
	MaxFigures     = 16
	digestBytes    = 32
	SignatureBytes = 64
	ellipsis       = "…"
	ownerMarkedBit = 0b1
	wideBit        = 0x80
)

// SummarySources are the source bytes' meanings, by place: never reorder (a printed link would read differently).
var SummarySources = []string{"live", "test-mode", "stand-in"}

// SummaryError is a bad or unknown link or a summary the format cannot carry, told apart from a bug in the code.
type SummaryError struct{ Msg string }

func (e *SummaryError) Error() string { return e.Msg }

func sErr(format string, a ...any) error { return &SummaryError{fmt.Sprintf(format, a...)} }

// PaperSummary is a summary as the encoder takes it and the parser gives it back.
type PaperSummary struct {
	Layout      int
	Source      string // one of SummarySources
	OwnerMarked bool
	Period      string
	Pathway     string
	Shop        string
	By          string // who set the shop up, as the paper says it; "" when it names no one
	Figures     []int64
	KeyHint     string // the first 8 bytes of the signer's key id, 16 hex digits
	Digest      string // "sha256:" and 64 hex digits
}

// Figure is one figure of a layout: its id and its kind ("count" or "money", money in paise).
type Figure struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
}

// Layout says which figures a summary carries, in which order, for each paper (LAYOUTS in summary.ts, generated from it into words.json.gz).
type Layout struct {
	ID       int      `json:"id"`
	Paper    string   `json:"paper"`
	Template string   `json:"template"`
	Figures  []Figure `json:"figures"`
}

// Layouts is LAYOUTS.
func Layouts() []Layout { return loadWords().Layouts }

// LayoutOf is layoutOf(id): nil for an id this build does not know (a newer or forged link is refused, not misread).
func LayoutOf(id int) *Layout {
	ls := loadWords().Layouts
	for i := range ls {
		if ls[i].ID == id {
			return &ls[i]
		}
	}
	return nil
}

// ---- text ----

// TextBytes is textBytes(s): UTF-16LE when that is strictly shorter than UTF-8, else UTF-8 (Hindi, Malayalam and Kannada letters take three bytes in UTF-8 and two in UTF-16).
func TextBytes(s string) (wide bool, b []byte) {
	narrow := []byte(s)
	units := utf16.Encode([]rune(s))
	if len(units)*2 < len(narrow) {
		w := make([]byte, 0, len(units)*2)
		for _, u := range units {
			w = append(w, byte(u&255), byte(u>>8))
		}
		return true, w
	}
	return false, narrow
}

// CarriedLength is carriedLength(s): how many bytes a text costs in a summary.
func CarriedLength(s string) int { _, b := TextBytes(s); return len(b) }

// unsafeRune is summary.ts UNSAFE: control characters, the line and paragraph separators, the characters that change the direction text is drawn in, the zero-width space and the
// byte-order mark. ZWJ and ZWNJ (U+200C, U+200D) stay: Malayalam and Kannada need them.
func unsafeRune(r rune) bool {
	return r <= 0x1f || (r >= 0x7f && r <= 0x9f) || r == 0x200b || r == 0x2028 || r == 0x2029 || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069) || r == 0xfeff
}

// badText is `UNSAFE.test(v) || LONE_SURROGATE.test(v) || v !== v.trim() || /\s{2,}/u.test(v)`: text a summary never carries.
func badText(v string) bool {
	if !utf8.ValidString(v) || language.TrimJS(v) != v {
		return true
	}
	prevSpace := false
	for _, r := range v {
		if unsafeRune(r) {
			return true
		}
		sp := language.IsJSSpace(r)
		if sp && prevSpace {
			return true
		}
		prevSpace = sp
	}
	return false
}

var periodRe = regexp.MustCompile(`^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?(?:\.\.(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))?$`)

// IsPeriod is isPeriod: a month, a day, or a range of two days (and a range only between two days, first not after last).
func IsPeriod(period string) bool {
	m := periodRe.FindStringSubmatch(period)
	if m == nil {
		return false
	}
	if m[4] != "" && m[3] == "" {
		return false
	}
	if m[4] != "" && m[1]+"-"+m[2]+"-"+m[3] > m[4]+"-"+m[5]+"-"+m[6] {
		return false
	}
	return true
}

// FitText is fitText(text, maxBytes): on one line (every run of JavaScript whitespace one space), without control or direction-changing characters, costing at most maxBytes
// (CarriedLength). A longer text is cut at a whole grapheme cluster and ends with "…". The steps are the TypeScript's, in its order: whitespace runs, then unsafe characters, then
// invalid UTF-8 (its lone surrogates), then trim. (A removal can leave two spaces side by side, as in the TypeScript; encodeSummary then refuses the text.)
func FitText(text string, maxBytes int) string {
	var collapsed []rune // -1 stands for an invalid byte (a lone surrogate)
	inSpace := false
	for i := 0; i < len(text); {
		r, n := utf8.DecodeRuneInString(text[i:])
		i += n
		if r == utf8.RuneError && n == 1 {
			collapsed = append(collapsed, -1)
			inSpace = false
			continue
		}
		if language.IsJSSpace(r) {
			if !inSpace {
				collapsed = append(collapsed, ' ')
			}
			inSpace = true
			continue
		}
		inSpace = false
		collapsed = append(collapsed, r)
	}
	var b strings.Builder
	for _, r := range collapsed {
		if r >= 0 && !unsafeRune(r) {
			b.WriteRune(r)
		}
	}
	plain := language.TrimJS(b.String())
	if CarriedLength(plain) <= maxBytes {
		return plain
	}
	out := ""
	for _, g := range Graphemes(plain) {
		if CarriedLength(out+g+ellipsis) > maxBytes {
			break
		}
		out += g
	}
	return strings.TrimRightFunc(out, language.IsJSSpace) + ellipsis
}

// ---- base64url, one spelling only ----

const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

// ToBase64url is toBase64url: base64url without padding.
func ToBase64url(b []byte) string {
	var out strings.Builder
	for i := 0; i < len(b); i += 3 {
		n := int(b[i]) << 16
		if i+1 < len(b) {
			n |= int(b[i+1]) << 8
		}
		if i+2 < len(b) {
			n |= int(b[i+2])
		}
		chars := min(4, ((len(b)-i)*8+5)/6)
		for c := 0; c < chars; c++ {
			out.WriteByte(b64[(n>>(18-6*c))&63])
		}
	}
	return out.String()
}

// FromBase64url is fromBase64url: refused unless it is exactly what ToBase64url writes for the bytes it gives (no stray bits in the last character, no padding).
func FromBase64url(text string) ([]byte, error) {
	if language.UTF16Len(text)%4 == 1 {
		return nil, sErr("The link is cut short or has an extra character.")
	}
	out := []byte{}
	bits, value := 0, 0
	for _, ch := range text {
		v := strings.IndexRune(b64, ch)
		if v < 0 {
			return nil, sErr("The link has a character that cannot be in it.")
		}
		value = (value<<6 | v) & 0xffff // only the last bits matter; the mask keeps the number small
		bits += 6
		if bits >= 8 {
			bits -= 8
			out = append(out, byte((value>>bits)&255))
		}
	}
	if ToBase64url(out) != text {
		return nil, sErr("The link has been changed: one of its characters is not as it was written.")
	}
	return out, nil
}

func hexOf(b []byte) string {
	const d = "0123456789abcdef"
	out := make([]byte, 0, len(b)*2)
	for _, c := range b {
		out = append(out, d[c>>4], d[c&15])
	}
	return string(out)
}

func bytesOfHex(hexText string, length int, what string) ([]byte, error) {
	ok := len(hexText) == length*2
	for i := 0; ok && i < len(hexText); i++ {
		c := hexText[i]
		ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')
	}
	if !ok {
		return nil, sErr("%s must be %d lower-case hex digits.", what, length*2)
	}
	out := make([]byte, length)
	for i := range out {
		out[i] = hexVal(hexText[2*i])<<4 | hexVal(hexText[2*i+1])
	}
	return out, nil
}

// ---- the payload ----

// EncodeSummary is encodeSummary: the bytes of a summary. It refuses anything the format cannot carry and never cuts or changes what it is given (SummaryOf fits the texts first).
func EncodeSummary(s PaperSummary) ([]byte, error) {
	var out []byte
	text := func(value string, max int, what string, allowEmpty bool) error {
		if badText(value) {
			return sErr("%s must be one line of text with no control characters.", what)
		}
		wide, b := TextBytes(value)
		if len(b) > max || (!allowEmpty && len(b) == 0) {
			lo := "1"
			if allowEmpty {
				lo = "0"
			}
			return sErr("%s must cost %s to %d bytes.", what, lo, max)
		}
		head := byte(len(b))
		if wide {
			head |= wideBit
		}
		out = append(out, head)
		out = append(out, b...)
		return nil
	}
	if s.Layout < 1 || s.Layout > 255 {
		return nil, sErr("The layout is a number from 1 to 255.")
	}
	layout := LayoutOf(s.Layout)
	source := -1
	for i, x := range SummarySources {
		if x == s.Source {
			source = i
		}
	}
	if source < 0 {
		return nil, sErr("The source is one of %s.", strings.Join(SummarySources, ", "))
	}
	if !IsPeriod(s.Period) {
		return nil, sErr(`"%s" is not a period: write 2026-11, 2026-11-03 or 2026-11-01..2026-11-15.`, s.Period)
	}
	if len(s.Figures) > MaxFigures {
		return nil, sErr("A summary carries at most %d figures.", MaxFigures)
	}
	if layout != nil && len(s.Figures) != len(layout.Figures) {
		return nil, sErr("Layout %d carries %d figures, not %d.", s.Layout, len(layout.Figures), len(s.Figures))
	}
	for _, n := range s.Figures {
		if n < 0 || n > 1<<53-1 {
			return nil, sErr("A figure is a whole number of 0 or more (got %d).", n)
		}
	}
	flags := byte(0)
	if s.OwnerMarked {
		flags = ownerMarkedBit
	}
	out = append(out, byte(s.Layout), byte(source), flags, byte(len(s.Period)))
	out = append(out, s.Period...) // ASCII digits and dashes: never shorter in UTF-16
	if err := text(s.Pathway, MaxPathway, "The agent's name", false); err != nil {
		return nil, err
	}
	if err := text(s.Shop, MaxShopBytes, "The shop's name", false); err != nil {
		return nil, err
	}
	if err := text(s.By, MaxByBytes, "Who set it up", true); err != nil {
		return nil, err
	}
	out = append(out, byte(len(s.Figures)))
	for _, n := range s.Figures { // unsigned LEB128: seven bits at a time, low bits first
		for n >= 128 {
			out = append(out, byte(n%128)|128)
			n /= 128
		}
		out = append(out, byte(n))
	}
	hint, err := bytesOfHex(s.KeyHint, KeyHintBytes, "The key hint")
	if err != nil {
		return nil, err
	}
	out = append(out, hint...)
	if !sha256Re.MatchString(s.Digest) {
		return nil, sErr("The digest is sha256: and 64 hex digits.")
	}
	d, err := bytesOfHex(s.Digest[len("sha256:"):], digestBytes, "The digest")
	if err != nil {
		return nil, err
	}
	return append(out, d...), nil
}

// DecodeSummary is decodeSummary: a summary from its bytes, refusing anything EncodeSummary would not have written exactly so. The layout may be one this build does not know.
func DecodeSummary(b []byte) (PaperSummary, error) {
	at := 0
	var failure error
	fail := func(f string, a ...any) { // the first failure wins, as the first throw does
		if failure == nil {
			failure = sErr(f, a...)
		}
	}
	need := func(n int) bool {
		if failure != nil {
			return false
		}
		if at+n > len(b) {
			fail("The summary is cut short.")
			return false
		}
		return true
	}
	byteAt := func() int {
		if !need(1) {
			return 0
		}
		at++
		return int(b[at-1])
	}
	take := func(n int) []byte {
		if !need(n) {
			return nil
		}
		at += n
		return b[at-n : at]
	}
	text := func(max int, what string, allowEmpty bool) string {
		head := byteAt()
		if failure != nil {
			return ""
		}
		wide := head&wideBit != 0
		length := head &^ wideBit
		if length > max || (!allowEmpty && length == 0) || (wide && length%2 != 0) {
			fail("%s has the wrong length.", what)
			return ""
		}
		raw := take(length)
		if failure != nil {
			return ""
		}
		var value string
		if wide {
			units := make([]uint16, len(raw)/2)
			for i := range units {
				units[i] = uint16(raw[2*i]) | uint16(raw[2*i+1])<<8
			}
			for i := 0; i < len(units); i++ { // fatal: an unpaired surrogate is not text
				u := units[i]
				switch {
				case u >= 0xd800 && u <= 0xdbff:
					if i+1 >= len(units) || units[i+1] < 0xdc00 || units[i+1] > 0xdfff {
						fail("%s is not text.", what)
						return ""
					}
					i++
				case u >= 0xdc00 && u <= 0xdfff:
					fail("%s is not text.", what)
					return ""
				}
			}
			value = string(utf16.Decode(units))
		} else {
			if !utf8.Valid(raw) {
				fail("%s is not text.", what)
				return ""
			}
			value = string(raw)
		}
		if badText(value) {
			fail("%s has characters a summary never carries.", what)
			return ""
		}
		if w, _ := TextBytes(value); w != wide {
			fail("%s is written in the longer of its two encodings, which the format never does.", what)
			return ""
		}
		return value
	}

	var s PaperSummary
	s.Layout = byteAt()
	if failure == nil && s.Layout == 0 {
		fail("The layout is 1 to 255.")
	}
	sourceByte := byteAt()
	if failure == nil {
		if sourceByte >= len(SummarySources) {
			fail("The source is not one this format knows.")
		} else {
			s.Source = SummarySources[sourceByte]
		}
	}
	flags := byteAt()
	if failure == nil && flags&^ownerMarkedBit != 0 {
		fail("The summary has a flag this format does not know.")
	}
	s.OwnerMarked = flags&ownerMarkedBit != 0
	s.Period = text(22, "The period", false) // "2026-11-01..2026-11-15" is the longest
	if failure == nil && !IsPeriod(s.Period) {
		fail("The period is not a month, a day or a range of days.")
	}
	s.Pathway = text(MaxPathway, "The agent's name", false)
	s.Shop = text(MaxShopBytes, "The shop's name", false)
	s.By = text(MaxByBytes, "Who set it up", true)
	howMany := byteAt()
	if failure == nil && howMany > MaxFigures {
		fail("The summary has too many figures.")
	}
	if known := LayoutOf(s.Layout); failure == nil && known != nil && howMany != len(known.Figures) {
		fail("Layout %d carries %d figures, not %d.", s.Layout, len(known.Figures), howMany)
	}
	s.Figures = []int64{}
	for i := 0; i < howMany && failure == nil; i++ {
		var value, scale uint64 = 0, 1
		for k := 0; failure == nil; k++ {
			if k == 8 {
				fail("A figure is too large.")
				break
			}
			c := byteAt()
			if failure != nil {
				break
			}
			value += uint64(c&127) * scale
			scale *= 128
			if c&128 == 0 {
				if c == 0 && k > 0 {
					fail("A figure is written in more bytes than it needs.") // a last byte of 0 adds nothing: not the one spelling
				}
				break
			}
		}
		if failure == nil && value > 1<<53-1 {
			fail("A figure is too large.")
		}
		s.Figures = append(s.Figures, int64(value))
	}
	s.KeyHint = hexOf(take(KeyHintBytes))
	s.Digest = "sha256:" + hexOf(take(digestBytes))
	if failure == nil && at != len(b) {
		fail("The summary has bytes after its end.")
	}
	if failure != nil {
		return PaperSummary{}, failure
	}
	return s, nil
}

// SignedBytes is signedBytes(payload): the domain, then the payload exactly as carried.
func SignedBytes(payload []byte) []byte { return append([]byte(SummaryDomain), payload...) }

// SummaryLinkOf is summaryLinkOf: `https://geometer.dev/verify/#s1.<payload>.<signature>`.
func SummaryLinkOf(payload, signature []byte) (string, error) {
	if len(signature) != SignatureBytes {
		return "", sErr("A signature is %d bytes.", SignatureBytes)
	}
	return VerifyPage + "#" + SummaryVersion + "." + ToBase64url(payload) + "." + ToBase64url(signature), nil
}

// ReadSummary is what a link carries, read but NOT yet checked: the signature must be verified over Signed before anything in Summary is shown as genuine.
type ReadSummary struct {
	Payload, Signature, Signed []byte
	Summary                    PaperSummary
}

// ReadSummaryLink is readSummaryLink: the whole address, or what follows its "#" (with or without it). Anything after a "&" is ignored. The error is a *SummaryError, in plain words.
func ReadSummaryLink(link string) (ReadSummary, error) {
	fragment := link
	if i := strings.Index(link, "#"); i >= 0 {
		fragment = link[i+1:]
	}
	fragment, _, _ = strings.Cut(fragment, "&")
	parts := strings.Split(fragment, ".")
	if parts[0] != SummaryVersion {
		return ReadSummary{}, sErr("This is not a summary link this page can read (it does not start with s1).")
	}
	if len(parts) != 3 {
		return ReadSummary{}, sErr("The link is cut short or has extra parts.")
	}
	payload, err := FromBase64url(parts[1])
	if err != nil {
		return ReadSummary{}, err
	}
	signature, err := FromBase64url(parts[2])
	if err != nil {
		return ReadSummary{}, err
	}
	if len(signature) != SignatureBytes {
		return ReadSummary{}, sErr("The signature in the link is not the right length.")
	}
	sum, err := DecodeSummary(payload)
	if err != nil {
		return ReadSummary{}, err
	}
	return ReadSummary{Payload: payload, Signature: signature, Signed: SignedBytes(payload), Summary: sum}, nil
}

// IsSummaryLink is isSummaryLink: an s1 summary rather than one of the older forms. It says nothing about whether it is genuine.
func IsSummaryLink(link string) bool {
	if i := strings.Index(link, "#"); i >= 0 {
		link = link[i+1:]
	}
	return strings.HasPrefix(link, SummaryVersion+".")
}

// LabelledFigure is a figure with its id and kind.
type LabelledFigure struct {
	ID    string
	Kind  string
	Value int64
}

// LabelledFigures is labelledFigures: nil for a layout this build does not know (the page then shows no figures, never a guess).
func LabelledFigures(s PaperSummary) []LabelledFigure {
	l := LayoutOf(s.Layout)
	if l == nil || len(l.Figures) != len(s.Figures) {
		return nil
	}
	out := make([]LabelledFigure, len(l.Figures))
	for i, f := range l.Figures {
		out[i] = LabelledFigure{f.ID, f.Kind, s.Figures[i]}
	}
	return out
}

// AsSummaryError says whether err is a *SummaryError (errors.As, for callers).
func AsSummaryError(err error) (*SummaryError, bool) {
	var se *SummaryError
	ok := errors.As(err, &se)
	return se, ok
}
