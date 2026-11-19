package guard_test

// The shared core against the vectors the TypeScript wrote (testdata/core-vectors.json, byte-vectors.json: go/scripts/gen_guard_vectors.ts): every answer Guard can give told apart as the
// TypeScript tells it, the request bytes (path prefix, query order, JSON body, form, headers), the transport failures, and the byte helpers (JSON.stringify, encodeURIComponent,
// URLSearchParams, JSON.stringify(JSON.parse(x))).

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/guard/guardtest"
)

type reqConfig struct {
	Request struct {
		Method   string            `json:"method"`
		Path     string            `json:"path"`
		Query    [][2]string       `json:"query"`
		Body     *json.RawMessage  `json:"body"`
		BodyText *string           `json:"bodyText"`
		Form     [][2]string       `json:"form"`
		Headers  map[string]string `json:"headers"`
	} `json:"request"`
	TimeoutMs  int    `json:"timeoutMs"`
	AgentToken string `json:"agentToken"`
	BaseSuffix string `json:"baseSuffix"`
	Closed     bool   `json:"closed"`
}

func TestCoreVectors(t *testing.T) {
	for _, c := range guardtest.Load(t, "testdata/core-vectors.json") {
		t.Run(c.Name, func(t *testing.T) {
			raw, _ := json.Marshal(c.Config)
			var cfg reqConfig
			if err := json.Unmarshal(raw, &cfg); err != nil {
				t.Fatal(err)
			}
			srv := guardtest.Replay(c)
			defer srv.Close()
			base := srv.URL
			if cfg.Closed {
				base = guardtest.ClosedURL()
			}
			cl, err := guard.New(base+cfg.BaseSuffix, "Test", cfg.TimeoutMs, cfg.AgentToken)
			if err != nil {
				t.Fatal(err)
			}
			o := guard.Options{Headers: cfg.Request.Headers, RawBody: cfg.Request.BodyText}
			for _, q := range cfg.Request.Query {
				o.Query = append(o.Query, guard.Param{Key: q[0], Value: q[1]})
			}
			for _, f := range cfg.Request.Form {
				o.Form = append(o.Form, guard.Param{Key: f[0], Value: f[1]})
			}
			if cfg.Request.Body != nil {
				o.Body = guardtest.NewJSBody(t, *cfg.Request.Body)
			}
			reply, err := cl.Request(context.Background(), cfg.Request.Method, cfg.Request.Path, o)
			var got any
			if err != nil {
				got = guardtest.Outcome(nil, err)
			} else {
				r := map[string]any{"status": reply.Status}
				if reply.Body != nil {
					r["body"] = reply.Body
				}
				if reply.Replayed {
					r["replayed"] = true
				}
				got = guardtest.Outcome(r, nil)
			}
			guardtest.Check(t, c, srv, got)
		})
	}
}

func TestByteVectors(t *testing.T) {
	b, err := os.ReadFile("testdata/byte-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		JSON      []struct{ S, Out string }  `json:"json"`
		Component []struct{ S, Out string }  `json:"component"`
		Query     []struct{ S, Out string }  `json:"query"`
		ReEmit    []struct{ In, Out string } `json:"reemit"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.JSON {
		if got := guard.MustJSText(struct {
			S string `json:"s"`
		}{c.S}); got != c.Out {
			t.Errorf("JSText(%q) = %s, JSON.stringify gives %s", c.S, got, c.Out)
		}
	}
	for _, c := range v.Component {
		if got := guard.EncodeURIComponent(c.S); got != c.Out {
			t.Errorf("EncodeURIComponent(%q) = %s, want %s", c.S, got, c.Out)
		}
	}
	for _, c := range v.Query {
		if got := guard.QueryString([]guard.Param{{Key: "k", Value: c.S}}); got != c.Out {
			t.Errorf("QueryString(%q) = %s, want %s", c.S, got, c.Out)
		}
	}
	for _, c := range v.ReEmit {
		got, err := guard.ReEmit(c.In)
		if err != nil || got != c.Out {
			t.Errorf("ReEmit(%q) = %q, %v; JSON.stringify(JSON.parse()) gives %q", c.In, got, err, c.Out)
		}
	}
	if len(v.JSON) == 0 || len(v.ReEmit) == 0 {
		t.Fatal("the vectors are empty")
	}
}

// The error predicates answer what `instanceof` answered.
func TestErrorTree(t *testing.T) {
	done := &guard.GuardError{Kind: guard.KindAlreadyDone, Status: 409}
	denied := &guard.GuardError{Kind: guard.KindDenied, Status: 403}
	if !done.IsConflict() || !denied.IsRefused() || done.IsRefused() || denied.IsConflict() {
		t.Error("an already-done is a conflict, a denial is a refusal, and neither is the other")
	}
	for _, e := range []error{&guard.NotSentError{Message: "x"}, &guard.ConflictError{}, &guard.WindowClosedError{}, done, &guard.ApiError{Status: 500}} {
		if _, ok := guard.IsAPI(e); !ok {
			t.Errorf("%T must be an ApiError", e)
		}
	}
	if _, ok := guard.IsAPI(&guard.TimeoutError{What: "x"}); ok {
		t.Error("a timeout is not an ApiError")
	}
	if !guard.MayHaveHappened(&guard.TimeoutError{}) || !guard.MayHaveHappened(&guard.GuardError{Kind: guard.KindOutcomeUnknown}) || guard.MayHaveHappened(done) {
		t.Error("mayHaveHappened")
	}
	waits := map[string]bool{}
	for name, e := range map[string]error{
		"refused":      &guard.NotSentError{Code: "ECONNREFUSED"},
		"invalid url":  &guard.NotSentError{Code: "ERR_INVALID_URL"},
		"unavailable":  &guard.GuardError{Kind: guard.KindUnavailable, Guard: guard.GuardInfo{Code: "guard_unavailable", Reason: "no policy"}},
		"kill switch":  &guard.GuardError{Kind: guard.KindUnavailable, Guard: guard.GuardInfo{Code: "guard_unavailable", Reason: "Kill switch engaged: test"}},
		"provider":     &guard.GuardError{Kind: guard.KindUnavailable, Guard: guard.GuardInfo{Code: "provider_unreachable"}},
		"busy":         &guard.GuardError{Kind: guard.KindUnavailable, Guard: guard.GuardInfo{Code: "busy"}},
		"timeout":      &guard.TimeoutError{},
		"held":         &guard.GuardError{Kind: guard.KindHeld},
		"plain ApiErr": &guard.ApiError{Status: 500},
	} {
		waits[name] = guard.WaitsForGuard(e)
	}
	want := map[string]bool{"refused": true, "invalid url": false, "unavailable": true, "kill switch": false, "provider": false, "busy": true, "timeout": false, "held": false, "plain ApiErr": false}
	for k, w := range want {
		if waits[k] != w {
			t.Errorf("WaitsForGuard(%s) = %v, want %v", k, waits[k], w)
		}
	}
}
