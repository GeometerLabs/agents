package language

// Regular expressions matched the way JavaScript matches them, for the shapes the TypeScript patterns have. Go's regexp (RE2) has no look-behind and no look-ahead, which the
// TypeScript leans on to find a whole word in Indian scripts, where `\b` does not work: `(?<![\p{L}\p{M}])(?:ten|twenty)(?![\p{L}\p{M}])`.
//
// An earlier way (consume the character on each side as part of the match) is right for "is there a match" but wrong for `matchAll` and `replace`: the consumed space after
// "ten" in "ten twenty" is then no longer there for "twenty" to start after, so JavaScript finds two words and that way one. This file does what JavaScript does instead:
//
//   - the source is split at its top-level `|` into alternatives, and JavaScript's order is kept: at each position, left to right, each alternative is tried in turn, and the
//     first that matches there wins;
//   - an alternative's leading negative look-behind of one character `(?<!X)` is checked by hand on the character before the position;
//   - its trailing negative look-ahead of one character `(?!X)` becomes part of the RE2 pattern as "a character not in X, or the end", and the match is then cut back to before
//     that character. Because the edge is in the pattern, RE2 backtracks into the alternative exactly as JavaScript does when the edge fails (Go's regexp prefers what a
//     backtracking engine would choose: "leftmost-first");
//   - a one-character look-ahead that ends a word of the word list the alternative ends with (`(?:ಗಂಟೆ(?![\p{L}\p{M}])|बजे)`) is the same edge, marked (markEdges);
//   - any other look-ahead (in the middle, or longer than one character) splits the alternative: the part before it is matched, and its shorter ends are tried longest first
//     until the look-ahead does not match after one ("ends" mode, in `alt`);
//   - an alternative with a `\b` inside it is matched with the character before the position in front, so the `\b` sees it;
//   - a leading `^` or `\b` is checked by hand (the alternative is matched on the text from the position on, which has lost what came before); a look-behind that opens
//     the alternative's first capture group is the same look-behind before the group;
//   - JavaScript's `\s`, `.` and `\uXXXX` are written in RE2's words.
//
// Anything else that JavaScript has and RE2 does not (a look-around elsewhere, a back-reference, the `m` or `y` flag) is refused when the pattern is compiled: every generated
// pattern is compiled by the tests, so a new TypeScript pattern this cannot copy fails there, never silently in a shop.

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Regex is one JavaScript regular expression.
type Regex struct {
	src    string
	alts   []alt
	groups int            // capture groups, numbered across the alternatives as JavaScript numbers them
	pre    *regexp.Regexp // every alternative's body, unanchored: no alternative can match before where this first matches
	global bool
}

type alt struct {
	start  bool           // a leading `^`
	wordB  bool           // a leading `\b`
	before *regexp.Regexp // (?<!X): the character before must not match this
	// re is ^(body)(?:edge|$) (group 1 is the match), or in "ends" mode ^(head). re[1] is the same with the character before the position in front, `^(?s:.)(...)`, for a
	// body with a `\b` in it, which must see that character (re[1] == re[0] otherwise).
	re [2]*regexp.Regexp
	// "ends" mode, for a look-ahead `(?!X)` that RE2 cannot have: in the middle of the alternative, or longer than one character after a body with choices. The head (what comes
	// before it) is matched; if the look-ahead matches after it, the head's shorter ends are tried, longest first (what a backtracking engine tries first when the head's last
	// choice is a greedy repetition, the shape these patterns have: `(\d[\d,]*)`, `(\d{2})`), each checked whole by `exact`; then the rest, `tail`, is matched after it.
	// A head whose last choice is an alternation with the shorter choice first (`(?:a|ab)`) is not that shape: JavaScript would try the longer one next, this does not; no
	// generated pattern has it, and the vector tests would show one that did.
	exact  [2]*regexp.Regexp // ^(head)$
	look   *regexp.Regexp    // ^(?:X)
	tail   *regexp.Regexp    // ^(rest), nil when the look-ahead ends the alternative
	ctx    bool
	js     []int // for each RE2 group from 2 on (of re and exact): its number among the alternative's JavaScript groups, or -1 for an edge marker (`(?P<edge>...)`)
	tailN  int   // the tail's own capture groups (numbered after the head's)
	groups int   // the alternative's JavaScript capture groups
	first  int   // the JavaScript number of its first group
}

