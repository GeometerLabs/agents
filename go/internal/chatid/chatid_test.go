// Tests of who a chat guest is (modules/channels/test/chat-identity.test.ts): a key bound to a thread and used to open it on another phone, a key made for another shop refused, the user
// verified, the counter rule, the one-use links to the number a guest gave and their limits, "delete my chat", and what retention takes. The passkey is a software one that answers
// navigator.credentials.create and .get the way a phone does (attestation "none", ES256, user present and verified), so the checks run without a browser.
package chatid

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
)

const T0 = int64(1_800_000_000_000)

var (
	rp          = RelyingParty{RpID: "pages.example", Origin: "https://pages.example"}
	H1, H2, H3  = repeat("1"), repeat("2"), repeat("3")
	numberDigit = "919811111111"
)

func repeat(s string) string {
	out := ""
	for i := 0; i < 64; i++ {
		out += s
	}
	return out
}

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), File))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// soft is a software passkey for an RP ID.
type soft struct {
	credID []byte
	key    *ecdsa.PrivateKey
	count  uint32
	rpID   string
	userID string
}

func newSoft(rpID string) *soft {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	id := make([]byte, 32)
	_, _ = rand.Read(id)
	return &soft{credID: id, key: k, rpID: rpID}
}

func sum(b []byte) []byte { h := sha256.Sum256(b); return h[:] }

func (p *soft) authData(attested bool, flags byte, rpID string) []byte {
	if rpID == "" {
		rpID = p.rpID
	}
	var count [4]byte
	binary.BigEndian.PutUint32(count[:], p.count)
	out := append(append(sum([]byte(rpID)), flags), count[:]...)
	if attested {
		x, y := p.key.PublicKey.X.FillBytes(make([]byte, 32)), p.key.PublicKey.Y.FillBytes(make([]byte, 32))
		cose, _ := webauthncbor.Marshal(webauthncose.EC2PublicKeyData{PublicKeyData: webauthncose.PublicKeyData{KeyType: int64(webauthncose.EllipticKey), Algorithm: -7}, Curve: int64(webauthncose.P256), XCoord: x, YCoord: y})
		var l [2]byte
		binary.BigEndian.PutUint16(l[:], uint16(len(p.credID)))
		out = append(append(append(append(out, make([]byte, 16)...), l[:]...), p.credID...), cose...)
	}
	return out
}

// register is navigator.credentials.create's answer for the options the store gave. flags 0x05 is user present and verified; 0x01 is present only.
func (p *soft) register(options map[string]any, origin string, flags byte) map[string]any {
	p.userID = options["user"].(map[string]any)["id"].(string)
	cd, _ := json.Marshal(map[string]any{"type": "webauthn.create", "challenge": options["challenge"], "origin": origin, "crossOrigin": false})
	att, _ := webauthncbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": p.authData(true, flags|0x40, "")})
	return map[string]any{"clientDataJSON": enc.EncodeToString(cd), "attestationObject": enc.EncodeToString(att)}
}

// signin is navigator.credentials.get's answer: the counter moves on by one unless the passkey always says 0.
func (p *soft) signin(options map[string]any, origin string, still bool, flags byte) map[string]any {
	if !still {
		p.count++
	}
	cd, _ := json.Marshal(map[string]any{"type": "webauthn.get", "challenge": options["challenge"], "origin": origin, "crossOrigin": false})
	data := p.authData(false, flags, "")
	sig, _ := ecdsa.SignASN1(rand.Reader, p.key, sum(append(append([]byte{}, data...), sum(cd)...)))
	out := map[string]any{"id": enc.EncodeToString(p.credID), "clientDataJSON": enc.EncodeToString(cd), "authenticatorData": enc.EncodeToString(data), "signature": enc.EncodeToString(sig)}
	if p.userID != "" {
		out["userHandle"] = p.userID
	}
	return out
}

