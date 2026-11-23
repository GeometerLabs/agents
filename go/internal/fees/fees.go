// Package fees is the Fees (and Classes) centre's template for the shared Go runtime (internal/runtime): decision 61, wave 3. It is the Go twin of templates/education/fees (the
// settings, the store, the agent, the channel's reads) and implements runtime.Kit, so the queue, the record, the owner's sign-in, passkeys, phones, push, the limits page, the
// owner's file and the HTTP face are the shared runtime's own code. It reads and writes the same files as the TypeScript runtime (agent.db schema 5, the snapshot in pieces, the
// record), so a centre can move between the two runtimes and lose nothing.
//
// What is ported, and what is not with the reason, is in go/TRIAL.md ("Wave 3: Fees") and this package's Deferred.md. A kind of event that is not ported answers runtime.Unported,
// so its task ends failed at once with that sentence, never a silent "done".
package fees

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/payments/razorpay"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/terms"
)

// Pathway and Version are what a Fees folder's pathway.lock must name: the number in templates/education/fees/package.json.
const (
	Pathway = "fees"
	Version = "0.1.0"
)

// Ports are the services of one centre (services.ts buildServices): Fees has payments (a Razorpay centre only) and WhatsApp. It has no calendar.
type Ports struct {
	// Payments is the gateway behind its Guard, or the fake; nil: a UPI centre (the owner marks money by hand).
	Payments     payments.Payments
	Capabilities payments.Capabilities
	// WhatsApp is the centre's WhatsApp behind its Guard, or the stand-in; nil: a centre with no WhatsApp.
	WhatsApp messaging.Messaging
	// PushOwner and OwnerRoute are the owner's push alerts and their choice of route (push.ts), as Bookings has them.
	PushOwner  func(text string) []string
	OwnerRoute func(hasWhatsApp bool) string
	// QR makes a UPI request's QR picture where WhatsApp can fetch it (qr-image.ts folderQrImages); nil: the words carry the link and the UPI ID.
	QR ownermarked.ImageMaker
}

// Kit is the Fees template (runtime.Kit).
type Kit struct {
	Ports    Ports
	Settings *Settings
	Now      func() int64
	// PageBase is where the centre's page is (pages.json's url, else base), read fresh; "" or nil: no page, and no parent link is sent.
	PageBase func() string
	// MaterialsDir is <the centre's folder>/materials (server/materials.ts); "" for a centre without Classes.
	MaterialsDir string
	// LastSnap is the runtime's last saved state (Runtime.KitState's snap), set by cmd/fees once the runtime is made: the page head's character reads the assistant's part of it
	// (agent_assistant.go publicCharacter). nil: no character.
	LastSnap func() *runtime.Snap
	// shared is the part of the settings every shop has (the assistant's character), kept for the assistant's views
	shared *runtime.Settings
	// Licence is the centre's licence now: "" in order, "paused", "stopped" (the runtime's LicenceNow, set once the runtime is made).
	Licence func() string
	// Report is the monthly report job (report.go), made once per process from runtime.json's `report` block; nil: the centre has none.
	Report *MonthlyReport
	// Terms is the shop terms now (B72: client/terms.json, read again when it changes, terms.NewReader); nil, or a nil answer: the feature is off.
	Terms func() *terms.File
	// links are the parents' links this process made (runtime.ts linkMemory, in memory only: the store keeps their hashes).
	links map[string]string
	given map[string]bool
}

var _ runtime.Kit = (*Kit)(nil)

func (k *Kit) now() int64 {
	if k.Now != nil {
		return k.Now()
	}
	return time.Now().UnixMilli()
}

func (k *Kit) licence() string {
	if k.Licence == nil {
		return ""
	}
	return k.Licence()
}

func (k *Kit) givenUp() map[string]bool {
	if k.given == nil {
		k.given = map[string]bool{}
	}
	return k.given
}

func (k *Kit) linkMemory() map[string]string {
	if k.links == nil {
		k.links = map[string]string{}
	}
	return k.links
}

func (k *Kit) Pathway() string   { return Pathway }
func (k *Kit) Version() string   { return Version }
func (k *Kit) CasesName() string { return "fees" }

// SigninMessaging is the centre's WhatsApp for the owner's sign-in link; nil when it has none.
func (k *Kit) SigninMessaging() messaging.Messaging { return k.Ports.WhatsApp }

var _ runtime.SigninKit = (*Kit)(nil)

