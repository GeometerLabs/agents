package payments

// The refund logic, the careful link and the money helper against the vectors the TypeScript wrote (testdata/refunds-vectors.json, links-vectors.json: go/scripts/vectors/refunds.ts).
// A refund scenario is a case in some state, a payments service that answers from a script, the owner's decisions and the clock's sweeps; the Go port must make the same calls to the
// payments service, write the same record lines (words included), tell the same people the same things, post the same books events, and leave the same case. One difference is
// allowed and normalised away: TypeScript creates an empty issues/stopped/untold list on the case the first time it looks at one, Go keeps them as empty slices, so an empty list and
// a missing one compare equal.

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

type tcase struct {
	id, customer string
	pending      []Pending
	issues       []*RefundIssue
	stopped      []string
	untold       []*UntoldRefund
	extra        map[string]json.RawMessage
}

func (c *tcase) CaseID() string           { return c.id }
func (c *tcase) Customer() string         { return c.customer }
func (c *tcase) Pending() *[]Pending      { return &c.pending }
func (c *tcase) Issues() *[]*RefundIssue  { return &c.issues }
func (c *tcase) Stopped() *[]string       { return &c.stopped }
func (c *tcase) Untold() *[]*UntoldRefund { return &c.untold }

func loadCase(t *testing.T, raw json.RawMessage) *tcase {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	c := &tcase{extra: map[string]json.RawMessage{}}
	for k, v := range m {
		switch k {
		case "id":
			json.Unmarshal(v, &c.id)
		case "customer":
			json.Unmarshal(v, &c.customer)
		case "pending":
			var items []json.RawMessage
			json.Unmarshal(v, &items)
			for _, it := range items {
				p, err := DecodePending(it)
				if err != nil {
					t.Fatal(err)
				}
				c.pending = append(c.pending, p)
			}
		case "refundIssues":
			json.Unmarshal(v, &c.issues)
		case "stoppedRefunds":
			json.Unmarshal(v, &c.stopped)
		case "refundsUntold":
			if err := json.Unmarshal(v, &c.untold); err != nil {
				t.Fatal(err)
			}
		default:
			c.extra[k] = v
		}
	}
	return c
}

func (c *tcase) final() map[string]any {
	out := map[string]any{"id": c.id, "customer": c.customer}
	put := func(k string, v any, n int) {
		if n > 0 {
			out[k] = v
		}
	}
	put("pending", c.pending, len(c.pending))
	if c.pending == nil || len(c.pending) == 0 {
		out["pending"] = []any{}
	}
	put("refundIssues", c.issues, len(c.issues))
	put("stoppedRefunds", c.stopped, len(c.stopped))
	put("refundsUntold", c.untold, len(c.untold))
	for k, v := range c.extra {
		out[k] = v
	}
	return out
}

