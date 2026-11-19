// Package understanding is the shop's model steps, for any template (the Go twin of modules/understanding): one JSON call to a language model over the OpenAI-compatible wire
// (this file, model-llm.ts askJson and talk.ts), the System One decision model (systemone.go), the router that reads a message cheapest first (router.go), and the personal
// details taken out of words before any model sees them (redact.go). What a model answers is never trusted: every answer is decoded to `any` and its types are checked by hand,
// as the TypeScript does, because struct decoding accepts and refuses differently from JavaScript.
//
// It builds on `language` (and on `budget` for the price table); `assistant` builds on it, never the other way round.
package understanding

// One call to a language model over the OpenAI-compatible wire, asking for JSON (modules/understanding/model-llm.ts askJson). It sends no key of its own (the model Guard in front
// adds it); it presents this agent's credential if runtime.json names a file for it, or a provider key from the named environment variable. It never fails with an error: a
// timeout, an HTTP error, a refusal, a cut-off answer or a reply that is not JSON comes back as a `Reason` that never contains what the model said.
//
// Only the "openai" wire is spoken here: the model Guard in front of a shop speaks it for every provider the deployer uses. The "anthropic" wire is the TypeScript runtime's.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/budget"
)

// ModelConfig is runtime.json's `parser` (or `talk`): which model, reached how.
type ModelConfig struct {
	Wire           string `json:"wire"`
	BaseURL        string `json:"baseUrl"`
	Model          string `json:"model"`
	TimeoutMs      int    `json:"timeoutMs"`
	MaxTokens      int    `json:"maxTokens"`
	AgentTokenFile string `json:"agentTokenFile"`
	Provider       string `json:"provider"`
	KeyEnv         string `json:"keyEnv"`
	// Rate is a builder's own price for a model they host, for provider "self-hosted" (runtime.json parser.rate).
	Rate *budget.BuilderRate `json:"rate"`
}

// The defaults of the two uses: the talk (talk.ts TALK_TIMEOUT_MS, TALK_MAX_TOKENS) and the router's language step (model-llm.ts DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TOKENS).
const (
	TalkTimeoutMs   = 12_000
	TalkMaxTokens   = 1200
	ParserTimeoutMs = 8000
	ParserMaxTokens = 1024
)

// Model is one configured model.
type Model struct {
	Cfg      ModelConfig
	bearer   string
	Provider string
	client   *http.Client
}

// Answer is what one call came to. Answer is the model's JSON, untrusted (nil when there is none: Reason says why).
type Answer struct {
	Answer       any
	Reason       string
	HasUsage     bool
	InputTokens  int64
	OutputTokens int64
}

// Call is one call: the system text, the one user message, the JSON schema of the answer and its name on the wire.
type Call struct {
	System, User string
	Schema       map[string]any
	Name         string
}

// NewModel builds a model, or nil with a line saying why there is none (`off` begins the line: "The talk is off", "Step 2 (the language model) is off"). Nothing is asked of a
// provider whose key is not in the environment. `timeoutMs` and `maxTokens` are the use's defaults; runtime.json's own values win.
func NewModel(cfg *ModelConfig, log func(string), off string, timeoutMs, maxTokens int) *Model {
	if cfg == nil {
		return nil
	}
	if cfg.Wire != "openai" {
		log(off + `: only the "openai" model wire is spoken by this runtime.`)
		return nil
	}
	m := &Model{Cfg: *cfg, client: &http.Client{}}
	if u, err := url.Parse(cfg.BaseURL); err == nil {
		m.Provider = u.Hostname()
	}
	if cfg.Provider != "" {
		m.Provider = cfg.Provider
	}
	switch {
	case cfg.KeyEnv != "":
		key := strings.TrimSpace(os.Getenv(cfg.KeyEnv))
		if key == "" {
			log(fmt.Sprintf("%s: %s is not set, so nothing is sent to %s.", off, cfg.KeyEnv, m.Provider))
			return nil
		}
		m.bearer = key
	case cfg.AgentTokenFile != "":
		b, err := os.ReadFile(cfg.AgentTokenFile)
		if err != nil || strings.TrimSpace(string(b)) == "" {
			log(fmt.Sprintf("I could not read the agent credential file %s (parser.agentTokenFile): %s.", cfg.AgentTokenFile, strings.ToLower(off[:1])+off[1:]))
			return nil
		}
		m.bearer = strings.TrimSpace(string(b))
	}
	if m.Cfg.TimeoutMs <= 0 {
		m.Cfg.TimeoutMs = timeoutMs
	}
	if m.Cfg.MaxTokens <= 0 {
		m.Cfg.MaxTokens = maxTokens
	}
	return m
}

