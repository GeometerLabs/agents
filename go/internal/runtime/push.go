package runtime

// The shop's web push (modules/push, modules/runtime/http.ts "item 11h", modules/runtime/start.ts): the route POST /internal/channel/push, and the alerts to the owner's phones.
//
// On only when runtime.json names the shop's push Guard (`services.push.baseUrl`), exactly as TypeScript decides; off, the key answers {on: false} and every other op 404. The store is
// push.sqlite in the data folder (internal/push), the TypeScript runtime's own file, so a subscription made by one runtime is seen by the other. The sender drains the queue to the Guard
// outside the shop's steps (internal/push/sender.go).
//
// The customer_* ops (24 Nov 2026, http.ts "push"): a customer who allowed alerts on their booking's or order's page, a chat guest the shop has answered, or a Fees parent on their
// private page keeps a phone's subscription under that page's conversation ("web:<16 hex>", "mcp:<16 hex>", "chat:<16 hex>", "parent:p-<12 hex>"), at most two phones each, in the
// same push.sqlite rows the TypeScript wrote. CustomerPush queues the words a page was given to those phones (a template's agent calls it when it keeps a message for a page,
// runtime.ChannelMessaging and bookings' chanMsg, and Fees for a message to a parent's number). For a listings shop (no template kit) the ops have nothing to act on, so, as
// TypeScript answers it, a well-formed handle gets 404 "No page with alerts has this handle." and a malformed one 400.
//
// The owner's side (who may subscribe, the alerts to the owner's phones, what ends a subscription) is the owner's sign-in's: owner.go OwnerPushOp and alert, under the owner lock.
// Here are the route's shape, PushOwner (one alert queued for the owner's phones) and AlertPhones (the count /status reports).

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/push"
)

// pushConfig is what runtime.json says about push: `services.push` (the Guard and, for a shop behind the Streetlist door, the relay) and whether the shop has WhatsApp (config.ts
// `runtimeHasWhatsApp`: no `services` at all means a fakes-mode shop keeps its stand-in WhatsApp, otherwise it has WhatsApp only if `services.messaging` is named).
type pushConfig struct {
	on                                           bool
	baseURL, agentTokenFile, relayKey, relayShop string
	whatsapp                                     bool
}

func readPushConfig(c *Client) pushConfig {
	var raw struct {
		Services map[string]json.RawMessage `json:"services"`
	}
	b, err := os.ReadFile(filepath.Join(c.Folder, "runtime.json"))
	if err != nil || json.Unmarshal(b, &raw) != nil {
		return pushConfig{whatsapp: c.Config.Mode != "live"}
	}
	cfg := pushConfig{whatsapp: c.Config.Mode != "live"}
	if raw.Services != nil {
		_, cfg.whatsapp = raw.Services["messaging"]
		var p struct {
			BaseURL        *string `json:"baseUrl"`
			AgentTokenFile string  `json:"agentTokenFile"`
			RelayKey       string  `json:"relayKey"`
			RelayShop      string  `json:"relayShop"`
		}
		if json.Unmarshal(raw.Services["push"], &p) == nil && p.BaseURL != nil {
			cfg.on, cfg.baseURL, cfg.agentTokenFile, cfg.relayKey, cfg.relayShop = true, *p.BaseURL, p.AgentTokenFile, p.RelayKey, p.RelayShop
		}
	}
	return cfg
}

// initPush makes the shop's push, for a shop with a channel token (TypeScript opens the store only then; this runtime's owner sign-in file exists only then too).
func (r *Runtime) initPush() error {
	if r.o.Access == nil {
		return nil
	}
	cfg := readPushConfig(r.o.Client)
	st, err := push.Open(filepath.Join(r.o.Client.Config.DataDir, push.File))
	if err != nil {
		return err
	}
	var guard *push.Guard
	if cfg.baseURL != "" {
		guard = &push.Guard{BaseURL: cfg.baseURL}
		if cfg.agentTokenFile != "" {
			file := cfg.agentTokenFile
			if !filepath.IsAbs(file) {
				file = filepath.Join(r.o.Client.Folder, file)
			}
			b, err := os.ReadFile(file)
			if err != nil {
				st.Close()
				return ClientError{"I could not read the push Guard's credential file named in runtime.json (services.push.agentTokenFile)."}
			}
			guard.AgentToken = strings.TrimSpace(string(b))
		}
	}
	var relay *push.Relay
	relayKey := ""
	if cfg.relayKey != "" && cfg.relayShop != "" {
		relay = &push.Relay{Shop: cfg.relayShop, Slug: func() string { u, _, _ := r.PagesURL(); return push.SlugOfPage(u) }}
		relayKey = cfg.relayKey
	}
	sender := push.NewSender(push.SenderOptions{
		Store: st, Guard: guard, Now: r.o.Now, Relay: relay, Log: r.o.Log,
		OnPanic: func(p any) { r.panicked("push sender", p) },
		// the VAPID contact: the shop's page (never a person's e-mail)
		Subject: func() string {
			if u, base, ok := r.PagesURL(); ok {
				if u != "" {
					return u
				}
				return base
			}
			return ""
		},
	})
	r.routes.push, r.routes.sender, r.routes.pushCfg = push.New(st, sender, r.o.Client.Settings.Name, r.o.Now, cfg.on, relayKey), sender, cfg
	return nil
}

