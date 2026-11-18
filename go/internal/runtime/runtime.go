package runtime

// The runtime of a listings-only shop: the durable store, the queue of events and the one-at-a-time runner, wired so every step is saved whole or not at all (the idea is explained
// once for every template in modules/runtime/core.ts). A step builds a FRESH state from the last saved one, changes it, and saves the new snapshot, the record lines it made and the
// task's "done" mark in one transaction; if anything throws, nothing was saved and nothing in memory is reused. Reads (the public page, the feed, the owner's page) come from the last
// saved state, never from a step in progress.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/signing"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// retryDelays: wait before the first, second and third retry, so four tries in all.
var retryDelays = []time.Duration{time.Second, 5 * time.Second, 30 * time.Second}

// Options are what a start is given besides the folder.
type Options struct {
	Client    *Client
	Store     *store.Store
	Access    *access.Access // nil: the shop has no owner sign-in (no channel token)
	Model     *Model
	RecordKey []byte
	Log       func(string)
	Now       func() int64
	// Push is the shop's web push for the owner-control rules (owner.go OwnerPush); nil: the Go runtime serves no push yet
	Push OwnerPush
}

// Runtime is one running shop.
type Runtime struct {
	o       Options
	loc     *time.Location
	policy  budget.Policy
	clock   budget.Clock
	proto   *listings.Protocol
	started int64

	// ownerMu is the owner lock (owner.go): every owner sequence, the tick's owner part and every read of the owner's number hold it, so none interleaves with another
	ownerMu sync.Mutex

	mu        sync.RWMutex
	snapshot  string
	snap      *Snap
	entries   []store.Entry
	steps     int64
	errors    int64
	lastStep  int64
	lastFail  int64
	broken    string
	shopKey   *signing.Key
	lastDaily int64

	kick chan struct{}
	stop chan struct{}
	done chan struct{}
}

// New builds the runtime over an open store and starts its runner.
func New(o Options) (*Runtime, error) {
	loc, err := time.LoadLocation(o.Client.Settings.Timezone)
	if err != nil {
		return nil, err
	}
	if o.Now == nil {
		o.Now = func() int64 { return time.Now().UnixMilli() }
	}
	if o.Log == nil {
		o.Log = func(string) {}
	}
	r := &Runtime{o: o, loc: loc, clock: budget.Clock{Now: o.Now, Loc: loc}, started: o.Now(), kick: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{})}
	cfg := &o.Client.Config
	r.policy = budget.Policy{
		Override: func() string { return cfg.Switch("ai", "buttons", "auto") },
		Model:    func() string { return cfg.Switch("model", "off", "normal") },
		Budget:   cfg.Budget, AllowanceMsgs: cfg.AllowMsgs, AllowanceMicro: cfg.AllowMicro, PauseMinutes: cfg.PauseMin,
	}
	if r.policy.PauseMinutes == 0 {
		r.policy.PauseMinutes = budget.DefaultPauseMinutes
	}
	snapshot, entries, err := o.Store.LoadState()
	if err != nil {
		return nil, err
	}
	r.snapshot, r.entries = snapshot, entries
	if r.snap, err = ParseSnap(snapshot); err != nil {
		return nil, err
	}
	if r.snapshot == "" {
		if r.snapshot, err = r.snap.Serialize(); err != nil {
			return nil, err
		}
	}
	r.proto = listings.NewProtocol(r.publicRead, r.signingKey, o.Now, func() string { return o.Client.Settings.Name })
	// the owner's sign-in starts: the locked number learned, and a request that fell due while the runtime was down given a day more (owner.go ownerStart)
	if err := r.ownerStart(); err != nil {
		return nil, err
	}
	return r, nil
}

// Start runs the queue and the clock's beat until Close.
func (r *Runtime) Start(tick time.Duration) {
	go func() {
		defer close(r.done)
		t := time.NewTicker(tick)
		defer t.Stop()
		r.drain() // anything saved but not finished when the last process stopped runs now
		for {
			select {
			case <-r.stop:
				return
			case <-r.kick:
				r.drain()
			case <-t.C:
				r.tick()
				r.drain()
			}
		}
	}()
}

