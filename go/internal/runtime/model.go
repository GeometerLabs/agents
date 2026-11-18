package runtime

// One call to a language model over the OpenAI-compatible wire, asking for JSON (modules/understanding/model-llm.ts askJson, modules/understanding/talk.ts). It sends no key of its
// own (the model Guard in front adds it); it presents this agent's credential if runtime.json names a file for it, or a provider key from the named environment variable.
// It never fails with an error: a timeout, an HTTP error, a refusal, a cut-off answer or a reply that is not JSON comes back as a `Reason` that never contains what the model said.
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
)

const (
	talkMaxTokens = 1200
	talkTimeout   = 12 * time.Second
)

// Model is a shop's talk model.
type Model struct {
	cfg      ModelConfig
	bearer   string
	Provider string
	client   *http.Client
}

// Answer is what one call came to.
type Answer struct {
	Answer       any
	Reason       string
	HasUsage     bool
	InputTokens  int64
	OutputTokens int64
}

// NewModel builds the shop's model, or nil with a line saying why there is none. Nothing is asked of a provider whose key is not in the environment.
func NewModel(cfg *ModelConfig, log func(string)) *Model {
	if cfg == nil {
		return nil
	}
	if cfg.Wire != "openai" {
		log(`The talk is off: only the "openai" model wire is spoken by this runtime.`)
		return nil
	}
	m := &Model{cfg: *cfg, client: &http.Client{}}
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
			log(fmt.Sprintf("The talk is off: %s is not set, so nothing is sent to %s.", cfg.KeyEnv, m.Provider))
			return nil
		}
		m.bearer = key
	case cfg.AgentTokenFile != "":
		b, err := os.ReadFile(cfg.AgentTokenFile)
		if err != nil || strings.TrimSpace(string(b)) == "" {
			log(fmt.Sprintf("I could not read the agent credential file %s (parser.agentTokenFile): the talk is off.", cfg.AgentTokenFile))
			return nil
		}
		m.bearer = strings.TrimSpace(string(b))
	}
	if m.cfg.TimeoutMs <= 0 {
		m.cfg.TimeoutMs = int(talkTimeout / time.Millisecond)
	}
	return m
}

var fence = regexp.MustCompile("(?s)^```(?:json)?\\s*(.*?)\\s*```$")
var think = regexp.MustCompile(`(?s)<think>.*?</think>`)

// Ask makes the one call.
func (m *Model) Ask(system, user string, schema map[string]any, name string) Answer {
	body, _ := json.Marshal(map[string]any{
		"model": m.cfg.Model, "max_tokens": talkMaxTokens, "temperature": 0,
		"response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": name, "strict": true, "schema": schema}},
		"messages":        []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": user}},
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(m.cfg.TimeoutMs)*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(m.cfg.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
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
			return Answer{Reason: fmt.Sprintf("no answer within %d ms", m.cfg.TimeoutMs)}
		}
		return Answer{Reason: "the connection failed"}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Answer{Reason: fmt.Sprintf("the model answered HTTP %d", resp.StatusCode)}
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Answer{Reason: "the connection failed"}
	}
	var reply struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content any    `json:"content"`
				Refusal string `json:"refusal"`
			} `json:"message"`
		} `json:"choices"`
		Usage *struct {
			Prompt     int64 `json:"prompt_tokens"`
			Completion int64 `json:"completion_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(raw, &reply) != nil {
		return Answer{Reason: "its reply was not JSON"}
	}
	out := Answer{}
	if reply.Usage != nil {
		out.HasUsage, out.InputTokens, out.OutputTokens = true, reply.Usage.Prompt, reply.Usage.Completion
	}
	if len(reply.Choices) == 0 {
		out.Reason = "its reply was not what was expected"
		return out
	}
	c := reply.Choices[0]
	if c.Message.Refusal != "" {
		out.Reason = "the model refused"
		return out
	}
	if c.FinishReason == "length" {
		out.Reason = "its answer was cut off"
		return out
	}
	text, ok := c.Message.Content.(string)
	if !ok {
		out.Reason = "its reply had no answer in it"
		return out
	}
	bare := strings.TrimSpace(think.ReplaceAllString(text, ""))
	if f := fence.FindStringSubmatch(bare); f != nil {
		bare = f[1]
	}
	if err := json.Unmarshal([]byte(bare), &out.Answer); err != nil {
		out.Reason = "its answer was not JSON"
		out.Answer = nil
	}
	return out
}
