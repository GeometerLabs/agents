package parts

// Unit tests of the shop of several parts that need no running shop: the pin, the settings (the starter example, a clash, an unknown part), the router's rule, the question's
// words against the TypeScript's own output, the answer, the joined owner's page and money, and the saved state's round trip (with a carried single-template state and a
// removed part's state kept). The shop itself, over HTTP, is templates/commerce/parts/contract/.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/fees"
	"github.com/GeometerLabs/agents/go/internal/orders"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stockorders"
)

const example = "../../../templates/commerce/parts/settings/ganesh-electricals-starter.example.json"

func TestVersionIsThePackages(t *testing.T) {
	raw, err := os.ReadFile("../../../templates/commerce/parts/package.json")
	if err != nil {
		t.Fatal(err)
	}
	var p struct{ Version string }
	_ = json.Unmarshal(raw, &p)
	if p.Version != Version {
		t.Fatalf("templates/commerce/parts/package.json is %s, the Go program serves %s", p.Version, Version)
	}
}

func readSettings(t *testing.T, raw []byte) (*Kit, *runtime.Settings, []string) {
	t.Helper()
	var in map[string]any
	if err := json.Unmarshal(raw, &in); err != nil {
		t.Fatal(err)
	}
	k := &Kit{}
	sh := &runtime.Settings{Raw: in}
	_, errs := k.ReadSettings(in, raw, sh)
	return k, sh, errs
}

func TestTheStarterExampleIsThreeParts(t *testing.T) {
	raw, err := os.ReadFile(filepath.Clean(example))
	if err != nil {
		t.Fatal(err)
	}
	k, sh, errs := readSettings(t, raw)
	if len(errs) > 0 {
		t.Fatalf("the starter example is refused: %v", errs)
	}
	if got := k.Parts(); !reflect.DeepEqual(got, []string{"fees", "stock-orders", "orders"}) {
		t.Fatalf("parts %v", got)
	}
	if sh.Name != "Ganesh Electricals" || sh.Owner.Whatsapp != "+919800000001" || !sh.HasAssistant {
		t.Fatalf("the shared settings are not the top's: %+v", sh)
	}
	for _, p := range k.parts {
		if p.Shared.Name != sh.Name || p.Shared.Owner.Whatsapp != sh.Owner.Whatsapp {
			t.Fatalf("the %s part reads another shop: %+v", p.Name, p.Shared)
		}
	}
	if kindOf(k.parts[0]) != "credit" || kindOf(k.parts[2]) != "hold" {
		t.Fatalf("kinds %s %s", kindOf(k.parts[0]), kindOf(k.parts[2]))
	}
	// every limit sits in its part's block
	wireOwn(k)
	if len(k.Limits()) == 0 {
		t.Fatal("no limits declared")
	}
	for _, l := range k.Limits() {
		if !strings.HasPrefix(l.Path, "parts.") {
			t.Fatalf("limit %s at %s", l.ID, l.Path)
		}
	}
}

// wireOwn gives each part's Kit its own settings, as Wire does when the program starts (a Kit declares its limits from them).
func wireOwn(k *Kit) {
	for _, p := range k.parts {
		switch x := p.Kit.(type) {
		case *fees.Kit:
			x.Settings = p.Own.(*fees.Settings)
		case *orders.Kit:
			x.Settings = p.Own.(*orders.Settings)
		case *stockorders.Kit:
			x.Settings = p.Own.(*stockorders.Settings)
		}
	}
}

func TestSettingsRefused(t *testing.T) {
	cases := map[string]string{
		`{"name":"A","timezone":"Asia/Kolkata","languages":["en"],"owner":{"whatsapp":"+919800000001","language":"en"},"parts":{"bookings":{}}}`:                           `"bookings" is not a template`,
		`{"name":"A","timezone":"Asia/Kolkata","languages":["en"],"owner":{"whatsapp":"+919800000001","language":"en"},"parts":{"orders":{"owner":{"whatsapp":"+9198"}}}}`: `"owner.whatsapp" is the shop's`,
		`{"name":"A","timezone":"Asia/Kolkata","languages":["en"],"owner":{"whatsapp":"+919800000001","language":"en"},"parts":{"orders":{"name":"B"}}}`:                   `"name" is the shop's`,
		`{"name":"A","parts":{}}`: `"parts" names the shop's parts`,
		`{"name":"A","timezone":"Asia/Kolkata","languages":["en"],"owner":{"whatsapp":"+919800000001","language":"en"},"carried":"fees","parts":{"stock-orders":{}}}`: `"carried" names "fees"`,
	}
	for raw, want := range cases {
		_, _, errs := readSettings(t, []byte(raw))
		if !strings.Contains(strings.Join(errs, "\n"), want) {
			t.Errorf("%s: want %q in %v", raw, want, errs)
		}
	}
}