// Kick lets the queue run.
func (r *Runtime) Kick() {
	select {
	case r.kick <- struct{}{}:
	default:
	}
}

// Close finishes the step in hand and leaves the rest pending for the next start.
func (r *Runtime) Close() {
	close(r.stop)
	<-r.done
}

// ---- events ----------------------------------------------------------------------------------------------------------------------------------------------

func eventKey(e map[string]any) string {
	kind, _ := e["kind"].(string)
	id, _ := e["id"].(string)
	return kind + ":" + id
}

// Submit saves events as tasks, on disk when it returns; the caller then calls Kick.
func (r *Runtime) Submit(events []map[string]any) (saved, duplicates int, err error) {
	keys, kinds, payloads := make([]string, len(events)), make([]string, len(events)), make([]string, len(events))
	for i, e := range events {
		b, err := signing.Marshal(e)
		if err != nil {
			return 0, 0, err
		}
		keys[i], payloads[i] = eventKey(e), string(b)
		kinds[i], _ = e["kind"].(string)
	}
	return r.o.Store.SaveEvents(keys, kinds, payloads, r.o.Now())
}

// ---- the queue -------------------------------------------------------------------------------------------------------------------------------------------

func (r *Runtime) drain() {
	for {
		select {
		case <-r.stop:
			return
		default:
		}
		task, err := r.o.Store.NextPending()
		if err != nil {
			r.fail("The queue could not read its tasks", err)
			r.mu.Lock()
			r.broken = err.Error()
			r.mu.Unlock()
			return
		}
		r.mu.Lock()
		r.broken = ""
		r.mu.Unlock()
		if task == nil {
			return
		}
		maxAttempts := len(retryDelays) + 1
		if task.Attempts >= maxAttempts { // it was already tried that many times and the process died each time
			_ = r.o.Store.FailTask(task.ID, "The process stopped while this task was running, too many times.", true)
			r.fail("Task "+task.ID+" is marked failed: it was running each time the process stopped", fmt.Errorf("too many interrupted tries"))
			continue
		}
		attempt, err := r.o.Store.StartAttempt(task.ID) // saved before the step runs: a step that kills the process still counts
		if err != nil {
			r.fail("The queue could not count an attempt", err)
			return
		}
		var ev map[string]any
		if err := json.Unmarshal([]byte(task.Payload), &ev); err == nil {
			err = r.step(ev, task.ID)
		}
		if err == nil {
			r.mu.Lock()
			r.steps++
			r.lastStep = r.o.Now()
			r.mu.Unlock()
			continue
		}
		last := attempt >= maxAttempts
		_ = r.o.Store.FailTask(task.ID, err.Error(), last)
		r.fail(fmt.Sprintf("Task %s failed (try %d of %d)", task.ID, attempt, maxAttempts), err)
		if last {
			continue
		}
		select {
		case <-time.After(retryDelays[attempt-1]):
		case <-r.stop:
			return
		}
	}
}

func (r *Runtime) fail(what string, err error) {
	r.mu.Lock()
	r.lastFail = r.o.Now()
	r.errors++
	r.mu.Unlock()
	r.o.Log(what + ": " + err.Error())
}

// tick is the clock's beat: the panel's "sign out every device" said once in the record, and, once a day, the clean-up.
func (r *Runtime) tick() {
	if err := r.step(nil, ""); err != nil {
		r.fail("A tick failed", err)
	}
}

// ---- one step --------------------------------------------------------------------------------------------------------------------------------------------

// owner is the owner's number and language for a step's record lines: the EFFECTIVE number (the locked one while the shop is locked), as the settings' getter answers in
// TypeScript, never the settings' number taken at its word.
func (r *Runtime) owner() (string, string) {
	return r.ownerNumberForLines(), r.o.Client.Settings.Owner.Language
}

// recordKey for the record's digests.
func (r *Runtime) recorder() *recorder {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return &recorder{key: r.o.RecordKey, base: len(r.entries), now: r.o.Now}
}

