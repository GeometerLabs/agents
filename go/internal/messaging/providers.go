// Which WhatsApp provider a shop's live runtime talks to (providers.ts), chosen by runtime.json's services.messaging.provider. Meta direct is the default: a config that names no
// provider behaves as it always did. Whichever is chosen, the base URL is a Guard in front of that provider and the provider's key is Guard's. ConfigProblem is the words the check
// gives (read by runtime.json's own check), NewLive builds the client.
package messaging

import "strings"

// Providers is MESSAGING_PROVIDERS.
var Providers = []string{"meta", "gupshup", "gupshup-selfserve"}

// LiveConfig is services.messaging as the live clients take it (the agent's Guard credential already read from its file). The three optional strings are pointers because
// TypeScript tells "left out" from "": an empty appId is a wrong appId, not a missing one. Provider "" is "left out", which is "meta".
type LiveConfig struct {
	BaseURL       string
	PhoneNumberID string
	Provider      string
	AppID         *string
	AppName       *string
	SourceNumber  *string
	AgentToken    string
	TimeoutMs     int
}

func has(c map[string]any, k string) bool { _, ok := c[k]; return ok }

// isString is `typeof v === "string"`.
func isString(v any) (string, bool) { s, ok := v.(string); return s, ok }

// ConfigProblem is providers.ts messagingConfigProblem on a decoded services.messaging object (a missing key is JavaScript's `undefined`, a JSON null is present): why its provider
// fields cannot be used, in plain words, or "".
func ConfigProblem(c map[string]any) string {
	if has(c, "provider") {
		ok := false
		if p, isStr := isString(c["provider"]); isStr {
			for _, k := range Providers {
				ok = ok || k == p
			}
		}
		if !ok {
			quoted := make([]string, len(Providers))
			for i, p := range Providers {
				quoted[i] = `"` + p + `"`
			}
			return "services.messaging.provider must be one of " + strings.Join(quoted, ", ") + ` ("meta" when left out).`
		}
	}
	provider, _ := isString(c["provider"])
	if provider == "gupshup" {
		if s, ok := isString(c["appId"]); !ok || !GupshupAppID.MatchString(s) {
			return `services.messaging.appId is needed with "provider": "gupshup": the shop's Gupshup app id, as Gupshup shows it (letters, digits and hyphens).`
		}
	}
	if provider == "gupshup-selfserve" {
		if s, ok := isString(c["appName"]); !ok || !GupshupAppName.MatchString(s) {
			return `services.messaging.appName is needed with "provider": "gupshup-selfserve": the shop's Gupshup app name, as Gupshup shows it (letters, digits and underscores).`
		}
		if s, ok := isString(c["sourceNumber"]); !ok || !GupshupSourceNumber.MatchString(s) {
			return `services.messaging.sourceNumber is needed with "provider": "gupshup-selfserve": the app's WhatsApp number with its country code, digits only.`
		}
		if has(c, "appId") {
			if s, ok := isString(c["appId"]); !ok || !GupshupSelfServeAppID.MatchString(s) {
				return "services.messaging.appId, when given, must be the app's id as Gupshup shows it (letters, digits and hyphens)."
			}
		}
		return ""
	}
	if has(c, "appName") || has(c, "sourceNumber") {
		return `services.messaging.appName and sourceNumber are only for "provider": "gupshup-selfserve".`
	}
	if provider != "gupshup" && has(c, "appId") {
		return `services.messaging.appId is only for "provider": "gupshup" (or, optionally, "gupshup-selfserve").`
	}
	return ""
}

// Problem is ConfigProblem for a typed config.
func (c LiveConfig) Problem() string {
	m := map[string]any{}
	if c.Provider != "" {
		m["provider"] = c.Provider
	}
	if c.AppID != nil {
		m["appId"] = *c.AppID
	}
	if c.AppName != nil {
		m["appName"] = *c.AppName
	}
	if c.SourceNumber != nil {
		m["sourceNumber"] = *c.SourceNumber
	}
	return ConfigProblem(m)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// NewLive is createLiveMessaging: the live Messaging for this shop's provider. It fails, in plain words, for a config ConfigProblem refuses.
func NewLive(c LiveConfig, deps Deps) (Messaging, error) {
	if p := c.Problem(); p != "" {
		return nil, errPlain(p)
	}
	switch c.Provider {
	case "gupshup":
		return NewGupshup(GupshupConfig{BaseURL: c.BaseURL, AppID: deref(c.AppID), TimeoutMs: c.TimeoutMs, AgentToken: c.AgentToken}, deps)
	case "gupshup-selfserve":
		return NewSelfServe(SelfServeConfig{BaseURL: c.BaseURL, AppName: deref(c.AppName), SourceNumber: deref(c.SourceNumber), AppID: deref(c.AppID), TimeoutMs: c.TimeoutMs, AgentToken: c.AgentToken}, deps)
	}
	return NewMeta(MetaConfig{BaseURL: c.BaseURL, PhoneNumberID: c.PhoneNumberID, TimeoutMs: c.TimeoutMs, AgentToken: c.AgentToken}, deps)
}
