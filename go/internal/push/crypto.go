package push

// Web push's two pieces of cryptography (modules/push/crypto.ts), with the standard library only:
//
//   - the message's encryption, RFC 8291 over RFC 8188's "aes128gcm" content coding: the push service carries only ciphertext, and only the browser that subscribed can read it;
//   - the shop's signature on each push, VAPID (RFC 8292): a short ES256 JWT for the push service's origin.
//
// Two signature encodings meet here on purpose, as in TypeScript: a JWT's ES256 signature is the raw 64 bytes (r then s), never the DER that crypto/ecdsa writes, so the DER is unpacked.
// The VAPID key is kept in the push store as the TypeScript runtime keeps it ({"privateJwk": {kty, crv, x, y, d}, "publicKey"}), so either runtime reads the other's.

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

var b64u = base64.RawURLEncoding

// decodeB64URL is Node's `Buffer.from(text, "base64url")`: lenient. It takes the standard alphabet too, ignores padding and any character outside the alphabet, and drops a last
// lone character. A browser's subscription keys are checked after this, so an odd one reads the same here as in the TypeScript runtime.
func decodeB64URL(s string) []byte {
	var clean strings.Builder
	for _, c := range s {
		switch {
		case c == '+':
			clean.WriteByte('-')
		case c == '/':
			clean.WriteByte('_')
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '-', c == '_':
			clean.WriteRune(c)
		}
	}
	t := clean.String()
	if len(t)%4 == 1 {
		t = t[:len(t)-1]
	}
	// Go's decoder, unlike Strict(), ignores non-zero trailing bits, as Node does; the text is clean now, so it cannot fail
	out, _ := b64u.DecodeString(t)
	return out
}

// IsUncompressedP256 is a P-256 public key as browsers give it: 65 bytes, 0x04 then x and y.
func IsUncompressedP256(key []byte) bool { return len(key) == 65 && key[0] == 0x04 }

// RecordSize is RFC 8188's record size the sender writes: one record carries the whole message (a push is at most about 4 KB).
const RecordSize = 4096

// MaxPlaintext is the longest message the sender encrypts: under the 4 KB push services take, after the 86-byte header, the delimiter and the tag.
const MaxPlaintext = 3000

// derive is RFC 8291's key schedule, then RFC 8188's content key and nonce from it.
func derive(secret, auth, uaPublic, asPublic, salt []byte) (key, nonce []byte, err error) {
	info := append(append([]byte("WebPush: info\x00"), uaPublic...), asPublic...)
	ikm, err := hkdf.Key(sha256.New, secret, auth, string(info), 32)
	if err != nil {
		return nil, nil, err
	}
	if key, err = hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16); err != nil {
		return nil, nil, err
	}
	nonce, err = hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	return key, nonce, err
}

// EncryptPush encrypts one push message for one subscription (p256dh: the browser's public key; auth: its 16-byte secret). A fresh sender key pair and salt every time. `padTo` pads
// the plaintext up to a multiple of that many bytes (crypto.ts does the same with 128), so the length the push service carries says less about the words. The result is the whole body: the
// header (salt, record size, the sender's public key) and the one record.
func EncryptPush(plaintext, p256dh, auth []byte, padTo int) ([]byte, error) {
	if !IsUncompressedP256(p256dh) {
		return nil, errors.New("The subscription's p256dh is not a P-256 public key.")
	}
	if len(auth) != 16 {
		return nil, errors.New("The subscription's auth secret is not 16 bytes.")
	}
	if len(plaintext) > MaxPlaintext {
		return nil, fmt.Errorf("A push message is at most %d bytes.", MaxPlaintext)
	}
	as, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return encryptWith(plaintext, p256dh, auth, padTo, as, salt)
}

