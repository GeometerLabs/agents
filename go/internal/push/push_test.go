package push

// Tests of the push package against what is published and what the TypeScript runtime does: RFC 8291's own example message (byte for byte), a message only its browser can open, the
// VAPID header's signature, the store's rules (same address is one subscription, the owner's five phones), the file format TypeScript wrote, and the sender against a fake push Guard.

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func u(s string) []byte { return decodeB64URL(strings.Join(strings.Fields(s), "")) }

func TestRFC8291AppendixA(t *testing.T) {
	as, err := ecdh.P256().NewPrivateKey(u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	ua := u("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
	got, err := encryptWith([]byte("When I grow up, I want to be a watermelon"), ua, u("BTBZMqHH6r4Tts7J_aSIgg"), 0, as, u("DGv6ra1nlYgDCS1FRnbzlw"))
	if err != nil {
		t.Fatal(err)
	}
	want := u(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
  mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
  pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`)
	if !bytes.Equal(got, want) {
		t.Fatalf("the RFC's message is not reproduced:\n got %x\nwant %x", got, want)
	}
}

// openPush is a browser's side: derive the same key from its private key and auth secret and open the one record.
func openPush(t *testing.T, body []byte, priv *ecdh.PrivateKey, auth []byte) []byte {
	t.Helper()
	salt, idLen := body[:16], int(body[20])
	asPublic, sealed := body[21:21+idLen], body[21+idLen:]
	pub, err := ecdh.P256().NewPublicKey(asPublic)
	if err != nil {
		t.Fatal(err)
	}
	secret, err := priv.ECDH(pub)
	if err != nil {
		t.Fatal(err)
	}
	key, nonce, err := derive(secret, auth, priv.PublicKey().Bytes(), asPublic, salt)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	record, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		t.Fatal(err)
	}
	end := len(record) - 1
	for end >= 0 && record[end] == 0 {
		end--
	}
	if end < 0 || record[end] != 0x02 {
		t.Fatal("no last-record delimiter")
	}
	return record[:end]
}

func browser(t *testing.T) (*ecdh.PrivateKey, []byte, Subscription) {
	t.Helper()
	k, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	return k, auth, Subscription{Endpoint: "https://fcm.googleapis.com/fcm/send/" + newID(), P256dh: b64u.EncodeToString(k.PublicKey().Bytes()), Auth: b64u.EncodeToString(auth)}
}

func TestOnlyTheSubscriberCanRead(t *testing.T) {
	k, auth, sub := browser(t)
	a, err := EncryptPush([]byte("Refund ₹500 waits for you"), k.PublicKey().Bytes(), auth, 128)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := EncryptPush([]byte("Refund ₹500 waits for you"), k.PublicKey().Bytes(), auth, 128)
	if bytes.Equal(a, b) {
		t.Fatal("a fresh key and salt every time")
	}
	if string(openPush(t, a, k, auth)) != "Refund ₹500 waits for you" {
		t.Fatal("the browser cannot read it")
	}
	if len(a) != 16+4+1+65+128+16 {
		t.Fatalf("padding to 128 hides the length: body is %d bytes", len(a))
	}
	if _, err := EncryptPush(make([]byte, MaxPlaintext+1), k.PublicKey().Bytes(), auth, 0); err == nil {
		t.Fatal("too long must be refused")
	}
	if _, err := EncryptPush([]byte("x"), make([]byte, 65), auth, 0); err == nil {
		t.Fatal("a p256dh that is no key must be refused")
	}
	if SubscriptionProblem(sub.Endpoint, sub.P256dh, sub.Auth) != "" {
		t.Fatal("a good subscription refused")
	}
}

func TestSubscriptionProblems(t *testing.T) {
	_, _, good := browser(t)
	cases := map[string]Subscription{
		"http":      {Endpoint: strings.Replace(good.Endpoint, "https", "http", 1), P256dh: good.P256dh, Auth: good.Auth},
		"host":      {Endpoint: "https://evil.example/x", P256dh: good.P256dh, Auth: good.Auth},
		"port":      {Endpoint: "https://fcm.googleapis.com:8443/x", P256dh: good.P256dh, Auth: good.Auth},
		"userinfo":  {Endpoint: "https://u:p@fcm.googleapis.com/x", P256dh: good.P256dh, Auth: good.Auth},
		"fragment":  {Endpoint: good.Endpoint + "#x", P256dh: good.P256dh, Auth: good.Auth},
		"not point": {Endpoint: good.Endpoint, P256dh: b64u.EncodeToString(append([]byte{4}, make([]byte, 64)...)), Auth: good.Auth},
		"auth":      {Endpoint: good.Endpoint, P256dh: good.P256dh, Auth: "AAAA"},
		"long":      {Endpoint: good.Endpoint + "/" + strings.Repeat("a", 1000), P256dh: good.P256dh, Auth: good.Auth},
	}
	for name, s := range cases {
		if SubscriptionProblem(s.Endpoint, s.P256dh, s.Auth) == "" {
			t.Errorf("%s: should be refused", name)
		}
	}
	if SubscriptionProblem("https://fcm.googleapis.com:443/x", good.P256dh, good.Auth) != "" {
		t.Error("the default port is no port, as in JavaScript's URL")
	}
}

func TestVapidHeaderVerifies(t *testing.T) {
	keys, err := NewVapidKeys()
	if err != nil {
		t.Fatal(err)
	}
	h, err := VapidHeader(keys, "https://fcm.googleapis.com", "https://pages.example/glow", 1_000)
	if err != nil {
		t.Fatal(err)
	}
	m := strings.SplitN(strings.TrimPrefix(h, "vapid t="), ", k=", 2)
	if len(m) != 2 || m[1] != keys.PublicKey {
		t.Fatalf("header shape: %s", h)
	}
	parts := strings.Split(m[0], ".")
	sig := decodeB64URL(parts[2])
	pub := decodeB64URL(keys.PublicKey)
	x, y := new(big.Int).SetBytes(pub[1:33]), new(big.Int).SetBytes(pub[33:])
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if len(sig) != 64 || !ecdsa.Verify(&ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("the signature does not verify as raw r||s under the shop's key")
	}
	var claims map[string]any
	_ = json.Unmarshal(decodeB64URL(parts[1]), &claims)
	if claims["aud"] != "https://fcm.googleapis.com" || claims["sub"] != "https://pages.example/glow" || claims["exp"].(float64) != 1000+VapidTTL {
		t.Fatalf("claims: %v", claims)
	}
}

func TestStoreRules(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), File))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if c, _ := st.Choice(); c != "whatsapp" {
		t.Fatalf("the default choice is whatsapp, got %s", c)
	}
	k1, err := st.Vapid()
	k2, _ := st.Vapid()
	if err != nil || k1.PublicKey != k2.PublicKey || k1.PrivateJWK.D == "" {
		t.Fatal("the key is made once and kept")
	}
	_, _, sub := browser(t)
	id1, why, err := st.Subscribe("owner", sub, 10, "own", "pk1")
	if why != "" || err != nil {
		t.Fatal(why, err)
	}
	id2, _, _ := st.Subscribe("owner", sub, 20, "own", "pk2")
	if id1 != id2 {
		t.Fatal("the same address is the same subscription")
	}
	if n, _ := st.Phones("owner"); n != 1 {
		t.Fatalf("phones %d", n)
	}
	for i := 0; i < OwnerPhones; i++ {
		_, _, s := browser(t)
		if _, why, _ := st.Subscribe("owner", s, int64(30+i), "own", ""); why != "" {
			t.Fatal(why)
		}
	}
	if n, _ := st.Phones("owner"); n != OwnerPhones {
		t.Fatalf("the oldest goes: %d phones", n)
	}
	if ids, _ := st.Enqueue("owner", "owner", "Shop", "hello", "owner", 100); len(ids) != OwnerPhones {
		t.Fatalf("one push per phone, got %d", len(ids))
	}
	if ok, _ := st.Unsubscribe("owner", sub.Endpoint, 200); ok {
		t.Fatal("that phone was already pushed out by newer ones")
	}
	// four of the five have no phone (passkey) behind them: the lock ends them; none is left
	if n, _ := st.DropUnbound(300); n != OwnerPhones {
		t.Fatalf("drop unbound: %d", n)
	}
}

func TestSenderAgainstAFakeGuard(t *testing.T) {
	st, _ := Open(filepath.Join(t.TempDir(), File))
	defer st.Close()
	k, auth, sub := browser(t)
	if _, why, _ := st.Subscribe("owner", sub, 1, "own", ""); why != "" {
		t.Fatal(why)
	}
	var mu sync.Mutex
	var got []Call
	var tokens []string
	status := http.StatusCreated
	guard := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var c Call
		_ = json.Unmarshal(b, &c)
		mu.Lock()
		got, tokens = append(got, c), append(tokens, r.URL.Path+" "+r.Header.Get("authorization"))
		s := status
		mu.Unlock()
		w.WriteHeader(s)
	}))
	defer guard.Close()
	now := int64(1_000_000)
	snd := NewSender(SenderOptions{Store: st, Guard: &Guard{BaseURL: guard.URL + "/", AgentToken: "secret-agent"}, Subject: func() string { return "https://pages.example/glow" }, Now: func() int64 { return now }})
	p := New(st, snd, "Glow Pets", func() int64 { return now }, true, "")
	if ids, err := p.Owner("A new phone was added to your shop.", "phones"); err != nil || len(ids) != 1 {
		t.Fatalf("queued %v", ids)
	}
	snd.Pass()
	mu.Lock()
	if len(got) != 1 || tokens[0] != "/v1/push/owner Bearer secret-agent" {
		t.Fatalf("the guard heard %v %v", got, tokens)
	}
	c := got[0]
	mu.Unlock()
	if c.Host != "fcm.googleapis.com" || c.Urgency != "high" || c.TTL != OwnerTTL || !strings.HasPrefix(c.Vapid, "vapid t=") || c.Sub == "" || !strings.HasPrefix(c.Topic, "owner-") {
		t.Fatalf("call: %+v", c)
	}
	var payload Payload
	if err := json.Unmarshal(openPush(t, decodeB64URL(c.Body), k, auth), &payload); err != nil || payload.Title != "Glow Pets" || payload.Body != "A new phone was added to your shop." || payload.Tag != "phones" {
		t.Fatalf("what the phone reads: %+v %v", payload, err)
	}
	// sent: nothing more is due
	if due, _ := st.Due(now, 20); len(due) != 0 {
		t.Fatal("a sent push is not sent again")
	}
	// 410 from the push service: the subscription is forgotten
	mu.Lock()
	status = http.StatusGone
	mu.Unlock()
	_, _ = p.Owner("again", "")
	snd.Pass()
	if n := p.OwnerPhones(); n != 0 {
		t.Fatalf("a gone phone is forgotten, %d left", n)
	}
	// the Guard down: tried again later with a growing wait
	_, _, s2 := browser(t)
	_ = p.Subscribe("owner", s2, "own", "")
	mu.Lock()
	status = http.StatusBadGateway
	mu.Unlock()
	_, _ = p.Owner("later", "")
	snd.Pass()
	if due, _ := st.Due(now, 20); len(due) != 0 {
		t.Fatal("a push that failed waits before the next try")
	}
	if due, _ := st.Due(now+30_001, 20); len(due) != 1 {
		t.Fatal("it is due again after 30 s")
	}
}

// A customer's push (24 Nov 2026, push.ts `customer`): only the phones of that page's conversation, at most two of them, tagged "update", posted to the Guard's customer route
// with the customer's TTL, normal urgency and one topic per phone; forgetting the conversation ends its phones and their waiting pushes.
func TestCustomerPush(t *testing.T) {
	st, _ := Open(filepath.Join(t.TempDir(), File))
	defer st.Close()
	var mu sync.Mutex
	var got []Call
	var paths []string
	guard := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var c Call
		_ = json.Unmarshal(b, &c)
		mu.Lock()
		got, paths = append(got, c), append(paths, r.URL.Path)
		mu.Unlock()
		w.WriteHeader(http.StatusCreated)
	}))
	defer guard.Close()
	now := int64(2_000_000)
	snd := NewSender(SenderOptions{Store: st, Guard: &Guard{BaseURL: guard.URL}, Subject: func() string { return "https://pages.example/glow" }, Now: func() int64 { return now }})
	p := New(st, snd, "Glow Salon", func() int64 { return now }, true, "")
	const page, other = "web:0123456789abcdef", "web:fedcba9876543210"
	if ids, err := p.Customer(page, "You're booked!"); err != nil || len(ids) != 0 {
		t.Fatalf("nobody allowed alerts: nothing queued, got %v %v", ids, err)
	}
	k, auth, sub := browser(t)
	if why := p.Subscribe(page, sub, "", ""); why != "" {
		t.Fatal(why)
	}
	if ids, _ := p.Customer(other, "another page's news"); len(ids) != 0 {
		t.Fatal("another page's words never reach this phone")
	}
	if ids, _ := p.Customer(page, "  You're\n booked!  "); len(ids) != 1 {
		t.Fatalf("one push for the one phone, got %v", ids)
	}
	snd.Pass()
	mu.Lock()
	if len(got) != 1 || paths[0] != "/v1/push/customer" {
		t.Fatalf("the guard heard %v %v", got, paths)
	}
	c := got[0]
	mu.Unlock()
	if c.Urgency != "normal" || c.TTL != CustomerTTL || c.Topic != "customer-"+c.Sub {
		t.Fatalf("call: %+v", c)
	}
	var payload Payload
	if err := json.Unmarshal(openPush(t, decodeB64URL(c.Body), k, auth), &payload); err != nil || payload.Title != "Glow Salon" || payload.Body != "You're booked!" || payload.Tag != "update" {
		t.Fatalf("what the phone reads: %+v %v", payload, err)
	}
	// a page keeps at most two phones: the oldest goes
	for i := 0; i < CustomerPhones; i++ {
		_, _, s := browser(t)
		_ = p.Subscribe(page, s, "", "")
	}
	if n, _ := p.Phones(page); n != CustomerPhones {
		t.Fatalf("a page keeps %d phones, got %d", CustomerPhones, n)
	}
	// "delete my chat": every phone of the conversation ends, and what waited for them goes
	_, _ = p.Customer(page, "waiting")
	if n, err := p.Forget(page); err != nil || n != CustomerPhones {
		t.Fatalf("forgot %d %v", n, err)
	}
	if n, _ := p.Phones(page); n != 0 {
		t.Fatal("no phone is left")
	}
	if due, _ := st.Due(now, 20); len(due) != 0 {
		t.Fatal("the waiting pushes went with the phones")
	}
	// push off: nothing is queued
	off := New(st, snd, "Glow Salon", func() int64 { return now }, false, "")
	if ids, _ := off.Customer(page, "x"); ids != nil {
		t.Fatal("push off queues nothing")
	}
}

func TestFitNotification(t *testing.T) {
	if FitNotification("  a \n\u00a0 b\ufeff c  ", 300) != "a b c" {
		t.Fatal("whitespace as JavaScript sees it")
	}
	long := strings.Repeat("ക", 400)
	if r := []rune(FitNotification(long, 300)); len(r) != 300 || r[299] != '…' {
		t.Fatal("cut to 300 letters with an ellipsis")
	}
}

func TestSlug(t *testing.T) {
	for page, want := range map[string]string{"https://pages.example/glow-pets": "glow-pets", "https://pages.example/12345": "", "https://pages.example/a--b": "", "https://pages.example/ab": "", "": ""} {
		if SlugOfPage(page) != want {
			t.Errorf("%q: %q", page, SlugOfPage(page))
		}
	}
}
