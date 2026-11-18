package shared

// The "back soon" answer for a PAUSED shop (templates/commerce/listings/server/back-soon.ts and modules/runtime/shared.ts `backSoon`): 503, Retry-After an hour so nothing
// hammers it, header `x-back-soon: 1` (the front, backend.ts BackendError.backSoon, reads it to say the sentence in the visitor's language), the page when the visitor asks for HTML,
// and the front's own error shape as JSON otherwise. The sentence is the four languages of modules/channels/words-back-soon.ts (a test compares the two files). The page has the
// same parts as the front's shopErrorPage (contact-bar.ts): the machine-written note for hi, ml and kn, the sentence, and the Operator's name with Call and WhatsApp from pages.json.
// NOT ported: the front's own stylesheet (SIGNIN_CSS, look.ts); a small stand-in is inlined. The front reads the header and the JSON, not the page.

import (
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// words of the page's other lines, by language (modules/channels/words-owner-first.ts and words.ts): the Operator's line (%s is the name), Call, WhatsApp, and the note that hi, ml and kn
// are machine-written. en has no note.
var pageWords = map[string]struct{ Operator, Call, WhatsApp, Machine string }{
	"en": {"Your Operator: %s", "Call", "WhatsApp", ""},
	"hi": {"आपके ऑपरेटर: %s", "कॉल करें", "WhatsApp", "यह हिंदी मशीन से लिखी गई है; किसी हिंदी भाषी ने अभी इसे जाँचा नहीं है।"},
	"ml": {"നിങ്ങളുടെ ഓപ്പറേറ്റർ: %s", "വിളിക്കൂ", "WhatsApp", "ഈ മലയാളം യന്ത്രം എഴുതിയതാണ്; മലയാളം അറിയുന്ന ഒരാൾ ഇതുവരെ പരിശോധിച്ചിട്ടില്ല."},
	"kn": {"ನಿಮ್ಮ ಆಪರೇಟರ್ ಅವರು: %s", "ಕರೆ ಮಾಡಿ", "WhatsApp", "ಈ ಕನ್ನಡವನ್ನು ಯಂತ್ರ ಬರೆದಿದೆ; ಕನ್ನಡ ಬಲ್ಲವರು ಇನ್ನೂ ಪರಿಶೀಲಿಸಿಲ್ಲ."},
}

// pageCSS is a small stand-in for the front's SIGNIN_CSS (look.ts), which is NOT ported: the page reads the same, in the same order, but is not the front's look.
const pageCSS = `body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#fffaf0;color:#222}main{max-width:36rem;margin:0 auto;padding:28px 16px 40px}.machine{background:#fff3cd;padding:8px 12px;border-radius:10px;font-size:.88rem}.notice{background:#e8f1ff;padding:10px 14px;border-radius:12px;font-weight:600}.who{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:10px 12px;border:1px solid #ddd;border-radius:14px}.who b{flex:1 1 100%}.btn{flex:1 1 auto;min-height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:24px;border:1.5px solid #bbb;color:#222;text-decoration:none}.btn.wa{background:#1a7f4b;border-color:#1a7f4b;color:#fff}`

// partnerOf reads the Operator's name and phone from the shop's pages.json (`partner`), as pagesReader does; nothing when there is none.
func partnerOf(p Paths) (name, phone string, ok bool) {
	raw, err := os.ReadFile(filepath.Join(p.ClientFolder, "pages.json"))
	if err != nil {
		return "", "", false
	}
	var f struct {
		Partner struct{ Name, Phone string } `json:"partner"`
	}
	if json.Unmarshal(raw, &f) != nil || f.Partner.Name == "" || f.Partner.Phone == "" {
		return "", "", false
	}
	return f.Partner.Name, f.Partner.Phone, true
}

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
		words := pageWords[lang]
		var b strings.Builder
		b.WriteString(`<!doctype html><html lang="` + lang + `"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>` +
			html.EscapeString(text) + `</title><style>` + pageCSS + `</style></head><body><main>`)
		if words.Machine != "" {
			b.WriteString(`<p class="machine">` + html.EscapeString(words.Machine) + `</p>`)
		}
		b.WriteString(`<p class="notice" role="alert">` + html.EscapeString(text) + `</p>`)
		if name, phone, ok := partnerOf(p); ok {
			digits := strings.Map(func(r rune) rune {
				if r >= '0' && r <= '9' {
					return r
				}
				return -1
			}, phone)
			b.WriteString(`<div class="who" role="group"><b>` + html.EscapeString(fmt.Sprintf(words.Operator, name)) + `</b><a class="btn" href="tel:+` + digits + `">` + html.EscapeString(words.Call) +
				`</a><a class="btn wa" href="https://wa.me/` + digits + `" rel="noopener">` + html.EscapeString(words.WhatsApp) + `</a></div>`)
		}
		b.WriteString(`</main></body></html>`)
		_, _ = w.Write([]byte(b.String()))
		return
	}
	h.Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(503)
	b, _ := json.Marshal(map[string]any{"error": map[string]any{"code": "unavailable", "message": text}, "backSoon": true})
	_, _ = w.Write(b)
}
