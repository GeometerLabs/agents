// Package messaging is WhatsApp for a shop's Go runtime: the Go twin of modules/messaging (messaging.ts, whatsapp.ts, gupshup.ts, gupshup-selfserve.ts, providers.ts, say.ts,
// send-once.ts, statuses.ts, webhooks.ts) and of the stand-in a "fakes" shop runs on (modules/runtime/services.ts standInMessaging). It is the shared Guard client the Bookings,
// Orders, Fees and Stock-orders runtimes call: no key and no Authorization header of WhatsApp's is ever held or sent, the base URL is a Guard in front of the provider.
//
// This file is messaging.ts: the message types, the Messaging interface and the checks that run before anything goes out (documentProblem, imageProblem, stickerProblem) and the
// buttons-and-lists rules of language/interactive.ts (interactiveProblem, interactiveText). Where Go differs from JavaScript, the TypeScript behaviour copied is named at the line:
// `.length` is UTF-16 units (language.UTF16Len), `\s` is language.JSSpace, `.trim()` is language.TrimJS, `[...s].length` is code points (utf8.RuneCountInString).
package messaging

import (
	"context"
	"regexp"
	"strconv"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
)

// Language is a shop language code: "hi", "en", "ml" or "kn" (languages.ts). A string, so the runtime's own language values pass without a conversion.
type Language = string

// metaLanguage is meta-templates.ts META_LANGUAGE: our four languages as Meta's template language codes (they are the same four codes). ok is false for anything else, where the
// TypeScript's lookup is `undefined` (JSON.stringify leaves the member out; a template-id key reads "undefined").
func metaLanguage(l Language) (code string, ok bool) {
	switch l {
	case "en", "hi", "ml", "kn":
		return l, true
	}
	return "", false
}

// Hour is core/time.ts HOUR in milliseconds; the 24-hour window is `now - lastInbound < 24 * Hour`, strictly less.
const Hour int64 = 3_600_000

// Clock is the time in epoch milliseconds (core/clock.ts `now()`); the runtime passes its own, a test passes a fixed one.
type Clock func() int64

// WindowStore is the runtime's own knowledge of when each customer last wrote (whatsapp.ts WindowStore): WhatsApp has no API for the 24-hour window.
type WindowStore interface {
	// LastInboundAt is when this phone last wrote to the shop, epoch ms; ok is false when it never has.
	LastInboundAt(phone string) (ms int64, ok bool)
}

// Deps is what a live client needs beside its Http: the clock and the window store.
type Deps struct {
	Clock  Clock
	Window WindowStore
}

// VoiceMediaRef is where a voice note's audio can be fetched (messaging.ts VoiceMediaRef): never the audio.
type VoiceMediaRef struct {
	ID   string `json:"id,omitempty"`
	URL  string `json:"url,omitempty"`
	Mime string `json:"mime,omitempty"`
}

// Reply is InboundMessage.reply: the id of the button or list row the customer tapped, and which kind it was.
type Reply struct {
	ID   string `json:"id"`
	Kind string `json:"kind"` // "button" or "list"
}

// InboundMessage is a customer's message (messaging.ts InboundMessage). `Audio` and `OnHeard` of the TypeScript (the chat page's recording and its callback, set by the runtime and
// never by a webhook) are the chat channel's own and live with it, not here; NoModel is carried so a saved event round-trips.
type InboundMessage struct {
	ID        string         `json:"id"`
	From      string         `json:"from"`
	Text      string         `json:"text"`
	Timestamp int64          `json:"timestamp"` // epoch ms
	VoiceNote bool           `json:"voiceNote,omitempty"`
	Media     *VoiceMediaRef `json:"media,omitempty"`
	Image     bool           `json:"image,omitempty"`
	NoModel   bool           `json:"noModel,omitempty"`
	Reply     *Reply         `json:"reply,omitempty"`
}

// StatusError is MessageStatus.error: the provider's code and short title for a failure, never the message's words.
type StatusError struct {
	Code  *int64 `json:"code,omitempty"`
	Title string `json:"title,omitempty"`
}

// MessageStatus is what WhatsApp said later about a message we sent (messaging.ts MessageStatus): delivered, read or failed.
type MessageStatus struct {
	IDs       []string     `json:"ids"`
	Status    string       `json:"status"` // delivered, read, failed
	To        string       `json:"to,omitempty"`
	Timestamp int64        `json:"timestamp"`
	Error     *StatusError `json:"error,omitempty"`
}