func keep(t *testing.T, s *Store, hash string, p *soft, flags byte) (bool, string) {
	t.Helper()
	opts, err := s.KeepOptions(hash, rp, "Glow Salon", T0)
	if err != nil {
		t.Fatal(err)
	}
	ok, why, err := s.Keep(hash, rp, "Glow Salon", p.register(opts, rp.Origin, flags), T0)
	if err != nil {
		t.Fatal(err)
	}
	return ok, why
}

func TestKeepingAChatBindsTheKeyToTheThreadAndTheNewPhoneIsTiedToIt(t *testing.T) {
	s := open(t)
	p := newSoft(rp.RpID)
	if ok, why := keep(t, s, H1, p, 0x05); !ok {
		t.Fatal(why)
	}
	if st := s.State(H1); st != (State{Keys: 1, Here: true}) {
		t.Fatalf("%+v", st)
	}
	opts, _ := s.SigninOptions(rp, T0+1)
	thread, ok, why, err := s.Signin(H2, rp, "Glow Salon", p.signin(opts, rp.Origin, false, 0x05), T0+2)
	if err != nil || !ok || thread != H1 {
		t.Fatalf("%v %v %q %v", thread, ok, why, err)
	}
	if s.Resolve(H2) != H1 || s.Resolve(H1) != H1 || s.Resolve(H3) != H3 {
		t.Fatal("the new phone reads the old thread: its lines, its caps, its bookings; another guest is nobody's")
	}
	if st := s.State(H2); st.Keys != 1 || !st.Here {
		t.Fatalf("a phone opened with a key is one that holds it: %+v", st)
	}
	// the challenge works once
	if _, ok, _, _ := s.Signin(H2, rp, "Glow Salon", p.signin(opts, rp.Origin, false, 0x05), T0+3); ok {
		t.Fatal("a challenge used up opens nothing")
	}
}

func TestAKeyMadeForAnotherShopOrWithoutTheUserVerifiedIsRefused(t *testing.T) {
	s := open(t)
	// the user must be verified, not only present
	if ok, _ := keep(t, s, H1, newSoft(rp.RpID), 0x01); ok {
		t.Fatal("a key whose user was not verified is not kept")
	}
	// a key for another RP ID is not accepted at registration, and an unknown key does not sign in
	other := newSoft("another.example")
	opts, _ := s.KeepOptions(H1, rp, "Glow Salon", T0)
	if ok, _, _ := s.Keep(H1, rp, "Glow Salon", other.register(opts, rp.Origin, 0x05), T0); ok {
		t.Fatal("another relying party's key is not kept")
	}
	so, _ := s.SigninOptions(rp, T0+1)
	if _, ok, why, _ := s.Signin(H2, rp, "Glow Salon", other.signin(so, rp.Origin, false, 0x05), T0+2); ok || why != "This passkey is not one of this shop's." {
		t.Fatalf("%v %q", ok, why)
	}
	// a challenge made for another thread is no use for this one
	p := newSoft(rp.RpID)
	o1, _ := s.KeepOptions(H1, rp, "Glow Salon", T0)
	if ok, why, _ := s.Keep(H3, rp, "Glow Salon", p.register(o1, rp.Origin, 0x05), T0); ok || why == "" {
		t.Fatal("a challenge belongs to the thread it was made for")
	}
	// a user id that is another thread's is another shop's
	good := newSoft(rp.RpID)
	if ok, why := keep(t, s, H1, good, 0x05); !ok {
		t.Fatal(why)
	}
	so2, _ := s.SigninOptions(rp, T0+5)
	answer := good.signin(so2, rp.Origin, false, 0x05)
	answer["userHandle"] = "AAAAAAAAAAAAAAAAAAAAAA"
	if _, ok, why, _ := s.Signin(H2, rp, "Glow Salon", answer, T0+6); ok || why != "This passkey was made for another shop." {
		t.Fatalf("%v %q", ok, why)
	}
}

