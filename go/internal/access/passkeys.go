package access

// The two WebAuthn ceremonies: registering a passkey with the Operator's one-use code, and signing in with one. The ceremony's checks (client data, challenge, origin, relying
// party hash, user presence and verification, signature, counter) are github.com/go-webauthn/webauthn's; what is ours is the shop's rules around it: the challenge table, the
// grants, the owner and relying-party match, the transaction that uses a code up, and the stored form of a key (a JWK, as the TypeScript runtime stores it).

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	"github.com/go-webauthn/webauthn/webauthn"
)

// user is the one WebAuthn user a shop has: its owner.
type user struct {
	id    []byte
	name  string
	creds []webauthn.Credential
}

func (u user) WebAuthnID() []byte                         { return u.id }
func (u user) WebAuthnName() string                       { return u.name }
func (u user) WebAuthnDisplayName() string                { return u.name }
func (u user) WebAuthnCredentials() []webauthn.Credential { return u.creds }

var credParams = []protocol.CredentialParameter{
	{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgES256},
	{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgEdDSA},
	{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgRS256},
}

func relyingParty(rp RelyingParty, shop string) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{RPID: rp.RpID, RPDisplayName: shop, RPOrigins: []string{rp.Origin}})
}

// ---- the stored key: a JWK, and the COSE key go-webauthn reads ---------------------------------------------------------------------------------------------

type jwk struct {
	Kty string `json:"kty"`
	Crv string `json:"crv,omitempty"`
	X   string `json:"x,omitempty"`
	Y   string `json:"y,omitempty"`
	N   string `json:"n,omitempty"`
	E   string `json:"e,omitempty"`
}

var enc = base64.RawURLEncoding

// jwkOfCose turns a COSE key (ES256, EdDSA or RS256) into the JWK the shop's store keeps.
func jwkOfCose(cose []byte) (jwk, int, error) {
	k, err := webauthncose.ParsePublicKey(cose)
	if err != nil {
		return jwk{}, 0, err
	}
	switch p := k.(type) {
	case webauthncose.EC2PublicKeyData:
		if p.Algorithm == int64(webauthncose.AlgES256) && p.Curve == int64(webauthncose.P256) && len(p.XCoord) == 32 && len(p.YCoord) == 32 {
			return jwk{Kty: "EC", Crv: "P-256", X: enc.EncodeToString(p.XCoord), Y: enc.EncodeToString(p.YCoord)}, -7, nil
		}
	case webauthncose.OKPPublicKeyData:
		if p.Algorithm == int64(webauthncose.AlgEdDSA) && p.Curve == int64(webauthncose.Ed25519) && len(p.XCoord) == 32 {
			return jwk{Kty: "OKP", Crv: "Ed25519", X: enc.EncodeToString(p.XCoord)}, -8, nil
		}
	case webauthncose.RSAPublicKeyData:
		if p.Algorithm == int64(webauthncose.AlgRS256) {
			return jwk{Kty: "RSA", N: enc.EncodeToString(p.Modulus), E: enc.EncodeToString(p.Exponent)}, -257, nil
		}
	}
	return jwk{}, 0, fmt.Errorf("a key of this type is not accepted (ES256, EdDSA or RS256)")
}

// coseOfJwk is the other way, for a sign-in.
func coseOfJwk(j jwk, alg int) ([]byte, error) {
	dec := func(s string) []byte { b, _ := enc.DecodeString(s); return b }
	switch alg {
	case -7:
		return webauthncbor.Marshal(webauthncose.EC2PublicKeyData{PublicKeyData: webauthncose.PublicKeyData{KeyType: int64(webauthncose.EllipticKey), Algorithm: -7}, Curve: int64(webauthncose.P256), XCoord: dec(j.X), YCoord: dec(j.Y)})
	case -8:
		return webauthncbor.Marshal(webauthncose.OKPPublicKeyData{PublicKeyData: webauthncose.PublicKeyData{KeyType: int64(webauthncose.OctetKey), Algorithm: -8}, Curve: int64(webauthncose.Ed25519), XCoord: dec(j.X)})
	case -257:
		return webauthncbor.Marshal(webauthncose.RSAPublicKeyData{PublicKeyData: webauthncose.PublicKeyData{KeyType: int64(webauthncose.RSAKey), Algorithm: -257}, Modulus: dec(j.N), Exponent: dec(j.E)})
	}
	return nil, fmt.Errorf("algorithm %d is not accepted", alg)
}

