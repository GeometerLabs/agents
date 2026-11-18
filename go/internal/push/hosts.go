// Package push is a shop's web push, the Go twin of modules/push (plan item 11h, decision 45): the push store (the shop's VAPID key, the phones that allowed alerts, the owner's
// choice, the waiting pushes), the two pieces of cryptography (RFC 8291 message encryption, RFC 8292 VAPID signatures) and the sender that hands each waiting push to the shop's push
// Guard. It uses the standard library only (crypto/ecdh, crypto/ecdsa, crypto/hkdf, net/http, database/sql with the SQLite driver the store already has).
//
// This file: where a shop's pushes may go, and what is posted to the Guard (modules/push/hosts.ts), so the host a browser subscribes at, the host Guard allows and the host the sender
// reaches are one list.
package push

import (
	"net/url"
	"regexp"
	"strings"
)

// Hosts are the push services, exactly: Google's FCM (Chrome, Edge, Samsung Internet), Mozilla's (Firefox) and Apple's (Safari). Edge on Windows uses hosts that vary and is not covered.
var Hosts = []string{"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"}

// Routes are the JSON routes the sender posts to the push Guard, one per kind of push.
var Routes = map[string]string{"owner": "/v1/push/owner", "customer": "/v1/push/customer"}

// Call is what the sender posts to its push Guard: the push service's host (the field Guard's allowlist checks), the subscription's path and short id, how long the service may keep
// it, the VAPID header (or `relay`, the shop's name for Streetlist's relay to sign it) and the encrypted body in base64url. The field order is the TypeScript object's, so a log of
// either reads the same.
type Call struct {
	Host    string `json:"host"`
	Path    string `json:"path"`
	Sub     string `json:"sub"`
	TTL     int    `json:"ttl"`
	Urgency string `json:"urgency"`
	Topic   string `json:"topic,omitempty"`
	Vapid   string `json:"vapid,omitempty"`
	Relay   string `json:"relay,omitempty"`
	Body    string `json:"body"`
}

func hostAllowed(h string) bool {
	for _, x := range Hosts {
		if x == h {
			return true
		}
	}
	return false
}

// pageSlug is hosts.ts PAGE_SLUG. JavaScript's pattern uses look-ahead (`(?!.*--)(?![0-9]+$)`); RE2 has none, so the two refusals are made by hand after the shape matches.
var pageSlug = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`)

func slugOK(s string) bool {
	if !pageSlug.MatchString(s) || strings.Contains(s, "--") {
		return false
	}
	return strings.Trim(s, "0123456789") != ""
}

// SlugOfPage is the shop's address name from its page address (pages.json `url`, https://<pages domain>/<slug>), or "" when it has none of the right shape.
func SlugOfPage(page string) string {
	if page == "" {
		return ""
	}
	u, err := url.Parse(page)
	if err != nil || u.Host == "" {
		return ""
	}
	for _, seg := range strings.Split(u.Path, "/") {
		if seg != "" {
			if slugOK(seg) {
				return seg
			}
			return ""
		}
	}
	return ""
}
