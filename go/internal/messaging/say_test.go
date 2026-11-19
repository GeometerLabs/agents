package messaging_test

// say against the TypeScript (testdata/say-vectors.json): for each scripted scenario, every record line, every messaging call (in order) and the result, for Say and for Outcome.
// The deps here are the scenario's: a voice that renders from a table, a gate that blocks on a word, a messaging that answers from a script.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/messaging"
)

type sayEnv struct {
	Owner    messaging.OwnerInfo `json:"owner"`
	Language string              `json:"language"`
	OptedOut bool                `json:"optedOut"`
	Render   map[string]string   `json:"render"`
	Matches  []struct {
		Contains string `json:"contains"`
		RuleID   string `json:"ruleId"`
		Verdict  string `json:"verdict"`
		Reason   string `json:"reason"`
	} `json:"matches"`
	HasInteractive bool                   `json:"hasInteractive"`
	Interactive    json.RawMessage        `json:"interactive"`
	Gates          []messaging.Decision   `json:"gates"`
	InputsOf       map[string]any         `json:"inputsOf"`
	Moment         *string                `json:"moment"`
	HasMoment      bool                   `json:"hasMoment"`
	FactsThrows    bool                   `json:"factsThrows"`
	HeldBackThrows bool                   `json:"heldBackThrows"`
	TemplateThrows bool                   `json:"templateThrows"`
	Generic        messaging.GenericNames `json:"generic"`
}

type sayArgs struct {
	Booking   any                  `json:"booking"`
	Phone     string               `json:"phone"`
	To        string               `json:"to"`
	Templates []string             `json:"templates"`
	Shown     []messaging.Decision `json:"shown"`
	Reminder  bool                 `json:"reminder"`
	Action    string               `json:"action"`
	Offer     *messaging.Offer     `json:"offer"`
	Image     *struct {
		Link    string   `json:"link"`
		Caption []string `json:"caption"`
	} `json:"image"`
}

type sayMessaging struct {
	Caps   []string            `json:"caps"`
	Window json.RawMessage     `json:"window"`
	Send   map[string]*errSpec `json:"send"`
	Seen   json.RawMessage     `json:"seen"`
}

// stub is the scenario's messaging: it writes down each call and answers from the script.
type stub struct {
	t     *testing.T
	m     sayMessaging
	trace *[]any
	n     int
}

func (s *stub) fail(op string) error {
	if e := s.m.Send[op]; e != nil {
		return makeError(s.t, *e)
	}
	return nil
}

func (s *stub) made(to, kind, text string) messaging.OutboundMessage {
	s.n++
	return messaging.OutboundMessage{ID: "wamid.out_" + itoa(s.n), To: to, Kind: kind, Text: text}
}

func (s *stub) add(m map[string]any) { *s.trace = append(*s.trace, m) }

func (s *stub) SendText(_ context.Context, to, text string) (messaging.OutboundMessage, error) {
	s.add(map[string]any{"call": "sendText", "to": to, "text": text})
	if err := s.fail("sendText"); err != nil {
		return messaging.OutboundMessage{}, err
	}
	return s.made(to, "text", text), nil
}

func (s *stub) SendTemplate(_ context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	s.add(map[string]any{"call": "sendTemplate", "to": to, "template": t})
	if err := s.fail("sendTemplate"); err != nil {
		return messaging.OutboundMessage{}, err
	}
	return s.made(to, "template", t.Text), nil
}

func (s *stub) IsWindowOpen(_ context.Context, to string) (bool, error) {
	s.add(map[string]any{"call": "isWindowOpen", "to": to})
	if string(s.m.Window) == `"throws"` {
		return false, errors.New("window store broke")
	}
	return string(s.m.Window) == "true", nil
}

