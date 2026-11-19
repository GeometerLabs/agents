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
//   - a trailing look-ahead longer than one character is checked by hand after the match, and is taken only where the part before it is plain text (no choice to backtrack into);
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
	start    bool           // a leading `^`
	wordB    bool           // a leading `\b`
	before   *regexp.Regexp // (?<!X): the character before must not match this
	re       *regexp.Regexp // ^(body)(?:edge|$): group 1 is the match
	notAfter *regexp.Regexp // a longer (?!X) after a plain-text body, checked by hand
	groups   int            // the body's own capture groups
	first    int            // the JavaScript number of its first group
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
		inner := a[i+3 : len(a)-1]
		body := a[:i]
		if neg, ok := negateOne(inner); ok {
			conv, err := convert(neg, dotAll)
			if err != nil {
				return x, "", err
			}
			edge = conv
		} else {
			if !isPlain(body) {
				return x, "", fmt.Errorf("a look-ahead of more than one character after a pattern with choices is not supported: %s", a)
			}
			conv, err := convert(inner, dotAll)
			if err != nil {
				return x, "", err
			}
			if x.notAfter, err = regexp.Compile(prefix + `^(?:` + conv + `)`); err != nil {
				return x, "", err
			}
		}
		a = body
	}
	if strings.Contains(a, "(?<") && !strings.Contains(a, "(?<=") && !strings.Contains(a, "(?<!") {
		// a named group: allowed
	} else if strings.Contains(a, "(?<") {
		return x, "", fmt.Errorf("a look-behind that is not at the start is not supported: %s", a)
	}
	if strings.Contains(a, "(?=") || strings.Contains(a, "(?!") {
		return x, "", fmt.Errorf("a look-ahead that is not at the end is not supported: %s", a)
	}
	body, err := convert(a, dotAll)
	if err != nil {
		return x, "", err
	}
	tail := ""
	if edge != "" {
		tail = `(?:` + edge + `|$)`
	}
	if x.re, err = regexp.Compile(prefix + `^(` + body + `)` + tail); err != nil {
		return x, "", err
	}
	x.groups = x.re.NumSubexp() - 1
	return x, body, nil
}

// isPlain: text with no choice in it (no class, group, alternation or repetition), so a look-ahead after it has nothing to backtrack into.
func isPlain(s string) bool {
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\\':
			i++
		case '[', '(', '|', '*', '+', '?', '{', '.':
			return false
		}
	}
	return true
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
	for _, a := range r.alts {
		if a.start && p != 0 {
			continue
		}
		if a.wordB && isWord(runeBefore(s, p), p > 0) == isWord(firstRune(s, p)) {
			continue
		}
		if a.before != nil && p > 0 && a.before.MatchString(string(runeBefore(s, p))) {
			continue
		}
		loc := a.re.FindStringSubmatchIndex(s[p:])
		if loc == nil {
			continue
		}
		end := p + loc[3]
		if a.notAfter != nil && a.notAfter.MatchString(s[end:]) {
			continue
		}
		idx := make([]int, 2+2*r.groups)
		for i := range idx {
			idx[i] = -1
		}
		idx[0], idx[1] = p, end
		for g := 0; g < a.groups; g++ {
			if loc[4+2*g] >= 0 {
				idx[2*(a.first+g)], idx[2*(a.first+g)+1] = p+loc[4+2*g], p+loc[5+2*g]
			}
		}
		return &Match{Index: idx, text: s}
	}
	return nil
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
