package runtime

// Tests of a customer's web push on the runtime's side (push.go's customer_* ops, CustomerPush, and ChannelMessaging's onKeep), against http.ts's answers: which conversation a
// handle's alerts are kept under (a chat thread first, then a Fees parent's stable ref, then a web or MCP page; nothing else), the 403 before the shop's first answer to a chat
// guest, and that a kept message (and only a kept one) is handed to the push. The template kit here is a stand-in with only the channel reads these need.

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/push"
)

// pushKit is a template kit whose channel has a view, and (parents) a parent reader; every other Kit method is left to the nil interface (never called here).
type pushKit struct {
	Kit
	ch ChannelKit
}

func (k pushKit) Channel() ChannelKit { return k.ch }

type pushChannel struct {
	ChannelKit
	views map[string]any
}

func (c pushChannel) View(_ KitState, h string) any { return c.views[h] }

type pushParents struct {
	pushChannel
	parents map[string]any
}

func (c pushParents) Parent(_ KitState, h string) any { return c.parents[h] }

// pushState is a saved state with only the channel member.
type pushState struct{ cs *ChannelState }

func (s pushState) Members() ([]Member, error) {
	return []Member{{Name: "channel", Raw: s.cs.Marshal()}}, nil
}

func hashOf(c byte) string { return strings.Repeat(string(c), 64) }

// a browser's key and secret: RFC 8291's example receiver (a P-256 point, uncompressed, base64url) and its 16-byte auth secret, at a push service the Guard allows
const goodKey = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"

func subscriptionBody(n string) map[string]any {
	return map[string]any{"endpoint": "https://fcm.googleapis.com/fcm/send/" + n, "keys": map[string]any{"p256dh": goodKey, "auth": "BTBZMqHH6r4Tts7J_aSIgg"}}
}

func TestPageConversationReadsTheViewsAndParentsMembers(t *testing.T) {
	ch := pushParents{
		pushChannel: pushChannel{views: map[string]any{
			hashOf('a'): map[string]any{"status": "held", "channel": "web"},
			hashOf('b'): json.RawMessage(`{"status":"held","ref":"o-1","channel":"mcp"}`), // a template's ordered object is JSON too
			hashOf('c'): map[string]any{"status": "held"},                                 // a WhatsApp booking's page: no channel
			hashOf('d'): map[string]any{"status": "held", "channel": "whatsapp"},
		}},
		parents: map[string]any{hashOf('e'): map[string]any{"ref": "p-0123456789ab", "students": []any{}}, hashOf('f'): map[string]any{"ref": "not-a-ref"}},
	}
	for h, want := range map[string]string{
		hashOf('a'): "web:" + hashOf('a')[:16], hashOf('b'): "mcp:" + hashOf('b')[:16], hashOf('c'): "", hashOf('d'): "",
		hashOf('e'): "parent:p-0123456789ab", hashOf('f'): "", hashOf('9'): "",
	} {
		if got := pageConversation(ch, nil, h); got != want {
			t.Errorf("%s: %q, want %q", h[:4], got, want)
		}
	}
}

