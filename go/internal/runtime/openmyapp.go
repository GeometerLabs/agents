package runtime

// The owner's "open my app" on WhatsApp for a template's shop (modules/channels/owner-signin.ts `takes` for a message, `isOpenMyApp`): one of the fixed phrases (OPEN_MY_APP,
// generated into the assistant's rule words), from the owner's own number, not a button's reply, on a shop that has an owner view to open. The runtime takes such a message before
// the agent and the assistant see it (core.ts hands it to the sign-in first), and the link goes back in the window the owner's own message just opened (sendLink "whatsapp").

import (
	"regexp"
	"slices"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

var (
	phraseEnd    = regexp.MustCompile(`[.!?।,]+[` + language.JSSpace + `]*$`)
	phraseSpaces = regexp.MustCompile(`[` + language.JSSpace + `]+`)
	nonDigits    = regexp.MustCompile(`\D`)
)

// phraseOf is owner-signin.ts phraseOf: NFC, lower case (JavaScript's toLowerCase, language.LowerJS), without the full stop, question or exclamation mark, the danda or a comma at
// the end, one space between words (JavaScript's `\s`), trimmed.
func phraseOf(text string) string {
	t := language.LowerJS(language.NFC(text))
	t = phraseEnd.ReplaceAllString(t, "")
	return language.TrimJS(phraseSpaces.ReplaceAllString(t, " "))
}

// isOpenMyApp is owner-signin.ts isOpenMyApp over a saved "message" event.
func (r *Runtime) isOpenMyApp(ev map[string]any) bool {
	m, ok := ev["message"].(map[string]any)
	if !ok || r.o.Access == nil {
		return false
	}
	from, _ := m["from"].(string)
	text, _ := m["text"].(string)
	if _, reply := m["reply"]; reply || text == "" {
		return false
	}
	number, _ := r.owner()
	if nonDigits.ReplaceAllString(from, "") != nonDigits.ReplaceAllString(number, "") {
		return false
	}
	if !slices.Contains(assistant.Rules().OpenMyApp, phraseOf(text)) {
		return false
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	_, has, _ := r.oWho()
	return has
}

// signinWhatsApp is the kit's WhatsApp for a sign-in link (nil: the shop has none).
func (r *Runtime) signinWhatsApp() messaging.Messaging {
	if sk, ok := r.o.Kit.(SigninKit); ok {
		return sk.SigninMessaging()
	}
	return nil
}
