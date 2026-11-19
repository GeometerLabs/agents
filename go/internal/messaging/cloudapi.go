// WhatsApp over the Cloud API's wire format, through a Guard: the Go twin of whatsapp.ts (Meta direct) and gupshup.ts (Gupshup's partner v3 pass-through, which takes Meta's own
// bodies). Deliberately thin and, like the TypeScript, keyless: the base URL is a Guard in front of the provider, so no token and no Authorization header of WhatsApp's goes out.
//
// Every request's bytes are the TypeScript's: the body is a struct whose fields are declared in the order of the TypeScript object literal, written by guard.JSText (JSON.stringify's
// bytes: no HTML escaping, U+2028 raw), and a member the TypeScript leaves undefined is left out. The paths are `/{version}/{phone-number-id}/messages` with the id through
// guard.EncodeURIComponent. Vectors (testdata/live-vectors.json) prove the bytes against the real TypeScript client.
//
// The 24-hour window is decided HERE, before anything is asked of WhatsApp: a text, buttons, document, image or sticker outside it is a WindowClosedError and nothing is sent; only a
// template may go outside it (and Meta's own refusal 131047, if it still comes back, is the same WindowClosedError).
package messaging

import (
	"context"
	"regexp"
	"strings"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
)

// GraphVersion is whatsapp.ts GRAPH_VERSION, the version in every path. One place to change it.
const GraphVersion = "v26.0"

const windowClosedCode = 131047 // Meta's code for "more than 24 hours since the customer last replied"
const keptMessages = 1000       // the local copy is for the read-back right after a send; it does not grow without end

// ErrorWords is a refusal in plain words and, when the provider gave one, its error code.
type ErrorWords struct {
	Message string
	Code    int64
	HasCode bool
}

// DescribeMetaError is whatsapp.ts describeMetaError: Meta's refusal in plain words, and its error code. `details ?? message ?? "WhatsApp answered N."` is `??`, so an EMPTY details or
// message is kept as the message (the TypeScript then raises an ApiError with no words).
func DescribeMetaError(r guard.Reply) ErrorWords {
	errObj, hasErr := guard.IsObject(guard.Get(r.Body, "error"))
	var details, msg string
	var hasDetails, hasMsg bool
	if hasErr {
		if data, ok := guard.IsObject(errObj["error_data"]); ok {
			details, hasDetails = guard.Str(data["details"])
		}
		msg, hasMsg = guard.Str(errObj["message"])
	}
	out := ErrorWords{}
	switch {
	case hasDetails:
		out.Message = details
	case hasMsg:
		out.Message = msg
	default:
		out.Message = "WhatsApp answered " + guard.Itoa(int64(r.Status)) + "."
	}
	if hasErr {
		// num(e?.code): any finite number. A whole number is all a code is (131047); a fractional one reads as absent here, and is never 131047 either way.
		out.Code, out.HasCode = guard.Int(errObj["code"])
	}
	return out
}

// Wire is whatsapp.ts CloudApiWire: what differs between Meta direct and a provider that takes Meta's own bodies.
type Wire struct {
	// Name is the service's name in errors: "WhatsApp", "Gupshup".
	Name     string
	SendPath string
	// PingPath is a read that reaches this service's Guard and changes nothing.
	PingPath      string
	DescribeError func(guard.Reply) ErrorWords
	// StickerByLink: does this service document a sticker sent by link? Meta does; Gupshup's partner pass-through does not, so its client offers no sticker.
	StickerByLink bool
}

var spaceRun = regexp.MustCompile(`[` + language.JSSpace + `]+`)

// CleanParameter is whatsapp.ts cleanParameter: `value.replace(/\s+/gu, " ").trim()` with JavaScript's `\s`.
func CleanParameter(v string) string { return language.TrimJS(spaceRun.ReplaceAllString(v, " ")) }

// ---- the wire bodies, fields in the TypeScript literal's order -----------------------------------------------------------------

type head struct {
	MessagingProduct string `json:"messaging_product"`
	RecipientType    string `json:"recipient_type"`
	To               string `json:"to"`
	Type             string `json:"type"`
}

func newHead(to, typ string) head { return head{"whatsapp", "individual", to, typ} }

type textPart struct {
	Body       string `json:"body"`
	PreviewURL bool   `json:"preview_url"`
}

type textBody struct {
	head
	Text textPart `json:"text"`
}

