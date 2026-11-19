package runtime

// The runtime's side of "keep this chat", "open my chat", "I have a new phone" and "delete my chat" (modules/channels/chat-identity-http.ts; W2, 17 Nov 2026), as one internal route the
// public front calls with the channel's own token: POST /internal/channel/chat-id. The front carries the browser's answers and nothing else: it has no key, no number and no list of who
// has what. Here the runtime, which is the authority, checks them (internal/chatid), counts what must be counted, and makes the events only a step may act on (a link to send, a thread to
// forget). The answers never say whether a number is known, or why a key was refused beyond "another shop's" or "did not work": nothing here lets a stranger learn who a shop knows.
//
// What is not here yet: the step that SENDS a link to a number (chat-link-send.ts: the WhatsApp message with the one-use link, in the guest's language). The route makes the same answers and
// saves the same `chat_link` event, and the event's task ends failed as not ported (Unported, Deferred.md); nothing is sent and no link is kept, so no guest is told something that did not
// happen. The customer's alerts (web push for a guest) are the push route's customer_* ops, which are not on for a template yet either.

import (
	"net/http"
	"path/filepath"
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/chatid"
)

// chatIdentity is the identity file of a shop that has a channel (start.ts: opened only with the owner's sign-in, which needs a channel token).
type chatIdentity struct{ store *chatid.Store }

func (c *chatIdentity) resolve(hash string) string { return c.store.Resolve(hash) }

// initChatIdentity opens the identity file for a shop with a channel token and a template with channels.
func (r *Runtime) initChatIdentity() error {
	if r.o.Access == nil || r.o.Kit == nil || r.o.Kit.Channel() == nil {
		return nil
	}
	st, err := chatid.Open(filepath.Join(r.o.Client.Config.DataDir, chatid.File))
	if err != nil {
		return err
	}
	r.routes.chatID = &chatIdentity{store: st}
	return nil
}

func (r *Runtime) closeChatIdentity() {
	if r.routes != nil && r.routes.chatID != nil {
		_ = r.routes.chatID.store.Close()
	}
}

// chatLinkEvent is the step of a `chat_link` event (chat-link-send.ts): not ported, so the task ends failed with the sentence.
func (r *Runtime) chatLinkEvent(map[string]any) error {
	return Unported("the link to a guest's number (a new phone, a number to confirm, the booking links)")
}

var digitsRe = regexp.MustCompile(`^[1-9]\d{9,14}$`)

// rpOf is the RP ID and origin of the page the browser is on: through the pages domain's door (`url`), or the shop's own server (`base`). From the pages file only, never a string the front
// sends.
func (r *Runtime) rpOf(via any) (chatid.RelyingParty, bool) {
	p := r.pages()
	if p == nil {
		return chatid.RelyingParty{}, false
	}
	address := p.Base
	if via == "door" && p.URL != "" {
		address = p.URL
	}
	u, err := parseURL(address)
	if err != nil {
		return chatid.RelyingParty{}, false
	}
	return chatid.RelyingParty{RpID: u.Hostname(), Origin: u.Scheme + "://" + u.Host}, true
}

