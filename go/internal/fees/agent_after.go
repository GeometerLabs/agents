package fees

// What rides on the clock's beat AFTER the agent's own work and saves for itself (modules/runtime/core.ts step): the owner's licence notice (server/licence.ts over
// modules/licence/notice.ts, the shared runtime.RunLicenceNotice), which claims in the record and saves BEFORE it sends, so a restart never sends it twice; then the owner's
// morning line (agent_assistant.go), which claims and saves the same way. The monthly report is not ported for Fees yet (Deferred.md).

import (
	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

var _ runtime.AfterTicker = (*Agent)(nil)

// AfterTick is core.ts's licence notice on a beat. A failure is said in the log and never holds up the beat.
func (a *Agent) AfterTick(save func() error) {
	var paid *int64
	if a.c.PaidThrough != nil {
		paid = a.c.PaidThrough()
	}
	owner := bookings.OwnerMessaging(a.kit.Ports.WhatsApp, bookings.OwnerRoute{Owner: a.owner, Now: a.now, PushOwner: a.kit.Ports.PushOwner, ChooseRoute: a.kit.Ports.OwnerRoute})
	if _, _, err := runtime.RunLicenceNotice(runtime.NoticeContext{
		Licence: a.c.Licence(), PaidThrough: paid, Owner: a.owner(), Language: a.settings.Owner.Language, Now: a.now(), Messaging: owner, Rec: a.c.Rec, Save: save, Log: a.c.Log,
		Message: a.licenceMessage,
	}); err != nil {
		a.c.Log("The owner's licence notice could not be sent: " + err.Error())
	}
	a.morning(owner, save) // item 11e: the owner's morning line (agent_assistant.go), last on the beat
}

// licenceMessage is server/licence.ts createFeesLicenceNotice's message: the wind-down's or the final stop's words in the owner's language, with who to contact and (the final
// stop) how many fees are still open, and the template that carries them.
func (a *Agent) licenceMessage(kind string) (string, messaging.TemplateMessage, error) {
	lang := a.settings.Owner.Language
	id := "owner_licence_paused"
	if kind == "stop" {
		id = "owner_licence_stopped"
	}
	var open int64
	for _, d := range a.store.Dues {
		if d.State == Open {
			open++
		}
	}
	partner := ""
	if a.c.Partner != nil {
		partner = a.c.Partner()
	}
	if partner == "" {
		partner = bookings.WhoSetItUp[lang] // licence.ts WHO_SET_IT_UP: the same words for every template
	}
	f := &MessageFacts{Language: lang, Loc: a.settings.Loc, BusinessName: a.settings.Name, Partner: S(partner), OpenFeesCount: N(open), WaiverLimit: N(a.settings.WaiverLimitInr), GraceDays: N(a.settings.Due.GraceDays)}
	if a.settings.OwnerMarked() {
		f.UpiID, f.Payee = S(a.settings.Payment.UpiID), S(a.settings.Payment.Payee) // due.ts factsFor with no fee: the centre's own facts
	}
	text, err := Render(id, f)
	if err != nil {
		return "", messaging.TemplateMessage{}, err
	}
	return text, templateMessage([]string{id}, f, text, WordsFor("en").Generic.Owner), nil
}
