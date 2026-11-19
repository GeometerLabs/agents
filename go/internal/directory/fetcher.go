// The directory's way out (bundle/services/directory.ts directoryFetcher, and the parts of bundle/services/door.ts it uses: originProblem, addressAllowed, guardedLookup, nodeTransport): a
// feed or a check at an address under a pages domain this server serves goes through THE DOOR'S OWN PORT (the same routes a visitor has, with the pages domain as the Host); any other
// address (a configured feed on a builder's own domain) is called directly, under the door's rules for an outgoing address: https only, a DNS name, the name resolved here and refused
// when ANY answer is a private, loopback, link-local or reserved address, the connection made to an address that was checked, no redirect followed, the body capped.
package directory

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// MaxResponseBytes is the most of an answer's body the transport reads (the door's own cap).
const MaxResponseBytes = 2 * 1024 * 1024

var blocked []*net.IPNet

func init() {
	for _, c := range []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15",
		"198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "::/128", "::1/128", "fc00::/7", "fe80::/10", "ff00::/8", "64:ff9b::/96", "100::/64", "2001:db8::/32", "2001::/23"} {
		_, n, _ := net.ParseCIDR(c)
		blocked = append(blocked, n)
	}
}

// addressAllowed: may the directory connect to this address? Only a public unicast one. An IPv4 address written inside IPv6 (::ffff:a.b.c.d) is judged as the IPv4 address.
func addressAllowed(ip net.IP) bool {
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	for _, n := range blocked {
		if n.Contains(ip) {
			return false
		}
	}
	return true
}

var reNotPublic = regexp.MustCompile(`(?i)\.(localhost|local|internal|home|lan|arpa)$`)

// OriginProblem is why an address is not one the directory will call, or "": https, a DNS name with a dot, a public-looking name.
func OriginProblem(origin string) string {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return "not an address"
	}
	if u.Scheme != "https" {
		return "not https"
	}
	host := strings.ToLower(u.Hostname())
	if net.ParseIP(host) != nil {
		return "an IP address, not a name"
	}
	if !strings.Contains(host, ".") || reNotPublic.MatchString(host) || host == "localhost" {
		return "not a public name"
	}
	return ""
}

// guardedDial resolves the name HERE and refuses when ANY answer is not allowed (one bad answer among good ones is how a name is pointed at the inside), then connects to an address it
// checked, so a second, different answer cannot slip in.
func guardedDial(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New(host + " resolves to an address the directory does not call")
	}
	for _, ip := range ips {
		if !addressAllowed(ip.IP) {
			return nil, errors.New(host + " resolves to an address the directory does not call")
		}
	}
	var last error
	d := net.Dialer{}
	for _, ip := range ips {
		c, err := d.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
		if err == nil {
			return c, nil
		}
		last = err
	}
	return nil, last
}

// NewFetcher is the directory's Fetcher: this server's own shops through the door's own port, anything else directly and guarded. local and remote may be given (tests); nil means the
// real ones.
func NewFetcher(served []string, doorURL string, local, remote *http.Client) Fetcher {
	if local == nil {
		local = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	if remote == nil {
		remote = &http.Client{
			Transport:     &http.Transport{DialContext: guardedDial, TLSHandshakeTimeout: 10 * time.Second, DisableKeepAlives: true},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
	}
	return func(rawURL string, in FetchRequest) (FetchResponse, error) {
		u, err := url.Parse(rawURL)
		if err != nil {
			return FetchResponse{}, errors.New("not an address the directory reads (not an address)")
		}
		viaDoor := u.Scheme == "https" && u.Port() == "" && contains(served, strings.ToLower(u.Hostname()))
		target := rawURL
		host := ""
		client := remote
		if viaDoor {
			target = strings.TrimRight(doorURL, "/") + u.EscapedPath()
			if u.RawQuery != "" {
				target += "?" + u.RawQuery
			}
			host = u.Hostname()
			client = local
		} else if problem := OriginProblem(u.Scheme + "://" + u.Host); problem != "" {
			return FetchResponse{}, errors.New("not an address the directory reads (" + problem + ")")
		}
		ctx, cancel := context.WithTimeout(context.Background(), in.Timeout)
		defer cancel()
		var body io.Reader
		if in.Body != "" {
			body = strings.NewReader(in.Body)
		}
		req, err := http.NewRequestWithContext(ctx, in.Method, target, body)
		if err != nil {
			return FetchResponse{}, err
		}
		for k, v := range in.Headers {
			req.Header.Set(k, v)
		}
		req.Header.Set("User-Agent", "geometer-directory/1")
		if host != "" {
			req.Host = host
		}
		resp, err := client.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return FetchResponse{}, errors.New("timed out")
			}
			return FetchResponse{}, err
		}
		defer resp.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBytes+1))
		if err != nil {
			return FetchResponse{}, err
		}
		if len(raw) > MaxResponseBytes || len(raw) > in.MaxBytes {
			return FetchResponse{}, errors.New("the answer was too big")
		}
		headers := map[string]string{}
		for k, v := range resp.Header {
			if strings.EqualFold(k, "Set-Cookie") {
				continue
			}
			headers[strings.ToLower(k)] = strings.Join(v, ", ")
		}
		return FetchResponse{Status: resp.StatusCode, Headers: headers, Body: replaceBadBytes(raw)}, nil
	}
}
