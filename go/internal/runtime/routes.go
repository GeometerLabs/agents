package runtime

// What the routes of the listings wave share (owner-limits and limit-changes, owner-file, push): one small struct hung on the Runtime so runtime.go carries a single field and three
// one-line calls (New, Start, Close).
//
// What those routes must know about an owner's session beyond "it is good" (was it made with a PASSKEY, which passkey, is the shop locked) is answered by the owner's sign-in
// itself (owner.go: PasskeySession, OwnerPushOp), over the same owner-access store and under the same owner lock as every other owner rule, so a failure of that store refuses
// (the route stops, as TypeScript's throw does) instead of reading as "no passkey" or "not locked".

import (
	"sync"

	"github.com/GeometerLabs/agents/go/internal/push"
)

// routes is the state of these routes on one Runtime.
type routes struct {
	push    *push.Push
	sender  *push.Sender
	pushCfg pushConfig
	fileMu  sync.Mutex // the owner's file is taken once: one request at a time checks and marks it
	// chatRate is the chat's rates, in memory (chat.go Rate): a restart forgetting them costs nothing; what must survive a restart is the saved day's caps
	chatRate *Rate
	chatID   *chatIdentity // who a chat guest is (chatid.go); nil: every guest is the cookie alone
}

// initRoutes opens what the routes keep (the push store, when the shop has a channel token).
func (r *Runtime) initRoutes() error {
	r.routes = &routes{chatRate: NewRate(r.o.Now)}
	if err := r.initPush(); err != nil {
		return err
	}
	return r.initChatIdentity()
}

// startRoutes starts what runs on its own: the push sender, when push is on.
func (r *Runtime) startRoutes() {
	if r.routes.push != nil && r.routes.push.On {
		r.routes.sender.Start()
	}
}

// closeRoutes stops the sender and closes what was opened.
func (r *Runtime) closeRoutes() {
	r.closeChatIdentity()
	if r.routes.sender != nil {
		r.routes.sender.Stop()
	}
	if r.routes.push != nil {
		_ = r.routes.push.Store().Close()
	}
}
