package runtime

// modules/channels/outbox.ts channelMessaging for a template's agent that keeps its channel in its own store (wave 3: Fees): a message to a channel's conversation (web:, mcp:,
// chat:) is KEPT in the channel state for its page and never sent to a number; everything else goes to the shop's messaging as it was. Bookings has the same code over its own
// store (internal/bookings agent_channel.go chanMsg); this is the same behaviour over any store, given the state and the clock, so another template does not write it again.

import (
	"context"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

type chanOut struct {
	base  messaging.Messaging
	state func() *ChannelState
	now   func() int64
}

// ChannelMessaging is outbox.ts channelMessaging: base is the shop's messaging (nil: none), state the step's channel state, made on first use.
func ChannelMessaging(base messaging.Messaging, state func() *ChannelState, now func() int64) messaging.Messaging {
	return chanOutInteractive{&chanOut{base: base, state: state, now: now}}
}

func (c *chanOut) keep(to, kind, text string, choices []ChatChoice) messaging.OutboundMessage {
	m := c.state().Keep(to, text, choices, c.now())
	return messaging.OutboundMessage{ID: m.ID, To: to, Kind: kind, Text: text, SentAt: m.AtMs}
}

func noChanWhatsApp() error {
	return &guard.ApiError{Status: 400, Message: "This shop has no WhatsApp number yet, so nothing was sent; the owner's page shows what waits for them."}
}

func (c *chanOut) SendText(ctx context.Context, to, text string) (messaging.OutboundMessage, error) {
	if IsChannelConversation(to) {
		return c.keep(to, "text", text, nil), nil
	}
	if c.base == nil {
		return messaging.OutboundMessage{}, noChanWhatsApp()
	}
	return c.base.SendText(ctx, to, text)
}

func (c *chanOut) SendTemplate(ctx context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	if IsChannelConversation(to) {
		return c.keep(to, "text", t.Text, nil), nil
	}
	if c.base == nil {
		return messaging.OutboundMessage{}, noChanWhatsApp()
	}
	return c.base.SendTemplate(ctx, to, t)
}

func (c *chanOut) IsWindowOpen(ctx context.Context, to string) (bool, error) {
	if IsChannelConversation(to) {
		return true, nil
	}
	if c.base == nil {
		return false, nil
	}
	return c.base.IsWindowOpen(ctx, to)
}

func (c *chanOut) GetMessage(ctx context.Context, id string) (*messaging.OutboundMessage, error) {
	if strings.HasPrefix(id, "ch-") {
		for _, m := range c.state().Outbox {
			if m.ID == id {
				return &messaging.OutboundMessage{ID: m.ID, To: m.To, Kind: "text", Text: m.Text, SentAt: m.AtMs}, nil
			}
		}
		return nil, nil
	}
	if c.base == nil {
		return nil, nil
	}
	return c.base.GetMessage(ctx, id)
}

type chanOutInteractive struct{ *chanOut }

// SendInteractive: a channel's conversation keeps the words and the choices (outbox.ts choicesOf).
func (c chanOutInteractive) SendInteractive(ctx context.Context, to string, m messaging.InteractiveMessage) (messaging.OutboundMessage, error) {
	if IsChannelConversation(to) {
		var buttons, rows []ChatChoice
		for _, b := range m.Buttons {
			buttons = append(buttons, ChatChoice{ID: b.ID, Title: b.Title})
		}
		if m.List != nil {
			for _, r := range m.List.Rows {
				ch := ChatChoice{ID: r.ID, Title: r.Title, List: true}
				if r.Description != nil {
					ch.Hint = *r.Description
				}
				rows = append(rows, ch)
			}
		}
		return c.keep(to, "text", m.Body, ChoicesOf(buttons, rows)), nil
	}
	if c.base == nil {
		return messaging.OutboundMessage{}, noChanWhatsApp()
	}
	inter, ok := c.base.(messaging.Interactive)
	if !ok {
		return messaging.OutboundMessage{}, &guard.ApiError{Status: 400, Message: "This WhatsApp provider has no buttons."}
	}
	return inter.SendInteractive(ctx, to, m)
}

// SendImage passes a picture on to the shop's messaging when it takes one (a channel's conversation has no pictures).
func (c chanOutInteractive) SendImage(ctx context.Context, to string, i messaging.ImageMessage) (messaging.OutboundMessage, error) {
	img, ok := c.base.(messaging.Images)
	if IsChannelConversation(to) || !ok {
		return messaging.OutboundMessage{}, &guard.ApiError{Status: 400, Message: "This conversation takes no pictures."}
	}
	return img.SendImage(ctx, to, i)
}
