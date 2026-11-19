// Package upi is a UPI payment request (modules/payments/providers/upi/link.ts): the shop's own UPI ID, its name, the exact amount and the reference, as a `upi://pay` link. Nothing
// here can see the payment (the customer pays the shop's own UPI ID from their own app): what this makes is the request the customer's app opens, pre-filled. The rules followed are
// NPCI's UPI Linking Specifications 1.6: `pa` and `pn` mandatory, `am` the amount in decimal, `cu` INR, `tn` a short note, a space written %20 and never +. `tr`, `mc`, `mode`, `orgid`
// and `sign` are left out on purpose (a merchant's signed request needs a bank account), so "paid" is the owner's word, not ours; the link never carries the owner's one-use code.
//
// The words of a problem (in English, settings errors the builder reads) are typed here and pinned by the vectors (testdata/upi-vectors.json), which the TypeScript wrote.
// What is NOT ported: the owner-marked ledger, obligations and desk (modules/payments/owner-marked), which are the state the Bookings runtime keeps for a UPI shop; see Deferred.md.
package upi

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
)

const (
	PayeeNameMax = 50      // the payee name is printed by the payer's app: short, on one line
	NoteMax      = 50      // a note longer than this is cut by many apps
	MaxAmountInr = 100_000 // the largest amount one request may be for, in rupees: a slip of the keyboard is caught
)

var vpaRE = regexp.MustCompile(`^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,64}$`)

// NormaliseVpa is the UPI ID as it is kept and shown: trimmed and in lower case (UPI IDs are not case-sensitive). JavaScript's toLowerCase is the full Unicode mapping.
func NormaliseVpa(vpa string) string {
	// U+0130 lower-cases to "i" + U+0307 in JavaScript (the full mapping) and to a bare "i" in Go's simple one. A final Greek sigma differs too (JavaScript writes the final form); no UPI ID
	// that holds one passes VpaProblem, so only the text shown back could differ, and it is left.
	return strings.ToLower(strings.ReplaceAll(language.TrimJS(vpa), "\u0130", "i\u0307"))
}

// VpaProblem is what is wrong with this UPI ID, in plain words, or "" when nothing is.
func VpaProblem(vpa string) string {
	if language.TrimJS(vpa) == "" {
		return "Add the shop's UPI ID, for example glowsalon@okicici."
	}
	v := NormaliseVpa(vpa)
	if !strings.Contains(v, "@") {
		return fmt.Sprintf("\"%s\" is not a UPI ID: it needs an @ and the app's or bank's name after it, for example glowsalon@okicici.", language.TrimJS(vpa))
	}
	if !vpaRE.MatchString(v) {
		return fmt.Sprintf("\"%s\" is not a UPI ID. Before the @: letters, digits, dots, dashes or underscores (at least 2). After the @: the app's or bank's name, letters and digits, starting with a letter.", language.TrimJS(vpa))
	}
	return ""
}

// PayeeProblem is what is wrong with this payee name, in plain words, or "". [\p{Cc}\n\r\t]: a control character, which includes the three named.
func PayeeProblem(name string) string {
	if language.TrimJS(name) == "" {
		return "Add the name the customer should see in their UPI app (the payee name), for example Glow Salon."
	}
	for _, r := range name {
		if unicode.Is(unicode.Cc, r) {
			return "The payee name must be on one line."
		}
	}
	if utf8.RuneCountInString(language.TrimJS(name)) > PayeeNameMax { // [...name.trim()].length counts code points
		return fmt.Sprintf("The payee name is longer than %d characters. Use the short name the shop's UPI app shows.", PayeeNameMax)
	}
	return ""
}

// AmountText is "200.00": the amount as `am` carries it, in rupees with two decimals.
func AmountText(amountPaise int64) (string, error) {
	if amountPaise <= 0 {
		return "", errors.New("A UPI request is for a whole number of paise above zero.")
	}
	return fmt.Sprintf("%d.%02d", amountPaise/100, amountPaise%100), nil
}

// encode is RFC 3986 percent-encoding of a value: a space is %20, and so are ! ' ( ) * which encodeURIComponent leaves. `keep` characters are put back as they are.
func encode(value, keep string) string {
	var b strings.Builder
	for _, c := range guard.EncodeURIComponent(value) {
		if strings.ContainsRune("!'()*", c) {
			b.WriteString("%" + strings.ToUpper(strconv.FormatInt(int64(c), 16)))
		} else {
			b.WriteRune(c)
		}
	}
	out := b.String()
	for _, c := range keep {
		out = strings.ReplaceAll(out, guard.EncodeURIComponent(string(c)), string(c))
	}
	return out
}

// Request holds the fields of one request.
type Request struct {
	Vpa         string // the shop's UPI ID
	Payee       string // the name the customer's app shows
	AmountPaise int64  // the exact amount
	Note        string // a short note: the booking or fee reference. Never the owner's code.
}

var spaces = regexp.MustCompile(`[` + language.JSSpace + `]+`)

// PayLink is upiPayLink: the `upi://pay` link for one request. It returns, in plain words, an error if a field is not one a UPI app would take.
func PayLink(r Request) (string, error) {
	if p := VpaProblem(r.Vpa); p != "" {
		return "", errors.New(p)
	}
	if p := PayeeProblem(r.Payee); p != "" {
		return "", errors.New(p)
	}
	if r.AmountPaise > MaxAmountInr*100 {
		return "", fmt.Errorf("A UPI request here is for at most ₹%d.", MaxAmountInr)
	}
	note := language.TrimJS(spaces.ReplaceAllString(r.Note, " "))
	if runes := []rune(note); len(runes) > NoteMax {
		note = string(runes[:NoteMax]) // [...].slice(0, NOTE_MAX).join(""): code points
	}
	am, err := AmountText(r.AmountPaise)
	if err != nil {
		return "", err
	}
	pairs := [][2]string{{"pa", encode(NormaliseVpa(r.Vpa), "@")}, {"pn", encode(language.TrimJS(r.Payee), "")}, {"am", am}, {"cu", "INR"}}
	if note != "" {
		pairs = append(pairs[:3], append([][2]string{{"tn", encode(note, "")}}, pairs[3:]...)...)
	}
	parts := make([]string, len(pairs))
	for i, p := range pairs {
		parts[i] = p[0] + "=" + p[1]
	}
	return "upi://pay?" + strings.Join(parts, "&"), nil
}
