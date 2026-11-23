package stockorders

// The validated settings as the JSON value `validateSettings` returns (templates/commerce/stock-orders/src/settings.ts): what the monthly report's POLICY DIGEST is of, and what the report
// reads (internal/stockordersreport). The digest is of the settings AS VALIDATED (defaults filled, names trimmed, the assistant block in its checked form), so a shop that moves between
// the two runtimes keeps the same digest, and a go-live certificate made on one is read as "own" on the other. Absent optional members are left out exactly where the TypeScript leaves
// them out with a spread (`address`, `reorderQty`, `assistant`).

import (
	"encoding/json"
	"strings"
)

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

// assistantTree is readAssistantSettings (modules/assistant/settings.ts) for a block that is valid: `morningAt` (the default 08:00, null when the morning line is off), the character
// (style "clay" and personality "warm" unless given, the name trimmed, the colour lower-cased without its "#") and `talk` only when it is off. This package does not yet CHECK the block
// (Deferred.md), so a block the TypeScript would refuse gives some tree here and no error; the shared runtime reads the part the agent uses (runtime.Settings.ReadAssistant).
func assistantTree(raw json.RawMessage) map[string]any {
	var b map[string]any
	_ = json.Unmarshal(raw, &b)
	var morning any = map[string]any{"hour": float64(8), "minute": float64(0)} // DEFAULT_MORNING
	switch m := b["morning"].(type) {
	case bool:
		if !m {
			morning = nil
		}
	case map[string]any:
		if at, ok := m["at"].(string); ok && len(at) == 5 && at[2] == ':' {
			h, mi := int(at[0]-'0')*10+int(at[1]-'0'), int(at[3]-'0')*10+int(at[4]-'0')
			morning = map[string]any{"hour": float64(h), "minute": float64(mi)}
		}
	}
	c, _ := b["character"].(map[string]any)
	char := map[string]any{"style": "clay", "personality": "warm"}
	if name, ok := c["name"].(string); ok && strings.TrimSpace(name) != "" {
		char["name"] = strings.TrimSpace(name)
	}
	if v, ok := c["style"].(string); ok {
		char["style"] = v
	}
	if v, ok := c["seed"].(string); ok {
		char["seed"] = v
	}
	if v, ok := c["colour"].(string); ok {
		char["colour"] = strings.ToLower(strings.TrimPrefix(v, "#"))
	}
	if v, ok := c["paint"].(string); ok {
		char["paint"] = v
	}
	if v, ok := c["personality"].(string); ok {
		char["personality"] = v
	}
	out := map[string]any{"morningAt": morning, "character": char}
	if t, ok := b["talk"].(map[string]any); ok {
		if customers, ok := t["customers"].(bool); ok && !customers {
			out["talk"] = map[string]any{"customers": false}
		}
	}
	return out
}
