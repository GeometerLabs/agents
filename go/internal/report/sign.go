// Sealing and checking a report or certificate: modules/report/sign.ts. The signed bytes are "geo-document/1\n" and the canonical JSON of `document`; the digest is the sha256 of the
// canonical JSON alone; Ed25519 signs the bytes above (deterministic, so a Go signature equals the TypeScript's byte for byte and the tests compare them). The file on disk is the
// canonical JSON of the whole envelope plus one newline, so a re-spaced file fails "not in canonical form" instead of passing while its numbers still parse.
//
// What a signature shows: whoever holds the key signed exactly these bytes and they have not changed. It does not show the numbers are true, and a key found inside the file
// says nothing about who holds it. keys.ts (the command that makes a key pair) is not ported: only a command line uses it, and the shop's runtime never makes keys.
//
// Differences from the TypeScript, all at the edges: VerifyEnvelopeText reads the file with encoding/json, so when the text is not JSON the first check's detail carries Go's
// message, not V8's; and a JSON string holding a lone surrogate escape (\ud800) reads as U+FFFD here, so such a file is refused as "not in canonical form" where the TypeScript
// could accept it (the TypeScript never writes one).
package report

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"slices"
	"strconv"
)

// Format is the envelope's format string; SignedPrefix the domain before the signed bytes.
const (
	Format       = "geometer-document/1"
	SignedPrefix = "geo-document/1\n"
)

// Signature is an envelope's signature: the key id ("key:" and the sha256 of the raw public key), the raw 32-byte public key in hex, and the 64-byte signature in hex.
type Signature struct {
	Algorithm string
	KeyID     string
	PublicKey string
	Value     string
}

// Envelope is a sealed document. Signature is nil for an unsigned one.
type Envelope struct {
	Format    string
	Document  any
	Digest    string
	Code      string
	Signature *Signature
}

// Tree is the envelope as a JSON tree (what canonicalJson writes), for CanonicalJSON and the files.
func (e Envelope) Tree() map[string]any {
	var sig any
	if e.Signature != nil {
		sig = map[string]any{"algorithm": e.Signature.Algorithm, "keyId": e.Signature.KeyID, "publicKey": e.Signature.PublicKey, "value": e.Signature.Value}
	}
	return map[string]any{"format": e.Format, "document": e.Document, "digest": e.Digest, "code": e.Code, "signature": sig}
}

func signedBytes(document any) []byte { return []byte(SignedPrefix + CanonicalJSON(document)) }

// PublicKeyHex is publicKeyHex(key): the raw public key in hex.
func PublicKeyHex(key ed25519.PrivateKey) string {
	return hex.EncodeToString(key.Public().(ed25519.PublicKey))
}

// KeyIDOf is keyIdOf(publicKey): "key:" and the sha256 of the raw public key bytes.
func KeyIDOf(publicKey string) string {
	raw, _ := hex.DecodeString(publicKey) // Buffer.from(hex, "hex") likewise stops at the first bad pair; every caller checks the 64 hex digits first
	return "key:" + SHA256(raw)[len("sha256:"):]
}

// LoadPrivateKey reads a PEM PKCS#8 Ed25519 key from the file the caller names (loadPrivateKey). A key other people can read is refused, as ssh does.
func LoadPrivateKey(path string) (ed25519.PrivateKey, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("There is no key file at %s. Make one with: node templates/commerce/bookings/scripts/report-key.ts <a folder outside the repository>", path)
	}
	if mode := st.Mode().Perm(); mode&0o077 != 0 {
		return nil, fmt.Errorf("The key file %s can be read by other people (mode %s). Run: chmod 600 %s", path, strconv.FormatUint(uint64(mode), 8), path)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil, errors.New("the key file is not PEM")
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := k.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("%s is not an Ed25519 key.", path)
	}
	return key, nil
}

