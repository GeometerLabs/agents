package fees

// The parents' web push (push.ts alsoPushTo and server/runtime.ts's wiring of it, release-flow batch 3; ported 24 Nov 2026): every message the centre sends to a number also goes,
// as a web push, to the private page of the parent with that number, when a phone allowed alerts there. So a parent hears the fee reminder, a payment seen or a refund without
// WhatsApp, or besides it, and a centre with no WhatsApp still reaches its parents.
//
// How it is kept the TypeScript's:
//   - the conversation is "parent:" and the parent's stable ref (ParentRef of the number), never the link, which is made again at the first reminder after a restart; a number whose
//     page never allowed alerts has no subscription, so nothing is queued (the owner's own number included);
//   - the words pushed are the message's words with every address taken out (withoutAddresses): a reminder carries the parent's private link and a payment link, and no address
//     travels in a push; the WhatsApp message itself keeps them. Nothing else is added: no student's name or number that the message did not already carry to that parent;
//   - the push is queued FIRST and never fails the message (runtime.CustomerPush logs a store error and goes on); the message then goes on as before, and fails as before when the
//     centre has no WhatsApp;
//   - only the words of a text, a template and an interactive message's body are pushed; pictures and documents pass through untouched (alsoPushTo spreads `...base`).

import (
	"context"
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

// The three replacements of runtime.ts withoutAddresses. JavaScript's `\S` (with the u flag) is anything but JavaScript's whitespace, which Go's `\S` is not (ASCII only), so the
// class is built from language.JSSpace. Go's `\b` is ASCII; JavaScript's `\b` under /iu also counts U+017F and U+212A as word letters, which no address begins after.
var (
	addressRe  = regexp.MustCompile(`(?i)\bhttps?://[^` + language.JSSpace + `]+`)
	blanksRe   = regexp.MustCompile(`[ \t]+`)
	emptyRunRe = regexp.MustCompile(`\n[ \t]*\n+`)
)

// withoutAddresses is runtime.ts withoutAddresses: the words with every http(s) address taken out, runs of spaces made one, empty lines dropped, and trimmed as JavaScript trims.
func withoutAddresses(text string) string {
	text = addressRe.ReplaceAllString(text, "")
	text = blanksRe.ReplaceAllString(text, " ")
	text = emptyRunRe.ReplaceAllString(text, "\n")
	return language.TrimJS(text)
}

// alsoPushTo is push.ts alsoPushTo over the centre's messaging: base keeps every interface it had (buttons, pictures), so a step asks it what it can do exactly as before.
// push nil: base itself.
func alsoPushTo(base messaging.Messaging, push func(conversation, text string)) messaging.Messaging {
	if push == nil {
		return base
	}
	a := &alsoPush{base: base, push: push}
	_, inter := base.(messaging.Interactive)
	_, img := base.(messaging.Images)
	switch {
	case inter && img:
		return alsoPushInterImages{alsoPushInter{a}}
	case inter:
		return alsoPushInter{a}
	case img:
		return alsoPushImages{a}
	}
	return a
}

type alsoPush struct {
	base messaging.Messaging
	push func(conversation, text string)
}

// also queues the words to the parent's page (push.ts `also`): nothing when no words are left once the addresses are out.
func (a *alsoPush) also(to, text string) {
	if words := withoutAddresses(text); words != "" {
		a.push("parent:"+ParentRef(to), words)
	}
}

func (a *alsoPush) SendText(ctx context.Context, to, text string) (messaging.OutboundMessage, error) {
	a.also(to, text)
	return a.base.SendText(ctx, to, text)
}

func (a *alsoPush) SendTemplate(ctx context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	a.also(to, t.Text)
	return a.base.SendTemplate(ctx, to, t)
}

func (a *alsoPush) IsWindowOpen(ctx context.Context, to string) (bool, error) {
	return a.base.IsWindowOpen(ctx, to)
}

func (a *alsoPush) GetMessage(ctx context.Context, id string) (*messaging.OutboundMessage, error) {
	return a.base.GetMessage(ctx, id)
}

type alsoPushInter struct{ *alsoPush }

// SendInteractive pushes the words above the buttons (push.ts: `also(to, m.body)`).
func (a alsoPushInter) SendInteractive(ctx context.Context, to string, m messaging.InteractiveMessage) (messaging.OutboundMessage, error) {
	a.also(to, m.Body)
	return a.base.(messaging.Interactive).SendInteractive(ctx, to, m)
}

type alsoPushImages struct{ *alsoPush }

// SendImage passes a picture on as it is: a push carries words only.
func (a alsoPushImages) SendImage(ctx context.Context, to string, i messaging.ImageMessage) (messaging.OutboundMessage, error) {
	return a.base.(messaging.Images).SendImage(ctx, to, i)
}

type alsoPushInterImages struct{ alsoPushInter }

func (a alsoPushInterImages) SendImage(ctx context.Context, to string, i messaging.ImageMessage) (messaging.OutboundMessage, error) {
	return a.base.(messaging.Images).SendImage(ctx, to, i)
}