func TestTheCounterRule(t *testing.T) {
	s := open(t)
	p := newSoft(rp.RpID)
	p.count = 5
	if ok, why := keep(t, s, H1, p, 0x05); !ok {
		t.Fatal(why)
	}
	for i := 0; i < 2; i++ {
		o, _ := s.SigninOptions(rp, T0+int64(i))
		if _, ok, why, _ := s.Signin(H2, rp, "Glow Salon", p.signin(o, rp.Origin, false, 0x05), T0+int64(i)); !ok {
			t.Fatalf("a counter that goes on: %s", why)
		}
	}
	p.count = 3 // a copied key shows itself by going back
	o, _ := s.SigninOptions(rp, T0+9)
	if _, ok, _, _ := s.Signin(H2, rp, "Glow Salon", p.signin(o, rp.Origin, true, 0x05), T0+9); ok {
		t.Fatal("a counter that went back is refused")
	}
	// a synced passkey that always says 0 is accepted
	q := newSoft(rp.RpID)
	if ok, why := keep(t, s, H3, q, 0x05); !ok {
		t.Fatal(why)
	}
	for i := 0; i < 2; i++ {
		o, _ := s.SigninOptions(rp, T0+20+int64(i))
		if _, ok, why, _ := s.Signin(repeat("4"), rp, "Glow Salon", q.signin(o, rp.Origin, true, 0x05), T0+20+int64(i)); !ok {
			t.Fatalf("a passkey that always says 0: %s", why)
		}
	}
}

func TestAThreadKeepsAtMostFiveKeys(t *testing.T) {
	s := open(t)
	for i := 0; i < MaxKeysPerThread+2; i++ {
		opts, _ := s.KeepOptions(H1, rp, "Glow Salon", T0+int64(i))
		p := newSoft(rp.RpID)
		if ok, _, _ := s.Keep(H1, rp, "Glow Salon", p.register(opts, rp.Origin, 0x05), T0+int64(i)); !ok {
			t.Fatal("a key is kept")
		}
	}
	if s.State(H1).Keys != MaxKeysPerThread {
		t.Fatalf("%d keys", s.State(H1).Keys)
	}
}

func TestTheOneUseLinkToTheNumber(t *testing.T) {
	s := open(t)
	if err := s.SetNumber(H1, numberDigit, T0); err != nil {
		t.Fatal(err)
	}
	if s.NumberOf(H1) != numberDigit || s.GuestOfNumber(numberDigit) != H1 || !s.State(H1).Number {
		t.Fatal("the number is the thread's contact")
	}
	l, err := s.IssueLink(H1, T0)
	if err != nil {
		t.Fatal(err)
	}
	if !LinkToken.MatchString(l.Token) || s.LinkState(l.Token, T0+1) != "valid" || s.LinkState("short", T0) != "unknown" {
		t.Fatal("a link is valid until it is used")
	}
	if thread, stopped, _ := s.UseLink(l.Token, H2, T0+2); thread != H1 || stopped != "" || s.Resolve(H2) != H1 {
		t.Fatalf("%q %q: using a link ties this phone to its thread", thread, stopped)
	}
	if _, stopped, _ := s.UseLink(l.Token, H3, T0+3); stopped != "used" {
		t.Fatalf("a link works once: %q", stopped)
	}
	// a newer link replaces an older one, and one runs out after 15 minutes
	a, _ := s.IssueLink(H1, T0)
	b, _ := s.IssueLink(H1, T0+1)
	if s.LinkState(a.Token, T0+2) != "replaced" || s.LinkState(b.Token, T0+2) != "valid" || s.LinkState(b.Token, T0+RecoveryLinkMs+2) != "expired" {
		t.Fatal("replaced and expired links")
	}
	// a link nobody was sent is nobody's
	c, _ := s.IssueLink(H1, T0+10)
	s.LinkUnsent(c.ID)
	if s.LinkState(c.Token, T0+11) != "unknown" {
		t.Fatal("an unsent link is unknown")
	}
}

