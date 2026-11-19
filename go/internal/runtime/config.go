// Package runtime is one listings-only shop's runtime: its folder read and checked, its store opened, the saved queue of events run one step at a time, and the HTTP routes the
// shop's front, the directory and the inbox use. The Go twin of modules/runtime and templates/commerce/listings/server. It reads the same folder and the same token files as the
// TypeScript runtime (modules/runtime/shared.ts `folderSource` describes the layout): client/settings.json, runtime.json, pathway.lock (written last), owner-link.json,
// pages.json, owner-grants.json; secrets internal_token, channel_token, record_key.
package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/budget"
	_ "time/tzdata" // the zone database inside the binary: a small server image has none
)

// Pathway and Version are what a folder's pathway.lock must name. Version is the number in templates/commerce/listings/package.json; the contract suite checks they agree.
const (
	Pathway = "listings"
	Version = "0.2.0"
	// NoNumber stands for "the owner" when the owner gave no number: a plus and eleven zeros.
	NoNumber = "+00000000000"
)

// ClientError is a problem with the shop's folder, in plain words (the process says it and stops).
type ClientError struct{ Msg string }

func (e ClientError) Error() string { return e.Msg }

func bad(format string, a ...any) error { return ClientError{fmt.Sprintf(format, a...)} }

// Settings is settings.json, checked. The assistant block is kept raw: this runtime reads none of its fields (the morning line and the character are the TypeScript runtime's).
type Settings struct {
	Name     string
	Town     string
	Pincode  string
	Trade    string
	Timezone string
	Language []string
	Owner    struct {
		Whatsapp string
		Language string
		NoNumber bool
	}
	// Assistant is the `assistant` block's character and morning hour (modules/assistant/settings.ts, character.ts). Read leniently: this runtime does not check the block (the
	// TypeScript validator does when the shop is made); a value it cannot read takes TypeScript's default.
	Assistant struct {
		Name, Style, Personality, Seed, Colour, Paint string
		MorningOff                                    bool // "morning": false
		MorningHour, MorningMinute                    int
	}
}

// ModelConfig is runtime.json's `parser` (or `talk`): which model writes a listing's words, reached through the model Guard.
type ModelConfig struct {
	Wire           string `json:"wire"`
	BaseURL        string `json:"baseUrl"`
	Model          string `json:"model"`
	TimeoutMs      int    `json:"timeoutMs"`
	AgentTokenFile string `json:"agentTokenFile"`
	Provider       string `json:"provider"`
	KeyEnv         string `json:"keyEnv"`
	// Rate is a builder's own price for a model they host, for provider "self-hosted" (runtime.json parser.rate).
	Rate *budget.BuilderRate `json:"rate"`
}

// Runtime is runtime.json, checked.
type Config struct {
	Mode        string
	Host        string
	Port        int
	DataDir     string
	TickSeconds float64
	Talk        *ModelConfig // `talk`, or `parser` when there is no talk
	Budget      *budget.Config
	PauseMin    int64
	AllowMsgs   *int64
	AllowMicro  *int64
	file        string
}

// Client is a shop's folder, read.
type Client struct {
	Folder   string
	Settings Settings
	Config   Config
	Lock     struct{ Pathway, Version string }
}

var (
	lockLine  = regexp.MustCompile(`^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$`)
	phone     = regexp.MustCompile(`^\+[1-9]\d{7,14}$`)
	pincodeRe = regexp.MustCompile(`^[1-9]\d{5}$`)
	languages = []string{"en", "hi", "ml", "kn"}
)

func readFolderJSON(dir, name string) (map[string]any, error) {
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return nil, bad("I could not find %s in %s. A client folder needs settings.json, runtime.json and pathway.lock.", name, dir)
	}
	var v map[string]any
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, bad("%s in %s is not valid JSON: %v", name, dir, err)
	}
	return v, nil
}

