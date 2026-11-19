package assistant

// A customer's talk (modules/assistant/talk-customer.ts, talk-prompt.ts customerPrompt; block M): where the rules and the router know no answer, the assistant may answer in the customer's
// language, in the character's personality, from what the SHOP has said it may tell customers. Everything is chosen by code, before the prompt is built (the notes for everyone, the shop's public
// settings and free times, this customer's own open case; the customer's words with numbers, links and names taken out), and what comes back is untrusted: it is read from `any`, checked by
// CheckTalk's customer role (claims, completion words, numbers, links, length, language) and only then sent.
//
// This file is the pure part: the prompt, the schema and the checks' inputs. Whether a model may be asked at all, the metering and the record line are the runtime's (runtime/talkcustomer.go),
// because they are the shop's state. Nothing here writes memory or makes an authority: a customer's message has no path to a note.
//
// The prompt is the TypeScript's own, rendered for every personality, character name and language by go/scripts/gen_customer_talk.ts (the owner's prompt is in the word packs; a customer's
// differs by the customer's language, so it has its own small file and the packs are not touched). Placed here, not in internal/understanding, because the sources and the checks it uses are
// this package's, and internal/understanding is below it.

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed customerwords/words.json
var customerWordsJSON []byte

var customerWords = func() (w struct {
	Chars  int               `json:"chars"`
	Schema map[string]any    `json:"schema"`
	System map[string]string `json:"system"`
}) {
	if err := json.Unmarshal(customerWordsJSON, &w); err != nil {
		panic("assistant: customerwords/words.json: " + err.Error())
	}
	return
}()

// CustomerChars is talk-prompt.ts CUSTOMER_CHARS: a customer's reply is at most this many characters.
func CustomerChars() int { return customerWords.Chars }

// CustomerNotesBudget is talk-customer.ts CUSTOMER_NOTES_BUDGET: the room the notes for everyone get in a customer's prompt.
const CustomerNotesBudget = 1500

// CustomerSchema is the answer schema a customer's talk holds the model to: sentences with their sources, and `ask_owner`; no note and no limit.
func CustomerSchema() map[string]any { return customerWords.Schema }

// CustomerPrompt is talk-prompt.ts customerPrompt's system text: for the shop's name, the character's name ("" for none), the personality (warm, cheerful or brief), the customer's language
// and the sources the customer may be answered from (never an owner-only note or another customer's case: the caller built them from the customer's scope).
func CustomerPrompt(shop, charName, personality, lang string, sources []TalkSource) string {
	named := "plain"
	if charName != "" {
		named = "named"
	}
	t, ok := customerWords.System[lang+"."+personality+"."+named]
	if !ok {
		t = customerWords.System["en.warm."+named]
	}
	// one pass: a shop's name that holds "{sources}" is not read as a slot
	return strings.NewReplacer("{shop}", shop, "{name}", charName, "{sources}", SourceLines(sources)).Replace(t)
}