func TestANumberCountsOnlyOnceItsOwnerHasTappedTheLink(t *testing.T) {
	s := open(t)
	c, err := s.IssueConfirm(H1, numberDigit, T0)
	if err != nil {
		t.Fatal(err)
	}
	if s.NumberOf(H1) != "" {
		t.Fatal("not the contact before the tap")
	}
	if stopped, _ := s.ConfirmNumber(c.Token, T0+1); stopped != "" || s.NumberOf(H1) != numberDigit {
		t.Fatalf("%q", stopped)
	}
	if stopped, _ := s.ConfirmNumber(c.Token, T0+2); stopped != "used" {
		t.Fatalf("%q", stopped)
	}
}

func TestTheLimits(t *testing.T) {
	s := open(t)
	// recovery: two an hour and three a day for a number, five in a quarter of an hour for the shop
	n := "919822222222"
	if !s.CountRecoveryAsk(n, T0) || !s.CountRecoveryAsk(n, T0+1) || s.CountRecoveryAsk(n, T0+2) {
		t.Fatal("two an hour for a number")
	}
	if !s.CountRecoveryAsk(n, T0+hour+3) || s.CountRecoveryAsk(n, T0+hour+4) {
		t.Fatal("the third in the day, then no more")
	}
	shop := open(t)
	ok := 0
	for i := 0; i < 8; i++ {
		if shop.CountRecoveryAsk("9198000000"+string(rune('0'+i))+"0", T0+int64(i)) {
			ok++
		}
	}
	if ok != 5 {
		t.Fatalf("the shop takes five in a quarter of an hour, took %d", ok)
	}
	// "send me my booking link": needs a number, three a day
	l := open(t)
	if l.CountLinksAsk(H1, T0) {
		t.Fatal("no number, no link")
	}
	_ = l.SetNumber(H1, numberDigit, T0)
	if !l.CountLinksAsk(H1, T0) || !l.CountLinksAsk(H1, T0+1) || !l.CountLinksAsk(H1, T0+2) || l.CountLinksAsk(H1, T0+3) {
		t.Fatal("three a day")
	}
	// wrong links: twenty a day, then the shop stops looking
	w := open(t)
	for i := 0; i < WrongLinkLimit-1; i++ {
		w.NoteWrongLink(T0 + int64(i))
	}
	if w.WrongLinksLocked(T0 + 100) {
		t.Fatal("not yet")
	}
	w.NoteWrongLink(T0 + 101)
	if !w.WrongLinksLocked(T0+102) || w.WrongLinksLocked(T0+day+200) {
		t.Fatal("locked for the day")
	}
}

func TestDeleteMyChatAndRetention(t *testing.T) {
	s := open(t)
	p := newSoft(rp.RpID)
	keep(t, s, H1, p, 0x05)
	_ = s.SetNumber(H1, numberDigit, T0)
	_ = s.Tie(H2, H1, T0)
	_, _ = s.IssueLink(H1, T0)
	g, err := s.Forget(H2)
	if err != nil || g != H1 {
		t.Fatal(g, err)
	}
	if st := s.State(H1); st != (State{}) || s.Resolve(H2) != H2 || s.NumberOf(H1) != "" {
		t.Fatalf("everything of the thread is gone: %+v", st)
	}
	// retention: a thread the shop has cleared takes its keys, number and ties with it
	keep(t, s, H3, newSoft(rp.RpID), 0x05)
	n, err := s.DropGone(func(thread string) bool { return thread != H3 })
	if err != nil || n != 1 || s.State(H3).Keys != 0 {
		t.Fatalf("%d %v", n, err)
	}
	// what is kept past its use goes
	_ = s.SetNumber(H1, numberDigit, T0)
	s.Purge(T0+31*day, 30)
	if s.NumberOf(H1) != "" {
		t.Fatal("a number is kept for the thread's retention")
	}
}
