// Webhooks: checking who sent them, and reading them into the events the agent understands (webhooks.ts). Pure functions. The inbox uses them, and the agent runtime never holds a
// webhook secret; the Bookings shop runtime does not run the inbox, but the Go twin is here so the inbox can move too.
//
// Wire shapes read: Meta's (`entry[].changes[].value.messages|statuses`, signed with X-Hub-Signature-256), Gupshup's v3 callbacks (Meta's body plus `gs_app_id` and a `gs_id` on each
// status, unsigned), and Gupshup SELF-SERVE's version-2 envelope (`{app, timestamp, version, type: "message" | "message-event", payload}`, unsigned). The same two parsers read all three.
//
// The input is a decoded JSON value (guard.Decode: numbers stay json.Number, an absent key is JavaScript's undefined, a JSON null is present) and everything is narrowed by hand, as the
// TypeScript does, because a webhook body is untrusted.
//
// JavaScript behaviour copied: `\d` and `\w`-free patterns are ASCII in both; `\s` is language.JSSpace; `.length` is UTF-16 units; `Number(x)` is numberOf; a timestamp is epoch seconds as a
// string (ours is milliseconds), and past 1e10 it is read as milliseconds already. Times are whole milliseconds here (see whole in jsnum.go).
package messaging

import (
	"math"
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
)

// ---- signatures ---------------------------------------------------------------------------------------------------------------

// SignMeta is the X-Hub-Signature-256 value Meta would send for this body: `sha256=` and the hex HMAC-SHA256 with the App Secret (what a stand-in sends).
func SignMeta(rawBody []byte, appSecret string) string {
	return "sha256=" + guard.HMACHex(rawBody, appSecret)
}

// VerifyMetaSignature: is this body what Meta sent? An empty secret, a missing header or one that is not "sha256=" and the hex digest is false.
func VerifyMetaSignature(rawBody []byte, header *string, appSecret string) bool {
	if appSecret == "" || header == nil || len(*header) < 7 || (*header)[:7] != "sha256=" {
		return false
	}
	given := (*header)[7:]
	return guard.SameHex(guard.HMACHex(rawBody, appSecret), &given)
}

// ---- WhatsApp messages ----------------------------------------------------------------------------------------------------------

var (
	allDigits6to15 = regexp.MustCompile(`^[0-9]{6,15}$`)
	replyID        = regexp.MustCompile(`^[A-Za-z0-9:_.-]{1,200}$`)
	mediaID        = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	mediaMime      = regexp.MustCompile(`(?i)^[a-z0-9.+-]+/[a-z0-9.+-]+(;[` + language.JSSpace + `]*[a-z0-9=. -]+)?$`)
	statusID       = regexp.MustCompile(`^[A-Za-z0-9._:=+/-]{1,256}$`)
	whiteRun       = regexp.MustCompile(`[` + language.JSSpace + `]+`)
)

// ToE164 is toE164: our numbers are E.164 with a plus. Meta writes `from` as digits only, so the plus is put back; anything that is not a number is not ours to answer ("").
// `from.replace(/^\+/u, "")` drops ONE leading plus.
func ToE164(from any) string {
	s, ok := from.(string)
	if !ok {
		return ""
	}
	if len(s) > 0 && s[0] == '+' {
		s = s[1:]
	}
	if allDigits6to15.MatchString(s) {
		return "+" + s
	}
	return ""
}

// str is `str(v)`: a string, or absent.
func str(v any) (string, bool) { return guard.Str(v) }

// strOr is `str(a) ?? str(b)`: the first that is a string (an empty string counts).
func strOr(vals ...any) (string, bool) {
	for _, v := range vals {
		if s, ok := guard.Str(v); ok {
			return s, true
		}
	}
	return "", false
}

// textOf is what the customer wrote, as text: the words of a text message, or the label of the button or list row they tapped. ok is false for a type not understood yet.
func textOf(m guard.Object) (string, bool) {
	switch m["type"] {
	case "text":
		if t, ok := guard.IsObject(m["text"]); ok {
			return str(t["body"])
		}
	case "interactive":
		i, ok := guard.IsObject(m["interactive"])
		if !ok {
			return "", false
		}
		reply, ok := guard.IsObject(i["button_reply"])
		if !ok {
			reply, ok = guard.IsObject(i["list_reply"])
		}
		if !ok {
			return "", false
		}
		return str(reply["title"])
	case "button": // a template's quick-reply button
		if b, ok := guard.IsObject(m["button"]); ok {
			return strOr(b["text"], b["payload"])
		}
	}
	return "", false // locations, stickers ...: not understood yet
}

