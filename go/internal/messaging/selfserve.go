// WhatsApp through Gupshup's SELF-SERVE API (gupshup-selfserve.ts, item 11c): the route for pilot shops, each Gupshup's own customer with its own app and key. Not Meta's bodies:
// every message type is MAPPED to Gupshup's form-urlencoded send (`POST /wa/api/v1/msg`, fields channel, source, destination, src.name, message) and a template to
// `POST /wa/api/v1/template/msg` by GUPSHUP'S OWN template id, found in the app's template list (refreshed at most every 30 seconds).
//
// No key is held or sent: the base URL is a Guard in front of api.gupshup.io, which adds the `apikey` header itself. Every form's field ORDER and every embedded JSON string's bytes are
// the TypeScript's (the `message` field is JSON.stringify of an object, here guard.JSText of a struct in the same member order); vectors prove them.
//
// JavaScript behaviour copied: the template list is a Map (the first key starting `name:lang_` wins, a repeated key keeps its first place), a status is `toUpperCase()`d with full Unicode
// case mapping (golang.org/x/text/cases, not strings.ToUpper: "ß" becomes "SS"), `\D` is ASCII, and `msgid` is `Date-in-base-36 - counter-in-base-36`.
package messaging

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/text/cases"
	xlang "golang.org/x/text/language"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// Self-serve upstream, header and routes (the shapes Guard's spec lists: `{app_name}` / `{app_id}` are filled in here).
const (
	GupshupSelfServeUpstream = "api.gupshup.io:443"
	GupshupAPIKeyHeader      = "apikey"
	ssSend                   = "/wa/api/v1/msg"
	ssTemplate               = "/wa/api/v1/template/msg"
	ssListByName             = "/sm/api/v1/template/list/{app_name}"
	ssListByID               = "/wa/app/{app_id}/template"
)

// The checks on a self-serve config.
var (
	GupshupAppName        = regexp.MustCompile(`^[A-Za-z0-9_]{2,64}$`)
	GupshupSelfServeAppID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{7,63}$`)
	GupshupSourceNumber   = regexp.MustCompile(`^\+?\d{6,15}$`)
	nonDigits             = regexp.MustCompile(`[^0-9]`)
)

// SelfServeConfig is GupshupSelfServeConfig. AppID is optional (the newer template list); "" is "left out".
type SelfServeConfig struct {
	BaseURL      string
	AppName      string
	SourceNumber string
	AppID        string
	TimeoutMs    int
	AgentToken   string
}

// TemplateListPath is the path of the template list: by id when runtime.json gives one, else by name.
func TemplateListPath(appName, appID string) string {
	if appID != "" {
		return strings.Replace(ssListByID, "{app_id}", guard.EncodeURIComponent(appID), 1)
	}
	return strings.Replace(ssListByName, "{app_name}", guard.EncodeURIComponent(appName), 1)
}

// DescribeSelfServeError is describeSelfServeError: `{ status: "error", message }`; an empty message reads as none (truthiness).
func DescribeSelfServeError(r guard.Reply) string {
	msg, _ := guard.Str(guard.Get(r.Body, "message"))
	if msg != "" {
		return "Gupshup: " + msg
	}
	return "Gupshup answered " + guard.Itoa(int64(r.Status)) + "."
}

// ---- the forms ----------------------------------------------------------------------------------------------------------------------

type ssTarget struct{ AppName, SourceNumber string }

// form is the common start of every send; `extra` carries `message` (a JSON string by type) or `template`.
func form(c ssTarget, to string, extra ...guard.Param) []guard.Param {
	ps := []guard.Param{{Key: "channel", Value: "whatsapp"}, {Key: "source", Value: nonDigits.ReplaceAllString(c.SourceNumber, "")}, {Key: "destination", Value: nonDigits.ReplaceAllString(to, "")}, {Key: "src.name", Value: c.AppName}}
	return append(ps, extra...)
}

func msg(v any) guard.Param { return guard.Param{Key: "message", Value: guard.MustJSText(v)} }

type ssText struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// TextForm is textForm.
func TextForm(c ssTarget, to, text string) []guard.Param {
	return form(c, to, msg(ssText{"text", text}))
}

type ssFile struct {
	Type     string `json:"type"`
	URL      string `json:"url"`
	Filename string `json:"filename"`
	Caption  string `json:"caption,omitempty"`
}

// DocumentForm is documentForm: type "file"; the caption goes only when truthy.
func DocumentForm(c ssTarget, to string, d DocumentMessage) []guard.Param {
	f := ssFile{Type: "file", URL: d.Link, Filename: d.Filename}
	if d.Caption != nil {
		f.Caption = *d.Caption
	}
	return form(c, to, msg(f))
}

type ssImage struct {
	Type        string `json:"type"`
	OriginalURL string `json:"originalUrl"`
	PreviewURL  string `json:"previewUrl"`
	Caption     string `json:"caption,omitempty"`
}

// ImageForm is imageForm.
func ImageForm(c ssTarget, to string, i ImageMessage) []guard.Param {
	f := ssImage{Type: "image", OriginalURL: i.Link, PreviewURL: i.Link}
	if i.Caption != nil {
		f.Caption = *i.Caption
	}
	return form(c, to, msg(f))
}

type ssContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type ssOption struct {
	Title        string `json:"title"`
	PostbackText string `json:"postbackText"`
}

type ssQuickReply struct {
	Type    string     `json:"type"`
	MsgID   string     `json:"msgid"`
	Content ssContent  `json:"content"`
	Options []ssOption `json:"options"`
}

type ssButton struct {
	Type  string `json:"type"`
	Title string `json:"title"`
}

type ssListOption struct {
	Type         string `json:"type"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	PostbackText string `json:"postbackText"`
}

