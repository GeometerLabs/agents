package store

// The snapshot in pieces (layout 3, 11 Nov 2026), as modules/runtime/store.ts keeps it. The shop's state is one JSON text; a year-old shop's would be written again whole by every
// step, so each list in it is kept one element to a row (`state_rows`): a top-level list, and a list one level inside a top-level object (`assistant.cards`). What is left is a
// small `state_shape`, with null where each list was. A step writes the shape and only the rows whose element changed or is new. The same pieces are read and written here, so
// either runtime can open the other's file.

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

// SplitSnapshotText is a snapshot taken apart.
type Split struct {
	Shape string
	Lists []string // each list's path as JSON text, in the order they come
	Rows  map[string][]string
}

type stored struct {
	split   Split
	version int
}

// pair is one member of a JSON object, in the order it was written.
type pair struct {
	key string
	val json.RawMessage
}

// objectPairs reads a JSON object's members in order (encoding/json's maps lose it), or ok=false when the text is not an object.
func objectPairs(raw []byte) (pairs []pair, ok bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, false
	}
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			return nil, false
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, false
		}
		pairs = append(pairs, pair{kt.(string), v})
	}
	return pairs, true
}

func writePairs(pairs []pair) []byte {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, p := range pairs {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(p.key)
		b.Write(k)
		b.WriteByte(':')
		b.Write(p.val)
	}
	b.WriteByte('}')
	return b.Bytes()
}

func isArray(raw json.RawMessage) bool {
	return len(bytes.TrimSpace(raw)) > 0 && bytes.TrimSpace(raw)[0] == '['
}

// SplitSnapshot takes a snapshot apart. A text that is not a JSON object is kept whole as the shape with no lists, and read back exactly as it was given.
func SplitSnapshot(snapshot string) (Split, error) {
	whole := Split{Shape: snapshot, Rows: map[string][]string{}}
	top, ok := objectPairs([]byte(snapshot))
	if !ok {
		return whole, nil
	}
	out := Split{Rows: map[string][]string{}}
	take := func(path []string, v json.RawMessage) bool {
		if !isArray(v) {
			return false
		}
		var items []json.RawMessage
		if err := json.Unmarshal(v, &items); err != nil {
			return false
		}
		name, _ := json.Marshal(path)
		out.Lists = append(out.Lists, string(name))
		rows := make([]string, len(items))
		for i, it := range items {
			rows[i] = string(bytes.TrimSpace(it)) // each element is its own JSON text
		}
		out.Rows[string(name)] = rows
		return true
	}
	for i, p := range top {
		if p.key == "__proto__" {
			continue
		}
		if take([]string{p.key}, p.val) {
			top[i].val = json.RawMessage("null") // the shape keeps the key where it was, so the keys come back in the same order
			continue
		}
		if inner, ok := objectPairs(p.val); ok {
			for j, q := range inner {
				if q.key != "__proto__" && take([]string{p.key, q.key}, q.val) {
					inner[j].val = json.RawMessage("null")
				}
			}
			top[i].val = writePairs(inner)
		}
	}
	out.Shape = string(writePairs(top))
	return out, nil
}

// JoinSnapshot puts a split snapshot back together.
func JoinSnapshot(s Split) (string, error) {
	if len(s.Lists) == 0 {
		return s.Shape, nil
	}
	top, ok := objectPairs([]byte(s.Shape))
	if !ok {
		return "", errors.New("the saved state's shape is not an object")
	}
	list := func(name string) json.RawMessage {
		rows := s.Rows[name]
		var b bytes.Buffer
		b.WriteByte('[')
		for i, r := range rows {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(r)
		}
		b.WriteByte(']')
		return b.Bytes()
	}
	for _, name := range s.Lists {
		var path []string
		if err := json.Unmarshal([]byte(name), &path); err != nil {
			return "", err
		}
		for i := range top {
			if top[i].key != path[0] {
				continue
			}
			if len(path) == 1 {
				top[i].val = list(name)
				break
			}
			inner, ok := objectPairs(top[i].val)
			if !ok {
				return "", fmt.Errorf("the saved state's %s is not an object", path[0])
			}
			for j := range inner {
				if inner[j].key == path[1] {
					inner[j].val = list(name)
				}
			}
			top[i].val = writePairs(inner)
			break
		}
	}
	return string(writePairs(top)), nil
}

func readPieces(x exec) (*stored, error) {
	var shape, lists string
	var version int
	err := x.QueryRow("SELECT shape, lists, version FROM state_shape WHERE id = 1").Scan(&shape, &lists, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var names []string
	if err := json.Unmarshal([]byte(lists), &names); err != nil {
		return nil, err
	}
	rows := map[string][]string{}
	for _, n := range names {
		rows[n] = []string{}
	}
	rs, err := x.Query("SELECT list, pos, value FROM state_rows ORDER BY list, pos")
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	for rs.Next() {
		var list, value string
		var pos int
		if err := rs.Scan(&list, &pos, &value); err != nil {
			return nil, err
		}
		into, known := rows[list]
		if !known || pos != len(into) {
			return nil, fmt.Errorf("the saved state is damaged: list %s has a row at place %d that does not follow on. Restore the database from a snapshot", list, pos)
		}
		rows[list] = append(into, value)
	}
	if err := rs.Err(); err != nil {
		return nil, err
	}
	return &stored{split: Split{Shape: shape, Lists: names, Rows: rows}, version: version}, nil
}

// writeSnapshot writes a snapshot's pieces over the stored ones (before; nil when nothing is stored yet): the shape row always, of each list only the elements that differ, are new or are gone.
func writeSnapshot(x exec, before *stored, next Split, nowMs int64) (int, error) {
	version := 1
	if before != nil {
		version = before.version + 1
	}
	lists, _ := json.Marshal(next.Lists)
	if next.Lists == nil {
		lists = []byte("[]")
	}
	if _, err := x.Exec("INSERT INTO state_shape (id, shape, lists, version, saved_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET shape = excluded.shape, lists = excluded.lists, version = excluded.version, saved_at = excluded.saved_at",
		next.Shape, string(lists), version, nowMs); err != nil {
		return 0, err
	}
	names := append([]string{}, next.Lists...)
	for _, name := range names {
		now := next.Rows[name]
		var was []string
		if before != nil {
			was = before.split.Rows[name]
		}
		for i := range now {
			var err error
			if i >= len(was) {
				_, err = x.Exec("INSERT INTO state_rows (list, pos, value) VALUES (?, ?, ?)", name, i, now[i])
			} else if was[i] != now[i] {
				_, err = x.Exec("UPDATE state_rows SET value = ? WHERE list = ? AND pos = ?", now[i], name, i)
			}
			if err != nil {
				return 0, err
			}
		}
		if len(was) > len(now) {
			if _, err := x.Exec("DELETE FROM state_rows WHERE list = ? AND pos >= ?", name, len(now)); err != nil {
				return 0, err
			}
		}
	}
	if before != nil {
		have := map[string]bool{}
		for _, n := range next.Lists {
			have[n] = true
		}
		gone := []string{}
		for _, n := range before.split.Lists {
			if !have[n] {
				gone = append(gone, n)
			}
		}
		sort.Strings(gone)
		for _, n := range gone {
			if _, err := x.Exec("DELETE FROM state_rows WHERE list = ? AND pos >= 0", n); err != nil {
				return 0, err
			}
		}
	}
	return version, nil
}
