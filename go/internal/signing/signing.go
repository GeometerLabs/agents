// Package signing is the shop's own signing key and the documents it signs: the feed (shop-feed/1), the answer to "do you still have these?" (shop-check/1), the "my feed changed"
// notice and the Agent Card. It is the Go twin of modules/signing (canonical.ts, keys.ts, sign.ts, jws.ts) and must write the very same bytes: documents are signed over the
// RFC 8785 canonical JSON of the body with Ed25519, and a reader in TypeScript checks them. The key is kept as PKCS#8 DER in base64url, as the shop's store keeps it.
package signing

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/gowebpki/jcs"
)

// Key is the shop's Ed25519 key with the two names the documents carry: the public key (SPKI DER, base64url) and its id (SHA-256 of the raw key, base64url).
type Key struct {
	private   ed25519.PrivateKey
	PublicKey string
	KeyID     string
}

// spkiPrefix is the fixed start of an Ed25519 public key in SPKI DER form (the TypeScript side checks the same bytes).
var spkiPrefix = []byte{0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00}

var b64 = base64.RawURLEncoding

// Generate makes a new key and returns it with the text the store keeps (PKCS#8 DER, base64url).
func Generate() (*Key, string, error) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, "", err
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, "", err
	}
	text := b64.EncodeToString(der)
	k, err := FromText(text)
	return k, text, err
}

// FromText reads a key from the text the store keeps.
func FromText(text string) (*Key, error) {
	der, err := b64.DecodeString(text)
	if err != nil {
		return nil, errors.New("the shop key is not base64url")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, fmt.Errorf("the shop key is not PKCS#8: %w", err)
	}
	priv, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("the shop key is not an Ed25519 key")
	}
	raw := priv.Public().(ed25519.PublicKey)
	sum := sha256.Sum256(raw)
	return &Key{private: priv, PublicKey: b64.EncodeToString(append(append([]byte{}, spkiPrefix...), raw...)), KeyID: b64.EncodeToString(sum[:])}, nil
}

// Canonical writes a value as RFC 8785 canonical JSON. Like modules/signing/canonical.ts it refuses what has no canonical form here: a number that is not a whole number a
// double holds exactly (the formats have no floating point; money is a decimal string).
func Canonical(v any) ([]byte, error) {
	raw, err := marshal(v)
	if err != nil {
		return nil, err
	}
	if err := wholeNumbersOnly(raw); err != nil {
		return nil, err
	}
	return jcs.Transform(raw)
}

// marshal is json.Marshal without the HTML escaping (a title with "&" is the same text either way, but the plain form is what the other side writes).
func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// Marshal is the one way a document is turned into the bytes sent, so what is signed and what is served are written by the same encoder.
func Marshal(v any) ([]byte, error) { return marshal(v) }

func wholeNumbersOnly(raw []byte) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	for {
		tok, err := dec.Token()
		if err != nil {
			return nil // the end of the document
		}
		if n, ok := tok.(json.Number); ok {
			f, err := n.Float64()
			if err != nil || f != math.Trunc(f) || math.Abs(f) > 9007199254740991 {
				return fmt.Errorf("%s is not a safe integer (these formats have no floating-point numbers)", n)
			}
		}
	}
}

func (k *Key) sign(body any) (string, error) {
	c, err := Canonical(body)
	if err != nil {
		return "", err
	}
	return b64.EncodeToString(ed25519.Sign(k.private, c)), nil
}

// Signature is the member a signed feed or answer carries. Key is left out of answers (they name the key id only).
type Signature struct {
	Alg   string `json:"alg"`
	KeyID string `json:"keyId"`
	Key   string `json:"key,omitempty"`
	Sig   string `json:"sig"`
}

// SealFeed adds `signature {alg, keyId, key, sig}` to a feed body: signed over the canonical JSON of the body without it.
func (k *Key) SealFeed(body map[string]any) (map[string]any, error) { return k.seal(body, true) }

// SealAnswer is the same for a check answer, whose signature names the key id but does not carry the key.
func (k *Key) SealAnswer(body map[string]any) (map[string]any, error) { return k.seal(body, false) }

func (k *Key) seal(body map[string]any, withKey bool) (map[string]any, error) {
	sig, err := k.sign(body)
	if err != nil {
		return nil, err
	}
	s := Signature{Alg: "Ed25519", KeyID: k.KeyID, Sig: sig}
	if withKey {
		s.Key = k.PublicKey
	}
	out := make(map[string]any, len(body)+1)
	for key, v := range body {
		out[key] = v
	}
	out["signature"] = s
	return out, nil
}

// SealNotice adds `keyId` and `sig` to a notice: the key id is part of what is signed.
func (k *Key) SealNotice(body map[string]any) (map[string]any, error) {
	withID := make(map[string]any, len(body)+2)
	for key, v := range body {
		withID[key] = v
	}
	withID["keyId"] = k.KeyID
	sig, err := k.sign(withID)
	if err != nil {
		return nil, err
	}
	withID["sig"] = sig
	return withID, nil
}

// SignCard signs an Agent Card as a detached-payload JWS (EdDSA) in the card's own `signatures` member, as modules/signing/jws.ts does: the signing input is
// `<protected>.<base64url of the card's canonical JSON without signatures>`.
func (k *Key) SignCard(card map[string]any) (map[string]any, error) {
	body := make(map[string]any, len(card))
	for key, v := range card {
		if key != "signatures" {
			body[key] = v
		}
	}
	header := b64.EncodeToString([]byte(fmt.Sprintf(`{"alg":"EdDSA","typ":"JOSE","kid":%q}`, k.KeyID)))
	c, err := Canonical(body)
	if err != nil {
		return nil, err
	}
	input := header + "." + b64.EncodeToString(c)
	body["signatures"] = []map[string]string{{"protected": header, "signature": b64.EncodeToString(ed25519.Sign(k.private, []byte(input)))}}
	return body, nil
}
