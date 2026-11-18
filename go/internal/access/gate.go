package access

// Who controls the owner's sign-in: the gate, the Operator's requests, Geometer's reset (owner-access.ts, "who controls the owner's sign-in", and bundle/Explanation.md). The
// Operator's files (owner-grants.json, written by the panel) are never taken at their word once the owner holds a passkey; this store keeps its own memory of what it saw and
// when, and decides. Each function is the TypeScript one of the same name, with its statements in the same order.

import (
	"database/sql"
	"strings"
)

// RemovalWaitMs is how long an Operator's "remove the owner's passkeys" (and an owner-number change) waits once the owner holds a passkey: long enough that an owner who looks
// at their phone once a day, or gets a push, can cancel it; short enough that an owner who really lost every phone is not locked out for a week.
const RemovalWaitMs = 48 * 60 * 60_000

// SetupMs is how long a setup QR works, from when THIS runtime first saw it (whatever expiry the file claims).
const SetupMs = 15 * 60_000

// ResetQrMs is how long the QR that comes with Geometer's reset works, from when the runtime first sees it: the admin may need to send it to the owner.
const ResetQrMs = 60 * 60_000

// RecoveryCodes is how many codes a recovery card (or the owner's own set) has. Each works once.
const RecoveryCodes = 5

// Note is something reconcile or the store found that the record should say once (owner-access.ts Note): a reset, a request asked or extended, an owner change asked, a
// request applied. A request's notice (Key set) is kept in the file until MarkTold, so a restart before the tick does not lose it.
type Note struct {
	What        string // "reset", "removal_asked", "owner_change_asked", "removal_extended", "removal_applied"
	At          int64  // reset, removal_applied
	Reason, By  string // reset
	AskedBy     string // removal_asked, removal_extended
	AskedAt     string // removal_asked
	EffectiveAt int64  // the requests
	Key         string // the requests: the removals row to mark told
	Kind        string // removal_extended: "removal" or "owner_change"
}

// lockAt is when the shop got locked: the first passkey made since the gate last opened (rows the owner or a removal later took away still count: the owner held one).
func lockAt(q execer) (int64, bool) {
	var m sql.NullInt64
	if err := q.QueryRow("SELECT min(made_at) AS m FROM passkeys WHERE made_at >= ?", metaOr(q, "reopen_at", 0)).Scan(&m); err != nil || !m.Valid {
		return 0, false
	}
	return m.Int64, true
}

// inResetWindow: from Geometer's reset until the owner's first passkey after it. In this window the shop is locked for the Operator and the runtime accepts ONLY the reset's own
// QR: a panel QR or card made now would otherwise undo the reset by the Operator's own buttons (nothing is "locked" while no phone exists).
func inResetWindow(q execer) bool {
	at, ok := metaNum(q, "reset_at")
	if !ok {
		return false
	}
	var one int
	return q.QueryRow("SELECT 1 FROM passkeys WHERE made_at >= ? LIMIT 1", at).Scan(&one) == sql.ErrNoRows
}

// boundKey is the owner identity the shop was LOCKED with (hash of their number), set by the first passkey and cleared whenever the gate opens.
func boundKey(q execer) (string, bool) { return metaStr(q, "bound_owner") }

// effKey is "the owner" for every session and passkey check: the locked identity once there is one, the settings' number before.
func (a *Access) effKey(q execer, who Who) string {
	if b, ok := boundKey(q); ok {
		return b
	}
	return OwnerKey(who.Owner)
}

func unbind(q execer) error { _, err := q.Exec("DELETE FROM meta WHERE name = 'bound_owner'"); return err }

// appliedReset is the reset in the file, but only the one this store has applied (so a changed file cannot swap in another QR).
func appliedReset(q execer, file *Grants) *Reset {
	if file == nil || file.Reset == nil {
		return nil
	}
	raw, ok := metaNum(q, "reset_raw")
	if !ok || file.Reset.at != raw {
		return nil
	}
	return file.Reset
}

