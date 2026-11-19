// The in-memory messaging a "fakes" shop runs on: the Go twin of messaging.ts createFakeMessaging (the fake that models the 24-hour window, approved templates and STOP) and of
// modules/runtime/services.ts standInMessaging (that fake with every template of the pathway approved in every language, printing what it "sends"). It answers as the TypeScript does:
// the same ids (`wamid.out_N` for what we send, `wamid.in_N` for what a person sends), the same window rule (strictly under 24 hours since the person last wrote), the same errors,
// and the same fault injection. The HTTP stand-in SERVERS in modules/standins are test infrastructure and stay TypeScript.
//
// StandIn is deliberately only the four core methods: the TypeScript object has no sendInteractive, sendDocument, sendImage, sendSticker or ping, so say.ts sends buttons as words and
// goes without a picture. Nothing calls its receive, so its window is never open and every message to a customer is a template (the TypeScript's own comment says the same).
package messaging

import (
	"context"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// FaultMode is what an injected fault does: "lostReply" (the message goes out, the reply is lost: a TimeoutError) or "error" (the provider refuses: ApiError 500).
type FaultMode = string

// FaultOptions is core/faults.ts FaultOptions; nil is "left out" (times 1, after 0).
type FaultOptions struct {
	Times *int
	After *int
}

type plan struct {
	mode         FaultMode
	times, after int
}

// Faults is createFaults: each fake has its own plan list, used in the order added.
type Faults struct {
	mu    sync.Mutex
	plans map[string][]*plan
}

func newFaults() *Faults { return &Faults{plans: map[string][]*plan{}} }

// Inject plans a fault for an operation.
func (f *Faults) Inject(op string, mode FaultMode, o FaultOptions) {
	p := &plan{mode: mode, times: 1}
	if o.Times != nil {
		p.times = *o.Times
	}
	if o.After != nil {
		p.after = *o.After
	}
	f.mu.Lock()
	f.plans[op] = append(f.plans[op], p)
	f.mu.Unlock()
}

// Take is called at the start of an operation: the fault to apply to this call, if any.
func (f *Faults) Take(op string) (FaultMode, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	list := f.plans[op]
	if len(list) == 0 {
		return "", false
	}
	p := list[0]
	if p.after > 0 {
		p.after--
		return "", false
	}
	p.times--
	if p.times <= 0 {
		f.plans[op] = list[1:]
	}
	return p.mode, true
}

// ReceiveOptions is the options of FakeMessaging.receive. ID nil is "make one".
type ReceiveOptions struct {
	ID        *string
	Reply     *Reply
	Image     bool
	VoiceNote bool
	Media     *VoiceMediaRef
}

// Fake is the fake WhatsApp: it implements Messaging, Interactive, Documents, Images and Stickers (and not Pinger: the TypeScript fake has no ping).
type Fake struct {
	mu          sync.Mutex
	clock       Clock
	outbox      []OutboundMessage
	lastInbound map[string]int64
	optedOut    map[string]bool
	approved    map[string]bool
	faults      *Faults
	inboundSeq  int
	outboundSeq int
}

// NewFake is createFakeMessaging.
func NewFake(clock Clock) *Fake {
	return &Fake{clock: clock, lastInbound: map[string]int64{}, optedOut: map[string]bool{}, approved: map[string]bool{}, faults: newFaults(), inboundSeq: 1, outboundSeq: 1}
}

// Inject plans a fault for an operation: sendText, sendTemplate, sendInteractive, sendDocument, sendImage or sendSticker.
func (f *Fake) Inject(op string, mode FaultMode, o FaultOptions) { f.faults.Inject(op, mode, o) }

// Approve says the provider has approved this template in this language.
func (f *Fake) Approve(name string, language Language) {
	f.mu.Lock()
	f.approved[name+":"+language] = true
	f.mu.Unlock()
}

// Outbox is a copy of everything sent.
func (f *Fake) Outbox() []OutboundMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]OutboundMessage{}, f.outbox...)
}

// SentTo is a copy of what was sent to one number.
func (f *Fake) SentTo(number string) []OutboundMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []OutboundMessage{}
	for _, m := range f.outbox {
		if m.To == number {
			out = append(out, m)
		}
	}
	return out
}