func TestCustomerOpsKeepAPhoneUnderTheRightConversation(t *testing.T) {
	st, err := push.Open(filepath.Join(t.TempDir(), push.File))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	now := func() int64 { return 1_000 }
	p := push.New(st, nil, "Glow", now, true, "")
	guest, quiet := hashOf('1'), hashOf('2')
	cs := EmptyChannel()
	cs.ensureGuest(ChatConversationOf(guest), 1, "2026-11-24")
	cs.ensureGuest(ChatConversationOf(quiet), 1, "2026-11-24")
	cs.Keep(ChatConversationOf(guest), "Hello! What can I book for you?", nil, 2)
	rt := &Runtime{o: Options{Kit: pushKit{ch: pushChannel{views: map[string]any{hashOf('a'): map[string]any{"channel": "web"}}}}, Log: func(string) {}, Now: now}, routes: &routes{push: p}, snap: &Snap{T: pushState{cs}}}
	s := &Server{rt: rt}
	op := func(name, handle string, body map[string]any) (int, map[string]any) {
		t.Helper()
		w := httptest.NewRecorder()
		if err := s.pushCustomerOp(w, p, name, handle, body); err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	// a guest the shop has not answered yet: told why, and the state says so
	if code, out := op("customer_subscribe", quiet, map[string]any{"subscription": subscriptionBody("q")}); code != 403 || out["error"] != "Alerts are offered after the first answer." {
		t.Fatalf("before the first answer: %d %v", code, out)
	}
	if code, out := op("customer_state", quiet, nil); code != 200 || out["answered"] != false || out["phones"] != float64(0) {
		t.Fatalf("state: %d %v", code, out)
	}
	// an answered guest keeps the phone under its chat conversation
	if code, out := op("customer_subscribe", guest, map[string]any{"subscription": subscriptionBody("g")}); code != 200 || out["phones"] != float64(1) || out["answered"] != true {
		t.Fatalf("answered guest: %d %v", code, out)
	}
	if n, _ := p.Phones(ChatConversationOf(guest)); n != 1 {
		t.Fatal("kept under the chat conversation")
	}
	// a web page's handle: its own conversation, no `answered`
	if code, out := op("customer_subscribe", hashOf('a'), map[string]any{"subscription": subscriptionBody("w")}); code != 200 || out["phones"] != float64(1) || out["answered"] != nil {
		t.Fatalf("web page: %d %v", code, out)
	}
	// the store's refusals and the route's own
	for _, c := range []struct {
		name string
		body map[string]any
		code int
		why  string
	}{
		{"customer_subscribe", map[string]any{"subscription": "nope"}, 400, push.ShapeProblem},
		{"customer_subscribe", map[string]any{"subscription": subscriptionBody("x"), "signer": "streetlist"}, 400, "this shop does not send through the Streetlist app"},
		{"customer_unsubscribe", map[string]any{}, 400, "Send the endpoint to stop."},
		{"customer_nonsense", nil, 400, "op is not one this route knows."},
	} {
		if code, out := op(c.name, hashOf('a'), c.body); code != c.code || out["error"] != c.why {
			t.Errorf("%s %v: %d %v", c.name, c.body, code, out)
		}
	}
	if code, out := op("customer_unsubscribe", hashOf('a'), map[string]any{"endpoint": subscriptionBody("w")["endpoint"]}); code != 200 || out["phones"] != float64(0) {
		t.Fatalf("unsubscribe: %d %v", code, out)
	}
	// no page, no chat: 404, as for a page at another shop
	if code, _ := op("customer_state", hashOf('9'), nil); code != 404 {
		t.Fatalf("no page: %d", code)
	}
}

func TestAKeptMessageAndOnlyAKeptOneIsHandedToThePush(t *testing.T) {
	var got [][2]string
	cs := EmptyChannel()
	m := ChannelMessaging(nil, func() *ChannelState { return cs }, func() int64 { return 5 }, func(to, text string) { got = append(got, [2]string{to, text}) })
	ctx := context.Background()
	page := "web:" + hashOf('a')[:16]
	_, _ = m.SendText(ctx, page, "You're booked!")
	_, _ = m.SendTemplate(ctx, page, messaging.TemplateMessage{Text: "See you tomorrow."})
	_, _ = m.(messaging.Interactive).SendInteractive(ctx, page, messaging.InteractiveMessage{Body: "Pay now?"})
	if _, err := m.SendText(ctx, "+919811111111", "a WhatsApp number"); err == nil {
		t.Fatal("no WhatsApp: a number's message fails")
	}
	want := [][2]string{{page, "You're booked!"}, {page, "See you tomorrow."}, {page, "Pay now?"}}
	if len(got) != len(want) {
		t.Fatalf("handed %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%d: %v, want %v", i, got[i], want[i])
		}
	}
	if len(cs.Outbox) != 3 {
		t.Fatal("every message is kept for the page whatever the push does")
	}
	if ChannelMessaging(nil, func() *ChannelState { return cs }, func() int64 { return 5 }, nil) == nil {
		t.Fatal("no hook: the outbox alone")
	}
}
