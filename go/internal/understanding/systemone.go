package understanding

// A client for the System One decisions API (modules/understanding/system-one.ts): a decision model does not write text; it is given a state (one message, with numbers and names
// taken out) and choice questions, and answers each with a choice and probabilities. Laya runs on the shop's own server (a local address, no key); Jev is hosted (a key from
// the environment variable `keyEnv` names, sent only in the Authorization header, never logged).
//
// The answer is untrusted: it is decoded to `any` and refused unless its names are the questions' names, its choice is one of the question's labels, its probabilities are for
// exactly those labels, each between 0 and 1, adding up to 1 (within 1e-6 plus half a hundredth for each option), and its confidence is between 0 and 1 (readDecision).

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

// DecisionConfig is runtime.json's `decision`.
type DecisionConfig struct {
	Provider  string   `json:"provider"` // laya, jev, system-one
	BaseURL   string   `json:"baseUrl"`
	Model     string   `json:"model"`
	KeyEnv    string   `json:"keyEnv"`
	Threshold *float64 `json:"threshold"`
	Languages []string `json:"languages"`
	TimeoutMs int      `json:"timeoutMs"`
}

// DefaultThreshold and DefaultDecisionLanguages are router.ts's; DefaultDecisionTimeoutMs is system-one.ts's.
const (
	DefaultThreshold         = 0.75
	DefaultDecisionTimeoutMs = 3000
)

var DefaultDecisionLanguages = []string{"hi", "en"}

// ChoiceQuestion is a choice question: its labels and what each means.
type ChoiceQuestion struct {
	Instructions string
	Criteria     [][2]string // label, meaning: in the order the TypeScript object has them
}

// ChoiceAnswer is a checked answer to a choice question.
type ChoiceAnswer struct {
	Choice        string
	Confidence    float64
	Probabilities map[string]float64
}

// Decision is a checked answer.
type Decision struct {
	Model        string
	Answers      map[string]ChoiceAnswer
	InputTokens  int64
	OutputTokens int64
}

// SystemOne is one configured decision model.
type SystemOne struct {
	Kind, Model string
	url, key    string
	timeoutMs   int
	client      *http.Client
}

// NewSystemOne is systemOneFromEnv: Jev without its key is nil (the step is simply off; the caller says so). Laya needs no key.
func NewSystemOne(c *DecisionConfig) *SystemOne {
	if c == nil {
		return nil
	}
	key := ""
	if c.KeyEnv != "" {
		key = strings.TrimSpace(os.Getenv(c.KeyEnv))
	}
	if c.Provider == "jev" && key == "" {
		return nil
	}
	base := strings.TrimRight(c.BaseURL, "/")
	url := base + "/v1/systemone"
	if strings.HasSuffix(base, "/v1") {
		url = base + "/systemone"
	}
	t := c.TimeoutMs
	if t <= 0 {
		t = DefaultDecisionTimeoutMs
	}
	kind := c.Provider
	if kind == "" {
		kind = "system-one"
	}
	return &SystemOne{Kind: kind, Model: c.Model, url: url, key: key, timeoutMs: t, client: guard.HTTPClient(nil, 0)}
}

// Decide asks the choice questions about `state`. The error is a few plain words (never what the model said, a key or the message).
func (s *SystemOne) Decide(state string, questions map[string]ChoiceQuestion) (Decision, string) {
	qs := map[string]any{}
	for name, q := range questions {
		crit := orderedPairs(q.Criteria)
		qs[name] = map[string]any{"type": "choice", "criteria": crit, "instructions": q.Instructions}
	}
	body, _ := json.Marshal(map[string]any{"state": state, "model": s.Model, "questions": qs})
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(s.timeoutMs)*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return Decision{}, "the connection failed"
	}
	req.Header.Set("content-type", "application/json")
	if s.key != "" {
		req.Header.Set("authorization", "Bearer "+s.key)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return Decision{}, fmt.Sprintf("no answer within %d ms", s.timeoutMs)
		}
		return Decision{}, "the connection failed"
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Decision{}, fmt.Sprintf("the decision model answered HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		if ctx.Err() != nil {
			return Decision{}, fmt.Sprintf("no answer within %d ms", s.timeoutMs)
		}
		return Decision{}, "the connection failed"
	}
	var b any
	if json.Unmarshal(raw, &b) != nil {
		return Decision{}, "its reply was not JSON"
	}
	return ReadDecision(b, questions)
}