type ssItem struct {
	Options []ssListOption `json:"options"`
}

type ssList struct {
	Type          string     `json:"type"`
	Title         string     `json:"title"`
	Body          string     `json:"body"`
	MsgID         string     `json:"msgid"`
	GlobalButtons []ssButton `json:"globalButtons"`
	Items         []ssItem   `json:"items"`
}

// InteractiveForm is interactiveForm: buttons become a quick_reply, a list becomes a list message. The id we gave each option travels as `postbackText`. The list's required header is
// the list's button label, and a row without a description repeats its title (`r.description ?? r.title`: only a MISSING description, not "").
func InteractiveForm(c ssTarget, to string, m InteractiveMessage, msgid string) []guard.Param {
	if m.Buttons != nil {
		opts := make([]ssOption, len(m.Buttons))
		for i, b := range m.Buttons {
			opts[i] = ssOption{Title: b.Title, PostbackText: b.ID}
		}
		return form(c, to, msg(ssQuickReply{Type: "quick_reply", MsgID: msgid, Content: ssContent{"text", m.Body}, Options: opts}))
	}
	rows := make([]ssListOption, len(m.List.Rows))
	for i, r := range m.List.Rows {
		d := r.Title
		if r.Description != nil {
			d = *r.Description
		}
		rows[i] = ssListOption{Type: "text", Title: r.Title, Description: d, PostbackText: r.ID}
	}
	return form(c, to, msg(ssList{Type: "list", Title: m.List.Button, Body: m.Body, MsgID: msgid, GlobalButtons: []ssButton{{"text", m.List.Button}}, Items: []ssItem{{rows}}}))
}

type ssTemplateRef struct {
	ID     string   `json:"id"`
	Params []string `json:"params"`
}

type ssHeaderMsg struct {
	Type  string      `json:"type"`
	Image headerImage `json:"image"`
}

// TemplateForm is templateForm: Gupshup's own template id and the cleaned parameters; an image header adds `message`.
func TemplateForm(c ssTarget, to, id string, parameters []string, headerImg string) []guard.Param {
	ps := make([]string, len(parameters))
	for i, p := range parameters {
		ps[i] = CleanParameter(p)
	}
	extra := []guard.Param{{Key: "template", Value: guard.MustJSText(ssTemplateRef{ID: id, Params: ps})}}
	if headerImg != "" {
		extra = append(extra, msg(ssHeaderMsg{"image", headerImage{headerImg}}))
	}
	return form(c, to, extra...)
}

type ssSticker struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

// StickerForm is stickerForm.
func StickerForm(c ssTarget, to string, s StickerMessage) []guard.Param {
	return form(c, to, msg(ssSticker{"sticker", s.Link}))
}