func (r *Runtime) step(ev map[string]any, taskID string) (err error) {
	// a failure of the owner-access store inside a rule stops the step as TypeScript's throw does (access.DBError): never read as "no row", which would fail open
	defer access.Recover(&err)
	r.mu.RLock()
	text := r.snapshot
	r.mu.RUnlock()
	snap, err := ParseSnap(text)
	if err != nil {
		return err
	}
	rec := r.recorder()
	now := r.o.Now()
	var told []string
	if ev == nil {
		told = r.beat(snap, rec, now)
	} else {
		switch ev["kind"] {
		case "owner_listing":
			r.ownerListing(snap, rec, ev, now)
		case "owner_photo":
			r.ownerPhoto(snap, rec, ev, now)
		case "owner_access":
			r.ownerAccess(rec, ev)
		case "owner_signin":
			r.ownerSignin(rec)
		case "owner_message":
			if err := r.ownerMessage(snap, rec, ev, now); err != nil {
				return err
			}
		default:
			r.o.Log(fmt.Sprintf("An event of kind %v came for a listings-only shop run by the Go runtime, which does not take it; it was dropped.", ev["kind"]))
		}
	}
	if err := r.save(snap, rec, taskID); err != nil {
		return err
	}
	// a request's notice is marked told only now that its record line is saved: a crash before this tells it again rather than never
	r.markTold(told)
	return nil
}

// save saves what the step has done so far, whole or not at all, and only then treats it as the saved state.
func (r *Runtime) save(snap *Snap, rec *recorder, taskID string) error {
	after, err := snap.Serialize()
	if err != nil {
		return err
	}
	r.mu.RLock()
	same := after == r.snapshot
	r.mu.RUnlock()
	if taskID == "" && same && len(rec.fresh) == 0 {
		return nil // a quiet tick has nothing to save
	}
	if err := r.o.Store.CommitStep(store.Step{TaskID: taskID, Snapshot: after, Entries: rec.fresh, NowMs: r.o.Now()}); err != nil {
		return err
	}
	r.mu.Lock()
	r.snapshot, r.snap = after, snap
	r.entries = append(r.entries, rec.fresh...)
	r.mu.Unlock()
	return nil
}

// ---- the owner's listings --------------------------------------------------------------------------------------------------------------------------------

func (r *Runtime) today(now int64) string { return time.UnixMilli(now).In(r.loc).Format("2006-01-02") }

func refsOf(l *listings.Listing, change listings.Change) map[string]string {
	return map[string]string{"listing": l.ID, "category": l.Category, "by": l.By, "from": l.From, "change": string(change)}
}

func digestOf(v any) string {
	b, _ := signing.Marshal(v)
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])[:16]
}

func (r *Runtime) listingLine(rec *recorder, change listings.Change, l listings.Listing, inputs any, outcome, notes string) {
	number, lang := r.owner()
	rec.append(NewLine{Conversation: number, Action: "listing", Outcome: outcome, Inputs: inputs, Language: lang, Refs: refsOf(&l, change), Notes: notes})
}

func (r *Runtime) ownerListing(snap *Snap, rec *recorder, ev map[string]any, now int64) {
	_, lang := r.owner()
	_, op, _ := listings.CheckOwnerListing(map[string]any{"id": ev["id"], "op": ev["op"]})
	s := snap.Touch()
	res := listings.Apply(s, op, lang, now)
	l0 := listings.Listing{ID: "l-0", Category: "other", By: "owner", From: "app"}
	if res.Why != "" {
		r.listingLine(rec, "edited", l0, map[string]any{"op": op.Op, "why": string(res.Why)}, "blocked", fmt.Sprintf("the owner's listings page asked for something the rules refuse (%s); nothing changed", res.Why))
		return
	}
	d := digestOf(ev["op"])
	if res.Listing != nil {
		r.listingLine(rec, res.Change, *res.Listing, map[string]any{"op": op.Op, "listing": res.Listing.ID, "digest": d}, "confirmed", "the owner changed their listings in their app; the record keeps the listing's id, category and who, never its words")
		return
	}
	r.listingLine(rec, res.Change, l0, map[string]any{"op": "shop", "digest": d}, "confirmed", "the owner changed how the shop shows itself (the switch, the place or the registration) in their app")
}

