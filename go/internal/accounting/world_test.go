// The shop records the TypeScript made (testdata/world-*.json, scripts/gen_books_vectors.ts), replayed and read here, and every answer compared with the TypeScript's: the steps through
// post() (each result, each thrown sentence, each line written), the settlement job's ticks, and then, over the record that came out, the journal (lines, documents, problems, identities, what
// is owed), the next document numbers, the summaries, the figures in every option combination, the faults, the owed-by-owner obligations and the owner's money view at several moments. The
// accountant's files are in files_test.go and the HTML in render/render_test.go. Every string is compared byte for byte.
package accounting

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

var worldNames = []string{"bookings", "composition", "settlements", "fees", "legacy", "malformed", "fyend"}

type stepVec struct {
	At    int64            `json:"at"`
	Op    string           `json:"op"`
	Event *json.RawMessage `json:"event"`
	Line  struct {
		Action       string            `json:"action"`
		Outcome      string            `json:"outcome"`
		Booking      *string           `json:"booking"`
		Conversation string            `json:"conversation"`
		Language     string            `json:"language"`
		Notes        string            `json:"notes"`
		Refs         map[string]string `json:"refs"`
		Mode         string            `json:"mode"`
	} `json:"line"`
	Result *struct {
		Posted bool   `json:"posted"`
		Doc    string `json:"doc"`
		Why    string `json:"why"`
		Error  string `json:"error"`
	} `json:"result"`
}

type jobVec struct {
	NowMs    int64                      `json:"nowMs"`
	Scripted map[string]json.RawMessage `json:"scripted"`
	Result   json.RawMessage            `json:"result"`
	Asked    []string                   `json:"asked"`
	Written  int                        `json:"written"`
}

type worldVec struct {
	Def struct {
		Name     string            `json:"name"`
		Timezone string            `json:"timezone"`
		Status   *string           `json:"status"`
		Legacy   LegacyMap         `json:"legacy"`
		Nows     []string          `json:"nows"`
		OldDue   map[string]string `json:"oldDue"`
	} `json:"def"`
	Steps    []stepVec                  `json:"steps"`
	Jobs     []jobVec                   `json:"jobs"`
	Entries  []Entry                    `json:"entries"`
	Journal  map[string]json.RawMessage `json:"journal"`
	Stepwise json.RawMessage            `json:"stepwise"`
	Next     []struct {
		Series string          `json:"series"`
		FY     string          `json:"fy"`
		Next   json.RawMessage `json:"next"`
	} `json:"next"`
	Summaries []struct {
		Name, From, To string
		Summary        json.RawMessage `json:"summary"`
	} `json:"summaries"`
	ReportAccounting []struct {
		From, To string
		Out      json.RawMessage `json:"out"`
	} `json:"reportAccounting"`
	Figures []struct {
		Name, From, To string
		Options        struct {
			RefundAmountFromPayment bool  `json:"refundAmountFromPayment"`
			OwnerMarks              *bool `json:"ownerMarks"`
		} `json:"options"`
		Out       json.RawMessage `json:"out"`
		BooksOnly json.RawMessage `json:"booksOnly"`
	} `json:"figures"`
	Faults []struct {
		Name               string          `json:"name"`
		Entries            []Entry         `json:"entries"`
		Books              json.RawMessage `json:"books"`
		BooksPrivate       json.RawMessage `json:"booksPrivate"`
		Figures            json.RawMessage `json:"figures"`
		FiguresFromPayment json.RawMessage `json:"figuresFromPayment"`
	} `json:"faults"`
	Obligations json.RawMessage `json:"obligations"`
	Views       []struct {
		NowMs  int64           `json:"nowMs"`
		Untold []UntoldInput   `json:"untold"`
		View   json.RawMessage `json:"view"`
		Key    string          `json:"key"`
	} `json:"views"`
}

func loadWorld(t *testing.T, name string) *worldVec {
	t.Helper()
	var w worldVec
	loadVec(t, "world-"+name, &w)
	return &w
}

// memRecord is a record in memory that appends the way the TypeScript's createRecord does (seq from the length, the time from the clock as toISOString writes it, the booking null when
// absent). The inputs digest is left empty: the vectors' digests are the TypeScript's own and not compared.
type memRecord struct {
	entries []Entry
	now     int64
}

