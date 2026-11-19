package payments_test

// The in-memory stand-in against the script of calls the TypeScript fake answered (testdata/fake-vectors.json): the same ids, answers, errors, links, refunds and events.

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/payments"
)

func TestFakeVectors(t *testing.T) {
	b, err := os.ReadFile("testdata/fake-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []struct {
			Name  string `json:"name"`
			Steps []struct {
				Op   string            `json:"op"`
				Args []json.RawMessage `json:"args"`
			} `json:"steps"`
			Results []any `json:"results"`
			Links   any   `json:"links"`
			Refunds any   `json:"refunds"`
			Events  any   `json:"events"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			fake := payments.NewFake(func() int64 { return 1_793_700_000_000 })
			ctx := context.Background()
			var results []any
			for _, s := range c.Steps {
				arg := func(i int, into any) {
					if i < len(s.Args) {
						json.Unmarshal(s.Args[i], into)
					}
				}
				var v any
				var err error
				switch s.Op {
				case "createRequest":
					var a struct {
						Amount          int64  `json:"amount"`
						ReferenceID     string `json:"reference_id"`
						Description     string `json:"description"`
						PartPayments    bool   `json:"part_payments"`
						MinFirstPayment *int64 `json:"min_first_payment"`
					}
					arg(0, &a)
					v, err = fake.CreateRequest(ctx, payments.NewPaymentRequest{Amount: a.Amount, ReferenceID: a.ReferenceID, Description: a.Description, PartPayments: a.PartPayments, MinFirstPayment: a.MinFirstPayment})
				case "fetchRequest":
					var id string
					arg(0, &id)
					p, e := fake.FetchRequest(ctx, id)
					v, err = p, e
				case "listRequests":
					var q struct {
						R string `json:"reference_id"`
						P string `json:"payment_id"`
					}
					arg(0, &q)
					v, err = fake.ListRequests(ctx, payments.ListQuery{ReferenceID: q.R, PaymentID: q.P})
				case "cancelRequest":
					var id string
					arg(0, &id)
					v, err = fake.CancelRequest(ctx, id)
				case "fetchPayment":
					var id string
					arg(0, &id)
					p, e := fake.FetchPayment(ctx, id)
					v, err = p, e
				case "customerPays":
					var id string
					var o struct {
						Amount int64 `json:"amount"`
					}
					arg(0, &id)
					arg(1, &o)
					v, err = fake.CustomerPays(id, o.Amount)
				case "refund":
					var id string
					var a struct {
						Amount  int64   `json:"amount"`
						Receipt *string `json:"receipt"`
					}
					arg(0, &id)
					arg(1, &a)
					r := payments.RefundRequest{Amount: a.Amount}
					if a.Receipt != nil {
						r.Receipt, r.HasReceipt = *a.Receipt, true
					}
					v, err = fake.Refund(ctx, id, r)
				case "resendRefund":
					var id, body string
					arg(0, &id)
					arg(1, &body)
					v, err = fake.ResendRefund(ctx, id, body, nil)
				case "listRefunds":
					var id string
					arg(0, &id)
					v, err = fake.ListRefunds(ctx, id)
				default:
					t.Fatalf("unknown op %s", s.Op)
				}
				if err != nil {
					e := map[string]any{"name": guard.Name(err), "message": err.Error()}
					if st, ok := guard.IsAPI(err); ok {
						e["status"] = st
					}
					results = append(results, map[string]any{"error": e})
				} else {
					results = append(results, map[string]any{"ok": v})
				}
			}
			chk := func(label string, want, got any) {
				if !reflect.DeepEqual(norm(want), norm(got)) {
					wb, _ := json.MarshalIndent(want, "", " ")
					gb, _ := json.MarshalIndent(norm(got), "", " ")
					t.Errorf("%s differs\nTypeScript: %s\nGo: %s", label, wb, gb)
				}
			}
			chk("results", c.Results, results)
			chk("links", c.Links, fake.Links())
			chk("refunds", c.Refunds, fake.AllRefunds())
			chk("events", c.Events, fake.Events)
		})
	}
}

func norm(v any) any {
	b, _ := json.Marshal(v)
	var out any
	json.Unmarshal(b, &out)
	return out
}
