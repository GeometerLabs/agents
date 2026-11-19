package messaging_test

// The in-memory fake and the "fakes" stand-in against the TypeScript's answers (testdata/fake-vectors.json): step by step, the same ids, window rule, errors, faults and copies.

import (
	"encoding/json"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard/guardtest"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

type fakeStep struct {
	Op        string            `json:"op"`
	Args      []json.RawMessage `json:"args"`
	AdvanceMs int64             `json:"advanceMs"`
	From      string            `json:"from"`
	Text      string            `json:"text"`
	Options   json.RawMessage   `json:"options"`
	Name      string            `json:"name"`
	Language  string            `json:"language"`
	OpName    string            `json:"opName"`
	Mode      string            `json:"mode"`
	Number    string            `json:"number"`
	Method    string            `json:"method"`
}

func TestFakeVectors(t *testing.T) {
	var f struct {
		Cases []struct {
			Name    string          `json:"name"`
			StandIn *[]string       `json:"standIn"`
			NowMs   int64           `json:"nowMs"`
			Steps   []fakeStep      `json:"steps"`
			Results json.RawMessage `json:"results"`
		} `json:"cases"`
	}
	readJSON(t, "testdata/fake-vectors.json", &f)
	if len(f.Cases) == 0 {
		t.Fatal("no vectors")
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			now := c.NowMs
			clock := func() int64 { return now }
			var said []string
			var m messaging.Messaging
			var fake *messaging.Fake
			if c.StandIn != nil {
				m = messaging.NewStandIn(clock, *c.StandIn, func(l string) { said = append(said, l) })
			} else {
				fake = messaging.NewFake(clock)
				m = fake
			}
			results := []any{}
			for _, s := range c.Steps {
				now += s.AdvanceMs
				before := len(said)
				var v any
				var err error
				switch s.Op {
				case "advance":
				case "receive":
					var o struct {
						ID        *string                  `json:"id"`
						Reply     *messaging.Reply         `json:"reply"`
						Image     bool                     `json:"image"`
						VoiceNote bool                     `json:"voiceNote"`
						Media     *messaging.VoiceMediaRef `json:"media"`
					}
					if len(s.Options) > 0 {
						json.Unmarshal(s.Options, &o)
					}
					v = fake.Receive(s.From, s.Text, messaging.ReceiveOptions{ID: o.ID, Reply: o.Reply, Image: o.Image, VoiceNote: o.VoiceNote, Media: o.Media})
				case "approve":
					fake.Approve(s.Name, s.Language)
				case "inject":
					var o struct{ Times, After *int }
					if len(s.Options) > 0 {
						json.Unmarshal(s.Options, &o)
					}
					fake.Inject(s.OpName, s.Mode, messaging.FaultOptions{Times: o.Times, After: o.After})
				case "outbox":
					v = fake.Outbox()
				case "sentTo":
					v = fake.SentTo(s.Number)
				case "isOptedOut":
					v = fake.IsOptedOut(s.Number)
				case "has":
					v = has(m, s.Method)
				default:
					var ok bool
					v, err, ok = step(t, m, liveStep{Op: s.Op, Args: s.Args})
					if !ok {
						t.Fatalf("%s: no %s here", c.Name, s.Op)
					}
				}
				entry := map[string]any{"said": append([]string{}, said[before:]...)}
				if err != nil {
					entry["error"] = guardtest.DescribeError(err)
				} else {
					entry["ok"] = v
				}
				results = append(results, entry)
			}
			same(t, c.Name, results, json.RawMessage(c.Results))
		})
	}
}

// has is the scenario's `typeof fake[method] === "function"`.
func has(m messaging.Messaging, method string) bool {
	switch method {
	case "sendText", "sendTemplate", "isWindowOpen", "getMessage":
		return true
	case "sendInteractive":
		_, ok := m.(messaging.Interactive)
		return ok
	case "sendDocument":
		_, ok := m.(messaging.Documents)
		return ok
	case "sendImage":
		_, ok := m.(messaging.Images)
		return ok
	case "sendSticker":
		_, ok := m.(messaging.Stickers)
		return ok
	case "ping":
		_, ok := m.(messaging.Pinger)
		return ok
	case "receive":
		_, ok := m.(interface {
			Receive(string, string, messaging.ReceiveOptions) messaging.InboundMessage
		})
		return ok
	case "outbox":
		_, ok := m.(interface {
			Outbox() []messaging.OutboundMessage
		})
		return ok
	}
	return false
}