// MustCompile is Compile that panics: the patterns come from the TypeScript source and are compiled by the tests.
func MustCompile(source, flags string) *Regex {
	r, err := Compile(source, flags)
	if err != nil {
		panic(err)
	}
	return r
}

// Compile reads a JavaScript source and flags (`i`, `s`, `u`, `g`).
func Compile(source, flags string) (*Regex, error) {
	prefix := ""
	for _, f := range flags {
		switch f {
		case 'i':
			prefix += "(?i)"
		case 's':
			prefix += "(?s)"
		case 'u', 'g':
		default:
			return nil, fmt.Errorf("the flag %q is not supported (%s)", f, source)
		}
	}
	dotAll := strings.ContainsRune(flags, 's')
	r := &Regex{src: source, global: strings.ContainsRune(flags, 'g')}
	var bodies []string
	for _, a := range splitTop(source) {
		x, body, err := compileAlt(a, prefix, dotAll)
		if err != nil {
			return nil, fmt.Errorf("%w (in %s)", err, source)
		}
		x.first = r.groups + 1
		r.groups += x.groups
		r.alts = append(r.alts, x)
		bodies = append(bodies, "(?:"+body+")")
	}
	pre, err := regexp.Compile(prefix + strings.Join(bodies, "|"))
	if err != nil {
		return nil, err
	}
	r.pre = pre
	return r, nil
}

func compileAlt(a, prefix string, dotAll bool) (alt, string, error) {
	var x alt
	// a capture group that opens with the look-behind ("((?<![\p{L}])(?:my name is))"): the look-behind is at the same place outside the group, so it is taken out of it
	if strings.HasPrefix(a, "((?<!") {
		end := groupEnd(a, 1)
		a = a[1:end] + "(" + a[end:]
	}
	if strings.HasPrefix(a, "(?<!") {
		end := groupEnd(a, 0)
		cls, err := convert(a[4:end-1], dotAll)
		if err != nil {
			return x, "", err
		}
		if x.before, err = regexp.Compile(prefix + `^(?:` + cls + `)$`); err != nil {
			return x, "", err
		}
		a = a[end:]
	}
	if strings.HasPrefix(a, "^") {
		x.start, a = true, a[1:]
	}
	if strings.HasPrefix(a, `\b`) {
		x.wordB, a = true, a[2:]
	}
	edge := ""
	if i := lastGroup(a); i >= 0 && strings.HasPrefix(a[i:], "(?!") {
		if neg, ok := negateOne(a[i+3 : len(a)-1]); ok {
			conv, err := convert(neg, dotAll)
			if err != nil {
				return x, "", err
			}
			edge, a = conv, a[:i]
		}
	}
	a = markEdges(a)
	// what is left of a look-ahead is the "ends" mode's: the first one splits the alternative into head, look-ahead and rest
	rest, look := "", ""
	if i := firstLookAhead(a); i >= 0 {
		end := groupEnd(a, i)
		look, rest, a = a[i+3:end-1], a[end:], a[:i]
		if edge != "" || strings.HasSuffix(a, `\b`) || strings.Contains(rest, "(?") || strings.Contains(rest, `\b`) {
			return x, "", fmt.Errorf("this look-ahead is not supported: %s", a+"(?!"+look+")"+rest)
		}
	}
	if strings.Contains(a, "(?<") && !strings.Contains(a, "(?<=") && !strings.Contains(a, "(?<!") {
		// a named group: allowed
	} else if strings.Contains(a, "(?<") {
		return x, "", fmt.Errorf("a look-behind that is not at the start is not supported: %s", a)
	}
	body, err := convert(a, dotAll)
	if err != nil {
		return x, "", err
	}
	x.ctx = strings.Contains(a, `\b`) || strings.Contains(a, `\B`)
	tail := ""
	if edge != "" {
		tail = `(?:` + edge + `|$)`
	}
	for k, lead := range []string{"", `(?s:.)`} {
		if k == 1 && !x.ctx {
			x.re[1], x.exact[1] = x.re[0], x.exact[0]
			break
		}
		if x.re[k], err = regexp.Compile(prefix + `^` + lead + `(` + body + `)` + tail); err != nil {
			return x, "", err
		}
		if look != "" {
			if x.exact[k], err = regexp.Compile(prefix + `^` + lead + `(` + body + `)$`); err != nil {
				return x, "", err
			}
		}
	}
	for i, name := range x.re[0].SubexpNames()[2:] {
		if name == "edge" {
			x.js = append(x.js, -1)
		} else {
			x.js = append(x.js, i-countEdges(x.js))
		}
	}
	x.groups = len(x.js) - countEdges(x.js)
	if look != "" {
		conv, err := convert(look, dotAll)
		if err != nil {
			return x, "", err
		}
		if x.look, err = regexp.Compile(prefix + `^(?:` + conv + `)`); err != nil {
			return x, "", err
		}
		if rest != "" {
			conv, err := convert(rest, dotAll)
			if err != nil {
				return x, "", err
			}
			if x.tail, err = regexp.Compile(prefix + `^(` + conv + `)`); err != nil {
				return x, "", err
			}
			x.tailN = x.tail.NumSubexp() - 1
			x.groups += x.tailN
		}
	}
	return x, body, nil
}

