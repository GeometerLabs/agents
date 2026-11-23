// The shop's own booking list is made by the first insert only (own-calendar.ts since 22 Nov): a read, an update or a delete before anything was booked does not write
// `ownCalendar` into the saved state. The TypeScript twin is in templates/commerce/bookings/test/own-calendar.test.ts.
package bookings

import (
	"context"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/calendar"
)

func TestOwnListIsMadeByTheFirstInsertOnly(t *testing.T) {
	ctx := context.Background()
	s := NewStore()
	c := ownCal{st: s, now: func() int64 { return 0 }}
	if l, err := c.List(ctx, calendar.Query{}); err != nil || len(l) != 0 {
		t.Fatalf("list %v %v", l, err)
	}
	if e, err := c.Get(ctx, "own_1"); err != nil || e != nil {
		t.Fatalf("get %v %v", e, err)
	}
	_, _ = c.FreeBusy(ctx, 0, 1)
	_, _ = c.Conflicts(ctx, 0, 1)
	_ = c.Delete(ctx, "own_1")
	st := "confirmed"
	if _, err := c.Update(ctx, "own_1", calendar.Patch{Status: &st}); err == nil {
		t.Fatal("an update of an event that is not there succeeded")
	}
	if s.own != nil || s.OwnCalendar != nil {
		t.Fatal("a read made the own list")
	}
	e, err := c.Insert(ctx, calendar.NewEvent{Summary: "x", Start: 10, End: 20, Status: "tentative"})
	if err != nil || e.ID != "own_1" || s.own == nil {
		t.Fatalf("insert %v %v (own made: %v)", e, err, s.own != nil)
	}
}