// Seal makes an envelope: the digest and code always, and a signature when a key is given (nil key: unsigned).
func Seal(document any, key ed25519.PrivateKey) Envelope {
	digest := DigestOf(document)
	code, err := VerificationCode(digest)
	if err != nil {
		panic(err) // a digest this file just made is always whole
	}
	e := Envelope{Format: Format, Document: document, Digest: digest, Code: code}
	if key != nil {
		pub := PublicKeyHex(key)
		e.Signature = &Signature{Algorithm: "ed25519", KeyID: KeyIDOf(pub), PublicKey: pub, Value: hex.EncodeToString(ed25519.Sign(key, signedBytes(document)))}
	}
	return e
}

// EnvelopeFile is the exact bytes to write to a file: the envelope's canonical JSON and one newline.
func EnvelopeFile(e Envelope) string { return CanonicalJSON(e.Tree()) + "\n" }

// ---- checking ----

// Check is one line of a verification.
type Check struct {
	Name   string
	OK     bool
	Detail string
}

// Verification is verifyEnvelopeText's answer. KeyID is nil when there is none (an unsigned file, or one refused before the signature was read).
type Verification struct {
	Unchanged  bool // everything that was checked passed; says nothing about whether the numbers are true
	Signed     bool
	Trusted    bool // signed by a key the caller named; false when none was named
	KeyID      *string
	Checks     []Check
	NotChecked []string
	Summary    string
	Envelope   *Envelope // nil when the file was refused before it was read as an envelope
}

var (
	sha256Re = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	hex64Re  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	hex128Re = regexp.MustCompile(`^[0-9a-f]{128}$`)
	envKeys  = []string{"code", "digest", "document", "format", "signature"}
	sigKeys  = []string{"algorithm", "keyId", "publicKey", "value"}
)

func sameKeys(o map[string]any, keys []string) bool {
	got := make([]string, 0, len(o))
	for k := range o {
		got = append(got, k)
	}
	sortUTF16(got)
	return slices.Equal(got, keys)
}

func str(m map[string]any, k string) (string, bool) { s, ok := m[k].(string); return s, ok }