// cancelledRecently: the owner cancelled a request (of either kind) within the last day, so the Operator waits before the next one is heard.
func cancelledRecently(q execer, now int64) bool {
	var one int
	return q.QueryRow("SELECT 1 FROM removals WHERE state = 'cancelled' AND at > ?", now-day).Scan(&one) == nil
}

func endSessionsBefore(q execer, t, now int64, why string) error {
	_, err := q.Exec("UPDATE sessions SET ended_at = ?, ended_why = ? WHERE ended_at IS NULL AND made_at < ?", now, why, t)
	return err
}

func exists(q execer, query string, args ...any) bool {
	var one int
	return q.QueryRow(query, args...).Scan(&one) == nil
}

// noteSeen remembers the QR and the card hashes the file holds now, the first time this store sees each.
func noteSeen(q execer, file *Grants, firstSeen int64) error {
	// anything the panel's file shows during a reset window is born void: it must not wake up when the window closes (the first passkey after the reset would otherwise make a
	// card staged in the window look "seen before the lock")
	var born any
	if inResetWindow(q) {
		born = firstSeen
	}
	const ins = "INSERT OR IGNORE INTO grants_seen (hash, kind, first_seen, voided_at) VALUES (?, ?, ?, ?)"
	if file != nil && file.Setup != nil {
		if _, err := q.Exec(ins, file.Setup.Sha256, "setup", firstSeen, born); err != nil {
			return err
		}
	}
	if file != nil && file.Recovery != nil {
		for _, c := range file.Recovery.Codes {
			if _, err := q.Exec(ins, c, "recovery", firstSeen, born); err != nil {
				return err
			}
		}
	}
	return nil
}

func firstOwnerKey(q execer) (string, bool) {
	var k string
	if err := q.QueryRow("SELECT owner_key FROM passkeys WHERE made_at >= ? ORDER BY made_at LIMIT 1", metaOr(q, "reopen_at", 0)).Scan(&k); err != nil {
		return "", false
	}
	return k, true
}

