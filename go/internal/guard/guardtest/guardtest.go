// Package guardtest is what the Guard-client tests share: the vectors written by go/scripts/lib/record.ts (a script of answers, the requests the TypeScript client made against it, and its
// outcome), a Go server that replays the script and records what it is sent, and the comparison. A Go client is right when, given the same script, it sends the same requests (method,
// request target, the headers that matter, the body bytes) and reaches the same outcome as the TypeScript one did. It is a test helper: no production code imports it.
package guardtest

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sync"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// Scripted is one answer of the script.
type Scripted struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
	Text    *string           `json:"text"`
	Hang    bool              `json:"hang"`
	Cut     bool              `json:"cut"`
}

// Seen is a request as a server saw it.
type Seen struct {
	Method  string            `json:"method"`
	URI     string            `json:"uri"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// Case is one vector.
type Case struct {
	Name     string          `json:"name"`
	Config   map[string]any  `json:"config"`
	Replies  []Scripted      `json:"replies"`
	Requests []Seen          `json:"requests"`
	Outcome  json.RawMessage `json:"outcome"`
}

// Load reads a vector file: {"cases": [...]}.
func Load(t *testing.T, path string) []Case {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []Case `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 {
		t.Fatalf("%s holds no cases", path)
	}
	return f.Cases
}

// Server replays a case's script and records what it is sent.
type Server struct {
	*httptest.Server
	mu   sync.Mutex
	Seen []Seen
	next int
	done chan struct{}
}

var keep = []string{"authorization", "geo-requested-by", "content-type", "accept", "x-test"}

// Replay starts the server for a case. The caller closes it.
func Replay(c Case) *Server {
	s := &Server{done: make(chan struct{})}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		h := map[string]string{}
		for _, k := range keep {
			if v := r.Header.Get(k); v != "" || len(r.Header.Values(k)) > 0 {
				h[k] = v
			}
		}
		s.mu.Lock()
		s.Seen = append(s.Seen, Seen{Method: r.Method, URI: r.RequestURI, Headers: h, Body: string(b)})
		var rep Scripted
		if s.next < len(c.Replies) {
			rep = c.Replies[s.next]
		} else {
			rep = Scripted{Status: 500, Body: json.RawMessage(`{"unscripted":true}`)}
		}
		s.next++
		s.mu.Unlock()
		if rep.Hang {
			select {
			case <-r.Context().Done():
			case <-s.done:
			}
			return
		}
		if rep.Cut {
			if hj, ok := w.(http.Hijacker); ok {
				conn, _, _ := hj.Hijack()
				conn.Close()
			}
			return
		}
		text := ""
		if rep.Text != nil {
			text = *rep.Text
		} else if len(rep.Body) > 0 {
			text = string(rep.Body)
			w.Header().Set("content-type", "application/json")
		}
		for k, v := range rep.Headers {
			w.Header().Set(k, v)
		}
		st := rep.Status
		if st == 0 {
			st = 200
		}
		w.WriteHeader(st)
		io.WriteString(w, text)
	}))
	return s
}

// Close stops the server and releases any hanging request.
func (s *Server) Close() {
	close(s.done)
	s.Server.CloseClientConnections()
	s.Server.Close()
}

// ClosedURL is an address nothing listens on (a NotSentError): a port that was open and was closed.
func ClosedURL() string {
	s := httptest.NewServer(http.NotFoundHandler())
	u := s.URL
	s.Close()
	return u
}