// OutboundMessage is a message we sent, as the outbox keeps it (messaging.ts OutboundMessage). AcceptedAs is a pointer because the provider's own word may be "" and TypeScript keeps it.
type OutboundMessage struct {
	ID           string              `json:"id"`
	To           string              `json:"to"`
	Kind         string              `json:"kind"` // text, template, interactive, document, image, sticker
	Text         string              `json:"text"`
	Interactive  *InteractiveMessage `json:"interactive,omitempty"`
	Document     *DocumentMessage    `json:"document,omitempty"`
	Image        *ImageMessage       `json:"image,omitempty"`
	Sticker      *StickerMessage     `json:"sticker,omitempty"`
	HeaderImage  string              `json:"headerImage,omitempty"`
	TemplateName string              `json:"templateName,omitempty"`
	Language     Language            `json:"language,omitempty"`
	SentAt       int64               `json:"sentAt"`
	AfterOptOut  bool                `json:"afterOptOut"`
	AcceptedAs   *string             `json:"acceptedAs,omitempty"`
}

// TemplateMessage is a pre-approved template (messaging.ts TemplateMessage): `Text` is the whole rendered message, a real provider sends `Name` with the numbered Parameters.
// HeaderImage is a pointer: `undefined` (no header) and `""` (a header with no address, which is refused) differ in the TypeScript.
type TemplateMessage struct {
	Name        string   `json:"name"`
	Language    Language `json:"language"`
	Text        string   `json:"text"`
	Parameters  []string `json:"parameters,omitempty"`
	HeaderImage *string  `json:"headerImage,omitempty"`
}

// DocumentMessage is a file sent by its address. Caption is a pointer for the same reason as above (`undefined` versus "").
type DocumentMessage struct {
	Link     string  `json:"link"`
	Filename string  `json:"filename"`
	Caption  *string `json:"caption,omitempty"`
}

// ImageMessage is a picture sent by its address.
type ImageMessage struct {
	Link    string  `json:"link"`
	Caption *string `json:"caption,omitempty"`
}

// StickerMessage is a sticker sent by its address (a WebP).
type StickerMessage struct {
	Link string `json:"link"`
}

// Messaging is what every client and stand-in offers (messaging.ts Messaging). The TypeScript's OPTIONAL members (sendInteractive, sendDocument, sendImage, sendSticker, ping) are the
// small interfaces below, found by a type assertion: say.ts asks `typeof messaging.sendImage === "function"`, here it is `messaging.(Images)`. A provider without one is not asked.
type Messaging interface {
	// SendText is free-form text. Only allowed while the customer's 24-hour window is open (a WindowClosedError otherwise).
	SendText(ctx context.Context, to, text string) (OutboundMessage, error)
	// SendTemplate is a pre-approved template; the only way to start a conversation after the window has closed.
	SendTemplate(ctx context.Context, to string, t TemplateMessage) (OutboundMessage, error)
	// IsWindowOpen: did this person message us in the last 24 hours?
	IsWindowOpen(ctx context.Context, to string) (bool, error)
	// GetMessage is the local copy of what a send accepted, or nil (WhatsApp has no read-back; the copy is gone after a restart).
	GetMessage(ctx context.Context, id string) (*OutboundMessage, error)
}

// Interactive: reply buttons (up to 3) or a list (up to 10 rows), only while the window is open.
type Interactive interface {
	SendInteractive(ctx context.Context, to string, m InteractiveMessage) (OutboundMessage, error)
}

// Documents: a file by its address, only while the window is open.
type Documents interface {
	SendDocument(ctx context.Context, to string, d DocumentMessage) (OutboundMessage, error)
}

// Images: a picture by its address, only while the window is open.
type Images interface {
	SendImage(ctx context.Context, to string, i ImageMessage) (OutboundMessage, error)
}

// Stickers: a sticker by its address (item 11i). Gupshup's partner pass-through does not have it, so that client does not implement this.
type Stickers interface {
	SendSticker(ctx context.Context, to string, s StickerMessage) (OutboundMessage, error)
}

// Pinger is a plain read that reaches this service's Guard and changes nothing, so a task waiting for it can ask whether it is back (runtime/guard-wait.ts).
type Pinger interface {
	Ping(ctx context.Context) (guard.Reply, error)
}

var (
	httpsLink   = regexp.MustCompile(`^https://[^` + language.JSSpace + `]+$`)
	stickerLink = regexp.MustCompile(`^https://[^` + language.JSSpace + `?#]+\.webp(\?[^` + language.JSSpace + `#]*)?$`)
	badFilename = regexp.MustCompile(`[\\/\n\r]`)
)

const captionProblemWords = "the caption must be 1 to 1024 characters, or left out"
const linkProblemWords = "the link must start with https:// and hold no spaces"

// captionBad is `caption.length > 1024 || caption.trim() === ""` (length in UTF-16 units).
func captionBad(c *string) bool {
	return c != nil && (language.UTF16Len(*c) > 1024 || language.TrimJS(*c) == "")
}

// DocumentProblem is messaging.ts documentProblem: why a document cannot be sent, in plain words, or "".
func DocumentProblem(d DocumentMessage) string {
	if !httpsLink.MatchString(d.Link) {
		return linkProblemWords
	}
	if language.TrimJS(d.Filename) == "" || language.UTF16Len(d.Filename) > 240 || badFilename.MatchString(d.Filename) {
		return "the file name must be 1 to 240 characters with no slash or line break"
	}
	if captionBad(d.Caption) {
		return captionProblemWords
	}
	return ""
}