// reconcile reads the Operator's and the admin's files into this store's own state. Called by everything that depends on them, so no path can skip it. Idempotent. Order:
// adopt a shop from before this rule, bind a locked shop that has no binding, apply Geometer's reset, remember the QR and card hashes, time the Operator's request, apply a
// request whose wait is over.
func (a *Access) reconcile(file *Grants, now int64) error {
	q := a.db
	if _, adopted := metaNum(q, "adopted"); !adopted {
		first, locked := lockAt(q)
		// a shop whose owner already holds a passkey keeps the QR and card that exist today (first seen "at the first passkey"), and the file's own passkeysBefore, once
		if file != nil || !locked {
			// clamped to now: a file value in the future would otherwise make every passkey made from now on "older" than the cutoff (a total lockout)
			if file != nil && file.PasskeysBefore != nil {
				if err := setMetaNum(q, "passkeys_before", min(file.passkeysBefore, now)); err != nil {
					return err
				}
			}
			seenAt := now
			if locked {
				seenAt = first
			}
			if err := noteSeen(q, file, seenAt); err != nil {
				return err
			}
			// a shop that is already locked is bound to the owner its first passkey was made for
			if locked {
				if k, ok := firstOwnerKey(q); ok {
					if _, bound := boundKey(q); !bound {
						if err := setMeta(q, "bound_owner", k); err != nil {
							return err
						}
					}
				}
			}
			if err := setMetaNum(q, "adopted", 1); err != nil {
				return err
			}
		}
	}
	// A locked shop with no bound identity (a restore that did not carry the binding, or an older runtime) is bound NOW to the owner its existing passkeys were made for, never
	// to whatever the settings say today: if the Operator already changed the number, WatchOwner then raises the request instead of the shop quietly following the new number.
	if _, bound := boundKey(q); !bound {
		if _, locked := lockAt(q); locked {
			if k, ok := firstOwnerKey(q); ok {
				if err := setMeta(q, "bound_owner", k); err != nil {
					return err
				}
			}
		}
	}
	// Every time a FILE names is clamped to this runtime's own clock the first time it is seen, and remembered by its raw value: a reset dated 2099 would move every cutoff to
	// 2099 and make every later, real reset look older (an instant total lockout, and no way back). The raw value is remembered so a far date is applied once, not on every read.
	if reset := fileReset(file); reset != nil {
		raw := reset.at
		seenRaw, hasRaw := metaNum(q, "reset_raw")
		if (!hasRaw || raw != seenRaw) && min(raw, now) > metaOr(q, "reset_at", 0) {
			at := min(raw, now)
			if err := setMetaNum(q, "reset_raw", raw); err != nil {
				return err
			}
			err := a.tx(func(x execer) error {
				if err := setMetaNum(x, "reset_at", at); err != nil {
					return err
				}
				if err := raiseMeta(x, "passkeys_before", at); err != nil {
					return err
				}
				if err := raiseMeta(x, "reopen_at", at); err != nil {
					return err
				}
				if err := unbind(x); err != nil {
					return err
				}
				// every QR, card, own code and "add a phone" link made before the reset stops; the QR the admin makes with the reset is first seen after it and so works
				if _, err := x.Exec("UPDATE grants_seen SET voided_at = ? WHERE first_seen < ? AND voided_at IS NULL", at, at); err != nil {
					return err
				}
				if _, err := x.Exec("UPDATE own_codes SET voided_at = ? WHERE voided_at IS NULL", at); err != nil {
					return err
				}
				if _, err := x.Exec("UPDATE own_setups SET voided_at = ? WHERE voided_at IS NULL", at); err != nil {
					return err
				}
				// a pending request goes with the reset: the gate is open now, and a request from before it must not apply to the owner's next phone
				if _, err := x.Exec("UPDATE removals SET state = 'cancelled', at = ? WHERE state = 'pending'", at); err != nil {
					return err
				}
				return endSessionsBefore(x, at, now, "reset")
			})
			if err != nil {
				return err
			}
			a.notes = append(a.notes, Note{What: "reset", At: at, Reason: reset.Reason, By: reset.By})
		}
	}
	if err := noteSeen(q, file, now); err != nil {
		return err
	}
	if applied := appliedReset(q, file); applied != nil && applied.Setup != nil {
		if _, err := q.Exec("INSERT OR IGNORE INTO grants_seen (hash, kind, first_seen) VALUES (?, 'reset', ?)", applied.Setup.Sha256, now); err != nil {
			return err
		}
	}
	var p *PendingRemoval
	if file != nil {
		p = file.PendingRemoval
	}
	// a fresh request right after the owner cancelled one waits a day first: otherwise the Operator could post again at once, every time, until the owner is not looking
	cooling := cancelledRecently(q, now)
	// a request posted while a reset window is open is void for good: it must not start its 48 hours the day the owner registers again
	if p != nil && inResetWindow(q) && !exists(q, "SELECT 1 FROM removals WHERE asked_at = ?", p.AskedAt) {
		if _, err := q.Exec("INSERT INTO removals (asked_at, asked_by, seen_at, effective_at, state, at) VALUES (?, ?, ?, ?, 'withdrawn', ?)", p.AskedAt, p.AskedBy, now, now, now); err != nil {
			return err
		}
	}
	if p != nil && !cooling && !exists(q, "SELECT 1 FROM removals WHERE asked_at = ?", p.AskedAt) {
		if _, locked := lockAt(q); locked && p.askedAt > metaOr(q, "reset_at", 0) {
			// a request the owner has no way to have seen yet starts its wait NOW, whatever time the file says: a back-dated request must not apply at once
			if _, err := q.Exec("UPDATE removals SET state = 'withdrawn', at = ? WHERE state = 'pending' AND asked_at NOT LIKE 'owner-change:%'", now); err != nil {
				return err
			}
			if _, err := q.Exec("INSERT INTO removals (asked_at, asked_by, seen_at, effective_at, state, at, told) VALUES (?, ?, ?, ?, 'pending', ?, 0)", p.AskedAt, p.AskedBy, now, now+RemovalWaitMs, now); err != nil {
				return err
			}
		}
	}
	// the due ones are read whole first (one connection), then applied in the order SQLite gave them, as TypeScript's .all() does
	type due struct {
		askedAt     string
		effectiveAt int64
	}
	rows, err := q.Query("SELECT asked_at, effective_at FROM removals WHERE state = 'pending' AND effective_at <= ?", now)
	if err != nil {
		return err
	}
	var dues []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.askedAt, &d.effectiveAt); err != nil {
			rows.Close()
			return err
		}
		dues = append(dues, d)
	}
	rows.Close()
	for _, d := range dues {
		// nobody cancelled in time: every passkey made before the moment stops, every session made before it ends, and the gate opens for a new QR
		if _, err := q.Exec("UPDATE removals SET state = 'applied', at = ? WHERE asked_at = ?", d.effectiveAt, d.askedAt); err != nil {
			return err
		}
		if err := raiseMeta(q, "passkeys_before", d.effectiveAt); err != nil {
			return err
		}
		if err := raiseMeta(q, "reopen_at", d.effectiveAt); err != nil {
			return err
		}
		if err := unbind(q); err != nil {
			return err
		}
		if err := endSessionsBefore(q, d.effectiveAt, now, "removal"); err != nil {
			return err
		}
		a.notes = append(a.notes, Note{What: "removal_applied", At: d.effectiveAt})
	}
	return nil
}

