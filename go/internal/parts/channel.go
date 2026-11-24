package parts

// The shop's channel reads over its parts (runtime.ChannelKit), each from the last saved state:
//   - the OWNER'S PAGE is one page: every part's items waiting for the owner, its coming list, the credit book's rows, a Fees part's parents and cash, in the shop's order, with
//     the one assistant's view (the first part's, with Stock orders' order cards left out as its own page leaves them: they are items already) and the Money section summed over
//     the parts (each part's money is worked out from its own record lines, so the sum is the shop's: every amount and count adds, lists join, the month is the first part's);
//   - the customer's side (the offer, a request's view, its documents, the chat's count) is the customer part's (kit.go customerPart: the pickup hold's page);
//   - a Fees part's parent and material pages are that part's;
//   - the accountant's files are each part's books over its own lines, every file name led by the part's name ("orders-journal.csv"): the document numbers in them are the
//     shop's one series (accounting numbers.go over the whole record), so no two parts' documents share a number.
// Each part reads only its own record lines (and, for the carried part, the lines from before), as its own view of the record does in a step.

import (
	"encoding/json"

	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
)

type channelKit struct{ k *Kit }

var (
	_ runtime.ChannelKit      = (*channelKit)(nil)
	_ runtime.AccountantFiler = (*channelKit)(nil)
	_ runtime.ParentReader    = (*channelKit)(nil)
	_ runtime.MaterialReader  = (*channelKit)(nil)
)

// Channel is the shop's channel reads.
func (k *Kit) Channel() runtime.ChannelKit { return &channelKit{k} }

// entriesOf is part i's own record lines: refs.part is its name, or (the carried part) the line has no part.
func (c *channelKit) entriesOf(i int, entries []store.Entry) []store.Entry {
	name, carried := c.k.parts[i].Name, c.k.parts[i].Name == c.k.carried
	var out []store.Entry
	for _, e := range entries {
		p, has := e.Refs[runtime.PartRef]
		if (has && p == name) || (!has && carried) {
			out = append(out, e)
		}
	}
	return out
}

func (c *channelKit) parts(s runtime.KitState) []runtime.KitState { return c.k.stateOf(s).parts }

// Offer is the customer part's offer.
func (c *channelKit) Offer(s runtime.KitState, q runtime.OfferQuery) (any, error) {
	i := c.k.customerPart()
	if i < 0 {
		i = 0
	}
	return c.k.parts[i].Kit.Channel().Offer(c.parts(s)[i], q)
}

// View is the request with this handle, in whichever part has it.
func (c *channelKit) View(s runtime.KitState, hash string) any {
	for i, p := range c.k.parts {
		if v := p.Kit.Channel().View(c.parts(s)[i], hash); v != nil {
			return v
		}
	}
	return nil
}

// Documents are the documents of a request, from the part that has them.
func (c *channelKit) Documents(s runtime.KitState, entries []store.Entry, hash, lang string) ([]any, bool) {
	for i, p := range c.k.parts {
		if docs, ok := p.Kit.Channel().Documents(c.parts(s)[i], c.entriesOf(i, entries), hash, lang); ok {
			return docs, true
		}
	}
	return nil, false
}

// ChatWork is the customer part's.
func (c *channelKit) ChatWork(s runtime.KitState, conversation string) int {
	i := c.k.customerPart()
	if i < 0 {
		return 0
	}
	return c.k.parts[i].Kit.Channel().ChatWork(c.parts(s)[i], conversation)
}

// Parent and Material are a Fees part's.
func (c *channelKit) Parent(s runtime.KitState, linkHash string) any {
	for i, p := range c.k.parts {
		if pr, ok := p.Kit.Channel().(runtime.ParentReader); ok {
			if v := pr.Parent(c.parts(s)[i], linkHash); v != nil {
				return v
			}
		}
	}
	return nil
}

func (c *channelKit) Material(s runtime.KitState, linkHash, batch, file string) any {
	for i, p := range c.k.parts {
		if mr, ok := p.Kit.Channel().(runtime.MaterialReader); ok {
			if v := mr.Material(c.parts(s)[i], linkHash, batch, file); v != nil {
				return v
			}
		}
	}
	return nil
}

