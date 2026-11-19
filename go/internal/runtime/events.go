package runtime

// The events a template's runtime takes from outside, checked for shape before anything is saved, and the key that makes a redelivery a no-op: modules/runtime/events.ts (the
// inbox's events and the panel's recovery) and modules/channels/events.ts (what the public front may send). The same for every template; a template's agent decides what to do
// with each. All or nothing: one bad event refuses the whole request, with the TypeScript's sentence. The sentences, the patterns and the keys are the TypeScript's, so a task saved
// by one runtime is found again (and a redelivery refused) by the other.
//
// Where Go and JavaScript differ: a JavaScript string's `length` counts UTF-16 code units (language.UTF16Len); `\s` in a JavaScript pattern is every Unicode space
// (language.IsJSSpace), where RE2's is ASCII only, so no pattern below leans on `\s` for anything but ASCII; `String.prototype.trim` is language.TrimJS.

import (
	"math"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/text/unicode/norm"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// MaxEventsPerRequest is events.ts MAX_EVENTS_PER_REQUEST.
const MaxEventsPerRequest = 100

var (
	requestIDRe  = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)
	actionNameRe = regexp.MustCompile(`^[a-z][a-z0-9_]{1,39}$`)
	approvalIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$`)
	statusIDRe   = regexp.MustCompile(`^[A-Za-z0-9._:=+/-]{1,256}$`)
	e164Re       = regexp.MustCompile(`^\+\d{6,15}$`)
	replyIDRe    = regexp.MustCompile(`^[A-Za-z0-9:_.-]{1,200}$`)
	mediaIDRe    = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	mediaURLRe   = regexp.MustCompile(`^https://[^\s]+$`)
	mimeRe       = regexp.MustCompile(`(?i)^[a-z0-9.+-]+/[a-z0-9.+-]+(;\s*[a-z0-9=. -]+)?$`)
	// HandleHash is handle.ts HANDLE_HASH: the SHA-256 of a handle, 64 lower-case hex digits.
	HandleHash = regexp.MustCompile(`^[0-9a-f]{64}$`)
	serviceIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`)
	dueIDRe     = regexp.MustCompile(`^f-\d{1,9}$`)
	dateRe      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	upiRefRe    = regexp.MustCompile(`^\d{6,22}$`)
	tapRe       = regexp.MustCompile(`^[A-Za-z0-9:_.-]{1,200}$`)
)

var paymentEvents = []string{"request.paid", "payment.received", "refund.done"}

// LANGUAGES is modules/language/languages.ts LANGUAGES, in its order.
var LANGUAGES = []string{"en", "hi", "ml", "kn"}

func isText(v any) bool {
	s, ok := v.(string)
	return ok && s != "" && language.UTF16Len(s) <= 256
}

func isFinite(v any) (float64, bool) {
	n, ok := v.(float64)
	return n, ok && !math.IsInf(n, 0) && !math.IsNaN(n)
}

func isWhole(v any) bool {
	n, ok := v.(float64)
	return ok && n == math.Trunc(n) && !math.IsInf(n, 0)
}

// EventKey is events.ts eventKey (with channels/events.ts channelEventKey): message ids, payment event ids and approval ids are different id spaces, so each gets its own prefix.
func EventKey(e map[string]any) string {
	kind, _ := e["kind"].(string)
	str := func(k string) string { s, _ := e[k].(string); return s }
	switch kind {
	case "message":
		m, _ := e["message"].(map[string]any)
		id, _ := m["id"].(string)
		return "message:" + id
	case "approval_decision":
		return "approval_decision:" + str("approval") + ":" + str("decision") + ":" + str("id")
	case "recovery":
		return "recovery:" + str("id")
	case "message_status":
		st, _ := e["status"].(map[string]any)
		var ids []string
		if list, ok := st["ids"].([]any); ok {
			for _, x := range list {
				s, _ := x.(string)
				ids = append(ids, s)
			}
		}
		status, _ := st["status"].(string)
		return "message_status:" + strings.Join(ids, "|") + ":" + status
	case "payment_event":
		ev, _ := e["event"].(map[string]any)
		id, _ := ev["id"].(string)
		return "payment_event:" + id
	case "chat_message":
		return ChatTaskKey(str("handle"), str("id"))
	case "channel_request":
		if op := str("op"); op == "cancel" || op == "paid" {
			return "channel_" + op + ":" + str("handle") + ":" + str("id")
		}
		return ChannelStartKey(str("handle"))
	}
	// owner_action, owner_signin, owner_message, owner_access, chat_link and the others the runtime's own HTTP layer makes: the kind and the id
	return kind + ":" + str("id")
}

// ChannelStartKey is channels/events.ts channelStartKey: one task per handle that starts something (the name stays channel_book: for every kind, as a task saved before was).
func ChannelStartKey(handleHash string) string { return "channel_book:" + handleHash }

// ChatTaskKey is channels/events.ts chatTaskKey.
func ChatTaskKey(handleHash, id string) string { return "chat_message:" + handleHash + ":" + id }

// CheckEvents is events.ts checkEvents: the inbox's {"events": [...]}, all or nothing.
func CheckEvents(body any) ([]map[string]any, string) {
	obj, _ := body.(map[string]any)
	list, ok := obj["events"].([]any)
	if !ok || len(list) == 0 || len(list) > MaxEventsPerRequest {
		return nil, `Send {"events": [...]} with 1 to 100 events.`
	}
	var out []map[string]any
	for i, raw := range list {
		ev, why := checkOne(raw)
		if why != "" {
			return nil, "Event " + strconv.Itoa(i+1) + ": " + why
		}
		out = append(out, ev)
	}
	return out, ""
}

func checkOne(raw any) (map[string]any, string) {
	e, ok := raw.(map[string]any)
	if !ok {
		return nil, "it must be an object with a kind."
	}
	switch e["kind"] {
	case "message":
		return checkMessage(e["message"])
	case "payment_event":
		return checkPaymentEvent(e["event"])
	case "approval_decision":
		approval, _ := e["approval"].(string)
		decision, _ := e["decision"].(string)
		if !approvalIDRe.MatchString(approval) || (decision != "approve" && decision != "deny") {
			return nil, `an approval_decision needs approval (Guard's approval id) and decision ("approve" or "deny").`
		}
		out := map[string]any{"kind": "approval_decision", "approval": approval, "decision": decision}
		if id, given := e["id"]; given {
			s, ok := id.(string)
			if !ok || !requestIDRe.MatchString(s) {
				return nil, "an approval_decision's id, if given, is up to 64 letters, digits and hyphens."
			}
			out["id"] = s
		}
		return out, ""
	case "message_status":
		return checkStatus(e["status"])
	}
	return nil, `the kind must be "message", "message_status", "payment_event" or "approval_decision" (a tick is never sent from outside).`
}