// orderedPairs writes a question's criteria in their own order (encoding/json would sort a map's keys).
type orderedPairs [][2]string

func (o orderedPairs) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, kv := range o {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(kv[0])
		v, _ := json.Marshal(kv[1])
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func isProbability(v any) (float64, bool) {
	f, ok := v.(float64)
	return f, ok && !math.IsNaN(f) && !math.IsInf(f, 0) && f >= 0 && f <= 1
}

func isCount(v any) int64 {
	if f, ok := v.(float64); ok && f >= 0 && f == math.Trunc(f) {
		return int64(f)
	}
	return 0
}

func sameKeys(o map[string]any, names []string) bool {
	if len(o) != len(names) {
		return false
	}
	for _, n := range names {
		if _, ok := o[n]; !ok {
			return false
		}
	}
	return true
}

// ReadDecision is system-one.ts `readDecision` for choice questions, on the reply decoded to `any`.
func ReadDecision(body any, questions map[string]ChoiceQuestion) (Decision, string) {
	o, ok := body.(map[string]any)
	answers, aok := o["answers"].(map[string]any)
	model, mok := o["model"].(string)
	if !ok || !aok || !mok {
		return Decision{}, "its reply was not what was expected"
	}
	names := make([]string, 0, len(questions))
	for n := range questions {
		names = append(names, n)
	}
	sort.Strings(names)
	if !sameKeys(answers, names) {
		return Decision{}, "its answers did not match the questions"
	}
	d := Decision{Model: model, Answers: map[string]ChoiceAnswer{}}
	for _, name := range names {
		q := questions[name]
		raw, ok := answers[name].(map[string]any)
		if !ok || raw["type"] != "choice" {
			return Decision{}, fmt.Sprintf(`its answer to "%s" was not the kind asked for`, name)
		}
		labels := make([]string, len(q.Criteria))
		for i, c := range q.Criteria {
			labels[i] = c[0]
		}
		choice, ok := raw["choice"].(string)
		if !ok || !contains(labels, choice) {
			return Decision{}, fmt.Sprintf(`its choice for "%s" was not one of the options`, name)
		}
		probs, ok := raw["probabilities"].(map[string]any)
		if !ok || !sameKeys(probs, labels) {
			return Decision{}, fmt.Sprintf(`its probabilities for "%s" were not for the options asked`, name)
		}
		a := ChoiceAnswer{Choice: choice, Probabilities: map[string]float64{}}
		sum := 0.0
		for _, l := range labels {
			p, ok := isProbability(probs[l])
			if !ok {
				return Decision{}, fmt.Sprintf(`a probability for "%s" was out of range`, name)
			}
			a.Probabilities[l] = p
			sum += p
		}
		if math.Abs(sum-1) > 1e-6+float64(len(labels))*0.005 {
			return Decision{}, fmt.Sprintf(`the probabilities for "%s" did not add up to 1`, name)
		}
		c, ok := isProbability(raw["confidence"])
		if !ok {
			return Decision{}, fmt.Sprintf(`its confidence for "%s" was out of range`, name)
		}
		a.Confidence = c
		d.Answers[name] = a
	}
	if u, ok := o["usage"].(map[string]any); ok {
		d.InputTokens, d.OutputTokens = isCount(u["input_tokens"]), isCount(u["output_tokens"])
	}
	return d, ""
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
