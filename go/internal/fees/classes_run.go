package fees

// Classes at work: the Go twin of templates/education/fees/src/classes/run.ts (with rules.ts, view.ts, parse.ts and state.ts). What the clock, a contact's message, the teacher's
// message and the teacher's press do. Nothing here moves money and nothing sends except through the agent's own say, so the opt-out, the outgoing check, the record and the
// licence apply to a class message exactly as to a fee reminder.
//
// The rules (owner decision 50): the class link goes ONLY to a student in the batch whose contact agreed (an adult needs no consent) and whose fee is paid or within the grace days,
// judged at the moment of sending after the payment record is read again (checkClassAccess, recorded beside the message); the link is read when sending, a session keeps only the
// hash of each link it sent; attendance is the teacher's, and a missed-class note goes only to the parent of a student the teacher marked absent; a doubt is handed to the teacher.
//
// Where Go differs: the state's maps are written in key order (JavaScript keeps insertion order); nothing reads that order. The button label "Everyone came" is run.ts LABEL (not
// exported, written here as it is there). `localeCompare` of batch ids on a tie is a plain string compare (the ids are lower-case ASCII).

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/understanding"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// Consent is state.ts Consent.
type Consent struct {
	AskedAtMs    int64  `json:"askedAtMs"`
	Answer       string `json:"answer,omitempty"`
	AnsweredAtMs *int64 `json:"answeredAtMs,omitempty"`
}

// Withheld is why a class link was withheld, and when it was last looked at.
type Withheld struct {
	Reason string `json:"reason"`
	AtMs   int64  `json:"atMs"`
}

// ClassSession is state.ts ClassSession.
type ClassSession struct {
	ID         string              `json:"id"`
	BatchID    string              `json:"batchId"`
	StartMs    int64               `json:"startMs"`
	EndMs      int64               `json:"endMs"`
	Sent       map[string][]string `json:"sent"`
	Withheld   map[string]Withheld `json:"withheld"`
	Marks      map[string]string   `json:"marks"`
	AskedAtMs  *int64              `json:"askedAtMs,omitempty"`
	ClosedAtMs *int64              `json:"closedAtMs,omitempty"`
	Noted      []string            `json:"noted"`
	NoLinkTold bool                `json:"noLinkTold,omitempty"`
}

// Doubt is state.ts Doubt.
type Doubt struct {
	ID      string `json:"id"`
	Parent  string `json:"parent"`
	Student string `json:"student"`
	BatchID string `json:"batchId"`
	Text    string `json:"text"`
	AtMs    int64  `json:"atMs"`
	State   string `json:"state"`
}

// AwaitDoubt is a contact asked to write a doubt.
type AwaitDoubt struct {
	Student string `json:"student"`
	AtMs    int64  `json:"atMs"`
}

// ClassesState is state.ts ClassesState.
type ClassesState struct {
	BatchLinks     map[string]string        `json:"batchLinks"`
	SessionLinks   map[string]string        `json:"sessionLinks"`
	Sessions       map[string]*ClassSession `json:"sessions"`
	Consent        map[string]*Consent      `json:"consent"`
	Doubts         []*Doubt                 `json:"doubts"`
	NextDoubt      int64                    `json:"nextDoubt"`
	AwaitingDoubt  map[string]AwaitDoubt    `json:"awaitingDoubt"`
	DoubtsToldAtMs map[string]int64         `json:"doubtsToldAtMs"`
}

func emptyClasses() *ClassesState {
	return &ClassesState{BatchLinks: map[string]string{}, SessionLinks: map[string]string{}, Sessions: map[string]*ClassSession{}, Consent: map[string]*Consent{}, Doubts: []*Doubt{},
		NextDoubt: 1, AwaitingDoubt: map[string]AwaitDoubt{}, DoubtsToldAtMs: map[string]int64{}}
}

// classesState is `store.classes ??= emptyClasses()`, typed on first use.
func (s *Store) classesState() *ClassesState {
	if s.classes == nil {
		c := emptyClasses()
		if s.Classes != nil {
			_ = json.Unmarshal(s.Classes, c)
		}
		if c.Sessions == nil {
			c.Sessions = map[string]*ClassSession{}
		}
		for _, m := range []*map[string]string{&c.BatchLinks, &c.SessionLinks} {
			if *m == nil {
				*m = map[string]string{}
			}
		}
		if c.Consent == nil {
			c.Consent = map[string]*Consent{}
		}
		if c.AwaitingDoubt == nil {
			c.AwaitingDoubt = map[string]AwaitDoubt{}
		}
		if c.DoubtsToldAtMs == nil {
			c.DoubtsToldAtMs = map[string]int64{}
		}
		if c.Doubts == nil {
			c.Doubts = []*Doubt{}
		}
		s.classes = c
	}
	return s.classes
}

// classesRead is the saved Classes state for a read, never made when it is not there.
func (s *Store) classesRead() *ClassesState {
	if s.classes == nil && s.Classes == nil {
		return nil
	}
	return s.classesState()
}

func studentKey(parent, name string) string { return parent + "|" + name }

func linkHashOf(url string) string { return sha(url)[:16] }

// KeepSessionsMs is state.ts KEEP_SESSIONS_MS; MarkWindowMs is view.ts MARK_WINDOW_MS.
const (
	KeepSessionsMs = 60 * 24 * 3_600_000
	MarkWindowMs   = 7 * 24 * 3_600_000
	recheckMs      = 5 * 60_000
	doubtWaitMs    = 24 * 3_600_000
	maxDoubtChars  = 1000
	maxDoubtsShown = 12
)

var everyone = map[string]string{"en": "Everyone came", "hi": "सब आए", "ml": "എല്ലാവരും വന്നു", "kn": "ಎಲ್ಲರೂ ಬಂದರು"}

// ---- the timetable (rules.ts) ----

type occurrence struct {
	ID, BatchID    string
	StartMs, EndMs int64
}

