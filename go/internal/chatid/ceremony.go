package chatid

// The two WebAuthn ceremonies for a guest's thread (chat-identity.ts keepOptions, keep, signinOptions, signin): "keep this chat" makes a passkey bound to the thread, and signing in with it
// on another phone ties that phone's guest hash to the thread. Same checks as the owner's (internal/access/passkeys.go, which is the same library's use): attestation "none", the RP ID's
// hash, user presence AND user verification (the fingerprint or screen lock), the signature and the counter rule (a copied key shows itself by going back; a synced passkey that always says
// 0 is accepted). Sign-in asks for no list of credentials (a new phone has no cookie to say who it is), so the passkeys are discoverable (`residentKey: "required"`) and found by their id.

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/go-webauthn/webauthn/webauthn"
)

var enc = base64.RawURLEncoding

// guest is the one WebAuthn user a thread has: each thread has its OWN user id (the owner has one per shop): a shop has many customers, and one id per shop would make a second customer on
// the same phone replace the first one's passkey (a passkey is stored per RP ID and user id).
type guest struct {
	id    []byte
	name  string
	creds []webauthn.Credential
}

func (u guest) WebAuthnID() []byte                         { return u.id }
func (u guest) WebAuthnName() string                       { return u.name }
func (u guest) WebAuthnDisplayName() string                { return u.name }
func (u guest) WebAuthnCredentials() []webauthn.Credential { return u.creds }

var credParams = []protocol.CredentialParameter{
	{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgES256},
	{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgEdDSA},
	{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgRS256},
}

func relyingParty(rp RelyingParty, shop string) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{RPID: rp.RpID, RPDisplayName: shop, RPOrigins: []string{rp.Origin}})
}

var b64Text = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
var challengeText = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// b64 is a base64url member of the browser's answer, at most max characters, or false.
func b64(s any, max int) ([]byte, bool) {
	t, ok := s.(string)
	if !ok || t == "" || len(t) > max || !b64Text.MatchString(t) {
		return nil, false
	}
	b, err := enc.DecodeString(t)
	return b, err == nil
}

// challengeOf is the challenge the browser's client data names, if it is one of ours for this ceremony (and for this thread, at registration), unused and in time.
func (s *Store) challengeOf(clientData []byte, kind string, now int64, guestHash *string) string {
	var cd map[string]any
	if json.Unmarshal(clientData, &cd) != nil { // the member named exactly "challenge", as JSON.parse(...).challenge reads it
		return ""
	}
	c, ok := cd["challenge"].(string)
	if !ok || !challengeText.MatchString(c) {
		return ""
	}
	var k string
	var g sql.NullString
	var expires int64
	var used sql.NullInt64
	if s.db.QueryRow("SELECT kind, guest, expires_at, used_at FROM challenges WHERE hash = ?", challengeHash(c)).Scan(&k, &g, &expires, &used) != nil {
		return ""
	}
	if k != kind || used.Valid || expires <= now || (guestHash != nil && (!g.Valid || g.String != *guestHash)) {
		return ""
	}
	return c
}

// KeepOptions is what navigator.credentials.create is handed to keep THIS thread on the phone: a challenge bound to the thread, this thread's own user id, a discoverable key, the user
// verified.
func (s *Store) KeepOptions(hash string, rp RelyingParty, shopName string, now int64) (map[string]any, error) {
	g := s.Resolve(hash)
	rows, err := s.db.Query("SELECT cred_id FROM creds WHERE guest = ? AND rp_id = ?", g, rp.RpID)
	if err != nil {
		return nil, err
	}
	have := []map[string]any{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, err
		}
		have = append(have, map[string]any{"type": "public-key", "id": id})
	}
	_ = rows.Close()
	challenge, err := s.newChallenge("register", &g, now)
	if err != nil {
		return nil, err
	}
	uid, err := s.userID(g)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"challenge":        challenge,
		"rp":               map[string]any{"id": rp.RpID, "name": shopName},
		"user":             map[string]any{"id": uid, "name": shopName + " chat", "displayName": shopName + " chat"},
		"pubKeyCredParams": []map[string]any{{"type": "public-key", "alg": -7}, {"type": "public-key", "alg": -8}, {"type": "public-key", "alg": -257}},
		// no authenticatorAttachment: a phone's own lock, a synced passkey or another device are all fine. A key the phone can find again by itself (discoverable) is what a new phone signs in with.
		"authenticatorSelection": map[string]any{"residentKey": "required", "userVerification": "required"},
		"attestation":            "none", "timeout": ChallengeMs, "excludeCredentials": have,
	}, nil
}

