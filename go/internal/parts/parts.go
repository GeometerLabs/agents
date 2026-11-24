// Package parts is ONE shop of several template parts behind one WhatsApp number, one record, one stock count, one owner's sign-in and one assistant (decision 65, owner
// 24 Nov 2026: "one shop can run several template parts, thats what the higher tier price slab is for"). The parts are the templates' own Kits (internal/fees for the credit
// book, internal/stockorders, internal/orders for the pickup hold), each unchanged: this package is a runtime.Kit made of them, and the router that hands each message to the
// part it belongs to. The design note, and why one program and not a process per part, is bundle/Explanation.md "Several template parts in one shop".
//
// The settings (settings.json): the keys every template reads (name, timezone, owner, assistant, languages, terms ...) at the top, and each part's own keys in `parts.<template>`,
// in the shop's order (the first part says the shop's shared beat work and hosts the owner's words no part takes). Each part's settings are checked by its own template on the
// top keys plus its block, so they mean what they mean in a single-part shop. `carried` names the template the shop was before it took a second part: its saved state and its
// record lines from then are that part's.
//
// The saved state: one top-level member `parts` with each part's members by template (and those of a part since removed, kept as they were), `router` (the question waiting for
// an answer and the last messages' parts), and the shared `assistant` and `ai`. A state with members outside `parts` is the carried part's from before.
package parts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/fees"
	"github.com/GeometerLabs/agents/go/internal/orders"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stockorders"
)

// Pathway and Version are what a parts shop's pathway.lock names (templates/commerce/parts/package.json; parts_test.go holds them together).
const (
	Pathway = "parts"
	Version = "0.1.0"
)

// templates are the templates a shop may run as parts, by the name a part goes by in the settings. Bookings is not one yet (its calendar Guard and booking page: Deferred.md).
var templates = map[string]func() runtime.WiredKit{
	"fees":         func() runtime.WiredKit { return &fees.Kit{} },
	"orders":       func() runtime.WiredKit { return &orders.Kit{} },
	"stock-orders": func() runtime.WiredKit { return &stockorders.Kit{} },
}

// Part is one part of the shop: its template, its Kit, its own settings and the shop's shared settings as that part reads them.
type Part struct {
	Name   string
	Kit    runtime.WiredKit
	Own    any
	Shared *runtime.Settings
}

// Settings is a parts shop's own settings (runtime.Settings.Own).
type Settings struct {
	Parts   []*Part
	Carried string
}

// Kit is the shop's runtime.Kit: its parts' Kits.
type Kit struct {
	parts   []*Part
	carried string
}

var (
	_ runtime.Kit        = (*Kit)(nil)
	_ runtime.PartsKit   = (*Kit)(nil)
	_ runtime.WiredKit   = (*Kit)(nil)
	_ runtime.PreChecker = (*Kit)(nil)
	_ runtime.StockKit   = (*Kit)(nil)
)

func (k *Kit) Pathway() string   { return Pathway }
func (k *Kit) Version() string   { return Version }
func (k *Kit) CasesName() string { return "cases" }

// Parts is the parts' names in the shop's order.
func (k *Kit) Parts() []string {
	out := make([]string, len(k.parts))
	for i, p := range k.parts {
		out[i] = p.Name
	}
	return out
}

// sharedKeys are the members of settings.json that are not a part's: everything at the top but `parts` and `carried`.
func sharedKeys(raw []byte) []runtime.Member {
	var out []runtime.Member
	if ms, ok := topMembers(raw); ok {
		for _, m := range ms {
			if m.Name != "parts" && m.Name != "carried" {
				out = append(out, m)
			}
		}
	}
	return out
}