// chatID is `POST /internal/channel/chat-id` (chat-identity-http.ts `call`).
func (s *Server) chatID(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "POST"); err != nil {
		return err
	}
	id := s.rt.routes.chatID
	if id == nil {
		send(w, 404, errBody("This shop has no chat identity."))
		return nil
	}
	v, ok := readJSON(w, r, 32*1024)
	if !ok {
		return nil
	}
	body, _ := v.(map[string]any)
	if body == nil {
		body = map[string]any{}
	}
	rt, st, now := s.rt, id.store, s.rt.o.Now()
	answer := func(status int, b map[string]any) error { send(w, status, b); return nil }
	handle := ""
	if h, isText := body["handle"].(string); isText && HandleHash.MatchString(h) {
		handle = h
	}
	op, _ := body["op"].(string)
	lang := "en"
	if l, isText := body["language"].(string); isText && contains(LANGUAGES, l) {
		lang = l
	}
	token := func() string {
		if t, isText := body["token"].(string); isText && chatid.LinkToken.MatchString(t) {
			return t
		}
		return ""
	}
	// the confirm page is opened from WhatsApp on any phone: it names a link, not a guest
	if op == "confirm_state" || op == "confirm_use" {
		t := token()
		if st.WrongLinksLocked(now) {
			return answer(429, map[string]any{"reason": "wait"})
		}
		if t == "" {
			st.NoteWrongLink(now)
			return answer(404, map[string]any{"state": "unknown"})
		}
		if op == "confirm_state" {
			state := st.ConfirmState(t, now)
			if state == "unknown" {
				st.NoteWrongLink(now)
			}
			return answer(200, map[string]any{"state": state})
		}
		stopped, err := st.ConfirmNumber(t, now)
		if err != nil {
			return err
		}
		if stopped == "" {
			return answer(200, map[string]any{"ok": true})
		}
		if stopped == "unknown" {
			st.NoteWrongLink(now)
		}
		return answer(200, map[string]any{"ok": false, "state": stopped})
	}
	if handle == "" {
		return answer(400, map[string]any{"error": "Send a guest's hash."})
	}
	thread := st.Resolve(handle)
	known, work := ChatKnown(s.chatChannel(), thread), 0
	rp, hasRP := rt.rpOf(body["via"])
	submit := func(ev map[string]any) error {
		if _, _, err := rt.SubmitKit([]map[string]any{ev}); err != nil {
			return err
		}
		rt.Kick()
		return nil
	}
	noPages := map[string]any{"error": "This shop has no page address yet."}
	switch op {
	case "state":
		// what the page may offer: only after a booking or an order was made (or a thread that has one), and only to a guest whose thread the runtime knows
		keys := st.State(handle)
		if stt, _, _ := rt.KitState(); stt != nil {
			work = rt.o.Kit.Channel().ChatWork(stt, ChatConversationOf(thread))
		}
		return answer(200, map[string]any{"keys": keys.Keys, "here": keys.Here, "number": keys.Number, "work": work, "offer": known && work > 0 && !keys.Here, "restored": thread != handle, "known": known})
	case "signin_options":
		if !hasRP {
			return answer(404, noPages)
		}
		o, err := st.SigninOptions(rp, now)
		if err != nil {
			return err
		}
		return answer(200, map[string]any{"options": o})
	case "signin":
		if !hasRP {
			return answer(404, noPages)
		}
		response, _ := body["response"].(map[string]any)
		_, ok, why, err := st.Signin(handle, rp, rt.o.Client.Settings.Name, response, now)
		if err != nil {
			return err
		}
		if ok {
			return answer(200, map[string]any{"ok": true})
		}
		reason := "failed"
		if otherShop.MatchString(why) {
			reason = "other_shop"
		}
		return answer(403, map[string]any{"ok": false, "reason": reason})
	case "keep_options":
		if !hasRP || !known {
			return answer(404, map[string]any{"error": "There is no chat to keep yet."})
		}
		o, err := st.KeepOptions(handle, rp, shopNameOr(rt), now)
		if err != nil {
			return err
		}
		return answer(200, map[string]any{"options": o})
	case "keep":
		if !hasRP || !known {
			return answer(404, map[string]any{"error": "There is no chat to keep yet."})
		}
		response, _ := body["response"].(map[string]any)
		ok, _, err := st.Keep(handle, rp, shopNameOr(rt), response, now)
		if err != nil {
			return err
		}
		if ok {
			return answer(200, map[string]any{"ok": true})
		}
		return answer(403, map[string]any{"ok": false, "reason": "failed"})
	case "number":
		digits, _ := body["digits"].(string)
		if !digitsRe.MatchString(digits) {
			return answer(400, map[string]any{"reason": "bad_number"})
		}
		if !known {
			return answer(404, map[string]any{"error": "There is no chat yet."})
		}
		// not kept yet: a link goes to the number, and it is the thread's contact only when its holder taps it (chat-link-send.ts, ConfirmNumber)
		if !st.CountConfirmAsk(handle, digits, now) {
			return answer(429, map[string]any{"reason": "wait"})
		}
		if err := submit(map[string]any{"kind": "chat_link", "id": newUUID(), "what": "confirm", "language": lang, "phone": digits, "handle": thread}); err != nil {
			return err
		}
		return answer(200, map[string]any{"ok": true, "pending": true})
	case "recover":
		// "I have a new phone": counted per number and per shop FIRST, then always the same answer, whether or not a thread has the number
		digits, _ := body["digits"].(string)
		if !digitsRe.MatchString(digits) {
			return answer(400, map[string]any{"reason": "bad_number"})
		}
		if !st.CountRecoveryAsk(digits, now) {
			return answer(429, map[string]any{"reason": "wait"})
		}
		if err := submit(map[string]any{"kind": "chat_link", "id": newUUID(), "what": "recover", "language": lang, "phone": digits}); err != nil {
			return err
		}
		return answer(200, map[string]any{"ok": true})
	case "links":
		if st.NumberOf(handle) == "" {
			return answer(200, map[string]any{"ok": false, "reason": "no_number"})
		}
		if !st.CountLinksAsk(handle, now) {
			return answer(429, map[string]any{"reason": "wait"})
		}
		if err := submit(map[string]any{"kind": "chat_link", "id": newUUID(), "what": "links", "language": lang, "handle": thread}); err != nil {
			return err
		}
		return answer(200, map[string]any{"ok": true})
	case "link_state", "use_link":
		t := token()
		if st.WrongLinksLocked(now) {
			return answer(429, map[string]any{"reason": "wait"})
		}
		if t == "" {
			st.NoteWrongLink(now)
			return answer(404, map[string]any{"state": "unknown"})
		}
		if op == "link_state" {
			state := st.LinkState(t, now)
			if state == "unknown" {
				st.NoteWrongLink(now)
			}
			return answer(200, map[string]any{"state": state})
		}
		_, stopped, err := st.UseLink(t, handle, now)
		if err != nil {
			return err
		}
		if stopped == "" {
			return answer(200, map[string]any{"ok": true})
		}
		if stopped == "unknown" {
			st.NoteWrongLink(now)
		}
		return answer(200, map[string]any{"ok": false, "state": stopped})
	case "forget":
		// "Delete my chat": the keys, number and ties first (here), then the words by a step (chat.go ForgetChat); a guest's alerts go with them when the template has any
		g, err := st.Forget(handle)
		if err != nil {
			return err
		}
		if err := submit(map[string]any{"kind": "chat_message", "id": newUUID(), "handle": g, "language": lang, "forget": true}); err != nil {
			return err
		}
		return answer(200, map[string]any{"ok": true})
	}
	return answer(400, map[string]any{"error": "That is not something this route does."})
}

var otherShop = regexp.MustCompile(`another shop|not one of this shop`)

func shopNameOr(r *Runtime) string {
	if n := r.o.Client.Settings.Name; n != "" {
		return n
	}
	return "Shop"
}

// chatChannel is the template's channel state in the last saved state (nil when it cannot be read: a guest is then unknown, as a made-up handle is).
func (s *Server) chatChannel() *ChannelState {
	st, _, _ := s.rt.KitState()
	cs, err := s.rt.channelOf(st)
	if err != nil {
		return EmptyChannel()
	}
	return cs
}
