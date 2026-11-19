// The owner's replies about payments the owner marks: modules/payments/owner-marked/owner.ts. "received", "refunded" and "kept", each with a one-use code (ledger.go), read from a
// tapped reply button (its id carries the code) or from typed words. Only a message from the owner's own number ever reaches this: the agent checks the sender first.
//
// The code uses the approvals' alphabet (no 0/O, 1/I/L, no hyphen), so it can never be read as a booking or fee reference. The words are English on purpose.
//
// Where Go and JavaScript differ: the expressions are the TypeScript's own with the `iu` flags as (?i); JavaScript's `\s` is spelled out as language.JSSpace (RE2's is ASCII only);
// `\d` is ASCII in both. The amount is read as the TypeScript does: rupees times 100 plus the pence, the pence padded on the right ("1.5" is 50 paise), as a float64 `Number` would
// hold them up to 2^53 (a longer run of digits is a huge amount, which markReceived calls bad).
package ownermarked

import (
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// CodePattern is approvals/code.ts CODE_PATTERN: 4 to 6 characters of the alphabet, typed in any case.
const CodePattern = "[A-HJKMNP-Za-hjkmnp-z2-9]{4,6}"

// The reply kinds and the reply buttons' ids (owner.ts MARK_BUTTON). The ids keep their "upi-" names: messages already sent carry them.
const (
	ReplyReceived = "received"
	ReplyRefunded = "refunded"
	ReplyKept     = "kept"
)

var buttonName = map[string]string{ReplyReceived: "upi-received", ReplyRefunded: "upi-refunded", ReplyKept: "upi-kept"}

// MarkButtonID is markButtonId: a button carries one action and one code, so a tap can only act on the request it was sent for. kind is ReplyReceived, ReplyRefunded or ReplyKept.
func MarkButtonID(kind, code string) string { return buttonName[kind] + ":" + code }

// MarkReply is owner.ts MarkReply. AmountPaise is set (non-nil) only on "received" when the owner typed another amount; left out, it means exactly what is still asked.
type MarkReply struct {
	Kind        string
	Code        string
	AmountPaise *int64
}

var (
	sp         = "[" + language.JSSpace + "]"
	buttonRe   = regexp.MustCompile(`^(upi-received|upi-refunded|upi-kept):(` + CodePattern + `)$`)
	receivedRe = regexp.MustCompile(`(?i)^` + sp + `*(?:received|recieved|got|paid)` + sp + `+(` + CodePattern + `)(?:` + sp + `+(?:rs\.?|inr|₹)?` + sp + `*(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d{1,2}))?)?` + sp + `*$`)
	refundedRe = regexp.MustCompile(`(?i)^` + sp + `*(refunded|returned|kept)` + sp + `+(` + CodePattern + `)` + sp + `*$`)
)

// ParseMarkReply is parseMarkReply: an owner's message that marks a payment or a refund, or nil. replyID is the tapped button's id ("" when none).
func ParseMarkReply(text, replyID string) *MarkReply {
	if replyID != "" {
		// the button's expression has no `i` flag in the TypeScript: the id is matched as it is, and the code is upper-cased after
		if b := buttonRe.FindStringSubmatch(replyID); b != nil {
			code := strings.ToUpper(b[2])
			switch b[1] {
			case "upi-received":
				return &MarkReply{Kind: ReplyReceived, Code: code}
			case "upi-refunded":
				return &MarkReply{Kind: ReplyRefunded, Code: code}
			}
			return &MarkReply{Kind: ReplyKept, Code: code}
		}
	}
	if m := receivedRe.FindStringSubmatch(text); m != nil {
		code := strings.ToUpper(m[1])
		if m[2] == "" {
			return &MarkReply{Kind: ReplyReceived, Code: code}
		}
		rupees, err := strconv.ParseFloat(strings.ReplaceAll(m[2], ",", ""), 64)
		pence := 0.0
		if m[3] != "" {
			pence, _ = strconv.ParseFloat(m[3]+strings.Repeat("0", 2-len(m[3])), 64)
		}
		paise := rupees*100 + pence
		// a run of digits too long for a whole number of paise is still a (huge) amount in JavaScript, which markReceived then calls bad: never "no amount", which would mark what is asked
		if err != nil || paise >= 1<<62 || math.IsInf(paise, 0) {
			big := int64(math.MaxInt64)
			return &MarkReply{Kind: ReplyReceived, Code: code, AmountPaise: &big}
		}
		p := int64(paise)
		return &MarkReply{Kind: ReplyReceived, Code: code, AmountPaise: &p}
	}
	if m := refundedRe.FindStringSubmatch(text); m != nil {
		kind := ReplyRefunded
		if strings.ToLower(m[1]) == "kept" {
			kind = ReplyKept
		}
		return &MarkReply{Kind: kind, Code: strings.ToUpper(m[2])}
	}
	return nil
}