func checkMessage(raw any) (map[string]any, string) {
	m, ok := raw.(map[string]any)
	text, isStr := m["text"].(string)
	ts, finite := isFinite(m["timestamp"])
	if !ok || !isText(m["id"]) || !isText(m["from"]) || !isStr || !finite {
		return nil, "a message needs message.id, message.from, message.text and message.timestamp (epoch milliseconds)."
	}
	voice, hasVoice := m["voiceNote"]
	if hasVoice && voice != true {
		return nil, "message.voiceNote, if given, must be true (a voice note or audio file)."
	}
	isVoice := voice == true
	if isVoice && text != "" {
		return nil, "a voice note has no words: send message.text as an empty string."
	}
	out := map[string]any{"id": m["id"], "from": m["from"], "text": text, "timestamp": ts}
	if isVoice {
		out["voiceNote"] = true
	}
	if r, given := m["media"]; given {
		if !isVoice {
			return nil, "message.media is only for a voice note."
		}
		media, ok := r.(map[string]any)
		okID := func(v any, present bool) bool {
			s, isS := v.(string)
			return !present || (isS && mediaIDRe.MatchString(s))
		}
		okURL := func(v any, present bool) bool {
			s, isS := v.(string)
			return !present || (isS && language.UTF16Len(s) <= 2048 && mediaURLRe.MatchString(s))
		}
		okMime := func(v any, present bool) bool {
			s, isS := v.(string)
			return !present || (isS && language.UTF16Len(s) <= 80 && mimeRe.MatchString(s))
		}
		id, hasID := media["id"]
		url, hasURL := media["url"]
		mime, hasMime := media["mime"]
		extra := false
		for k := range media {
			if k != "id" && k != "url" && k != "mime" {
				extra = true
			}
		}
		if !ok || extra || !okID(id, hasID) || !okURL(url, hasURL) || !okMime(mime, hasMime) || (!hasID && !hasURL) {
			return nil, `message.media, if given, must be {"id": the media id and/or "url": an https address, "mime": the type}.`
		}
		kept := map[string]any{}
		for k, v := range media {
			kept[k] = v
		}
		out["media"] = kept
	}
	img, hasImg := m["image"]
	if hasImg && img != true {
		return nil, "message.image, if given, must be true (a picture)."
	}
	if img == true && (text != "" || isVoice) {
		return nil, "a picture has no words and is not a voice note: send message.text as an empty string."
	}
	if img == true {
		out["image"] = true
	}
	if r, given := m["reply"]; given {
		reply, ok := r.(map[string]any)
		id, _ := reply["id"].(string)
		kind, _ := reply["kind"].(string)
		if !ok || !replyIDRe.MatchString(id) || (kind != "button" && kind != "list") {
			return nil, `message.reply, if given, must be {"id": the id of the button or row, "kind": "button" or "list"}.`
		}
		if isVoice || img == true {
			return nil, "a voice note or a picture cannot be a button or list reply."
		}
		out["reply"] = map[string]any{"id": id, "kind": kind}
	}
	return map[string]any{"kind": "message", "message": out}, ""
}