func occurrenceID(batchID string, startMs int64, tz string) string {
	p := zone.LocalParts(startMs, tz)
	return fmt.Sprintf("%s@%04d%02d%02d%02d%02d", batchID, p.Year, p.Month, p.Day, p.Hour, p.Minute)
}

// occurrencesBetween is rules.ts occurrencesBetween: every class that STARTS in [from, to), soonest first.
func occurrencesBetween(c *Classes, only, tz string, from, to int64) []occurrence {
	var out []occurrence
	first, last := zone.LocalParts(from, tz), zone.LocalParts(to, tz)
	day, end := first.Date, last.Date
	for guard := 0; guard < 400; guard++ {
		wd := zone.WeekdayOf(day)
		for _, batchID := range c.Batches {
			if only != "" && batchID != only {
				continue
			}
			for _, slot := range c.Timetable[batchID] {
				if slot.Day != wd {
					continue
				}
				start := zone.ZonedToMs(day, slot.Hour, slot.Minute, tz)
				if start >= from && start < to {
					out = append(out, occurrence{ID: occurrenceID(batchID, start, tz), BatchID: batchID, StartMs: start, EndMs: start + int64(slot.Minutes)*60_000})
				}
			}
		}
		if day == end {
			break
		}
		day = zone.AddDays(day, 1)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].StartMs != out[j].StartMs {
			return out[i].StartMs < out[j].StartMs
		}
		return out[i].BatchID < out[j].BatchID
	})
	return out
}

// nextClass is rules.ts nextClass: the next class of a batch that has not ended yet, up to 14 days ahead.
func nextClass(c *Classes, tz, batchID string, now int64) *occurrence {
	if _, ok := c.Timetable[batchID]; !ok {
		return nil
	}
	for _, o := range occurrencesBetween(c, batchID, tz, now-4*3_600_000, now+14*24*3_600_000) {
		if o.EndMs > now {
			o := o
			return &o
		}
	}
	return nil
}

type feeSnap struct {
	state   string
	due     LocalDate
	balance int64
	backDue bool
}

func isPastGrace(f feeSnap, grace int64, now int64, tz string) bool {
	if f.state != Open || f.balance <= 0 {
		return false
	}
	return now >= zone.ZonedToMs(zone.AddDays(zdate(f.due), int(grace)+1), 0, 0, tz)
}

// checkClassAccess is rules.ts checkClassAccess.
func checkClassAccess(inBatch bool, consent string, readOK bool, fees []feeSnap, grace int64, stopOld bool, now int64, tz string) Decision {
	const rule = "class-access"
	switch {
	case !inBatch:
		return block(rule, "The student is not in this batch (any more), so nothing of its classes goes to them.")
	case consent == "no":
		return block(rule, "The contact said no to class links and material.")
	case consent == "waiting":
		return block(rule, "The contact has not yet agreed to receive class links and material (the consent question is asked first).")
	case !readOK:
		return block(rule, "The payment record could not be read just now, so it cannot be known that the fee is paid or within its grace days. Nothing is sent.")
	}
	for _, f := range fees {
		if (stopOld || !f.backDue) && isPastGrace(f, grace, now, tz) {
			if f.backDue {
				return block(rule, "An old due of the student is not paid and its grace days are over, and this centre stops the class link for an old due.")
			}
			return block(rule, "A fee of the student is not paid and its grace days are over.")
		}
	}
	for _, f := range fees {
		if !stopOld && f.backDue && isPastGrace(f, grace, now, tz) {
			return allow(rule, "The student is in the batch, the contact agreed, and every ordinary fee is paid or within its grace days. An old due does not stop the class link at this centre.")
		}
	}
	return allow(rule, "The student is in the batch, the contact agreed, and every fee is paid or within its grace days.")
}

// checkNoteAfterMark is rules.ts checkNoteAfterMark.
func checkNoteAfterMark(mark string, closed bool) Decision {
	const rule = "missed-note-after-teacher-mark"
	if !closed {
		return block(rule, "The teacher has not confirmed this class's attendance yet, so no one is told a child missed it.")
	}
	if mark != "absent" {
		return block(rule, "The teacher did not mark this student absent.")
	}
	return allow(rule, "The teacher marked the student absent and confirmed the class's attendance.")
}

// ---- the owner's page (view.ts) ----

type pendingClass struct {
	session  *ClassSession
	students []Student
}

func studentsOf(s *Settings, batchID string) []Student {
	var out []Student
	for _, x := range s.Students {
		if x.BatchID == batchID {
			out = append(out, x)
		}
	}
	return out
}

// pendingClasses is view.ts pendingClasses: over, not confirmed, still within the week, oldest first.
func pendingClasses(s *Settings, st *ClassesState, now int64) []pendingClass {
	var out []pendingClass
	for _, sess := range st.Sessions {
		students := studentsOf(s, sess.BatchID)
		if sess.EndMs <= now && sess.ClosedAtMs == nil && sess.EndMs > now-MarkWindowMs && len(students) > 0 {
			out = append(out, pendingClass{sess, students})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].session.StartMs != out[j].session.StartMs {
			return out[i].session.StartMs < out[j].session.StartMs
		}
		return out[i].session.ID < out[j].session.ID
	})
	return out
}

func pageCase(sessionID string) string { return "k-" + sha(sessionID)[:12] }

func classDigest(p pendingClass) string {
	rows := make([]any, len(p.students))
	for i, x := range p.students {
		rows[i] = []any{x.Name, p.session.Marks[studentKey(x.Parent, x.Name)]}
	}
	return digestOf("class", p.session.ID, rows)
}

func doubtDigest(d *Doubt) string { return digestOf("doubt", d.ID, d.Text, d.State) }

