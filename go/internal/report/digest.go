// Digests and the short verification code: modules/report/digest.ts. A digest is always the full sha256 of the canonical JSON bytes, written "sha256:<64 hex digits>" (the
// spelling geometer-verify uses); the short code is the first 40 bits of it in Crockford's base32, for finding a paper, never for trusting one.
package report

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
)

// SHA256 is sha256(bytes): "sha256:" and 64 lower-case hex digits.
func SHA256(b []byte) string {
	h := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(h[:])
}

// DigestOf is digestOf(value): the digest of the value's canonical JSON.
func DigestOf(v any) string { return SHA256([]byte(CanonicalJSON(v))) }

// Crockford's base32 without I, L, O or U: nothing easy to misread when read out or typed from paper.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

var digestRe = regexp.MustCompile(`^sha256:([0-9a-f]{64})$`)

// VerificationCode is verificationCode(digest): "7K2M-9QXD", from the first 40 bits (ten hex digits) of the digest. It returns an error for anything that is not a full digest.
func VerificationCode(digest string) (string, error) {
	m := digestRe.FindStringSubmatch(digest)
	if m == nil {
		return "", fmt.Errorf(`"%s" is not a sha256 digest.`, digest)
	}
	var bits uint64
	for _, c := range m[1][:10] {
		bits = bits<<4 | uint64(hexVal(byte(c)))
	}
	var code [8]byte
	for i := 7; i >= 0; i-- {
		code[i] = alphabet[bits&31]
		bits >>= 5
	}
	return string(code[:4]) + "-" + string(code[4:]), nil
}

func hexVal(c byte) byte {
	if c >= 'a' {
		return c - 'a' + 10
	}
	return c - '0'
}