func TestDecide(t *testing.T) {
	N, W, O, C, New := runtime.ClaimNone, runtime.ClaimWords, runtime.ClaimOpen, runtime.ClaimCommand, runtime.ClaimNew
	for _, c := range []struct {
		claims []runtime.Claim
		part   int
		ask    []int
	}{
		{[]runtime.Claim{N, N, N}, 0, nil},          // nobody: the first part (its assistant hosts every skill)
		{[]runtime.Claim{N, W, N}, 1, nil},          // one part's words
		{[]runtime.Claim{W, C, N}, 1, nil},          // a command beats words
		{[]runtime.Claim{W, W, N}, -1, []int{0, 1}}, // two parts' words: ask
		{[]runtime.Claim{O, N, O}, -1, []int{0, 2}}, // two open with the customer: ask
		{[]runtime.Claim{N, N, New}, 2, nil},        // a new customer: the part that takes them
		{[]runtime.Claim{W, N, New}, 0, nil},        // known to one part beats new to another
	} {
		d := decide(c.claims, 0)
		if d.part != c.part || !reflect.DeepEqual(d.ask, c.ask) {
			t.Errorf("%v: got part %d ask %v, want %d %v", c.claims, d.part, d.ask, c.part, c.ask)
		}
	}
}

func TestQuestionIsTheTypeScripts(t *testing.T) {
	w := loadWords()
	if len(w.Vectors) != 8 {
		t.Fatalf("%d vectors", len(w.Vectors))
	}
	for _, v := range w.Vectors {
		if got := question(v.Language, v.To, v.Names); got != v.Text {
			t.Errorf("%s %s: %q, the TypeScript says %q", v.Language, v.To, got, v.Text)
		}
	}
}

func TestAnswerIn(t *testing.T) {
	raw, _ := os.ReadFile(filepath.Clean(example))
	k, _, _ := readSettings(t, raw)
	two := []*Part{k.parts[0], k.parts[1]} // the credit book and Stock orders
	for text, want := range map[string]string{"credit book": "fees", "Supplier orders please": "stock-orders", "ಸಾಲದ ಲೆಕ್ಕ": "fees", "yes": "", "credit book and supplier orders": ""} {
		if got := answerIn(text, "", two); got != want {
			t.Errorf("%q: %q, want %q", text, got, want)
		}
	}
	if got := answerIn("", "part:stock-orders", two); got != "stock-orders" {
		t.Errorf("tap: %q", got)
	}
	if got := answerIn("", "part:orders", two); got != "" {
		t.Errorf("a tap on a part not asked about: %q", got)
	}
}

func TestJoinOwnerViews(t *testing.T) {
	var fees, stock, orders map[string]any
	_ = json.Unmarshal([]byte(`{"shop":{"name":"G"},"kind":"fees","services":[],"items":[{"case":"f-1"}],"upcoming":[],"credit":[{"ref":"c-1"}],"money":{"today":{"received":{"paise":100,"count":1}},"month":{"stillToCome":{"paise":2400,"count":1},"keptPaise":0},"byWord":[],"period":"2026-11","readsSettlements":false},"app":{"cards":[{"skill":"stock-orders","kind":"order"},{"skill":"fees","kind":"cancel"}]}}`), &fees)
	_ = json.Unmarshal([]byte(`{"shop":{"name":"G"},"kind":"stock","items":[{"case":"po-1"}]}`), &stock)
	_ = json.Unmarshal([]byte(`{"shop":{"name":"G"},"kind":"orders","services":[],"items":[{"case":"o-1"}],"upcoming":[{"case":"o-1"}],"money":{"today":{"received":{"paise":50,"count":2}},"month":{"stillToCome":null,"keptPaise":10},"byWord":[{"case":"o-1"}],"period":"2026-11","readsSettlements":true}}`), &orders)
	v := joinOwnerViews([]map[string]any{fees, stock, orders}, []string{"fees", "stock-orders", "orders"})
	items := v["items"].([]any)
	if len(items) != 3 || v["kind"] != "orders" || len(v["credit"].([]any)) != 1 || len(v["upcoming"].([]any)) != 1 {
		t.Fatalf("joined view: %v", v)
	}
	if cards := v["app"].(map[string]any)["cards"].([]any); len(cards) != 1 {
		t.Fatalf("Stock orders' order card is an item already: %v", cards)
	}
	m := v["money"].(map[string]any)
	today := m["today"].(map[string]any)["received"].(map[string]any)
	month := m["month"].(map[string]any)
	if today["paise"] != 150.0 || today["count"] != 3.0 || month["keptPaise"] != 10.0 || month["stillToCome"].(map[string]any)["paise"] != 2400.0 || m["period"] != "2026-11" || m["readsSettlements"] != true || len(m["byWord"].([]any)) != 1 {
		t.Fatalf("money: %v", m)
	}
}