// Push is the shop's push (nil for a shop with no channel token, and before the routes are made).
func (r *Runtime) Push() *push.Push {
	if r.routes == nil {
		return nil
	}
	return r.routes.push
}

// PushOwner queues an alert to the owner's phones when push is on (TypeScript: `push.owner(text, tag)`); `text` is already in the owner's language. It returns the ids queued (none:
// no phone allowed alerts, or push is off) and the store's error. `tag` "" is the default "owner".
func (r *Runtime) PushOwner(text, tag string) ([]string, error) {
	p := r.Push()
	if p == nil || !p.On || text == "" {
		return nil, nil
	}
	return p.Owner(text, tag)
}

// AlertPhones is how many phones get the owner's alerts, for /status (0 when push is off).
func (r *Runtime) AlertPhones() int {
	if p := r.routes.push; p != nil && p.On {
		return p.OwnerPhones()
	}
	return 0
}

// subscriptionOf reads a browser's PushSubscription from a body's `subscription`: the shape push/store.ts `subscriptionProblem` checks first.
func subscriptionOf(v any) (push.Subscription, bool) {
	o, _ := v.(map[string]any)
	keys, _ := o["keys"].(map[string]any)
	endpoint, ok1 := o["endpoint"].(string)
	p256dh, ok2 := keys["p256dh"].(string)
	auth, ok3 := keys["auth"].(string)
	return push.Subscription{Endpoint: endpoint, P256dh: p256dh, Auth: auth}, ok1 && ok2 && ok3
}

// pushRoute is POST /internal/channel/push: {"op": "key"} | owner_state | owner_subscribe | owner_unsubscribe | owner_choice | customer_*. The body is read first, as TypeScript does
// (a bad body is 400 whatever the op), then push-off answers, then the op.
func (s *Server) pushRoute(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "POST"); err != nil {
		return err
	}
	raw, ok := readJSON(w, r, 8*1024)
	if !ok {
		return nil
	}
	if raw == nil {
		return errors.New("a JSON null where an object was expected") // TypeScript reads `body.op` of null and answers its generic 500
	}
	body, _ := raw.(map[string]any) // an array, a string or a number has no `op`
	op, _ := body["op"].(string)
	rt, p := s.rt, s.rt.routes.push
	if p == nil || !p.On {
		status := 404
		if op == "key" {
			status = 200
		}
		send(w, status, map[string]any{"on": false})
		return nil
	}
	if op == "key" {
		pub, err := p.PublicKey()
		if err != nil {
			return err
		}
		out := map[string]any{"on": true, "publicKey": pub}
		if k := p.ActiveRelayKey(); k != "" {
			out["relayKey"] = k
		}
		send(w, 200, out)
		return nil
	}
	whatsapp := rt.routes.pushCfg.whatsapp
	if strings.HasPrefix(op, "owner_") {
		return s.pushOwnerOp(w, r, p, op, body, whatsapp)
	}
	if strings.HasPrefix(op, "customer_") {
		h, _ := body["handle"].(string)
		if !HandleHash.MatchString(h) {
			send(w, 400, errBody("handle is the handle's hash: 64 hex digits."))
			return nil
		}
		return s.pushCustomerOp(w, p, op, h, body)
	}
	send(w, 400, errBody("op is key, owner_* or customer_*."))
	return nil
}

// parentRefOf is the shape of a Fees parent's stable ref (channel.ts parentRef: "p-" and 12 hex digits), the only ref a parent's alerts are kept under.
var parentRefOf = regexp.MustCompile(`^p-[0-9a-f]{12}$`)

