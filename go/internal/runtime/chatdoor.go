package runtime

// The two translations every chat call goes through at the runtime's door (chat-identity-http.ts openEvent, openRead): a guest's hash becomes the thread a passkey or a link tied it
// to, and a parent's chat names the parent's private link and becomes the parent's own thread. Only a Fees centre has parents (no template offers them yet), and the
// identity (chatidroute.go, internal/chatid) is on only when the shop has it: without either, a guest is the cookie alone and a parent's link opens nothing.

import "net/url"

// openEvent changes a chat_message's handle to its thread (the runtime's own copy of the event). False: the link opens nothing now.
func (r *Runtime) openEvent(ev map[string]any) bool {
	if _, parent := ev["parent"]; parent {
		return false // no Fees centre in this runtime yet
	}
	if id := r.routes.chatID; id != nil {
		h, _ := ev["handle"].(string)
		ev["handle"] = id.resolve(h)
	}
	return true
}

// openRead is the hash to look a thread up by, for a read or an alert call; false for a parent's link that opens nothing now.
func (r *Runtime) openRead(handle, parent string) (string, bool) {
	if parent != "" {
		return "", false
	}
	if id := r.routes.chatID; id != nil {
		return id.resolve(handle), true
	}
	return handle, true
}

// parseURL is net/url's Parse, kept in one place so the identity's address reading says what it reads.
func parseURL(s string) (*url.URL, error) { return url.Parse(s) }
