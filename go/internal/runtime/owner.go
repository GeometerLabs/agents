package runtime

// The owner's sign-in as the runtime uses it, and who controls it: the Go twin of modules/channels/owner-signin.ts (its `http` object, `tick`, `followLockedNumber`) and of
// the owner routes of modules/runtime/http.ts (owner-passkey, owner-phones, the /status lock, owner-session, the owner's side of push: who may subscribe, and the alerts to
// the owner's phones). The rules themselves are in go/internal/access; here is where
// the files are read (on every call: the deployer may change them at any time), the owner and the address are worked out NOW, and the steps of each route run in the
// TypeScript order.
//
// THE OWNER LOCK. TypeScript runs one route's owner calls without interleaving (one thread, and nothing awaited between them), so a due number change cannot apply between
// "who is the owner now" and "bind the new passkey to them". Go serves requests on many goroutines and ticks on another, so every route's whole owner sequence, the tick's owner
// part and every read of the owner's number hold `ownerMu`. Without it a tick applying a sale between `oWho` and `Register` would bind the new owner's phone to the OLD number
// (the third review round's bug, back as a race). Methods named o... expect the lock held; the exported ones take it.

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/push"
)

// THE OWNER'S PUSH. The shop's web push (routes.go initPush, Runtime.Push) is there for every shop with a channel token, and on only when runtime.json names a push Guard. At
// the TypeScript call sites below, what ENDS a subscription runs whenever push is there (`options.push?.dropUnbound()`: the first passkey ends the alerts no phone holds, a
// removed phone's alerts end with it, the phones page's Stop), and what TELLS or LISTS the owner's phones only when it is on (`options.push?.on`: the alerts in the owner's
// language, the phones page's list, /status's count). Who may subscribe is decided here too (OwnerPushOp), under the owner lock with the subscription itself, so a link's
// subscription can never land after the first passkey's DropUnbound.

func (r *Runtime) pages() *access.Pages {
	return access.ReadPages(filepath.Join(r.o.Client.Folder, access.PagesFile))
}

// settingsNumber is the owner's number as settings.json says it (read at start, as TypeScript reads it): never changed by the runtime. Every use goes through oNumber.
func (r *Runtime) settingsNumber() string { return r.o.Client.Settings.Owner.Whatsapp }

// oGrants is the Operator's file with Geometer's reset merged in from ITS OWN file (access.ReadGrants), read on every call.
func (r *Runtime) oGrants() *access.Grants {
	return access.ReadGrants(filepath.Join(r.o.Client.Folder, access.OwnerGrantsFile), filepath.Join(r.o.Client.Folder, access.OwnerResetFile))
}

// oSettingsWho is the owner number the settings say NOW, for noticing a change the Operator made (access.WatchOwner compares it with the locked one).
func (r *Runtime) oSettingsWho() (access.Who, bool) {
	p := r.pages()
	if p == nil {
		return access.Who{}, false
	}
	return access.Who{Owner: r.settingsNumber(), Base: p.OwnerBase}, true
}

// oNumber is the number the owner is reached on, evaluated on EVERY use (access.EffectiveNumber says why it is never fixed at start). The files are read into the store first,
// so a change that has just become due has already opened the gate: a sign-in or a registration in that moment binds to the number the settings say, never to the one the shop
// was locked with a moment ago.
func (r *Runtime) oNumber() (string, error) {
	if err := r.o.Access.Sync(r.oGrants(), r.o.Now()); err != nil {
		return r.settingsNumber(), err
	}
	return r.o.Access.EffectiveNumber(r.settingsNumber())
}

// oWho is the owner as the settings and the deployer say now; false while the shop has no pages file (no owner sign-in at all).
func (r *Runtime) oWho() (access.Who, bool, error) {
	p := r.pages()
	if p == nil {
		return access.Who{}, false, nil
	}
	n, err := r.oNumber()
	return access.Who{Owner: n, Base: p.OwnerBase}, err == nil, err
}

// oEndBefore is the panel's "sign out every device" moment, clamped to the runtime's own clock (access.ClampEndBefore says why).
func (r *Runtime) oEndBefore() *int64 {
	return r.o.Access.ClampEndBefore(access.EndBefore(filepath.Join(r.o.Client.Folder, access.OwnerSessionsFile)), r.o.Now())
}

// oPasskeysBefore is the moment before which no passkey works: the store's OWN value, never the Operator's file's.
func (r *Runtime) oPasskeysBefore() (*int64, error) {
	return r.o.Access.PasskeysBefore(r.oGrants(), r.o.Now())
}

