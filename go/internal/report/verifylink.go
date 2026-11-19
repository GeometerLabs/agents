// The older link a paper carries to geometer.dev's check page, and the QR code of it: modules/report/verify-link.ts. `https://geometer.dev/verify/#<digest or code>`; a SIGNED paper
// carries a signed summary instead (summary.go) and this form stays for every paper that is not signed. Everything sits after the "#", which a browser never sends to a server.
// The key part (`&key=key:<64 hex>`) is left out of every link the report prints (a paper cannot vouch for its own signer); the optional argument is for a caller that holds a key
// the reader was given another way.
package report

import (
	"errors"
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/qr"
)

// VerifyURL is VERIFY_URL.
const VerifyURL = "https://geometer.dev/verify/"

var keyIDRe = regexp.MustCompile(`^key:[0-9a-f]{64}$`)

// VerifyLink is verifyLink: `https://geometer.dev/verify/#sha256:<64 hex>`, with `&key=key:<64 hex>` after it when key is not "".
func VerifyLink(digest, key string) (string, error) {
	if !sha256Re.MatchString(digest) {
		return "", errors.New("A link needs the full digest: sha256: and 64 hex digits.")
	}
	if key != "" && !keyIDRe.MatchString(key) {
		return "", errors.New("A key in a link is key: and 64 hex digits.")
	}
	if key != "" {
		return VerifyURL + "#" + digest + "&key=" + key, nil
	}
	return VerifyURL + "#" + digest, nil
}

// VerifyCodeLink is verifyCodeLink: the code form with the host, the shortest link that finds a paper.
func VerifyCodeLink(code string) string { return VerifyURL + "#" + code }

// VerifyCodePath is verifyCodePath: `/verify/#7K2M-9QXD`, for a line of text.
func VerifyCodePath(code string) string { return "/verify/#" + code }

// VerifyQrSvg is verifyQrSvg: the inline SVG of the QR code of VerifyLink, with the label a screen reader says.
func VerifyQrSvg(digest, label, key string) (string, error) {
	link, err := VerifyLink(digest, key)
	if err != nil {
		return "", err
	}
	return qr.TextSvg(link, qr.SvgOptions{Label: label})
}
