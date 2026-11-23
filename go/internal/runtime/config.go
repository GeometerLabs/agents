// Package runtime is a shop's runtime: the listings-only shop's (wave 1), and every template's shared part (template.go: a Bookings shop gives it a Kit, wave 2). Its folder read and checked, its store opened, the saved queue of events run one step at a time, and the HTTP routes the
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
	"github.com/GeometerLabs/agents/go/internal/understanding"
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
	// HasAssistant: the settings have an `assistant` block, so a template's shop has the owner's assistant (wire.ts: none without one).
	HasAssistant bool
	// Own is a template's own settings (template.go Kit.ReadSettings), nil for the listings shop. Raw is settings.json as read, for a template that reads a member again.
	Own any
	Raw map[string]any
}

// ModelConfig is runtime.json's `parser` (or `talk`): understanding.ModelConfig.
type ModelConfig = understanding.ModelConfig

// Runtime is runtime.json, checked.
type Config struct {
	Mode        string
	Host        string
	Port        int
	DataDir     string
	TickSeconds float64
	Talk        *ModelConfig                  // `talk`, or `parser` when there is no talk
	Parser      *ModelConfig                  // `parser`: the router's language step (step 2)
	Decision    *understanding.DecisionConfig // `decision`: the router's decision model (step 1)
	Budget      *budget.Config
	PauseMin    int64
	AllowMsgs   *int64
	AllowMicro  *int64
	// Services is runtime.json's `services` as read (nil: not given; an empty object is "no WhatsApp", config.ts runtimeHasWhatsApp), for a template to check and use. Raw is the
	// whole file as read.
	Services map[string]any
	Raw      map[string]any
	// StandInsHTTP: runtime.json `"standins": "http"` (checked by standInsProblems): a "fakes" shop whose services are the hand check's stand-ins over HTTP, reached through the
	// live clients. A template's BuildPorts takes its live path for such a shop, and only then; everything else about a fakes shop (the test clock, no record key) is unchanged.
	StandInsHTTP bool
	file         string
}

// UsesClients says whether this shop reaches its services through the live clients (live mode, or the hand check's stand-ins over HTTP) rather than the in-memory stand-ins.
func (c Config) UsesClients() bool { return c.Mode == "live" || c.StandInsHTTP }

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
func LoadClient(folder string) (*Client, error) { return LoadClientKit(folder, nil) }

