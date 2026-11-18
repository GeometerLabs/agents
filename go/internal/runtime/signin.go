package runtime

// The owner's sign-in as the HTTP layer uses it: the owner and the address as they are NOW (read fresh from the shop's folder on every call, because the deployer may change them at
// any time), the panel's "sign out every device" moment, and the Operator's setup code. The Go twin of modules/channels/owner-signin.ts `http`.

import (
	"path/filepath"

	"github.com/GeometerLabs/agents/go/internal/access"
)

func (r *Runtime) pages() *access.Pages {
	return access.ReadPages(filepath.Join(r.o.Client.Folder, access.PagesFile))
}

// who is the owner as the settings and the deployer say now; false while the shop has no pages file (no owner sign-in at all).
func (r *Runtime) who() (access.Who, bool) {
	p := r.pages()
	if p == nil || r.o.Access == nil {
		return access.Who{}, false
	}
	return access.Who{Owner: r.o.Client.Settings.Owner.Whatsapp, Base: p.OwnerBase}, true
}

func (r *Runtime) endBefore() *int64 {
	if at, ok := access.EndBefore(filepath.Join(r.o.Client.Folder, access.OwnerSessionsFile)); ok {
		return &at
	}
	return nil
}

func (r *Runtime) grants() *access.Grants {
	return access.ReadGrants(filepath.Join(r.o.Client.Folder, access.OwnerGrantsFile))
}

func (r *Runtime) passkeysBefore() *int64 {
	if g := r.grants(); g != nil && g.PasskeysBefore != nil {
		at := g.PasskeysBefore.UnixMilli()
		return &at
	}
	return nil
}

// OwnerLinkOK: the panel-made link against the hash the folder holds now.
func (r *Runtime) OwnerLinkOK(token string) bool {
	return access.OwnerLinkMatches(filepath.Join(r.o.Client.Folder, access.OwnerLinkFile), token)
}

// SessionOK: a session this runtime made and still holds good (the owner's number and address unchanged, made after the panel's last "sign out every device").
func (r *Runtime) SessionOK(token string) bool {
	w, ok := r.who()
	if !ok {
		return false
	}
	_, good := r.o.Access.Check(token, w, r.o.Now(), r.endBefore())
	return good
}

// PasskeysOn: the shop has a pages file and an owner sign-in.
func (r *Runtime) PasskeysOn() bool { _, ok := r.who(); return ok }

// LinkState is what a sign-in link is now.
func (r *Runtime) LinkState(token string) string {
	w, ok := r.who()
	if !ok {
		return "unknown"
	}
	return r.o.Access.LinkState(token, w, r.o.Now())
}

// ConsumeLink uses a link up.
func (r *Runtime) ConsumeLink(token string) (access.Session, string) {
	w, ok := r.who()
	if !ok {
		return access.Session{}, "unknown"
	}
	s, state, err := r.o.Access.Consume(token, w, r.o.Now())
	if err != nil {
		r.o.Log("A sign-in link could not be used: " + err.Error())
		return access.Session{}, "unknown"
	}
	return s, state
}

// EndSession is the owner signing out; the short id of the session that ended, or "".
func (r *Runtime) EndSession(token string) string { return r.o.Access.End(token, r.o.Now()) }

// Passkeys is how many passkeys the owner has here.
func (r *Runtime) Passkeys() int {
	w, ok := r.who()
	if !ok || r.grants() == nil {
		return 0
	}
	rp, ok := originOf(w.Base)
	if !ok {
		return 0
	}
	return r.o.Access.Passkeys(w, rp, r.passkeysBefore())
}

// ShopName is the name passkeys are made under.
func (r *Runtime) ShopName() string { return r.o.Client.Settings.Name }

// GrantState is a setup code or recovery code as it stands now.
func (r *Runtime) GrantState(g access.Grant) string {
	if _, ok := r.who(); !ok || r.grants() == nil {
		return "unknown"
	}
	return r.o.Access.GrantState(g, r.grants(), r.o.Now())
}

// CodesLocked: too many wrong recovery codes today.
func (r *Runtime) CodesLocked() bool { return r.o.Access.CodesLocked(r.o.Now()) }

// NoteWrongCode counts a wrong recovery code.
func (r *Runtime) NoteWrongCode() { r.o.Access.NoteWrongCode(r.o.Now()) }

// RegistrationOptions: what the setup page hands to the browser.
func (r *Runtime) RegistrationOptions(g access.Grant) (map[string]any, string) {
	w, ok := r.who()
	g0 := r.grants()
	rp, ok2 := originOf(w.Base)
	if !ok || g0 == nil || !ok2 {
		return nil, "unknown"
	}
	return r.o.Access.RegistrationOptions(g, g0, w, rp, r.ShopName(), r.o.Now())
}

// Register finishes a registration.
func (r *Runtime) Register(g access.Grant, response map[string]any) access.RegisterResult {
	w, ok := r.who()
	g0 := r.grants()
	rp, ok2 := originOf(w.Base)
	if !ok || g0 == nil || !ok2 {
		return access.RegisterResult{State: "unknown"}
	}
	return r.o.Access.Register(g, g0, w, rp, r.ShopName(), response, r.o.Now())
}

// SigninOptions: what the sign-in page hands to the browser.
func (r *Runtime) SigninOptions() map[string]any {
	w, ok := r.who()
	rp, ok2 := originOf(w.Base)
	if !ok || r.grants() == nil || !ok2 {
		return map[string]any{"count": 0}
	}
	return r.o.Access.SigninOptions(w, rp, r.o.Now(), r.passkeysBefore())
}

// Signin finishes a sign-in.
func (r *Runtime) Signin(response map[string]any) access.SigninResult {
	w, ok := r.who()
	rp, ok2 := originOf(w.Base)
	if !ok || r.grants() == nil || !ok2 {
		return access.SigninResult{Why: "Passkeys are not on for this shop."}
	}
	return r.o.Access.Signin(response, w, rp, r.ShopName(), r.o.Now(), r.passkeysBefore())
}

// RecordAccess is a session's start or end, for the record: an event of the runtime's own, saved and run as a step like any other.
func (r *Runtime) RecordAccess(what, session, how string) {
	ev := map[string]any{"kind": "owner_access", "id": newUUID(), "what": what, "session": session}
	if how != "" {
		ev["how"] = how
	}
	if _, _, err := r.Submit([]map[string]any{ev}); err != nil {
		r.o.Log("A sign-in could not be written to the record: " + err.Error())
	}
	r.Kick()
}

// PagesURL is the shop's page on the pages domain and its address on its own server.
func (r *Runtime) PagesURL() (url, base string, ok bool) {
	p := r.pages()
	if p == nil {
		return "", "", false
	}
	return p.URL, p.Base, true
}
