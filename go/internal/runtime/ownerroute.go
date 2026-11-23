package runtime

// The owner's route for a template that has none of its own yet: the two small functions every template's agent hands to bookings.OwnerRoute (push.ts pushMessaging and ownerRoute),
// made once here over the runtime, so a template's command does not copy them again (cmd/bookings, cmd/orders and cmd/fees each hold a copy of the same 25 lines; folding them onto
// this is left for the cleanup stream). Added 23 Nov 2026 for Stock orders (stream SG).

// OwnerPush is `push.owner(text, "")`: the owner's words queued to the phones that allowed alerts; the ids queued, none when push is off.
func (r *Runtime) OwnerPush(text string) []string {
	p := r.Push()
	if p == nil || !p.On {
		return nil
	}
	ids, _ := p.Owner(text, "")
	return ids
}

// OwnerRoute is push.ts ownerRoute: how an owner's message goes. A shop with no WhatsApp pushes if a phone allowed alerts, else says nothing ("none"); a shop with WhatsApp and no
// phone with alerts on uses WhatsApp alone; otherwise the owner's own choice ("whatsapp", "push" or "both").
func (r *Runtime) OwnerRoute(hasWhatsApp bool) string {
	phones := 0
	if p := r.Push(); p != nil && p.On {
		phones = p.OwnerPhones()
	}
	switch {
	case !hasWhatsApp && phones > 0:
		return "push"
	case !hasWhatsApp:
		return "none"
	case phones == 0:
		return "whatsapp"
	}
	return r.Push().Choice()
}