// ownerClassesView is view.ts ownerClassesView.
func ownerClassesView(s *Settings, st *Store, now int64) any {
	cs := st.classesRead()
	if cs == nil {
		return map[string]any{"pending": []any{}, "doubts": []any{}}
	}
	pending := []any{}
	for _, p := range pendingClasses(s, cs, now) {
		students := make([]any, len(p.students))
		for i, x := range p.students {
			students[i] = map[string]any{"n": i + 1, "name": x.Name, "missed": p.session.Marks[studentKey(x.Parent, x.Name)] == "absent"}
		}
		pending = append(pending, map[string]any{"case": pageCase(p.session.ID), "digest": classDigest(p), "batch": batchNames(s, p.session.BatchID), "startMs": p.session.StartMs, "students": students})
	}
	doubts := []any{}
	for _, d := range cs.Doubts {
		if d.State == "open" {
			doubts = append(doubts, map[string]any{"case": d.ID, "digest": doubtDigest(d), "student": d.Student, "batch": batchNames(s, d.BatchID), "text": d.Text, "atMs": d.AtMs})
		}
	}
	return map[string]any{"pending": pending, "doubts": doubts}
}

// ---- what a contact and the teacher say (parse.ts) ----

var (
	urlOnly        = regexp.MustCompile(`(?i)^https://(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?/[^\s()<>"']+$`)
	teacherLink    = regexp.MustCompile(`(?i)^link\s+(.+?)\s+(?:(next|today)\s+)?(https://\S+)$`)
	teacherLinkAny = regexp.MustCompile(`(?i)^link(\s|$)`)
	teacherPresent = regexp.MustCompile(`(?i)^present$`)
	teacherAbsent  = regexp.MustCompile(`(?i)^absent((?:[\s,]+\d{1,3})+)$`)
	teacherAbsAny  = regexp.MustCompile(`(?i)^absent(\s|$)`)
	teacherClass   = regexp.MustCompile(`(?i)^(?:class|classes)$`)
	teacherDoubts  = regexp.MustCompile(`(?i)^doubts?$`)
	teacherAnswer  = regexp.MustCompile(`(?i)^answered\s+(d-\d{1,6})$`)
	teacherShare   = regexp.MustCompile(`(?i)^share\s+(.+)$`)
	digits3        = regexp.MustCompile(`\d{1,3}`)
	attTap         = regexp.MustCompile(`^cls:att:(.+):all$`)
	doubtEdges     = regexp.MustCompile(`^[\s:,.\-–—]+|[\s:,.\-–—]+$`)
	spaces         = regexp.MustCompile(`\s+`)
)

// isClassLink is parse.ts isClassLink.
func isClassLink(text string) bool {
	return language.UTF16Len(text) <= 300 && urlOnly.MatchString(text) && !strings.ContainsAny(text[len(text)-1:], ".,;:!?")
}

type teacherCmd struct {
	kind, batch, which, url, id string
	numbers                     []int
}

// readTeacherCommand is parse.ts readTeacherCommand (`text.trim()` is JavaScript's).
func readTeacherCommand(text string) *teacherCmd {
	t := language.TrimJS(text)
	if m := teacherLink.FindStringSubmatch(t); m != nil {
		if !isClassLink(m[3]) {
			return &teacherCmd{kind: "bad"}
		}
		which := "batch"
		if m[2] != "" {
			which = "next"
		}
		return &teacherCmd{kind: "link", batch: language.TrimJS(m[1]), which: which, url: m[3]}
	}
	if teacherLinkAny.MatchString(t) {
		return &teacherCmd{kind: "bad"}
	}
	if teacherPresent.MatchString(t) {
		return &teacherCmd{kind: "present"}
	}
	if m := teacherAbsent.FindStringSubmatch(t); m != nil {
		seen := map[int]bool{}
		var ns []int
		for _, x := range digits3.FindAllString(m[1], -1) {
			var n int
			fmt.Sscan(x, &n)
			if !seen[n] {
				seen[n] = true
				ns = append(ns, n)
			}
		}
		return &teacherCmd{kind: "absent", numbers: ns}
	}
	if teacherAbsAny.MatchString(t) {
		return &teacherCmd{kind: "bad"}
	}
	if teacherClass.MatchString(t) {
		return &teacherCmd{kind: "class"}
	}
	if teacherDoubts.MatchString(t) {
		return &teacherCmd{kind: "doubts"}
	}
	if m := teacherAnswer.FindStringSubmatch(t); m != nil {
		return &teacherCmd{kind: "answered", id: strings.ToLower(m[1])}
	}
	if m := teacherShare.FindStringSubmatch(t); m != nil {
		return &teacherCmd{kind: "share", batch: language.TrimJS(m[1])}
	}
	return nil
}

type contactAsk struct{ kind, answer, text string }

// readContactWords is parse.ts readContactWords.
func readContactWords(text string, consentPending bool) *contactAsk {
	t := language.Canon(text)
	if understanding.IsStop(t) {
		return nil
	}
	r := readingWords()
	if consentPending {
		tokens := len(strings.FieldsFunc(language.TrimJS(t), language.IsJSSpace))
		no, yes := language.P("rules.no").Test(t), language.P("rules.yes").Test(t)
		if tokens <= 3 && no && !yes {
			return &contactAsk{kind: "consent", answer: "no"}
		}
		if tokens <= 3 && yes {
			return &contactAsk{kind: "consent", answer: "yes"}
		}
	}
	if r.doubt.Test(t) {
		cut := func(source string) string {
			return spaces.ReplaceAllString(doubtEdges.ReplaceAllString(r.doubtAnyCase.Replace(source, " "), ""), " ")
		}
		typed := cut(text)
		rest := typed
		if language.UTF16Len(typed) >= language.UTF16Len(language.TrimJS(text)) {
			rest = cut(t)
		}
		if language.UTF16Len(rest) >= 8 {
			return &contactAsk{kind: "doubt", text: rest}
		}
		return &contactAsk{kind: "doubt"}
	}
	if r.next.Test(t) {
		return &contactAsk{kind: "next"}
	}
	if r.material.Test(t) {
		return &contactAsk{kind: "material"}
	}
	return nil
}

