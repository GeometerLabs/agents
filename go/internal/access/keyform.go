package access

// The stored form of a passkey (a JWK, as the TypeScript runtimes store it), for the other file that keeps passkeys: the chat guests' identity (internal/chatid). One writing of the
// conversion in both directions, so a key kept for the owner and a key kept for a guest are the same text.

import "encoding/json"

// StoredKey turns a COSE public key (ES256, EdDSA or RS256) into the JWK text the shop's store keeps, and its algorithm number.
func StoredKey(cose []byte) (text string, alg int, err error) {
	k, alg, err := jwkOfCose(cose)
	if err != nil {
		return "", 0, err
	}
	b, _ := json.Marshal(k)
	return string(b), alg, nil
}

// CoseOfStored is the other way, for a sign-in: the COSE key go-webauthn reads, from the stored JWK text and algorithm.
func CoseOfStored(text string, alg int) ([]byte, error) {
	var k jwk
	if err := json.Unmarshal([]byte(text), &k); err != nil {
		return nil, err
	}
	return coseOfJwk(k, alg)
}
