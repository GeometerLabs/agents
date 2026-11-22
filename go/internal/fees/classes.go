package fees

// Classes (a `classes` block in the settings: Fees grown with batches' class links, reading material, attendance and doubts): the parts the Go runtime has so far. The state is
// classes/state.ts ClassesState, kept field for field (the store's `classes` member is carried raw until a step types it, so a centre that moves between the runtimes loses
// nothing). The reading material (server/materials.ts, the parent's private page) is served here; the class link, the consent question, the attendance, the missed-class note
// and the doubts (classes/run.ts) are NOT ported yet: the beat does no Classes work on Go, a parent's class words and the teacher's commands are left to the fee reading as a
// centre without Classes reads them, and the owner's page shows no Classes section's waiting work (Deferred.md says so, with the contract tests that wait on it).

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// ClassesState is classes/state.ts ClassesState; Extra is any member a later version adds.
type ClassesState struct {
	BatchLinks     map[string]string  `json:"batchLinks"`
	SessionLinks   map[string]string  `json:"sessionLinks"`
	Sessions       map[string]rawJSON `json:"sessions"`
	Consent        map[string]rawJSON `json:"consent"`
	Doubts         []rawJSON          `json:"doubts"`
	NextDoubt      int64              `json:"nextDoubt"`
	AwaitingDoubt  map[string]rawJSON `json:"awaitingDoubt"`
	DoubtsToldAtMs map[string]int64   `json:"doubtsToldAtMs"`
}

// classFacts are a class message's own facts (run.ts ClassFacts).
type classFacts struct{}

func (c *classFacts) apply(*MessageFacts) {}

// classesTick is classes/run.ts onTick: not ported (see the file's comment).
func (a *Agent) classesTick() error { return nil }

// classesContact is run.ts onContact: not ported; the fee reading goes on as for a centre without Classes.
func (a *Agent) classesContact(messaging.InboundMessage) (bool, error) { return false, nil }

// classesTeacher is run.ts onTeacher: not ported.
func (a *Agent) classesTeacher(messaging.InboundMessage) (bool, error) { return false, nil }

// classesPageAction is run.ts onPageAction: not ported, so nothing the page shows is waiting.
func (a *Agent) classesPageAction(string, string, string) (bool, error) { return false, nil }

// ownerClassesView is classes/view.ts ownerClassesView with no class work ported: nothing waits.
func ownerClassesView(*Settings, *Store, int64) any {
	return map[string]any{"pending": []any{}, "doubts": []any{}}
}

// ---- the reading material (server/materials.ts) ----

// MaterialTypes is materials.ts MATERIAL_TYPES: the kinds handed out, by extension, with the type the download carries.
var MaterialTypes = map[string]string{
	"pdf": "application/pdf", "txt": "text/plain; charset=utf-8", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
	"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

var materialBatch = regexp.MustCompile(`^[a-z0-9-]+$`)

type materialFile struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"`
	typ   string
	path  string
}

// materialID is materials.ts idOf: the hash of a name found in the folder, never a path.
func materialID(name string) string {
	s := sha256.Sum256([]byte(name))
	return hex.EncodeToString(s[:])[:12]
}

// scanMaterials is materials.ts scan: only regular files of the kinds handed out, no larger than the centre's limit; the rest are counted as left out. Names sorted as
// JavaScript's default sort does (by UTF-16 units; equal to byte order for the BMP names a folder has).
func scanMaterials(dir, batch string, maxBytes int64) ([]materialFile, int) {
	if !materialBatch.MatchString(batch) {
		return nil, 0
	}
	folder := filepath.Join(dir, batch)
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil, 0
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	var files []materialFile
	left := 0
	for _, name := range names {
		if strings.HasPrefix(name, ".") {
			continue
		}
		path := filepath.Join(folder, name)
		st, err := os.Lstat(path)
		if err != nil || !st.Mode().IsRegular() {
			continue
		}
		ext := ""
		if i := strings.LastIndex(name, "."); i >= 0 {
			ext = strings.ToLower(name[i+1:])
		} else {
			ext = strings.ToLower(name)
		}
		typ, ok := MaterialTypes[ext]
		if !ok || st.Size() > maxBytes || st.Size() == 0 {
			left++
			continue
		}
		files = append(files, materialFile{ID: materialID(name), Name: name, Bytes: st.Size(), typ: typ, path: path})
	}
	return files, left
}

// material is runtime.ts's channel.material with classes/view.ts materialView: the link's parent must have a student in the batch who may open it now (in the batch, an adult
// or a parent who agreed, every ordinary fee paid or within its grace days, from the SAVED fees); only then is the folder read.
func (k *Kit) material(st *Store, linkHash, batch, file string) any {
	s := k.Settings
	if s.Classes == nil || k.MaterialsDir == "" {
		return nil
	}
	parent := st.parentOf(linkHash)
	if parent == "" {
		return nil
	}
	var entitled []string
	for _, x := range s.Students {
		if x.Parent != parent || x.BatchID != batch {
			continue
		}
		if k.mayOpen(st, x) {
			entitled = append(entitled, x.Name)
		}
	}
	if len(entitled) == 0 {
		return nil
	}
	maxBytes := s.Classes.MaterialMaxMb * 1024 * 1024
	files, left := scanMaterials(k.MaterialsDir, batch, maxBytes)
	if file == "" {
		list := make([]map[string]any, len(files))
		for i, f := range files {
			list[i] = map[string]any{"id": f.ID, "name": f.Name, "bytes": f.Bytes}
		}
		return map[string]any{"kind": "list", "batch": batchNames(s, batch), "students": entitled, "files": list, "left": left, "maxMb": s.Classes.MaterialMaxMb}
	}
	for _, f := range files {
		if f.ID == file {
			b, err := os.ReadFile(f.path)
			if err != nil {
				return nil
			}
			return map[string]any{"kind": "file", "name": f.Name, "type": f.typ, "base64": base64.StdEncoding.EncodeToString(b)}
		}
	}
	return nil
}

// mayOpen is rules.ts checkClassAccess for the material page: in the batch, consent (an adult needs none), and no ordinary fee past its grace days (a back due only when the centre
// set oldDuesStopLink). The consent answers are classes state, which is read raw here.
func (k *Kit) mayOpen(st *Store, x Student) bool {
	s := k.Settings
	if !x.Adult && !consentYes(st, x.Parent) {
		return false
	}
	now := k.now()
	for _, d := range st.Dues {
		if d.Customer != x.Parent || d.StudentName != x.Name {
			continue
		}
		if d.BackDue && !s.Classes.OldDuesStopLink {
			continue
		}
		if d.State == Open && balancePaise(d) > 0 && now >= graceEnd(s, d) {
			return false
		}
	}
	return true
}

// consentYes: the contact answered yes to the consent question (classes state `consent[phone].answer`).
func consentYes(st *Store, phone string) bool {
	var c struct {
		Consent map[string]struct {
			Answer string `json:"answer"`
		} `json:"consent"`
	}
	if st.Classes == nil || jsonUnmarshal(st.Classes, &c) != nil {
		return false
	}
	return c.Consent[phone].Answer == "yes"
}

type rawJSON = json.RawMessage

var jsonUnmarshal = json.Unmarshal

// graceEnd is rules.ts isPastGrace's boundary: the start of the day after due date + grace days (as addLateFee counts).
func graceEnd(s *Settings, d *Due) int64 {
	return zone.ZonedToMs(zone.AddDays(zdate(d.DueDate), int(s.Due.GraceDays)+1), 0, 0, s.Timezone)
}