// LoadClientKit is LoadClient for a template's folder: the lock must name the template's pathway and version, and its settings are checked the template's way. With no kit it is
// the listings shop's folder.
func LoadClientKit(folder string, kit Kit) (*Client, error) {
	pathway, version := Pathway, Version
	if kit != nil {
		pathway, version = kit.Pathway(), kit.Version()
	}
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
	if c.Lock.Pathway != pathway || c.Lock.Version != version {
		return nil, bad("This client is pinned to %s@%s (pathway.lock), but this runtime is %s@%s. It will not start on a different version.", c.Lock.Pathway, c.Lock.Version, pathway, version)
	}
	s, err := readFolderJSON(dir, "settings.json")
	if err != nil {
		return nil, err
	}
	c.Settings.Raw = s
	if kit != nil {
		raw, _ := os.ReadFile(filepath.Join(dir, "settings.json"))
		own, errs := kit.ReadSettings(s, raw, &c.Settings)
		if len(errs) > 0 {
			return nil, bad("These settings need fixing (settings.json):\n- %s", strings.Join(errs, "\n- "))
		}
		c.Settings.Own = own
	} else if err := c.readSettings(s); err != nil {
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

// ReadAssistant is readAssistant for a template's settings (the same lenient reading of the character and the morning hour).
func (s *Settings) ReadAssistant(raw any) { s.readAssistant(raw) }

// readAssistant takes the character and the morning hour out of the `assistant` block, with settings.ts's defaults (Clay, warm, 08:00).
func (s *Settings) readAssistant(raw any) {
	a := &s.Assistant
	a.Style, a.Personality, a.MorningHour, a.MorningMinute = "clay", "warm", 8, 0
	block, _ := raw.(map[string]any)
	s.HasAssistant = block != nil
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
	cfg.Raw = in
	if sv, ok := in["services"].(map[string]any); ok {
		cfg.Services = sv
	}
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
		if key == "parser" {
			p := m
			cfg.Parser = &p
		}
	}
	if raw, present := in["decision"]; present {
		// modules/runtime/config.ts readDecision: the same object, checked for what a decision model needs (the TypeScript's sentences)
		m, ok := raw.(map[string]any)
		var d understanding.DecisionConfig
		b, _ := json.Marshal(raw)
		switch {
		case !ok || json.Unmarshal(b, &d) != nil:
			errs = append(errs, `"decision" must be an object like {"provider": "laya", "baseUrl": "http://127.0.0.1:8080", "model": "laya"}. Leave it out and no decision model is asked.`)
		case d.Provider != "laya" && d.Provider != "jev" && d.Provider != "system-one":
			errs = append(errs, `decision.provider must be "laya" (on the shop's own server), "jev" (hosted) or "system-one" (any other server that speaks the same API).`)
		case !strings.HasPrefix(d.BaseURL, "http://") && !strings.HasPrefix(d.BaseURL, "https://"):
			errs = append(errs, "decision.baseUrl must be the address of the decision model, starting with http:// or https://.")
		case d.Model == "":
			errs = append(errs, "decision.model must be the name the server serves the model under, for example laya.")
		default:
			_ = m
			cfg.Decision = &d
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
	if v, present := in["standins"]; present {
		cfg.StandInsHTTP = true
		errs = append(errs, standInsProblems(v, cfg.Mode, cfg.Services)...)
		// the hand check's shop may beat faster than once a second (down to 0.1 s): each situation moves the test clock and waits for a beat, so a whole check takes a
		// minute, not several. A real shop keeps the one-second floor above.
		if t, ok := in["tickSeconds"].(float64); ok && t >= 0.1 && t < 1 {
			cfg.TickSeconds = t
		}
	}
	if len(errs) > 0 {
		return bad("runtime.json needs fixing:\n- %s", strings.Join(errs, "\n- "))
	}
	return nil
}

// standInsProblems checks runtime.json `"standins": "http"` (the go-live hand check's shop, modules/crash-test/go-shop.ts, 24 Nov 2026). Such a shop is a "fakes" shop (so it may
// run on the test clock, internal/testclock) whose services are the hand check's stand-ins, reached over HTTP through the SAME clients a live shop uses, so a stand-in can fail on
// purpose (a lost reply, a calendar that saves nothing) and keep the records the situations are judged from. Why it can never reach a real service: it is refused outside
// "fakes" mode, and every service it names must be on this machine (http://127.0.0.1 or http://localhost), so no real provider can stand behind it.
func standInsProblems(v any, mode string, services map[string]any) []string {
	var errs []string
	if v != "http" {
		errs = append(errs, `"standins" can only be "http" (the hand check's stand-ins, reached over HTTP on this machine). Leave it out for a shop's own stand-ins or real services.`)
	}
	if mode != "fakes" {
		errs = append(errs, `"standins" is for a "fakes" shop only (the hand check's): a "live" shop reaches real services through its Guards.`)
	}
	for _, name := range []string{"payments", "calendar", "messaging"} {
		m, ok := services[name].(map[string]any)
		if !ok {
			continue
		}
		u, _ := m["baseUrl"].(string)
		if !strings.HasPrefix(u, "http://127.0.0.1:") && !strings.HasPrefix(u, "http://localhost:") {
			errs = append(errs, fmt.Sprintf(`With "standins", services.%s.baseUrl must be a stand-in on this machine (http://127.0.0.1:<port>).`, name))
		}
	}
	return errs
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
