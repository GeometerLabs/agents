package stockorders

// The validated settings as the JSON value `validateSettings` returns (templates/commerce/stock-orders/src/settings.ts): what the monthly report's POLICY DIGEST is of, and what the report
// reads (internal/stockordersreport). The digest is of the settings AS VALIDATED (defaults filled, names trimmed, the assistant block in its checked form), so a shop that moves between
// the two runtimes keeps the same digest, and a go-live certificate made on one is read as "own" on the other. Absent optional members are left out exactly where the TypeScript leaves
// them out with a spread (`address`, `reorderQty`, `assistant`).

func namesTree(n Names) map[string]any {
	out := make(map[string]any, len(n))
	for lang, list := range n {
		l := make([]any, len(list))
		for i, v := range list {
			l[i] = v
		}
		out[lang] = l
	}
	return out
}

func stringList(l []string) []any {
	out := make([]any, len(l))
	for i, v := range l {
		out[i] = v
	}
	return out
}

func namedTree(items []Item) []any {
	out := make([]any, len(items))
	for i, it := range items {
		out[i] = map[string]any{"id": it.ID, "names": namesTree(it.Names)}
	}
	return out
}

// Tree is the validated settings as the TypeScript's object, as JSON values (numbers as float64).
func (s *Settings) Tree() map[string]any {
	suppliers := make([]any, len(s.Suppliers))
	for i, x := range s.Suppliers {
		suppliers[i] = map[string]any{"id": x.ID, "name": x.Name, "aliases": stringList(x.Aliases), "whatsapp": x.WhatsApp, "language": x.Language, "approved": x.Approved}
	}
	catalogue := make([]any, len(s.Catalogue))
	for i, l := range s.Catalogue {
		line := map[string]any{"item": l.Item, "supplier": l.Supplier, "unit": l.Unit, "priceInr": l.PriceInr}
		if l.ReorderQty > 0 { // 0 is "not given": the TypeScript leaves the member out
			line["reorderQty"] = float64(l.ReorderQty)
		}
		catalogue[i] = line
	}
	hours := make([]any, len(s.FollowUpHours))
	for i, h := range s.FollowUpHours {
		hours[i] = float64(h)
	}
	t := map[string]any{
		"name": s.Name, "timezone": s.Timezone, "languages": stringList(s.Languages), "owner": map[string]any{"whatsapp": s.Owner.WhatsApp, "language": s.Owner.Language},
		"items": namedTree(s.Items), "units": namedTree(s.Units), "suppliers": suppliers, "catalogue": catalogue,
		"limits":        map[string]any{"maxPerOrderInr": s.Limits.MaxPerOrderInr, "monthlyBudgetInr": s.Limits.MonthlyBudgetInr, "maxQuantity": float64(s.Limits.MaxQuantity)},
		"followUpHours": hours,
	}
	if s.Address != "" {
		t["address"] = s.Address
	}
	if s.assistantTree != nil {
		t["assistant"] = s.assistantTree
	}
	return t
}