// ---- registration ----------------------------------------------------------------------------------------------------------------------------------------

// RegistrationOptions is what the setup page's script hands to navigator.credentials.create: a challenge for this grant, the RP, this shop's user id and the passkeys the owner has
// (so a phone that has one is not asked to make a second). Nothing is used up. state is "" on success.
func (a *Access) RegistrationOptions(g Grant, file *Grants, who Who, rp RelyingParty, shopName string, now int64) (map[string]any, string) {
	if state := a.GrantState(g, file, now); state != "valid" {
		return nil, state
	}
	rows, _ := a.passkeyRows(" AND owner_key = ? AND rp_id = ?", ownerKey(who.Owner), rp.RpID)
	exclude := []map[string]any{}
	for _, r := range rows {
		exclude = append(exclude, map[string]any{"type": "public-key", "id": r.CredID})
	}
	challenge, err := a.newChallenge("register", now, g.Hash())
	if err != nil {
		return nil, "unknown"
	}
	uid, err := a.userID()
	if err != nil {
		return nil, "unknown"
	}
	return map[string]any{
		"challenge": challenge, "rp": map[string]any{"id": rp.RpID, "name": shopName}, "user": map[string]any{"id": uid, "name": shopName, "displayName": shopName},
		"pubKeyCredParams":       []map[string]any{{"type": "public-key", "alg": -7}, {"type": "public-key", "alg": -8}, {"type": "public-key", "alg": -257}},
		"authenticatorSelection": map[string]any{"residentKey": "preferred", "userVerification": "required"}, "attestation": "none", "timeout": ChallengeMs, "excludeCredentials": exclude,
	}, ""
}

// RegisterResult is the outcome of a registration.
type RegisterResult struct {
	OK      bool
	Session Session
	Passkey string
	State   string // when not OK: used, expired, unknown, refused
	Why     string
}

type attestationBody struct {
	ClientDataJSON    string `json:"clientDataJSON"`
	AttestationObject string `json:"attestationObject"`
}