func countEdges(js []int) int {
	n := 0
	for _, j := range js {
		if j < 0 {
			n++
		}
	}
	return n
}

// markEdges: an alternative that ends with a group `(?:...)` whose own alternatives end with a one-character look-ahead (`(?:ಗಂಟೆ(?![\p{L}\p{M}])|बजे)`, the shape of a word
// list with an edge on some words): each such look-ahead becomes "that character, or the end", as a group named `edge`, and the match is cut back to where that group starts.
// Because the edge is in the pattern, RE2 tries the next word when it fails, as JavaScript does. Nothing follows the group, so consuming the character takes it from nothing.
func markEdges(a string) string {
	i := lastGroup(a)
	if i < 0 || !strings.HasPrefix(a[i:], "(?:") || !strings.Contains(a[i:], "(?!") {
		return a
	}
	parts := splitTop(a[i+3 : len(a)-1])
	for k, part := range parts {
		if j := lastGroup(part); j >= 0 && strings.HasPrefix(part[j:], "(?!") {
			if neg, ok := negateOne(part[j+3 : len(part)-1]); ok {
				parts[k] = part[:j] + `(?:(?P<edge>` + neg + `)|$)`
			}
		}
	}
	return a[:i] + "(?:" + strings.Join(parts, "|") + ")"
}

// firstLookAhead is where the first `(?!` at the top level of the alternative opens, or -1 (one inside a group is refused when the rest is compiled).
func firstLookAhead(s string) int {
	depth := 0
	for i := 0; i < len(s); {
		switch s[i] {
		case '\\':
			i += 2
		case '[':
			i = classEnd(s, i)
		case '(':
			if depth == 0 && strings.HasPrefix(s[i:], "(?!") {
				return i
			}
			depth++
			i++
		case ')':
			depth--
			i++
		default:
			i++
		}
	}
	return -1
}

