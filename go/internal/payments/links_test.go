package payments_test

// ensureLink (links.ts) on the wire: through the Razorpay client against a recorded Guard, the requests it makes (look, create, read back, look once more) and what it gives back.

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard/guardtest"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/razorpay"
)

// ensureLink on the wire, through the Razorpay client, against the recorded exchanges.
func TestEnsureLinkVectors(t *testing.T) {
	for _, c := range guardtest.Load(t, "testdata/links-vectors.json") {
		t.Run(c.Name, func(t *testing.T) {
			raw, _ := json.Marshal(c.Config)
			var cfg struct {
				Req struct {
					Reference       string `json:"reference"`
					AmountPaise     int64  `json:"amountPaise"`
					Description     string `json:"description"`
					AcceptPartial   bool   `json:"acceptPartial"`
					MinPartialPaise *int64 `json:"minPartialPaise"`
				} `json:"req"`
				AgentToken string `json:"agentToken"`
			}
			json.Unmarshal(raw, &cfg)
			srv := guardtest.Replay(c)
			defer srv.Close()
			cl := mustNew(t, srv.URL, cfg.AgentToken)
			res, err := payments.EnsureLink(context.Background(), cl, payments.LinkRequest{Reference: cfg.Req.Reference, AmountPaise: cfg.Req.AmountPaise, Description: cfg.Req.Description, AcceptPartial: cfg.Req.AcceptPartial, MinPartialPaise: cfg.Req.MinPartialPaise})
			if err != nil {
				t.Fatal(err)
			}
			out := map[string]any{"link": res.Link}
			if res.Error != "" {
				out["error"] = res.Error
			}
			if res.Suspended != nil {
				out["suspended"] = true
			}
			guardtest.Check(t, c, srv, guardtest.Outcome(out, nil))
		})
	}
}

func mustNew(t *testing.T, url, token string) *razorpay.Client {
	cl, err := razorpay.New(razorpay.Config{BaseURL: url, TimeoutMs: 150, AgentToken: token})
	if err != nil {
		t.Fatal(err)
	}
	return cl
}