// AccountantFiles are each part's files for the period, each name led by the part's name; a period a part's books refuse is said as that part's refusal.
func (c *channelKit) AccountantFiles(s runtime.KitState, entries []store.Entry, period string) (any, error) {
	out := []any{}
	for i, p := range c.k.parts {
		af, ok := p.Kit.Channel().(runtime.AccountantFiler)
		if !ok {
			continue
		}
		files, err := af.AccountantFiles(c.parts(s)[i], c.entriesOf(i, entries), period)
		if err != nil {
			return nil, err
		}
		var list []map[string]any
		raw, _ := json.Marshal(files)
		if json.Unmarshal(raw, &list) != nil {
			continue
		}
		for _, f := range list {
			if n, ok := f["name"].(string); ok {
				f["name"] = p.Name + "-" + n
			}
			out = append(out, f)
		}
	}
	return out, nil
}

// Owner is the one owner's page over every part (the file's header says how it is joined).
func (c *channelKit) Owner(s runtime.KitState, sn *runtime.Snap, entries []store.Entry) any {
	var views []map[string]any
	for i, p := range c.k.parts {
		v := p.Kit.Channel().Owner(c.parts(s)[i], sn, c.entriesOf(i, entries))
		raw, _ := json.Marshal(v)
		var m map[string]any
		if json.Unmarshal(raw, &m) == nil && m != nil {
			views = append(views, m)
		}
	}
	return joinOwnerViews(views, c.k.Parts())
}

// joinOwnerViews joins the parts' owner views into one (names: the parts', in the same order). Exported to the test through the package.
func joinOwnerViews(views []map[string]any, names []string) map[string]any {
	if len(views) == 0 {
		return map[string]any{}
	}
	out := map[string]any{"shop": views[0]["shop"], "parts": names}
	// the page's headings follow the customer part's kind (the first Orders or Fees part in the shop's order), else the first part's
	if k := kindOfViews(views); k != nil {
		out["kind"] = k
	}
	for _, key := range []string{"services", "items", "upcoming", "parents", "cash", "credit"} {
		var list []any
		have := false
		for _, v := range views {
			if l, ok := v[key].([]any); ok {
				list, have = append(list, l...), true
			}
		}
		if have {
			if list == nil {
				list = []any{}
			}
			out[key] = list
		}
	}
	for _, v := range views {
		if cl, ok := v["classes"]; ok {
			out["classes"] = cl
			break
		}
	}
	// the one assistant's view: the first part's (its cards, talk and notes are drawn from the one shared state), with Stock orders' order cards left out (its own page shows
	// them as items), and today's rows and what waits joined over every part's (each part's app view lists only its own skill's: a waiver in the credit book waits on the
	// page whichever part is first)
	var today, waiting []any
	for _, v := range views {
		if app, ok := v["app"].(map[string]any); ok {
			if l, ok := app["today"].([]any); ok {
				today = append(today, l...)
			}
			if l, ok := app["waiting"].([]any); ok {
				waiting = append(waiting, l...)
			}
		}
	}
	for _, v := range views {
		if app, ok := v["app"].(map[string]any); ok {
			if today != nil {
				app["today"] = today
			}
			if waiting != nil {
				app["waiting"] = waiting
			}
			if cards, ok := app["cards"].([]any); ok {
				kept := []any{}
				for _, x := range cards {
					if cm, ok := x.(map[string]any); ok && cm["skill"] == "stock-orders" && cm["kind"] == "order" {
						continue
					}
					kept = append(kept, x)
				}
				app["cards"] = kept
			}
			out["app"] = app
			break
		}
	}
	var money any
	for _, v := range views {
		if m, ok := v["money"]; ok && m != nil {
			money = sumJSON(money, m)
		}
	}
	if money != nil {
		out["money"] = money
	}
	return out
}

// kindOfViews is the kind the joined page is headed by: the first view's that is an Orders shop's or a Fees centre's (the customer part's, in the shop's order), else the
// first view's.
func kindOfViews(views []map[string]any) any {
	for _, v := range views {
		if v["kind"] == "orders" || v["kind"] == "fees" {
			return v["kind"]
		}
	}
	return views[0]["kind"]
}

// sumJSON adds two money views member by member: numbers add, lists join, objects add member by member, true wins over false, and anything else (the month's text, a null) is
// the first one that has a value.
func sumJSON(a, b any) any {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	switch x := a.(type) {
	case float64:
		if y, ok := b.(float64); ok {
			return x + y
		}
	case bool:
		if y, ok := b.(bool); ok {
			return x || y
		}
	case []any:
		if y, ok := b.([]any); ok {
			return append(append([]any{}, x...), y...)
		}
	case map[string]any:
		if y, ok := b.(map[string]any); ok {
			out := map[string]any{}
			for k, v := range x {
				out[k] = v
			}
			for k, v := range y {
				out[k] = sumJSON(out[k], v)
			}
			return out
		}
	}
	return a
}