func (s *stub) GetMessage(_ context.Context, id string) (*messaging.OutboundMessage, error) {
	s.add(map[string]any{"call": "getMessage", "id": id})
	switch string(s.m.Seen) {
	case `"throws"`:
		return nil, errors.New("read-back broke")
	case "true":
		return &messaging.OutboundMessage{ID: id}, nil
	}
	return nil, nil
}

type withInteractive struct{ *stub }

func (s withInteractive) SendInteractive(_ context.Context, to string, m messaging.InteractiveMessage) (messaging.OutboundMessage, error) {
	s.add(map[string]any{"call": "sendInteractive", "to": to, "message": m})
	if err := s.fail("sendInteractive"); err != nil {
		return messaging.OutboundMessage{}, err
	}
	return s.made(to, "interactive", messaging.InteractiveText(m)), nil
}

type withImage struct{ *stub }

func (s withImage) SendImage(_ context.Context, to string, i messaging.ImageMessage) (messaging.OutboundMessage, error) {
	s.add(map[string]any{"call": "sendImage", "to": to, "image": i})
	if err := s.fail("sendImage"); err != nil {
		return messaging.OutboundMessage{}, err
	}
	text := ""
	if i.Caption != nil {
		text = *i.Caption
	}
	return s.made(to, "image", text), nil
}

type withBoth struct{ *stub }

func (s withBoth) SendInteractive(ctx context.Context, to string, m messaging.InteractiveMessage) (messaging.OutboundMessage, error) {
	return withInteractive{s.stub}.SendInteractive(ctx, to, m)
}
func (s withBoth) SendImage(ctx context.Context, to string, i messaging.ImageMessage) (messaging.OutboundMessage, error) {
	return withImage{s.stub}.SendImage(ctx, to, i)
}

type voice struct{ env *sayEnv }

func (v voice) Render(id string, _ any) (string, error) {
	t, ok := v.env.Render[id]
	if !ok {
		return "", errors.New("There is no text for " + id + ".")
	}
	return t, nil
}

func (v voice) TemplateMessage(a messaging.TemplateArgs) (messaging.TemplateMessage, error) {
	if v.env.TemplateThrows {
		return messaging.TemplateMessage{}, errors.New("This message has no approved template.")
	}
	return messaging.TemplateMessage{Name: "t_" + a.Generic, Language: a.Language, Text: a.Text, Parameters: a.IDs}, nil
}

func (v voice) GenericNames() messaging.GenericNames { return v.env.Generic }

func (v voice) Matches(text string, _ any) messaging.Decision {
	for _, m := range v.env.Matches {
		if strings.Contains(text, m.Contains) {
			return messaging.Decision{RuleID: m.RuleID, Verdict: m.Verdict, Reason: m.Reason}
		}
	}
	return messaging.Decision{RuleID: "message-matches-record", Verdict: "allow", Reason: "Every amount is in the record."}
}