// ---- Gupshup's own template ids -----------------------------------------------------------------------------------------------------

type listedTemplate struct{ id, status string }

// templateList is the JavaScript Map of `<name>:<language code>` to template, in insertion order.
type templateList struct {
	keys []string
	by   map[string]listedTemplate
}

func (l *templateList) set(k string, t listedTemplate) {
	if _, ok := l.by[k]; !ok {
		l.keys = append(l.keys, k)
	}
	l.by[k] = t
}

// readTemplateList is readTemplateList: the templates in a list reply. A template needs a non-empty id, elementName and languageCode; the status is upper-cased (JavaScript's
// toUpperCase, full case mapping) and "UNKNOWN" when missing.
func readTemplateList(body any) *templateList {
	out := &templateList{by: map[string]listedTemplate{}}
	o, ok := guard.IsObject(body)
	if !ok {
		return out
	}
	for _, e := range guard.AsArray(o["templates"]) {
		t, ok := guard.IsObject(e)
		if !ok {
			continue
		}
		id, _ := guard.Str(t["id"])
		name, _ := guard.Str(t["elementName"])
		lang, _ := guard.Str(t["languageCode"])
		status, has := guard.Str(t["status"])
		if !has {
			status = "UNKNOWN"
		}
		if id != "" && name != "" && lang != "" {
			out.set(name+":"+lang, listedTemplate{id, toUpper(status)})
		}
	}
	return out
}

// toUpper and toLower are JavaScript's toUpperCase and toLowerCase (full, locale-free case mapping: "ß" is "SS"); a Caser keeps state, so each call makes its own.
func toUpper(s string) string { return cases.Upper(xlang.Und).String(s) }
func toLower(s string) string { return cases.Lower(xlang.Und).String(s) }

// refreshGapMs is how long a refresh waits after the last one, so a name that is simply not there does not hit Gupshup on every send.
const refreshGapMs = 30_000

// SelfServe is the Messaging over Gupshup's self-serve API. It implements Messaging, Interactive, Documents, Images, Stickers and Pinger.
type SelfServe struct {
	cfg      SelfServeConfig
	http     guard.Http
	deps     Deps
	listPath string
	sent     *keptSent

	mu          sync.Mutex // the template list, its refresh time and the msgid counter
	templates   *templateList
	refreshedAt *int64
	sequence    int64
}

// NewSelfServe is createGupshupSelfServeMessaging. The checks come first, in the TypeScript's order, then the base URL's.
func NewSelfServe(cfg SelfServeConfig, deps Deps) (*SelfServe, error) {
	if !GupshupAppName.MatchString(cfg.AppName) {
		return nil, errPlain("The Gupshup app name must be the app's name as Gupshup shows it (letters, digits and underscores).")
	}
	if !GupshupSourceNumber.MatchString(cfg.SourceNumber) {
		return nil, errPlain("The Gupshup source number must be the app's WhatsApp number with its country code (digits only).")
	}
	if cfg.AppID != "" && !GupshupSelfServeAppID.MatchString(cfg.AppID) {
		return nil, errPlain("The Gupshup app id must be the app's id as Gupshup shows it (letters, digits and hyphens).")
	}
	h, err := guard.New(cfg.BaseURL, "Gupshup", cfg.TimeoutMs, cfg.AgentToken)
	if err != nil {
		return nil, err
	}
	return NewSelfServeOver(h, cfg, deps), nil
}

// NewSelfServeOver is the client over any guard.Http (a test's stand-in); the config is not checked again.
func NewSelfServeOver(h guard.Http, cfg SelfServeConfig, deps Deps) *SelfServe {
	return &SelfServe{cfg: cfg, http: h, deps: deps, listPath: TemplateListPath(cfg.AppName, cfg.AppID), sent: newKept(), templates: &templateList{by: map[string]listedTemplate{}}}
}

func (s *SelfServe) target() ssTarget { return ssTarget{s.cfg.AppName, s.cfg.SourceNumber} }