func checkPaymentEvent(raw any) (map[string]any, string) {
	e, ok := raw.(map[string]any)
	p, pOK := e["payload"].(map[string]any)
	name, _ := e["event"].(string)
	_, created := e["created_at"].(float64)
	if !ok || !pOK || !isText(e["id"]) || !contains(paymentEvents, name) || !created {
		return nil, "a payment event needs event.id, event.event (request.paid, payment.received, refund.done), event.created_at and event.payload."
	}
	req, _ := p["request"].(map[string]any)
	pay, _ := p["payment"].(map[string]any)
	ref, _ := p["refund"].(map[string]any)
	var has bool
	switch name {
	case "refund.done":
		has = isText(ref["id"]) && isText(ref["payment_id"])
	case "payment.received":
		has = isText(pay["id"]) || isText(pay["request_id"]) || isText(req["id"])
	default:
		has = isText(req["id"]) || isText(pay["request_id"])
	}
	if !has {
		return nil, "a " + name + " event is missing the ids in its payload that say which payment it is about."
	}
	// the event is kept as it came (events.ts passes it on whole): the agent reads only what it checks
	return map[string]any{"kind": "payment_event", "event": e}, ""
}

func checkStatus(raw any) (map[string]any, string) {
	shape := `a message_status needs status.ids (1 to 3 message ids), status.status ("delivered", "read" or "failed") and status.timestamp (epoch milliseconds).`
	s, ok := raw.(map[string]any)
	list, isList := s["ids"].([]any)
	if !ok || !isList || len(list) == 0 || len(list) > 3 {
		return nil, shape
	}
	ids := make([]any, 0, len(list))
	for _, x := range list {
		id, ok := x.(string)
		if !ok || !statusIDRe.MatchString(id) {
			return nil, shape
		}
		ids = append(ids, id)
	}
	status, _ := s["status"].(string)
	if status != "delivered" && status != "read" && status != "failed" {
		return nil, shape
	}
	ts, finite := isFinite(s["timestamp"])
	if !finite {
		return nil, shape
	}
	out := map[string]any{"ids": ids, "status": status, "timestamp": ts}
	if to, given := s["to"]; given {
		t, ok := to.(string)
		if !ok || !e164Re.MatchString(t) {
			return nil, "status.to, if given, is the number it was for (E.164, like +919811111111)."
		}
		out["to"] = t
	}
	if er, given := s["error"]; given {
		e, ok := er.(map[string]any)
		code, hasCode := e["code"]
		title, hasTitle := e["title"]
		t, isStr := title.(string)
		if status != "failed" || !ok || (hasCode && !isWhole(code)) || (hasTitle && (!isStr || language.UTF16Len(t) > 200)) {
			return nil, "status.error is only for a failed status: {code: a whole number, title: up to 200 characters}, both optional."
		}
		kept := map[string]any{}
		if hasCode {
			kept["code"] = code
		}
		if hasTitle {
			kept["title"] = t
		}
		out["error"] = kept
	}
	return map[string]any{"kind": "message_status", "status": out}, ""
}