func (r *Runtime) ownerPhoto(snap *Snap, rec *recorder, ev map[string]any, now int64) {
	raw, _ := json.Marshal(ev["photo"])
	var p listings.Photo
	_ = json.Unmarshal(raw, &p)
	s := snap.Touch()
	why := s.NoteUpload(p, r.today(now), now)
	outcome, notes := "confirmed", "the owner added a photo through their app; it was checked and cleaned, and nothing shows it until a listing holds it"
	if why != "" {
		outcome, notes = "blocked", "the owner's photo was refused (the day's bound); its bytes are cleaned up with the others no listing holds"
	}
	r.listingLine(rec, "photo", listings.Listing{ID: p.ID, Category: "other", By: "owner", From: "app"}, map[string]any{"photo": p.ID, "bytes": p.Bytes}, outcome, notes)
}

// ---- the owner's sign-in events ---------------------------------------------------------------------------------------------------------------------------

// ownerAccess writes a sign-in event in the record (owner-signin.ts run): the session's start or end, a passkey added (with the phone's coarse label), a phone removed, codes
// made, a request cancelled. The conversation is the owner's number as it is now (the files read first).
func (r *Runtime) ownerAccess(rec *recorder, ev map[string]any) {
	number, lang := r.ownerNumberRead(), r.o.Client.Settings.Owner.Language
	what, _ := ev["what"].(string)
	session, _ := ev["session"].(string)
	inputs := map[string]any{"what": what, "session": session}
	refs := map[string]string{"what": what, "session": session}
	if how, ok := ev["how"].(string); ok && how != "" {
		inputs["how"], refs["how"] = how, how
	}
	if label, ok := ev["label"].(string); ok && label != "" {
		inputs["label"], refs["label"] = label, label
	}
	rec.append(NewLine{Conversation: number, Action: "owner_session", Outcome: "confirmed", Inputs: inputs, Language: lang, Refs: refs})
}

// ownerNumberRead is owner-signin.ts ownerNumber(): the files read into the store, then the effective number.
func (r *Runtime) ownerNumberRead() string {
	if r.o.Access == nil {
		return r.settingsNumber()
	}
	r.ownerMu.Lock()
	defer r.ownerMu.Unlock()
	n, err := r.oNumber()
	if err != nil {
		r.o.Log("The owner's number could not be worked out: " + err.Error())
	}
	return n
}

// ownerSignin is a press of "send me a link" on the owner's page. A listings-only shop has no WhatsApp, so no link is sent: the owner signs in with their passkey. The attempt is
// counted first, as every request is, so the record cannot be flooded by asking.
func (r *Runtime) ownerSignin(rec *recorder) {
	lang := r.o.Client.Settings.Owner.Language
	if r.o.Access == nil {
		r.o.Log("A sign-in event came for a shop with no owner sign-in (no pages file yet); it was dropped.")
		return
	}
	w, ok, allowed := func() (access.Who, bool, bool) {
		r.ownerMu.Lock()
		defer r.ownerMu.Unlock()
		w, ok, _ := r.oWho()
		// the attempt is counted at the time read with the lock held, as sendLink reads the clock when it starts
		return w, ok, ok && r.o.Access.TryAttempt(r.o.Now())
	}()
	if !ok {
		r.o.Log("A sign-in link was asked for, but this shop has no pages file yet (its next deploy writes one): none was sent.")
		return
	}
	if !allowed {
		r.o.Log("A sign-in link was asked for more often than the shop's limit (3 a quarter of an hour, 10 a day): none was sent.")
		return
	}
	rec.append(NewLine{Conversation: w.Owner, Action: "owner_signin", Outcome: "blocked", Inputs: map[string]any{"via": "page"}, Language: lang, Refs: map[string]string{"to": "owner", "via": "page"},
		Notes: "This shop has no WhatsApp, so no sign-in link is sent: the owner signs in with their passkey (or the Operator's setup QR or recovery card)."})
}

