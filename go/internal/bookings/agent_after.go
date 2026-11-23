package bookings

// What rides on the clock's beat AFTER the agent's own work and saves for itself (modules/runtime/core.ts step, for Bookings): the owner's licence notice (server/licence.ts over
// modules/licence/notice.ts, the shared runtime.RunLicenceNotice) and the monthly report (report/monthly-job.ts, MonthlyReport in books.go). Each claims in the record and saves
// BEFORE it sends, and writes its ending and saves after, so a restart between the two finds the claim and never sends twice. They run from runtime.AfterTicker, never from
// Agent.Tick, whose step is saved whole or not at all. The `report` block of runtime.json is read by the shared internal/reportwire.

import (
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// WhoSetItUp is licence.ts WHO_SET_IT_UP: who to contact when the lease names no Operator (only for a runtime started by hand).
var WhoSetItUp = map[string]string{"en": "the person who set it up", "hi": "इसे सेट करने वाले व्यक्ति", "ml": "ഇത് ക്രമീകരിച്ച വ്യക്തിയെ", "kn": "ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರನ್ನು"}

var _ runtime.AfterTicker = (*Agent)(nil)

// AfterTick is core.ts's licence notice, monthly report and morning line on a beat, in that order. A failure is said in the log and never holds up the beat.
func (a *Agent) AfterTick(save func() error) {
	saveLogged := func() {
		if err := save(); err != nil {
			a.c.Log("The shop's state could not be saved in the middle of the beat: " + err.Error())
		}
	}
	paid := (*int64)(nil)
	if a.c.PaidThrough != nil {
		paid = a.c.PaidThrough()
	}
	lang := a.settings.Owner.Language
	if _, _, err := runtime.RunLicenceNotice(runtime.NoticeContext{
		Licence: a.c.Licence(), PaidThrough: paid, Owner: a.owner(), Language: lang, Now: a.now(), Messaging: a.ownerMessaging(a.kit.Ports.WhatsApp), Rec: a.c.Rec, Save: save, Log: a.c.Log,
		Message: func(kind string) (string, messaging.TemplateMessage, error) { return a.licenceMessage(kind) },
	}); err != nil {
		a.c.Log("The owner's licence notice could not be sent: " + err.Error())
	}
	// in the licence's final stop the shop sends nothing more, so no report and no morning line go
	if a.c.Licence() == "stopped" {
		return
	}
	if a.kit.Report != nil {
		if _, err := a.kit.Report.Run(ReportTick{Settings: a.settings, Store: a.store, Rec: a.c.Rec, Now: a.now, Licence: a.c.Licence(), Save: saveLogged, Log: a.c.Log}); err != nil {
			a.kit.Report.Failed.Failed(err, a.now(), a.c.Log)
		}
	}
	// item 11e: the owner's morning line (morning.ts), after the report, with the same save so its claim is on disk before it goes; the skill reads the store, read-only
	if err := a.c.Morning(runtime.MorningContext{Skill: &bookingsSkill{a}, Messaging: a.ownerMessaging(a.kit.Ports.WhatsApp), Save: save}); err != nil {
		a.c.Log("The owner's morning line could not be made: " + err.Error())
	}
}

// licenceMessage is licence.ts createBookingsLicenceNotice's `message`: the wind-down's or the final stop's words in the owner's language, naming the Operator, with how many
// bookings after now are still confirmed; and the approved template that carries the same words outside the owner's window.
func (a *Agent) licenceMessage(kind string) (string, messaging.TemplateMessage, error) {
	lang := a.settings.Owner.Language
	id := "owner_licence_paused"
	if kind == "stop" {
		id = "owner_licence_stopped"
	}
	var upcoming int64
	for _, b := range a.store.Bookings {
		if b.State == Confirmed && b.StartMs != nil && *b.StartMs > a.now() {
			upcoming++
		}
	}
	partner := ""
	if a.c.Partner != nil {
		partner = a.c.Partner()
	}
	if partner == "" {
		partner = WhoSetItUp[lang]
	}
	f := a.factsFor(&messaging.SayArgs{Extra: &sayExtra{}}, lang)
	f.Partner, f.UpcomingCount = S(partner), N(upcoming)
	text, err := renderAny(id, f)
	if err != nil {
		return "", messaging.TemplateMessage{}, err
	}
	m := MetaTemplateMessage([]string{id}, f, text, WordsFor("en").Generic.Owner)
	return text, messaging.TemplateMessage{Name: m.Name, Language: m.Language, Text: m.Text, Parameters: m.Parameters}, nil
}