// CheckRecovery is events.ts checkRecovery: the body of POST /internal/recover.
func CheckRecovery(body any) (map[string]any, string) {
	b, ok := body.(map[string]any)
	id, _ := b["id"].(string)
	cs, _ := b["case"].(string)
	action, _ := b["action"].(string)
	if !ok || !requestIDRe.MatchString(id) || !caseID.MatchString(cs) || !actionNameRe.MatchString(action) {
		return nil, `Send {"id": up to 64 letters, digits and hyphens, "case": the booking or fee ("b-3"), "action": a name like "recheck_payment"}.`
	}
	return map[string]any{"kind": "recovery", "id": id, "case": cs, "action": action}, ""
}

// ---- the channel's events (modules/channels/events.ts) ---------------------------------------------------------------------------------------------------

// ChatTextMax is channels/events.ts CHAT_TEXT_MAX.
const ChatTextMax = 500

// NormalisePhone is contact.ts normalisePhone: an Indian mobile written any usual way, or another country's number in full with its +; "" when it is not one.
func NormalisePhone(raw any) string {
	s, ok := raw.(string)
	if !ok || language.UTF16Len(s) > 32 {
		return ""
	}
	t := language.TrimJS(s)
	if t == "" {
		return ""
	}
	digits := make([]byte, 0, len(t))
	for i, c := range t {
		switch {
		case c >= '0' && c <= '9':
			digits = append(digits, byte(c))
		case c == '+' && i == 0, c == '(', c == ')', c == '.', c == '-', language.IsJSSpace(c):
		default:
			return "" // /^\+?[\d\s().-]+$/u
		}
	}
	if t == "+" {
		return ""
	}
	d := string(digits)
	if strings.HasPrefix(t, "+") {
		if strings.HasPrefix(d, "91") {
			if regexp.MustCompile(`^91[6-9]\d{9}$`).MatchString(d) {
				return "+" + d
			}
			return ""
		}
		if regexp.MustCompile(`^[1-9]\d{7,14}$`).MatchString(d) {
			return "+" + d
		}
		return ""
	}
	local := d
	if len(d) == 11 && strings.HasPrefix(d, "0") {
		local = d[1:]
	} else if len(d) == 12 && strings.HasPrefix(d, "91") {
		local = d[2:]
	}
	if regexp.MustCompile(`^[6-9]\d{9}$`).MatchString(local) {
		return "+91" + local
	}
	return ""
}

var nameRe = regexp.MustCompile(`^[\p{L}\p{M}][\p{L}\p{M} .'-]*$`)

// NormaliseName is contact.ts normaliseName: NFC, every run of (JavaScript) white space one space, trimmed, 1 to 60 UTF-16 units, letters of any script and . ' - only.
func NormaliseName(raw any) string {
	s, ok := raw.(string)
	if !ok {
		return ""
	}
	name := squash(norm.NFC.String(s))
	if name == "" || language.UTF16Len(name) > 60 || !nameRe.MatchString(name) {
		return ""
	}
	return name
}

// stripControls is the chat's `text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")`.
func stripControls(s string) string {
	return strings.Map(func(r rune) rune {
		if (r <= 0x08) || r == 0x0b || r == 0x0c || (r >= 0x0e && r <= 0x1f) || r == 0x7f {
			return -1
		}
		return r
	}, s)
}

