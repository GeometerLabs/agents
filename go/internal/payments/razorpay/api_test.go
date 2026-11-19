package razorpay_test

// The Razorpay client against the vectors the TypeScript wrote (testdata/razorpay-vectors.json, made by go/scripts/gen_guard_vectors.ts running api.ts against a recording server):
// the same requests (method, target, headers, body bytes) and the same result or error for every answer, and the webhook reader on the fixtures.

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard/guardtest"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/razorpay"
)

type callConfig struct {
	Call struct {
		Op   string            `json:"op"`
		Args []json.RawMessage `json:"args"`
	} `json:"call"`
	AgentToken string `json:"agentToken"`
	BaseSuffix string `json:"baseSuffix"`
	Closed     bool   `json:"closed"`
	TimeoutMs  int    `json:"timeoutMs"`
}

func TestRazorpayVectors(t *testing.T) {
	for _, c := range guardtest.Load(t, "testdata/razorpay-vectors.json") {
		t.Run(c.Name, func(t *testing.T) {
			raw, _ := json.Marshal(c.Config)
			var cfg callConfig
			if err := json.Unmarshal(raw, &cfg); err != nil {
				t.Fatal(err)
			}
			srv := guardtest.Replay(c)
			defer srv.Close()
			base := srv.URL
			if cfg.Closed {
				base = guardtest.ClosedURL()
			}
			cl, err := razorpay.New(razorpay.Config{BaseURL: base + cfg.BaseSuffix, TimeoutMs: cfg.TimeoutMs, AgentToken: cfg.AgentToken})
			if err != nil {
				t.Fatal(err)
			}
			v, err := run(t, cl, cfg)
			guardtest.Check(t, c, srv, guardtest.Outcome(v, err))
		})
	}
}

// run makes the call a case names. A missing thing (a nil pointer) is JSON null, as in the vector.
func run(t *testing.T, cl *razorpay.Client, cfg callConfig) (any, error) {
	ctx := context.Background()
	arg := func(i int, into any) {
		if i < len(cfg.Call.Args) {
			if err := json.Unmarshal(cfg.Call.Args[i], into); err != nil {
				t.Fatal(err)
			}
		}
	}
	switch cfg.Call.Op {
	case "createRequest":
		var a struct {
			Amount          int64  `json:"amount"`
			ReferenceID     string `json:"reference_id"`
			Description     string `json:"description"`
			PartPayments    bool   `json:"part_payments"`
			MinFirstPayment *int64 `json:"min_first_payment"`
		}
		arg(0, &a)
		return nilOnError(cl.CreateRequest(ctx, payments.NewPaymentRequest{Amount: a.Amount, ReferenceID: a.ReferenceID, Description: a.Description, PartPayments: a.PartPayments, MinFirstPayment: a.MinFirstPayment}))
	case "fetchRequest":
		var id string
		arg(0, &id)
		r, err := cl.FetchRequest(ctx, id)
		return orNull(r, err)
	case "listRequests":
		var q struct {
			ReferenceID string `json:"reference_id"`
			PaymentID   string `json:"payment_id"`
		}
		arg(0, &q)
		return nilOnError(cl.ListRequests(ctx, payments.ListQuery{ReferenceID: q.ReferenceID, PaymentID: q.PaymentID}))
	case "cancelRequest":
		var id string
		arg(0, &id)
		return nilOnError(cl.CancelRequest(ctx, id))
	case "fetchPayment":
		var id string
		arg(0, &id)
		p, err := cl.FetchPayment(ctx, id)
		return orNull(p, err)
	case "refund":
		var id string
		var a struct {
			Amount      int64    `json:"amount"`
			Receipt     *string  `json:"receipt"`
			RequestedBy []string `json:"requestedBy"`
		}
		arg(0, &id)
		arg(1, &a)
		r := payments.RefundRequest{Amount: a.Amount, RequestedBy: a.RequestedBy}
		if a.Receipt != nil {
			r.Receipt, r.HasReceipt = *a.Receipt, true
		}
		return nilOnError(cl.Refund(ctx, id, r))
	case "resendRefund":
		var id, body string
		var by []string
		arg(0, &id)
		arg(1, &body)
		arg(2, &by)
		return nilOnError(cl.ResendRefund(ctx, id, body, by))
	case "listRefunds":
		var id string
		arg(0, &id)
		return nilOnError(cl.ListRefunds(ctx, id))
	case "readSettlements":
		var d payments.Day
		var o struct {
			PageSize int `json:"pageSize"`
		}
		var day struct{ Year, Month, Day int }
		arg(0, &day)
		arg(1, &o)
		d = payments.Day{Year: day.Year, Month: day.Month, Day: day.Day}
		return nilOnError(cl.ReadSettlements(ctx, d, o.PageSize))
	}
	t.Fatalf("unknown op %s", cfg.Call.Op)
	return nil, nil
}

func nilOnError[T any](v T, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	return v, nil
}

func orNull[T any](p *T, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, nil
	}
	return *p, nil
}

func TestWebhookVectors(t *testing.T) {
	b, err := os.ReadFile("testdata/webhook-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Parse []struct {
			Label   string          `json:"label"`
			Body    json.RawMessage `json:"body"`
			EventID string          `json:"eventId"`
			Out     json.RawMessage `json:"out"`
		} `json:"parse"`
		Secret string `json:"secret"`
		Raw    string `json:"raw"`
		Good   string `json:"good"`
		Verify []struct {
			Header *string `json:"header"`
			Secret string  `json:"secret"`
			OK     bool    `json:"ok"`
		} `json:"verify"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.Parse {
		ev, err := razorpay.ParseEvent(c.Body, c.EventID)
		if err != nil {
			t.Fatalf("%s: %v", c.Label, err)
		}
		var got, want any
		gb, _ := json.Marshal(ev) // a nil event is null
		json.Unmarshal(gb, &got)
		if len(c.Out) == 0 || string(c.Out) == "null" {
			want = nil
		} else {
			json.Unmarshal(c.Out, &want)
		}
		gj, _ := json.Marshal(got)
		wj, _ := json.Marshal(want)
		if string(gj) != string(wj) {
			t.Errorf("%s (id %q): got %s, TypeScript read %s", c.Label, c.EventID, gj, wj)
		}
	}
	if razorpay.Sign([]byte(v.Raw), v.Secret) != v.Good {
		t.Error("the signature is not what TypeScript signs")
	}
	for i, x := range v.Verify {
		if got := razorpay.Verify([]byte(v.Raw), x.Header, x.Secret); got != x.OK {
			t.Errorf("verify case %d: got %v, want %v", i, got, x.OK)
		}
	}
	if len(v.Parse) == 0 {
		t.Fatal("no vectors")
	}
}

// Money is integer paise: a fractional amount in a reply is "no amount" here, where TypeScript's `num` would pass it (a recorded difference, see Explanation.md).
func TestFractionalAmountIsRefused(t *testing.T) {
	c := guardtest.Case{Replies: []guardtest.Scripted{{Status: 200, Body: json.RawMessage(`{"id":"plink_1","amount":100.5,"currency":"INR","status":"created","short_url":"https://x","created_at":1}`)}}}
	srv := guardtest.Replay(c)
	defer srv.Close()
	cl, _ := razorpay.New(razorpay.Config{BaseURL: srv.URL})
	_, err := cl.CreateRequest(context.Background(), payments.NewPaymentRequest{Amount: 100, ReferenceID: "b-1", Description: "d"})
	if err == nil || err.Error() != "Razorpay's record has no link amount." {
		t.Fatalf("got %v", err)
	}
}