// fileReset is file.reset when the file carries one (the reader fills it from the admin's own file only).
func fileReset(file *Grants) *Reset {
	if file == nil {
		return nil
	}
	return file.Reset
}

// grantAllowed: may this QR or card hash work now? Seen by this store, not voided, not before the gate last opened, and (once locked) no later than the first passkey.
func grantAllowed(q execer, hash string) bool {
	var firstSeen int64
	var voided sql.NullInt64
	var kind string
	if err := q.QueryRow("SELECT first_seen, voided_at, kind FROM grants_seen WHERE hash = ?", hash).Scan(&firstSeen, &voided, &kind); err != nil {
		return false
	}
	if voided.Valid || firstSeen < metaOr(q, "reopen_at", 0) {
		return false
	}
	if inResetWindow(q) {
		return kind == "reset" // only Geometer's own QR, until the owner has a phone again
	}
	locked, ok := lockAt(q)
	return !ok || firstSeen <= locked
}

// Sync reads the files into this store (see reconcile); the runtime's tick calls it so a request or a reset is seen even when nobody opens a page.
func (a *Access) Sync(file *Grants, now int64) error { return a.reconcile(file, now) }

// TakeNotes is what Sync found that the record should say, once each: the notes kept in memory (a reset, a request applied), then every request still pending and not yet
// told, from the file, until MarkTold. Why from the file: a reconcile done by an HTTP call (the panel's /status probe) followed by a restart before the next tick used to lose
// the request's notice while its 48 hours still ran.
func (a *Access) TakeNotes() ([]Note, error) {
	out := a.notes
	a.notes = nil
	rows, err := a.db.Query("SELECT asked_at, asked_by, effective_at, extended FROM removals WHERE state = 'pending' AND told = 0 ORDER BY seen_at")
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var askedAt, askedBy string
		var effectiveAt, extended int64
		if err := rows.Scan(&askedAt, &askedBy, &effectiveAt, &extended); err != nil {
			return out, err
		}
		switch {
		case strings.HasPrefix(askedAt, "owner-change:") && extended != 0:
			out = append(out, Note{What: "removal_extended", Kind: "owner_change", AskedBy: askedBy, EffectiveAt: effectiveAt, Key: askedAt})
		case strings.HasPrefix(askedAt, "owner-change:"):
			out = append(out, Note{What: "owner_change_asked", EffectiveAt: effectiveAt, Key: askedAt})
		case extended != 0:
			out = append(out, Note{What: "removal_extended", Kind: "removal", AskedBy: askedBy, EffectiveAt: effectiveAt, Key: askedAt})
		default:
			out = append(out, Note{What: "removal_asked", AskedBy: askedBy, AskedAt: askedAt, EffectiveAt: effectiveAt, Key: askedAt})
		}
	}
	return out, rows.Err()
}

