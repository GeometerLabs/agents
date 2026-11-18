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
}

// initRoutes opens what the routes keep (the push store, when the shop has a channel token).
func (r *Runtime) initRoutes() error {
	r.routes = &routes{}
	return r.initPush()
}

// startRoutes starts what runs on its own: the push sender, when push is on.
func (r *Runtime) startRoutes() {
	if r.routes.push != nil && r.routes.push.On {
		r.routes.sender.Start()
	}
}

// closeRoutes stops the sender and closes what was opened.
func (r *Runtime) closeRoutes() {
	if r.routes.sender != nil {
		r.routes.sender.Stop()
	}
	if r.routes.push != nil {
		_ = r.routes.push.Store().Close()
	}
}