// LoadClient reads and checks a whole client folder, and refuses if it is pinned to another version of the pathway than this one.
func LoadClient(folder string) (*Client, error) {
	dir, err := filepath.Abs(folder)
	if err != nil {
		return nil, err
	}
	c := &Client{Folder: dir}
	lock, err := os.ReadFile(filepath.Join(dir, "pathway.lock"))
	if err != nil {
		return nil, bad("I could not find pathway.lock in %s. A client folder needs settings.json, runtime.json and pathway.lock.", dir)
	}
	var lines []string
	for _, l := range strings.Split(string(lock), "\n") {
		if l = strings.TrimSpace(l); l != "" && !strings.HasPrefix(l, "#") {
			lines = append(lines, l)
		}
	}
	m := lockLine.FindStringSubmatch(firstOr(lines))
	if m == nil {
		return nil, bad(`pathway.lock must say which pathway version this client is pinned to, on one line, like "bookings@0.1.0".`)
	}
	if len(lines) > 1 {
		return nil, bad("pathway.lock lists more than one line. This runtime cannot load modules yet, so it will not start with a lock that asks for them.")
	}
	c.Lock.Pathway, c.Lock.Version = m[1], m[2]
	if c.Lock.Pathway != Pathway || c.Lock.Version != Version {
		return nil, bad("This client is pinned to %s@%s (pathway.lock), but this runtime is %s@%s. It will not start on a different version.", c.Lock.Pathway, c.Lock.Version, Pathway, Version)
	}
	s, err := readFolderJSON(dir, "settings.json")
	if err != nil {
		return nil, err
	}
	if err := c.readSettings(s); err != nil {
		return nil, err
	}
	r, err := readFolderJSON(dir, "runtime.json")
	if err != nil {
		return nil, err
	}
	if err := c.readRuntime(r); err != nil {
		return nil, err
	}
	return c, nil
}

func firstOr(l []string) string {
	if len(l) == 0 {
		return ""
	}
	return l[0]
}

func oneLine(v any, max int) (string, bool) {
	s, ok := v.(string)
	if !ok || strings.TrimSpace(s) == "" || len([]rune(strings.TrimSpace(s))) > max {
		return "", false
	}
	for _, r := range s {
		if r < 0x20 || (r >= 0x7f && r < 0xa0) {
			return "", false
		}
	}
	return strings.TrimSpace(s), true
}

func (c *Client) readSettings(in map[string]any) error {
	var errs []string
	s := &c.Settings
	if name, ok := oneLine(in["name"], 60); ok {
		s.Name = name
	} else {
		errs = append(errs, `Add the shop's name ("name"): one short line, at most 60 characters.`)
	}
	tz, _ := in["timezone"].(string)
	if tz == "" {
		tz = "Asia/Kolkata"
	}
	if _, err := time.LoadLocation(tz); err != nil {
		errs = append(errs, fmt.Sprintf(`The time zone %q is not one I know. Use a name like "Asia/Kolkata".`, tz))
	}
	s.Timezone = tz
	if place, ok := in["place"].(map[string]any); !ok {
		errs = append(errs, `Add the shop's place ("place": {"town": "Thrissur", "pincode": "680001"}).`)
	} else {
		if t, ok := oneLine(place["town"], 60); ok {
			s.Town = strings.Join(strings.Fields(t), " ")
		} else {
			errs = append(errs, `The town ("place.town") is one short line, at most 60 characters.`)
		}
		if p, present := place["pincode"]; present {
			if ps, ok := p.(string); ok && pincodeRe.MatchString(ps) {
				s.Pincode = ps
			} else {
				errs = append(errs, `The pincode ("place.pincode") is six digits, not starting with 0.`)
			}
		}
	}
	if t, present := in["trade"]; present {
		if ts, ok := oneLine(t, 60); ok {
			s.Trade = ts
		} else {
			errs = append(errs, `The trade ("trade") is a few words in the Operator's own language, one short line.`)
		}
	}
	if list, ok := in["languages"].([]any); !ok || len(list) == 0 {
		errs = append(errs, `List the languages ("languages"), for example ["en", "hi"].`)
	} else {
		for _, l := range list {
			ls, _ := l.(string)
			if !contains(languages, ls) {
				errs = append(errs, fmt.Sprintf("The language %v is not one I know.", l))
			} else if !contains(s.Language, ls) {
				s.Language = append(s.Language, ls)
			}
		}
	}
	if owner, ok := in["owner"].(map[string]any); !ok {
		errs = append(errs, `Add the owner ("owner": their language, and their phone number if they gave one).`)
	} else {
		lang, _ := owner["language"].(string)
		if lang == "" && len(s.Language) > 0 {
			lang = s.Language[0]
		}
		if !contains(languages, lang) {
			errs = append(errs, `The owner's language ("owner.language") must be one of "en", "hi", "ml", "kn".`)
		}
		s.Owner.Language = lang
		s.Owner.Whatsapp, s.Owner.NoNumber = NoNumber, true
		if w, present := owner["whatsapp"]; present {
			if ws, ok := w.(string); ok && phone.MatchString(ws) {
				s.Owner.Whatsapp, s.Owner.NoNumber = ws, false
			} else {
				errs = append(errs, `The owner's phone number ("owner.whatsapp") must look like +919812345678, or be left out.`)
			}
		}
	}
	s.readAssistant(in["assistant"])
	if len(errs) > 0 {
		return bad("These settings need fixing (settings.json):\n- %s", strings.Join(errs, "\n- "))
	}
	return nil
}

var hhmm = regexp.MustCompile(`^([01]\d|2[0-3]):([0-5]\d)$`)