func makeError(t *testing.T, e map[string]any) error {
	str := func(k string) string { s, _ := e[k].(string); return s }
	num := func(k string) *int64 {
		if f, ok := e[k].(float64); ok {
			n := int64(f)
			return &n
		}
		return nil
	}
	call := guard.SentCall{Method: "POST", Path: "/v1/payments/pay_1/refund"}
	if b, ok := e["body"].(string); ok {
		call.Body, call.HasBody = b, true
	}
	info := func(decision, code string) guard.GuardInfo {
		return guard.GuardInfo{Decision: decision, Code: code, Sent: "no", Retry: "no"}
	}
	switch e["kind"] {
	case "timeout":
		return &guard.TimeoutError{What: "Razorpay"}
	case "notsent":
		return &guard.NotSentError{Message: "Razorpay: could not connect (ECONNREFUSED).", Code: "ECONNREFUSED"}
	case "api":
		msg := str("message")
		st := int(*num("status"))
		if msg == "" {
			msg = "The payments service answered " + itoa(int64(st)) + "."
		}
		return &guard.ApiError{Status: st, Message: msg}
	case "held":
		g := &guard.GuardError{Kind: guard.KindHeld, Status: 202, Message: "held by the Guard: refund-needs-owner", Guard: info("hold", "held_for_approval"), Call: call, ExpiresAtMs: num("expiresAtMs")}
		if a := str("approval"); a != "" {
			g.Approval = &a
		}
		return g
	case "refused":
		reason := str("reason")
		if reason == "" {
			reason = "refund-at-most-deposit: amount 90000 is above the highest allowed value, 60000"
		}
		gi := info("deny", "refused_by_policy")
		gi.Reason, gi.HasReason = reason, true
		g := &guard.GuardError{Kind: guard.KindRefused, Status: 403, Message: "refused by the Guard: x", Guard: gi, Call: call, RefusalKind: "rule", RuleID: str("ruleId")}
		if e["limit"] == true {
			g.RefusalKind = "limit"
		}
		return g
	case "denied":
		ap := str("approval")
		if ap == "" {
			ap = "ap-denied"
		}
		return &guard.GuardError{Kind: guard.KindDenied, Status: 403, Message: "refused by the Guard: the person said no", Guard: info("deny", "refused_by_policy"), Call: call, RefusalKind: "rule", DeniedApproval: ap}
	case "alreadyDone":
		return &guard.GuardError{Kind: guard.KindAlreadyDone, Status: 409, Message: "refused by the Guard: reconciled", Guard: info("deny", "conflict"), Call: call, ConfirmedBy: "operator:owner", Intent: "intent:abc"}
	case "alreadyDoneBare":
		return &guard.GuardError{Kind: guard.KindAlreadyDone, Status: 409, Message: "refused by the Guard: reconciled", Guard: info("deny", "conflict"), Call: call}
	case "conflict":
		return &guard.GuardError{Kind: guard.KindConflict, Status: 409, Message: "refused by the Guard: other arguments", Guard: info("deny", "conflict"), Call: call}
	case "unavailable":
		return &guard.GuardError{Kind: guard.KindUnavailable, Status: 503, Message: "refused by the Guard: kill switch engaged: test", Guard: info("deny", "guard_unavailable"), Call: call}
	case "unknown":
		return &guard.GuardError{Kind: guard.KindOutcomeUnknown, Status: 504, Message: "refused by the Guard: outcome unknown", Guard: info("unknown", "outcome_unknown"), Call: call}
	case "unauthenticated":
		return &guard.GuardError{Kind: guard.KindUnauthenticated, Status: 401, Message: "refused by the Guard: no credential", Guard: info("deny", "unauthenticated"), Call: call}
	case "suspended":
		return &guard.GuardError{Kind: guard.KindSuspended, Status: 402, Message: "refused by the Guard: suspended", Guard: info("deny", "subscription_suspended"), Call: call}
	}
	t.Fatalf("unknown error kind %v", e["kind"])
	return nil
}

// fakeService answers from the script.
type fakeService struct {
	t     *testing.T
	calls *[]any
	q     map[string][]map[string]any
}

func (f *fakeService) next(op string) (any, error) {
	if len(f.q[op]) == 0 {
		if op == "listRefunds" {
			return []Refund{}, nil
		}
		f.t.Fatalf("unscripted %s", op)
	}
	n := f.q[op][0]
	f.q[op] = f.q[op][1:]
	if e, ok := n["err"].(map[string]any); ok {
		return nil, makeError(f.t, e)
	}
	b, _ := json.Marshal(n["ok"])
	if op == "listRefunds" {
		var l []Refund
		json.Unmarshal(b, &l)
		return l, nil
	}
	var r Refund
	json.Unmarshal(b, &r)
	return r, nil
}

func (f *fakeService) ListRefunds(_ context.Context, id string) ([]Refund, error) {
	*f.calls = append(*f.calls, map[string]any{"op": "listRefunds", "id": id})
	v, err := f.next("listRefunds")
	if err != nil {
		return nil, err
	}
	return v.([]Refund), nil
}
func (f *fakeService) Refund(_ context.Context, id string, r RefundRequest) (Refund, error) {
	body := map[string]any{"amount": r.Amount}
	if r.HasReceipt {
		body["receipt"] = r.Receipt
	}
	if len(r.RequestedBy) > 0 {
		body["requestedBy"] = r.RequestedBy
	}
	*f.calls = append(*f.calls, map[string]any{"op": "refund", "id": id, "r": body})
	v, err := f.next("refund")
	if err != nil {
		return Refund{}, err
	}
	return v.(Refund), nil
}
func (f *fakeService) ResendRefund(_ context.Context, id, body string, by []string) (Refund, error) {
	var b any
	if by != nil {
		b = by
	}
	*f.calls = append(*f.calls, map[string]any{"op": "resendRefund", "id": id, "body": body, "by": b})
	v, err := f.next("resendRefund")
	if err != nil {
		return Refund{}, err
	}
	return v.(Refund), nil
}
func (f *fakeService) CreateRequest(context.Context, NewPaymentRequest) (PaymentRequest, error) {
	panic("not used")
}
func (f *fakeService) FetchRequest(context.Context, string) (*PaymentRequest, error) {
	panic("not used")
}
func (f *fakeService) ListRequests(context.Context, ListQuery) ([]PaymentRequest, error) {
	panic("not used")
}
func (f *fakeService) CancelRequest(context.Context, string) (PaymentRequest, error) {
	panic("not used")
}
func (f *fakeService) FetchPayment(context.Context, string) (*Payment, error) { panic("not used") }

