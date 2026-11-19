package messaging_test

// The webhook readers against the TypeScript's answers (testdata/webhook-vectors.json): the four fixtures and made-up bodies for messages, statuses (Meta's, Gupshup's v3 and
// self-serve), toE164, mediaOf and Meta's signature; plus the two differences Go cannot reproduce (a cut inside a surrogate pair, a time past 2^53 milliseconds).

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

func decodeBody(t *testing.T, raw json.RawMessage) any {
	t.Helper()
	v, err := guard.Decode(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestWebhookVectors(t *testing.T) {
	var v struct {
		Parse []struct {
			Label   string          `json:"label"`
			Body    json.RawMessage `json:"body"`
			Options *struct {
				VoiceMedia bool `json:"voiceMedia"`
			} `json:"options"`
			Out json.RawMessage `json:"out"`
		} `json:"parse"`
		Statuses []struct {
			Label string          `json:"label"`
			Body  json.RawMessage `json:"body"`
			Out   json.RawMessage `json:"out"`
		} `json:"statuses"`
		ToE164 []struct {
			From json.RawMessage `json:"from"`
			Out  *string         `json:"out"`
		} `json:"toE164"`
		MediaOf []struct {
			Audio json.RawMessage `json:"audio"`
			Out   json.RawMessage `json:"out"`
		} `json:"mediaOf"`
		Raw    string `json:"raw"`
		Secret string `json:"secret"`
		Signed string `json:"signed"`
		Verify []struct {
			Header *string `json:"header"`
			Secret string  `json:"secret"`
			Out    bool    `json:"out"`
		} `json:"verify"`
		SelfServe []struct {
			Label       string          `json:"label"`
			Body        json.RawMessage `json:"body"`
			IsSelfServe *bool           `json:"isSelfServe"`
			AppName     *string         `json:"appName"`
		} `json:"selfServe"`
	}
	readJSON(t, "testdata/webhook-vectors.json", &v)
	if len(v.Parse) < 50 || len(v.Statuses) < 30 {
		t.Fatalf("too few vectors: %d %d", len(v.Parse), len(v.Statuses))
	}
	for _, c := range v.Parse {
		opts := messaging.ParseOptions{}
		if c.Options != nil {
			opts.VoiceMedia = c.Options.VoiceMedia
		}
		same(t, "messages: "+c.Label, messaging.ParseWhatsAppWebhook(decodeBody(t, c.Body), opts), c.Out)
	}
	for _, c := range v.Statuses {
		same(t, "statuses: "+c.Label, messaging.ParseWhatsAppStatuses(decodeBody(t, c.Body)), c.Out)
	}
	for _, c := range v.ToE164 {
		got := messaging.ToE164(decodeBody(t, c.From))
		if (c.Out == nil) != (got == "") || (c.Out != nil && *c.Out != got) {
			t.Errorf("toE164(%s): Go %q, TypeScript %v", c.From, got, c.Out)
		}
	}
	for _, c := range v.MediaOf {
		same(t, "mediaOf "+string(c.Audio), messaging.MediaOf(decodeBody(t, c.Audio)), c.Out)
	}
	if got := messaging.SignMeta([]byte(v.Raw), v.Secret); got != v.Signed {
		t.Errorf("signature: Go %s, TypeScript %s", got, v.Signed)
	}
	for i, c := range v.Verify {
		if got := messaging.VerifyMetaSignature([]byte(v.Raw), c.Header, c.Secret); got != c.Out {
			t.Errorf("verify %d (%v): Go %v, TypeScript %v", i, c.Header, got, c.Out)
		}
	}
	for _, c := range v.SelfServe {
		b, ok := guard.IsObject(decodeBody(t, c.Body))
		if !ok {
			continue
		}
		if got := messaging.IsGupshupSelfServe(b); c.IsSelfServe == nil || got != *c.IsSelfServe {
			t.Errorf("isGupshupSelfServe %s: Go %v, TypeScript %v", c.Label, got, c.IsSelfServe)
		}
		name := messaging.SelfServeAppName(b)
		if (c.AppName == nil) != (name == "") || (c.AppName != nil && *c.AppName != name) {
			t.Errorf("selfServeAppName %s: Go %q, TypeScript %v", c.Label, name, c.AppName)
		}
	}
}

// A failed status's title cut inside a surrogate pair: JavaScript's slice(0, 200) keeps a lone surrogate, which no Go string holds, so the half character is dropped. The cut
// text is otherwise the TypeScript's (the vector "after an astral pair at the limit" holds both neighbours of this case).
func TestTitleCutInsideASurrogatePairDropsTheHalf(t *testing.T) {
	title := strings.Repeat("x", 199) + "😀"
	body := guard.Object{"entry": []any{guard.Object{"changes": []any{guard.Object{"field": "messages", "value": guard.Object{"statuses": []any{guard.Object{"id": "wamid.1", "status": "failed", "timestamp": "1", "errors": []any{guard.Object{"code": json.Number("1"), "title": title}}}}}}}}}}
	got := messaging.ParseWhatsAppStatuses(body)
	if len(got) != 1 || got[0].Error == nil || got[0].Error.Title != strings.Repeat("x", 199) {
		t.Fatalf("got %+v", got)
	}
}

// A time past 2^53 milliseconds is held at 2^53 (whole milliseconds as an int64); the TypeScript would keep the exact huge number. Either way the Date the record needs is invalid.
func TestHugeTimesAreHeld(t *testing.T) {
	body := guard.Object{"entry": []any{guard.Object{"changes": []any{guard.Object{"field": "messages", "value": guard.Object{"statuses": []any{guard.Object{"id": "wamid.1", "status": "read", "timestamp": json.Number("1e300")}}}}}}}}
	got := messaging.ParseWhatsAppStatuses(body)
	if len(got) != 1 || got[0].Timestamp != 1<<53 {
		t.Fatalf("got %+v", got)
	}
}
