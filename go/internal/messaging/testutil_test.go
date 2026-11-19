package messaging_test

// What the messaging tests share: reading a vector file, comparing JSON the way the vectors were made (key order does not matter, numbers are numbers), and building the errors a
// scenario names exactly as the TypeScript generator (go/scripts/vectors/messaging.ts makeError) builds them.

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"reflect"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

func readJSON(t *testing.T, path string, into any) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, into); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
}

// norm round-trips a value through JSON so it compares with what a vector file decodes to.
func norm(t *testing.T, v any) any {
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

// same reports a difference between what Go made and what the TypeScript wrote.
func same(t *testing.T, label string, got, want any) {
	t.Helper()
	g, w := norm(t, got), norm(t, want)
	if !reflect.DeepEqual(g, w) {
		gb, _ := json.MarshalIndent(g, "", " ")
		wb, _ := json.MarshalIndent(w, "", " ")
		t.Errorf("%s differs\n  TypeScript: %s\n  Go:         %s", label, wb, gb)
	}
}

// errSpec is the vectors' description of an error (generator: ErrKind).
type errSpec struct {
	Kind    string            `json:"kind"`
	Status  int               `json:"status"`
	Message string            `json:"message"`
	Code    string            `json:"code"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
}

// makeError builds the Go error for a spec: the same classes the TypeScript throws (a Guard answer goes through guard.Classify, as http.ts classify does).
func makeError(t *testing.T, s errSpec) error {
	t.Helper()
	switch s.Kind {
	case "api":
		return &guard.ApiError{Status: s.Status, Message: s.Message}
	case "timeout":
		return &guard.TimeoutError{What: "WhatsApp"}
	case "windowClosed":
		return &guard.WindowClosedError{}
	case "notSent":
		return &guard.NotSentError{Message: s.Message, Code: s.Code}
	case "conflict":
		return &guard.ConflictError{Message: s.Message}
	case "plain":
		return errors.New(s.Message)
	case "guard":
		body, err := guard.Decode(string(s.Body))
		if err != nil {
			t.Fatal(err)
		}
		h := http.Header{}
		for k, v := range s.Headers {
			h.Set(k, v)
		}
		g := guard.Classify(s.Status, h, body, guard.SentCall{Method: "POST", Path: "/x", Body: "{}", HasBody: true})
		if g == nil {
			t.Fatalf("not a Guard answer: %s", s.Body)
		}
		return g
	}
	t.Fatalf("unknown error kind %q", s.Kind)
	return nil
}

func compact(t *testing.T, raw json.RawMessage) string {
	var b bytes.Buffer
	if err := json.Compact(&b, raw); err != nil {
		t.Fatal(err)
	}
	return b.String()
}