// VerifyEnvelopeText checks the text of a report or certificate file (verifyEnvelopeText). trust lists key ids the caller trusts.
func VerifyEnvelopeText(text string, trust []string) Verification {
	var checks []Check
	notChecked := []string{"That the numbers are true. That needs the record itself and the payment, calendar and WhatsApp services' own records."}
	fail := func(summary string) Verification {
		return Verification{Checks: checks, NotChecked: notChecked, Summary: summary}
	}
	record := func(name string, ok bool, detail string) bool {
		checks = append(checks, Check{name, ok, detail})
		return ok
	}

	var parsed any
	dec := json.NewDecoder(bytes.NewReader([]byte(text)))
	dec.UseNumber()
	err := dec.Decode(&parsed)
	if err == nil {
		if _, e2 := dec.Token(); e2 != io.EOF {
			err = errors.New("unexpected data after the JSON document")
		}
	}
	if err != nil {
		record("The file is one JSON document", false, fmt.Sprintf("It cannot be read as JSON (%s).", err.Error()))
		return fail("This file has been changed or is not a report or certificate. Do not rely on it.")
	}
	record("The file is one JSON document", true, "It reads as JSON.")
	if !record("The file is in the one canonical form, byte for byte", CanonicalJSON(parsed)+"\n" == text, "A document is written with sorted keys, no spaces and one newline at the end. Any other spelling, even with the same numbers, is refused.") {
		return fail("The file is not in the exact form it was issued in, so something in it has been changed. Do not rely on it.")
	}
	obj, isObj := parsed.(map[string]any)
	if !record("It has the fields of a report or certificate, and no others", isObj && sameKeys(obj, envKeys) && obj["format"] == Format, fmt.Sprintf(`Expected exactly: code, digest, document, format, signature, with format "%s".`, Format)) {
		return fail("This is not a Geometer report or certificate file. Do not rely on it.")
	}
	env := Envelope{Format: Format, Document: obj["document"]}
	env.Digest, _ = str(obj, "digest")
	env.Code, _ = str(obj, "code")
	_, digestIsString := obj["digest"].(string)
	_, codeIsString := obj["code"].(string)

	digestOk := record("The digest matches the document", digestIsString && env.Digest == DigestOf(env.Document), "The sha256 of the document's canonical bytes was worked out again and compared with the digest written in the file.")
	codeOk := false
	if digestIsString && sha256Re.MatchString(env.Digest) && codeIsString {
		want, _ := VerificationCode(env.Digest)
		codeOk = env.Code == want
	}
	record("The short code matches the digest", codeOk, "The code is worked out from the digest again.")

	signed, signatureOk := false, true
	var keyID *string
	switch sig := obj["signature"].(type) {
	case nil:
		record("Signature", true, "There is no signature in this file.")
		notChecked = append(notChecked, "Who issued it. This file is not signed, so only the digest could be checked.")
	case map[string]any:
		alg, _ := str(sig, "algorithm")
		pub, pubOK := str(sig, "publicKey")
		val, valOK := str(sig, "value")
		kid, kidOK := str(sig, "keyId")
		if !sameKeys(sig, sigKeys) || alg != "ed25519" || !pubOK || !hex64Re.MatchString(pub) || !valOK || !hex128Re.MatchString(val) || !kidOK {
			signatureOk = record("The signature has the right fields", false, "Expected exactly algorithm, keyId, publicKey, value, an Ed25519 signature.")
			break
		}
		signed = true
		keyID = &kid
		env.Signature = &Signature{Algorithm: alg, KeyID: kid, PublicKey: pub, Value: val}
		idOk := record("The key id matches the public key in the file", KeyIDOf(pub) == kid, "The key id is worked out from the public key again.")
		rawPub, _ := hex.DecodeString(pub)
		rawSig, _ := hex.DecodeString(val)
		valid := ed25519.Verify(ed25519.PublicKey(rawPub), signedBytes(env.Document), rawSig)
		sigOk := record("The signature is valid for this document and this key", valid, "Ed25519 over the document's canonical bytes with the key written in the file.")
		signatureOk = idOk && sigOk
	default:
		signatureOk = record("The signature has the right fields", false, "Expected exactly algorithm, keyId, publicKey, value, an Ed25519 signature.")
	}

	unchanged := digestOk && codeOk && signatureOk
	trusted := false
	if len(trust) > 0 {
		trusted = signed && signatureOk && keyID != nil && slices.Contains(trust, *keyID)
		switch {
		case trusted:
			record("Signed by a key you trust", true, fmt.Sprintf("The signing key is %s, which you named.", *keyID))
		case signed:
			record("Signed by a key you trust", false, fmt.Sprintf("The signing key is %s, which is not one you named.", *keyID))
		default:
			record("Signed by a key you trust", false, "The file is not signed.")
		}
	} else if signed {
		notChecked = append(notChecked, fmt.Sprintf("Who holds %s. A key written inside a file proves nothing about who it belongs to: anyone can change a document and sign it again with their own key. Name a key you trust with --trust-key to check this.", *keyID))
	}
	v := Verification{Unchanged: unchanged, Signed: signed, Trusted: trusted, KeyID: keyID, Checks: checks, Envelope: &env}
	if !unchanged {
		v.NotChecked = notChecked
		v.Summary = "Something in this file has been changed, or the signature does not fit. Do not rely on it."
		return v
	}
	if doc, ok := env.Document.(map[string]any); ok {
		if a, has := doc["anchor"]; has && a == nil {
			notChecked = append(notChecked, "Guard's ledger. This document has no ledger anchor yet, so nothing links it to Guard's hash-chained record.")
		}
	}
	v.NotChecked = notChecked
	switch {
	case !signed:
		v.Summary = "Unchanged since the digest was made, but this file is not signed, so it does not show who issued it."
	case len(trust) == 0:
		v.Summary = fmt.Sprintf("Unchanged since %s signed it. This does not show who holds that key, and it does not show the numbers are true.", *keyID)
	case trusted:
		v.Summary = fmt.Sprintf("Unchanged since a key you trust (%s) signed it. This does not show the numbers are true.", *keyID)
	default:
		v.Summary = fmt.Sprintf("Unchanged since %s signed it, but that is not a key you named as trusted.", *keyID)
	}
	return v
}