// ImageProblem is messaging.ts imageProblem.
func ImageProblem(i ImageMessage) string {
	if !httpsLink.MatchString(i.Link) {
		return linkProblemWords
	}
	if captionBad(i.Caption) {
		return captionProblemWords
	}
	return ""
}

// StickerProblem is messaging.ts stickerProblem: an https link to a .webp file.
func StickerProblem(s StickerMessage) string {
	if !stickerLink.MatchString(s.Link) {
		return "the link must start with https://, hold no spaces and name a .webp file"
	}
	return ""
}

// ---- buttons and lists (language/interactive.ts) ---------------------------------------------------------------------------------

// Meta's limits (interactive.ts LIMITS).
const (
	maxButtons        = 3
	maxButtonTitle    = 20
	maxRows           = 10
	maxRowTitle       = 24
	maxRowDescription = 72
	maxListButton     = 20
	maxBody           = 1024
	maxID             = 200
)

// Choice is one button or list row. Description is a pointer: "" is present and refused, nil is absent.
type Choice struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
}

// InteractiveList is a list message's button label and rows.
type InteractiveList struct {
	Button string   `json:"button"`
	Rows   []Choice `json:"rows"`
}

// InteractiveMessage is what goes out: the body WhatsApp shows, and either up to 3 buttons or one list. TypeScript's `message.buttons ?` is truthiness, and an empty array is truthy:
// Buttons != nil is "has buttons" (a JSON `[]` decodes to a non-nil empty slice).
type InteractiveMessage struct {
	Body    string           `json:"body"`
	Buttons []Choice         `json:"buttons,omitempty"`
	List    *InteractiveList `json:"list,omitempty"`
}

// InteractiveText is interactive.ts interactiveText: the body, then each list row on its own line ("title: description" when it has a description, which is truthiness: "" has none).
func InteractiveText(m InteractiveMessage) string {
	out := m.Body
	if m.List != nil {
		for _, r := range m.List.Rows {
			out += "\n"
			if r.Description != nil && *r.Description != "" {
				out += r.Title + ": " + *r.Description
			} else {
				out += r.Title
			}
		}
	}
	return out
}

// InteractiveProblem is interactive.ts interactiveProblem: the first thing wrong with a message against Meta's limits, or "". Lengths here are CODE POINTS (`[...s].length`), not
// UTF-16 units: the TypeScript says so ("Malayalam and Kannada letters are one each"), and an emoji counts one.
func InteractiveProblem(m InteractiveMessage) string {
	length := utf8.RuneCountInString
	if language.TrimJS(m.Body) == "" || length(m.Body) > maxBody {
		return "the body must be 1 to " + strconv.Itoa(maxBody) + " characters"
	}
	n := 0
	if m.Buttons != nil {
		n++
	}
	if m.List != nil {
		n++
	}
	if n != 1 {
		return "give either buttons or a list"
	}
	ids := map[string]bool{}
	check := func(c Choice, titleMax, descMax int) string {
		if c.ID == "" || length(c.ID) > maxID {
			return "an id must be 1 to " + strconv.Itoa(maxID) + " characters"
		}
		if ids[c.ID] {
			return "the id " + c.ID + " is used twice"
		}
		ids[c.ID] = true
		if language.TrimJS(c.Title) == "" || length(c.Title) > titleMax {
			return `the title "` + c.Title + `" must be 1 to ` + strconv.Itoa(titleMax) + " characters"
		}
		if c.Description != nil && (*c.Description == "" || length(*c.Description) > descMax) {
			return `the description of "` + c.Title + `" must be 1 to ` + strconv.Itoa(descMax) + " characters"
		}
		return ""
	}
	if m.Buttons != nil {
		if len(m.Buttons) < 1 || len(m.Buttons) > maxButtons {
			return "a message has 1 to " + strconv.Itoa(maxButtons) + " buttons"
		}
		for _, b := range m.Buttons {
			if b.Description != nil {
				return "a button has no description"
			}
			if p := check(b, maxButtonTitle, 0); p != "" {
				return p
			}
		}
	}
	if m.List != nil {
		if language.TrimJS(m.List.Button) == "" || length(m.List.Button) > maxListButton {
			return "the list button must be 1 to " + strconv.Itoa(maxListButton) + " characters"
		}
		if len(m.List.Rows) < 1 || len(m.List.Rows) > maxRows {
			return "a list has 1 to " + strconv.Itoa(maxRows) + " rows"
		}
		for _, r := range m.List.Rows {
			if p := check(r, maxRowTitle, maxRowDescription); p != "" {
				return p
			}
		}
	}
	return ""
}