func TestStateRoundTrip(t *testing.T) {
	raw, _ := os.ReadFile(filepath.Clean(example))
	k, _, errs := readSettings(t, raw)
	if len(errs) > 0 {
		t.Fatal(errs)
	}
	fresh, err := k.ParseState(nil)
	if err != nil {
		t.Fatal(err)
	}
	st := fresh.(*State)
	st.router.remember("m-1", "orders")
	ms, err := st.Members()
	if err != nil {
		t.Fatal(err)
	}
	if ms[0].Name != "parts" || ms[1].Name != "router" || ms[2].Name != "assistant" || ms[3].Name != "ai" {
		t.Fatalf("members %v", ms)
	}
	// a part removed since: its state is kept as it was
	withOld := append([]runtime.Member{}, ms[:2]...)
	parts, _ := topMembers(ms[0].Raw)
	parts = append(parts, runtime.Member{Name: "bookings", Raw: json.RawMessage(`{"bookings":[],"seq":7}`)})
	var b strings.Builder
	b.WriteString("{")
	for i, p := range parts {
		if i > 0 {
			b.WriteString(",")
		}
		n, _ := json.Marshal(p.Name)
		b.Write(n)
		b.WriteString(":")
		b.Write(p.Raw)
	}
	b.WriteString("}")
	withOld[0].Raw = json.RawMessage(b.String())
	back, err := k.ParseState(withOld)
	if err != nil {
		t.Fatal(err)
	}
	again, _ := back.(*State).Members()
	if string(again[0].Raw) != b.String() {
		t.Fatalf("not the same bytes:\n%s\n%s", again[0].Raw, b.String())
	}
	if p, ok := back.(*State).router.partOf("m-1"); !ok || p != "orders" {
		t.Fatal("the router's memory was lost")
	}
	// a single template's state without "carried" is refused; with it, it is that part's
	legacy := []runtime.Member{{Name: "orders", Raw: json.RawMessage(`[]`)}}
	if _, err := k.ParseState(legacy); err == nil {
		t.Fatal("a flat state with no carried part was read")
	}
}

func TestQuestionsWaitPerNumber(t *testing.T) {
	r := &routerState{}
	r.ask(&asked{ID: "a", From: "+919800000001"})
	r.ask(&asked{ID: "b", From: "+919811111111"})
	r.ask(&asked{ID: "c", From: "919800000001"}) // the same number written another way: replaces its older question
	if len(r.Asked) != 2 {
		t.Fatalf("%d questions wait", len(r.Asked))
	}
	if q := r.takeAsked("+919811111111"); q == nil || q.ID != "b" {
		t.Fatalf("the second number's question: %v", q)
	}
	if q := r.takeAsked("+919800000001"); q == nil || q.ID != "c" {
		t.Fatalf("the first number's newer question: %v", q)
	}
	if r.takeAsked("+919800000001") != nil {
		t.Fatal("a question is answered once")
	}
}

func TestEachPartReadsItsOwnLimits(t *testing.T) {
	raw, _ := os.ReadFile(filepath.Clean(example))
	k, _, _ := readSettings(t, raw)
	wireOwn(k)
	seen := map[string]bool{}
	for _, l := range k.Limits() {
		if seen[l.ID] {
			t.Fatalf("limit id %s twice", l.ID)
		}
		seen[l.ID] = true
		part := strings.SplitN(l.Path, ".", 3)[1]
		if !strings.HasPrefix(l.ID, runtime.LimitID(part, "")) {
			t.Fatalf("limit %s at %s is not its part's", l.ID, l.Path)
		}
	}
	if !seen[runtime.LimitID("fees", "refund_limit")] || !seen[runtime.LimitID("orders", "refund_limit")] {
		t.Fatalf("both parts' refund limits are declared, each its own: %v", seen)
	}
}