// ---- classFacts: a class message's own facts (run.ts ClassFacts) ----

type classFacts struct {
	studentName, batchName, classLink, materialLink, roster, doubtText                     string
	classMs                                                                                *int64
	lines                                                                                  []ClassLine
	hasLines                                                                               bool
	leadMinutes, presentCount, absentCount, notedCount, waitingCount, sentCount, heldCount *int64
}

func (c *classFacts) apply(f *MessageFacts) {
	set := func(dst **string, v string) {
		if v != "" {
			*dst = S(v)
		}
	}
	set(&f.StudentName, c.studentName)
	set(&f.BatchName, c.batchName)
	set(&f.ClassLink, c.classLink)
	set(&f.MaterialLink, c.materialLink)
	set(&f.Roster, c.roster)
	set(&f.DoubtText, c.doubtText)
	if c.classMs != nil {
		f.ClassMs = c.classMs
	}
	if c.hasLines {
		f.ClassLines, f.HasClassLines = c.lines, true
	}
	for _, x := range []struct {
		dst **int64
		v   *int64
	}{{&f.LeadMinutes, c.leadMinutes}, {&f.PresentCount, c.presentCount}, {&f.AbsentCount, c.absentCount}, {&f.NotedCount, c.notedCount}, {&f.WaitingCount, c.waitingCount}, {&f.SentCount, c.sentCount}, {&f.HeldCount, c.heldCount}} {
		if x.v != nil {
			*x.dst = x.v
		}
	}
}

// ---- the work (run.ts) ----

func (a *Agent) cls() *ClassesState { return a.store.classesState() }

func (a *Agent) nameFor(batchID, lang string) string {
	if b := a.settings.BatchByID(batchID); b != nil {
		return BatchName(b, lang)
	}
	return batchID
}

// tellContact is run.ts ctx.tellContact: say.outcome to the contact with the class facts, the gate and the choices.
func (a *Agent) tellContact(phone, template string, f classFacts, choices []messaging.Choice, gate []Decision) string {
	o := sayOpts{cls: &f, gate: gate}
	if choices != nil {
		o.offer = &offer{choices: choices}
	}
	out, err := a.say.Outcome(a.ctx, a.args(nil, phone, "customer", []string{template}, o))
	if err != nil {
		return "not_sent"
	}
	return string(out)
}

func (a *Agent) tellTeacher(template string, f classFacts, choices []messaging.Choice) string {
	o := sayOpts{cls: &f}
	if choices != nil {
		o.offer = &offer{choices: choices}
	}
	out, err := a.say.Outcome(a.ctx, a.args(nil, a.owner(), "owner", []string{template}, o))
	if err != nil {
		return "not_sent"
	}
	return string(out)
}

func (a *Agent) clog(phone, action, outcome string, inputs any, refs map[string]string, notes string, ds ...Decision) {
	a.log(nil, phone, action, outcome, inputs, logMore{refs: refs, notes: notes, decisions: ds})
}

func (a *Agent) consentOf(x Student) string {
	if x.Adult {
		return "adult"
	}
	if c := a.cls().Consent[x.Parent]; c != nil && c.Answer != "" {
		return c.Answer
	}
	return "waiting"
}

// noteLanguage is agent.ts's noteLanguage: the student's own language as the contact's, when the contact has none yet.
func (a *Agent) noteLanguage(phone, lang string) {
	c := a.store.Customer(phone)
	if c.Language == "" && lang != "" && contains(a.settings.Languages, lang) {
		c.Language = lang
	}
}

func (a *Agent) askConsent(x Student) {
	if a.cls().Consent[x.Parent] != nil || a.store.Customer(x.Parent).OptedOut {
		return
	}
	a.noteLanguage(x.Parent, x.Language)
	lang := a.languageOf(x.Parent, nil)
	w := WordsFor(lang)
	choices := []messaging.Choice{{ID: "cls:yes", Title: w.Labels["yes"]}, {ID: "cls:no", Title: w.Labels["no"]}}
	out := a.tellContact(x.Parent, "class_consent_ask", classFacts{studentName: x.Name, batchName: a.nameFor(x.BatchID, lang)}, choices, nil)
	if out == "not_sent" {
		return
	}
	a.cls().Consent[x.Parent] = &Consent{AskedAtMs: a.now()}
	outcome := "confirmed"
	if out == "held_back" {
		outcome = "blocked"
	}
	a.clog(x.Parent, "class_consent", outcome, map[string]any{"asked": true}, nil, "the first class message: asked whether class links and reading material may be sent to this number")
}

func (a *Agent) answerConsent(phone, answer string) {
	var mine []Student
	for _, x := range a.settings.Students {
		if x.Parent == phone && !x.Adult {
			mine = append(mine, x)
		}
	}
	asked := a.cls().Consent[phone]
	if asked == nil || asked.Answer != "" || len(mine) == 0 {
		return
	}
	asked.Answer, asked.AnsweredAtMs = answer, N(a.now())
	a.clog(phone, "class_consent", "confirmed", map[string]any{"answer": answer}, map[string]string{"answer": answer}, "the contact answered "+answer+" to class links and reading material on this number")
	lang := a.languageOf(phone, nil)
	t := "class_consent_no"
	if answer == "yes" {
		t = "class_consent_yes"
	}
	a.tellContact(phone, t, classFacts{studentName: mine[0].Name, batchName: a.nameFor(mine[0].BatchID, lang)}, nil, nil)
}