// replyOf is the id of the button or list row the customer tapped, and which kind it was; an id that is not a short plain one is dropped.
func replyOf(m guard.Object) *Reply {
	if m["type"] != "interactive" {
		return nil
	}
	i, ok := guard.IsObject(m["interactive"])
	if !ok {
		return nil
	}
	kind, id := "", ""
	if b, ok := guard.IsObject(i["button_reply"]); ok {
		kind = "button"
		id, _ = str(b["id"])
	} else if l, ok := guard.IsObject(i["list_reply"]); ok {
		kind = "list"
		id, _ = str(l["id"])
	}
	if kind != "" && id != "" && replyID.MatchString(id) {
		return &Reply{ID: id, Kind: kind}
	}
	return nil
}

// MediaOf is mediaOf: where a voice note's audio can be fetched, from Meta's `audio` object (`id`, `mime_type`) or Gupshup's (the same, plus a `url`). Each part is kept only if it has the
// shape of what it is (an id of plain characters, an https address of at most 2048 UTF-16 units, a type of at most 80); a note with neither an id nor an address has no media (nil).
func MediaOf(audio any) *VoiceMediaRef {
	o, ok := guard.IsObject(audio)
	if !ok {
		return nil
	}
	ref := VoiceMediaRef{}
	if id, _ := str(o["id"]); id != "" && mediaID.MatchString(id) {
		ref.ID = id
	}
	if u, _ := str(o["url"]); u != "" && language.UTF16Len(u) <= 2048 && httpsLink.MatchString(u) {
		ref.URL = u
	}
	if m, _ := str(o["mime_type"]); m != "" && mediaMime.MatchString(m) && language.UTF16Len(m) <= 80 {
		ref.Mime = m
	}
	if ref.ID == "" && ref.URL == "" {
		return nil
	}
	return &ref
}

// ParseOptions is parseWhatsAppWebhook's options: VoiceMedia is true for a shop with voice on (it keeps where a voice note's audio is).
type ParseOptions struct{ VoiceMedia bool }

// ParseWhatsAppWebhook is the customer messages in a WhatsApp webhook (delivery statuses are ParseWhatsAppStatuses'). Messages with no id, no sender number or no words are left out. The
// timestamp is epoch seconds as a string; ours is milliseconds. A voice note or an audio file has no words but the person is waiting: empty text and VoiceNote, nothing else of it kept
// (unless VoiceMedia). A picture is the same with Image. The result is never nil.
func ParseWhatsAppWebhook(body any, o ParseOptions) []InboundMessage {
	out := []InboundMessage{}
	b, ok := guard.IsObject(body)
	if !ok {
		return out
	}
	if IsGupshupSelfServe(b) {
		return parseSelfServeMessages(b, o)
	}
	for _, e := range guard.AsArray(b["entry"]) {
		entry, ok := guard.IsObject(e)
		if !ok {
			continue
		}
		for _, c := range guard.AsArray(entry["changes"]) {
			change, ok := guard.IsObject(c)
			if !ok || change["field"] != "messages" {
				continue
			}
			value, ok := guard.IsObject(change["value"])
			if !ok {
				continue
			}
			for _, x := range guard.AsArray(value["messages"]) {
				m, ok := guard.IsObject(x)
				if !ok {
					continue
				}
				id, _ := str(m["id"])
				from := ToE164(m["from"])
				voiceNote := m["type"] == "audio"
				var media *VoiceMediaRef
				if voiceNote && o.VoiceMedia {
					media = MediaOf(m["audio"])
				}
				image := m["type"] == "image"
				text, has := "", true
				if !voiceNote && !image {
					text, has = textOf(m)
				}
				if id == "" || from == "" || !has || (len(text) == 0 && !voiceNote && !image) {
					continue
				}
				secs := numberOf(m["timestamp"], hasKey(m, "timestamp"))
				ts := int64(0)
				if !math.IsNaN(secs) && !math.IsInf(secs, 0) {
					ts = whole(secs * 1000)
				}
				out = append(out, InboundMessage{ID: id, From: from, Text: text, Timestamp: ts, VoiceNote: voiceNote, Media: media, Image: image, Reply: replyOf(m)})
			}
		}
	}
	return out
}

func hasKey(o guard.Object, k string) bool { _, ok := o[k]; return ok }

