package guard

// Webhook signatures (modules/messaging/webhooks.ts hmacHex and sameHex), here because both the payment providers' webhooks and Meta's use them: the hex HMAC-SHA256 of the raw
// body, compared in constant time.

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"regexp"
)

// HMACHex is the hex HMAC-SHA256 of a raw body: how Meta and most payment providers sign a webhook.
func HMACHex(rawBody []byte, secret string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(rawBody)
	return hex.EncodeToString(m.Sum(nil))
}

var hexOnly = regexp.MustCompile(`^[0-9a-fA-F]+$`)

// SameHex compares two hex strings in constant time. A missing, short, long or non-hex value is simply false (`given` is nil when the header was absent).
func SameHex(expected string, given *string) bool {
	if given == nil || len(*given) != len(expected) || !hexOnly.MatchString(*given) {
		return false
	}
	a, _ := hex.DecodeString(expected)
	b, err := hex.DecodeString(*given)
	return err == nil && subtle.ConstantTimeCompare(a, b) == 1
}