// beat is the clock's beat: the owner's part (owner.go ownerBeat: the Operator's request and Geometer's reset read, the owner's number watched, each finding said once, the
// panel's "sign out every device" said once), then, once a day, the clean-up of drafts and of photos no listing holds. It returns the requests to mark told once the step is saved.
func (r *Runtime) beat(snap *Snap, rec *recorder, now int64) []string {
	told := r.ownerBeat(rec)
	if now-r.lastDaily < listings.Day {
		return told
	}
	r.lastDaily = now
	if snap.hasList {
		snap.Listings.Tidy(now)
		if gone, err := r.o.Store.PrunePhotos(snap.Listings.PhotoIDs(), now-listings.PhotoGraceMs); err != nil {
			r.o.Log("The clean-up of photos failed: " + err.Error())
		} else if gone > 0 {
			r.o.Log(fmt.Sprintf("Deleted %d photo(s) no listing holds any more.", gone))
		}
	}
	return told
}

// ---- reads, from the last saved state -----------------------------------------------------------------------------------------------------------------------

func (r *Runtime) current() *Snap {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.snap
}

func (r *Runtime) publicRead() listings.PublicRead {
	s := r.current()
	if !s.hasList {
		return listings.PublicRead{Shop: listings.Shop{}, Listings: []listings.Listing{}}
	}
	return listings.PublicOf(&s.Listings, s.Stock, r.o.Now())
}

// PublicRead is what the public page and the feed read.
func (r *Runtime) PublicRead() listings.PublicRead { return r.publicRead() }

// OwnerView is the owner's listings page's data.
func (r *Runtime) OwnerView() listings.OwnerView {
	s := r.current()
	return listings.OwnerOf(&s.Listings, s.Stock, r.o.Now(), r.today(r.o.Now()))
}

// Check is what an op would do now.
func (r *Runtime) Check(op listings.Op) listings.Failure {
	_, lang := r.owner()
	return listings.Check(r.current().Listings, op, lang, r.o.Now())
}

// UploadsLeft is the day's photo bound.
func (r *Runtime) UploadsLeft() int {
	return listings.UploadsLeft(&r.current().Listings, r.today(r.o.Now()))
}

// Photo gives a photo's bytes to the public (a photo of a public listing now) or, with the owner's credential, to the owner (any photo the state holds).
func (r *Runtime) Photo(id string, owner bool) (*store.Photo, error) {
	s := r.current()
	ok := listings.PublicPhoto(&s.Listings, s.Stock, id, r.o.Now())
	if !ok && owner {
		ok = listings.OwnerHoldsPhoto(&s.Listings, id)
	}
	if !ok {
		return nil, nil
	}
	return r.o.Store.Photo(id)
}

// PutPhoto keeps a checked photo's bytes.
func (r *Runtime) PutPhoto(id string, c *listings.PhotoChecked) error {
	return r.o.Store.PutPhoto(store.Photo{ID: id, Type: c.Type, Width: c.Width, Height: c.Height, Bytes: c.Bytes, AtMs: r.o.Now()})
}

// Offer is the shop's public offer: its name, languages and place.
func (r *Runtime) Offer() map[string]any {
	s := r.o.Client.Settings
	address := s.Town
	if s.Pincode != "" {
		address += " " + s.Pincode
	}
	return map[string]any{"kind": "listings", "shop": map[string]any{"name": s.Name, "timezone": s.Timezone, "languages": s.Language, "address": address, "paused": false}}
}

// Proto is the shop's signed documents.
func (r *Runtime) Proto() *listings.Protocol { return r.proto }

// signingKey is the shop's key, read from its own store the first time one is needed and kept for the life of the process.
func (r *Runtime) signingKey() *signing.Key {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.shopKey == nil {
		k, err := LoadShopKey(r.o.Store, r.o.Client.Config.DataDir, r.o.Now(), r.o.Log)
		if err != nil {
			r.o.Log("The shop's key could not be read: " + err.Error())
			return nil
		}
		r.shopKey = k
	}
	return r.shopKey
}

