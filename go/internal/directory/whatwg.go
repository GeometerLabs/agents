// An https web address read the way JavaScript's `new URL(text)` reads it (the WHATWG URL standard), for the few places the directory decides something from an address: is a feed
// under its shop's page, is a notice for a feed address it serves, is an address one it may call. Go's net/url does not do the same thing (it keeps dot segments, a backslash, a
// default port, upper-case host letters), and an address that one reader accepts and the other reads differently is the kind of difference an attacker uses (a feed that claims
// another shop's page). So this reader has one rule: it returns the SAME parts JavaScript would, or it refuses. It refuses anything it does not model: a host that is not plain ASCII
// letters, digits, hyphens and dots, or that ends in a number (JavaScript would read it as an IPv4 address in any of its forms); a user name or password; a backslash, a space or a
// control character; a dot segment in the path (`/a/../b`, `/%2e/`), which JavaScript would remove. The vectors in testdata/url-vectors.json (made by scripts/gen_directory_vectors.ts
// from the TypeScript on hostile inputs) are checked so that a result is either equal to JavaScript's or a refusal.
package directory

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

// webURL is the parts of an https address JavaScript's URL object gives.
type webURL struct {
	Href, Origin, Hostname, Port, Pathname, Search, Hash string
}

// pathEncode percent-encodes the path code points the standard's path set names: controls, space, ", #, <, >, ?, `, {, } and everything not ASCII (as UTF-8, capitals).
func encodeSet(s string, set string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if c < 0x21 || c > 0x7e || strings.IndexByte(set, c) >= 0 {
			b.WriteString("%" + strings.ToUpper(string("0123456789abcdef"[c>>4])+string("0123456789abcdef"[c&15])))
		} else {
			b.WriteByte(c)
		}
	}
	return b.String()
}

const (
	pathSet     = "\"#<>?`{}"
	querySet    = "\"#<>'"
	fragmentSet = "\"<>`"
)

// parseHTTPS is `new URL(text)` for an https address with no user name or password, or ok=false (a refusal that JavaScript might not have made).
func parseHTTPS(text string) (webURL, bool) {
	if !utf8.ValidString(text) || !strings.HasPrefix(text, "https://") {
		return webURL{}, false
	}
	for _, c := range []byte(text) {
		if c <= 0x20 || c == 0x7f || c == '\\' {
			return webURL{}, false
		}
	}
	rest := text[len("https://"):]
	end := strings.IndexAny(rest, "/?#")
	auth, tail := rest, ""
	if end >= 0 {
		auth, tail = rest[:end], rest[end:]
	}
	if strings.ContainsAny(auth, "@[]%") || auth == "" {
		return webURL{}, false
	}
	if strings.Count(auth, ":") > 1 {
		return webURL{}, false
	}
	host, port, _ := strings.Cut(auth, ":")
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || len(port) > 5 || n > 65535 || strings.Trim(port, "0123456789") != "" {
			return webURL{}, false
		}
		port = strconv.Itoa(n)
		if n == 443 {
			port = "" // the default port is dropped from the origin and the href
		}
	}
	host = strings.ToLower(host)
	if host == "" || host[0] == '.' || strings.HasSuffix(host, "..") || strings.Contains(host, "..") {
		return webURL{}, false
	}
	for _, c := range []byte(host) {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '.') {
			return webURL{}, false
		}
	}
	labels := strings.Split(strings.TrimSuffix(host, "."), ".")
	last := labels[len(labels)-1]
	if last == "" || last[0] >= '0' && last[0] <= '9' || strings.HasPrefix(last, "0x") { // would be read as an IPv4 address
		return webURL{}, false
	}
	if strings.HasPrefix(host, "xn--") || strings.Contains(host, ".xn--") {
		return webURL{}, false // punycode is validated by JavaScript (IDNA); not modelled
	}
	u := webURL{Hostname: host, Port: port}
	u.Origin = "https://" + host
	if port != "" {
		u.Origin += ":" + port
	}
	pathPart, queryPart, fragPart := tail, "", ""
	if i := strings.IndexByte(pathPart, '#'); i >= 0 {
		pathPart, fragPart = pathPart[:i], pathPart[i:]
	}
	if i := strings.IndexByte(pathPart, '?'); i >= 0 {
		pathPart, queryPart = pathPart[:i], pathPart[i:]
	}
	if pathPart == "" {
		pathPart = "/"
	}
	// a dot segment is removed by JavaScript (also written %2e); refused here
	for _, seg := range strings.Split(pathPart[1:], "/") {
		l := strings.ToLower(seg)
		if l == "." || l == ".." || l == "%2e" || l == ".%2e" || l == "%2e." || l == "%2e%2e" {
			return webURL{}, false
		}
	}
	u.Pathname = encodeSet(pathPart, pathSet)
	// an empty query or fragment ("?" or "#") is kept in the href and is not in `search` or `hash`, as JavaScript has it
	href := u.Origin + u.Pathname
	if len(queryPart) > 0 {
		q := encodeSet(queryPart[1:], querySet)
		href += "?" + q
		if q != "" {
			u.Search = "?" + q
		}
	}
	if len(fragPart) > 0 {
		f := encodeSet(fragPart[1:], fragmentSet)
		href += "#" + f
		if f != "" {
			u.Hash = "#" + f
		}
	}
	u.Href = href
	return u, true
}
