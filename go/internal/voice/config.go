package voice

// The `speech` block of runtime.json (modules/voice/config.ts): voice notes for one shop, OFF unless the block is there. Read and checked in plain words (the TypeScript's
// sentences, none of which repeats what was written, in case it was a key); `Build` turns it into the service a template's agent is handed. No key goes in the block: each base URL
// is a Guard, and the Guard holds the key. Only Geometer's own speech service is built here; a "sarvam" block is refused with a sentence until its adapter is ported (Deferred.md).

import (
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/messaging"
)

// Config is config.ts SpeechConfig, checked.
type Config struct {
	Provider       string
	BaseURL        string
	AgentTokenFile string
	Media          struct {
		LookupBaseURL, DownloadBaseURL    string
		DownloadHosts                     []string
		AgentTokenFile, DownloadTokenFile string
	}
	SttModel     string
	InrPerMinute float64
	MaxSeconds   int
	NotesPerDay  int
	TimeoutMs    int
}

var (
	speechKeys = []string{"provider", "baseUrl", "agentTokenFile", "media", "sttModel", "ttsModel", "rate", "maxSeconds", "notesPerDay", "timeoutMs"}
	mediaKeys  = []string{"lookupBaseUrl", "downloadBaseUrl", "downloadHosts", "agentTokenFile", "downloadTokenFile"}
	keyish     = regexp.MustCompile(`(?i)key|secret|token`)
	tokenFile  = regexp.MustCompile(`(?i)tokenfile`)
	hostName   = regexp.MustCompile(`(?i)^[a-z0-9.-]+$`)
	modelName  = regexp.MustCompile(`(?i)^[a-z0-9:._-]{1,60}$`)
)

const noKey = "No key goes in runtime.json: the base URL is a Guard in front of the provider, and the Guard holds the key."

func isText(v any) bool { s, ok := v.(string); return ok && strings.TrimSpace(s) != "" }

func httpURL(v any, what string, errs *[]string) {
	s, _ := v.(string)
	u, err := url.Parse(s)
	if !isText(v) || err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		*errs = append(*errs, what+" must be the address of a Guard, starting with http:// or https://.")
		return
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.Contains(s, "?") || strings.Contains(s, "#") {
		*errs = append(*errs, what+" must not hold a user name, a password, a query or a #fragment. "+noKey)
	}
}