// oCheck is a session good now (owner-signin.ts http.check): who now, the clock, the clamped sign-out moment, then the store's check, in that order.
func (r *Runtime) oCheck(session string) (string, bool, error) {
	w, ok, err := r.oWho()
	if !ok {
		return "", false, err
	}
	now := r.o.Now()
	id, good := r.o.Access.Check(session, w, now, r.oEndBefore())
	return id, good, nil
}

// oCheckPasskey is the same, and only when the session was made by a passkey.
func (r *Runtime) oCheckPasskey(session string) (string, bool, error) {
	w, ok, err := r.oWho()
	if !ok {
		return "", false, err
	}
	now := r.o.Now()
	id, good := r.o.Access.CheckPasskey(session, w, now, r.oEndBefore())
	return id, good, nil
}

// oPasskeysOn: the shop has an owner sign-in (a channel token, so an access store) and a pages file.
func (r *Runtime) oPasskeysOn() (bool, error) {
	if r.o.Access == nil {
		return false, nil
	}
	_, ok, err := r.oWho()
	return ok, err
}

// oPasskeys are the owner's phones that work now.
func (r *Runtime) oPasskeys() ([]access.Phone, error) {
	w, ok, err := r.oWho()
	if !ok {
		return []access.Phone{}, err
	}
	rp, okRP := originOf(w.Base)
	if !okRP {
		return []access.Phone{}, nil
	}
	pb, err := r.oPasskeysBefore()
	if err != nil {
		return nil, err
	}
	return r.o.Access.Passkeys(w, rp, pb)
}

// ownerName is the shop's name as a passkey's relying party shows it.
func (r *Runtime) ownerName() string {
	if n := r.o.Client.Settings.Name; n != "" {
		return n
	}
	return "Shop"
}

// ---- for the other routes and the steps ------------------------------------------------------------------------------------------------------------------

// OwnerLinkOK: the panel-made link against the hash the folder holds now.
func (r *Runtime) OwnerLinkOK(token string) bool {
	return access.OwnerLinkMatches(filepath.Join(r.o.Client.Folder, access.OwnerLinkFile), token)
}

// SessionOK: a session this runtime made and still holds good (the owner, as the lock says, and the address unchanged; made after the panel's last "sign out every device",
// which after the lock ends link sessions only).
func (r *Runtime) SessionOK(token string) bool {
	_, good := r.SessionCheck(token)
	return good
}