// splitTop splits a source at its top-level `|` (not inside a group or a class).
func splitTop(s string) []string {
	var out []string
	depth, class, from := 0, false, 0
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case c == '\\':
			i++
		case class:
			if c == ']' {
				class = false
			}
		case c == '[':
			class = true
		case c == '(':
			depth++
		case c == ')':
			depth--
		case c == '|' && depth == 0:
			out = append(out, s[from:i])
			from = i + 1
		}
	}
	return append(out, s[from:])
}

// groupEnd is the index just after the group that opens at s[i].
func groupEnd(s string, i int) int {
	depth, class := 0, false
	for ; i < len(s); i++ {
		switch c := s[i]; {
		case c == '\\':
			i++
		case class:
			if c == ']' {
				class = false
			}
		case c == '[':
			class = true
		case c == '(':
			depth++
		case c == ')':
			depth--
			if depth == 0 {
				return i + 1
			}
		}
	}
	return len(s)
}

// lastGroup is where the group that ends the alternative opens, or -1 when it does not end with a group.
func lastGroup(s string) int {
	last := -1
	for i := 0; i < len(s); {
		switch s[i] {
		case '\\':
			i += 2
		case '[':
			i = classEnd(s, i)
		case '(':
			end := groupEnd(s, i)
			if end == len(s) {
				last = i
			}
			i = end
		default:
			i++
		}
	}
	return last
}

func classEnd(s string, i int) int {
	for i++; i < len(s); i++ {
		if s[i] == '\\' {
			i++
		} else if s[i] == ']' {
			return i + 1
		}
	}
	return len(s)
}

// negateOne: a look-ahead's content that is one character class ([...], \d, \p{X}, \w), as the class of the characters it does NOT match.
func negateOne(s string) (string, bool) {
	switch {
	case strings.HasPrefix(s, "[^") && classEnd(s, 0) == len(s):
		return "[" + s[2:], true
	case strings.HasPrefix(s, "[") && classEnd(s, 0) == len(s):
		return "[^" + s[1:], true
	case s == `\d` || s == `\w` || s == `\s`:
		return `[^` + s + `]`, true
	case (strings.HasPrefix(s, `\p{`) || strings.HasPrefix(s, `\P{`)) && strings.Index(s, "}") == len(s)-1:
		return `[^` + s + `]`, true
	}
	return "", false
}

// convert writes a piece of JavaScript source in RE2's words: `\s` as JavaScript's whitespace, `.` without the line ends JavaScript leaves out, `\uXXXX` and `\u{X}` as `\x{X}`,
// `\/` as `/`. A back-reference is refused.
func convert(s string, dotAll bool) (string, error) {
	var b strings.Builder
	class := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '\\' && i+1 < len(s) {
			n := s[i+1]
			switch {
			case n == 's':
				if class {
					b.WriteString(JSSpace)
				} else {
					b.WriteString("[" + JSSpace + "]")
				}
			case n == 'S' && !class:
				b.WriteString("[^" + JSSpace + "]")
			case n == 'S':
				return "", fmt.Errorf(`\S inside a class is not supported`)
			case n == 'u' && i+2 < len(s) && s[i+2] == '{':
				end := strings.IndexByte(s[i:], '}')
				b.WriteString(`\x{` + s[i+3:i+end] + `}`)
				i += end
				continue
			case n == 'u' && i+5 < len(s):
				b.WriteString(`\x{` + s[i+2:i+6] + `}`)
				i += 5
				continue
			case n == '/':
				b.WriteByte('/')
			case n >= '1' && n <= '9':
				return "", fmt.Errorf("a back-reference is not supported")
			case n == 'c' || n == 'k':
				return "", fmt.Errorf(`\%c is not supported`, n)
			default:
				b.WriteByte(c)
				b.WriteByte(n)
			}
			i++
			continue
		}
		switch {
		case class && c == ']':
			class = false
		case !class && c == '[':
			class = true
		case !class && c == '.' && !dotAll:
			b.WriteString(`[^\n\r\x{2028}\x{2029}]`)
			continue
		}
		b.WriteByte(c)
	}
	return b.String(), nil
}