// ---- WhatsApp statuses ------------------------------------------------------------------------------------------------------------

// keptStatus: the statuses worth keeping say more than "accepted". "sent" and Gupshup's "enqueued" do not.
func keptStatus(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok && (s == "delivered" || s == "read" || s == "failed")
}

// statusTime is a status time: Meta writes seconds as a string; Gupshup writes seconds as a string or milliseconds as a number. Anything from 1e10 up is milliseconds already.
func statusTime(v any, present bool) int64 {
	n := numberOf(v, present)
	if math.IsNaN(n) || math.IsInf(n, 0) || n <= 0 {
		return 0
	}
	if n >= 1e10 {
		return whole(math.Trunc(n))
	}
	return whole(n * 1000)
}

// statusIDs is `[...new Set([str(a), str(b)].filter(x => x !== undefined && STATUS_ID.test(x)))]`: in order, no repeats.
func statusIDs(a, b any) []string {
	out := []string{}
	for _, v := range []any{a, b} {
		s, ok := str(v)
		if !ok || !statusID.MatchString(s) {
			continue
		}
		dup := false
		for _, o := range out {
			dup = dup || o == s
		}
		if !dup {
			out = append(out, s)
		}
	}
	return out
}

// failure is a failed status's error: the provider's code and title (whitespace squeezed, cut at 200 UTF-16 units; a cut inside a surrogate pair drops the half character, which
// JavaScript would keep as a lone surrogate that no Go string holds).
func failure(code any, title any) *StatusError {
	e := &StatusError{}
	if c, ok := guard.Int(code); ok {
		e.Code = &c
	}
	if t, ok := str(title); ok {
		t = language.UTF16Slice(language.TrimJS(whiteRun.ReplaceAllString(t, " ")), 200)
		e.Title = t
	}
	return e
}

// ParseWhatsAppStatuses is the delivered, read and failed reports in a WhatsApp webhook (Meta's, or Gupshup's v3 which adds `gs_id`), in order. Each keeps the message's ids, who it was
// for, when, and for a failure the provider's code and title: never anything the person wrote. A status with no usable id, or one we do not keep, is left out. The result is never nil.
func ParseWhatsAppStatuses(body any) []MessageStatus {
	out := []MessageStatus{}
	b, ok := guard.IsObject(body)
	if !ok {
		return out
	}
	if IsGupshupSelfServe(b) {
		return parseSelfServeStatuses(b)
	}
	for _, e := range guard.AsArray(b["entry"]) {
		entry, ok := guard.IsObject(e)
		if !ok {
			continue
		}
		for _, c := range guard.AsArray(entry["changes"]) {
			change, ok := guard.IsObject(c)
			if !ok || change["field"] != "messages" {
				continue
			}
			value, ok := guard.IsObject(change["value"])
			if !ok {
				continue
			}
			for _, x := range guard.AsArray(value["statuses"]) {
				s, ok := guard.IsObject(x)
				if !ok {
					continue
				}
				status, kept := keptStatus(s["status"])
				if !kept {
					continue
				}
				// Gupshup's own id first: it is what its send call answered with. Then whatever `id` holds (a wamid, or in one example another UUID).
				ids := statusIDs(s["gs_id"], s["id"])
				if len(ids) == 0 {
					continue
				}
				m := MessageStatus{IDs: ids, Status: status, To: ToE164(s["recipient_id"]), Timestamp: statusTime(s["timestamp"], hasKey(s, "timestamp"))}
				if status == "failed" {
					var first guard.Object
					for _, x := range guard.AsArray(s["errors"]) {
						if o, ok := guard.IsObject(x); ok {
							first = o
							break
						}
					}
					m.Error = failure(first["code"], first["title"])
				}
				out = append(out, m)
			}
		}
	}
	return out
}

// ---- Gupshup self-serve callbacks -----------------------------------------------------------------------------------------------

// IsGupshupSelfServe: a self-serve callback's version-2 envelope names the app by NAME (`app`) and has no `entry` (Meta's and Gupshup's v3 bodies do). `version` and `entry` are tested
// for being present at all (JavaScript's `!== undefined`), so a JSON null counts as present.
func IsGupshupSelfServe(b guard.Object) bool {
	_, hasVersion := b["version"]
	_, hasEntry := b["entry"]
	_, appIsString := b["app"].(string)
	t := b["type"]
	_, payloadIsObject := guard.IsObject(b["payload"])
	return hasVersion && appIsString && (t == "message" || t == "message-event") && payloadIsObject && !hasEntry
}

