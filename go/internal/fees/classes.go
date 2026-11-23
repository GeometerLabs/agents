package fees

// Classes' reading material (server/materials.ts, the parent's private page "/m/<batch>"): the teacher's own files on the centre's own server, handed out only to a private link
// whose parent has a student in the batch who may open it now (classes/view.ts materialView, judged from the SAVED fees). The rest of Classes is classes_run.go.

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

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

// mayOpen is view.ts materialView's rule for one student: checkClassAccess over the SAVED fees (a page open cannot call the payments service).
func (k *Kit) mayOpen(st *Store, x Student) bool {
	s := k.Settings
	consent := "waiting"
	if x.Adult {
		consent = "adult"
	} else if cs := st.classesRead(); cs != nil && cs.Consent[x.Parent] != nil && cs.Consent[x.Parent].Answer != "" {
		consent = cs.Consent[x.Parent].Answer
	}
	var fees []feeSnap
	for _, d := range st.Dues {
		if d.Customer == x.Parent && d.StudentName == x.Name {
			fees = append(fees, feeSnap{d.State, d.DueDate, balancePaise(d), d.BackDue})
		}
	}
	return checkClassAccess(true, consent, true, fees, s.Due.GraceDays, s.Classes.OldDuesStopLink, k.now(), s.Timezone).Verdict == "allow"
}