// entitlement is run.ts entitlement: the access decision after the payment record is read again.
func (a *Agent) entitlement(x Student) (Decision, error) {
	readOK := true
	var fees []feeSnap
	for _, d := range append([]*Due(nil), a.store.Dues...) {
		if d.Customer != x.Parent || d.StudentName != x.Name {
			continue
		}
		if d.State == Open {
			ok, _, err := a.look(d)
			if err != nil {
				return Decision{}, err
			}
			readOK = readOK && ok
		}
		fees = append(fees, feeSnap{d.State, d.DueDate, balancePaise(d), d.BackDue})
	}
	inBatch := a.settings.BatchByID(x.BatchID) != nil
	return checkClassAccess(inBatch, a.consentOf(x), readOK, fees, a.settings.Due.GraceDays, a.settings.Classes.OldDuesStopLink, a.now(), a.settings.Timezone), nil
}

func (a *Agent) ensureSessions(now int64) {
	c, st := a.settings.Classes, a.cls()
	lead := c.LinkLeadMinutes * 60_000
	for _, o := range occurrencesBetween(c, "", a.settings.Timezone, now-6*3_600_000, now+lead+60_000) {
		if st.Sessions[o.ID] != nil || now < o.StartMs-lead || now >= o.EndMs {
			continue
		}
		st.Sessions[o.ID] = &ClassSession{ID: o.ID, BatchID: o.BatchID, StartMs: o.StartMs, EndMs: o.EndMs, Sent: map[string][]string{}, Withheld: map[string]Withheld{}, Marks: map[string]string{}, Noted: []string{}}
	}
	for id, s := range st.Sessions {
		if s.EndMs < now-KeepSessionsMs {
			delete(st.Sessions, id)
		}
	}
}

func (a *Agent) linkOfSession(s *ClassSession) string {
	if l := a.cls().SessionLinks[s.ID]; l != "" {
		return l
	}
	return a.cls().BatchLinks[s.BatchID]
}

func (a *Agent) sendLinks(s *ClassSession, now int64) error {
	link := a.linkOfSession(s)
	owner := a.settings.Owner.Language
	if link == "" {
		if !s.NoLinkTold {
			if a.tellTeacher("owner_class_no_link", classFacts{batchName: a.nameFor(s.BatchID, owner), classMs: N(s.StartMs)}, nil) != "not_sent" {
				s.NoLinkTold = true
			}
		}
		return nil
	}
	hash := linkHashOf(link)
	for _, x := range studentsOf(a.settings, s.BatchID) {
		k := studentKey(x.Parent, x.Name)
		if contains(s.Sent[k], hash) || a.store.Customer(x.Parent).OptedOut {
			continue
		}
		switch a.consentOf(x) {
		case "waiting":
			a.askConsent(x)
			continue
		case "no":
			continue
		}
		held, wasHeld := s.Withheld[k]
		if wasHeld && now-held.AtMs < recheckMs {
			continue
		}
		access, err := a.entitlement(x)
		if err != nil {
			return err
		}
		if access.Verdict != "allow" {
			if held.Reason != access.Reason {
				a.clog(x.Parent, "class_access", "blocked", map[string]any{"class": s.ID}, map[string]string{"session": s.ID, "batch": s.BatchID, "what": "link"}, "the class link was not sent: "+access.Reason, access)
			}
			s.Withheld[k] = Withheld{Reason: access.Reason, AtMs: now}
			continue
		}
		delete(s.Withheld, k)
		a.noteLanguage(x.Parent, x.Language)
		lang := a.languageOf(x.Parent, nil)
		out := a.tellContact(x.Parent, "class_link", classFacts{studentName: x.Name, batchName: a.nameFor(x.BatchID, lang), classMs: N(s.StartMs), classLink: link}, nil, []Decision{access})
		if out != "not_sent" {
			s.Sent[k] = append(s.Sent[k], hash)
		}
	}
	return nil
}

func (a *Agent) askAttendance(s *ClassSession) {
	owner := a.settings.Owner.Language
	choices := []messaging.Choice{{ID: "cls:att:" + s.ID + ":all", Title: everyone[owner]}}
	if a.tellTeacher("owner_class_attendance", classFacts{batchName: a.nameFor(s.BatchID, owner), classMs: N(s.StartMs)}, choices) != "not_sent" {
		s.AskedAtMs = N(a.now())
	}
}

func (a *Agent) sendNotes(s *ClassSession) int64 {
	var sent int64
	for _, x := range studentsOf(a.settings, s.BatchID) {
		k := studentKey(x.Parent, x.Name)
		if contains(s.Noted, k) {
			continue
		}
		gate := checkNoteAfterMark(s.Marks[k], s.ClosedAtMs != nil)
		if gate.Verdict != "allow" {
			continue
		}
		consent := a.consentOf(x)
		if consent == "no" || consent == "waiting" || a.store.Customer(x.Parent).OptedOut {
			s.Noted = append(s.Noted, k)
			continue
		}
		a.noteLanguage(x.Parent, x.Language)
		lang := a.languageOf(x.Parent, nil)
		out := a.tellContact(x.Parent, "class_missed_note", classFacts{studentName: x.Name, batchName: a.nameFor(x.BatchID, lang), classMs: N(s.StartMs)}, nil, []Decision{gate})
		if out == "not_sent" {
			continue
		}
		s.Noted = append(s.Noted, k)
		if out == "accepted" || out == "maybe" {
			sent++
		}
	}
	return sent
}

func (a *Agent) tellDoubtsWaiting() {
	st := a.cls()
	owner := a.settings.Owner.Language
	var order []string
	seen := map[string]bool{}
	for _, d := range st.Doubts {
		if d.State == "open" && !seen[d.BatchID] {
			seen[d.BatchID] = true
			order = append(order, d.BatchID)
		}
	}
	for _, b := range order {
		if _, told := st.DoubtsToldAtMs[b]; told {
			continue
		}
		var n int64
		for _, d := range st.Doubts {
			if d.State == "open" && d.BatchID == b {
				n++
			}
		}
		if a.tellTeacher("owner_class_doubts_waiting", classFacts{batchName: a.nameFor(b, owner), waitingCount: N(n)}, nil) != "not_sent" {
			st.DoubtsToldAtMs[b] = a.now()
		}
	}
}