// post is one send: Gupshup answers 2xx "submitted" with messageId; anything else is a refusal. "submitted" is Gupshup having taken it; delivery arrives later as a message-event.
func (s *SelfServe) post(ctx context.Context, path string, fields []guard.Param, copy OutboundMessage) (OutboundMessage, error) {
	reply, err := s.http.Request(ctx, "POST", path, guard.Options{Form: fields})
	if err != nil {
		return OutboundMessage{}, err
	}
	if reply.Status < 200 || reply.Status >= 300 {
		return OutboundMessage{}, &guard.ApiError{Status: reply.Status, Message: DescribeSelfServeError(reply)}
	}
	b, ok := guard.IsObject(reply.Body)
	if !ok {
		b = guard.Object{}
	}
	if st, ok := b["status"].(string); ok && st == "error" {
		return OutboundMessage{}, &guard.ApiError{Status: 400, Message: DescribeSelfServeError(reply)}
	}
	id, _ := guard.Str(b["messageId"])
	if id == "" {
		return OutboundMessage{}, &guard.ApiError{Status: 502, Message: "Gupshup accepted the call but gave no message id."}
	}
	accepted := "accepted"
	m := copy
	m.ID, m.SentAt, m.AfterOptOut, m.AcceptedAs = id, s.deps.Clock(), false, &accepted
	s.sent.set(id, m)
	return m, nil
}

// refresh fetches the app's template list through the Guard and keeps it. A refusal here is the shop's key or app being wrong, said in plain words.
func (s *SelfServe) refresh(ctx context.Context) error {
	o := guard.Options{}
	if s.cfg.AppID != "" {
		o.Query = []guard.Param{{Key: "pageSize", Value: "100"}}
	}
	reply, err := s.http.Request(ctx, "GET", s.listPath, o)
	if err != nil {
		return err
	}
	if reply.Status < 200 || reply.Status >= 300 {
		return &guard.ApiError{Status: reply.Status, Message: "Could not read the templates of the Gupshup app " + s.cfg.AppName + ". " + DescribeSelfServeError(reply)}
	}
	list := readTemplateList(reply.Body)
	now := s.deps.Clock()
	s.mu.Lock()
	s.templates, s.refreshedAt = list, &now
	s.mu.Unlock()
	return nil
}

// find is the cached `templates.get(name:lang) ?? first key starting name:lang_`.
func (s *SelfServe) find(name, lang string) (listedTemplate, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.templates.by[name+":"+lang]; ok {
		return t, true
	}
	prefix := name + ":" + lang + "_"
	for _, k := range s.templates.keys {
		if strings.HasPrefix(k, prefix) {
			return s.templates.by[k], true
		}
	}
	return listedTemplate{}, false
}

// templateID is Gupshup's template id for one of our templates, from the cached list, refreshed when the name is unknown or not approved yet (at most every 30 seconds).
func (s *SelfServe) templateID(ctx context.Context, t TemplateMessage) (string, error) {
	lang, ok := metaLanguage(t.Language)
	if !ok {
		lang = "undefined" // META_LANGUAGE[unknown] is undefined, which the TypeScript's template string writes as "undefined"
	}
	found, has := s.find(t.Name, lang)
	if !has || found.status != "APPROVED" {
		s.mu.Lock()
		due := s.refreshedAt == nil || s.deps.Clock()-*s.refreshedAt >= refreshGapMs
		s.mu.Unlock()
		if due {
			if err := s.refresh(ctx); err != nil {
				return "", err
			}
			found, has = s.find(t.Name, lang)
		}
	}
	if !has {
		return "", guard.Apif(400, "The template %s (%s) is not in the Gupshup app %s: it has to be added to the app and approved there before it can be sent.", t.Name, t.Language, s.cfg.AppName)
	}
	if found.status != "APPROVED" {
		return "", guard.Apif(400, "The template %s (%s) is not approved yet in the Gupshup app %s (its status there is %s).", t.Name, t.Language, s.cfg.AppName, toLower(found.status))
	}
	return found.id, nil
}

// msgid is the id Gupshup asks for on list and button messages: unique within this process, plain characters only (`geo-<now in base 36>-<counter in base 36>`). The counter moves
// only when a message gets as far as building its form.
func (s *SelfServe) msgid() string {
	s.mu.Lock()
	n := s.sequence
	s.sequence++
	s.mu.Unlock()
	return "geo-" + strconv.FormatInt(s.deps.Clock(), 36) + "-" + strconv.FormatInt(n, 36)
}

