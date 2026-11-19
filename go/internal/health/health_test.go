// Tests of the `health` subcommand's check: a 200 is exit 0; a refusal and a closed port are exit 1 with a reason.
package health

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheck(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer ok.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer bad.Close()
	var said string
	say := func(s string) { said = s }
	if got := Check(ok.URL+"/readyz", say); got != 0 {
		t.Fatalf("a 200 should be exit 0, got %d (%s)", got, said)
	}
	if got := Check(bad.URL+"/readyz", say); got != 1 || said == "" {
		t.Fatalf("a 503 should be exit 1 with a reason, got %d %q", got, said)
	}
	said = ""
	url := ok.URL
	ok.Close()
	if got := Check(url+"/readyz", say); got != 1 || said == "" {
		t.Fatalf("a closed port should be exit 1 with a reason, got %d %q", got, said)
	}
}