// classesTick is run.ts onTick.
func (a *Agent) classesTick() error {
	now := a.now()
	a.ensureSessions(now)
	var list []*ClassSession
	for _, s := range a.cls().Sessions {
		list = append(list, s)
	}
	sort.SliceStable(list, func(i, j int) bool {
		return list[i].StartMs < list[j].StartMs || (list[i].StartMs == list[j].StartMs && list[i].ID < list[j].ID)
	})
	lead := a.settings.Classes.LinkLeadMinutes * 60_000
	for _, s := range list {
		if now < s.EndMs {
			if now >= s.StartMs-lead {
				if err := a.sendLinks(s, now); err != nil {
					return err
				}
			}
			continue
		}
		if s.ClosedAtMs != nil {
			if s.EndMs > now-MarkWindowMs {
				a.sendNotes(s)
			}
			continue
		}
		if s.AskedAtMs == nil && s.EndMs > now-MarkWindowMs && len(studentsOf(a.settings, s.BatchID)) > 0 {
			a.askAttendance(s)
		}
	}
	a.tellDoubtsWaiting()
	return nil
}

// markClass is run.ts markClass.
func (a *Agent) markClass(s *ClassSession, absent map[string]bool, via string) bool {
	if s.ClosedAtMs != nil {
		return false
	}
	roster := studentsOf(a.settings, s.BatchID)
	for _, x := range roster {
		k := studentKey(x.Parent, x.Name)
		if absent[k] {
			s.Marks[k] = "absent"
		} else {
			s.Marks[k] = "present"
		}
	}
	s.ClosedAtMs = N(a.now())
	present := int64(len(roster) - len(absent))
	a.clog(a.owner(), "class_attendance", "confirmed", map[string]any{"class": s.ID, "via": via},
		map[string]string{"session": s.ID, "batch": s.BatchID, "present": itoa(present), "absent": itoa(int64(len(absent))), "via": via}, "the teacher confirmed this class's attendance")
	noted := a.sendNotes(s)
	owner := a.settings.Owner.Language
	a.tellTeacher("owner_class_marked", classFacts{batchName: a.nameFor(s.BatchID, owner), classMs: N(s.StartMs), presentCount: N(present), absentCount: N(int64(len(absent))), notedCount: N(noted)}, nil)
	return true
}

func rosterText(students []Student) string {
	parts := make([]string, len(students))
	for i, x := range students {
		parts[i] = fmt.Sprintf("%d %s", i+1, x.Name)
	}
	return strings.Join(parts, ", ")
}

func (a *Agent) showFirstPending() {
	ps := pendingClasses(a.settings, a.cls(), a.now())
	owner := a.settings.Owner.Language
	if len(ps) == 0 {
		a.tellTeacher("owner_class_nothing", classFacts{}, nil)
		return
	}
	first := ps[0]
	choices := []messaging.Choice{{ID: "cls:att:" + first.session.ID + ":all", Title: everyone[owner]}}
	a.tellTeacher("owner_class_roster", classFacts{batchName: a.nameFor(first.session.BatchID, owner), classMs: N(first.session.StartMs), roster: rosterText(first.students)}, choices)
}

func (a *Agent) addDoubt(phone, text string) *Doubt {
	var mine []Student
	for _, x := range a.settings.Students {
		if x.Parent == phone {
			mine = append(mine, x)
		}
	}
	if len(mine) == 0 {
		return nil
	}
	st := a.cls()
	now := a.now()
	soonest, best := mine[0], int64(math.MaxInt64)
	for _, m := range mine {
		next := int64(9007199254740991)
		if o := nextClass(a.settings.Classes, a.settings.Timezone, m.BatchID, now); o != nil {
			next = o.StartMs
		}
		if next < best {
			soonest, best = m, next
		}
	}
	maxID := int64(0)
	for _, d := range st.Doubts {
		var n int64
		fmt.Sscan(d.ID[2:], &n)
		maxID = max(maxID, n)
	}
	id := fmt.Sprintf("d-%d", maxID+1)
	names := make([]string, len(mine))
	for i, m := range mine {
		names[i] = m.Name
	}
	d := &Doubt{ID: id, Parent: phone, Student: strings.Join(names, " / "), BatchID: soonest.BatchID, Text: language.UTF16Slice(text, maxDoubtChars), AtMs: now, State: "open"}
	st.Doubts = append(st.Doubts, d)
	delete(st.DoubtsToldAtMs, d.BatchID)
	a.clog(phone, "class_doubt", "confirmed", map[string]any{"doubt": id, "text": text}, map[string]string{"doubt": id, "batch": d.BatchID}, "a student's doubt was collected for the teacher; the agent does not answer subject questions")
	var keep []*Doubt
	for _, x := range st.Doubts {
		if x.State == "open" || x.AtMs > now-90*24*3_600_000 {
			keep = append(keep, x)
		}
	}
	st.Doubts = keep
	return d
}

func (a *Agent) showDoubts() {
	st := a.cls()
	owner := a.settings.Owner.Language
	var open []*Doubt
	for _, d := range st.Doubts {
		if d.State == "open" {
			open = append(open, d)
		}
	}
	if len(open) == 0 {
		a.tellTeacher("owner_class_nothing", classFacts{}, nil)
		return
	}
	var parts []string
	for i, d := range open {
		if i >= maxDoubtsShown {
			break
		}
		parts = append(parts, fmt.Sprintf("%s %s (%s): %s", d.ID, d.Student, a.nameFor(d.BatchID, owner), d.Text))
	}
	for _, d := range open {
		delete(st.DoubtsToldAtMs, d.BatchID)
	}
	shown := strings.Join(parts, " | ")
	if len(open) > maxDoubtsShown {
		shown = fmt.Sprintf("%s | ... and %d more", shown, len(open)-maxDoubtsShown)
	}
	a.tellTeacher("owner_class_doubts", classFacts{doubtText: shown}, nil)
}