// IsOptedOut: has this number sent STOP?
func (f *Fake) IsOptedOut(number string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.optedOut[number]
}

// Receive is a person sending us a message (this opens their window). "STOP" is `text.trim().toUpperCase() === "STOP"`: JavaScript's trim and FULL case mapping (the ligature "ﬆ" upper-cases
// to "ST", so "ﬆop" is STOP in JavaScript, and strings.ToUpper would miss it).
func (f *Fake) Receive(from, text string, o ReceiveOptions) InboundMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := f.clock()
	f.lastInbound[from] = now
	if toUpper(trimJS(text)) == "STOP" {
		f.optedOut[from] = true
	}
	var id string
	if o.ID != nil {
		id = *o.ID
	} else {
		id = "wamid.in_" + itoa(f.inboundSeq)
		f.inboundSeq++
	}
	m := InboundMessage{ID: id, From: from, Text: text, Timestamp: now, Reply: o.Reply, Image: o.Image, VoiceNote: o.VoiceNote, Media: o.Media}
	return m
}

func (f *Fake) windowOpen(to string) bool {
	last, ok := f.lastInbound[to]
	return ok && f.clock()-last < 24*Hour
}

// store is the fake's `store`: a copy with the next id, now, and whether the person had sent STOP. Called with the lock held.
func (f *Fake) store(m OutboundMessage) OutboundMessage {
	m.ID = "wamid.out_" + itoa(f.outboundSeq)
	f.outboundSeq++
	m.SentAt = f.clock()
	m.AfterOptOut = f.optedOut[m.To]
	f.outbox = append(f.outbox, m)
	return m
}

var errProviderCouldNotTake = "The provider could not take the message."

// begin is the start every send shares: the injected fault, then the window. It returns the fault so the caller can lose the reply after storing the message.
func (f *Fake) begin(op, to string, needsWindow bool) (FaultMode, error) {
	fault, _ := f.faults.Take(op)
	if fault == "error" {
		return fault, &guard.ApiError{Status: 500, Message: errProviderCouldNotTake}
	}
	if needsWindow {
		f.mu.Lock()
		open := f.windowOpen(to)
		f.mu.Unlock()
		if !open {
			return fault, &guard.WindowClosedError{}
		}
	}
	return fault, nil
}

func (f *Fake) put(m OutboundMessage, fault FaultMode, what string) (OutboundMessage, error) {
	f.mu.Lock()
	stored := f.store(m)
	f.mu.Unlock()
	if fault == "lostReply" {
		return OutboundMessage{}, &guard.TimeoutError{What: what}
	}
	return stored, nil
}

// SendText: only while the window is open.
func (f *Fake) SendText(_ context.Context, to, text string) (OutboundMessage, error) {
	fault, err := f.begin("sendText", to, true)
	if err != nil {
		return OutboundMessage{}, err
	}
	return f.put(OutboundMessage{To: to, Kind: "text", Text: text}, fault, "send message")
}

// SendInteractive: only while the window is open. The fake does not check Meta's limits (the TypeScript's does not).
func (f *Fake) SendInteractive(_ context.Context, to string, m InteractiveMessage) (OutboundMessage, error) {
	fault, err := f.begin("sendInteractive", to, true)
	if err != nil {
		return OutboundMessage{}, err
	}
	cp := m
	return f.put(OutboundMessage{To: to, Kind: "interactive", Text: InteractiveText(m), Interactive: &cp}, fault, "send interactive message")
}

// SendDocument: window, then the document's own check.
func (f *Fake) SendDocument(_ context.Context, to string, d DocumentMessage) (OutboundMessage, error) {
	fault, err := f.begin("sendDocument", to, true)
	if err != nil {
		return OutboundMessage{}, err
	}
	if p := DocumentProblem(d); p != "" {
		return OutboundMessage{}, guard.Apif(400, "The document cannot be sent: %s.", p)
	}
	text := d.Filename
	if d.Caption != nil {
		text = *d.Caption
	}
	cp := d
	return f.put(OutboundMessage{To: to, Kind: "document", Text: text, Document: &cp}, fault, "send document")
}