// ReadSettings checks the parts and each part's settings by its own template; every problem is said, each with the part it is in.
func (k *Kit) ReadSettings(in map[string]any, raw []byte, shared *runtime.Settings) (any, []string) {
	var errs []string
	top := sharedKeys(raw)
	var blocks []runtime.Member
	if ms, ok := topMembers(raw); ok {
		for _, m := range ms {
			if m.Name == "parts" {
				if b, ok := topMembers(m.Raw); ok {
					blocks = b
				}
			}
		}
	}
	if _, ok := in["parts"].(map[string]any); !ok || len(blocks) == 0 {
		return nil, []string{`"parts" names the shop's parts, each with its own settings: {"fees": {...}, "stock-orders": {...}, "orders": {...}}.`}
	}
	carried, hasCarried := in["carried"].(string)
	if _, there := in["carried"]; there && !hasCarried {
		errs = append(errs, `"carried" is the name of the part the shop was before it had parts (a string), or left out.`)
	}
	seen := map[string]bool{}
	var parts []*Part
	for _, b := range blocks {
		make_, known := templates[b.Name]
		switch {
		case !known:
			errs = append(errs, fmt.Sprintf(`parts: %q is not a template a shop can run as a part (%s).`, b.Name, strings.Join(names(), ", ")))
			continue
		case seen[b.Name]:
			errs = append(errs, fmt.Sprintf(`parts: %q is named twice.`, b.Name))
			continue
		}
		seen[b.Name] = true
		own, ok := topMembers(b.Raw)
		if !ok {
			errs = append(errs, fmt.Sprintf(`parts.%s is the part's own settings, an object.`, b.Name))
			continue
		}
		merged, mergedRaw, clash := merge(top, own)
		if clash != "" {
			errs = append(errs, fmt.Sprintf(`parts.%s: %q is the shop's, set once at the top of the settings.`, b.Name, strings.TrimSpace(clash)))
			continue
		}
		kit := make_()
		sh := &runtime.Settings{Raw: merged}
		o, perrs := kit.ReadSettings(merged, mergedRaw, sh)
		for _, e := range perrs {
			errs = append(errs, "parts."+b.Name+": "+e)
		}
		if len(perrs) == 0 {
			sh.Own = o
			parts = append(parts, &Part{Name: b.Name, Kit: kit, Own: o, Shared: sh})
		}
	}
	if hasCarried && !seen[carried] {
		errs = append(errs, fmt.Sprintf(`"carried" names %q, which is not one of the shop's parts.`, carried))
	}
	if len(errs) > 0 {
		return nil, errs
	}
	// the shop's shared settings are the first part's reading of the top keys (every part read the same keys)
	first := parts[0].Shared
	raw0 := shared.Raw
	*shared = *first
	shared.Raw, shared.Own = raw0, nil
	k.parts, k.carried = parts, carried
	own := &Settings{Parts: parts, Carried: carried}
	shared.Own = own
	return own, nil
}

func names() []string {
	var out []string
	for n := range templates {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// merge is the top keys followed by the part's own, as one object (its map and its bytes, in that order, so a template that says its problems in the file's order says them in
// this one). A key the part's block shares with the top is a clash, except an object at both (the owner: {"whatsapp", "language"} at the top, {"approveOverInr"} in an Orders
// part): then the part's members are added after the top's, and only a member in both is a clash ("owner.whatsapp"), since the part may not change what the shop sets once.
func merge(top, own []runtime.Member) (map[string]any, []byte, string) {
	at := map[string]int{}
	for i, m := range top {
		at[m.Name] = i
	}
	all := append([]runtime.Member{}, top...)
	for _, m := range own {
		i, both := at[m.Name]
		if !both {
			all = append(all, m)
			continue
		}
		joined, clash := joinObjects(top[i].Raw, m.Raw)
		if clash != "" {
			return nil, nil, m.Name + clash
		}
		all[i] = runtime.Member{Name: m.Name, Raw: joined}
	}
	var b bytes.Buffer
	b.WriteByte('{')
	for i, m := range all {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(m.Name)
		b.Write(k)
		b.WriteByte(':')
		b.Write(m.Raw)
	}
	b.WriteByte('}')
	var out map[string]any
	if err := json.Unmarshal(b.Bytes(), &out); err != nil {
		return nil, nil, ""
	}
	return out, b.Bytes(), ""
}

// joinObjects is two objects' members, the first's then the second's; a member in both, or either not an object, is the clash ("" for the whole key, ".x" for a member).
func joinObjects(a, b json.RawMessage) (json.RawMessage, string) {
	am, ok1 := topMembers(a)
	bm, ok2 := topMembers(b)
	if !ok1 || !ok2 {
		return nil, " "
	}
	seen := map[string]bool{}
	for _, m := range am {
		seen[m.Name] = true
	}
	for _, m := range bm {
		if seen[m.Name] {
			return nil, "." + m.Name
		}
	}
	var out bytes.Buffer
	out.WriteByte('{')
	for i, m := range append(am, bm...) {
		if i > 0 {
			out.WriteByte(',')
		}
		k, _ := json.Marshal(m.Name)
		out.Write(k)
		out.WriteByte(':')
		out.Write(m.Raw)
	}
	out.WriteByte('}')
	return out.Bytes(), ""
}

// topMembers is a JSON object's members in the order they were written.
func topMembers(raw []byte) ([]runtime.Member, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, false
	}
	var out []runtime.Member
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			return nil, false
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, false
		}
		out = append(out, runtime.Member{Name: kt.(string), Raw: v})
	}
	return out, true
}

