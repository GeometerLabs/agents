package runtime

// The chat's HTTP routes on the channel (modules/runtime/http.ts, W1 and W2): a guest's thread read, hold-to-talk's recording, and the door a guest's send passes (its rates, and a
// parent's or an identity's translation of the guest's hash). The state they read is the template's `channel` member, parsed by chatstate.go; nothing here saves a thing except by
// submitting an event, which a step then runs (the runtime's own one-at-a-time queue), exactly as TypeScript does.
//
// A template that has no chat (no channel kit) answers these as it answers any route it has not: 404. A template's channel state is found by an optional method of its kit
// (ChannelStater); without it the member is read out of the saved state's own members, which costs a serialisation per read but needs nothing from the template.

import (
	"encoding/json"
	"net/http"
	"regexp"
)

// ChannelStater is what a template may offer to make the chat's reads cheap: its `channel` member, raw. Without it the runtime takes the member from KitState.Members().
type ChannelStater interface {
	ChannelRaw(s KitState) json.RawMessage
}

// ChatVoiceKit is what a template with a speech service offers hold-to-talk: it holds a recording in memory only (a drop of its own, never the owner's) and gives its reference for a
// chat_message's `voice`. A template without it has no voice: the route says so and the thread read carries no `listen`.
type ChatVoiceKit interface {
	HoldChatAudio(a PageAudio) string
}

// ConversationRetentionDays is core.ts CONVERSATION_RETENTION_DAYS: how long the text of a finished conversation is kept.
const ConversationRetentionDays = 30

// maxVoiceBytes is channels/owner-audio.ts MAX_VOICE_BYTES.
const maxVoiceBytes = 256 * 1024

var audioType = regexp.MustCompile(`(?i)^audio/(ogg|webm)\b`)

// channelOf is the template's channel state in a saved state; a fresh one when it has none.
func (r *Runtime) channelOf(st KitState) (*ChannelState, error) {
	if st == nil {
		return EmptyChannel(), nil
	}
	if cs, ok := r.o.Kit.(ChannelStater); ok {
		return ParseChannel(cs.ChannelRaw(st))
	}
	members, err := st.Members()
	if err != nil {
		return nil, err
	}
	for _, m := range members {
		if m.Name == "channel" {
			return ParseChannel(m.Raw)
		}
	}
	return EmptyChannel(), nil
}

// chatAllowed is http.ts chatAllowed: whether this guest's send may go on (the minute's, the shop's and the new-guest counts), counted when it does.
func (s *Server) chatAllowed(handle string) bool {
	known := false
	if st, _, _ := s.rt.KitState(); st != nil {
		if cs, err := s.rt.channelOf(st); err == nil {
			known = ChatKnown(cs, handle)
		}
	}
	return s.rt.routes.chatRate.ChatAllowed(handle, known)
}

// chatRead is `GET /internal/channel/chat?handle=<64 hex>[&after=N][&cid=<id>][&parent=<64 hex>]`: a chat guest's thread (an empty one for a guest never seen), and where the send `cid` stands.
func (s *Server) chatRead(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "GET"); err != nil {
		return err
	}
	q := r.URL.Query()
	handle := q.Get("handle")
	if !HandleHash.MatchString(handle) {
		send(w, 400, errBody("handle is the guest's hash: 64 hex digits."))
		return nil
	}
	var after int64
	if a, given := q["after"]; given {
		if !afterRe.MatchString(a[0]) {
			send(w, 400, errBody("after is a line number."))
			return nil
		}
		for _, c := range a[0] {
			after = after*10 + int64(c-'0')
		}
	}
	cid := q.Get("cid")
	if _, given := q["cid"]; given && !requestID.MatchString(cid) {
		send(w, 400, errBody("cid is a send's id."))
		return nil
	}
	parent, hasParent := q["parent"]
	if hasParent && !HandleHash.MatchString(parent[0]) {
		send(w, 400, errBody("parent is a private link's hash: 64 hex digits."))
		return nil
	}
	if s.rt.o.Kit.Channel() == nil {
		return nothing
	}
	thread, ok := s.rt.openRead(handle, firstOf(parent))
	if !ok {
		send(w, 404, errBody("That link opens nothing now."))
		return nil
	}
	st, _, _ := s.rt.KitState()
	cs, err := s.rt.channelOf(st)
	if err != nil {
		return err
	}
	now := s.rt.o.Now()
	read := ReadChatThread(cs, thread, after, ConversationRetentionDays, s.rt.clock.Day(now), s.rt.policy.Budget).JSON()
	if cid != "" {
		switch s.rt.TaskState(ChatTaskKey(thread, cid)) {
		case "":
		case "failed":
			read.put("send", `"failed"`)
		case "done":
			read.put("send", `"done"`)
		default:
			read.put("send", `"pending"`)
		}
	}
	if p := s.rt.personality(); p != "" {
		read.put("personality", jtext(p))
	}
	if _, voice := s.rt.o.Kit.(ChatVoiceKit); voice {
		read.put("listen", "true")
	}
	send(w, 200, json.RawMessage(read.done()))
	return nil
}