// CheckChannelEvent is channels/events.ts checkChannelEvent: one event from the front, checked for shape; the checked event, or the sentence that refuses it.
func CheckChannelEvent(raw any) (map[string]any, string) {
	e, ok := raw.(map[string]any)
	if !ok {
		return nil, "The event must be an object with a kind."
	}
	id, _ := e["id"].(string)
	if !requestIDRe.MatchString(id) {
		return nil, "The event needs an id: up to 64 letters, digits and hyphens."
	}
	switch e["kind"] {
	case "owner_action":
		action, _ := e["action"].(string)
		if !contains(ownerActions, action) {
			return nil, "An owner_action's action is one of " + strings.Join(ownerActions, ", ") + "."
		}
		cs, _ := e["case"].(string)
		if !caseID.MatchString(cs) {
			return nil, `An owner_action names its case ("b-3").`
		}
		if (action == "card_yes" || action == "card_no") && !cardID.MatchString(cs) {
			return nil, `A card's answer names the card ("c-3").`
		}
		digest, _ := e["digest"].(string)
		if !digest32.MatchString(digest) {
			return nil, "An owner_action carries the digest of the action as it was shown (32 hex digits)."
		}
		out := map[string]any{"kind": "owner_action", "id": id, "action": action, "case": cs, "digest": digest}
		if a, given := e["amountPaise"]; given && (action == "cash" || action == "bank") {
			n, ok := a.(float64)
			if !ok || !isWhole(a) || n < 100 || n > 10_000_000_00 || math.Mod(n, 100) != 0 {
				return nil, "A part marked received is a whole number of rupees, given as paise (amountPaise)."
			}
			out["amountPaise"] = n
		}
		return out, ""
	case "owner_signin":
		return map[string]any{"kind": "owner_signin", "id": id}, ""
	case "owner_message":
		t, _ := e["text"].(string)
		t = language.TrimJS(t)
		if t == "" || language.UTF16Len(t) > 900 {
			return nil, "An owner_message carries the owner's words: 1 to 900 characters."
		}
		return map[string]any{"kind": "owner_message", "id": id, "text": t}, ""
	case "chat_message":
		return checkChat(e, id)
	case "channel_request":
	default:
		return nil, `The kind must be "channel_request", "owner_action", "owner_message", "owner_signin" or "chat_message".`
	}
	channel, _ := e["channel"].(string)
	if channel != "web" && channel != "mcp" {
		return nil, `A channel_request's channel is "web" or "mcp".`
	}
	handle, _ := e["handle"].(string)
	if !HandleHash.MatchString(handle) {
		return nil, "A channel_request carries its handle's hash (64 hex digits), never the handle."
	}
	base := map[string]any{"kind": "channel_request", "id": id, "channel": channel, "handle": handle}
	upi := func(out map[string]any) {
		if s, ok := e["upiRef"].(string); ok && upiRefRe.MatchString(language.TrimJS(s)) {
			out["upiRef"] = language.TrimJS(s)
		}
	}
	op, _ := e["op"].(string)
	switch op {
	case "cancel", "paid":
		base["op"] = op
		if op == "paid" {
			upi(base)
		}
		return base, ""
	case "fee_pay", "fee_paid":
		if channel != "web" {
			return nil, `A parent's request comes from their page only (channel "web").`
		}
		parent, _ := e["parent"].(string)
		if !HandleHash.MatchString(parent) {
			return nil, "A parent's request carries the hash of their private link (64 hex digits), never the link."
		}
		due, _ := e["dueId"].(string)
		if !dueIDRe.MatchString(due) {
			return nil, `A parent's request names the fee ("f-3").`
		}
		out := map[string]any{"kind": "channel_request", "id": id, "channel": "web", "op": op, "parent": parent, "dueId": due, "handle": handle}
		if op == "fee_paid" {
			upi(out)
		}
		return out, ""
	case "order":
		return checkOrder(e, base)
	case "book":
	default:
		return nil, `A channel_request's op is "book", "order", "fee_pay", "fee_paid", "cancel" or "paid".`
	}
	sid, _ := e["serviceId"].(string)
	if !serviceIDRe.MatchString(sid) {
		return nil, "A booking names its service (serviceId)."
	}
	start, ok := e["startMs"].(float64)
	if !ok || !isWhole(e["startMs"]) || start <= 0 {
		return nil, "A booking gives its start as epoch milliseconds (startMs)."
	}
	name := NormaliseName(e["name"])
	if name == "" {
		return nil, "A booking needs the customer's name: 1 to 60 letters."
	}
	phone := NormalisePhone(e["phone"])
	if typed, _ := e["phone"].(string); phone == "" || phone != typed {
		return nil, "A booking needs the customer's number in full, as +91 and ten digits."
	}
	lang, _ := e["language"].(string)
	if !contains(LANGUAGES, lang) {
		return nil, "A booking's language is one of en, hi, ml, kn."
	}
	base["op"], base["serviceId"], base["startMs"], base["name"], base["phone"], base["language"] = "book", sid, start, name, phone, lang
	return base, ""
}