// ReadSettings checks the settings the Fees way and fills the shared part.
func (k *Kit) ReadSettings(in map[string]any, raw []byte, shared *runtime.Settings) (any, []string) {
	s, errs := ReadSettings(in, raw)
	if len(errs) > 0 {
		return nil, errs
	}
	shared.Name, shared.Timezone, shared.Language = s.Name, s.Timezone, s.Languages
	shared.Owner.Whatsapp, shared.Owner.Language = s.Owner.Whatsapp, s.Owner.Language
	shared.ReadAssistant(in["assistant"])
	k.shared = shared
	return s, nil
}

// ParseState reads the store's members.
func (k *Kit) ParseState(ms []runtime.Member) (runtime.KitState, error) {
	s, err := ParseStore(ms)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func settingsOf(sh *runtime.Settings) *Settings { return sh.Own.(*Settings) }

// NewAgent is the agent over one step's state.
func (k *Kit) NewAgent(c *runtime.StepContext) runtime.Agent { return newAgent(k, c) }

// CountCases is runtime.ts countByState.
func (k *Kit) CountCases(st runtime.KitState) map[string]int {
	out := map[string]int{}
	for _, d := range st.(*Store).Dues {
		out[d.State]++
	}
	return out
}

// Refunds is core.ts countRefunds over the fees.
func (k *Kit) Refunds(st runtime.KitState) runtime.RefundCounts {
	c := runtime.NoRefunds()
	for _, d := range st.(*Store).Dues {
		for _, p := range d.Pending {
			switch p.PendingKind() {
			case "guard_hold":
				c.WaitingForOwner++
			case "refund_retry":
				c.BeingSentAgain++
			}
		}
		for _, i := range d.RefundIssues {
			c.NeedBuilder[i.Kind]++
			c.NeedBuilder["total"]++
		}
	}
	return c
}

var receiptFee = regexp.MustCompile(`^(f-\d+):`)

// RefundContext is runtime.ts refundContext: what the approvals relay may know of a HELD refund, found by its receipt ("f-3:pay_x"); the student, the batch and the month in the
// OWNER's language.
func (k *Kit) RefundContext(st runtime.KitState, sh *runtime.Settings, receipt string) any {
	s := settingsOf(sh)
	m := receiptFee.FindStringSubmatch(receipt)
	if m == nil {
		return nil
	}
	d := st.(*Store).Due(m[1])
	if d == nil {
		return nil
	}
	var hold *payments.GuardHold
	for _, p := range d.Pending {
		if h, ok := p.(*payments.GuardHold); ok && h.Receipt == receipt {
			hold = h
			break
		}
	}
	if hold == nil {
		return nil
	}
	lang := s.Owner.Language
	batch := d.BatchID
	if b := s.BatchByID(d.BatchID); b != nil {
		batch = BatchName(b, lang)
	}
	out := map[string]any{
		"booking": d.ID, "customerPhone": d.Customer, "businessName": s.Name, "timeZone": s.Timezone, "ownerLanguage": lang,
		"studentName": d.StudentName, "batchName": batch, "monthLabel": monthLabel(d.Month, lang),
		"paymentId": hold.PaymentID, "amountPaise": hold.AmountInr * 100, "approval": hold.Approval, "expiresAtMs": hold.ExpiresAtMs,
	}
	if hold.RequestedBy != nil {
		out["requestedBy"] = hold.RequestedBy
	}
	return out
}

// SkipCounters moves both id counters on (snapshot.ts skipCounters: nextDue and nextRequest are the store's count fields).
func (k *Kit) SkipCounters(st runtime.KitState, gap int64) {
	s := st.(*Store)
	s.NextDue += gap
	s.NextRequest += gap
}

// KeepCounters puts each counter at least where a thrown-away step's store had it.
func (k *Kit) KeepCounters(st runtime.KitState, taken runtime.KitState) bool {
	s, t := st.(*Store), taken.(*Store)
	moved := false
	if t.NextDue > s.NextDue {
		s.NextDue, moved = t.NextDue, true
	}
	if t.NextRequest > s.NextRequest {
		s.NextRequest, moved = t.NextRequest, true
	}
	return moved
}

// Channel is the centre's channel reads (channel.go).
func (k *Kit) Channel() runtime.ChannelKit { return &channelKit{kit: k} }

// MostRefundRupees is chat-limits.ts MOST_REFUND_RUPEES.
const MostRefundRupees = 5_000

// Limits is src/chat-limits.ts CHAT_LIMITS: the waiver limit (0 to the cheapest fee, at most ₹5,000) and the refund limit (0 to ₹5,000), both lower is tighter.
func (k *Kit) Limits() []runtime.LimitDecl {
	s := k.Settings
	if s == nil {
		return nil
	}
	cheapest := int64(MostRefundRupees)
	for _, b := range s.Batches {
		cheapest = min(cheapest, b.MonthlyFeeInr)
	}
	return []runtime.LimitDecl{
		{ID: "waiver_limit", Path: "waiver.limitInr", Unit: "inr", Tighter: "lower", Kind: "waiver", File: s.WaiverLimitInr, Min: 0, Max: cheapest},
		{ID: "refund_limit", Path: "refund.limitInr", Unit: "inr", Tighter: "lower", Kind: "refund", File: s.RefundLimitInr, Min: 0, Max: MostRefundRupees},
	}
}

// ChannelRaw is the saved state's `channel` member (runtime chatroutes.go ChannelStater).
func (k *Kit) ChannelRaw(st runtime.KitState) json.RawMessage {
	s := st.(*Store)
	if s.channel != nil {
		return s.channel.Marshal()
	}
	return s.Channel
}

// ---- the services -----------------------------------------------------------------------------------------------------------------------------------------------

// PortsOptions is what BuildPorts needs beside the folder.
type PortsOptions struct {
	Now    func() int64
	Window messaging.WindowStore
	Say    func(line string)
	// ReportTemplates are the monthly report's template names (approved in the stand-in too).
	ReportTemplates []string
}

func strOf(m map[string]any, k string) string { s, _ := m[k].(string); return s }

func optStr(m map[string]any, k string) *string {
	if s, ok := m[k].(string); ok {
		return &s
	}
	return nil
}

// agentToken is services.ts readAgentTokens for one service.
func agentToken(m map[string]any) (string, error) {
	file := strOf(m, "agentTokenFile")
	if file == "" {
		return "", nil
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return "", runtime.ClientError{Msg: fmt.Sprintf("I could not read the agent credential file %s (services.*.agentTokenFile).", file)}
	}
	t := strings.TrimSpace(string(b))
	if t == "" {
		return "", runtime.ClientError{Msg: fmt.Sprintf("The agent credential file %s is empty.", file)}
	}
	return t, nil
}

// BuildPorts is services.ts buildServices: the stand-ins in fakes mode (made once, so they keep what they were told while the process runs), the live clients in live mode.
func BuildPorts(cfg runtime.Config, s *Settings, o PortsOptions) (Ports, error) {
	var p Ports
	upi := s.OwnerMarked()
	p.Capabilities = razorpay.Capabilities
	if upi {
		p.Capabilities = payments.Capabilities{}
	}
	if cfg.Mode != "live" {
		if !upi {
			p.Payments = payments.NewFake(o.Now)
		}
		if _, has := cfg.Services["messaging"]; cfg.Services == nil || has {
			p.WhatsApp = messaging.NewStandIn(messaging.Clock(o.Now), append(TemplateNames(), o.ReportTemplates...), o.Say)
		}
		return p, nil
	}
	timeout := guard.DefaultTimeoutMs
	if t, ok := cfg.Services["timeoutMs"].(float64); ok {
		timeout = int(t)
	}
	if m, ok := cfg.Services["payments"].(map[string]any); ok && !upi {
		tok, err := agentToken(m)
		if err != nil {
			return p, err
		}
		c, err := razorpay.New(razorpay.Config{BaseURL: strOf(m, "baseUrl"), TimeoutMs: timeout, AgentToken: tok})
		if err != nil {
			return p, runtime.ClientError{Msg: err.Error()}
		}
		p.Payments = c
	}
	if m, ok := cfg.Services["messaging"].(map[string]any); ok {
		tok, err := agentToken(m)
		if err != nil {
			return p, err
		}
		c, err := messaging.NewLive(messaging.LiveConfig{BaseURL: strOf(m, "baseUrl"), PhoneNumberID: strOf(m, "phoneNumberId"), Provider: strOf(m, "provider"), AppID: optStr(m, "appId"),
			AppName: optStr(m, "appName"), SourceNumber: optStr(m, "sourceNumber"), AgentToken: tok, TimeoutMs: timeout}, messaging.Deps{Clock: messaging.Clock(o.Now), Window: o.Window})
		if err != nil {
			return p, runtime.ClientError{Msg: err.Error()}
		}
		p.WhatsApp = c
	}
	return p, nil
}
