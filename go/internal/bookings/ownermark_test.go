// Proves the UPI owner's buttons (ownermark.go) equal the TypeScript's ownerMarkButtons in every language on testdata/ownermark-buttons-vectors.json (made by running the TypeScript:
// go/scripts/gen_ownermarked_vectors.ts), and that the ledger rides in the store's `upi` member without losing a member.
package bookings

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
)

func TestOwnerMarkButtons(t *testing.T) {
	b, err := os.ReadFile("testdata/ownermark-buttons-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Cases []struct {
			Language    string   `json:"language"`
			Kind        string   `json:"kind"`
			Code        string   `json:"code"`
			AmountInr   float64  `json:"amountInr"`
			KeepAllowed bool     `json:"keepAllowed"`
			Out         []Choice `json:"out"`
		} `json:"cases"`
		IDs []struct{ Kind, Code, Out string } `json:"ids"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Cases) != 4*7 {
		t.Fatalf("%d cases", len(v.Cases))
	}
	for _, c := range v.Cases {
		got := OwnerMarkButtons(c.Language, OwnerMarkAsk{Kind: c.Kind, Code: c.Code, AmountInr: c.AmountInr, KeepAllowed: c.KeepAllowed})
		if !reflect.DeepEqual(got, c.Out) {
			t.Errorf("%s %s amount %v keep %v:\n got %+v\nwant %+v", c.Language, c.Kind, c.AmountInr, c.KeepAllowed, got, c.Out)
		}
	}
	for _, i := range v.IDs {
		if got := ownermarked.MarkButtonID(i.Kind, i.Code); got != i.Out {
			t.Errorf("id %s: %s want %s", i.Kind, got, i.Out)
		}
	}
}

func TestUpiLedgerRidesInTheStore(t *testing.T) {
	st := NewStore()
	l, err := st.UpiState()
	if err != nil || len(l.Requests) != 0 {
		t.Fatalf("a fresh store has an empty ledger: %v %v", l, err)
	}
	n := 0
	codes := func() string { n++; return []string{"ABCDEF", "GHJKMN"}[(n-1)/6%2] }
	link, _ := (&Settings{Payment: Payment{Module: "upi", UpiID: "glow@okicici", Payee: "Glow Salon"}}).UpiPayLink()(20000, "b-1")
	if link == "" {
		t.Fatal("a UPI shop has a pay link")
	}
	req, err := ownermarked.OpenRequest(l, (&Settings{Payment: Payment{Module: "upi", UpiID: "glow@okicici", Payee: "Glow Salon"}}).UpiPayLink(), ownermarked.NewRequest{AmountPaise: 20000, Reference: "b-1", Description: "Deposit"}, 1000, codes)
	if err != nil || req.ID != "upi-1" {
		t.Fatalf("%v %v", req, err)
	}
	if err := st.SetUpiState(l); err != nil {
		t.Fatal(err)
	}
	back, err := st.UpiState()
	if err != nil || len(back.Requests) != 1 || back.Requests[0].Link != link || (&Settings{}).UpiPayLink() != nil {
		t.Errorf("back %+v err %v", back, err)
	}
}