func checkChat(e map[string]any, id string) (map[string]any, string) {
	handle, _ := e["handle"].(string)
	if !HandleHash.MatchString(handle) {
		return nil, "A chat_message carries the guest's hash (64 hex digits), never the handle."
	}
	lang, _ := e["language"].(string)
	if !contains(LANGUAGES, lang) {
		return nil, "A chat_message's language is one of en, hi, ml, kn."
	}
	rawText, hasText := e["text"].(string)
	text := ""
	if hasText {
		text = language.TrimJS(stripControls(rawText))
	}
	_, tap := e["tap"]
	_, quick := e["quick"]
	_, forget := e["forget"]
	ways := 0
	for _, w := range []bool{hasText, tap, quick, forget} {
		if w {
			ways++
		}
	}
	if ways != 1 {
		return nil, "A chat_message is text, a tap, a quick tap or a forget: one of them."
	}
	base := map[string]any{"kind": "chat_message", "id": id, "handle": handle, "language": lang}
	if p, given := e["parent"]; given {
		s, ok := p.(string)
		if !ok || !HandleHash.MatchString(s) {
			return nil, "A parent's chat names the parent's link by its hash (64 hex digits)."
		}
		base["parent"] = s
	}
	switch {
	case forget:
		if e["forget"] != true {
			return nil, "forget is true."
		}
		base["forget"] = true
	case hasText:
		// [...text].length: code points
		if text == "" || len([]rune(text)) > ChatTextMax {
			return nil, "A chat_message's text is 1 to 500 characters."
		}
		base["text"] = text
	case tap:
		t, ok := e["tap"].(string)
		if !ok || !tapRe.MatchString(t) {
			return nil, "A tap names the button or row's id."
		}
		base["tap"] = t
	default:
		q, _ := e["quick"].(float64)
		if q != 1 && q != 2 && q != 3 {
			return nil, "A quick tap is 1, 2 or 3."
		}
		base["quick"] = q
	}
	return base, ""
}

func checkOrder(e, base map[string]any) (map[string]any, string) {
	list, ok := e["lines"].([]any)
	if !ok || len(list) == 0 || len(list) > 20 {
		return nil, "An order carries 1 to 20 lines."
	}
	var lines []any
	seen := map[string]bool{}
	for _, raw := range list {
		l, ok := raw.(map[string]any)
		item, _ := l["itemId"].(string)
		if !ok || !serviceIDRe.MatchString(item) {
			return nil, "Each line names an item of the shop's menu (itemId)."
		}
		q, isNum := l["qty"].(float64)
		if !isNum || !isWhole(l["qty"]) || q < 1 || q > 99 {
			return nil, "Each line's quantity is a whole number from 1 to 99."
		}
		if seen[item] {
			return nil, "An item is named once in an order."
		}
		seen[item] = true
		lines = append(lines, map[string]any{"itemId": item, "qty": q})
	}
	date, _ := e["date"].(string)
	if !dateRe.MatchString(date) {
		return nil, "An order names its day as YYYY-MM-DD (date)."
	}
	mode, _ := e["mode"].(string)
	if mode != "pickup" && mode != "delivery" {
		return nil, `An order's mode is "pickup" or "delivery".`
	}
	slot, _ := e["slotId"].(string)
	if !serviceIDRe.MatchString(slot) {
		return nil, "An order names its slot (slotId)."
	}
	address := ""
	if a, ok := e["address"].(string); ok {
		address = language.UTF16Slice(squash(strings.Map(func(r rune) rune {
			if r <= 0x1f || r == 0x7f {
				return ' '
			}
			return r
		}, a)), 120)
	}
	if mode == "delivery" && address == "" {
		return nil, "A delivery names its address."
	}
	name := NormaliseName(e["name"])
	if name == "" {
		return nil, "An order needs the customer's name: 1 to 60 letters."
	}
	phone := NormalisePhone(e["phone"])
	if typed, _ := e["phone"].(string); phone == "" || phone != typed {
		return nil, "An order needs the customer's number in full, as +91 and ten digits."
	}
	lang, _ := e["language"].(string)
	if !contains(LANGUAGES, lang) {
		return nil, "An order's language is one of en, hi, ml, kn."
	}
	out := map[string]any{}
	for k, v := range base {
		out[k] = v
	}
	out["op"], out["lines"], out["date"], out["mode"], out["slotId"], out["name"], out["phone"], out["language"] = "order", lines, date, mode, slot, name, phone, lang
	if mode == "delivery" {
		out["address"] = address
	}
	return out, ""
}