func (s *SelfServe) open(to string) bool { return windowOpen(s.deps, to) }

// SendText: Gupshup would take it and fail it later (131047); no need to ask.
func (s *SelfServe) SendText(ctx context.Context, to, text string) (OutboundMessage, error) {
	if !s.open(to) {
		return OutboundMessage{}, &guard.WindowClosedError{}
	}
	return s.post(ctx, ssSend, TextForm(s.target(), to, text), OutboundMessage{To: to, Kind: "text", Text: text})
}

// SendInteractive: buttons or a list inside the window, within Meta's limits.
func (s *SelfServe) SendInteractive(ctx context.Context, to string, m InteractiveMessage) (OutboundMessage, error) {
	if !s.open(to) {
		return OutboundMessage{}, &guard.WindowClosedError{}
	}
	if p := InteractiveProblem(m); p != "" {
		return OutboundMessage{}, guard.Apif(400, "The message cannot be sent as buttons or a list: %s.", p)
	}
	cp := m
	return s.post(ctx, ssSend, InteractiveForm(s.target(), to, m, s.msgid()), OutboundMessage{To: to, Kind: "interactive", Text: InteractiveText(m), Interactive: &cp})
}

// SendDocument is a session message.
func (s *SelfServe) SendDocument(ctx context.Context, to string, d DocumentMessage) (OutboundMessage, error) {
	if !s.open(to) {
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
	return s.post(ctx, ssSend, DocumentForm(s.target(), to, d), OutboundMessage{To: to, Kind: "document", Text: text, Document: &cp})
}

// SendImage is a session message.
func (s *SelfServe) SendImage(ctx context.Context, to string, i ImageMessage) (OutboundMessage, error) {
	if !s.open(to) {
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
	return s.post(ctx, ssSend, ImageForm(s.target(), to, i), OutboundMessage{To: to, Kind: "image", Text: text, Image: &cp})
}

// SendSticker (item 11i): a sticker by its address, inside the window.
func (s *SelfServe) SendSticker(ctx context.Context, to string, st StickerMessage) (OutboundMessage, error) {
	if !s.open(to) {
		return OutboundMessage{}, &guard.WindowClosedError{}
	}
	if p := StickerProblem(st); p != "" {
		return OutboundMessage{}, guard.Apif(400, "The sticker cannot be sent: %s.", p)
	}
	cp := st
	return s.post(ctx, ssSend, StickerForm(s.target(), to, st), OutboundMessage{To: to, Kind: "sticker", Text: "", Sticker: &cp})
}

// SendTemplate names Gupshup's own template id: refused here, in plain words, when the app has not approved it, and nothing is sent.
func (s *SelfServe) SendTemplate(ctx context.Context, to string, t TemplateMessage) (OutboundMessage, error) {
	if err := templateHeaderProblem(t); err != nil {
		return OutboundMessage{}, err
	}
	id, err := s.templateID(ctx, t)
	if err != nil {
		return OutboundMessage{}, err
	}
	hdr := ""
	m := OutboundMessage{To: to, Kind: "template", Text: t.Text, TemplateName: t.Name, Language: t.Language}
	if t.HeaderImage != nil && *t.HeaderImage != "" {
		hdr = *t.HeaderImage
		m.HeaderImage = hdr
	}
	return s.post(ctx, ssTemplate, TemplateForm(s.target(), to, id, t.Parameters, hdr), m)
}

// IsWindowOpen is the runtime's own knowledge.
func (s *SelfServe) IsWindowOpen(_ context.Context, to string) (bool, error) { return s.open(to), nil }

// Ping: the template list is the cheap read, it shows the key and the app name go together.
func (s *SelfServe) Ping(ctx context.Context) (guard.Reply, error) {
	o := guard.Options{}
	if s.cfg.AppID != "" {
		o.Query = []guard.Param{{Key: "pageSize", Value: "1"}}
	}
	return s.http.Request(ctx, "GET", s.listPath, o)
}

// GetMessage is the copy of what a send accepted.
func (s *SelfServe) GetMessage(_ context.Context, id string) (*OutboundMessage, error) {
	return s.sent.get(id), nil
}