// ---- matching -----------------------------------------------------------------------------------------------------------------------------------------------

// Match is one match: Index[0:2] is where it is in the text (bytes), and Index[2k:2k+2] where group k is (-1 when it took no part), as JavaScript numbers the groups.
type Match struct {
	Index []int
	text  string
}

// Start and End are byte offsets; Group(0) is the match, Group(k) a capture group ("" when it took no part, as JavaScript's undefined reads in a template).
func (m *Match) Start() int { return m.Index[0] }
func (m *Match) End() int   { return m.Index[1] }
func (m *Match) Group(k int) string {
	if m == nil || 2*k+1 >= len(m.Index) || m.Index[2*k] < 0 {
		return ""
	}
	return m.text[m.Index[2*k]:m.Index[2*k+1]]
}

// Took is whether group k took part in the match.
func (m *Match) Took(k int) bool { return 2*k < len(m.Index) && m.Index[2*k] >= 0 }

// Source is the JavaScript source.
func (r *Regex) Source() string { return r.src }

// FindFrom is the first match at byte offset `from` or after (JavaScript's exec with lastIndex), or nil.
func (r *Regex) FindFrom(s string, from int) *Match {
	for pos := from; pos <= len(s); {
		loc := r.pre.FindStringIndex(s[pos:])
		if loc == nil {
			return nil
		}
		p := pos + loc[0]
		if m := r.at(s, p); m != nil {
			return m
		}
		if p >= len(s) {
			return nil
		}
		_, size := utf8.DecodeRuneInString(s[p:])
		pos = p + size
	}
	return nil
}

// at tries each alternative at byte p, in JavaScript's order.
func (r *Regex) at(s string, p int) *Match {
	for i := range r.alts {
		a := &r.alts[i]
		if a.start && p != 0 {
			continue
		}
		if a.wordB && isWord(runeBefore(s, p), p > 0) == isWord(firstRune(s, p)) {
			continue
		}
		if a.before != nil && p > 0 && a.before.MatchString(string(runeBefore(s, p))) {
			continue
		}
		if m := a.match(s, p, r.groups); m != nil {
			return m
		}
	}
	return nil
}

// run matches one of the alternative's anchored patterns at byte p of s[:limit], with the character before p in front when the pattern needs it; the places are absolute.
func (a *alt) run(re [2]*regexp.Regexp, s string, p, limit int) []int {
	q, k := p, 0
	if a.ctx && p > 0 {
		_, size := utf8.DecodeLastRuneInString(s[:p])
		q, k = p-size, 1
	}
	loc := re[k].FindStringSubmatchIndex(s[q:limit])
	for i := range loc {
		if loc[i] >= 0 {
			loc[i] += q
		}
	}
	return loc
}

// match is the alternative's match at p, its groups numbered as JavaScript numbers them across the whole pattern (`total` groups).
func (a *alt) match(s string, p, total int) *Match {
	loc := a.run(a.re, s, p, len(s))
	if loc == nil {
		return nil
	}
	var tail []int
	if a.look != nil {
		// "ends" mode: the head's preferred end, then its shorter ends, until the look-ahead does not match after one (and the rest matches after it)
		e0 := loc[3]
		found := false
		for e := e0; e >= p; e-- {
			if e < len(s) && !utf8.RuneStart(s[e]) {
				continue
			}
			if e < e0 {
				if loc = a.run(a.exact, s, p, e); loc == nil {
					continue
				}
			}
			if a.look.MatchString(s[e:]) {
				continue
			}
			if a.tail != nil {
				if tail = a.tail.FindStringSubmatchIndex(s[e:]); tail == nil {
					continue
				}
			}
			found = true
			break
		}
		if !found {
			return nil
		}
	}
	end := loc[3]
	idx := make([]int, 2+2*total)
	for i := range idx {
		idx[i] = -1
	}
	for g, j := range a.js {
		at := 4 + 2*g
		if loc[at] < 0 {
			continue
		}
		if j < 0 {
			end = loc[at] // an edge marker: the match ends before the character it took
			continue
		}
		idx[2*(a.first+j)], idx[2*(a.first+j)+1] = loc[at], loc[at+1]
	}
	if tail != nil {
		for g := 0; g < a.tailN; g++ {
			if tail[4+2*g] >= 0 {
				n := a.first + a.groups - a.tailN + g
				idx[2*n], idx[2*n+1] = end+tail[4+2*g], end+tail[5+2*g]
			}
		}
		end += tail[3]
	}
	idx[0], idx[1] = p, end
	return &Match{Index: idx, text: s}
}