// ---- the saved state --------------------------------------------------------------------------------------------------------------------------------------------------------

// State is the shop's saved state: each part's own, in the shop's order, what a removed part left, and the router's.
type State struct {
	names   []string
	parts   []runtime.KitState
	removed []runtime.Member // a part no longer in the settings: its members, kept as they were (the record keeps its history; nothing of it is thrown away)
	router  *routerState
}

// ParseState reads the `parts` and `router` members; members outside them are the carried part's (a shop that had one template before).
func (k *Kit) ParseState(ms []runtime.Member) (runtime.KitState, error) {
	st := &State{router: &routerState{}}
	byPart := map[string][]runtime.Member{}
	var legacy []runtime.Member
	sawParts := false
	for _, m := range ms {
		switch m.Name {
		case "parts":
			sawParts = true
			list, ok := topMembers(m.Raw)
			if !ok {
				return nil, fmt.Errorf("the saved parts are not an object")
			}
			for _, p := range list {
				own, ok := topMembers(p.Raw)
				if !ok {
					return nil, fmt.Errorf("the saved state of the %s part is not an object", p.Name)
				}
				byPart[p.Name] = own
				if !k.has(p.Name) {
					st.removed = append(st.removed, p)
				}
			}
		case "router":
			if err := json.Unmarshal(m.Raw, st.router); err != nil {
				return nil, fmt.Errorf("the router's saved state cannot be read: %w", err)
			}
		default:
			legacy = append(legacy, m)
		}
	}
	if len(legacy) > 0 {
		if sawParts || k.carried == "" {
			return nil, fmt.Errorf("the saved state has a single template's members (%s) but the settings name no part they belong to (\"carried\")", legacy[0].Name)
		}
		byPart[k.carried] = legacy
	}
	for _, p := range k.parts {
		s, err := p.Kit.ParseState(byPart[p.Name])
		if err != nil {
			return nil, fmt.Errorf("the %s part: %w", p.Name, err)
		}
		st.parts = append(st.parts, s)
		st.names = append(st.names, p.Name)
	}
	return st, nil
}

func (k *Kit) has(name string) bool {
	for _, p := range k.parts {
		if p.Name == name {
			return true
		}
	}
	return false
}

// Members writes `parts` (each part's members, without the shared placeholders), `router`, then the shared assistant and AI counts where the runtime puts them.
func (s *State) Members() ([]runtime.Member, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	n := 0
	put := func(name string, raw []byte) {
		if n > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(name)
		b.Write(k)
		b.WriteByte(':')
		b.Write(raw)
		n++
	}
	for i, p := range s.parts {
		ms, err := p.Members()
		if err != nil {
			return nil, err
		}
		var o bytes.Buffer
		o.WriteByte('{')
		c := 0
		for _, m := range ms {
			if m.Name == "ai" || m.Name == "assistant" || m.Raw == nil {
				continue
			}
			if c > 0 {
				o.WriteByte(',')
			}
			k, _ := json.Marshal(m.Name)
			o.Write(k)
			o.WriteByte(':')
			o.Write(m.Raw)
			c++
		}
		o.WriteByte('}')
		put(s.names[i], o.Bytes())
	}
	for _, m := range s.removed {
		put(m.Name, m.Raw)
	}
	b.WriteByte('}')
	router, err := json.Marshal(s.router)
	if err != nil {
		return nil, err
	}
	return []runtime.Member{{Name: "parts", Raw: b.Bytes()}, {Name: "router", Raw: router}, {Name: "assistant"}, {Name: "ai"}}, nil
}