// keysOf are an object's keys in a fixed order (Go's maps have none; the file's own order is not kept by the reader, so the problems are said in name order).
func keysOf(o map[string]any) []string {
	ks := make([]string, 0, len(o))
	for k := range o {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// Read is config.ts readSpeech: the block checked, every problem in plain words; nil with problems when it cannot be used.
func Read(raw any, folder string) (*Config, []string) {
	o, ok := raw.(map[string]any)
	if !ok {
		return nil, []string{`"speech" must be an object like {"baseUrl": "http://g-speech:8080", "media": {...}, "rate": {...}}. Leave it out and voice is off for this shop.`}
	}
	var errs []string
	for _, k := range keysOf(o) {
		if !contains(speechKeys, k) {
			e := fmt.Sprintf(`I don't know what "%s" means in speech. Allowed: %s.`, k, strings.Join(speechKeys, ", "))
			if keyish.MatchString(k) && !tokenFile.MatchString(k) { // config.ts /key|secret|token(?!file)/iu
				e += " " + noKey
			}
			errs = append(errs, e)
		}
	}
	provider := "geometer"
	if p, has := o["provider"]; has {
		provider, _ = p.(string)
		if provider != "geometer" && provider != "sarvam" {
			errs = append(errs, `speech.provider must be one of "geometer", "sarvam".`)
		} else if provider == "sarvam" {
			errs = append(errs, `speech.provider "sarvam" is not available in this version of the runtime: leave the provider out for Geometer's own speech service.`)
		}
	}
	httpURL(o["baseUrl"], "speech.baseUrl", &errs)
	if v, has := o["agentTokenFile"]; has && !isText(v) {
		errs = append(errs, "speech.agentTokenFile must be the path of a file that holds this agent's credential for that Guard.")
	}
	c := &Config{Provider: provider}
	m, ok := o["media"].(map[string]any)
	if !ok {
		errs = append(errs, `speech.media must be an object like {"downloadBaseUrl": "http://g-media:8080", "downloadHosts": ["<the host the audio is on>"]}.`)
	} else {
		for _, k := range keysOf(m) {
			if !contains(mediaKeys, k) {
				errs = append(errs, fmt.Sprintf(`I don't know what "%s" means in speech.media.`, k))
			}
		}
		if v, has := m["lookupBaseUrl"]; has {
			httpURL(v, "speech.media.lookupBaseUrl", &errs)
		}
		httpURL(m["downloadBaseUrl"], "speech.media.downloadBaseUrl", &errs)
		hosts, _ := m["downloadHosts"].([]any)
		good := len(hosts) > 0
		for _, h := range hosts {
			s, _ := h.(string)
			good = good && isText(h) && hostName.MatchString(s)
		}
		if !good {
			errs = append(errs, "speech.media.downloadHosts must list the host names the audio may be downloaded from (names only, no address). Meta's page does not name the host, so it is a setting.")
		}
		for _, k := range []string{"agentTokenFile", "downloadTokenFile"} {
			if v, has := m[k]; has && !isText(v) {
				errs = append(errs, fmt.Sprintf("speech.media.%s must be the path of a file that holds this agent's credential for that Guard.", k))
			}
		}
		if len(errs) == 0 {
			c.Media.LookupBaseURL, _ = m["lookupBaseUrl"].(string)
			c.Media.DownloadBaseURL, _ = m["downloadBaseUrl"].(string)
			for _, h := range hosts {
				c.Media.DownloadHosts = append(c.Media.DownloadHosts, h.(string))
			}
			c.Media.AgentTokenFile, _ = m["agentTokenFile"].(string)
			c.Media.DownloadTokenFile, _ = m["downloadTokenFile"].(string)
		}
	}
	// a paid provider needs the builder's price; Geometer's own service counts zero rupees unless a price is given
	if r, has := o["rate"]; has || provider != "geometer" {
		ro, isObj := r.(map[string]any)
		price, isNum := ro["sttInrPerMinute"].(float64)
		if !isObj || len(ro) != 1 || !isNum || math.IsInf(price, 0) || price < 0 {
			errs = append(errs, `speech.rate is needed: {"sttInrPerMinute": <rupees>}, the provider's price as the builder reads it on their invoice or the provider's price page. Voice does not run without a price, because then its cost could not be counted.`)
		} else {
			c.InrPerMinute = price
		}
	}
	for _, kv := range []struct {
		k   string
		max float64
		to  *int
	}{{"maxSeconds", 120, &c.MaxSeconds}, {"notesPerDay", 100_000, &c.NotesPerDay}, {"timeoutMs", 60_000, &c.TimeoutMs}} {
		if v, has := o[kv.k]; has {
			n, ok := v.(float64)
			if !ok || n != math.Trunc(n) || n < 1 || n > kv.max {
				errs = append(errs, fmt.Sprintf("speech.%s must be a whole number from 1 to %d.", kv.k, int(kv.max)))
			} else {
				*kv.to = int(n)
			}
		}
	}
	if v, has := o["sttModel"]; has {
		s, _ := v.(string)
		if !isText(v) || !modelName.MatchString(s) {
			errs = append(errs, "speech.sttModel must be a short name as the provider writes it.")
		}
		c.SttModel = s
	}
	if len(errs) > 0 {
		return nil, errs
	}
	at := func(p string) string {
		if p == "" || filepath.IsAbs(p) {
			return p
		}
		return filepath.Join(folder, p)
	}
	c.BaseURL, _ = o["baseUrl"].(string)
	if s, ok := o["agentTokenFile"].(string); ok {
		c.AgentTokenFile = at(s)
	}
	c.Media.AgentTokenFile, c.Media.DownloadTokenFile = at(c.Media.AgentTokenFile), at(c.Media.DownloadTokenFile)
	return c, nil
}

func tokenOf(file string) (string, error) {
	if file == "" {
		return "", nil
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

// Build is config.ts buildVoice: the voice service for a shop whose runtime.json has a `speech` block. languages are the shop's.
func Build(c *Config, languages []string, now func() int64, log func(string)) (*Service, error) {
	timeout := c.TimeoutMs
	if timeout == 0 {
		timeout = 20_000 // generous: a CPU model takes longer than a hosted API, and the Guard's own limit is what ends a call that hangs
	}
	agent, err := tokenOf(c.AgentTokenFile)
	if err != nil {
		return nil, err
	}
	speech, err := NewWire(c.BaseURL, "Geometer speech", timeout, agent)
	if err != nil {
		return nil, err
	}
	src := &MediaSource{Version: messaging.GraphVersion, // whatsapp.ts GRAPH_VERSION: the one place it is written
		DownloadHosts: c.Media.DownloadHosts}
	if c.Media.LookupBaseURL != "" {
		tok, err := tokenOf(c.Media.AgentTokenFile)
		if err != nil {
			return nil, err
		}
		if src.Lookup, err = NewWire(c.Media.LookupBaseURL, "WhatsApp", timeout, tok); err != nil {
			return nil, err
		}
	}
	tok, err := tokenOf(c.Media.DownloadTokenFile)
	if err != nil {
		return nil, err
	}
	if src.Download, err = NewWire(c.Media.DownloadBaseURL, "WhatsApp media", timeout, tok); err != nil {
		return nil, err
	}
	var langs []string
	for _, l := range languages {
		if contains(shopLanguages, l) {
			langs = append(langs, l)
		}
	}
	return New(geometerSpeech{speech}, src, c.InrPerMinute, langs, now, c.MaxSeconds, c.NotesPerDay, log), nil
}
