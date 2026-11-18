package runtime

// The shop's web push (modules/push, modules/runtime/http.ts "item 11h", modules/runtime/start.ts): the route POST /internal/channel/push, and the alerts to the owner's phones.
//
// On only when runtime.json names the shop's push Guard (`services.push.baseUrl`), exactly as TypeScript decides; off, the key answers {on: false} and every other op 404. The store is
// push.sqlite in the data folder (internal/push), the TypeScript runtime's own file, so a subscription made by one runtime is seen by the other. The sender drains the queue to the Guard
// outside the shop's steps (internal/push/sender.go).
//
// For a listings shop the customer_* ops have nothing to act on (no chat, no booking pages), so, as TypeScript answers it, a well-formed handle gets 404 "No page with alerts has this
// handle." and a malformed one 400.
//
// The seams for the owner-control port: PushOwner (an alert to the owner's phones: the new-phone, phone-removed, recovery-codes and Operator-request alerts call it), AlertPhones (the
// count /status reports), and the store's DropRef, OwnerSubs, DropOwnerSub and DropUnbound through Runtime.Push().

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

// Push is the shop's push (nil for a shop with no channel token).
func (r *Runtime) Push() *push.Push { return r.routes.push }

// PushOwner sends an alert to the owner's phones when push is on, in the owner's language (TypeScript: `push.owner(text[owner.language], tag)`); it returns the ids queued (none: no phone
// allowed alerts, or push is off). `tag` "" is the default "owner".
func (r *Runtime) PushOwner(text map[string]string, tag string) []string {
	p := r.routes.push
	_, lang := r.owner()
	if p == nil || !p.On || text[lang] == "" {
		return nil
	}
	return p.Owner(text[lang], tag)
}

// AlertPhones is how many phones get the owner's alerts, for /status (0 when push is off).
func (r *Runtime) AlertPhones() int {
	if p := r.routes.push; p != nil && p.On {
		return p.OwnerPhones()
	}
	return 0
}

var handleHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

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
		if h, _ := body["handle"].(string); !handleHash.MatchString(h) {
			send(w, 400, errBody("handle is the handle's hash: 64 hex digits."))
		} else {
			// a listings shop has no chat and no booking, order or fee pages: no handle names a page with alerts
			send(w, 404, errBody("No page with alerts has this handle."))
		}
		return nil
	}
	send(w, 400, errBody("op is key, owner_* or customer_*."))
	return nil
}

func (s *Server) pushOwnerOp(w http.ResponseWriter, r *http.Request, p *push.Push, op string, body map[string]any, whatsapp bool) error {
	rt := s.rt
	if !s.ownerAuthorised(r) {
		send(w, 403, errBody(ownerRefused))
		return nil
	}
	// The panel's owner link is the OPERATOR's: once the owner holds a passkey it may not subscribe a phone to the owner's alerts (which can carry what the shop says to the owner), change
	// the owner's choice or drop a subscription. Only a signed-in session may, and a subscription is tied to the phone (passkey) it was made from.
	session := r.Header.Get(access.OwnerSessionHeader)
	if session != "" && !rt.SessionOK(session) {
		session = ""
	}
	locked := rt.PasskeysOn() && rt.routes.passkeys.Locked()
	if session == "" && op != "owner_state" && locked {
		send(w, 403, errBody("Sign in with the owner's phone to change alerts."))
		return nil
	}
	switch op {
	case "owner_subscribe":
		ref := ""
		if session != "" {
			ref = rt.routes.passkeys.PasskeyOf(session)
		}
		// once locked, only a PHONE (a passkey session) may subscribe: a subscription with no phone could never be ended by removing one
		if ref == "" && locked {
			send(w, 403, errBody("Sign in with your phone's fingerprint to turn on alerts."))
			return nil
		}
		sub, ok := subscriptionOf(body["subscription"])
		why := push.ShapeProblem
		if ok {
			why = p.Subscribe("owner", sub, "own", ref)
		}
		if why != "" {
			send(w, 400, errBody(why))
			return nil
		}
		// the first phone with alerts: both ways for a shop with WhatsApp (the owner can then pick), push alone for one without
		if p.OwnerPhones() == 1 && p.Choice() == "whatsapp" {
			next := "push"
			if whatsapp {
				next = "both"
			}
			if err := p.SetChoice(next); err != nil {
				return err
			}
		}
	case "owner_unsubscribe":
		endpoint, ok := body["endpoint"].(string)
		if !ok {
			send(w, 400, errBody("Send the endpoint to stop."))
			return nil
		}
		p.Unsubscribe("owner", endpoint)
	case "owner_choice":
		choice, _ := body["choice"].(string)
		if !validChoice(choice) {
			send(w, 400, errBody("choice is one of "+strings.Join(push.OwnerChoices, ", ")+"."))
			return nil
		}
		if !whatsapp && choice != "push" {
			send(w, 400, errBody("This shop has no WhatsApp: alerts come by push."))
			return nil
		}
		if err := p.SetChoice(choice); err != nil {
			return err
		}
	case "owner_state":
	default:
		send(w, 400, errBody("op is not one this route knows."))
		return nil
	}
	choice := "push"
	if whatsapp {
		choice = p.Choice()
	}
	send(w, 200, map[string]any{"on": true, "whatsapp": whatsapp, "choice": choice, "phones": p.OwnerPhones()})
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