type langCode struct {
	Code *string `json:"code,omitempty"`
}

type headerImage struct {
	Link string `json:"link"`
}

type imageParam struct {
	Type  string      `json:"type"`
	Image headerImage `json:"image"`
}

type textParam struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type component struct {
	Type       string `json:"type"`
	Parameters []any  `json:"parameters"`
}

type templatePart struct {
	Name       string      `json:"name"`
	Language   langCode    `json:"language"`
	Components []component `json:"components,omitempty"`
}

type templateBodyT struct {
	head
	Template templatePart `json:"template"`
}

// TemplateBody is whatsapp.ts templateBody: the wire body for a template message (an image header first when the template has one, then the body's parameters, cleaned).
func TemplateBody(to string, t TemplateMessage) any {
	var comps []component
	if t.HeaderImage != nil && *t.HeaderImage != "" {
		comps = append(comps, component{Type: "header", Parameters: []any{imageParam{Type: "image", Image: headerImage{Link: *t.HeaderImage}}}})
	}
	if len(t.Parameters) > 0 {
		ps := make([]any, len(t.Parameters))
		for i, p := range t.Parameters {
			ps[i] = textParam{Type: "text", Text: CleanParameter(p)}
		}
		comps = append(comps, component{Type: "body", Parameters: ps})
	}
	var code *string
	if c, ok := metaLanguage(t.Language); ok {
		code = &c
	}
	return templateBodyT{newHead(to, "template"), templatePart{Name: t.Name, Language: langCode{Code: code}, Components: comps}}
}

type replyPart struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type replyButton struct {
	Type  string    `json:"type"`
	Reply replyPart `json:"reply"`
}

type buttonsAction struct {
	Buttons []replyButton `json:"buttons"`
}

type listRow struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

type listSection struct {
	Rows []listRow `json:"rows"`
}

type listAction struct {
	Button   string        `json:"button"`
	Sections []listSection `json:"sections"`
}

type bodyText struct {
	Text string `json:"text"`
}

type interactivePart struct {
	Type   string   `json:"type"`
	Body   bodyText `json:"body"`
	Action any      `json:"action"`
}

type interactiveBodyT struct {
	head
	Interactive interactivePart `json:"interactive"`
}

// InteractiveBody is whatsapp.ts interactiveBody: reply buttons or a list. A row's description goes only when it is truthy (not "").
func InteractiveBody(to string, m InteractiveMessage) any {
	var action any
	typ := "list"
	if m.Buttons != nil {
		typ = "button"
		bs := make([]replyButton, len(m.Buttons))
		for i, b := range m.Buttons {
			bs[i] = replyButton{Type: "reply", Reply: replyPart{ID: b.ID, Title: b.Title}}
		}
		action = buttonsAction{bs}
	} else {
		rows := make([]listRow, len(m.List.Rows))
		for i, r := range m.List.Rows {
			rows[i] = listRow{ID: r.ID, Title: r.Title}
			if r.Description != nil {
				rows[i].Description = *r.Description // omitempty drops "" exactly as `r.description ? ... : {}` does
			}
		}
		action = listAction{Button: m.List.Button, Sections: []listSection{{rows}}}
	}
	return interactiveBodyT{newHead(to, "interactive"), interactivePart{Type: typ, Body: bodyText{m.Body}, Action: action}}
}

type documentPart struct {
	Link     string `json:"link"`
	Filename string `json:"filename"`
	Caption  string `json:"caption,omitempty"`
}

type documentBodyT struct {
	head
	Document documentPart `json:"document"`
}

// DocumentBody is whatsapp.ts documentBody. The caption goes only when truthy.
func DocumentBody(to string, d DocumentMessage) any {
	p := documentPart{Link: d.Link, Filename: d.Filename}
	if d.Caption != nil {
		p.Caption = *d.Caption
	}
	return documentBodyT{newHead(to, "document"), p}
}

type imagePart struct {
	Link    string `json:"link"`
	Caption string `json:"caption,omitempty"`
}

type imageBodyT struct {
	head
	Image imagePart `json:"image"`
}

// ImageBody is whatsapp.ts imageBody.
func ImageBody(to string, i ImageMessage) any {
	p := imagePart{Link: i.Link}
	if i.Caption != nil {
		p.Caption = *i.Caption
	}
	return imageBodyT{newHead(to, "image"), p}
}