func TestSayVectors(t *testing.T) {
	var f struct {
		Cases []struct {
			Name string `json:"name"`
			Spec struct {
				Args      sayArgs      `json:"args"`
				Env       sayEnv       `json:"env"`
				Messaging sayMessaging `json:"messaging"`
			} `json:"spec"`
			Say     sayRun `json:"say"`
			Outcome sayRun `json:"outcome"`
		} `json:"cases"`
	}
	readJSON(t, "testdata/say-vectors.json", &f)
	if len(f.Cases) < 80 {
		t.Fatalf("too few scenarios: %d", len(f.Cases))
	}
	for _, c := range f.Cases {
		for _, fn := range []string{"say", "outcome"} {
			t.Run(c.Name+" / "+fn, func(t *testing.T) {
				var trace []any
				env := c.Spec.Env
				s := &stub{t: t, m: c.Spec.Messaging, trace: &trace}
				var m messaging.Messaging = s
				caps := strings.Join(c.Spec.Messaging.Caps, ",")
				switch {
				case strings.Contains(caps, "interactive") && strings.Contains(caps, "image"):
					m = withBoth{s}
				case strings.Contains(caps, "interactive"):
					m = withInteractive{s}
				case strings.Contains(caps, "image"):
					m = withImage{s}
				}
				deps := messaging.SayDeps{
					Messaging: m, Voice: voice{&env}, Owner: env.Owner,
					LanguageOf: func(string, any) string { return env.Language },
					OptedOut:   func(string) bool { return env.OptedOut },
					FactsFor: func(_ *messaging.SayArgs, l string) (any, error) {
						if env.FactsThrows {
							return nil, errors.New("the facts could not be made")
						}
						return map[string]any{"language": l}, nil
					},
					Log: func(booking any, phone, action, outcome string, inputs map[string]any, more messaging.LogMore) {
						mm := map[string]any{"language": more.Language}
						if more.Decisions != nil {
							mm["decisions"] = more.Decisions
						}
						if more.Notes != nil {
							mm["notes"] = *more.Notes
						}
						if more.Refs != nil {
							mm["refs"] = more.Refs
						}
						trace = append(trace, map[string]any{"call": "log", "booking": booking, "phone": phone, "action": action, "outcome": outcome, "inputs": inputs, "more": mm})
					},
					HeldBack: func(context.Context, *messaging.SayArgs) error {
						trace = append(trace, map[string]any{"call": "heldBack"})
						if env.HeldBackThrows {
							return errors.New("the owner could not be told")
						}
						return nil
					},
				}
				if env.HasInteractive {
					deps.InteractiveFor = func(*messaging.SayArgs, any, string) (*messaging.InteractiveMessage, error) {
						if string(env.Interactive) == `"throws"` {
							return nil, errors.New("no buttons for this")
						}
						var im messaging.InteractiveMessage
						if err := json.Unmarshal(env.Interactive, &im); err != nil {
							t.Fatal(err)
						}
						return &im, nil
					}
				}
				if env.Gates != nil {
					deps.Gates = func(*messaging.SayArgs, bool) []messaging.Decision { return env.Gates }
				}
				if env.InputsOf != nil {
					deps.InputsOf = func(*messaging.SayArgs) map[string]any { return env.InputsOf }
				}
				if env.HasMoment {
					deps.Moment = func(*messaging.SayArgs) string {
						if env.Moment == nil {
							return ""
						}
						return *env.Moment
					}
					deps.MarkMoment = func(id, moment string) {
						trace = append(trace, map[string]any{"call": "markMoment", "id": id, "moment": moment})
					}
				}
				a := &messaging.SayArgs{Booking: c.Spec.Args.Booking, Phone: c.Spec.Args.Phone, To: c.Spec.Args.To, Templates: c.Spec.Args.Templates, Shown: c.Spec.Args.Shown, Reminder: c.Spec.Args.Reminder, Action: c.Spec.Args.Action, Offer: c.Spec.Args.Offer}
				if im := c.Spec.Args.Image; im != nil {
					a.Image = &messaging.SayImage{Link: im.Link, Caption: im.Caption}
				}
				say := messaging.NewSay(deps)
				var result any
				var err error
				want := c.Say
				if fn == "say" {
					var v bool
					v, err = say.Say(context.Background(), a)
					result = map[string]any{"value": v}
				} else {
					var v string
					v, err = say.Outcome(context.Background(), a)
					result = map[string]any{"value": v}
					want = c.Outcome
				}
				if err != nil {
					result = map[string]any{"error": err.Error()}
				}
				same(t, "result", result, want.Result)
				for k := 0; k < len(trace) || k < len(want.Trace); k++ {
					var got, w any
					if k < len(trace) {
						got = trace[k]
					}
					if k < len(want.Trace) {
						w = want.Trace[k]
					}
					same(t, "call "+itoa(k), got, w)
				}
			})
		}
	}
}

type sayRun struct {
	Result json.RawMessage   `json:"result"`
	Trace  []json.RawMessage `json:"trace"`
}
