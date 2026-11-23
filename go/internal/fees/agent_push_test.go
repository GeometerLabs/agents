package fees

// Tests of the parents' web push wrapper (agent_push.go, push.ts alsoPushTo): the words pushed are the message's words with every address out, to the parent's stable ref; the
// message itself goes on with its addresses whatever the push did; a message with nothing left to say pushes nothing; the base's buttons and pictures are kept as they were.

import (
	"context"
	"errors"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/messaging"
)

type sentMsg struct{ to, text string }

// plainMsg is a messaging with words only (no buttons, no pictures); fail makes every send fail, as a centre with no WhatsApp does.
type plainMsg struct {
	sent []sentMsg
	fail bool
}

func (m *plainMsg) SendText(_ context.Context, to, text string) (messaging.OutboundMessage, error) {
	if m.fail {
		return messaging.OutboundMessage{}, errors.New("no WhatsApp")
	}
	m.sent = append(m.sent, sentMsg{to, text})
	return messaging.OutboundMessage{ID: "m", To: to, Text: text}, nil
}
func (m *plainMsg) SendTemplate(ctx context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	return m.SendText(ctx, to, t.Text)
}
func (m *plainMsg) IsWindowOpen(context.Context, string) (bool, error) { return true, nil }
func (m *plainMsg) GetMessage(context.Context, string) (*messaging.OutboundMessage, error) {
	return nil, nil
}

type buttonsMsg struct{ *plainMsg }

func (m buttonsMsg) SendInteractive(ctx context.Context, to string, i messaging.InteractiveMessage) (messaging.OutboundMessage, error) {
	return m.SendText(ctx, to, i.Body)
}

func TestWithoutAddresses(t *testing.T) {
	for in, want := range map[string]string{
		"Fee due for March: ₹1,500.\nPay here: https://pay.example/l/abc?x=1\n\nYour page: HTTPS://partners.example/s/bright/f/0123 thanks": "Fee due for March: ₹1,500.\nPay here: \nYour page: thanks",
		"  only https://a.example/x  ":           "only",
		"https://a.example/x\u00a0next":  "next", // JavaScript's \S stops at a no-break space, and its trim takes the space off
		"see http://a.example/x\u3000and more": "see \u3000and more",
		"https://a.example/x":                    "",
		"no address at all\t\there":              "no address at all here",
		"line one\n \t \n\n\nline two":           "line one\nline two",
	} {
		if got := withoutAddresses(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

func TestAlsoPushTo(t *testing.T) {
	type pushed struct{ conversation, text string }
	var got []pushed
	push := func(c, text string) { got = append(got, pushed{c, text}) }
	const parent = "+919811111111"
	base := &plainMsg{}
	m := alsoPushTo(buttonsMsg{base}, push)
	if _, ok := m.(messaging.Interactive); !ok {
		t.Fatal("the base's buttons are kept")
	}
	if _, ok := m.(messaging.Images); ok {
		t.Fatal("no pictures are added where the base had none")
	}
	ctx := context.Background()
	_, _ = m.SendText(ctx, parent, "Reminder: https://partners.example/s/bright/f/abc")
	_, _ = m.SendTemplate(ctx, parent, messaging.TemplateMessage{Text: "Paid, thank you."})
	_, _ = m.(messaging.Interactive).SendInteractive(ctx, parent, messaging.InteractiveMessage{Body: "Pay now?"})
	_, _ = m.SendText(ctx, parent, "https://partners.example/only-a-link")
	want := []pushed{{"parent:" + ParentRef(parent), "Reminder:"}, {"parent:" + ParentRef(parent), "Paid, thank you."}, {"parent:" + ParentRef(parent), "Pay now?"}}
	if len(got) != len(want) {
		t.Fatalf("pushed %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("push %d: %v, want %v", i, got[i], want[i])
		}
	}
	if len(base.sent) != 4 || base.sent[0].text != "Reminder: https://partners.example/s/bright/f/abc" {
		t.Fatalf("every message still goes, with its link: %v", base.sent)
	}
	// a centre with no WhatsApp: the push is queued first, then the send fails as before
	got = nil
	failing := alsoPushTo(&plainMsg{fail: true}, push)
	if _, err := failing.SendText(ctx, parent, "Fee due."); err == nil || len(got) != 1 {
		t.Fatalf("the push went (%v) and the send failed (%v)", got, err)
	}
	if alsoPushTo(base, nil) != messaging.Messaging(base) {
		t.Fatal("no push: the base itself")
	}
}