func (m *memRecord) Now() int64       { return m.now }
func (m *memRecord) Entries() []Entry { return append([]Entry(nil), m.entries...) }
func (m *memRecord) Append(n NewEntry) Entry {
	refs := map[string]string{}
	for k, v := range n.Refs {
		refs[k] = v
	}
	e := Entry{Seq: len(m.entries) + 1, Time: time.UnixMilli(m.now).UTC().Format("2006-01-02T15:04:05.000Z"), Conversation: n.Conversation, Booking: n.Booking, Action: n.Action, Outcome: n.Outcome, Language: n.Language, Notes: n.Notes, Refs: refs}
	m.entries = append(m.entries, e)
	return e
}

// comparable drops what the vectors do not compare (the inputs digest and the rule decisions) so two entries can be compared with DeepEqual.
func comparable(es []Entry) []Entry {
	out := make([]Entry, len(es))
	for i, e := range es {
		e.InputsDigest, e.Decisions = "", nil
		if e.Refs == nil {
			e.Refs = map[string]string{}
		}
		out[i] = e
	}
	return out
}

func (w *worldVec) shop() Shop {
	s := Shop{Timezone: w.Def.Timezone}
	if w.Def.Status != nil {
		s.Status = TaxStatus(*w.Def.Status)
	}
	return s
}

// scriptedPayments is the fake provider of a job tick: the rows (or the error) scripted for each day, and the days it was asked for.
type scriptedPayments struct {
	days  map[string]json.RawMessage
	asked []string
}

func (p *scriptedPayments) ReadsSettlements() bool { return true }
func (p *scriptedPayments) ReadSettlements(day zone.Date) ([]SettlementRow, error) {
	key := dayKey(day)
	p.asked = append(p.asked, key)
	raw, ok := p.days[key]
	if !ok {
		return nil, fmt.Errorf("no rows scripted for %s", key)
	}
	var errBox struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &errBox) == nil && errBox.Error != "" {
		return nil, fmt.Errorf("%s", errBox.Error)
	}
	rows := []SettlementRow{}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func TestWorldsReplay(t *testing.T) {
	for _, name := range worldNames {
		t.Run(name, func(t *testing.T) {
			w := loadWorld(t, name)
			rec := &memRecord{}
			acc, err := CreateAccounting(rec, w.shop(), w.Def.Legacy, rec)
			if err != nil {
				t.Fatal(err)
			}
			for i, s := range w.Steps {
				rec.now = s.At
				write := func(refs map[string]string) error {
					all := map[string]string{}
					for k, v := range s.Line.Refs {
						all[k] = v
					}
					for k, v := range refs {
						all[k] = v
					}
					booking := s.Line.Booking
					n := NewEntry{Conversation: s.Line.Conversation, Booking: booking, Action: s.Line.Action, Outcome: s.Line.Outcome, Language: s.Line.Language, Notes: s.Line.Notes, Refs: all}
					switch {
					case s.Line.Mode == "none":
					case s.Line.Mode == "twice":
						rec.Append(n)
						rec.Append(n)
					case s.Line.Mode == "wrongCase":
						other := "other-case"
						n.Booking = &other
						rec.Append(n)
					default:
						if strings.HasPrefix(s.Line.Mode, "drop:") {
							for _, k := range strings.Split(s.Line.Mode[5:], ",") {
								delete(n.Refs, k)
							}
						}
						if strings.HasPrefix(s.Line.Mode, "alter:") {
							for _, k := range strings.Split(s.Line.Mode[6:], ",") {
								n.Refs[k] = "tampered"
							}
						}
						rec.Append(n)
					}
					return nil
				}
				if s.Op == "raw" {
					rec.Append(NewEntry{Conversation: s.Line.Conversation, Booking: s.Line.Booking, Action: s.Line.Action, Outcome: s.Line.Outcome, Language: s.Line.Language, Notes: s.Line.Notes, Refs: s.Line.Refs})
					continue
				}
				var ev MoneyEvent
				if err := json.Unmarshal(*s.Event, &ev); err != nil {
					t.Fatalf("step %d: %v", i, err)
				}
				got, err := acc.Post(ev, write)
				switch {
				case s.Result.Error != "":
					if err == nil || err.Error() != s.Result.Error {
						t.Errorf("step %d (%s %s): go error %v, ts error %q", i, ev.Kind, s.Line.Action, err, s.Result.Error)
					}
				case err != nil:
					t.Errorf("step %d (%s): go error %q, ts %+v", i, ev.Kind, err, *s.Result)
				default:
					if got.Posted != s.Result.Posted || got.Doc != s.Result.Doc || got.Why != s.Result.Why {
						t.Errorf("step %d (%s): go %+v, ts %+v", i, ev.Kind, got, *s.Result)
					}
				}
			}
			for k, job := range w.Jobs {
				rec.now = job.NowMs
				pay := &scriptedPayments{days: job.Scripted}
				got := ReadSettlementsOnce(SettlementsInput{Payments: pay, Accounting: acc, Record: rec, Conversation: "919800000001", Language: "en", NowMs: job.NowMs, TimeZone: w.Def.Timezone})
				sameJSON(t, fmt.Sprintf("job %d result", k), got, job.Result)
				if !reflect.DeepEqual(append([]string{}, pay.asked...), append([]string{}, job.Asked...)) {
					t.Errorf("job %d asked %v, ts %v", k, pay.asked, job.Asked)
				}
			}
			g, want := comparable(rec.entries), comparable(w.Entries)
			if len(g) != len(want) {
				t.Fatalf("%d entries, ts %d", len(g), len(want))
			}
			for i := range g {
				if !reflect.DeepEqual(g[i], want[i]) {
					t.Errorf("entry %d:\n go %+v\n ts %+v", i+1, g[i], want[i])
				}
			}
		})
	}
}

func TestWorldsRead(t *testing.T) {
	for _, name := range worldNames {
		t.Run(name, func(t *testing.T) {
			w := loadWorld(t, name)
			entries, legacy := w.Entries, w.Def.Legacy
			j := BuildJournal(entries, legacy)
			J := w.Journal
			sameJSON(t, "lines", j.Lines, J["lines"])
			sameJSON(t, "documents", j.Documents, J["documents"])
			sameJSON(t, "problems", j.Problems, J["problems"])
			sameJSON(t, "seen", j.Seen, J["seen"])
			ids := [][2]any{}
			for _, k := range j.IdentityKeys() {
				s, _ := j.Identity(k)
				ids = append(ids, [2]any{k, s})
			}
			sameJSON(t, "identities", ids, J["identities"])
			sameJSON(t, "owedList", j.OwedList(), J["owedList"])
			var bal []struct {
				Case    *string `json:"case"`
				Account string  `json:"account"`
				Paise   int64   `json:"paise"`
			}
			json.Unmarshal(J["balances"], &bal)
			for _, b := range bal {
				if got := j.CaseBalance(b.Case, b.Account); got != b.Paise {
					t.Errorf("CaseBalance(%v,%s) = %d, ts %d", b.Case, b.Account, got, b.Paise)
				}
			}
			var cases []struct {
				Case       string `json:"case"`
				Advances   int64  `json:"advances"`
				Receivable int64  `json:"receivable"`
			}
			json.Unmarshal(J["cases"], &cases)
			for _, c := range cases {
				if j.AdvancesOf(c.Case) != c.Advances || j.ReceivableOf(c.Case) != c.Receivable {
					t.Errorf("case %s: advances %d receivable %d, ts %d %d", c.Case, j.AdvancesOf(c.Case), j.ReceivableOf(c.Case), c.Advances, c.Receivable)
				}
			}
			var open []struct {
				Key  string `json:"key"`
				Open int64  `json:"open"`
			}
			json.Unmarshal(J["openOwed"], &open)
			for _, o := range open {
				if got := j.OpenOwed(o.Key); got != o.Open {
					t.Errorf("OpenOwed(%s) = %d, ts %d", o.Key, got, o.Open)
				}
			}
			var linesOf []struct{ Seq, N int }
			json.Unmarshal(J["linesOf"], &linesOf)
			for _, l := range linesOf {
				if got := len(j.LinesOf(l.Seq)); got != l.N {
					t.Errorf("LinesOf(%d) = %d lines, ts %d", l.Seq, got, l.N)
				}
			}
			sameJSON(t, "balancesAll", Balances(j.Lines, nil, nil), J["balancesAll"])
			var by []struct {
				Name, From, To string
				Out            json.RawMessage `json:"out"`
			}
			json.Unmarshal(J["balancesBy"], &by)
			for _, b := range by {
				sameJSON(t, "balances "+b.Name, Balances(j.Lines, &b.From, &b.To), b.Out)
			}
			from, to := "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"
			sameJSON(t, "balancesFrom", Balances(j.Lines, &from, nil), J["balancesFrom"])
			sameJSON(t, "balancesTo", Balances(j.Lines, nil, &to), J["balancesTo"])
			// the journal fed half the record and then all of it (as post() does) is the journal of all of it
			k := BuildJournal(entries[:len(entries)/2], legacy)
			k.AddAll(entries)
			sameJSON(t, "stepwise", map[string]int{"lines": len(k.Lines), "problems": len(k.Problems), "seen": k.Seen}, w.Stepwise)

			for _, n := range w.Next {
				got := NextNumber(entries, Series(n.Series), n.FY, FYStartMs(n.FY, w.Def.Timezone))
				sameJSON(t, "next "+n.Series+" "+n.FY, map[string]any{"series": got.Series, "fy": got.FY, "n": got.N}, n.Next)
			}
			for _, s := range w.Summaries {
				sameJSON(t, "summary "+s.Name, SummaryOf(j, s.From, s.To, entries), s.Summary)
			}
			for i, r := range w.ReportAccounting {
				got := ReportAccounting(entries, legacy, r.From, r.To)
				if got == nil {
					sameJSON(t, fmt.Sprintf("reportAccounting %d", i), nil, r.Out)
				} else {
					sameJSON(t, fmt.Sprintf("reportAccounting %d", i), got, r.Out)
				}
			}
			for _, f := range w.Figures {
				opt := FigureOptions{RefundAmountFromPayment: f.Options.RefundAmountFromPayment, OwnerMarks: f.Options.OwnerMarks}
				got := FiguresOf(j, entries, legacy, f.From, f.To, opt)
				label := fmt.Sprintf("figures %s %+v", f.Name, f.Options)
				sameJSON(t, label, got, f.Out)
				if bo := BooksOnlyOf(got); bo == nil {
					sameJSON(t, label+" booksOnly", nil, f.BooksOnly)
				} else {
					sameJSON(t, label+" booksOnly", bo, f.BooksOnly)
				}
			}
			private := []string{"Anita Sharma", "ab", " x ", "  Sharma  ", "Ravi \"R\" Kumar", "Kavya"}
			for _, f := range w.Faults {
				es := f.Entries
				if es == nil {
					es = entries
				}
				sameJSON(t, "booksFaults "+f.Name, BooksFaults(es, legacy, nil), f.Books)
				sameJSON(t, "booksFaults private "+f.Name, BooksFaults(es, legacy, private), f.BooksPrivate)
				sameJSON(t, "figuresFaults "+f.Name, FiguresFaults(es, legacy, false), f.Figures)
				sameJSON(t, "figuresFaults fromPayment "+f.Name, FiguresFaults(es, legacy, true), f.FiguresFromPayment)
			}
			sameJSON(t, "markObligations", MarkObligations(entries), w.Obligations)
			for _, v := range w.Views {
				got := OwnerMoney(MoneyViewInput{Journal: j, Entries: entries, RefundsUntold: v.Untold, NowMs: v.NowMs, TimeZone: w.Def.Timezone})
				sameJSON(t, "ownerMoney "+v.Key, got, v.View)
			}
		})
	}
}

// vectorFiles lists the vector files that exist (a sanity check that the generator wrote what the tests read).
func TestVectorFilesExist(t *testing.T) {
	for _, name := range worldNames {
		for _, kind := range []string{"world", "files", "pages"} {
			if _, err := os.Stat(filepath.Join("testdata", kind+"-"+name+".json")); err != nil {
				t.Error(err)
			}
		}
	}
	var misc struct {
		Node string `json:"node"`
	}
	loadVec(t, "misc", &misc)
	if !strings.HasPrefix(misc.Node, "v") {
		t.Errorf("the vectors do not name the Node that made them: %q", misc.Node)
	}
}

// TestBookingsLegacyIsTheTypeScripts: the Go map of Bookings' older actions is the TypeScript's BOOKINGS_LEGACY, and the Bookings journal reads what the generic one does.
func TestBookingsLegacyIsTheTypeScripts(t *testing.T) {
	w := loadWorld(t, "bookings")
	if !reflect.DeepEqual(BookingsLegacy, w.Def.Legacy) {
		t.Errorf("BookingsLegacy %+v, ts %+v", BookingsLegacy, w.Def.Legacy)
	}
	a, b := BookingsJournal(w.Entries), BuildJournal(w.Entries, w.Def.Legacy)
	if !reflect.DeepEqual(a.Lines, b.Lines) || !reflect.DeepEqual(a.Problems, b.Problems) {
		t.Error("BookingsJournal differs from the journal read with the TypeScript's map")
	}
}
