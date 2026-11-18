package shared

// The "back soon" answer for a PAUSED shop (templates/commerce/listings/server/back-soon.ts and modules/runtime/shared.ts `backSoon`): 503, Retry-After an hour so nothing
// hammers it, header `x-back-soon: 1` (the front, backend.ts BackendError.backSoon, reads it to say the sentence in the visitor's language), the page when the visitor asks for HTML,
// and the front's own error shape as JSON otherwise. The sentence is the four languages of modules/channels/words-back-soon.ts (a test compares the two files). Not ported: the
// TypeScript page also shows the Operator's name with Call and WhatsApp (shopErrorPage, contact-bar.ts); this page is the sentence alone. The front reads the header and the JSON,
// not the page.

import (
	"encoding/json"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// BackSoon is the sentence, by language, in the order the TypeScript LANGUAGES list has them.
var BackSoon = []struct{ Lang, Text string }{
	{"en", "This shop's page is taking a short rest and will be back soon. Please try again a little later."},
	{"hi", "इस दुकान का पेज थोड़ी देर आराम कर रहा है और जल्द ही वापस आएगा। कृपया कुछ देर बाद फिर कोशिश कीजिए।"},
	{"ml", "ഈ കടയുടെ പേജ് അൽപ്പനേരം വിശ്രമത്തിലാണ്, ഉടൻ തിരിച്ചെത്തും. കുറച്ചു കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കൂ."},
	{"kn", "ಈ ಅಂಗಡಿಯ ಪುಟ ಸ್ವಲ್ಪ ವಿಶ್ರಾಂತಿಯಲ್ಲಿದೆ, ಶೀಘ್ರದಲ್ಲೇ ಮರಳುತ್ತದೆ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಹೊತ್ತಿನ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."},
}

func isLang(l string) bool {
	for _, b := range BackSoon {
		if b.Lang == l {
			return true
		}
	}
	return false
}

// backSoonLanguage: ?lang=, else the browser's Accept-Language, else the shop's own first language, else English. A file that cannot be read never fails this page.
func backSoonLanguage(p Paths, r *http.Request) string {
	if l := r.URL.Query().Get("lang"); isLang(l) {
		return l
	}
	header := strings.ToLower(r.Header.Get("accept-language"))
	for _, b := range BackSoon {
		if regexp.MustCompile(`(^|[,\s])` + b.Lang + `(-|;|,|$)`).MatchString(header) {
			return b.Lang
		}
	}
	if raw, err := os.ReadFile(filepath.Join(p.ClientFolder, "settings.json")); err == nil {
		var s struct {
			Languages []string `json:"languages"`
		}
		if json.Unmarshal(raw, &s) == nil {
			for _, l := range s.Languages {
				if isLang(l) {
					return l
				}
			}
		}
	}
	return "en"
}

// writeBackSoon answers for a paused shop.
func writeBackSoon(w http.ResponseWriter, r *http.Request, p Paths) {
	lang := backSoonLanguage(p, r)
	text := BackSoon[0].Text
	for _, b := range BackSoon {
		if b.Lang == lang {
			text = b.Text
		}
	}
	h := w.Header()
	h.Set("cache-control", "no-store")
	h.Set("retry-after", "3600")
	h.Set("x-back-soon", "1")
	if strings.Contains(r.Header.Get("accept"), "text/html") {
		h.Set("content-type", "text/html; charset=utf-8")
		w.WriteHeader(503)
		_, _ = w.Write([]byte(`<!doctype html><html lang="` + lang + `"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>` +
			html.EscapeString(text) + `</title></head><body><main><p role="alert">` + html.EscapeString(text) + `</p></main></body></html>`))
		return
	}
	h.Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(503)
	b, _ := json.Marshal(map[string]any{"error": map[string]any{"code": "unavailable", "message": text}, "backSoon": true})
	_, _ = w.Write(b)
}
