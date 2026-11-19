package bookings

// The WhatsApp templates in the form Meta approves them: the Go twin of templates/commerce/bookings/src/language/meta-templates.ts and the mechanism it shares with Fees
// (modules/language/meta-templates.ts: metaBody, fillBody, createMetaCatalogue's parametersFor, templateMessage and submissions). The bodies, their names and which message each
// carries the words of are GENERATED (words/<lang>.json.gz, go/scripts/gen_bookings_words.ts); so is how each `{slot}` of a body is filled (a slot of the message: `{deposit}` is
// the message's `{depositInr}`), found by asking the TypeScript `parametersFor`. Here only the filling is done.

import (
	"fmt"
	"regexp"
	"strconv"
)

// languageOrder is languages.ts LANGUAGES: the order a list of submissions walks the languages in (Hindi first).
var languageOrder = []string{"hi", "en", "ml", "kn"}

// MetaTemplates are the WhatsApp templates in one language, in the TypeScript's order.
func MetaTemplates(lang string) []MetaWord { return WordsFor(lang).Meta }

// MetaBody is meta-templates.ts metaBody: {slot} turned into {{1}}, {{2}} ... in order.
func MetaBody(body string) string {
	n := 0
	return slotRe.ReplaceAllStringFunc(body, func(string) string { n++; return "{{" + strconv.Itoa(n) + "}}" })
}

var numbered = regexp.MustCompile(`\{\{(\d+)\}\}`)

// FillBody is meta-templates.ts fillBody: a Meta body ({{1}} ...) filled with parameters, what the customer will read; a number with no parameter is left empty.
func FillBody(metaText string, parameters []string) string {
	return numbered.ReplaceAllStringFunc(metaText, func(m string) string {
		n, _ := strconv.Atoi(numbered.FindStringSubmatch(m)[1])
		if n >= 1 && n <= len(parameters) {
			return parameters[n-1]
		}
		return ""
	})
}

// MetaParameters is meta-templates.ts parametersFor: the values of a template's slots in a language, read from the record's facts; a *MissingFact if the record lacks one.
func MetaParameters(t MetaWord, f *MessageFacts) ([]string, error) {
	w := WordsFor(f.Language)
	var out []string
	for _, m := range slotRe.FindAllStringSubmatch(t.Body, -1) {
		slot, ok := w.MetaSlots[m[1]]
		if !ok {
			return nil, fmt.Errorf("The template body has an unknown value {%s}.", m[1])
		}
		v, err := f.value(slot)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// TemplateMessage is what goes out as a template: its name, language, the text and the parameters.
type TemplateMessage struct {
	Name       string   `json:"name"`
	Language   string   `json:"language"`
	Text       string   `json:"text"`
	Parameters []string `json:"parameters,omitempty"`
}

// MetaTemplateMessage is meta-templates.ts templateMessage: the template message for text that must go out as a template. A message that is exactly one of the templates goes as
// that template with its parameters, but only if filling it gives back the very text the outgoing check read. Anything else goes as the generic name with no parameters (a provider
// that knows only the real templates then refuses it).
func MetaTemplateMessage(ids []string, f *MessageFacts, text, generic string) TemplateMessage {
	if len(ids) == 1 {
		for _, t := range MetaTemplates(f.Language) {
			if t.UsedFor != ids[0] {
				continue
			}
			if params, err := MetaParameters(t, f); err == nil && FillBody(MetaBody(t.Body), params) == text {
				return TemplateMessage{t.Name, f.Language, text, params}
			}
			break // the first template for the message is the one (a Map keeps the last; none of ours is named twice)
		}
	}
	return TemplateMessage{Name: generic, Language: f.Language, Text: text}
}

// MetaSubmission is meta-templates.ts MetaSubmission: one entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates).
type MetaSubmission struct {
	Name            string          `json:"name"`
	Language        string          `json:"language"`
	Category        string          `json:"category"`
	ParameterFormat string          `json:"parameter_format"`
	Components      []MetaComponent `json:"components"`
}

// MetaComponent is the body of a submission: its text with {{n}} and an example for each parameter.
type MetaComponent struct {
	Type    string `json:"type"`
	Text    string `json:"text"`
	Example struct {
		BodyText [][]string `json:"body_text"`
	} `json:"example"`
}

// MetaSubmissions is meta-templates.ts metaSubmissions: every template in every language, with example values from the shop's own settings. A template whose example record lacks a
// value is an error (the TypeScript throws).
func MetaSubmissions(s *Settings) ([]MetaSubmission, error) {
	// the TypeScript walks the templates (their order is the same in every language) and, for each, the languages
	first := MetaTemplates("en")
	var out []MetaSubmission
	for i := range first {
		for _, lang := range languageOrder {
			t := MetaTemplates(lang)[i]
			params, err := MetaParameters(t, ExampleFacts(s, lang))
			if err != nil {
				return nil, err
			}
			c := MetaComponent{Type: "BODY", Text: MetaBody(t.Body)}
			c.Example.BodyText = [][]string{params}
			out = append(out, MetaSubmission{t.Name, lang, "UTILITY", "positional", []MetaComponent{c}})
		}
	}
	return out, nil
}