// MarkTold: the owner's phones were told and the record line is SAVED for this request, so it is never told again. The Go runtime calls it after the step that holds the line
// is committed (TypeScript calls it before its save; a crash between the two there loses the line, here it tells twice rather than never).
func (a *Access) MarkTold(key string) error {
	_, err := a.db.Exec("UPDATE removals SET told = 1 WHERE asked_at = ?", key)
	return err
}

// NoteStart: the runtime has just (re)started. A request that would fall due while it was not running, or within a day of its start, is moved to a day after the start and said
// again: an owner whose phones were off, or an outage nobody chose, must not lose the wait (a request must be SEEN for its whole time to count). Once per request (`extended`), so
// a runtime restarted every few hours cannot postpone it for ever. Called once, at start.
func (a *Access) NoteStart(now int64) error {
	keys, err := strings1(a.db, "SELECT asked_at FROM removals WHERE state = 'pending' AND extended = 0 AND effective_at < ?", now+day)
	if err != nil {
		return err
	}
	for _, k := range keys {
		// told = 0: the owner is told the new time too, and a restart before the tick must not lose that
		if _, err := a.db.Exec("UPDATE removals SET effective_at = ?, extended = 1, told = 0 WHERE asked_at = ?", now+day, k); err != nil {
			return err
		}
	}
	return nil
}

// PasskeysBefore is the moment before which no passkey works: this store's own, never the Operator's file's.
func (a *Access) PasskeysBefore(file *Grants, now int64) (*int64, error) {
	if err := a.reconcile(file, now); err != nil {
		return nil, err
	}
	if v, ok := metaNum(a.db, "passkeys_before"); ok {
		return &v, nil
	}
	return nil, nil
}

// Locked: has the owner a passkey since the gate last opened (or is a reset window open)? Then the Operator's QR and card are closed, and "remove the passkeys" is a request.
func (a *Access) Locked(file *Grants, now int64) (bool, error) {
	if err := a.reconcile(file, now); err != nil {
		return false, err
	}
	_, locked := lockAt(a.db)
	return locked || inResetWindow(a.db), nil
}

// Removal is the Operator's pending request as this store timed it.
type Removal struct {
	Kind        string `json:"kind"` // "removal" or "owner_change"
	AskedBy     string `json:"askedBy"`
	AskedAt     string `json:"askedAt"`
	SeenAt      int64  `json:"seenAt"`
	EffectiveAt int64  `json:"effectiveAt"`
}