// Register finishes a registration: the browser's answer checked against the challenge made for THIS grant, then, in one transaction, the challenge and the grant used up, the
// credential kept and a session made for this browser.
func (a *Access) Register(g Grant, file *Grants, who Who, rp RelyingParty, shopName string, response map[string]any, now int64) RegisterResult {
	if state := a.GrantState(g, file, now); state != "valid" {
		return RegisterResult{State: state}
	}
	refuse := func(why string) RegisterResult { return RegisterResult{State: "refused", Why: why} }
	clientData, ok1 := b64(response["clientDataJSON"], 4096)
	_, ok2 := b64(response["attestationObject"], 16_384)
	if !ok1 || !ok2 {
		return refuse("The browser's answer is not complete.")
	}
	gh := g.Hash()
	challenge := a.challengeOf(clientData, "register", now, gh)
	if challenge == "" {
		return refuse("The answer is for no challenge of this setup that is still open.")
	}
	uidText, err := a.userID()
	if err != nil {
		return refuse("The shop could not read its own user id.")
	}
	uid, _ := enc.DecodeString(uidText)
	// go-webauthn reads a whole PublicKeyCredential (with its id); the browser's answer carries the two members, so the id is taken from the attested credential data first
	raw, _ := json.Marshal(response)
	var att protocol.AuthenticatorAttestationResponse
	if json.Unmarshal(raw, &att) != nil {
		return refuse("The browser's answer is not complete.")
	}
	parsedAtt, err := att.Parse()
	if err != nil {
		return refuse(err.Error())
	}
	credID := enc.EncodeToString(parsedAtt.AttestationObject.AuthData.AttData.CredentialID)
	full, _ := json.Marshal(map[string]any{"id": credID, "rawId": credID, "type": "public-key", "response": json.RawMessage(raw)})
	parsed, err := protocol.ParseCredentialCreationResponseBytes(full)
	if err != nil {
		return refuse(err.Error())
	}
	wa, err := relyingParty(rp, shopName)
	if err != nil {
		return refuse(err.Error())
	}
	cred, err := wa.CreateCredential(user{id: uid, name: shopName}, webauthn.SessionData{Challenge: challenge, RelyingPartyID: rp.RpID, UserID: uid, UserVerification: protocol.VerificationRequired, CredParams: credParams}, parsed)
	if err != nil {
		return refuse(err.Error())
	}
	key, alg, err := jwkOfCose(cred.PublicKey)
	if err != nil {
		return refuse(err.Error())
	}
	jwkText, _ := json.Marshal(key)
	id := newID()
	res := RegisterResult{State: "refused"}
	err = a.tx(func(x execer) error {
		if r, err := x.Exec("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL", now, challengeHash(challenge)); err != nil {
			return err
		} else if n, _ := r.RowsAffected(); n != 1 {
			res.Why = "That challenge was used already."
			return errRefused
		}
		var one int
		if x.QueryRow("SELECT 1 FROM grants_used WHERE hash = ?", gh).Scan(&one) == nil {
			res = RegisterResult{State: "used"}
			return errRefused
		}
		if x.QueryRow("SELECT 1 FROM passkeys WHERE cred_id = ?", credID).Scan(&one) == nil {
			res.Why = "This passkey is already kept here."
			return errRefused
		}
		bu := 0
		if cred.Flags.BackupEligible {
			bu = 1
		}
		if _, err := x.Exec("INSERT INTO passkeys (id, cred_id, jwk, alg, sign_count, backed_up, made_at, owner_key, rp_id, via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			id, credID, string(jwkText), alg, cred.Authenticator.SignCount, bu, now, ownerKey(who.Owner), rp.RpID, g.Kind); err != nil {
			return err
		}
		if _, err := x.Exec("INSERT INTO grants_used (hash, kind, used_at, passkey_id) VALUES (?, ?, ?, ?)", gh, g.Kind, now, id); err != nil {
			return err
		}
		// at most MAX_PASSKEYS: the one used longest ago goes
		rows, err := x.Query("SELECT id FROM passkeys WHERE removed_at IS NULL ORDER BY coalesce(used_at, made_at) DESC")
		if err != nil {
			return err
		}
		var kept []string
		for rows.Next() {
			var k string
			_ = rows.Scan(&k)
			kept = append(kept, k)
		}
		rows.Close()
		if len(kept) > MaxPasskeys {
			for _, old := range kept[MaxPasskeys:] {
				if _, err := x.Exec("UPDATE passkeys SET removed_at = ?, removed_why = 'too_many' WHERE id = ?", now, old); err != nil {
					return err
				}
			}
		}
		s, err := startSession(x, ownerKey(who.Owner), who.Base, "pk-"+id, now)
		if err != nil {
			return err
		}
		res = RegisterResult{OK: true, Session: s, Passkey: id}
		return nil
	})
	if err != nil && err != errRefused {
		return refuse("The shop could not save the passkey.")
	}
	return res
}

// ---- sign-in ---------------------------------------------------------------------------------------------------------------------------------------------

// SigninOptions is what the sign-in page's script hands to navigator.credentials.get: a challenge and this shop's passkeys for the owner (allowCredentials). count 0: the page
// does not offer the passkey button.
func (a *Access) SigninOptions(who Who, rp RelyingParty, now int64, before *int64) map[string]any {
	rows, _ := a.passkeyRows("")
	var allow []map[string]any
	for _, r := range rows {
		if good(r, who, rp, before) {
			allow = append(allow, map[string]any{"type": "public-key", "id": r.CredID})
		}
	}
	if len(allow) == 0 {
		return map[string]any{"count": 0}
	}
	challenge, err := a.newChallenge("signin", now, "")
	if err != nil {
		return map[string]any{"count": len(allow)}
	}
	return map[string]any{"count": len(allow), "options": map[string]any{"challenge": challenge, "rpId": rp.RpID, "userVerification": "required", "timeout": ChallengeMs, "allowCredentials": allow}}
}

// SigninResult is the outcome of a sign-in.
type SigninResult struct {
	OK      bool
	Session Session
	Why     string
}