// Keep finishes keeping the chat: the answer checked against the challenge made for THIS thread, then the key kept for it, in one transaction. The reason is the sentence a failure gives
// (never shown beyond "did not work"); a nil error with ok false is a refusal.
func (s *Store) Keep(hash string, rp RelyingParty, shopName string, response map[string]any, now int64) (ok bool, why string, err error) {
	g := s.Resolve(hash)
	clientData, ok1 := b64(response["clientDataJSON"], 4096)
	_, ok2 := b64(response["attestationObject"], 16_384)
	if !ok1 || !ok2 {
		return false, "The browser's answer is not complete.", nil
	}
	challenge := s.challengeOf(clientData, "register", now, &g)
	if challenge == "" {
		return false, "The answer is for no challenge of this chat that is still open.", nil
	}
	uidText, err := s.userID(g)
	if err != nil {
		return false, "", err
	}
	uid, _ := enc.DecodeString(uidText)
	// go-webauthn reads a whole PublicKeyCredential (with its id); the browser's answer carries the two members, so the id is taken from the attested credential data first
	raw, _ := json.Marshal(response)
	var att protocol.AuthenticatorAttestationResponse
	if json.Unmarshal(raw, &att) != nil {
		return false, "The browser's answer is not complete.", nil
	}
	parsedAtt, perr := att.Parse()
	if perr != nil {
		return false, perr.Error(), nil
	}
	credID := enc.EncodeToString(parsedAtt.AttestationObject.AuthData.AttData.CredentialID)
	full, _ := json.Marshal(map[string]any{"id": credID, "rawId": credID, "type": "public-key", "response": json.RawMessage(raw)})
	parsed, perr := protocol.ParseCredentialCreationResponseBytes(full)
	if perr != nil {
		return false, perr.Error(), nil
	}
	wa, perr := relyingParty(rp, shopName)
	if perr != nil {
		return false, perr.Error(), nil
	}
	cred, perr := wa.CreateCredential(guest{id: uid, name: shopName}, webauthn.SessionData{Challenge: challenge, RelyingPartyID: rp.RpID, UserID: uid, UserVerification: protocol.VerificationRequired, CredParams: credParams}, parsed)
	if perr != nil {
		return false, perr.Error(), nil
	}
	jwkText, alg, perr := access.StoredKey(cred.PublicKey)
	if perr != nil {
		return false, perr.Error(), nil
	}
	backed := 0
	if cred.Flags.BackupEligible {
		backed = 1
	}
	why = ""
	err = s.tx(func(x *sql.Tx) error {
		if r, err := x.Exec("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL", now, challengeHash(challenge)); err != nil {
			return err
		} else if n, _ := r.RowsAffected(); n != 1 {
			why = "That challenge was used already."
			return errRefused
		}
		var one int
		if x.QueryRow("SELECT 1 FROM creds WHERE cred_id = ?", credID).Scan(&one) == nil {
			why = "This passkey is already kept here."
			return errRefused
		}
		if _, err := x.Exec("INSERT INTO creds (id, cred_id, guest, jwk, alg, sign_count, backed_up, made_at, rp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			randomHex(6), credID, g, jwkText, alg, cred.Authenticator.SignCount, backed, now, rp.RpID); err != nil {
			return err
		}
		rows, err := x.Query("SELECT id FROM creds WHERE guest = ? ORDER BY coalesce(used_at, made_at) DESC", g)
		if err != nil {
			return err
		}
		var kept []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				_ = rows.Close()
				return err
			}
			kept = append(kept, id)
		}
		_ = rows.Close()
		if len(kept) > MaxKeysPerThread {
			for _, old := range kept[MaxKeysPerThread:] {
				if _, err := x.Exec("DELETE FROM creds WHERE id = ?", old); err != nil {
					return err
				}
			}
		}
		_, err = x.Exec("INSERT INTO phones (hash, guest, made_at) VALUES (?, ?, ?) ON CONFLICT(hash) DO UPDATE SET guest = excluded.guest, made_at = excluded.made_at", hash, g, now)
		return err
	})
	if err == errRefused {
		return false, why, nil
	}
	return err == nil, "", err
}

// SigninOptions is what navigator.credentials.get is handed: a challenge and NO list (a new phone cannot say who it is), the user verified, nothing restricting where the key lives.
func (s *Store) SigninOptions(rp RelyingParty, now int64) (map[string]any, error) {
	c, err := s.newChallenge("signin", nil, now)
	if err != nil {
		return nil, err
	}
	return map[string]any{"challenge": c, "rpId": rp.RpID, "userVerification": "required", "timeout": ChallengeMs, "allowCredentials": []any{}}, nil
}