func (a *Agent) sendMaterial(x Student, reply bool) (string, error) {
	switch a.consentOf(x) {
	case "waiting":
		a.askConsent(x)
		return "held", nil
	case "no":
		return "held", nil
	}
	if a.store.Customer(x.Parent).OptedOut {
		return "held", nil
	}
	access, err := a.entitlement(x)
	if err != nil {
		return "", err
	}
	a.noteLanguage(x.Parent, x.Language)
	lang := a.languageOf(x.Parent, nil)
	names := classFacts{studentName: x.Name, batchName: a.nameFor(x.BatchID, lang)}
	if access.Verdict != "allow" {
		a.clog(x.Parent, "class_access", "blocked", map[string]any{"material": x.BatchID}, map[string]string{"batch": x.BatchID, "what": "material"}, "the reading-material link was not sent: "+access.Reason, access)
		if reply {
			a.tellContact(x.Parent, "class_not_entitled", names, nil, nil)
		}
		return "held", nil
	}
	url, token := a.linkFor(x.Parent, false)
	if url == "" {
		a.clog(x.Parent, "class_material", "blocked", map[string]any{"batch": x.BatchID}, map[string]string{"batch": x.BatchID}, "the centre has no page address (no pages file), so no private material link can be made")
		if reply {
			a.tellContact(x.Parent, "class_material_none", names, nil, nil)
		}
		return "held", nil
	}
	f := names
	f.materialLink = url + "/m/" + x.BatchID
	out := a.tellContact(x.Parent, "class_material_link", f, nil, []Decision{access})
	if out == "accepted" || out == "maybe" {
		a.keepLink(x.Parent, token, "classes")
		a.clog(x.Parent, "class_material", "confirmed", map[string]any{"batch": x.BatchID}, map[string]string{"batch": x.BatchID}, "the private reading-material link was sent")
		return "sent", nil
	}
	return "held", nil
}

// classesContact is run.ts onContact: a contact's message read by the class words and nothing else; true when it was about classes and was answered.
func (a *Agent) classesContact(m messaging.InboundMessage) (bool, error) {
	phone := m.From
	var mine []Student
	for _, x := range a.settings.Students {
		if x.Parent == phone {
			mine = append(mine, x)
		}
	}
	if len(mine) == 0 {
		return false, nil
	}
	st := a.cls()
	noteReceived := func() {
		in := map[string]any{"text": m.Text, "id": m.ID}
		if m.Reply != nil {
			in["reply"] = m.Reply.ID
		}
		a.clog(phone, "receive_message", "confirmed", in, map[string]string{"messageId": m.ID}, "a message about classes, read by the class word lists (no model)")
	}
	tap := ""
	if m.Reply != nil {
		tap = m.Reply.ID
	}
	if tap == "cls:yes" || tap == "cls:no" {
		noteReceived()
		a.answerConsent(phone, strings.TrimPrefix(tap, "cls:"))
		return true, nil
	}
	if m.Image || m.VoiceNote {
		return false, nil
	}
	if understanding.IsStop(language.Canon(m.Text)) {
		delete(st.AwaitingDoubt, phone)
		return false, nil
	}
	waiting, isWaiting := st.AwaitingDoubt[phone]
	asked := st.Consent[phone]
	allAdult := true
	for _, x := range mine {
		allAdult = allAdult && x.Adult
	}
	ask := readContactWords(m.Text, asked != nil && asked.Answer == "" && !allAdult)
	if isWaiting && a.now()-waiting.AtMs < doubtWaitMs && tap == "" {
		noteReceived()
		delete(st.AwaitingDoubt, phone)
		a.addDoubt(phone, language.TrimJS(m.Text))
		a.tellContact(phone, "class_doubt_thanks", classFacts{studentName: mine[0].Name, batchName: a.nameFor(mine[0].BatchID, a.languageOf(phone, nil))}, nil, nil)
		return true, nil
	}
	if ask == nil {
		return false, nil
	}
	noteReceived()
	lang := a.languageOf(phone, nil)
	first := classFacts{studentName: mine[0].Name, batchName: a.nameFor(mine[0].BatchID, lang)}
	switch ask.kind {
	case "consent":
		a.answerConsent(phone, ask.answer)
		return true, nil
	case "next":
		var lines []ClassLine
		for _, x := range mine {
			if o := nextClass(a.settings.Classes, a.settings.Timezone, x.BatchID, a.now()); o != nil {
				lines = append(lines, ClassLine{StudentName: x.Name, BatchName: a.nameFor(x.BatchID, lang), StartMs: o.StartMs})
			}
		}
		if len(lines) > 0 {
			a.tellContact(phone, "class_next", classFacts{lines: lines, hasLines: true}, nil, nil)
		} else {
			a.tellContact(phone, "class_next_none", classFacts{}, nil, nil)
		}
		return true, nil
	case "material":
		for _, x := range mine {
			if _, err := a.sendMaterial(x, true); err != nil {
				return true, err
			}
		}
		return true, nil
	}
	if ask.text != "" {
		a.addDoubt(phone, ask.text)
		a.tellContact(phone, "class_doubt_thanks", first, nil, nil)
		return true, nil
	}
	names := make([]string, len(mine))
	for i, x := range mine {
		names[i] = x.Name
	}
	st.AwaitingDoubt[phone] = AwaitDoubt{Student: strings.Join(names, " / "), AtMs: a.now()}
	a.tellContact(phone, "class_doubt_ask", classFacts{}, nil, nil)
	return true, nil
}

func (a *Agent) resolveBatch(words string) *Batch {
	w := language.TrimJS(language.Canon(words))
	if b := a.settings.BatchByID(w); b != nil {
		return b
	}
	for i := range a.settings.Batches {
		for _, list := range a.settings.Batches[i].Names {
			for _, n := range list {
				if language.Canon(n) == w {
					return &a.settings.Batches[i]
				}
			}
		}
	}
	return nil
}