// DescribeError is record.ts describeError for a Go error: the same name, words and carried fields.
func DescribeError(err error) map[string]any {
	out := map[string]any{"name": guard.Name(err), "message": err.Error()}
	if st, ok := guard.IsAPI(err); ok {
		out["status"] = st
	}
	var ns *guard.NotSentError
	if asNotSent(err, &ns) && ns.Code != "" {
		out["code"] = ns.Code
	}
	if g, ok := guard.AsGuard(err); ok {
		info := map[string]any{"decision": g.Guard.Decision, "code": g.Guard.Code, "sent": g.Guard.Sent, "retry": g.Guard.Retry}
		if g.Guard.ReasonCode != "" {
			info["reason_code"] = g.Guard.ReasonCode
		}
		if g.Guard.HasReason {
			info["reason"] = g.Guard.Reason
		}
		if g.Guard.HasDetail {
			info["detail"] = g.Guard.Detail
		}
		out["guard"] = info
		call := map[string]any{"method": g.Call.Method, "path": g.Call.Path}
		if g.Call.HasBody {
			call["body"] = g.Call.Body
		}
		out["call"] = call
		switch g.Kind {
		case guard.KindHeld:
			out["approval"], out["expiresAtMs"] = nilOr(g.Approval), nilOr(g.ExpiresAtMs)
		case guard.KindRefused:
			out["kind"] = g.RefusalKind
			if g.RuleID != "" {
				out["ruleId"] = g.RuleID
			}
		case guard.KindDenied:
			out["kind"] = g.RefusalKind
			if g.DeniedApproval != "" {
				out["approval"] = g.DeniedApproval
			}
			if g.DeniedAtMs != nil {
				out["deniedAtMs"] = *g.DeniedAtMs
			}
			if g.UntilMs != nil {
				out["untilMs"] = *g.UntilMs
			}
		case guard.KindUnavailable:
			if g.RetryAfterSeconds != nil {
				out["retryAfterSeconds"] = *g.RetryAfterSeconds
			}
		case guard.KindAlreadyDone:
			if g.ConfirmedBy != "" {
				out["confirmedBy"] = g.ConfirmedBy
			}
			if g.Intent != "" {
				out["intent"] = g.Intent
			}
		case guard.KindSuspended:
			if g.State != "" {
				out["state"] = g.State
			}
			if g.Operation != "" {
				out["operation"] = g.Operation
			}
		}
	}
	return out
}

func asNotSent(err error, target **guard.NotSentError) bool {
	for e := err; e != nil; {
		if n, ok := e.(*guard.NotSentError); ok {
			*target = n
			return true
		}
		u, ok := e.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		e = u.Unwrap()
	}
	return false
}

func nilOr[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

// Outcome builds the outcome object of a Go call: {"ok": value} or {"error": DescribeError(err)}, normalised through JSON so it compares with the vector's.
func Outcome(v any, err error) any {
	if err != nil {
		return normalise(map[string]any{"error": DescribeError(err)})
	}
	return normalise(map[string]any{"ok": v})
}

func normalise(v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		panic(err)
	}
	return out
}

// Check compares what the Go client sent and reached with the vector.
func Check(t *testing.T, c Case, s *Server, got any) {
	t.Helper()
	s.mu.Lock()
	seen := append([]Seen(nil), s.Seen...)
	s.mu.Unlock()
	if len(seen) != len(c.Requests) {
		t.Errorf("%s: %d requests, TypeScript made %d: %v", c.Name, len(seen), len(c.Requests), seen)
	}
	for i := range seen {
		if i >= len(c.Requests) {
			break
		}
		w, g := c.Requests[i], seen[i]
		if w.Method != g.Method || w.URI != g.URI || w.Body != g.Body || !reflect.DeepEqual(emptyIfNil(w.Headers), emptyIfNil(g.Headers)) {
			t.Errorf("%s: request %d differs\n  TypeScript: %s %s %v %q\n  Go:         %s %s %v %q", c.Name, i+1, w.Method, w.URI, w.Headers, w.Body, g.Method, g.URI, g.Headers, g.Body)
		}
	}
	var want any
	if err := json.Unmarshal(c.Outcome, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(want, got) {
		wb, _ := json.MarshalIndent(want, "", " ")
		gb, _ := json.MarshalIndent(got, "", " ")
		t.Errorf("%s: outcome differs\n  TypeScript: %s\n  Go:         %s", c.Name, wb, gb)
	}
}

func emptyIfNil(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

// Timeout reads a case's config "timeoutMs", the default for a case that hangs being a short one.
func Timeout(c Case) int {
	if v, ok := c.Config["timeoutMs"].(float64); ok {
		return int(v)
	}
	return 0
}

// JSBody is a request body given as JSON text, sent as JavaScript would write it (members in order, no spaces): the vectors keep a body's member order, which a Go map would lose.
type JSBody string

// NewJSBody normalises text the way JSON.stringify(JSON.parse(text)) does.
func NewJSBody(t *testing.T, text json.RawMessage) JSBody {
	t.Helper()
	s, err := guard.ReEmit(string(text))
	if err != nil {
		t.Fatal(err)
	}
	return JSBody(s)
}

// MarshalJSON gives the text as it is.
func (b JSBody) MarshalJSON() ([]byte, error) { return []byte(b), nil }
