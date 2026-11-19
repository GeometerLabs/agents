package assistant

// The owner's words about a note (modules/assistant/notes.ts `noteFromWords`): what kind of note "remember …" makes, by rule. "for customers: …" makes a note customers' answers may
// use (kind public, for everyone); a goal if the words start with one; an instruction if they start with "always", "never", "please" (or the Hindi words); otherwise a fact for the
// owner's talks only. The three patterns are the TypeScript's own (language, patterns.json). What the runtime then does with the note (save, list, forget, undo) is in
// internal/runtime/notes.go; the notes themselves are internal/memory.

import (
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/memory"
)

// NoteFromWords is noteFromWords. The note's language is its script's (Latin letters are English, which is also how Hindi typed in Latin letters is filed).
func NoteFromWords(words string) memory.Input {
	text := language.TrimJS(words)
	kind, audience := "fact", ""
	if m := language.P("notes.for_customers").Find(words); m != nil {
		text = language.TrimJS(words[m.End():])
		kind, audience = "public", "everyone"
	} else if language.P("notes.goal").Test(text) {
		kind = "goal"
	} else if language.P("notes.instruction").Test(text) {
		kind = "instruction"
	}
	return memory.Input{Kind: kind, Text: text, Lang: language.LanguageOfScript(text), Audience: audience}
}