// encryptWith is EncryptPush with the sender's key and the salt given: the one place the message is made, so the test can feed it RFC 8291's own example.
func encryptWith(plaintext, p256dh, auth []byte, padTo int, as *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	ua, err := ecdh.P256().NewPublicKey(p256dh)
	if err != nil {
		return nil, err
	}
	secret, err := as.ECDH(ua)
	if err != nil {
		return nil, err
	}
	asPublic := as.PublicKey().Bytes()
	key, nonce, err := derive(secret, auth, p256dh, asPublic, salt)
	if err != nil {
		return nil, err
	}
	pad := 0
	if padTo > 1 {
		pad = (padTo - ((len(plaintext) + 1) % padTo)) % padTo
	}
	// the last (and only) record: the words, the delimiter 0x02, then zeros
	record := append(append(append([]byte{}, plaintext...), 0x02), make([]byte, pad)...)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	sealed := gcm.Seal(nil, nonce, record, nil)
	head := make([]byte, 0, 16+4+1+len(asPublic))
	head = append(head, salt...)
	head = binary.BigEndian.AppendUint32(head, RecordSize)
	head = append(head, byte(len(asPublic)))
	head = append(head, asPublic...)
	return append(head, sealed...), nil
}

// ---- VAPID (RFC 8292) -------------------------------------------------------------------------------------------------------------------------------------

// PrivateJWK is the shop's VAPID private key as the store keeps it.
type PrivateJWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	D   string `json:"d"`
}

// VapidKeys is the shop's VAPID key pair: the private key as a JWK (kept only in the runtime's own data), the public key as browsers take it (65 bytes, base64url).
type VapidKeys struct {
	PrivateJWK PrivateJWK `json:"privateJwk"`
	PublicKey  string     `json:"publicKey"`
}

// NewVapidKeys makes a fresh key pair.
func NewVapidKeys() (VapidKeys, error) {
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return VapidKeys{}, err
	}
	pub, err := k.PublicKey.ECDH()
	if err != nil {
		return VapidKeys{}, err
	}
	raw := pub.Bytes() // 0x04 || x || y
	d := make([]byte, 32)
	k.D.FillBytes(d)
	return VapidKeys{PrivateJWK: PrivateJWK{Kty: "EC", Crv: "P-256", X: b64u.EncodeToString(raw[1:33]), Y: b64u.EncodeToString(raw[33:]), D: b64u.EncodeToString(d)}, PublicKey: b64u.EncodeToString(raw)}, nil
}

// VapidTTL is how long a signature lasts: RFC 8292 allows up to 24 hours; a shorter one leaks less if a push is ever logged on the way.
const VapidTTL = 12 * 60 * 60

// privateKey is the ecdsa key a stored JWK names.
func (v VapidKeys) privateKey() (*ecdsa.PrivateKey, error) {
	d, x, y := decodeB64URL(v.PrivateJWK.D), decodeB64URL(v.PrivateJWK.X), decodeB64URL(v.PrivateJWK.Y)
	if len(d) != 32 || len(x) != 32 || len(y) != 32 {
		return nil, errors.New("the VAPID key is not a P-256 key")
	}
	return &ecdsa.PrivateKey{PublicKey: ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}, D: new(big.Int).SetBytes(d)}, nil
}

// VapidHeader is the Authorization header's value for one push service: `vapid t=<JWT>, k=<public key>`. `audience` is the push service's origin; `subject` is how the service can
// reach whoever runs the sender: the shop's own page address (never a person's e-mail).
func VapidHeader(keys VapidKeys, audience, subject string, nowS int64) (string, error) {
	header := b64u.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	// JSON.stringify does not escape < > & as encoding/json does by default, and a subject is an address that may carry a query
	var claims bytes.Buffer
	enc := json.NewEncoder(&claims)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(struct {
		Aud string `json:"aud"`
		Exp int64  `json:"exp"`
		Sub string `json:"sub"`
	}{audience, nowS + VapidTTL, subject})
	signing := header + "." + b64u.EncodeToString(bytes.TrimRight(claims.Bytes(), "\n"))
	priv, err := keys.privateKey()
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256([]byte(signing))
	der, err := ecdsa.SignASN1(rand.Reader, priv, digest[:])
	if err != nil {
		return "", err
	}
	var rs struct{ R, S *big.Int }
	if _, err := asn1.Unmarshal(der, &rs); err != nil {
		return "", err
	}
	raw := make([]byte, 64)
	rs.R.FillBytes(raw[:32])
	rs.S.FillBytes(raw[32:])
	return fmt.Sprintf("vapid t=%s.%s, k=%s", signing, b64u.EncodeToString(raw), keys.PublicKey), nil
}

// ecdhPublic checks that 65 bytes are a point on P-256 (TypeScript's createPublicKey does the same), and gives the key.
func ecdhPublic(key []byte) (*ecdh.PublicKey, error) { return ecdh.P256().NewPublicKey(key) }