// Signin finishes a sign-in: a challenge of ours, unused and in time; a passkey this shop keeps for this owner; this shop's user id when the phone names one; the signature and the
// counter. Then, in one transaction, the challenge used up, the counter moved and a session made.
func (a *Access) Signin(response map[string]any, who Who, rp RelyingParty, shopName string, now int64, before *int64) SigninResult {
	no := func(why string) SigninResult { return SigninResult{Why: why} }
	clientData, ok1 := b64(response["clientDataJSON"], 4096)
	_, ok2 := b64(response["authenticatorData"], 4096)
	_, ok3 := b64(response["signature"], 1024)
	id, okID := response["id"].(string)
	if !ok1 || !ok2 || !ok3 || !okID || len(id) < 16 || len(id) > 1400 || !regexp_id.MatchString(id) {
		return no("The browser's answer is not complete.")
	}
	challenge := a.challengeOf(clientData, "signin", now, "")
	if challenge == "" {
		return no("The answer is for no sign-in challenge that is still open.")
	}
	rows, _ := a.passkeyRows(" AND cred_id = ?", id)
	if len(rows) != 1 || !good(rows[0], who, rp, before) {
		return no("This passkey is not one of this shop's.")
	}
	row := rows[0]
	uidText, err := a.userID()
	if err != nil {
		return no("The shop could not read its own user id.")
	}
	if h, ok := response["userHandle"].(string); ok && h != "" && h != uidText {
		return no("This passkey was made for another shop.")
	}
	var key jwk
	if json.Unmarshal([]byte(row.JWK), &key) != nil {
		return no("The shop could not read the passkey.")
	}
	cose, err := coseOfJwk(key, row.Alg)
	if err != nil {
		return no(err.Error())
	}
	credBytes, _ := enc.DecodeString(row.CredID)
	uid, _ := enc.DecodeString(uidText)
	assertion := map[string]any{"clientDataJSON": response["clientDataJSON"], "authenticatorData": response["authenticatorData"], "signature": response["signature"]}
	if h, ok := response["userHandle"].(string); ok && h != "" {
		assertion["userHandle"] = h
	}
	full, _ := json.Marshal(map[string]any{"id": row.CredID, "rawId": row.CredID, "type": "public-key", "response": assertion})
	parsed, err := protocol.ParseCredentialRequestResponseBytes(full)
	if err != nil {
		return no(err.Error())
	}
	wa, err := relyingParty(rp, shopName)
	if err != nil {
		return no(err.Error())
	}
	u := user{id: uid, name: shopName, creds: []webauthn.Credential{{ID: credBytes, PublicKey: cose, Flags: webauthn.CredentialFlags{BackupEligible: row.BackedUp}, Authenticator: webauthn.Authenticator{SignCount: row.SignCount}}}}
	cred, err := wa.ValidateLogin(u, webauthn.SessionData{Challenge: challenge, RelyingPartyID: rp.RpID, UserID: uid, UserVerification: protocol.VerificationRequired}, parsed)
	if err != nil {
		return no(err.Error())
	}
	// the counter rule: when either the stored or the new value is not 0, the new one must be higher (a copied key shows itself by going back); a synced passkey that always says 0 is accepted
	if cred.Authenticator.CloneWarning {
		return no("The passkey's counter went back: it may have been copied.")
	}
	next := cred.Authenticator.SignCount
	res := no("The shop could not save the sign-in.")
	err = a.tx(func(x execer) error {
		if r, err := x.Exec("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL", now, challengeHash(challenge)); err != nil {
			return err
		} else if n, _ := r.RowsAffected(); n != 1 {
			res = no("That challenge was used already.")
			return errRefused
		}
		// the counter moves only from the value just checked: two answers racing with the same counter cannot both pass
		if r, err := x.Exec("UPDATE passkeys SET sign_count = ?, used_at = ? WHERE id = ? AND sign_count = ?", next, now, row.ID, row.SignCount); err != nil {
			return err
		} else if n, _ := r.RowsAffected(); n != 1 {
			res = no("The passkey's counter moved meanwhile.")
			return errRefused
		}
		s, err := startSession(x, row.OwnerKey, who.Base, "pk-"+row.ID, now)
		if err != nil {
			return err
		}
		res = SigninResult{OK: true, Session: s}
		return nil
	})
	if err != nil && err != errRefused {
		return no("The shop could not save the sign-in.")
	}
	return res
}
