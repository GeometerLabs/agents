// Proves the Go owner-marked ledger equal to the TypeScript's (modules/payments/owner-marked) on testdata/vectors.json, made by running the TypeScript
// (go/scripts/gen_ownermarked_vectors.ts): every scenario step's result and the whole state after it, the replies the owner might type, and the words of the no-gateway placeholder.
// The codes are the TypeScript's draws replayed (`rolls`), so a code is the same text on both sides.
package ownermarked

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/payments"
)

type vecFile struct {
	Alphabet  string `json:"alphabet"`
	Scenarios []struct {
		Name   string           `json:"name"`
		Rolls  []int            `json:"rolls"`
		Steps  []map[string]any `json:"steps"`
		LeftOn []struct {
			ID   string `json:"id"`
			Left int64  `json:"left"`
		} `json:"leftOn"`
	} `json:"scenarios"`
	Replies []struct {
		Text string `json:"text"`
		ID   string `json:"id"`
		Out  any    `json:"out"`
	} `json:"replies"`
	NoGateway map[string]string `json:"noGateway"`
}

func load(t *testing.T) vecFile {
	t.Helper()
	b, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vecFile
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// asAny is what the JSON of v reads back as, so it compares with what JSON.parse gave.
func asAny(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func num(m map[string]any, k string) int64 { f, _ := m[k].(float64); return int64(f) }

func payLink(amount int64, note string) (string, error) {
	if strings.Contains(note, "BAD") {
		return "", errors.New("The note is not one a UPI app would take.")
	}
	return "upi://pay?am=" + strconv.FormatInt(amount, 10) + "&tn=" + note, nil
}

func TestScenarios(t *testing.T) {
	v := load(t)
	for _, sc := range v.Scenarios {
		t.Run(sc.Name, func(t *testing.T) {
			drawn := 0
			codes := func() string {
				out := make([]byte, 6)
				for i := range out {
					out[i] = v.Alphabet[sc.Rolls[drawn%len(sc.Rolls)]]
					drawn++
				}
				return string(out)
			}
			state := Empty()
			var now int64
			view := View{State: state, PayLink: payLink, Now: func() int64 { return now }, Codes: codes}
			for i, st := range sc.Steps {
				now = num(st, "now")
				var got any
				switch st["op"] {
				case "open":
					req := st["req"].(map[string]any)
					r, err := OpenRequest(state, payLink, NewRequest{AmountPaise: num(req, "amount"), Reference: req["reference_id"].(string), Description: req["description"].(string), PartPayments: req["part_payments"] == true}, now, codes)
					if err != nil {
						got = map[string]any{"threw": err.Error(), "class": "Error"}
					} else {
						got = asAny(t, r)
					}
				case "mark":
					var amt *int64
					if _, ok := st["amountPaise"]; ok {
						a := num(st, "amountPaise")
						amt = &a
					}
					got = markResult(t, MarkReceived(state, st["code"].(string), amt, now, codes))
				case "markRefund":
					r := MarkRefund(state, st["code"].(string), st["how"].(string), now)
					m := map[string]any{"kind": r.Kind}
					if r.Refund != nil {
						m["refund"] = asAny(t, r.Refund)
					}
					got = m
				case "owe":
					rf := st["refund"].(map[string]any)
					nr := NewRefund{CaseID: rf["caseId"].(string), Customer: rf["customer"].(string), PaymentID: rf["paymentId"].(string), AmountPaise: num(rf, "amountPaise"), Why: rf["why"].(string), KeepAllowed: rf["keepAllowed"] == true}
					got = asAny(t, OweRefund(state, nr, now, codes))
				case "close":
					r := findReq(state, st["id"].(string))
					CloseRequest(r, now)
					got = asAny(t, r)
				case "due":
					ids := []any{}
					for _, r := range RemindersDue(state, now) {
						ids = append(ids, r.ID)
					}
					got = ids
				case "reminded":
					for _, r := range state.Refunds {
						if r.ID == st["id"] {
							Reminded(r, now)
							got = asAny(t, r)
						}
					}
				case "owedOn":
					got = float64(OwedOn(state, st["paymentId"].(string)))
				case "requestOfMark":
					if r := RequestOfMark(state, st["paymentId"].(string)); r != nil {
						got = asAny(t, r)
					}
				case "view":
					got = viewCall(t, view, st)
				default:
					t.Fatalf("step %d: unknown op %v", i, st["op"])
				}
				if !reflect.DeepEqual(got, st["result"]) {
					t.Fatalf("step %d (%v): result\n got %s\nwant %s", i, st["op"], jsn(got), jsn(st["result"]))
				}
				if gs := asAny(t, state); !reflect.DeepEqual(gs, st["state"]) {
					t.Fatalf("step %d (%v): state\n got %s\nwant %s", i, st["op"], jsn(gs), jsn(st["state"]))
				}
			}
			for _, w := range sc.LeftOn {
				if l := LeftOn(findReq(state, w.ID)); l != w.Left {
					t.Errorf("leftOn %s = %d, want %d", w.ID, l, w.Left)
				}
			}
		})
	}
}

func jsn(v any) string { b, _ := json.Marshal(v); return string(b) }

func findReq(s *State, id string) *MarkedRequest {
	for _, r := range s.Requests {
		if r.ID == id {
			return r
		}
	}
	return nil
}

func markResult(t *testing.T, r MarkResult) any {
	m := map[string]any{"kind": r.Kind}
	if r.Request != nil {
		m["request"] = asAny(t, r.Request)
	}
	if r.Refund != nil {
		m["refund"] = asAny(t, r.Refund)
	}
	if r.Kind == Marked {
		m["mark"] = asAny(t, r.Mark)
		m["full"], m["afterClose"] = r.Full, r.AfterClose
	}
	return m
}

func viewCall(t *testing.T, v View, st map[string]any) any {
	ctx := context.Background()
	fail := func(err error) any {
		var op *OwnerPaysError
		class := "Error"
		if errors.As(err, &op) {
			class = "OwnerPaysError"
		}
		return map[string]any{"threw": err.Error(), "class": class}
	}
	id, _ := st["id"].(string)
	switch st["call"] {
	case "createRequest":
		req := st["req"].(map[string]any)
		r, err := v.CreateRequest(ctx, payments.NewPaymentRequest{Amount: num(req, "amount"), ReferenceID: req["reference_id"].(string), Description: req["description"].(string), PartPayments: req["part_payments"] == true})
		if err != nil {
			return fail(err)
		}
		return asAny(t, r)
	case "fetchRequest":
		r, err := v.FetchRequest(ctx, id)
		if err != nil {
			return fail(err)
		}
		return asAny(t, r)
	case "listRequests":
		q := payments.ListQuery{}
		if m, ok := st["query"].(map[string]any); ok {
			q.ReferenceID, _ = m["reference_id"].(string)
			q.PaymentID, _ = m["payment_id"].(string)
		}
		r, err := v.ListRequests(ctx, q)
		if err != nil {
			return fail(err)
		}
		return asAny(t, r)
	case "cancelRequest":
		r, err := v.CancelRequest(ctx, id)
		if err != nil {
			return fail(err)
		}
		return asAny(t, r)
	case "fetchPayment":
		r, err := v.FetchPayment(ctx, id)
		if err != nil {
			return fail(err)
		}
		return asAny(t, r)
	case "refund":
		_, err := v.Refund(ctx, id, payments.RefundRequest{})
		return fail(err)
	case "resendRefund":
		_, err := v.ResendRefund(ctx, id, "", nil)
		return fail(err)
	case "listRefunds":
		r, err := v.ListRefunds(ctx, id)
		if err != nil {
			return fail(err)
		}
		return asAny(t, r)
	}
	t.Fatalf("unknown view call %v", st["call"])
	return nil
}

func TestReplies(t *testing.T) {
	for _, r := range load(t).Replies {
		p := ParseMarkReply(r.Text, r.ID)
		want, _ := r.Out.(map[string]any)
		if want == nil {
			if p != nil {
				t.Errorf("reply %q (button %q): read as %+v, the TypeScript reads none", r.Text, r.ID, p)
			}
			continue
		}
		if p == nil || p.Kind != want["kind"] || p.Code != want["code"] {
			t.Errorf("reply %q (button %q): got %+v, want %v", r.Text, r.ID, p, want)
			continue
		}
		w, hasAmount := want["amountPaise"].(float64)
		switch {
		case !hasAmount && p.AmountPaise != nil:
			t.Errorf("reply %q: an amount %d where the TypeScript has none", r.Text, *p.AmountPaise)
		case hasAmount && p.AmountPaise == nil:
			t.Errorf("reply %q: no amount, want %v", r.Text, w)
		case hasAmount && float64(*p.AmountPaise) != w && !(w >= 1<<62 && *p.AmountPaise == math.MaxInt64):
			// an amount too long for a whole number of paise is kept as the largest one (owner.go says why)
			t.Errorf("reply %q: amount %d, want %v", r.Text, *p.AmountPaise, w)
		}
	}
}

func TestNoGateway(t *testing.T) {
	v := load(t)
	ctx := context.Background()
	g := NoGateway
	_, e1 := g.CreateRequest(ctx, payments.NewPaymentRequest{})
	_, e2 := g.FetchRequest(ctx, "x")
	_, e3 := g.ListRequests(ctx, payments.ListQuery{})
	_, e4 := g.CancelRequest(ctx, "x")
	_, e5 := g.FetchPayment(ctx, "x")
	_, e6 := g.Refund(ctx, "x", payments.RefundRequest{})
	_, e7 := g.ResendRefund(ctx, "x", "", nil)
	_, e8 := g.ListRefunds(ctx, "x")
	for name, err := range map[string]error{"createRequest": e1, "fetchRequest": e2, "listRequests": e3, "cancelRequest": e4, "fetchPayment": e5, "refund": e6, "resendRefund": e7, "listRefunds": e8} {
		if err == nil || err.Error() != v.NoGateway[name] {
			t.Errorf("%s: got %v, want %q", name, err, v.NoGateway[name])
		}
	}
}

// TestKeepsWhatItDoesNotKnow: a member a later version adds, or the desk's customer, is written back where it was found.
func TestKeepsWhatItDoesNotKnow(t *testing.T) {
	in := `{"seq":2,"requests":[{"id":"upi-1","reference":"b-1","amountPaise":100,"description":"d","link":"l","code":"ABCDEF","usedCodes":[],"status":"created","createdAtMs":5,"marks":[{"id":"upi-pay-2","amountPaise":1,"atMs":6,"note":"x"}],"customer":"c","future":{"a":[1,2]}}],"refunds":[],"more":true}`
	s, err := Parse(json.RawMessage(in))
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.JSON()
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	_ = json.Unmarshal([]byte(in), &a)
	_ = json.Unmarshal(out, &b)
	if !reflect.DeepEqual(a, b) {
		t.Errorf("round trip lost something:\n in %s\nout %s", in, out)
	}
	if s2, _ := Parse(nil); len(s2.Requests) != 0 || s2.Seq != 0 {
		t.Error("a missing member is a fresh state")
	}
}