// LoadShopKey is the shop's key: the one in the database; else the one in <dataDir>/shop-key.json (adopted once, then the file is removed: a shop restored from the owner's file);
// else a new one. Made inside one transaction, so two callers never make two keys. The log hears only the key's public id.
func LoadShopKey(st *store.Store, dataDir string, nowMs int64, log func(string)) (*signing.Key, error) {
	have, err := st.ShopKey()
	if err != nil {
		return nil, err
	}
	if have != "" {
		return signing.FromText(have)
	}
	file := filepath.Join(dataDir, "shop-key.json")
	if b, err := os.ReadFile(file); err == nil {
		var f struct{ Format, PrivateKey, KeyID string }
		var raw map[string]string
		if json.Unmarshal(b, &raw) == nil {
			f.Format, f.PrivateKey, f.KeyID = raw["format"], raw["privateKey"], raw["keyId"]
		}
		if k, err := signing.FromText(f.PrivateKey); err == nil && f.Format == "shop-key/1" && k.KeyID == f.KeyID {
			text, err := st.EnsureShopKey(f.PrivateKey, nowMs)
			if err != nil {
				return nil, err
			}
			_ = os.Remove(file) // the key is kept either way; a file left behind is only untidy
			log(fmt.Sprintf("The shop's signing key (id %s) was taken from shop-key.json.", k.KeyID))
			return signing.FromText(text)
		}
		log("shop-key.json is not a good key file, so it was ignored.")
	}
	k, text, err := signing.Generate()
	if err != nil {
		return nil, err
	}
	kept, err := st.EnsureShopKey(text, nowMs)
	if err != nil {
		return nil, err
	}
	if kept != text {
		return signing.FromText(kept)
	}
	log(fmt.Sprintf("The shop made its signing key (id %s).", k.KeyID))
	return k, nil
}

// ---- status ---------------------------------------------------------------------------------------------------------------------------------------------

// Ready: the store can be read and the queue is going.
func (r *Runtime) Ready() (bool, string) {
	if err := r.o.Store.Ping(); err != nil {
		return false, "The store cannot be read: " + err.Error()
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.broken != "" {
		return false, "The queue cannot read its tasks: " + r.broken
	}
	return true, ""
}

func iso(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }

// Status is counts only, never a title or a word the owner said.
func (r *Runtime) Status() (map[string]any, error) {
	counts, err := r.o.Store.TaskCounts()
	if err != nil {
		return nil, err
	}
	oldest, err := r.o.Store.OldestPendingAt()
	if err != nil {
		return nil, err
	}
	var oldestISO any
	if oldest != nil {
		oldestISO = iso(*oldest)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	by := map[string]int{}
	for _, l := range r.snap.Listings.Items {
		by[l.State]++
	}
	var lastStep, lastFail any
	if r.lastStep != 0 {
		lastStep = iso(r.lastStep)
	}
	if r.lastFail != 0 {
		lastFail = iso(r.lastFail)
	}
	ai := r.snap.AI
	return map[string]any{
		"pathway": Pathway, "version": Version, "listings": by,
		"refunds": map[string]any{"waitingForOwner": 0, "beingSentAgain": 0, "needBuilder": map[string]any{"total": 0}},
		"tasks":   counts, "oldestPendingAt": oldestISO, "waitingForGuard": nil, "lastStepAt": lastStep, "lastFailureAt": lastFail, "recordLength": len(r.entries),
		"steps": r.steps, "errors": r.errors, "startedAt": iso(r.started), "ai": budget.Summary(&ai, r.policy, r.clock, r.o.Now()),
	}, nil
}

// newUUID is a random id for an event the runtime makes itself.
func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	h := hex.EncodeToString(b)
	return strings.Join([]string{h[:8], h[8:12], h[12:16], h[16:20], h[20:]}, "-")
}

func originOf(base string) (access.RelyingParty, bool) {
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" {
		return access.RelyingParty{}, false
	}
	return access.RelyingParty{RpID: u.Hostname(), Origin: strings.TrimSuffix(u.Scheme+"://"+u.Host, ":443")}, true
}