func firstOf(v []string) string {
	if len(v) == 0 {
		return ""
	}
	return v[0]
}

// personality is the character's small-talk personality, when settings.assistant.character names one (core.ts: only a set value is sent).
func (r *Runtime) personality() string {
	a, _ := r.o.Client.Settings.Raw["assistant"].(map[string]any)
	c, _ := a["character"].(map[string]any)
	p, _ := c["personality"].(string)
	return p
}

// chatVoice is `POST /internal/channel/chat-voice?handle=&lang=&id=`: hold-to-talk, a guest's recording from the shop's front. Held in this process's memory only; the saved event carries its
// reference, never the audio. Without a voice service the route says so, before it reads anything.
func (s *Server) chatVoice(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "POST"); err != nil {
		return err
	}
	vk, ok := s.rt.o.Kit.(ChatVoiceKit)
	if !ok {
		send(w, 404, errBody("Voice is not on for this shop."))
		return nil
	}
	q := r.URL.Query()
	handle, lang, id := q.Get("handle"), q.Get("lang"), q.Get("id")
	if !HandleHash.MatchString(handle) {
		send(w, 400, errBody("handle is the guest's hash: 64 hex digits."))
		return nil
	}
	if !contains(LANGUAGES, lang) {
		send(w, 400, errBody("lang is one of hi, en, ml, kn."))
		return nil
	}
	if !requestID.MatchString(id) {
		send(w, 400, errBody("id is a send's id."))
		return nil
	}
	m := audioType.FindStringSubmatch(r.Header.Get("content-type"))
	if m == nil {
		send(w, 415, errBody("Send the recording as audio/ogg or audio/webm (Opus)."))
		return nil
	}
	if !s.chatAllowed(handle) {
		send(w, 429, map[string]any{"error": "Too many messages. Wait a minute.", "rate": true}, "retry-after", "60")
		return nil
	}
	b, err := readBody(r, maxVoiceBytes)
	if err != nil {
		if he, isHTTP := err.(httpError); isHTTP {
			send(w, he.status, errBody(he.msg), "connection", "close")
			return nil
		}
		return err
	}
	if len(b) == 0 {
		send(w, 400, errBody("The recording is empty."))
		return nil
	}
	// the type is written by us, not copied from the request
	ref := vk.HoldChatAudio(PageAudio{Bytes: b, Mime: "audio/" + lower(m[1]) + "; codecs=opus"})
	return s.submitKit(w, []map[string]any{{"kind": "chat_message", "id": id, "handle": handle, "language": lang, "voice": ref}})
}

func lower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

// chatDoor is the door a chat_message passes before it is saved (http.ts, in the events route): a parent's link or an identity's tie turns the hash into the thread's, then the counts.
// It answers for the caller: ok=false means the response is written.
func (s *Server) chatDoor(w http.ResponseWriter, ev map[string]any) bool {
	if !s.rt.openEvent(ev) {
		send(w, 403, errBody("That link opens nothing now."))
		return false
	}
	if h, _ := ev["handle"].(string); !s.chatAllowed(h) {
		send(w, 429, map[string]any{"error": "Too many messages. Wait a minute.", "rate": true}, "retry-after", "60")
		return false
	}
	return true
}