// readAssistant takes the character and the morning hour out of the `assistant` block, with settings.ts's defaults (Clay, warm, 08:00).
func (s *Settings) readAssistant(raw any) {
	a := &s.Assistant
	a.Style, a.Personality, a.MorningHour, a.MorningMinute = "clay", "warm", 8, 0
	block, _ := raw.(map[string]any)
	switch m := block["morning"].(type) {
	case bool:
		a.MorningOff = !m
	case map[string]any:
		if at, ok := m["at"].(string); ok {
			if h := hhmm.FindStringSubmatch(at); h != nil {
				a.MorningHour, _ = strconv.Atoi(h[1])
				a.MorningMinute, _ = strconv.Atoi(h[2])
			}
		}
	}
	c, _ := block["character"].(map[string]any)
	str := func(k string) string { v, _ := c[k].(string); return v }
	a.Name = strings.TrimSpace(str("name"))
	if v := str("style"); v != "" {
		a.Style = v
	}
	if v := str("personality"); v == "cheerful" || v == "brief" || v == "warm" {
		a.Personality = v
	}
	a.Seed, a.Paint = str("seed"), str("paint")
	a.Colour = strings.ToLower(strings.TrimPrefix(str("colour"), "#"))
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

func (c *Client) readRuntime(in map[string]any) error {
	var errs []string
	cfg := &c.Config
	cfg.file = filepath.Join(c.Folder, "runtime.json")
	if m := in["mode"]; m != "fakes" && m != "live" {
		errs = append(errs, `Set "mode" to "fakes" (stand-in services, for a local run) or "live" (real services through Guard).`)
	} else {
		cfg.Mode = m.(string)
	}
	cfg.Host = "127.0.0.1"
	if h, ok := in["host"].(string); ok && h != "" {
		cfg.Host = h
	}
	cfg.Port = 8780
	if p, ok := in["port"].(float64); ok && p >= 0 && p <= 65535 && p == float64(int(p)) {
		cfg.Port = int(p)
	}
	dir := "data"
	if d, ok := in["dataDir"].(string); ok && d != "" {
		dir = d
	}
	if !filepath.IsAbs(dir) {
		dir = filepath.Join(c.Folder, dir)
	}
	cfg.DataDir = dir
	cfg.TickSeconds = 30
	if t, ok := in["tickSeconds"].(float64); ok && t >= 1 {
		cfg.TickSeconds = t
	}
	for _, key := range []string{"talk", "parser"} {
		raw, present := in[key]
		if !present {
			continue
		}
		var m ModelConfig
		b, _ := json.Marshal(raw)
		if json.Unmarshal(b, &m) != nil || (m.Wire != "openai" && m.Wire != "anthropic") || m.BaseURL == "" || m.Model == "" {
			errs = append(errs, fmt.Sprintf(`"%s" must be an object like {"wire": "openai", "baseUrl": "https://your-guard.example/model/v1", "model": "<the model's name>"}.`, key))
			continue
		}
		if cfg.Talk == nil || key == "talk" {
			cfg.Talk = &m
		}
	}
	if b, present := in["budget"]; present {
		m, ok := b.(map[string]any)
		if !ok || !budget.Valid(m) {
			errs = append(errs, `"budget" is {"monthlyMicroInr": a whole number, "daily": {"<feature>": a whole number of calls, ...}}.`)
		} else {
			raw, _ := json.Marshal(m)
			var bc budget.Config
			_ = json.Unmarshal(raw, &bc)
			cfg.Budget = &bc
		}
	}
	if p, ok := in["pauseMinutes"].(float64); ok {
		cfg.PauseMin = int64(p)
	}
	if a, ok := in["allowance"].(map[string]any); ok {
		if n, ok := a["messages"].(float64); ok {
			v := int64(n)
			cfg.AllowMsgs = &v
		}
		if n, ok := a["costInr"].(float64); ok {
			v := int64(n * 1_000_000)
			cfg.AllowMicro = &v
		}
	}
	if len(errs) > 0 {
		return bad("runtime.json needs fixing:\n- %s", strings.Join(errs, "\n- "))
	}
	return nil
}

// Switch reads one of runtime.json's two outside switches ("ai": "buttons", "model": "off") fresh, so a change the deployer writes while the shop runs takes effect at once. A
// file that cannot be read or is not JSON for a moment leaves the normal answer; it never turns a switch off by accident.
func (c *Config) Switch(key, on, normal string) string {
	b, err := os.ReadFile(c.file)
	if err != nil {
		return normal
	}
	var v map[string]any
	if json.Unmarshal(b, &v) != nil {
		return normal
	}
	if s, _ := v[key].(string); s == on {
		return on
	}
	return normal
}