type stickerPart struct {
	Link string `json:"link"`
}

type stickerBodyT struct {
	head
	Sticker stickerPart `json:"sticker"`
}

// StickerBody is whatsapp.ts stickerBody.
func StickerBody(to string, s StickerMessage) any {
	return stickerBodyT{newHead(to, "sticker"), stickerPart{s.Link}}
}

// ---- the client -------------------------------------------------------------------------------------------------------------------

// keptSent is the JavaScript Map `sent`: insertion-ordered, a repeated key keeps its first place, and past 1000 the oldest is dropped.
type keptSent struct {
	mu    sync.Mutex
	order []string
	byID  map[string]OutboundMessage
}

func newKept() *keptSent { return &keptSent{byID: map[string]OutboundMessage{}} }

func (k *keptSent) set(id string, m OutboundMessage) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if _, ok := k.byID[id]; !ok {
		k.order = append(k.order, id)
	}
	k.byID[id] = m
	if len(k.order) > keptMessages {
		delete(k.byID, k.order[0])
		k.order = k.order[1:]
	}
}

func (k *keptSent) get(id string) *OutboundMessage {
	k.mu.Lock()
	defer k.mu.Unlock()
	if m, ok := k.byID[id]; ok {
		c := m
		return &c
	}
	return nil
}

func windowOpen(d Deps, to string) bool {
	last, ok := d.Window.LastInboundAt(to)
	return ok && d.Clock()-last < 24*Hour
}

// CloudAPI is the Messaging over Meta's Cloud API bodies sent to wire.SendPath (whatsapp.ts createCloudApiMessaging). It implements Messaging, Interactive, Documents, Images and
// Pinger; WithSticker adds Stickers where the service documents one by link.
type CloudAPI struct {
	http guard.Http
	wire Wire
	deps Deps
	sent *keptSent
}

// StickerCloudAPI is a CloudAPI that also sends stickers (Meta direct). A separate type so that Gupshup's partner client does NOT satisfy Stickers, as in the TypeScript.
type StickerCloudAPI struct{ *CloudAPI }

// NewCloudAPI is createCloudApiMessaging: `http` is a Guard in front of the provider and carries only the agent's credential for that Guard.
func NewCloudAPI(http guard.Http, wire Wire, deps Deps) Messaging {
	c := &CloudAPI{http: http, wire: wire, deps: deps, sent: newKept()}
	if wire.StickerByLink {
		return &StickerCloudAPI{c}
	}
	return c
}

// MetaConfig is WhatsAppConfig.
type MetaConfig struct {
	BaseURL       string
	PhoneNumberID string
	TimeoutMs     int
	AgentToken    string
}

// NewMeta is createWhatsAppMessaging: Meta's Cloud API, direct (or through Meta's own test number), the default provider.
func NewMeta(cfg MetaConfig, deps Deps) (Messaging, error) {
	h, err := guard.New(cfg.BaseURL, "WhatsApp", cfg.TimeoutMs, cfg.AgentToken)
	if err != nil {
		return nil, err
	}
	number := "/" + GraphVersion + "/" + guard.EncodeURIComponent(cfg.PhoneNumberID)
	return NewCloudAPI(h, Wire{Name: "WhatsApp", SendPath: number + "/messages", PingPath: number, DescribeError: DescribeMetaError, StickerByLink: true}, deps), nil
}

// send posts a body and keeps what the provider accepted.
func (c *CloudAPI) send(ctx context.Context, body any, copy OutboundMessage) (OutboundMessage, error) {
	reply, err := c.http.Request(ctx, "POST", c.wire.SendPath, guard.Options{Body: body})
	if err != nil {
		return OutboundMessage{}, err
	}
	if reply.Status < 200 || reply.Status >= 300 {
		w := c.wire.DescribeError(reply)
		if w.HasCode && w.Code == windowClosedCode {
			return OutboundMessage{}, &guard.WindowClosedError{}
		}
		return OutboundMessage{}, &guard.ApiError{Status: reply.Status, Message: w.Message}
	}
	// the first of `messages` that is an object (asArray(...).find(isObject)); its id must be a non-empty string
	var first guard.Object
	if o, ok := guard.IsObject(reply.Body); ok {
		for _, m := range guard.AsArray(o["messages"]) {
			if mo, ok := guard.IsObject(m); ok {
				first = mo
				break
			}
		}
	}
	id, _ := guard.Str(first["id"])
	if id == "" {
		return OutboundMessage{}, &guard.ApiError{Status: 502, Message: c.wire.Name + " accepted the call but gave no message id."}
	}
	acceptedAs := "accepted"
	if s, ok := guard.Str(first["message_status"]); ok {
		acceptedAs = s // `??`: "" is kept
	}
	if acceptedAs == "paused" {
		return OutboundMessage{}, &guard.ApiError{Status: 503, Message: c.wire.Name + " has paused sending, so the message will not go out."}
	}
	// SentAt is when we handed it over. AfterOptOut is not knowable here: the agent's own STOP gate is the guard.
	m := copy
	m.ID, m.SentAt, m.AfterOptOut, m.AcceptedAs = id, c.deps.Clock(), false, &acceptedAs
	c.sent.set(id, m)
	return m, nil
}