// PendingRemoval is the request that would apply first (a removal and an owner-number change can both be waiting), or nil.
func (a *Access) PendingRemoval(file *Grants, now int64) (*Removal, error) {
	if err := a.reconcile(file, now); err != nil {
		return nil, err
	}
	var r Removal
	err := a.db.QueryRow("SELECT asked_by, asked_at, seen_at, effective_at FROM removals WHERE state = 'pending' ORDER BY effective_at LIMIT 1").Scan(&r.AskedBy, &r.AskedAt, &r.SeenAt, &r.EffectiveAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.Kind = "removal"
	if strings.HasPrefix(r.AskedAt, "owner-change:") {
		r.Kind = "owner_change"
	}
	return &r, nil
}

// BoundNumber is the number the shop was locked with, in plain digits, when the runtime knows it (it learns it at the first passkey, or the first start where the settings
// still agree) and the shop is locked.
func (a *Access) BoundNumber() (string, bool) {
	if _, b := boundKey(a.db); !b {
		return "", false
	}
	if _, locked := lockAt(a.db); !locked {
		return "", false
	}
	return metaStr(a.db, "bound_number")
}

// LearnNumber: the settings name the locked owner's number, so remember it in plain digits (an existing or restored shop did not record it).
func (a *Access) LearnNumber(number string) error {
	b, bound := boundKey(a.db)
	if !bound {
		return nil
	}
	if _, locked := lockAt(a.db); !locked || OwnerKey(number) != b {
		return nil
	}
	if _, have := metaStr(a.db, "bound_number"); have {
		return nil
	}
	_, err := a.db.Exec("INSERT INTO meta (name, value) VALUES ('bound_number', ?) ON CONFLICT(name) DO NOTHING", digits(number))
	return err
}

// EffectiveNumber is THE number every owner-facing path uses, worked out on EVERY use and never fixed at start: while the shop is locked and its binding is known, the number it
// was locked with; otherwise (never locked, or the gate opened again by an applied change, a removal or Geometer's reset) the number the settings say now. Why not a value set
// once at start: a legitimate sale applies the change 48 hours later WITHOUT a restart, and a value fixed at start would still be the previous owner's number, so the new owner
// would be bound to it and every later start would send approvals, alerts and sign-in links to the previous owner.
func (a *Access) EffectiveNumber(settingsNumber string) (string, error) {
	// an existing or restored shop that did not record the digits learns them when the settings still agree
	if err := a.LearnNumber(settingsNumber); err != nil {
		return settingsNumber, err
	}
	// the store keeps digits only; the settings know the number as + and digits, so give it back in that form
	if locked, ok := a.BoundNumber(); ok {
		return "+" + locked, nil
	}
	return settingsNumber, nil
}

// NumberDiffers: does the owner number in the settings differ from the one the shop was locked with? (The owner's phones say so.)
func (a *Access) NumberDiffers(settings Who) bool {
	b, bound := boundKey(a.db)
	_, locked := lockAt(a.db)
	return bound && locked && OwnerKey(settings.Owner) != b
}

// WatchOwner checks the owner's number in the settings (the panel's edit form can change it) against the identity the shop was locked with. A DIFFERENT number after the lock
// is not "the owner changed": it is a request with the same wait as a removal (the owner sees it on every phone and can cancel; until it applies, a session for the new number
// opens nothing). Called on the clock's beat and by every phones call. Before the lock the settings are the owner, as they always were.
func (a *Access) WatchOwner(who Who, now int64) error {
	q := a.db
	bound, ok := boundKey(q)
	if !ok {
		return nil
	}
	if _, locked := lockAt(q); !locked {
		return nil
	}
	current := OwnerKey(who.Owner)
	if current == bound {
		_, err := q.Exec("UPDATE removals SET state = 'withdrawn', at = ? WHERE state = 'pending' AND asked_at LIKE 'owner-change:%'", now)
		return err
	}
	key := "owner-change:" + current
	var state string
	var at int64
	err := q.QueryRow("SELECT state, at FROM removals WHERE asked_at = ?", key).Scan(&state, &at)
	had := err == nil
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	// a cancelled number may be asked again after the same day's quiet as a removal; a pending or applied one is not asked twice
	if had && !(state == "cancelled" && now-at >= day && !cancelledRecently(q, now)) {
		return nil
	}
	if !had && cancelledRecently(q, now) {
		return nil
	}
	effectiveAt := now + RemovalWaitMs
	if had {
		_, err := q.Exec("UPDATE removals SET state = 'pending', seen_at = ?, effective_at = ?, at = ?, extended = 0, told = 0 WHERE asked_at = ?", now, effectiveAt, now, key)
		return err
	}
	_, err = q.Exec("INSERT INTO removals (asked_at, asked_by, seen_at, effective_at, state, at, told) VALUES (?, 'the owner number', ?, ?, 'pending', ?, 0)", key, now, effectiveAt, now)
	return err
}

// CancelRemoval: the owner cancels the Operator's request (of either kind). True when one was waiting. The same request, asked again, is not heard again (a new request needs
// a new askedAt).
func (a *Access) CancelRemoval(file *Grants, now int64) (bool, error) {
	if err := a.reconcile(file, now); err != nil {
		return false, err
	}
	r, err := a.db.Exec("UPDATE removals SET state = 'cancelled', at = ? WHERE state = 'pending'", now)
	if err != nil {
		return false, err
	}
	n, _ := r.RowsAffected()
	return n > 0, nil
}
