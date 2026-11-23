package runtime

// The parts of the owner's assistant a Fees centre adds (23 Nov 2026): a skill with fees owed (skill.ts `owes`: "who owes fees" lists them, and the morning line counts them and
// sums what they owe, morning.go), and the owner's message to a chat guest prepared once for any skill (wire.ts prepareGuestMessage). Each is used only by a skill that has it: a
// Bookings, Orders or listings-only shop is answered exactly as before.
//
// What the assistant says here is written from the packed words (go/scripts/gen_words.ts feesWords) through one Writer, as openList is: the count in {n}, the amount in {inr},
// the student, the month and the fee as the key's own literal slots, so the outgoing check finds every value noted.

import (
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/assistant"
)

// OweRow is skill.ts OweRow: someone who owes, in the owner's language (who, for what, how much, and when it was due).
type OweRow struct {
	Case        string
	Who, What   string
	AmountPaise int64
	DueMs       int64
}

// OweSkill is a skill with fees owed (skill.ts `owes`: a Fees centre's fees past their due date that still owe something, the oldest due first).
type OweSkill interface {
	Owes() []OweRow
}

// owes is conversation.ts `case "owes": tell("owes_list", {rows: skills.flatMap((s) => s.owes?.() ?? [])})`.
func (c *conv) owes() {
	var rows []OweRow
	for _, s := range c.skills {
		if os, ok := s.(OweSkill); ok {
			rows = append(rows, os.Owes()...)
		}
	}
	w := c.pack.Writer()
	c.tellText("owes_list", c.owesList(w, rows), w.Facts(), "", nil)
}

// owesList is words.ts owes_list: none, or the head and the rows (at most 12, then "and N more").
func (c *conv) owesList(w *assistant.Writer, rows []OweRow) string {
	if len(rows) == 0 {
		return w.Say("owes_list.none")
	}
	text := w.Say("owes_list.head", "n", strconv.Itoa(len(rows)))
	for i, r := range rows {
		if i >= listRows {
			break
		}
		text += "\n" + w.Say("owes_list.row", "who", r.Who, "what", r.What, "inr", assistant.INR(r.AmountPaise), "case", r.Case)
	}
	if len(rows) > listRows {
		text += "\n" + w.Say("owes_list.more", "n", strconv.Itoa(len(rows)-listRows))
	}
	return text
}

// PrepareGuestMessage is wire.ts prepareGuestMessage for any skill: "tell chat guest 3 we open at ten" is the proposal `message g-3`. A guest has no case of the skill's, so the
// label the owner is shown names the guest, and the words go into the guest's thread through the same message card and the same checks (STOP; an amount, which a guest's record
// never has: wire.ts checkWords with no amounts). Anything else asked of a guest is "not here". ok false: ref is not a guest's, and the skill's own prepare carries on.
// (internal/bookings and internal/orders keep their own copies of this, written before it: Deferred.md, to fold onto this one.)
func PrepareGuestMessage(cs *ChannelState, skill, kind, ref, words, lang string, optedOut func(conversation string) bool) (prep Prepared, why string, ok bool) {
	m := GuestRef.FindStringSubmatch(ref)
	if m == nil {
		return Prepared{}, "", false
	}
	if kind != "message" {
		return Prepared{}, "not_here", true
	}
	n, _ := strconv.ParseInt(m[1], 10, 64)
	conversation := ConversationOfGuest(cs, n)
	if conversation == "" {
		return Prepared{}, "no_case", true
	}
	if optedOut(conversation) {
		return Prepared{}, "opted_out", true
	}
	if assistant.AmountOf(words) > 0 { // amountOf: undefined (0 here) when there is none
		return Prepared{}, "amount_not_on_record", true
	}
	who := GuestLabel(cs, conversation, lang)
	act := assistant.Action{Kind: "message", Skill: skill, Case: ref, Fields: assistant.Raw{"who": jstring(who), "phone": jstring(conversation), "words": jstring(words)}}
	return Prepared{Action: act, Shown: Shown{Who: who, Words: words, HasWords: true}}, "", true
}
