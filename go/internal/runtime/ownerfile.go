package runtime

// "Get my shop's file" ("leave with your shop", block S): the owner's session takes the package the deployer copied into the shop's client folder, once. The Go twin of
// modules/runtime/owner-file.ts (the store), modules/channels/owner-file.ts (the meta file and the state) and the route in modules/runtime/http.ts.
//
// The deployer (bundle/lib/owner-file.ts) writes two files into client/: owner-file.tar.gz (the package, body first) and owner-file.json (the meta, LAST: nothing is offered until it
// is there). This reads them and says what state the file is in, and gives the bytes to the owner's SESSION (never the panel's link, which is the Operator's) once. One use: the id is
// written to <dataDir>/owner-file-used.json BEFORE the bytes leave, so a dropped connection cannot make a second try work (the owner asks again and gets a new file). The file's hash
// is checked against the meta first, so a half-copied file is never handed over as the owner's. The use is also written in the record (`owner_file_taken` with the ask), which tells the
// deployer to delete its copy.
//
// Copied from TypeScript on purpose: the answer's headers, the used-file's format (a JSON array of ids, the last 50, written to a temporary file with mode 0600 and renamed), and
// the order of the checks. Not copied: TypeScript puts the session's secret TOKEN in the record line's `refs.session` for this event (http.ts passes `session`, where every other
// call passes the session's short id); this writes the short id, so a live session never reaches the record or the deployer's export. (Reported as a TypeScript bug.)

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/GeometerLabs/agents/go/internal/access"
)

const (
	ownerFileMeta = "owner-file.json"
	ownerFileBody = "owner-file.tar.gz"
	ownerFileUsed = "owner-file-used.json"
	// fileTaken is leave.ts FILE_TAKEN, the record's action for this.
	fileTaken = "owner_file_taken"
)

var (
	ownerFileID   = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)
	ownerFileName = regexp.MustCompile(`^[A-Za-z0-9._-]{1,120}$`)
	sha256Hex     = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type fileMeta struct {
	Ask, ID, Name, SHA256, MadeAt, ExpiresAt string
	Bytes                                    int64
}