// Signin finishes a sign-in from this phone (`hash` is the guest hash of the cookie it holds): a challenge of ours, unused and in time; a passkey THIS shop keeps (another shop's is unknown);
// the thread's own user id when the phone names one; the signature, the verified user and the counter. Then the phone's hash is aliased to the thread, in one transaction with the challenge
// used up and the counter moved. It returns the thread's hash, which the caller does not pass on to the browser.
func (s *Store) Signin(hash string, rp RelyingParty, shopName string, response map[string]any, now int64) (thread string, ok bool, why string, err error) {
	no := func(w string) (string, bool, string, error) { return "", false, w, nil }
	clientData, ok1 := b64(response["clientDataJSON"], 4096)
	_, ok2 := b64(response["authenticatorData"], 4096)
	_, ok3 := b64(response["signature"], 1024)
	id, okID := response["id"].(string)
	// RE2 refuses a repeat count over 1000, so the length (16 to 1400) is checked here and the pattern says only which characters
	if !ok1 || !ok2 || !ok3 || !okID || len(id) < 16 || len(id) > 1400 || !b64Text.MatchString(id) {
		return no("The browser's answer is not complete.")
	}
	challenge := s.challengeOf(clientData, "signin", now, nil)
	if challenge == "" {
		return no("The answer is for no sign-in challenge that is still open.")
	}
	var row struct {
		ID, Guest, JWK, RpID string
		Alg                  int
		SignCount            uint32
		BackedUp             int
	}
	if s.db.QueryRow("SELECT id, guest, jwk, alg, sign_count, backed_up, rp_id FROM creds WHERE cred_id = ?", id).Scan(&row.ID, &row.Guest, &row.JWK, &row.Alg, &row.SignCount, &row.BackedUp, &row.RpID) != nil || row.RpID != rp.RpID {
		return no("This passkey is not one of this shop's.")
	}
	uidText, err := s.userID(row.Guest)
	if err != nil {
		return "", false, "", err
	}
	// any userHandle the phone sends that is not this thread's own user id (a JSON null or a number included, as TypeScript's `!== userId(...)` refuses them) is another shop's
	if h, present := response["userHandle"]; present && h != "" {
		if text, isText := h.(string); !isText || text != uidText {
			return no("This passkey was made for another shop.")
		}
	}
	cose, perr := access.CoseOfStored(row.JWK, row.Alg)
	if perr != nil {
		return no(perr.Error())
	}
	credBytes, _ := enc.DecodeString(id)
	uid, _ := enc.DecodeString(uidText)
	assertion := map[string]any{"clientDataJSON": response["clientDataJSON"], "authenticatorData": response["authenticatorData"], "signature": response["signature"]}
	if h, isText := response["userHandle"].(string); isText && h != "" {
		assertion["userHandle"] = h
	}
	full, _ := json.Marshal(map[string]any{"id": id, "rawId": id, "type": "public-key", "response": assertion})
	parsed, perr := protocol.ParseCredentialRequestResponseBytes(full)
	if perr != nil {
		return no(perr.Error())
	}
	wa, perr := relyingParty(rp, shopName)
	if perr != nil {
		return no(perr.Error())
	}
	u := guest{id: uid, name: shopName, creds: []webauthn.Credential{{ID: credBytes, PublicKey: cose, Flags: webauthn.CredentialFlags{BackupEligible: row.BackedUp == 1}, Authenticator: webauthn.Authenticator{SignCount: row.SignCount}}}}
	cred, perr := wa.ValidateLogin(u, webauthn.SessionData{Challenge: challenge, RelyingPartyID: rp.RpID, UserID: uid, UserVerification: protocol.VerificationRequired}, parsed)
	if perr != nil {
		return no(perr.Error())
	}
	if cred.Authenticator.CloneWarning { // the counter rule: a copied key shows itself by going back
		return no("The passkey's counter went back: it may have been copied.")
	}
	why = ""
	err = s.tx(func(x *sql.Tx) error {
		if r, err := x.Exec("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL", now, challengeHash(challenge)); err != nil {
			return err
		} else if n, _ := r.RowsAffected(); n != 1 {
			why = "That challenge was used already."
			return errRefused
		}
		// the counter moves only from the value just checked: two answers racing with the same counter cannot both pass
		if r, err := x.Exec("UPDATE creds SET sign_count = ?, used_at = ? WHERE id = ? AND sign_count = ?", cred.Authenticator.SignCount, now, row.ID, row.SignCount); err != nil {
			return err
		} else if n, _ := r.RowsAffected(); n != 1 {
			why = "The passkey's counter moved meanwhile."
			return errRefused
		}
		if err := tie(x, hash, row.Guest, now); err != nil {
			return err
		}
		_, err := x.Exec("INSERT INTO phones (hash, guest, made_at) VALUES (?, ?, ?) ON CONFLICT(hash) DO UPDATE SET guest = excluded.guest, made_at = excluded.made_at", hash, row.Guest, now)
		return err
	})
	if err == errRefused {
		return no(why)
	}
	if err != nil {
		return "", false, "", err
	}
	return row.Guest, true, "", nil
}