func (c *CloudAPI) open(to string) bool { return windowOpen(c.deps, to) }

// SendText: the window first (WhatsApp would refuse with 131047; no need to ask), then the text body.
func (c *CloudAPI) SendText(ctx context.Context, to, text string) (OutboundMessage, error) {
	if !c.open(to) {
		return OutboundMessage{}, &guard.WindowClosedError{}
	}
	return c.send(ctx, textBody{newHead(to, "text"), textPart{Body: text, PreviewURL: false}}, OutboundMessage{To: to, Kind: "text", Text: text})
}

// SendInteractive: like free text only inside the window; a message that breaks Meta's limits is an ApiError 400 and never sent (the agent sends the same words as plain text).
func (c *CloudAPI) SendInteractive(ctx context.Context, to string, m InteractiveMessage) (OutboundMessage, error) {
	if !c.open(to) {
		return OutboundMessage{}, &guard.WindowClosedError{}
	}
	if p := InteractiveProblem(m); p != "" {
		return OutboundMessage{}, guard.Apif(400, "The message cannot be sent as buttons or a list: %s.", p)
	}
	cp := m
	return c.send(ctx, InteractiveBody(to, m), OutboundMessage{To: to, Kind: "interactive", Text: InteractiveText(m), Interactive: &cp})
}

// SendDocument: a session message too (131047 otherwise).
func (c *CloudAPI) SendDocument(ctx context.Context, to string, d DocumentMessage) (OutboundMessage, error) {
	if !c.open(to) {
		return OutboundMessage{}, &guard.WindowClosedError{}
	}
	if p := DocumentProblem(d); p != "" {
		return OutboundMessage{}, guard.Apif(400, "The document cannot be sent: %s.", p)
	}
	text := d.Filename
	if d.Caption != nil {
		text = *d.Caption
	}
	cp := d
	return c.send(ctx, DocumentBody(to, d), OutboundMessage{To: to, Kind: "document", Text: text, Document: &cp})
}

// SendImage: a session message too.
func (c *CloudAPI) SendImage(ctx context.Context, to string, i ImageMessage) (OutboundMessage, error) {
	if !c.open(to) {
		return OutboundMessage{}, &guard.WindowClosedError{}
	}
	if p := ImageProblem(i); p != "" {
		return OutboundMessage{}, guard.Apif(400, "The image cannot be sent: %s.", p)
	}
	text := ""
	if i.Caption != nil {
		text = *i.Caption
	}
	cp := i
	return c.send(ctx, ImageBody(to, i), OutboundMessage{To: to, Kind: "image", Text: text, Image: &cp})
}

// SendSticker (Meta direct only): a service message, only inside the window.
func (c *StickerCloudAPI) SendSticker(ctx context.Context, to string, s StickerMessage) (OutboundMessage, error) {
	if !c.open(to) {
		return OutboundMessage{}, &guard.WindowClosedError{}
	}
	if p := StickerProblem(s); p != "" {
		return OutboundMessage{}, guard.Apif(400, "The sticker cannot be sent: %s.", p)
	}
	cp := s
	return c.send(ctx, StickerBody(to, s), OutboundMessage{To: to, Kind: "sticker", Text: "", Sticker: &cp})
}

// templateHeaderProblem is the check both clients make first: a header picture, when given at all (even ""), must be an https link.
func templateHeaderProblem(t TemplateMessage) error {
	if t.HeaderImage != nil && ImageProblem(ImageMessage{Link: *t.HeaderImage}) != "" {
		return &guard.ApiError{Status: 400, Message: "The template's header picture must be an https link."}
	}
	return nil
}