var fence = regexp.MustCompile("(?s)^```(?:json)?[" + jsSpace + "]*(.*?)[" + jsSpace + "]*```$")
var think = regexp.MustCompile(`(?s)<think>.*?</think>`)

const jsSpace = `\t\n\x0b\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// Ask makes the one call.
func (m *Model) Ask(c Call) Answer {
	body, _ := json.Marshal(map[string]any{
		"model": m.Cfg.Model, "max_tokens": m.Cfg.MaxTokens, "temperature": 0,
		"response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": c.Name, "strict": true, "schema": c.Schema}},
		"messages":        []map[string]string{{"role": "system", "content": c.System}, {"role": "user", "content": c.User}},
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(m.Cfg.TimeoutMs)*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(m.Cfg.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return Answer{Reason: "the connection failed"}
	}
	req.Header.Set("content-type", "application/json")
	if m.bearer != "" {
		req.Header.Set("authorization", "Bearer "+m.bearer)
	}
	resp, err := m.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return Answer{Reason: fmt.Sprintf("no answer within %d ms", m.Cfg.TimeoutMs)}
		}
		return Answer{Reason: "the connection failed"}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Answer{Reason: fmt.Sprintf("the model answered HTTP %d", resp.StatusCode)}
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		if ctx.Err() != nil {
			return Answer{Reason: fmt.Sprintf("no answer within %d ms", m.Cfg.TimeoutMs)}
		}
		return Answer{Reason: "the connection failed"}
	}
	var body2 any
	if json.Unmarshal(raw, &body2) != nil {
		return Answer{Reason: "its reply was not JSON"}
	}
	return readOpenAI(body2)
}

// readOpenAI is model-llm.ts `readOpenAI`, on the reply decoded to `any`: a usage member that is not an object counts nothing; a token count that is not a number is 0.
func readOpenAI(body any) Answer {
	o, ok := body.(map[string]any)
	if !ok {
		return Answer{Reason: "its reply was not what was expected"}
	}
	out := Answer{}
	if u, ok := o["usage"].(map[string]any); ok {
		out.HasUsage, out.InputTokens, out.OutputTokens = true, asNumber(u["prompt_tokens"]), asNumber(u["completion_tokens"])
	}
	var choice, message map[string]any
	if cs, ok := o["choices"].([]any); ok && len(cs) > 0 {
		choice, _ = cs[0].(map[string]any)
	}
	if choice != nil {
		message, _ = choice["message"].(map[string]any)
	}
	if r, ok := message["refusal"].(string); ok && r != "" {
		out.Reason = "the model refused"
		return out
	}
	if f, ok := choice["finish_reason"].(string); ok && f == "length" {
		out.Reason = "its answer was cut off"
		return out
	}
	text, ok := message["content"].(string)
	if !ok {
		out.Reason = "its reply had no answer in it"
		return out
	}
	bare := strings.TrimFunc(think.ReplaceAllString(text, ""), isJSSpace)
	if f := fence.FindStringSubmatch(bare); f != nil {
		bare = f[1]
	}
	if err := json.Unmarshal([]byte(bare), &out.Answer); err != nil {
		out.Reason = "its answer was not JSON"
		out.Answer = nil
	}
	return out
}

// asNumber is `typeof v === "number" ? v : 0` (a count is whole: a fraction is cut, which only a broken reply would send).
func asNumber(v any) int64 {
	if f, ok := v.(float64); ok {
		return int64(f)
	}
	return 0
}

func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', 0x0b, '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// ---- what a call cost ---------------------------------------------------------------------------------------------------------------------------------

// Cost prices a call from the dated rate table the TypeScript way (rates.ts, talk.ts): a call with no usage costs 0; one with usage and no price is unpriced (nil); a builder's
// own rate (runtime.json parser.rate) is one more line, for provider "self-hosted". rateDate is the rate's date ("" when unpriced or with no usage).
func (m *Model) Cost(a Answer, nowMs int64) (cost *int64, rateDate string) {
	if !a.HasUsage {
		zero := int64(0)
		return &zero, ""
	}
	return PriceOf(m.Provider, m.Cfg.Model, m.Cfg.Rate, a.InputTokens, a.OutputTokens, nowMs)
}

// PriceOf is the price of tokens of one provider's model on the day of `nowMs` (UTC, as rates.ts dayOf), or nil when the table has no price.
func PriceOf(provider, model string, own *budget.BuilderRate, in, out int64, nowMs int64) (*int64, string) {
	day := time.UnixMilli(nowMs).UTC().Format("2006-01-02")
	var extra []budget.Rate
	if own != nil {
		extra = append(extra, budget.SelfHostedRate(model, *own, day))
	}
	rate := budget.RateFor(provider, model, day, extra...)
	c := budget.CostMicroInr(rate, in, out, 0)
	if c == nil {
		return nil, ""
	}
	return c, rate.From
}
