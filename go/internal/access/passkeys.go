package access

// The two WebAuthn ceremonies: registering a passkey with a grant (the Operator's QR, a code of the card, the owner's own code or "add a phone" link, Geometer's reset QR), and
// signing in with one. The ceremony's checks (client data, challenge, origin, relying party hash, user presence and verification, signature, counter) are
// github.com/go-webauthn/webauthn's; what is ours is the shop's rules around it (owner-access.ts grantState, registrationOptions, register, signinOptions, signin): the
// challenge table, the gate on grants, the owner and relying-party match, the transaction that uses a grant up and binds the shop to its owner, and the stored form of a key
// (a JWK, as the TypeScript runtime stores it).

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

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

// ---- challenges, the shop's user id, the stored passkeys ---------------------------------------------------------------------------------------------------

func challengeHash(c string) string { return sha("owner-challenge:" + c) }

// userID is this shop's WebAuthn user id: 16 random bytes made once, so a phone keeps one passkey per shop even though every shop shares the RP ID.
func (a *Access) userID() (string, error) {
	if v, ok := metaStr(a.db, "webauthn_user"); ok {
		return v, nil
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	if _, err := a.db.Exec("INSERT INTO meta (name, value) VALUES ('webauthn_user', ?) ON CONFLICT(name) DO NOTHING", base64.RawURLEncoding.EncodeToString(b)); err != nil {
		return "", err
	}
	v, _ := metaStr(a.db, "webauthn_user")
	return v, nil
}

// newChallenge makes a fresh challenge for one ceremony, kept as a hash; it goes to the page once. At most ChallengeKept are open: past that the OLDEST open ones go, never the new
// one, so a flood cannot grow the file and cannot lock the owner out either (the owner's own challenge is always the newest).
func (a *Access) newChallenge(kind string, now int64, grant string) (string, error) {
	if _, err := a.db.Exec("DELETE FROM challenges WHERE expires_at <= ?", now-day); err != nil {
		return "", err
	}
	if _, err := a.db.Exec("DELETE FROM challenges WHERE hash IN (SELECT hash FROM challenges WHERE used_at IS NULL ORDER BY made_at DESC LIMIT -1 OFFSET ?)", ChallengeKept-1); err != nil {
		return "", err
	}
	c := make([]byte, 32)
	_, _ = rand.Read(c)
	text := base64.RawURLEncoding.EncodeToString(c)
	var g any
	if grant != "" {
		g = grant
	}
	_, err := a.db.Exec("INSERT INTO challenges (hash, kind, grant_hash, made_at, expires_at) VALUES (?, ?, ?, ?, ?)", challengeHash(text), kind, g, now, now+ChallengeMs)
	return text, err
}

// challengeOf is the challenge a browser's client data names, if it is one of ours for this ceremony (and this grant), unused and in time.
func (a *Access) challengeOf(clientData []byte, kind string, now int64, grant string) string {
	// the member named exactly "challenge", as JSON.parse(...).challenge reads it (a struct field would also take "Challenge")
	var cd map[string]any
	if json.Unmarshal(clientData, &cd) != nil {
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
	if !found(a.db.QueryRow("SELECT kind, grant_hash, expires_at, used_at FROM challenges WHERE hash = ?", challengeHash(c)).Scan(&k, &g, &expires, &used)) {
		return ""
	}
	if k != kind || used.Valid || expires <= now || (grant != "" && (!g.Valid || g.String != grant)) {
		return ""
	}
	return c
}

// passkeyRow is a row of `passkeys`, every column the rules read.
type passkeyRow struct {
	ID, CredID, JWK, OwnerKey, RpID, Via string
	Label                                sql.NullString
	Alg                                  int
	SignCount                            uint32
	BackedUp                             bool
	MadeAt                               int64
	UsedAt, RemovedAt                    sql.NullInt64
}

// passkeyRows reads the rows whole (one connection: nothing else may run while they are open).
func passkeyRows(q execer, where string, args ...any) ([]passkeyRow, error) {
	rows, err := q.Query("SELECT id, cred_id, jwk, alg, sign_count, backed_up, made_at, used_at, removed_at, owner_key, rp_id, via, label FROM passkeys"+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []passkeyRow
	for rows.Next() {
		var r passkeyRow
		var bu int
		if err := rows.Scan(&r.ID, &r.CredID, &r.JWK, &r.Alg, &r.SignCount, &bu, &r.MadeAt, &r.UsedAt, &r.RemovedAt, &r.OwnerKey, &r.RpID, &r.Via, &r.Label); err != nil {
			return nil, err
		}
		r.BackedUp = bu == 1
		out = append(out, r)
	}
	return out, rows.Err()
}

// passkeyGood: is a passkey row good now for this owner (the LOCKED identity once there is one), on this RP ID, not removed, made after the store's passkeysBefore?
func (a *Access) passkeyGood(r passkeyRow, who Who, rp RelyingParty, before *int64) bool {
	return !r.RemovedAt.Valid && r.OwnerKey == a.effKey(a.db, who) && r.RpID == rp.RpID && (before == nil || r.MadeAt >= *before)
}

// goodPhones are the owner's passkeys that work now, oldest first.
func (a *Access) goodPhones(who Who, rp RelyingParty, before *int64) ([]passkeyRow, error) {
	rows, err := passkeyRows(a.db, " WHERE removed_at IS NULL ORDER BY made_at")
	if err != nil {
		return nil, err
	}
	var out []passkeyRow
	for _, r := range rows {
		if a.passkeyGood(r, who, rp, before) {
			out = append(out, r)
		}
	}
	return out, nil
}

var b64Text = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// b64 is a base64url member of the browser's answer, at most max characters, or false.
func b64(s any, max int) ([]byte, bool) {
	t, ok := s.(string)
	if !ok || t == "" || len(t) > max || !b64Text.MatchString(t) {
		return nil, false
	}
	b, err := base64.RawURLEncoding.DecodeString(t)
	return b, err == nil
}

var errRefused = errors.New("refused")

// ---- the grant's state ----------------------------------------------------------------------------------------------------------------------------------

// GrantState is a grant as it stands now (owner-access.ts grantState): the owner's own "add a phone" link and own codes (kept here, not in the Operator's file, so the gate does
// not apply to them), Geometer's reset QR, then the Operator's file through the gate. "valid", "used", "expired" or "unknown".
func (a *Access) GrantState(g Grant, file *Grants, now int64) (string, error) {
	if err := a.reconcile(file, now); err != nil {
		return "unknown", err
	}
	q := a.db
	hash := g.Hash()
	used := exists(q, "SELECT 1 FROM grants_used WHERE hash = ?", hash)
	if g.Kind == "setup" {
		var expires int64
		var voided sql.NullInt64
		if found(q.QueryRow("SELECT expires_at, voided_at FROM own_setups WHERE hash = ?", hash).Scan(&expires, &voided)) {
			switch {
			case voided.Valid:
				return "unknown", nil
			case used:
				return "used", nil
			case expires > now:
				return "valid", nil
			default:
				return "expired", nil
			}
		}
	} else if RecoveryShape(g.Code) {
		var voided sql.NullInt64
		if found(q.QueryRow("SELECT voided_at FROM own_codes WHERE hash = ?", hash).Scan(&voided)) {
			switch {
			case voided.Valid:
				return "unknown", nil
			case used:
				return "used", nil
			default:
				return "valid", nil
			}
		}
	}
	// Geometer's own reset QR (its hash is in the admin's reset file, not the panel's): one use, an hour from first sight, and only while the window is open or after use
	if act := appliedReset(q, file); g.Kind == "setup" && act != nil && act.Setup != nil && hash == act.Setup.Sha256 {
		var firstSeen int64
		var voided sql.NullInt64
		if !found(q.QueryRow("SELECT first_seen, voided_at FROM grants_seen WHERE hash = ?", hash).Scan(&firstSeen, &voided)) || voided.Valid {
			return "unknown", nil
		}
		if used {
			return "used", nil
		}
		if !inResetWindow(q) {
			return "unknown", nil
		}
		if now >= min(act.Setup.expiresAt, firstSeen+ResetQrMs) {
			return "expired", nil
		}
		return "valid", nil
	}
	inFile := g.InFile(file, now)
	if inFile == "unknown" || !grantAllowed(q, hash) {
		return "unknown", nil
	}
	// A setup QR is good for SetupMs from when THIS runtime first saw it, whatever expiry the file claims: the Operator writes the file, and a QR dated 2099 prepared before
	// the lock would otherwise work for ever.
	if g.Kind == "setup" {
		var firstSeen int64
		if err := q.QueryRow("SELECT first_seen FROM grants_seen WHERE hash = ?", hash).Scan(&firstSeen); err != nil {
			return "unknown", err
		}
		if now >= firstSeen+SetupMs {
			if used {
				return "used", nil
			}
			return "expired", nil
		}
	}
	if used {
		return "used", nil
	}
	return inFile, nil
}

// ---- registration ----------------------------------------------------------------------------------------------------------------------------------------

// RegistrationOptions is what the setup page's script hands to navigator.credentials.create: a challenge for this grant, the RP, this shop's user id and the passkeys the owner has
// (so a phone that has one is not asked to make a second). Nothing is used up. state is "" on success.
func (a *Access) RegistrationOptions(g Grant, file *Grants, who Who, rp RelyingParty, shopName string, now int64) (map[string]any, string, error) {
	state, err := a.GrantState(g, file, now)
	if err != nil {
		return nil, "unknown", err
	}
	if state != "valid" {
		return nil, state, nil
	}
	have, err := strings1(a.db, "SELECT cred_id FROM passkeys WHERE removed_at IS NULL AND owner_key = ? AND rp_id = ?", a.effKey(a.db, who), rp.RpID)
	if err != nil {
		return nil, "unknown", err
	}
	exclude := []map[string]any{}
	for _, id := range have {
		exclude = append(exclude, map[string]any{"type": "public-key", "id": id})
	}
	challenge, err := a.newChallenge("register", now, g.Hash())
	if err != nil {
		return nil, "unknown", err
	}
	uid, err := a.userID()
	if err != nil {
		return nil, "unknown", err
	}
	return map[string]any{
		"challenge": challenge, "rp": map[string]any{"id": rp.RpID, "name": shopName}, "user": map[string]any{"id": uid, "name": shopName, "displayName": shopName},
		"pubKeyCredParams":       []map[string]any{{"type": "public-key", "alg": -7}, {"type": "public-key", "alg": -8}, {"type": "public-key", "alg": -257}},
		"authenticatorSelection": map[string]any{"residentKey": "preferred", "userVerification": "required"}, "attestation": "none", "timeout": ChallengeMs, "excludeCredentials": exclude,
	}, "", nil
}

// RegisterResult is the outcome of a registration.
type RegisterResult struct {
	OK      bool
	Session Session
	Passkey string
	// FirstOfLock: this passkey locked the shop (the first since the gate last opened). The runtime then ends the owner alerts no phone holds.
	FirstOfLock bool
	State       string // when not OK: used, expired, unknown, refused
	Why         string
}

// Register finishes a registration: the grant checked through the gate, the browser's answer checked against the challenge made for THIS grant, then, in one transaction, the
// challenge and the grant used up, the credential kept (with how it came and its coarse label), the shop bound to its owner if this is the first passkey of the lock, and a
// session made for this browser.
func (a *Access) Register(g Grant, file *Grants, who Who, rp RelyingParty, shopName string, response map[string]any, now int64, label string) (RegisterResult, error) {
	state, err := a.GrantState(g, file, now)
	if err != nil {
		return RegisterResult{State: "unknown"}, err
	}
	if state != "valid" {
		return RegisterResult{State: state}, nil
	}
	refuse := func(why string) (RegisterResult, error) { return RegisterResult{State: "refused", Why: why}, nil }
	clientData, ok1 := b64(response["clientDataJSON"], 4096)
	_, ok2 := b64(response["attestationObject"], 16_384)
	if !ok1 || !ok2 {
		return refuse("The browser's answer is not complete.")
	}
	gh := g.Hash()
	// how this phone got in, for the owner's list: their own app's "add a phone" link, Geometer's reset QR, the Operator's QR, or a recovery code (the card's or their own)
	via := "setup"
	switch {
	case g.Kind == "recovery" && exists(a.db, "SELECT 1 FROM own_codes WHERE hash = ?", gh):
		via = "own_code"
	case g.Kind == "recovery":
		via = "recovery"
	case exists(a.db, "SELECT 1 FROM own_setups WHERE hash = ?", gh):
		via = "own_phone"
	default:
		if r := appliedReset(a.db, file); r != nil && r.Setup != nil && r.Setup.Sha256 == gh {
			via = "reset"
		}
	}
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
	var stored any // the label, at most 60 UTF-16 units, or NULL (the page then says "a phone")
	if label != "" {
		stored = cut(label, 60)
	}
	res := RegisterResult{State: "refused"}
	err = a.tx(func(x execer) error {
		if r, err := x.Exec("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL", now, challengeHash(challenge)); err != nil {
			return err
		} else if n, _ := r.RowsAffected(); n != 1 {
			res.Why = "That challenge was used already."
			return errRefused
		}
		if exists(x, "SELECT 1 FROM grants_used WHERE hash = ?", gh) {
			res = RegisterResult{State: "used"}
			return errRefused
		}
		if exists(x, "SELECT 1 FROM passkeys WHERE cred_id = ?", credID) {
			res.Why = "This passkey is already kept here."
			return errRefused
		}
		bu := 0
		if cred.Flags.BackupEligible {
			bu = 1
		}
		if _, err := x.Exec("INSERT INTO passkeys (id, cred_id, jwk, alg, sign_count, backed_up, made_at, owner_key, rp_id, via, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			id, credID, string(jwkText), alg, cred.Authenticator.SignCount, bu, now, a.effKey(x, who), rp.RpID, via, stored); err != nil {
			return err
		}
		// the first passkey of this lock binds the shop to the owner it was made for (cleared when the gate opens again)
		_, bound := boundKey(x)
		firstOfLock := !bound
		if firstOfLock {
			if err := setMeta(x, "bound_owner", a.effKey(x, who)); err != nil {
				return err
			}
			// the plain digits too, so the runtime keeps talking to THIS number if the Operator's settings later name another (EffectiveNumber)
			if _, err := x.Exec("INSERT INTO meta (name, value) VALUES ('bound_number', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", digits(who.Owner)); err != nil {
				return err
			}
		}
		if _, err := x.Exec("INSERT INTO grants_used (hash, kind, used_at, passkey_id) VALUES (?, ?, ?, ?)", gh, g.Kind, now, id); err != nil {
			return err
		}
		// at most MaxPasskeys: the one used longest ago goes
		kept, err := strings1(x, "SELECT id FROM passkeys WHERE removed_at IS NULL ORDER BY coalesce(used_at, made_at) DESC")
		if err != nil {
			return err
		}
		if len(kept) > MaxPasskeys {
			for _, old := range kept[MaxPasskeys:] {
				if _, err := x.Exec("UPDATE passkeys SET removed_at = ?, removed_why = 'too_many' WHERE id = ?", now, old); err != nil {
					return err
				}
			}
		}
		s, err := startSession(x, a.effKey(x, who), who.Base, "pk-"+id, now)
		if err != nil {
			return err
		}
		res = RegisterResult{OK: true, Session: s, Passkey: id, FirstOfLock: firstOfLock}
		return nil
	})
	if err != nil && err != errRefused {
		return RegisterResult{State: "refused"}, err
	}
	return res, nil
}

// ---- sign-in ---------------------------------------------------------------------------------------------------------------------------------------------

// SigninOptions is what the sign-in page's script hands to navigator.credentials.get: a challenge and this shop's passkeys for the owner (allowCredentials). count 0: the page
// does not offer the passkey button.
func (a *Access) SigninOptions(who Who, rp RelyingParty, now int64, before *int64) (map[string]any, error) {
	rows, err := passkeyRows(a.db, " WHERE removed_at IS NULL")
	if err != nil {
		return nil, err
	}
	allow := []map[string]any{}
	for _, r := range rows {
		if a.passkeyGood(r, who, rp, before) {
			allow = append(allow, map[string]any{"type": "public-key", "id": r.CredID})
		}
	}
	if len(allow) == 0 {
		return map[string]any{"count": 0}, nil
	}
	challenge, err := a.newChallenge("signin", now, "")
	if err != nil {
		return map[string]any{"count": len(allow)}, nil
	}
	return map[string]any{"count": len(allow), "options": map[string]any{"challenge": challenge, "rpId": rp.RpID, "userVerification": "required", "timeout": ChallengeMs, "allowCredentials": allow}}, nil
}

// SigninResult is the outcome of a sign-in.
type SigninResult struct {
	OK      bool
	Session Session
	Passkey string
	Why     string
}

// Signin finishes a sign-in: a challenge of ours, unused and in time; a passkey this shop keeps for this owner; this shop's user id when the phone names one; the signature and the
// counter. Then, in one transaction, the challenge used up, the counter moved and a session made.
func (a *Access) Signin(response map[string]any, who Who, rp RelyingParty, shopName string, now int64, before *int64) (SigninResult, error) {
	no := func(why string) (SigninResult, error) { return SigninResult{Why: why}, nil }
	clientData, ok1 := b64(response["clientDataJSON"], 4096)
	_, ok2 := b64(response["authenticatorData"], 4096)
	_, ok3 := b64(response["signature"], 1024)
	id, okID := response["id"].(string)
	// RE2 refuses a repeat count over 1000, so the length (16 to 1400) is checked here and the pattern says only which characters
	if !ok1 || !ok2 || !ok3 || !okID || len(id) < 16 || len(id) > 1400 || !b64Text.MatchString(id) {
		return no("The browser's answer is not complete.")
	}
	challenge := a.challengeOf(clientData, "signin", now, "")
	if challenge == "" {
		return no("The answer is for no sign-in challenge that is still open.")
	}
	rows, err := passkeyRows(a.db, " WHERE cred_id = ?", id)
	if err != nil {
		return SigninResult{}, err
	}
	if len(rows) != 1 || !a.passkeyGood(rows[0], who, rp, before) {
		return no("This passkey is not one of this shop's.")
	}
	row := rows[0]
	// any userHandle the phone sends that is not this shop's own user id (a JSON null or a number included, as TypeScript's `!== userId()` refuses them) is another shop's.
	// The id is made (userID) only here, where TypeScript's userId() makes it; otherwise it is only read, for the library's user (which needs one, and checks it against no
	// userHandle when the phone sent none).
	uidText, _ := metaStr(a.db, "webauthn_user")
	if h, present := response["userHandle"]; present && h != "" {
		made, err := a.userID()
		if err != nil {
			return no("The shop could not read its own user id.")
		}
		uidText = made
		if text, isText := h.(string); !isText || text != uidText {
			return no("This passkey was made for another shop.")
		}
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
	// the counter rule: when either the stored or the new value is not 0, the new one must be higher (a copied key shows itself by going back); a synced passkey that always says 0
	// is accepted
	if cred.Authenticator.CloneWarning {
		return no("The passkey's counter went back: it may have been copied.")
	}
	next := cred.Authenticator.SignCount
	res := SigninResult{Why: "The shop could not save the sign-in."}
	err = a.tx(func(x execer) error {
		if r, err := x.Exec("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL", now, challengeHash(challenge)); err != nil {
			return err
		} else if n, _ := r.RowsAffected(); n != 1 {
			res = SigninResult{Why: "That challenge was used already."}
			return errRefused
		}
		// the counter moves only from the value just checked: two answers racing with the same counter cannot both pass
		if r, err := x.Exec("UPDATE passkeys SET sign_count = ?, used_at = ? WHERE id = ? AND sign_count = ?", next, now, row.ID, row.SignCount); err != nil {
			return err
		} else if n, _ := r.RowsAffected(); n != 1 {
			res = SigninResult{Why: "The passkey's counter moved meanwhile."}
			return errRefused
		}
		// the session is for the owner the passkey was made for (its row's key), as TypeScript's signin does
		s, err := startSession(x, row.OwnerKey, who.Base, "pk-"+row.ID, now)
		if err != nil {
			return err
		}
		res = SigninResult{OK: true, Session: s, Passkey: row.ID}
		return nil
	})
	if err != nil && err != errRefused {
		return SigninResult{Why: "The shop could not save the sign-in."}, err
	}
	return res, nil
}