// SendImage: window, then the image's own check.
func (f *Fake) SendImage(_ context.Context, to string, i ImageMessage) (OutboundMessage, error) {
	fault, err := f.begin("sendImage", to, true)
	if err != nil {
		return OutboundMessage{}, err
	}
	if p := ImageProblem(i); p != "" {
		return OutboundMessage{}, guard.Apif(400, "The image cannot be sent: %s.", p)
	}
	text := ""
	if i.Caption != nil {
		text = *i.Caption
	}
	cp := i
	return f.put(OutboundMessage{To: to, Kind: "image", Text: text, Image: &cp}, fault, "send image")
}

// SendSticker: window, then the sticker's own check.
func (f *Fake) SendSticker(_ context.Context, to string, s StickerMessage) (OutboundMessage, error) {
	fault, err := f.begin("sendSticker", to, true)
	if err != nil {
		return OutboundMessage{}, err
	}
	if p := StickerProblem(s); p != "" {
		return OutboundMessage{}, guard.Apif(400, "The sticker cannot be sent: %s.", p)
	}
	cp := s
	return f.put(OutboundMessage{To: to, Kind: "sticker", Text: "", Sticker: &cp}, fault, "send sticker")
}

// SendTemplate: approved templates only, and no window.
func (f *Fake) SendTemplate(_ context.Context, to string, t TemplateMessage) (OutboundMessage, error) {
	fault, err := f.begin("sendTemplate", to, false)
	if err != nil {
		return OutboundMessage{}, err
	}
	f.mu.Lock()
	ok := f.approved[t.Name+":"+t.Language]
	f.mu.Unlock()
	if !ok {
		return OutboundMessage{}, guard.Apif(400, "The template %s (%s) is not approved.", t.Name, t.Language)
	}
	if err := templateHeaderProblem(t); err != nil {
		return OutboundMessage{}, err
	}
	m := OutboundMessage{To: to, Kind: "template", Text: t.Text, TemplateName: t.Name, Language: t.Language}
	if t.HeaderImage != nil && *t.HeaderImage != "" {
		m.HeaderImage = *t.HeaderImage
	}
	return f.put(m, fault, "send template")
}

// IsWindowOpen: did this person message us in the last 24 hours?
func (f *Fake) IsWindowOpen(_ context.Context, to string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.windowOpen(to), nil
}

// GetMessage is the fake's own outbox, by id.
func (f *Fake) GetMessage(_ context.Context, id string) (*OutboundMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, m := range f.outbox {
		if m.ID == id {
			c := m
			return &c, nil
		}
	}
	return nil, nil
}

// StandIn is standInMessaging: the stand-in WhatsApp for a local run. Every template of the pathway is approved in every language, and `say` hears what it "sends" (nil: nothing).
type StandIn struct {
	fake *Fake
	say  func(line string)
}

// NewStandIn is standInMessaging(clock, templateNames, say). Its languages are languages.ts LANGUAGES (hi, en, ml, kn).
func NewStandIn(clock Clock, templateNames []string, say func(line string)) *StandIn {
	f := NewFake(clock)
	for _, name := range templateNames {
		for _, l := range []Language{"hi", "en", "ml", "kn"} {
			f.Approve(name, l)
		}
	}
	if say == nil {
		say = func(string) {}
	}
	return &StandIn{fake: f, say: say}
}

// SendText says "[stand-in WhatsApp] to <to>: <text>" after the fake took it. The window is never open here, so it is always a WindowClosedError.
func (s *StandIn) SendText(ctx context.Context, to, text string) (OutboundMessage, error) {
	m, err := s.fake.SendText(ctx, to, text)
	if err != nil {
		return m, err
	}
	s.say("[stand-in WhatsApp] to " + to + ": " + text)
	return m, nil
}

// SendTemplate says the template's whole rendered text.
func (s *StandIn) SendTemplate(ctx context.Context, to string, t TemplateMessage) (OutboundMessage, error) {
	m, err := s.fake.SendTemplate(ctx, to, t)
	if err != nil {
		return m, err
	}
	s.say("[stand-in WhatsApp] to " + to + ": " + t.Text)
	return m, nil
}

// IsWindowOpen is the fake's.
func (s *StandIn) IsWindowOpen(ctx context.Context, to string) (bool, error) {
	return s.fake.IsWindowOpen(ctx, to)
}

// GetMessage is the fake's.
func (s *StandIn) GetMessage(ctx context.Context, id string) (*OutboundMessage, error) {
	return s.fake.GetMessage(ctx, id)
}