// classesTeacher is run.ts onTeacher.
func (a *Agent) classesTeacher(m messaging.InboundMessage) (bool, error) {
	owner := a.settings.Owner.Language
	if m.Reply != nil {
		if g := attTap.FindStringSubmatch(m.Reply.ID); g != nil {
			s := a.cls().Sessions[g[1]]
			if s == nil || s.ClosedAtMs != nil {
				a.tellTeacher("owner_class_nothing", classFacts{}, nil)
				return true, nil
			}
			a.markClass(s, map[string]bool{}, "whatsapp")
			return true, nil
		}
	}
	if m.Image || m.VoiceNote {
		return false, nil
	}
	cmd := readTeacherCommand(m.Text)
	if cmd == nil {
		return false, nil
	}
	unknown := func() (bool, error) { a.tellTeacher("owner_class_unknown", classFacts{}, nil); return true, nil }
	pending := func() []pendingClass { return pendingClasses(a.settings, a.cls(), a.now()) }
	switch cmd.kind {
	case "bad":
		return unknown()
	case "link":
		b := a.resolveBatch(cmd.batch)
		if b == nil || !isClassLink(cmd.url) {
			return unknown()
		}
		if _, has := a.settings.Classes.Timetable[b.ID]; !has {
			return unknown()
		}
		if cmd.which == "batch" {
			a.cls().BatchLinks[b.ID] = cmd.url
		} else {
			next := nextClass(a.settings.Classes, a.settings.Timezone, b.ID, a.now())
			if next == nil {
				return unknown()
			}
			a.cls().SessionLinks[next.ID] = cmd.url
		}
		a.clog(a.owner(), "class_link_set", "confirmed", map[string]any{"batch": b.ID, "which": cmd.which}, map[string]string{"batch": b.ID, "which": cmd.which, "linkHash": linkHashOf(cmd.url)}, "the teacher pasted a class link; it is read again at every send, so a class not yet sent uses it")
		name := a.nameFor(b.ID, owner)
		if n := b.Names[owner]; len(n) > 0 {
			name = n[0]
		}
		a.tellTeacher("owner_class_link_set", classFacts{batchName: name, leadMinutes: N(a.settings.Classes.LinkLeadMinutes)}, nil)
		return true, nil
	case "present":
		ps := pending()
		if len(ps) == 0 {
			a.tellTeacher("owner_class_nothing", classFacts{}, nil)
		} else {
			a.markClass(ps[0].session, map[string]bool{}, "whatsapp")
		}
		return true, nil
	case "absent":
		ps := pending()
		if len(ps) == 0 {
			a.tellTeacher("owner_class_nothing", classFacts{}, nil)
			return true, nil
		}
		first := ps[0]
		absent := map[string]bool{}
		for _, n := range cmd.numbers {
			if n < 1 || n > len(first.students) {
				return unknown()
			}
			x := first.students[n-1]
			absent[studentKey(x.Parent, x.Name)] = true
		}
		a.markClass(first.session, absent, "whatsapp")
		return true, nil
	case "class":
		a.showFirstPending()
		return true, nil
	case "doubts":
		a.showDoubts()
		return true, nil
	case "answered":
		for _, d := range a.cls().Doubts {
			if d.ID == cmd.id && d.State == "open" {
				d.State = "answered"
				a.clog(a.owner(), "class_doubt", "confirmed", map[string]any{"doubt": d.ID, "answered": true}, map[string]string{"doubt": d.ID, "answered": "yes"}, "the teacher said this doubt is answered")
				break
			}
		}
		a.showDoubts()
		return true, nil
	case "share":
		b := a.resolveBatch(cmd.batch)
		if b == nil {
			return unknown()
		}
		var sent, held int64
		for _, x := range studentsOf(a.settings, b.ID) {
			r, err := a.sendMaterial(x, false)
			if err != nil {
				return true, err
			}
			if r == "sent" {
				sent++
			} else {
				held++
			}
		}
		a.tellTeacher("owner_class_shared", classFacts{batchName: a.nameFor(b.ID, owner), sentCount: N(sent), heldCount: N(held)}, nil)
		return true, nil
	}
	return false, nil
}

// classesPageAction is run.ts onPageAction.
func (a *Agent) classesPageAction(action, caseID, digest string) (bool, error) {
	if a.settings.Classes == nil {
		return false, nil
	}
	if action == "answered" {
		for _, d := range a.cls().Doubts {
			if d.State == "open" && d.ID == caseID && doubtDigest(d) == digest {
				d.State = "answered"
				a.clog(a.owner(), "class_doubt", "confirmed", map[string]any{"doubt": d.ID, "answered": true}, map[string]string{"doubt": d.ID, "answered": "yes", "via": "page"}, "the teacher said, on their page, that this doubt is answered")
				return true, nil
			}
		}
		return false, nil
	}
	base, n, _ := strings.Cut(caseID, ".")
	var found *pendingClass
	for _, p := range pendingClasses(a.settings, a.cls(), a.now()) {
		if pageCase(p.session.ID) == base && classDigest(p) == digest {
			p := p
			found = &p
			break
		}
	}
	if found == nil {
		return false, nil
	}
	if action == "absent" {
		var i int
		if _, err := fmt.Sscan(n, &i); err != nil || i < 1 || i > len(found.students) {
			return false, nil
		}
		x := found.students[i-1]
		k := studentKey(x.Parent, x.Name)
		if found.session.Marks[k] == "absent" {
			delete(found.session.Marks, k)
		} else {
			found.session.Marks[k] = "absent"
		}
		return true, nil
	}
	absent := map[string]bool{}
	for _, x := range found.students {
		if k := studentKey(x.Parent, x.Name); found.session.Marks[k] == "absent" {
			absent[k] = true
		}
	}
	return a.markClass(found.session, absent, "page"), nil
}