func firstRune(s string, p int) (rune, bool) {
	if p >= len(s) {
		return 0, false
	}
	r, _ := utf8.DecodeRuneInString(s[p:])
	return r, true
}

// isWord is JavaScript's `\w` (ASCII letters, digits and _), for a `\b`.
func isWord(r rune, ok bool) bool {
	return ok && (r < utf8.RuneSelf && (unicode.IsLetter(r) || unicode.IsDigit(r)) || r == '_')
}

// Find is exec from the start: the first match, or nil.
func (r *Regex) Find(s string) *Match { return r.FindFrom(s, 0) }

// Test is JavaScript's `test` on a pattern without the g flag.
func (r *Regex) Test(s string) bool { return r.Find(s) != nil }

// Index is where the first match starts (bytes), or -1.
func (r *Regex) Index(s string) int {
	if m := r.Find(s); m != nil {
		return m.Start()
	}
	return -1
}

// All is `s.matchAll(re)` (and what a g-flag `replace` replaces): each match, then the next search from its end; after an empty match, from one character on.
func (r *Regex) All(s string) []*Match {
	var out []*Match
	for pos := 0; pos <= len(s); {
		m := r.FindFrom(s, pos)
		if m == nil {
			break
		}
		out = append(out, m)
		pos = m.End()
		if m.End() == m.Start() {
			if pos >= len(s) {
				break
			}
			_, size := utf8.DecodeRuneInString(s[pos:])
			pos += size
		}
	}
	return out
}

// ReplaceFunc is `s.replace(re, fn)`: every match when the pattern has the g flag, otherwise the first.
func (r *Regex) ReplaceFunc(s string, fn func(*Match) string) string {
	var ms []*Match
	if r.global {
		ms = r.All(s)
	} else if m := r.Find(s); m != nil {
		ms = []*Match{m}
	}
	if len(ms) == 0 {
		return s
	}
	var b strings.Builder
	last := 0
	for _, m := range ms {
		b.WriteString(s[last:m.Start()])
		b.WriteString(fn(m))
		last = m.End()
	}
	b.WriteString(s[last:])
	return b.String()
}

// Replace is `s.replace(re, template)` with `$&` and `$1`..`$9` in the template (a group that took no part is "").
func (r *Regex) Replace(s, template string) string {
	return r.ReplaceFunc(s, func(m *Match) string {
		var b strings.Builder
		for i := 0; i < len(template); i++ {
			if template[i] == '$' && i+1 < len(template) {
				switch n := template[i+1]; {
				case n == '&':
					b.WriteString(m.Group(0))
					i++
					continue
				case n >= '1' && n <= '9' && int(n-'0') <= r.groups:
					b.WriteString(m.Group(int(n - '0')))
					i++
					continue
				case n == '$':
					b.WriteByte('$')
					i++
					continue
				}
			}
			b.WriteByte(template[i])
		}
		return b.String()
	})
}

// Global is the same pattern with the g flag on or off (`new RegExp(re.source, "giu")`).
func (r *Regex) Global(on bool) *Regex {
	c := *r
	c.global = on
	return &c
}