// SelfServeAppName is the app name a self-serve callback names, for the inbox's check that it is this shop's ("" for anything else).
func SelfServeAppName(body any) string {
	if b, ok := guard.IsObject(body); ok && IsGupshupSelfServe(b) {
		return b["app"].(string)
	}
	return ""
}

// nullish is JavaScript's `v == null` for a present value: undefined or null.
func nullish(o guard.Object, k string) bool { v, ok := o[k]; return !ok || v == nil }

// parseSelfServeMessages: text is its words. A tapped button or list row comes back as `postbackText`, the id we gave it (selfserve.go): it becomes Reply only if it is a short plain id;
// without one the row's title is read as ordinary words. Voice notes and pictures are the fact only (a voice note also carries where its audio is when the shop has voice on).
func parseSelfServeMessages(body guard.Object, o ParseOptions) []InboundMessage {
	none := []InboundMessage{}
	p, ok := guard.IsObject(body["payload"])
	if !ok || body["type"] != "message" {
		return none
	}
	id, _ := str(p["id"])
	var src any
	if nullish(p, "source") {
		if sender, ok := guard.IsObject(p["sender"]); ok {
			src = sender["phone"]
		}
	} else {
		src = p["source"]
	}
	from := ToE164(src)
	if id == "" || from == "" {
		return none
	}
	inner, ok := guard.IsObject(p["payload"])
	if !ok {
		inner = guard.Object{}
	}
	ts := int64(0)
	if ms := numberOf(body["timestamp"], hasKey(body, "timestamp")); !math.IsNaN(ms) && ms > 0 && !math.IsInf(ms, 0) {
		ts = whole(math.Trunc(ms))
	}
	plain := func(text string, has bool, reply *Reply) []InboundMessage {
		if !has || len(text) == 0 {
			return none
		}
		return []InboundMessage{{ID: id, From: from, Text: text, Timestamp: ts, Reply: reply}}
	}
	switch p["type"] {
	case "text":
		t, has := str(inner["text"])
		return plain(t, has, nil)
	case "audio":
		var media *VoiceMediaRef
		if o.VoiceMedia {
			media = MediaOf(guard.Object{"url": inner["url"], "mime_type": inner["contentType"]})
		}
		return []InboundMessage{{ID: id, From: from, Timestamp: ts, VoiceNote: true, Media: media}}
	case "image":
		return []InboundMessage{{ID: id, From: from, Timestamp: ts, Image: true}}
	case "button_reply", "quick_reply", "list_reply":
		text, has := strOr(inner["title"], inner["text"], inner["reply"])
		var reply *Reply
		if pb, ok := str(inner["postbackText"]); ok && pb != "" && replyID.MatchString(pb) {
			kind := "button"
			if p["type"] == "list_reply" {
				kind = "list"
			}
			reply = &Reply{ID: pb, Kind: kind}
		}
		return plain(text, has, reply)
	}
	return none
}

// parseSelfServeStatuses is the delivered, read and failed reports in a self-serve message-event. `id` is Gupshup's id on enqueued and failed and WhatsApp's on sent, delivered and read,
// with `gsId` beside it on the latter: both are kept so the record is searched for either. A failed event carries { code, reason }; only those two are kept.
func parseSelfServeStatuses(body guard.Object) []MessageStatus {
	none := []MessageStatus{}
	p, ok := guard.IsObject(body["payload"])
	if !ok || body["type"] != "message-event" {
		return none
	}
	status, kept := keptStatus(p["type"])
	if !kept {
		return none
	}
	ids := statusIDs(p["gsId"], p["id"])
	if len(ids) == 0 {
		return none
	}
	inner, ok := guard.IsObject(p["payload"])
	if !ok {
		inner = guard.Object{}
	}
	// delivered and read carry Meta's time in seconds (`ts`); a failure has none, so Gupshup's own millisecond time stands (`inner.ts ?? body.timestamp`)
	var ts int64
	if nullish(inner, "ts") {
		ts = statusTime(body["timestamp"], hasKey(body, "timestamp"))
	} else {
		ts = statusTime(inner["ts"], true)
	}
	m := MessageStatus{IDs: ids, Status: status, To: ToE164(p["destination"]), Timestamp: ts}
	if status == "failed" {
		m.Error = failure(inner["code"], inner["reason"])
	}
	return []MessageStatus{m}
}