type books struct{ lines *[]any }

func (b books) Post(e MoneyEvent, write func(map[string]string)) {
	ev := map[string]any{"kind": e.Kind, "case": e.Case, "owed": e.Owed}
	switch e.Kind {
	case "refund_owed":
		ev["paymentId"], ev["amountPaise"] = e.PaymentID, e.AmountPaise
	case "refund_made":
		ev["paymentId"], ev["amountPaise"], ev["method"], ev["evidence"] = e.PaymentID, e.AmountPaise, e.Method, e.Evidence
		if e.RefundID != "" {
			ev["refundId"] = e.RefundID
		}
	case "refund_cancelled":
		ev["why"] = e.Why
	}
	*b.lines = append(*b.lines, map[string]any{"post": ev})
	write(map[string]string{"money": "posted"})
}

func norm(v any) any {
	b, _ := json.Marshal(v)
	var out any
	json.Unmarshal(b, &out)
	return out
}

// dropEmpty removes the empty lists TypeScript creates lazily.
func dropEmpty(m map[string]any) {
	for _, k := range []string{"refundIssues", "stoppedRefunds", "refundsUntold"} {
		if l, ok := m[k].([]any); ok && len(l) == 0 {
			delete(m, k)
		}
	}
}

func TestRefundScenarios(t *testing.T) {
	b, err := os.ReadFile("testdata/refunds-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []struct {
			Name       string          `json:"name"`
			Accounting bool            `json:"accounting"`
			Now        int64           `json:"now"`
			Case       json.RawMessage `json:"case"`
			Script     struct {
				ListRefunds  []map[string]any `json:"listRefunds"`
				Refund       []map[string]any `json:"refund"`
				ResendRefund []map[string]any `json:"resendRefund"`
				TellOutcome  []string         `json:"tellOutcome"`
			} `json:"script"`
			Steps   []map[string]any `json:"steps"`
			Outcome struct {
				Calls   []any `json:"calls"`
				Lines   []any `json:"lines"`
				Results []any `json:"results"`
				Final   any   `json:"final"`
			} `json:"outcome"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) < 60 {
		t.Fatalf("only %d scenarios", len(f.Cases))
	}
	for _, sc := range f.Cases {
		t.Run(sc.Name, func(t *testing.T) {
			calls, lines := []any{}, []any{}
			svc := &fakeService{t: t, calls: &calls, q: map[string][]map[string]any{"listRefunds": sc.Script.ListRefunds, "refund": sc.Script.Refund, "resendRefund": sc.Script.ResendRefund}}
			c := loadCase(t, sc.Case)
			clock := sc.Now
			tells := append([]string(nil), sc.Script.TellOutcome...)
			rupees := func(p int64) any {
				if p < 0 {
					return nil
				}
				return json.RawMessage(rupeesText(p))
			}
			d := RefundDeps{
				Payments: svc, Now: func() int64 { return clock }, Owner: "+919876500000", LimitInr: func() int64 { return 500 },
				Log: func(rc RefundCase, phone, action, outcome string, inputs map[string]any, more LogMore) {
					var caseID any
					if rc != nil {
						caseID = rc.CaseID()
					}
					m := map[string]any{}
					if more.Decisions != nil {
						m["decisions"] = more.Decisions
					}
					if more.Notes != "" {
						m["notes"] = more.Notes
					}
					if more.Refs != nil {
						m["refs"] = more.Refs
					}
					lines = append(lines, map[string]any{"log": map[string]any{"case": caseID, "phone": phone, "action": action, "outcome": outcome, "inputs": inputs, "more": m}})
				},
				TellCustomer: func(rc RefundCase, phone string, templates []string, p int64) bool {
					lines = append(lines, map[string]any{"tell": map[string]any{"who": "customer", "templates": templates, "refundInr": rupees(p)}})
					return true
				},
				TellCustomerOutcome: func(rc RefundCase, phone, template string, p int64) string {
					o := "accepted"
					if len(tells) > 0 {
						o, tells = tells[0], tells[1:]
					}
					lines = append(lines, map[string]any{"tellOutcome": map[string]any{"template": template, "refundInr": rupees(p), "answered": o}})
					return o
				},
				TellOwner: func(rc RefundCase, phone, template string, p int64) bool {
					lines = append(lines, map[string]any{"tell": map[string]any{"who": "owner", "templates": []string{template}, "refundInr": rupees(p)}})
					return true
				},
				Cases: func() []RefundCase { return []RefundCase{c} },
				IDs:   RefundIDs{Checking: "refund_checking", Denied: "refund_denied", Approved: "refund_approved", Expired: "refund_expired", Settled: "refund_settled", Confirmed: "refund_confirmed"},
			}
			if sc.Accounting {
				d.Accounting = books{&lines}
			}
			r := NewRefunds(d)
			ctx := context.Background()
			results := []any{}
			for _, s := range sc.Steps {
				switch s["op"] {
				case "request":
					var by []string
					for _, x := range asList(s["requestedBy"]) {
						by = append(by, x.(string))
					}
					var dec []any
					if v, ok := s["decisions"].([]any); ok {
						dec = v
					}
					res, err := r.RequestRefund(ctx, c, s["paymentId"].(string), int64(s["amountInr"].(float64)), dec, s["expectHold"] == true, by)
					if err != nil {
						t.Fatal(err)
					}
					results = append(results, res)
				case "after":
					a := RefundAfter{PaymentID: "pay_1", AmountInr: int64(s["amountInr"].(float64)), DoneCust: orStr(s["doneCust"], "refund_done"), DoneOwner: orStr(s["doneOwner"], ""), Held: orStr(s["held"], "refund_held")}
					for _, x := range asList(s["requestedBy"]) {
						a.RequestedBy = append(a.RequestedBy, x.(string))
					}
					r.AfterRefund(c, s["result"].(string), a)
					results = append(results, nil)
				case "approval":
					if err := r.OnApprovalDecision(ctx, s["approval"].(string), s["decision"].(string)); err != nil {
						t.Fatal(err)
					}
					results = append(results, nil)
				case "sweep":
					clock = int64(s["now"].(float64))
					if err := r.Sweep(ctx, clock); err != nil {
						t.Fatal(err)
					}
					results = append(results, nil)
				case "expire":
					h := (*c.Pending())[int(s["index"].(float64))].(*GuardHold)
					why, _ := s["why"].(string)
					if err := r.ExpireGuardHold(ctx, c, h, why); err != nil {
						t.Fatal(err)
					}
					results = append(results, nil)
				case "recheck":
					settled, looked, told, err := r.Recheck(ctx, c)
					if err != nil {
						t.Fatal(err)
					}
					results = append(results, map[string]any{"settled": settled, "looked": looked, "told": told})
				case "settleEvent":
					rb, _ := json.Marshal(s["refund"])
					var rf Refund
					json.Unmarshal(rb, &rf)
					results = append(results, r.SettleFromEvent(c, rf, s["eventId"].(string)))
				default:
					t.Fatalf("unknown step %v", s["op"])
				}
			}
			want := map[string]any{"calls": sc.Outcome.Calls, "lines": sc.Outcome.Lines, "results": sc.Outcome.Results}
			got := norm(map[string]any{"calls": calls, "lines": lines, "results": results}).(map[string]any)
			if !reflect.DeepEqual(norm(want), got) {
				for _, k := range []string{"calls", "lines", "results"} {
					w, g := asList(norm(want).(map[string]any)[k]), asList(got[k])
					for i := 0; i < len(w) || i < len(g); i++ {
						var wi, gi any
						if i < len(w) {
							wi = w[i]
						}
						if i < len(g) {
							gi = g[i]
						}
						if !reflect.DeepEqual(wi, gi) {
							wb, _ := json.Marshal(wi)
							gb, _ := json.Marshal(gi)
							t.Errorf("%s[%d] differs\n  TypeScript: %s\n  Go:         %s", k, i, wb, gb)
							break
						}
					}
				}
			}
			wf, _ := sc.Outcome.Final.(map[string]any)
			gf := norm(c.final()).(map[string]any)
			dropEmpty(wf)
			dropEmpty(gf)
			if !reflect.DeepEqual(wf, gf) {
				wb, _ := json.MarshalIndent(wf, "", " ")
				gb, _ := json.MarshalIndent(gf, "", " ")
				t.Errorf("final case differs\nTypeScript: %s\nGo: %s", wb, gb)
			}
		})
	}
}

func asList(v any) []any { l, _ := v.([]any); return l }
func orStr(v any, d string) string {
	if s, ok := v.(string); ok {
		return s
	}
	return d
}

func TestRupeesToPaise(t *testing.T) {
	if p, err := RupeesToPaise(500); err != nil || p != 50000 {
		t.Fatal(p, err)
	}
	if _, err := RupeesToPaise(-1); err == nil {
		t.Fatal("negative must be refused")
	}
	if _, err := RupeesToPaise(MaxSafe); err == nil {
		t.Fatal("too large must be refused")
	}
}