// SessionCheck is SessionOK with the session's short id, for a route that names the session in the record: the id of the same check that let the request in, never the token
// the browser sent (http.ts owner-file: a live token in the record would let anyone who reads it act as the owner).
func (r *Runtime) SessionCheck(token string) (string, bool) {
	if r.o.Access == nil {
		return "", false
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	id, good, err := r.oCheck(token)
	if err != nil {
		r.o.Log("The owner's session could not be checked: " + err.Error())
	}
	return id, good
}

// PasskeySession: the session is good AND was made with a passkey (owner-signin.ts http.checkPasskey), for the owner's limits page. A store that cannot be read answers no:
// nothing that needs a passkey is allowed.
func (r *Runtime) PasskeySession(token string) bool {
	if r.o.Access == nil {
		return false
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	_, good, err := r.oCheckPasskey(token)
	if err != nil {
		r.o.Log("The owner's session could not be checked: " + err.Error())
		return false
	}
	return good
}

// LinkState is what a sign-in link is now.
func (r *Runtime) LinkState(token string) string {
	if r.o.Access == nil {
		return "unknown"
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	w, ok, _ := r.oWho()
	if !ok {
		return "unknown"
	}
	return r.o.Access.LinkState(token, w, r.o.Now())
}

// ConsumeLink uses a link up.
func (r *Runtime) ConsumeLink(token string) (access.Session, string) {
	if r.o.Access == nil {
		return access.Session{}, "unknown"
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	w, ok, _ := r.oWho()
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
func (r *Runtime) EndSession(token string) string {
	if r.o.Access == nil {
		return ""
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	return r.o.Access.End(token, r.o.Now())
}

// ShopName is the name passkeys are made under.
func (r *Runtime) ShopName() string { return r.o.Client.Settings.Name }

// ownerNumberForLines is the number a step's record lines name the owner by: the settings' getter in TypeScript (EffectiveNumber, no file read).
func (r *Runtime) ownerNumberForLines() string {
	if r.o.Access == nil {
		return r.settingsNumber()
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	n, err := r.o.Access.EffectiveNumber(r.settingsNumber())
	if err != nil {
		r.o.Log("The owner's number could not be worked out: " + err.Error())
	}
	return n
}

// RecordAccess is a session's start or end, or what the owner did on the phones page, for the record: an event of the runtime's own, saved and run as a step like any other.
func (r *Runtime) RecordAccess(what, session, how, label string) {
	ev := map[string]any{"kind": "owner_access", "id": newUUID(), "what": what, "session": session}
	if how != "" {
		ev["how"] = how
	}
	if label != "" {
		ev["label"] = label
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

// ---- start and the clock's beat ------------------------------------------------------------------------------------------------------------------------

// ownerStart is followLockedNumber and the start of the owner's sign-in (owner-signin.ts): the settings' number learned when it is the locked one, a line when they differ, and
// a request that fell due while the runtime was down given a day more (access.NoteStart).
func (r *Runtime) ownerStart() (err error) {
	if r.o.Access == nil {
		return nil
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	defer access.Recover(&err)
	settings := r.settingsNumber()
	if err := r.o.Access.LearnNumber(settings); err != nil {
		return err
	}
	if locked, ok := r.o.Access.BoundNumber(); ok && locked != "" && locked != digitsOf(settings) {
		r.o.Log("The owner's number in the settings is not the one this shop was locked with; the owner's messages keep going to the locked number until the owner confirms the change.")
	}
	return r.o.Access.NoteStart(r.o.Now())
}

func digitsOf(s string) string {
	var b strings.Builder
	for _, c := range s {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	return b.String()
}

// ownerBeat is the owner's part of the clock's beat (owner-signin.ts tick): read the Operator's request and Geometer's reset into the store (so a request starts its wait, and a
// due one applies, even when no page is open), watch the owner's number, say each finding once in the record (and to the owner's phones), and the panel's "sign out every
// device" once. It returns the requests whose notice is in this step's lines: they are marked told only once the step is SAVED (Runtime.step).
func (r *Runtime) ownerBeat(rec *recorder) (told []string, err error) {
	if r.o.Access == nil {
		return nil, nil
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	// the time is read only now, with the lock held: a time taken before the wait could be older than a passkey a route made meanwhile, and a QR first seen by this beat
	// would then look "seen before the lock" (TypeScript reads the clock at each call too)
	now := r.o.Now()
	lang := r.o.Client.Settings.Owner.Language
	if err := r.o.Access.Sync(r.oGrants(), now); err != nil {
		r.o.Log("The owner's files could not be read into the store: " + err.Error())
		return nil, nil
	}
	if w, ok := r.oSettingsWho(); ok {
		// a different owner number in the settings after the lock is a request, not a change (access.WatchOwner)
		if err := r.o.Access.WatchOwner(w, now); err != nil {
			r.o.Log("The owner's number could not be checked: " + err.Error())
		}
	}
	notes, err := r.o.Access.TakeNotes()
	if err != nil {
		r.o.Log("The owner's notices could not be read: " + err.Error())
	}
	line := func(inputs map[string]string) {
		number, _ := r.oNumber()
		in := map[string]any{}
		for k, v := range inputs {
			in[k] = v
		}
		rec.append(NewLine{Conversation: number, Action: "owner_session", Outcome: "confirmed", Inputs: in, Language: lang, Refs: inputs})
	}
	// a push that could not be queued fails the step (nothing of it is saved, nothing is marked told), as TypeScript's throw from setup.alert does
	alert := func(what, by string) error { return r.alert(what, now, "", by) }
	for _, n := range notes {
		switch n.What {
		case "reset":
			line(map[string]string{"what": "owner_reset", "at": iso(n.At), "by": n.By, "reason": n.Reason})
		case "removal_asked":
			line(map[string]string{"what": "removal_asked", "by": n.AskedBy, "effectiveAt": iso(n.EffectiveAt)})
			if err := alert("removal_asked", n.AskedBy); err != nil {
				return nil, err
			}
			told = append(told, n.Key)
		case "removal_extended":
			line(map[string]string{"what": "removal_extended", "effectiveAt": iso(n.EffectiveAt)})
			what, by := "removal_asked", n.AskedBy
			if n.Kind == "owner_change" {
				what, by = "owner_change_asked", ""
			}
			if err := alert(what, by); err != nil {
				return nil, err
			}
			told = append(told, n.Key)
		case "owner_change_asked":
			line(map[string]string{"what": "owner_change_asked", "effectiveAt": iso(n.EffectiveAt)})
			if err := alert("owner_change_asked", ""); err != nil {
				return nil, err
			}
			told = append(told, n.Key)
		default:
			line(map[string]string{"what": "removal_applied", "at": iso(n.At)})
		}
	}
	at := r.oEndBefore()
	if at == nil {
		return told, nil
	}
	ended, err := r.o.Access.EndAllBefore(*at, r.o.Now())
	if err != nil || ended < 0 {
		return told, nil
	}
	number, _ := r.oNumber()
	rec.append(NewLine{Conversation: number, Action: "owner_session", Outcome: "confirmed", Inputs: map[string]any{"what": "all_ended", "endBefore": *at}, Language: lang, Refs: map[string]string{"what": "all_ended", "count": fmt.Sprint(ended)}})
	return told, nil
}

// markTold: the step that holds these requests' notice lines is saved, so they are never told again.
func (r *Runtime) markTold(keys []string) {
	if len(keys) == 0 {
		return
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	for _, k := range keys {
		if err := r.o.Access.MarkTold(k); err != nil {
			r.o.Log("A request's notice could not be marked told (it will be said again): " + err.Error())
		}
	}
}

// alert tells the owner's phones with alerts on, in the owner's language, word for word TypeScript's (assistant.Pack.OwnerAlert; the words are generated from owner-phones.ts
// and owner-signin.ts), tagged "phones" as TypeScript tags them. Push off: nothing to tell; the phones page shows it on the next open. The language is the settings' own: this
// runs with the owner lock held, so it must not ask r.owner(), which takes it. A push that could not be queued is an error, as TypeScript's throw is: the route answers 500,
// and the beat's step is not saved, so its notice is said (and pushed) again on the next beat.
func (r *Runtime) alert(what string, at int64, label, by string) error {
	if p := r.Push(); p != nil && p.On {
		_, err := r.PushOwner(assistant.Words(r.o.Client.Settings.Owner.Language).OwnerAlert(what, at, label, by), "phones")
		return err
	}
	return nil
}

// ---- /status ---------------------------------------------------------------------------------------------------------------------------------------------

// OwnerAccessStatus is /status's ownerAccess (http.ts): how the owner can sign in and hear (counts only), whether the shop is locked, and the Operator's pending request, for
// the panel to SHOW; the runtime has already decided both, whatever the panel does.
func (r *Runtime) OwnerAccessStatus() (map[string]any, error) {
	out := map[string]any{"passkeys": 0, "alertPhones": r.AlertPhones()}
	if r.o.Access == nil {
		return out, nil
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	on, err := r.oPasskeysOn()
	if err != nil {
		return nil, err
	}
	if on {
		locked, g, err := r.oLockState()
		if err != nil {
			return nil, err
		}
		removal, err := r.o.Access.PendingRemoval(g, r.o.Now())
		if err != nil {
			return nil, err
		}
		out["locked"] = locked
		if removal != nil {
			out["removal"] = map[string]any{"askedBy": removal.AskedBy, "effectiveAt": iso(removal.EffectiveAt)}
		}
	}
	if on2, err := r.oPasskeysOn(); err != nil {
		return nil, err
	} else if on2 {
		phones, err := r.oPasskeys()
		if err != nil {
			return nil, err
		}
		out["passkeys"] = len(phones)
	}
	return out, nil
}

// oLockState is owner-signin.ts http.lockState's lock: the settings' number watched first (a changed number after the lock becomes a request the moment anyone asks), then the
// files read for the lock. The grants it read are handed back for the pending request.
func (r *Runtime) oLockState() (bool, *access.Grants, error) {
	if sw, ok := r.oSettingsWho(); ok {
		if err := r.o.Access.WatchOwner(sw, r.o.Now()); err != nil {
			return false, nil, err
		}
	}
	g := r.oGrants()
	locked, err := r.o.Access.Locked(g, r.o.Now())
	return locked, g, err
}

// ---- POST /internal/channel/owner-passkey ------------------------------------------------------------------------------------------------------------------

// OwnerPasskey is the passkey route after its body is read (http.ts owner-passkey): the grant's state, the registration and the sign-in, every check here, in the TypeScript
// order. The status and the answer to send.
func (r *Runtime) OwnerPasskey(body map[string]any) (int, any, error) {
	notOn := map[string]any{"state": "unknown", "why": "Passkeys are not on for this shop."}
	if r.o.Access == nil {
		return 403, notOn, nil
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	if on, err := r.oPasskeysOn(); err != nil || !on {
		return 403, notOn, err
	}
	var grant *access.Grant
	if g, ok := body["grant"].(map[string]any); ok {
		if t, ok := g["token"].(string); ok && g["kind"] == "setup" {
			grant = &access.Grant{Kind: "setup", Token: cut(t, 64)}
		} else if c, ok := g["code"].(string); ok && g["kind"] == "recovery" {
			grant = &access.Grant{Kind: "recovery", Code: cut(c, 40)}
		}
	}
	switch op := body["op"]; op {
	case "grant_state", "register_options", "register":
		if grant == nil {
			return 400, errBody(`Send "grant": {"kind": "setup", "token"} or {"kind": "recovery", "code"}.`), nil
		}
		// a recovery code is a guess until it matches: too many wrong ones today and none is looked at
		if grant.Kind == "recovery" && r.o.Access.CodesLocked(r.o.Now()) {
			return 403, map[string]any{"state": "locked"}, nil
		}
		state, err := r.oGrantState(*grant)
		if err != nil {
			return 0, nil, err
		}
		if grant.Kind == "recovery" && state == "unknown" {
			r.o.Access.NoteWrongCode(r.o.Now())
		}
		switch op {
		case "grant_state":
			return 200, map[string]any{"state": state, "shop": r.ShopName()}, nil
		case "register_options":
			w, ok, err := r.oWho()
			if err != nil {
				return 0, nil, err
			}
			rp, okRP := originOf(w.Base)
			if !ok || !okRP {
				return 403, map[string]any{"state": "unknown"}, nil
			}
			options, st, err := r.o.Access.RegistrationOptions(*grant, r.oGrants(), w, rp, r.ownerName(), r.o.Now())
			if err != nil {
				return 0, nil, err
			}
			if options == nil {
				return 403, map[string]any{"state": st}, nil
			}
			return 200, map[string]any{"options": options}, nil
		default:
			// the front passes the browser's User-Agent; only its coarse label ("Android, Chrome") is kept, never the User-Agent itself
			label := access.PhoneLabel(body["ua"])
			response, _ := body["response"].(map[string]any)
			w, ok, err := r.oWho()
			if err != nil {
				return 0, nil, err
			}
			rp, okRP := originOf(w.Base)
			if !ok || !okRP {
				return 403, map[string]any{"state": "unknown"}, nil
			}
			done, err := r.o.Access.Register(*grant, r.oGrants(), w, rp, r.ownerName(), response, r.o.Now(), label)
			if err != nil {
				return 0, nil, err
			}
			if !done.OK {
				out := map[string]any{"state": done.State}
				if done.Why != "" {
					out["why"] = done.Why
				}
				return 403, out, nil
			}
			r.RecordAccess("passkey_added", done.Passkey, grant.Kind, label)
			// the lock: every owner alert subscription made before it (or from a link) belongs to no phone of the owner's, so the Operator who subscribed their own phone at
			// the setup visit stops hearing the shop here (TypeScript: options.push?.dropUnbound())
			if p := r.Push(); done.FirstOfLock && p != nil {
				if _, err := p.DropUnbound(); err != nil {
					return 0, nil, err
				}
			}
			r.RecordAccess("signed_in", done.Session.ID, "passkey", "")
			// a new phone is announced: the owner's other phones with alerts on get a push now (the others see a banner on their next open). The first phone has no "other".
			if p := r.Push(); p != nil && p.On {
				if phones, err := r.oPasskeys(); err == nil && len(phones) > 1 {
					if err := r.alert("new_phone", r.o.Now(), label, ""); err != nil {
						return 0, nil, err
					}
				}
			}
			return 200, map[string]any{"session": done.Session.Token, "expires_at_ms": done.Session.ExpiresAt}, nil
		}
	case "status":
		phones, err := r.oPasskeys()
		if err != nil {
			return 0, nil, err
		}
		return 200, map[string]any{"count": len(phones)}, nil
	case "signin_options":
		w, ok, err := r.oWho()
		if err != nil {
			return 0, nil, err
		}
		rp, okRP := originOf(w.Base)
		if !ok || !okRP {
			return 200, map[string]any{"count": 0}, nil
		}
		now := r.o.Now()
		pb, err := r.oPasskeysBefore()
		if err != nil {
			return 0, nil, err
		}
		options, err := r.o.Access.SigninOptions(w, rp, now, pb)
		if err != nil {
			return 0, nil, err
		}
		return 200, options, nil
	case "signin":
		response, _ := body["response"].(map[string]any)
		w, ok, err := r.oWho()
		if err != nil {
			return 0, nil, err
		}
		rp, okRP := originOf(w.Base)
		if !ok || !okRP {
			return 403, map[string]any{"why": "Passkeys are not on for this shop."}, nil
		}
		now := r.o.Now()
		pb, err := r.oPasskeysBefore()
		if err != nil {
			return 0, nil, err
		}
		done, err := r.o.Access.Signin(response, w, rp, r.ownerName(), now, pb)
		if err != nil {
			return 0, nil, err
		}
		if !done.OK {
			return 403, map[string]any{"why": done.Why}, nil
		}
		r.RecordAccess("signed_in", done.Session.ID, "passkey", "")
		return 200, map[string]any{"session": done.Session.Token, "expires_at_ms": done.Session.ExpiresAt}, nil
	}
	return 400, errBody("op is grant_state, register_options, register, signin_options or signin."), nil
}

// oGrantState is owner-signin.ts http.grantState: who now (the files read), then the store's grantState over the files read again.
func (r *Runtime) oGrantState(g access.Grant) (string, error) {
	if _, ok, err := r.oWho(); !ok {
		return "unknown", err
	}
	return r.o.Access.GrantState(g, r.oGrants(), r.o.Now())
}

// ---- POST /internal/channel/owner-phones --------------------------------------------------------------------------------------------------------------------

// phonesAnswer is the phones page's data as the route sends it: the store's view, whether the settings name another number, the alerts, the owner's language and the time.
type phonesAnswer struct {
	*access.PhonesView
	NumberDiffers bool          `json:"numberDiffers,omitempty"`
	Alerts        []alertAnswer `json:"alerts"`
	Language      string        `json:"language"`
	Now           int64         `json:"now"`
}

type alertAnswer struct {
	ID     string `json:"id"`
	MadeAt int64  `json:"madeAt"`
	Label  string `json:"label,omitempty"`
}

// OwnerPhones is "Phones that can open your shop" after the body is read (http.ts owner-phones): ONLY a session made here (never the panel's link, which the Operator holds),
// and what only a phone may do (remove a phone, make codes, add a phone, stop an alert) only from a PASSKEY session. Every rule is checked HERE.
func (r *Runtime) OwnerPhones(session string, sessionSent bool, body map[string]any) (int, any, error) {
	signedOut := map[string]any{"state": "signed_out"}
	if r.o.Access == nil {
		return 403, signedOut, nil
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	goodID := ""
	if sessionSent {
		on, err := r.oPasskeysOn()
		if err != nil {
			return 0, nil, err
		}
		if on {
			id, good, err := r.oCheck(session)
			if err != nil {
				return 0, nil, err
			}
			if good {
				goodID = id
			}
		}
	}
	if session == "" || goodID == "" {
		return 403, signedOut, nil
	}
	now := r.o.Now
	switch body["op"] {
	case "list":
		v, differs, err := r.oPhones(session)
		if err != nil {
			return 0, nil, err
		}
		if v == nil {
			return 403, signedOut, nil
		}
		// the alerts that reach the owner's phones, each with the phone it came from (the phones page lists them with Stop)
		alerts := []alertAnswer{}
		if p := r.Push(); p != nil && p.On {
			subs, err := p.OwnerSubs()
			if err != nil {
				return 0, nil, err
			}
			for _, s := range subs {
				a := alertAnswer{ID: s.ID, MadeAt: s.MadeAt}
				for _, p := range v.Phones {
					if p.ID == s.Ref {
						a.Label = p.Label
					}
				}
				alerts = append(alerts, a)
			}
		}
		return 200, phonesAnswer{PhonesView: v, NumberDiffers: differs, Alerts: alerts, Language: r.o.Client.Settings.Owner.Language, Now: now()}, nil
	case "stop_alert":
		// only a passkey session (a phone of the owner's) may stop an alert subscription
		if pk, err := r.oPasskeyOf(session); err != nil {
			return 0, nil, err
		} else if pk == "" {
			return 403, map[string]any{"state": "passkey_needed"}, nil
		}
		id, isText := body["id"].(string)
		done := false
		if p := r.Push(); isText && p != nil {
			var err error
			if done, err = p.DropOwnerSub(cut(id, 32)); err != nil {
				return 0, nil, err
			}
		}
		if done {
			return 200, map[string]any{"stopped": true}, nil
		}
		return 404, map[string]any{"stopped": false}, nil
	case "dismiss":
		var through *float64
		if t, ok := body["through"].(float64); ok {
			through = &t
		}
		w, ok, err := r.oWho()
		if err != nil {
			return 0, nil, err
		}
		if ok {
			if id, good := r.o.Access.Check(session, w, now(), r.oEndBefore()); good {
				if err := r.o.Access.Dismiss(id, now(), through); err != nil {
					return 0, nil, err
				}
			}
		}
		return 200, map[string]any{"ok": true}, nil
	case "remove":
		phoneID := ""
		if id, ok := body["id"].(string); ok {
			phoneID = cut(id, 32)
		}
		confirmLast := body["confirm_last"] == true
		w, ok, err := r.oWho()
		if err != nil {
			return 0, nil, err
		}
		var id string
		var good bool
		if ok {
			id, good = r.o.Access.CheckPasskey(session, w, now(), r.oEndBefore())
		}
		if !ok || !good {
			return 403, map[string]any{"state": "session"}, nil
		}
		rp, okRP := originOf(w.Base)
		if !okRP {
			return 404, map[string]any{"state": "unknown"}, nil
		}
		removed, wasLast, why, err := r.o.Access.RemovePhone(id, phoneID, w, rp, r.oGrants(), now(), confirmLast)
		if err != nil {
			return 0, nil, err
		}
		switch why {
		case "last":
			return 409, map[string]any{"state": "last"}, nil
		case "unknown":
			return 404, map[string]any{"state": "unknown"}, nil
		}
		r.RecordAccess("phone_removed", removed.ID, "", removed.Label)
		// the alerts that phone asked for end with it, and every other phone is told (banner on its next open, and a push now)
		if p := r.Push(); p != nil {
			if _, err := p.DropRef(removed.ID); err != nil {
				return 0, nil, err
			}
		}
		if err := r.alert("phone_removed", now(), removed.Label, ""); err != nil {
			return 0, nil, err
		}
		return 200, map[string]any{"ok": true, "wasLast": wasLast}, nil
	case "codes":
		w, ok, err := r.oWho()
		if err != nil {
			return 0, nil, err
		}
		var codes []string
		if ok {
			if id, good := r.o.Access.CheckPasskey(session, w, now(), r.oEndBefore()); good {
				if codes, err = r.o.Access.MakeOwnCodes(id, r.oGrants(), now()); err != nil {
					return 0, nil, err
				}
			}
		}
		if codes == nil {
			return 403, map[string]any{"state": "passkey_needed"}, nil
		}
		r.RecordAccess("codes_made", goodID, "", "")
		// a set of codes is a way back in: the owner's other phones are told, like a new phone
		if err := r.alert("codes_made", now(), "", ""); err != nil {
			return 0, nil, err
		}
		return 200, map[string]any{"codes": codes}, nil
	case "add_phone":
		w, ok, err := r.oWho()
		if err != nil {
			return 0, nil, err
		}
		if ok {
			if id, good := r.o.Access.CheckPasskey(session, w, now(), r.oEndBefore()); good {
				token, expiresAt, made, err := r.o.Access.AddPhone(id, r.oGrants(), now())
				if err != nil {
					return 0, nil, err
				}
				if made {
					return 200, map[string]any{"url": w.Base + "/setup/" + token, "expires_at_ms": expiresAt}, nil
				}
			}
		}
		return 403, map[string]any{"state": "passkey_needed"}, nil
	case "cancel_removal":
		done := false
		w, ok, err := r.oWho()
		if err != nil {
			return 0, nil, err
		}
		if ok {
			if _, good := r.o.Access.Check(session, w, now(), r.oEndBefore()); good {
				if done, err = r.o.Access.CancelRemoval(r.oGrants(), now()); err != nil {
					return 0, nil, err
				}
			}
		}
		if done {
			r.RecordAccess("removal_cancelled", goodID, "", "")
		}
		return 200, map[string]any{"cancelled": done}, nil
	}
	return 400, errBody("op is list, dismiss, remove, codes, add_phone or cancel_removal."), nil
}

// oPhones is owner-signin.ts http.phones: the session checked, the settings' number watched (a changed number becomes a request the moment the owner looks), the view, and
// whether the settings name another number than the locked one.
func (r *Runtime) oPhones(session string) (*access.PhonesView, bool, error) {
	w, ok, err := r.oWho()
	if err != nil {
		return nil, false, err
	}
	var id string
	var good bool
	if ok {
		id, good = r.o.Access.Check(session, w, r.o.Now(), r.oEndBefore())
	}
	sw, okSW := r.oSettingsWho()
	if okSW && good {
		if err := r.o.Access.WatchOwner(sw, r.o.Now()); err != nil {
			return nil, false, err
		}
	}
	if !ok || !good {
		return nil, false, nil
	}
	rp, okRP := originOf(w.Base)
	if !okRP {
		return nil, false, nil
	}
	view, err := r.o.Access.PhonesView(id, w, rp, r.oGrants(), r.o.Now())
	if err != nil || view == nil {
		return nil, false, err
	}
	return view, okSW && r.o.Access.NumberDiffers(sw), nil
}

// oPasskeyOf is the passkey (phone) a session was made by, if it was made by one: what a push subscription is tied to.
func (r *Runtime) oPasskeyOf(session string) (string, error) {
	id, good, err := r.oCheckPasskey(session)
	if err != nil || !good {
		return "", err
	}
	return r.o.Access.PasskeyOfSession(id), nil
}

// ---- POST /internal/channel/push, the owner's ops -----------------------------------------------------------------------------------------------------------

// OwnerPushOp is the owner's side of the push route after its body is read and push is known to be on (http.ts "item 11h: web push", op owner_*): the owner's credential, then
// who may change alerts, then the op, all under the owner lock. The panel's owner link is the OPERATOR's: once the owner holds a passkey it may read the state but not subscribe
// a phone to the owner's alerts (which can carry what the shop says to the owner), change the owner's choice or drop a subscription; only a session made here may, and a
// subscription is tied to the phone (passkey) its session was made from, so removing that phone ends it. The lock is held from the first check to the subscription: a link's
// subscription that passed "not locked" can never land after the first passkey's DropUnbound, nor a phone's after that phone was removed.
func (r *Runtime) OwnerPushOp(p *push.Push, op string, body map[string]any, link, session string, sessionSent, whatsapp bool) (int, any, error) {
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	// ownerAuthorised: the panel-made link against the hash the folder holds now, or a session this runtime made and still holds good
	ownerSession := ""
	if sessionSent && r.o.Access != nil {
		if _, good, err := r.oCheck(session); err != nil {
			return 0, nil, err
		} else if good {
			ownerSession = session
		}
	}
	if ownerSession == "" && !r.OwnerLinkOK(link) {
		return 403, errBody(ownerRefused), nil
	}
	// passkeysOn && lockState().locked, asked only where TypeScript asks it (the lock state watches the owner's number, so asking it is not free of effect)
	locked := func() (bool, error) {
		if r.o.Access == nil {
			return false, nil
		}
		if on, err := r.oPasskeysOn(); err != nil || !on {
			return false, err
		}
		l, _, err := r.oLockState()
		return l, err
	}
	if ownerSession == "" && op != "owner_state" {
		if l, err := locked(); err != nil {
			return 0, nil, err
		} else if l {
			return 403, errBody("Sign in with the owner's phone to change alerts."), nil
		}
	}
	switch op {
	case "owner_subscribe":
		ref := ""
		if ownerSession != "" {
			var err error
			if ref, err = r.oPasskeyOf(ownerSession); err != nil {
				return 0, nil, err
			}
		}
		// once locked, only a PHONE (a passkey session) may subscribe: a subscription with no phone could never be ended by removing one
		if ref == "" {
			if l, err := locked(); err != nil {
				return 0, nil, err
			} else if l {
				return 403, errBody("Sign in with your phone's fingerprint to turn on alerts."), nil
			}
		}
		sub, ok := subscriptionOf(body["subscription"])
		why := push.ShapeProblem
		if ok {
			why = p.Subscribe("owner", sub, "own", ref)
		}
		if why != "" {
			return 400, errBody(why), nil
		}
		// the first phone with alerts: both ways for a shop with WhatsApp (the owner can then pick), push alone for one without
		if p.OwnerPhones() == 1 && p.Choice() == "whatsapp" {
			next := "push"
			if whatsapp {
				next = "both"
			}
			if err := p.SetChoice(next); err != nil {
				return 0, nil, err
			}
		}
	case "owner_unsubscribe":
		endpoint, ok := body["endpoint"].(string)
		if !ok {
			return 400, errBody("Send the endpoint to stop."), nil
		}
		p.Unsubscribe("owner", endpoint)
	case "owner_choice":
		choice, _ := body["choice"].(string)
		if !validChoice(choice) {
			return 400, errBody("choice is one of " + strings.Join(push.OwnerChoices, ", ") + "."), nil
		}
		if !whatsapp && choice != "push" {
			return 400, errBody("This shop has no WhatsApp: alerts come by push."), nil
		}
		if err := p.SetChoice(choice); err != nil {
			return 0, nil, err
		}
	case "owner_state":
	default:
		return 400, errBody("op is not one this route knows."), nil
	}
	choice := "push"
	if whatsapp {
		choice = p.Choice()
	}
	return 200, map[string]any{"on": true, "whatsapp": whatsapp, "choice": choice, "phones": p.OwnerPhones()}, nil
}