// SendTemplate may go outside the window: it is the only message that may.
func (c *CloudAPI) SendTemplate(ctx context.Context, to string, t TemplateMessage) (OutboundMessage, error) {
	if err := templateHeaderProblem(t); err != nil {
		return OutboundMessage{}, err
	}
	m := OutboundMessage{To: to, Kind: "template", Text: t.Text, TemplateName: t.Name, Language: t.Language}
	if t.HeaderImage != nil && *t.HeaderImage != "" {
		m.HeaderImage = *t.HeaderImage
	}
	return c.send(ctx, TemplateBody(to, t), m)
}

// IsWindowOpen is the runtime's own knowledge, never asked of WhatsApp.
func (c *CloudAPI) IsWindowOpen(_ context.Context, to string) (bool, error) { return c.open(to), nil }

// Ping is a cheap read that reaches this service's Guard (guard-wait.ts asks whether it is back).
func (c *CloudAPI) Ping(ctx context.Context) (guard.Reply, error) {
	return c.http.Request(ctx, "GET", c.wire.PingPath, guard.Options{})
}

// GetMessage is not a read from WhatsApp (there is none): the copy of what the send call accepted. Nil after a restart.
func (c *CloudAPI) GetMessage(_ context.Context, id string) (*OutboundMessage, error) {
	return c.sent.get(id), nil
}

// ---- Gupshup's partner pass-through (gupshup.ts) ---------------------------------------------------------------------------------

// Gupshup partner routes: `{app_id}` is where the shop's app id goes (the shapes Guard's spec lists).
const (
	GupshupUpstream = "partner.gupshup.io:443"
	gupshupSend     = "/partner/app/{app_id}/v3/message"
	gupshupRead     = "/partner/app/{app_id}/health"
)

// GupshupAppID is gupshup.ts GUPSHUP_APP_ID: Gupshup writes them as UUIDs; anything that could change the path is refused.
var GupshupAppID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{7,63}$`)

// GupshupConfig is GupshupConfig.
type GupshupConfig struct {
	BaseURL    string
	AppID      string
	TimeoutMs  int
	AgentToken string
}

// DescribeGupshupError is gupshup.ts describeGupshupError: Gupshup's own errors are { status: "error", message }; an error Meta gave and Gupshup passed on keeps Meta's shape and its
// code (131047 still means the window is closed). `message ? ... : ...` is truthiness: an empty message reads as none.
func DescribeGupshupError(r guard.Reply) ErrorWords {
	if _, ok := guard.IsObject(guard.Get(r.Body, "error")); ok {
		return DescribeMetaError(r)
	}
	msg, _ := guard.Str(guard.Get(r.Body, "message"))
	out := ErrorWords{Message: "Gupshup answered " + guard.Itoa(int64(r.Status)) + "."}
	if msg != "" {
		out.Message = "Gupshup: " + msg
	}
	if _, ok := guard.IsObject(r.Body); ok {
		out.Code, out.HasCode = guard.Int(guard.Get(r.Body, "code"))
	}
	return out
}

func gupshupPath(route, appID string) string {
	return strings.Replace(route, "{app_id}", guard.EncodeURIComponent(appID), 1)
}

// NewGupshup is createGupshupMessaging: WhatsApp through Gupshup's v3 pass-through, Meta's bodies to /partner/app/{appId}/v3/message. It has no SendSticker.
func NewGupshup(cfg GupshupConfig, deps Deps) (Messaging, error) {
	if !GupshupAppID.MatchString(cfg.AppID) {
		return nil, errPlain("The Gupshup app id must be the app's id as Gupshup shows it (letters, digits and hyphens).")
	}
	h, err := guard.New(cfg.BaseURL, "Gupshup", cfg.TimeoutMs, cfg.AgentToken)
	if err != nil {
		return nil, err
	}
	return NewCloudAPI(h, Wire{Name: "Gupshup", SendPath: gupshupPath(gupshupSend, cfg.AppID), PingPath: gupshupPath(gupshupRead, cfg.AppID), DescribeError: DescribeGupshupError}, deps), nil
}

// errPlain is a plain Error (what TypeScript `throw new Error(words)` is): not an ApiError, no status.
type errPlain string

func (e errPlain) Error() string { return string(e) }
