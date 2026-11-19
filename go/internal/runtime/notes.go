package runtime

// The owner's side of the shop's memory in a step (modules/assistant/notes.ts): "remember …" (saved at once, said back, undoable for a day), "what do you remember?", "forget 3", the
// undo of a "remember", and the tick that closes notes past their end and lets closed notes lose their text. The notes are internal/memory, kept under `assistant.memory` in the
// step's state (made on first use, as memoryOf does), so a note is saved with the step, whole or not at all.
//
// Who may write: every write here uses memory.OwnerAuthority("app"): this code is reached only from the owner's own page (the runtime checked the owner's link or session before
// the event was saved). A listings-only shop has no WhatsApp, so the words are said on the page; a note the talk proposes (Remember / No buttons) is never made there (notes.ts
// `proposeNote` is off on the page), so the proposals are only carried, never made.
//
// The record keeps a note's id, kind and who, never its words: the line's inputs hold the text, and the record keeps only their keyed digest (record.go), as TypeScript does.
// The digest of a note's text is memory.ts's plain one: the listings agent hands the assistant no keyed digest (templates/commerce/listings/src/agent.ts).

import (
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/memory"
)

// mem is the step's memory, made on first use; save writes it back into the step's state.
func (c *conv) mem() *memory.State {
	if c.memory == nil {
		c.memory = memory.Parse(c.a.Rest["memory"])
	}
	return c.memory
}

func (c *conv) saveMem() {
	if c.memory != nil {
		c.a.Rest["memory"] = c.memory.JSON()
	}
}

// memoryLine is notes.ts `memoryLine`: the record line for a change; the text only in the inputs (which the record keeps as a digest).
func (c *conv) memoryLine(n *memory.Note, change string, withText bool) {
	inputs := map[string]any{"note": n.ID, "digest": n.Digest}
	if withText {
		inputs = map[string]any{"note": n.ID, "text": n.Text}
	}
	notes := "the owner undid a note they had just saved"
	switch change {
	case "added", "corrected":
		notes = "a note was saved to the shop's memory by the owner, the Operator or the builder; the record keeps its id, kind and who, never its words"
	case "forgotten":
		notes = "a note's words were removed from the shop's state; its id, dates and digest stay"
	case "ended":
		notes = "a note reached its end date and was closed"
	}
	c.logLine(memory.Action, "confirmed", inputs, memory.Refs(n, change), notes)
}

func (c *conv) saveFailure(why string) {
	switch why {
	case "full":
		c.say("note_full", "n", strconv.Itoa(memory.MaxOpenNotes))
	case "too_long":
		c.say("note_too_long", "n", strconv.Itoa(memory.MaxNoteChars))
	default:
		c.say("note_need_words")
	}
}

// remember is notes.ts `remember`: saved at once, undoable for a day.
func (c *conv) remember(words string) {
	if words == "" {
		c.say("note_need_words")
		return
	}
	n, why := c.mem().Add(memory.OwnerAuthority("app"), assistant.NoteFromWords(words), c.now, nil)
	c.saveMem() // memoryOf made it even when the note is refused
	if why != "" {
		c.saveFailure(why)
		return
	}
	c.a.Undo = append(c.a.Undo, assistant.Undo{ID: c.a.NextID("u"), Kind: "remember", Skill: "memory", Date: "", Asked: []string{}, Case: n.ID, HasCase: true, AtMs: c.now, UntilMs: c.now + memory.UndoNoteMs})
	c.memoryLine(n, "added", true)
	c.say("note_saved."+n.Audience+".undo", "id", n.ID, "text", n.Text)
}

// listNotes is notes.ts `list`: the notes in the owner's scope, in the order they were saved.
func (c *conv) listNotes() {
	notes := c.mem().InScope("owner", c.now)
	if c.a.Rest["memory"] == nil {
		c.saveMem() // memoryOf made it: TypeScript saves the empty memory with the step
	}
	if len(notes) == 0 {
		c.say("notes_list.zero")
		return
	}
	text := c.pack.Say("notes_list.head", "n", strconv.Itoa(len(notes)))
	for _, n := range notes {
		text += "\n" + c.pack.Say("notes_list.line."+n.Audience, "id", n.ID, "text", n.Text)
	}
	text += "\n" + c.pack.Say("notes_list.foot")
	c.a.AddTalk("assistant", text, c.now)
}

// forgetNote is notes.ts `forget`.
func (c *conv) forgetNote(id string) {
	n, why := c.mem().Forget(memory.OwnerAuthority("app"), id, c.now, nil)
	c.saveMem()
	if why != "" {
		c.say("note_unknown", "id", id)
		return
	}
	c.memoryLine(n, "forgotten", false)
	c.say("note_forgotten", "id", id)
}

// undoRemember is notes.ts `undoRemember`: the note is forgotten again (the caller checked the undo is still in time).
func (c *conv) undoRemember(id string) {
	if n, why := c.mem().Forget(memory.OwnerAuthority("app"), id, c.now, nil); why == "" {
		c.memoryLine(n, "undone", false)
	}
	c.saveMem()
	c.say("note_undone", "id", id)
}

// notesTick is notes.ts `tick`: only a shop that has a memory (nothing is made on the beat).
func (c *conv) notesTick() {
	if c.a.Rest["memory"] == nil {
		return
	}
	m := c.mem()
	for _, n := range m.EndExpired(c.now) {
		c.memoryLine(n, "ended", false)
	}
	m.Tidy(c.now)
	c.saveMem()
}