// parseTime is JavaScript's Date.parse for the shapes the deployer writes (`toISOString`) and the plain ones people write by hand.
func parseTime(s string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// readFileMeta is owner-file.ts `readOwnerFileMeta`: field by field; anything that does not read is no file (a broken meta offers nothing to anyone).
func readFileMeta(text []byte) *fileMeta {
	var f map[string]any
	if json.Unmarshal(text, &f) != nil || f == nil || f["schema"] != float64(1) {
		return nil
	}
	ask, ok1 := f["ask"].(string)
	id, ok2 := f["id"].(string)
	name, ok3 := f["name"].(string)
	bytes, ok4 := f["bytes"].(float64)
	sum, ok5 := f["sha256"].(string)
	made, ok6 := f["madeAt"].(string)
	expires, ok7 := f["expiresAt"].(string)
	if !ok1 || !ok2 || !ownerFileID.MatchString(id) || !ok3 || !ownerFileName.MatchString(name) || !ok4 || bytes != float64(int64(bytes)) || bytes <= 0 || bytes > 9007199254740991 || !ok5 || !sha256Hex.MatchString(sum) || !ok6 || !ok7 {
		return nil
	}
	if _, ok := parseTime(made); !ok {
		return nil
	}
	if _, ok := parseTime(expires); !ok {
		return nil
	}
	return &fileMeta{Ask: ask, ID: id, Name: name, Bytes: int64(bytes), SHA256: sum, MadeAt: made, ExpiresAt: expires}
}

// fileState is what the owner's page shows: nothing, a file ready to take (until when), or one that was taken or ran out (a new ask makes a new one). Field order is TypeScript's.
type fileState struct {
	State     string `json:"state"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Bytes     *int64 `json:"bytes,omitempty"`
	ExpiresAt string `json:"expiresAt,omitempty"`
}

func (r *Runtime) usedFile() string { return filepath.Join(r.o.Client.Config.DataDir, ownerFileUsed) }

// usedIDs is the used-file read as TypeScript reads it: a JSON array of ids, in order (a Set drops a repeat); anything else is an empty list.
func (r *Runtime) usedIDs() []string {
	b, err := os.ReadFile(r.usedFile())
	var list []any
	if err != nil || json.Unmarshal(b, &list) != nil {
		return nil
	}
	seen, out := map[string]bool{}, []string{}
	for _, v := range list {
		if s, ok := v.(string); ok && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func (r *Runtime) fileMetaNow() *fileMeta {
	b, err := os.ReadFile(filepath.Join(r.o.Client.Folder, ownerFileMeta))
	if err != nil {
		return nil
	}
	return readFileMeta(b)
}

func (r *Runtime) ownerFileState(m *fileMeta, used []string) fileState {
	if m == nil {
		return fileState{State: "none"}
	}
	for _, u := range used {
		if u == m.ID {
			return fileState{State: "taken"}
		}
	}
	if exp, _ := parseTime(m.ExpiresAt); time.UnixMilli(r.o.Now()).After(exp) || time.UnixMilli(r.o.Now()).Equal(exp) {
		return fileState{State: "expired"}
	}
	return fileState{State: "ready", ID: m.ID, Name: m.Name, Bytes: &m.Bytes, ExpiresAt: m.ExpiresAt}
}

// takeOwnerFile gives the bytes for this id, once; nil when the id is not the file now, it was taken, it ran out, or the bytes do not match (owner-file.ts `take`).
func (r *Runtime) takeOwnerFile(id string) (*fileMeta, []byte, error) {
	// TypeScript is one thread, so its check-then-mark is whole; here two requests could both pass the check, so one goes at a time
	r.routes.fileMu.Lock()
	defer r.routes.fileMu.Unlock()
	m := r.fileMetaNow()
	used := r.usedIDs()
	if m == nil || m.ID != id || r.ownerFileState(m, used).State != "ready" {
		return nil, nil, nil
	}
	body, err := os.ReadFile(filepath.Join(r.o.Client.Folder, ownerFileBody))
	if err != nil {
		return nil, nil, nil
	}
	if sum := sha256.Sum256(body); int64(len(body)) != m.Bytes || hex.EncodeToString(sum[:]) != m.SHA256 {
		return nil, nil, nil
	}
	// the use is on disk before a byte leaves
	used = append(used, id)
	if len(used) > 50 {
		used = used[len(used)-50:]
	}
	text, _ := json.Marshal(used)
	tmp := r.usedFile() + ".tmp"
	if err := os.WriteFile(tmp, text, 0o600); err != nil {
		return nil, nil, err
	}
	if err := os.Rename(tmp, r.usedFile()); err != nil {
		return nil, nil, err
	}
	return m, body, nil
}

// ownerFileRoute: the owner's SESSION only (a link made in the panel is the Operator's to hold and opens nothing here). No `take`: the state, for the owner's page. With ?take=<id>: the
// bytes, once.
func (s *Server) ownerFileRoute(w http.ResponseWriter, r *http.Request) error {
	if err := only(r, "GET"); err != nil {
		return err
	}
	session := r.Header.Get(access.OwnerSessionHeader)
	rt := s.rt
	if session == "" || !rt.SessionOK(session) {
		send(w, 403, errBody("The owner's session is not valid."))
		return nil
	}
	takes, asked := r.URL.Query()["take"]
	if !asked {
		send(w, 200, rt.ownerFileState(rt.fileMetaNow(), rt.usedIDs()))
		return nil
	}
	if !ownerFileID.MatchString(takes[0]) {
		return nothing
	}
	m, body, err := rt.takeOwnerFile(takes[0])
	if err != nil {
		return err
	}
	if m == nil {
		return nothing
	}
	rt.recordFileTaken(session, m.Ask)
	h := w.Header()
	h.Set("content-type", "application/gzip")
	h.Set("content-disposition", fmt.Sprintf(`attachment; filename="%s"`, m.Name))
	h.Set("content-length", fmt.Sprint(len(body)))
	h.Set("cache-control", "no-store")
	h.Set("x-content-type-options", "nosniff")
	_, _ = w.Write(body)
	return nil
}

// recordFileTaken saves the owner_access event that says the file was taken (the step below writes its record line). The session is named by its short id, never its secret.
func (r *Runtime) recordFileTaken(token, ask string) {
	short := ""
	if w, ok := r.who(); ok {
		short, _ = r.o.Access.Check(token, w, r.o.Now(), r.endBefore())
	}
	ev := map[string]any{"kind": "owner_access", "id": newUUID(), "what": "file_taken", "session": short}
	if ask != "" {
		ev["ask"] = ask
	}
	if _, _, err := r.Submit([]map[string]any{ev}); err != nil {
		r.o.Log("The owner's taking of their file could not be written to the record: " + err.Error())
	}
	r.Kick()
}

// fileTakenStep is modules/channels/owner-signin.ts's `file_taken` branch of an owner_access event: the record line the deployer reads to delete its copy. True when the event was this kind.
func (r *Runtime) fileTakenStep(rec *recorder, ev map[string]any) bool {
	if ev["what"] != "file_taken" {
		return false
	}
	number, lang := r.owner()
	ask, _ := ev["ask"].(string)
	session, _ := ev["session"].(string)
	rec.append(NewLine{Conversation: number, Action: fileTaken, Outcome: "confirmed", Inputs: map[string]any{"ask": ask}, Language: lang, Refs: map[string]string{"ask": ask, "session": session},
		Notes: "the owner's session took the file of their shop; the server's copy is deleted"})
	return true
}
