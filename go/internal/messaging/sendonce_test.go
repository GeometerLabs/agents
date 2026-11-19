package messaging_test

// send-once against the TypeScript's calls (testdata/sendonce-vectors.json): the state functions step by step, the table of which errors mean "nothing was sent", and runSendOnce
// scenarios whose every call to its deps (claim, ending, deliver, settle, save, notify, log) is compared in order, with the intent as it stood at that call.

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/messaging"
)

func TestSendOnceVectors(t *testing.T) {
	var v struct {
		Constants struct {
			RetryAfterMs int64 `json:"retryAfterMs"`
			MaxTries     int   `json:"maxTries"`
		} `json:"constants"`
		Pures []struct {
			Name string `json:"name"`
			Ops  []struct {
				Op     string          `json:"op"`
				Intent json.RawMessage `json:"intent"`
				CaseID string          `json:"caseId"`
				Kind   string          `json:"kind"`
				ID     string          `json:"id"`
				How    string          `json:"how"`
				None   bool            `json:"none"`
				Fields map[string]any  `json:"fields"`
				Field  string          `json:"field"`
			} `json:"ops"`
			Results []struct {
				Result json.RawMessage `json:"result"`
				State  json.RawMessage `json:"state"`
			} `json:"results"`
		} `json:"pures"`
		Table []struct {
			Label          string  `json:"label"`
			Spec           errSpec `json:"spec"`
			NothingWasSent bool    `json:"nothingWasSent"`
		} `json:"table"`
		Scenarios []struct {
			Name  string          `json:"name"`
			State json.RawMessage `json:"state"`
			Runs  []struct {
				Run struct {
					Now          int64                        `json:"now"`
					Deliver      map[string][]json.RawMessage `json:"deliver"`
					Notify       string                       `json:"notify"`
					SettleQueues json.RawMessage              `json:"settleQueues"`
				} `json:"run"`
				Trace []json.RawMessage `json:"trace"`
				State json.RawMessage   `json:"state"`
			} `json:"runs"`
		} `json:"scenarios"`
	}
	readJSON(t, "testdata/sendonce-vectors.json", &v)
	if v.Constants.RetryAfterMs != messaging.RetryAfterMs || v.Constants.MaxTries != messaging.MaxTries {
		t.Errorf("constants: %+v", v.Constants)
	}
	for _, c := range v.Table {
		if got := messaging.NothingWasSent(makeError(t, c.Spec)); got != c.NothingWasSent {
			t.Errorf("nothingWasSent(%s): Go %v, TypeScript %v", c.Label, got, c.NothingWasSent)
		}
	}
	for _, p := range v.Pures {
		t.Run(p.Name, func(t *testing.T) {
			st := &messaging.SendOnceState{Intents: []*messaging.SendIntent{}}
			for i, o := range p.Ops {
				var result any
				find := func(id string) *messaging.SendIntent {
					for _, x := range st.Intents {
						if x.ID == id {
							return x
						}
					}
					t.Fatalf("no intent %s", id)
					return nil
				}
				switch o.Op {
				case "queue":
					var in messaging.SendIntent
					if err := json.Unmarshal(o.Intent, &in); err != nil {
						t.Fatal(err)
					}
					if made := messaging.QueueSend(st, in); made != nil {
						result = made
					}
				case "nextId":
					result = messaging.NextIntentID(st, o.CaseID, o.Kind)
				case "openUnknowns":
					s := st
					if o.None {
						s = nil
					}
					result = messaging.OpenUnknowns(s, o.Kind)
				case "openRefusals":
					s := st
					if o.None {
						s = nil
					}
					result = messaging.OpenRefusals(s, o.Kind)
				case "resolve":
					if r := messaging.ResolveUnknown(st, o.ID, o.How); r != nil {
						result = r
					}
				case "retryNow":
					if r := messaging.RetryNow(st, o.ID); r != nil {
						result = r
					}
				case "nextTry":
					result = messaging.NextTryMs(find(o.ID))
				case "set":
					x := find(o.ID)
					b, _ := json.Marshal(x)
					var m map[string]any
					json.Unmarshal(b, &m)
					for k, f := range o.Fields {
						m[k] = f
					}
					b, _ = json.Marshal(m)
					if err := json.Unmarshal(b, x); err != nil {
						t.Fatal(err)
					}
				case "delete":
					x := find(o.ID)
					if o.Field != "lastTryMs" {
						t.Fatalf("only lastTryMs is deleted here, not %s", o.Field)
					}
					x.LastTryMs = nil
				}
				same(t, p.Name+" op "+o.Op+" result", result, json.RawMessage(orNull(p.Results[i].Result)))
				same(t, p.Name+" op "+o.Op+" state", st, json.RawMessage(p.Results[i].State))
			}
		})
	}
	for _, sc := range v.Scenarios {
		t.Run(sc.Name, func(t *testing.T) {
			st := &messaging.SendOnceState{Intents: []*messaging.SendIntent{}}
			if err := json.Unmarshal(sc.State, st); err != nil {
				t.Fatal(err)
			}
			delivered := map[string]int{} // over ALL the runs, as the generator's `tries`
			for ri, run := range sc.Runs {
				var trace []any
				snap := func(x any) any { return norm(t, x) }
				queued := false
				d := messaging.SendOnceDeps{
					State: st, Now: func() int64 { return run.Run.Now },
					RecordClaim: func(i *messaging.SendIntent) {
						trace = append(trace, map[string]any{"call": "recordClaim", "intent": snap(i)})
					},
					RecordEnding: func(i *messaging.SendIntent, ending, note string) {
						trace = append(trace, map[string]any{"call": "recordEnding", "intent": snap(i), "ending": ending, "note": note})
					},
					Deliver: func(_ context.Context, i *messaging.SendIntent) (messaging.SaidOutcome, error) {
						trace = append(trace, map[string]any{"call": "deliver", "intent": snap(i)})
						plan := run.Run.Deliver[i.ID]
						if len(plan) == 0 {
							plan = []json.RawMessage{json.RawMessage(`"accepted"`)}
						}
						delivered[i.ID]++
						n := delivered[i.ID]
						if n > len(plan) {
							n = len(plan)
						}
						var word string
						if json.Unmarshal(plan[n-1], &word) == nil {
							return word, nil
						}
						var th struct {
							Throw errSpec `json:"throw"`
						}
						if err := json.Unmarshal(plan[n-1], &th); err != nil {
							t.Fatal(err)
						}
						return "", makeError(t, th.Throw)
					},
					Settle: func(i *messaging.SendIntent, ending string) {
						trace = append(trace, map[string]any{"call": "settle", "intent": snap(i), "ending": ending})
						if len(run.Run.SettleQueues) > 0 && string(run.Run.SettleQueues) != "null" && !queued {
							queued = true
							var in messaging.SendIntent
							if err := json.Unmarshal(run.Run.SettleQueues, &in); err != nil {
								t.Fatal(err)
							}
							messaging.QueueSend(st, in)
						}
					},
					Save: func() { trace = append(trace, map[string]any{"call": "save", "state": snap(st)}) },
					Log:  func(line string) { trace = append(trace, map[string]any{"call": "log", "line": line}) },
				}
				if run.Run.Notify == "ok" || run.Run.Notify == "throws" {
					mode := run.Run.Notify
					d.Notify = func(_ context.Context, i *messaging.SendIntent, ending string) error {
						trace = append(trace, map[string]any{"call": "notify", "intent": snap(i), "ending": ending})
						if mode == "throws" {
							return errors.New("the owner's phone is off")
						}
						return nil
					}
				}
				messaging.RunSendOnce(context.Background(), d)
				for k := 0; k < len(trace) || k < len(run.Trace); k++ {
					var got, want any
					if k < len(trace) {
						got = trace[k]
					}
					if k < len(run.Trace) {
						want = run.Trace[k]
					}
					same(t, sc.Name+" run "+itoa(ri)+" call "+itoa(k), got, want)
				}
				same(t, sc.Name+" run "+itoa(ri)+" state", st, json.RawMessage(run.State))
			}
		})
	}
	if len(v.Scenarios) < 10 {
		t.Fatal("too few scenarios")
	}
}

func orNull(r json.RawMessage) []byte {
	if len(r) == 0 {
		return []byte("null")
	}
	return r
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }
