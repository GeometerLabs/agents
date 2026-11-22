package listings

// Exported handles on the stock state for internal/stock, the shop's own record of an order's sale and a delivery (the half of modules/stock/stock.ts that stock.go leaves out). The
// state type, its key-ordered `applied` and the low-mark, movement and prune rules stay HERE as the one source of truth; internal/stock only calls them, so there is no second state
// type and no second copy of the rules. Nothing in this file changes an existing function: each method is a thin exported door onto an unexported one.

// LineOf is `lineOf`: the line an id names by its own id, else by an alias. Nil when the item is uncounted (or the state is nil).
func (st *Stock) LineOf(id string) *StockLine { return st.lineOf(id) }

// AppliedGet is `l.applied[key]`: what a key has already done, and whether it is there.
func (l *StockLine) AppliedGet(key string) (Applied, bool) { return l.Applied.get(key) }

// AppliedSet is `l.applied[key] = v`: a new key goes last, an existing key keeps its place (as a JavaScript object does).
func (l *StockLine) AppliedSet(key string, v Applied) { l.Applied.set(key, v) }

// AppliedLen is how many keys the line remembers.
func (l *StockLine) AppliedLen() int { return len(l.Applied.keys) }

// AppliedKeys is the keys in the order they were made (a copy).
func (l *StockLine) AppliedKeys() []string { return append([]string(nil), l.Applied.keys...) }

// WatchLow is `watchLow`: once per crossing, at or under the low mark the line sets lowFlag and queues one alert; it clears when the count rises above the mark.
func (st *Stock) WatchLow(l *StockLine, nowMs int64) { st.watchLow(l, nowMs) }

// NoteMove is `noteMove`: append a movement, keeping the last MaxMoves.
func (l *StockLine) NoteMove(m Movement) { l.noteMove(m) }

// Prune is `prune`: past the soft cap only keys older than SafeKeepMs go, oldest first.
func (l *StockLine) Prune(nowMs int64) { l.prune(nowMs) }