// pushCustomerOp is http.ts's customer_* branch, in its order: a chat thread the runtime knows first (alerts offered only after the shop's first answer), then a Fees parent's private
// page (keyed by the PARENT's stable ref, not by the link, which is made again after a restart), then a booking's or order's own page made on the page or through MCP (a WhatsApp
// customer hears on WhatsApp). Anything else is 404, the same answer for a page that never was and one at another shop.
func (s *Server) pushCustomerOp(w http.ResponseWriter, p *push.Push, op, handle string, body map[string]any) error {
	rt := s.rt
	var ch ChannelKit
	if rt.o.Kit != nil {
		ch = rt.o.Kit.Channel()
	}
	if ch == nil {
		// a listings shop has no chat and no booking, order or fee pages: no handle names a page with alerts
		send(w, 404, errBody("No page with alerts has this handle."))
		return nil
	}
	st, _, _ := rt.KitState()
	// W2: a phone tied to a thread has that thread's alerts (chat-identity's openRead)
	thread, _ := rt.openRead(handle, "")
	cs, err := rt.channelOf(st)
	if err != nil {
		return err
	}
	var who string
	chat := ChatKnown(cs, thread)
	if chat {
		if op == "customer_subscribe" && !ChatAnswered(cs, thread) {
			send(w, 403, errBody("Alerts are offered after the first answer."))
			return nil
		}
		who = ChatConversationOf(thread)
	} else {
		who = pageConversation(ch, st, handle)
		if who == "" {
			send(w, 404, errBody("No page with alerts has this handle."))
			return nil
		}
	}
	switch op {
	case "customer_subscribe":
		signer := "own"
		if body["signer"] == "streetlist" {
			signer = "streetlist"
		}
		if why := subscribeWhy(p, who, body["subscription"], signer); why != "" {
			send(w, 400, errBody(why))
			return nil
		}
	case "customer_unsubscribe":
		endpoint, ok := body["endpoint"].(string)
		if !ok {
			send(w, 400, errBody("Send the endpoint to stop."))
			return nil
		}
		p.Unsubscribe(who, endpoint)
	case "customer_state":
	default:
		send(w, 400, errBody("op is not one this route knows."))
		return nil
	}
	phones, err := p.Phones(who)
	if err != nil {
		return err
	}
	out := map[string]any{"on": true, "phones": phones}
	if chat {
		out["answered"] = ChatAnswered(cs, thread)
	}
	send(w, 200, out)
	return nil
}

// pageConversation is the conversation whose alerts this handle's page keeps: a Fees parent's ("parent:<ref>") when the kit has parents' pages and the link is one, else a booking's
// or order's page made on the page or through MCP ("web:" or "mcp:" and 16 hex digits of the hash, conversation.ts conversationOf); "" for none. A view is whatever the template's
// read gives (an ordered object, a map, a struct), so its two members are read from its JSON.
func pageConversation(ch ChannelKit, st KitState, handle string) string {
	member := func(v any, name string) string {
		b, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		var o map[string]json.RawMessage
		if json.Unmarshal(b, &o) != nil {
			return ""
		}
		var text string
		if json.Unmarshal(o[name], &text) != nil {
			return ""
		}
		return text
	}
	if pr, ok := ch.(ParentReader); ok {
		if v := pr.Parent(st, handle); v != nil {
			if ref := member(v, "ref"); parentRefOf.MatchString(ref) {
				return "parent:" + ref
			}
		}
	}
	if v := ch.View(st, handle); v != nil {
		if c := member(v, "channel"); c == "web" || c == "mcp" {
			return c + ":" + handle[:16]
		}
	}
	return ""
}

// subscribeWhy is push.subscribe's refusal for a customer's phone, or "", in push.ts's order: a Streetlist app phone at a shop with no relay first, then a body that is not
// {endpoint, keys: {p256dh, auth}} (store.ts subscriptionProblem's first check), then the address and the keys.
func subscribeWhy(p *push.Push, who string, raw any, signer string) string {
	sub, ok := subscriptionOf(raw)
	if !ok && (signer != "streetlist" || p.RelayKey != "") {
		return push.ShapeProblem
	}
	return p.Subscribe(who, sub, signer, "")
}

// CustomerPush is push.ts `customer` for a template's agent: the words a page's conversation was given go to the phones that allowed alerts on that page. It never fails the
// message it rides on (outbox.ts onKeep: "an alert that could not be queued never fails the page's message"): push off, no phone, or a store error queues nothing, said in the
// log without the words or the conversation.
func (r *Runtime) CustomerPush(conversation, text string) {
	p := r.Push()
	if p == nil || !p.On || conversation == "" {
		return
	}
	if _, err := p.Customer(conversation, text); err != nil {
		r.o.Log("A customer's alert could not be queued: " + err.Error())
	}
}

// pushOwnerOp: the owner's credential and every owner-control rule are checked in owner.go OwnerPushOp, under the owner lock.
func (s *Server) pushOwnerOp(w http.ResponseWriter, r *http.Request, p *push.Push, op string, body map[string]any, whatsapp bool) error {
	link, _ := header(r, access.OwnerLinkHeader)
	session, sent := header(r, access.OwnerSessionHeader)
	status, out, err := s.rt.OwnerPushOp(p, op, body, link, session, sent, whatsapp)
	if err != nil {
		return err
	}
	send(w, status, out)
	return nil
}

func validChoice(c string) bool {
	for _, x := range push.OwnerChoices {
		if x == c {
			return true
		}
	}
	return false
}
