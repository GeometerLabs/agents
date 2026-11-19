package messaging_test

// The three live clients against the vectors the TypeScript wrote (testdata/live-vectors.json, made by go/scripts/gen_guard_vectors.ts running the REAL clients against a recording
// server): for every script the same requests (method, target, headers, body bytes) and, for every step, the same result or error. Also the sent copy's bound of 1000.

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/guard/guardtest"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

type liveStep struct {
	Op        string            `json:"op"`
	Args      []json.RawMessage `json:"args"`
	AdvanceMs int64             `json:"advanceMs"`
}

type liveConfig struct {
	Provider      string           `json:"provider"`
	NowMs         int64            `json:"nowMs"`
	Windows       map[string]int64 `json:"windows"`
	Steps         []liveStep       `json:"steps"`
	AgentToken    string           `json:"agentToken"`
	PhoneNumberID string           `json:"phoneNumberId"`
	AppID         string           `json:"appId"`
	AppName       string           `json:"appName"`
	SourceNumber  string           `json:"sourceNumber"`
	BaseSuffix    string           `json:"baseSuffix"`
	Closed        bool             `json:"closed"`
	TimeoutMs     int              `json:"timeoutMs"`
}

type windows map[string]int64

func (w windows) LastInboundAt(p string) (int64, bool) { v, ok := w[p]; return v, ok }

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func arg[T any](t *testing.T, s liveStep, i int) T {
	t.Helper()
	var v T
	if i < len(s.Args) {
		if err := json.Unmarshal(s.Args[i], &v); err != nil {
			t.Fatal(err)
		}
	}
	return v
}

// step runs one step on a client. ok false is a method the client does not have (TypeScript: `typeof client[op] !== "function"`).
func step(t *testing.T, c messaging.Messaging, s liveStep) (v any, err error, has bool) {
	ctx := context.Background()
	switch s.Op {
	case "sendText":
		v, err = c.SendText(ctx, arg[string](t, s, 0), arg[string](t, s, 1))
		return v, err, true
	case "sendTemplate":
		v, err = c.SendTemplate(ctx, arg[string](t, s, 0), arg[messaging.TemplateMessage](t, s, 1))
		return v, err, true
	case "isWindowOpen":
		v, err = c.IsWindowOpen(ctx, arg[string](t, s, 0))
		return v, err, true
	case "getMessage":
		m, e := c.GetMessage(ctx, arg[string](t, s, 0))
		if m == nil {
			return nil, e, true
		}
		return *m, e, true
	case "sendInteractive":
		i, ok := c.(messaging.Interactive)
		if !ok {
			return nil, nil, false
		}
		v, err = i.SendInteractive(ctx, arg[string](t, s, 0), arg[messaging.InteractiveMessage](t, s, 1))
		return v, err, true
	case "sendDocument":
		i, ok := c.(messaging.Documents)
		if !ok {
			return nil, nil, false
		}
		v, err = i.SendDocument(ctx, arg[string](t, s, 0), arg[messaging.DocumentMessage](t, s, 1))
		return v, err, true
	case "sendImage":
		i, ok := c.(messaging.Images)
		if !ok {
			return nil, nil, false
		}
		v, err = i.SendImage(ctx, arg[string](t, s, 0), arg[messaging.ImageMessage](t, s, 1))
		return v, err, true
	case "sendSticker":
		i, ok := c.(messaging.Stickers)
		if !ok {
			return nil, nil, false
		}
		v, err = i.SendSticker(ctx, arg[string](t, s, 0), arg[messaging.StickerMessage](t, s, 1))
		return v, err, true
	case "ping":
		i, ok := c.(messaging.Pinger)
		if !ok {
			return nil, nil, false
		}
		r, e := i.Ping(ctx)
		if e != nil {
			return nil, e, true
		}
		m := map[string]any{"status": r.Status}
		if r.Body != nil {
			m["body"] = r.Body
		}
		if r.Replayed {
			m["replayed"] = true
		}
		return m, nil, true
	}
	t.Fatalf("unknown op %s", s.Op)
	return nil, nil, false
}

func TestLiveVectors(t *testing.T) {
	for _, c := range guardtest.Load(t, "testdata/live-vectors.json") {
		t.Run(c.Name, func(t *testing.T) {
			raw, _ := json.Marshal(c.Config)
			var cfg liveConfig
			if err := json.Unmarshal(raw, &cfg); err != nil {
				t.Fatal(err)
			}
			srv := guardtest.Replay(c)
			defer srv.Close()
			base := srv.URL
			if cfg.Closed {
				base = guardtest.ClosedURL()
			}
			now := cfg.NowMs
			deps := messaging.Deps{Clock: func() int64 { return now }, Window: windows(cfg.Windows)}
			lc := messaging.LiveConfig{BaseURL: base + cfg.BaseSuffix, PhoneNumberID: cfg.PhoneNumberID, AgentToken: cfg.AgentToken, TimeoutMs: cfg.TimeoutMs}
			switch cfg.Provider {
			case "gupshup":
				lc.Provider = "gupshup"
			case "selfserve":
				lc.Provider = "gupshup-selfserve"
			}
			lc.AppID, lc.AppName, lc.SourceNumber = optional(cfg.AppID), optional(cfg.AppName), optional(cfg.SourceNumber)
			results := []any{}
			client, err := messaging.NewLive(lc, deps)
			if err != nil {
				results = append(results, guardtest.Outcome(nil, err))
			} else {
				for _, s := range cfg.Steps {
					now += s.AdvanceMs
					v, err, has := step(t, client, s)
					switch {
					case !has:
						results = append(results, map[string]any{"missing": true})
					default:
						results = append(results, guardtest.Outcome(v, err))
					}
				}
			}
			guardtest.Check(t, c, srv, guardtest.Outcome(results, nil))
		})
	}
}

// stubHTTP answers every call with the same reply (a client over an Http that is not a network, for the bound on the sent copy).
type stubHTTP struct{ n int }

func (s *stubHTTP) Request(_ context.Context, _, _ string, _ guard.Options) (guard.Reply, error) {
	s.n++
	return guard.Reply{Status: 200, Body: guard.Object{"messages": []any{guard.Object{"id": "wamid." + guard.Itoa(int64(s.n))}}}}, nil
}

func TestSentCopyIsBoundedTo1000(t *testing.T) {
	var want struct {
		Eviction struct {
			Sends  int    `json:"sends"`
			First  any    `json:"first"`
			Second string `json:"second"`
			Last   string `json:"last"`
		} `json:"eviction"`
	}
	readJSON(t, "testdata/misc-vectors.json", &want)
	c := messaging.NewCloudAPI(&stubHTTP{}, messaging.Wire{Name: "WhatsApp", SendPath: "/x", PingPath: "/x", DescribeError: messaging.DescribeMetaError}, messaging.Deps{Clock: func() int64 { return 5 }, Window: windows{"+91": 1}})
	ctx := context.Background()
	for i := 0; i < want.Eviction.Sends; i++ {
		if _, err := c.SendText(ctx, "+91", "x"); err != nil {
			t.Fatal(err)
		}
	}
	first, _ := c.GetMessage(ctx, "wamid.1")
	second, _ := c.GetMessage(ctx, "wamid.2")
	last, _ := c.GetMessage(ctx, "wamid.1001")
	if want.Eviction.First != nil || first != nil {
		t.Errorf("the first message should be gone: Go %v, TypeScript %v", first, want.Eviction.First)
	}
	if second == nil || last == nil || want.Eviction.Second != "present" || want.Eviction.Last != "present" {
		t.Errorf("the second and last should be kept: Go %v %v", second, last)
	}
}
