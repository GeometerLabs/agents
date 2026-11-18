package push

// A shop's web push as the rest of the runtime sees it (modules/push/push.ts): alerts to the owner by the owner's choice of WhatsApp, push or both. Made once per runtime. Off (no push
// Guard named in runtime.json) nothing is queued and the routes say so.

import "strings"

// Push is the shop's push.
type Push struct {
	// On: the shop has a push Guard. Off: nothing is queued.
	On bool
	// RelayKey is Streetlist's push public key when this shop sends through the relay; "" otherwise.
	RelayKey string
	store    *Store
	sender   *Sender
	shop     string
	now      func() int64
}

// New makes the shop's push over an open store; `sender` may be nil when push is off.
func New(store *Store, sender *Sender, shopName string, now func() int64, on bool, relayKey string) *Push {
	return &Push{On: on, RelayKey: relayKey, store: store, sender: sender, shop: shopName, now: now}
}

// Store is the underlying store (the runtime's routes read it for the counts and the owner's subscriptions).
func (p *Push) Store() *Store { return p.store }

// PublicKey is the shop's VAPID public key, for the pages' `applicationServerKey`.
func (p *Push) PublicKey() (string, error) {
	k, err := p.store.Vapid()
	return k.PublicKey, err
}

// ActiveRelayKey is the relay key when push is on (push.ts relayKey()).
func (p *Push) ActiveRelayKey() string {
	if p.On {
		return p.RelayKey
	}
	return ""
}

// Owner queues an alert to the owner's phones and returns the ids queued: none means no phone allowed alerts. `tag` is the notification's tag ("owner" by default).
func (p *Push) Owner(text, tag string) []string {
	if !p.On {
		return nil
	}
	if tag == "" {
		tag = "owner"
	}
	title := p.shop
	if title == "" {
		title = "Shop"
	}
	ids, _ := p.store.Enqueue("owner", "owner", title, FitNotification(text, 300), tag, p.now())
	if len(ids) > 0 && p.sender != nil {
		p.sender.Kick()
	}
	return ids
}

// OwnerPhones is how many phones get the owner's alerts now.
func (p *Push) OwnerPhones() int { n, _ := p.store.Phones("owner"); return n }

// Choice is the owner's choice now.
func (p *Push) Choice() string { c, _ := p.store.Choice(); return c }

// SetChoice keeps the owner's choice.
func (p *Push) SetChoice(c string) error { return p.store.SetChoice(c) }

// Subscribe keeps a phone's subscription; refused (with a reason) when push is off or the subscription is not good.
func (p *Push) Subscribe(who string, s Subscription, signer, ref string) (why string) {
	if !p.On {
		return "push is not on for this shop"
	}
	if signer == "streetlist" && p.RelayKey == "" {
		return "this shop does not send through the Streetlist app"
	}
	if signer == "" {
		signer = "own"
	}
	_, why, err := p.store.Subscribe(who, s, p.now(), signer, ref)
	if err != nil {
		return "The subscription could not be kept: " + strings.TrimSpace(err.Error())
	}
	return why
}

// Unsubscribe ends the subscription at this endpoint.
func (p *Push) Unsubscribe(who, endpoint string) bool {
	ok, _ := p.store.Unsubscribe(who, endpoint, p.now())
	return ok
}

// DropRef: the owner removed a phone: the alerts it asked for end (owner's item 2).
func (p *Push) DropRef(ref string) int { n, _ := p.store.DropRef(ref, p.now()); return n }

// OwnerSubs are the owner's alert subscriptions with the phone (passkey) each came from.
func (p *Push) OwnerSubs() []OwnerSub { s, _ := p.store.OwnerSubs(); return s }

// DropOwnerSub: the owner stops one alert subscription.
func (p *Push) DropOwnerSub(id string) bool { ok, _ := p.store.DropOwnerSub(id, p.now()); return ok }

// DropUnbound: the lock ends every owner subscription that came from no phone.
func (p *Push) DropUnbound() int { n, _ := p.store.DropUnbound(p.now()); return n }
