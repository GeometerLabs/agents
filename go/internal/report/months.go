// Months, for every report: modules/report/months.ts. "2026-11" in a time zone as [from, to) in epoch milliseconds, and the one folder a report is written into.
package report

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

var monthRe = regexp.MustCompile(`^(\d{4})-(0[1-9]|1[0-2])$`)

// MonthRange is monthRange: "2026-11" in a time zone as [from, to) in epoch milliseconds.
func MonthRange(month, timeZone string) (from, to int64, err error) {
	m := monthRe.FindStringSubmatch(month)
	if m == nil {
		return 0, 0, fmt.Errorf(`"%s" is not a month. Write it like 2026-11.`, month)
	}
	year, _ := strconv.Atoi(m[1])
	mon, _ := strconv.Atoi(m[2])
	next := zone.Date{Year: year, Month: mon + 1, Day: 1}
	if mon == 12 {
		next = zone.Date{Year: year + 1, Month: 1, Day: 1}
	}
	return zone.ZonedToMs(zone.Date{Year: year, Month: mon, Day: 1}, 0, 0, timeZone), zone.ZonedToMs(next, 0, 0, timeZone), nil
}

// OutFolder is outFolder: the folder a report is written into, made if it is not there, and an error if the name is a file.
func OutFolder(out string) (string, error) {
	dir, err := filepath.Abs(out)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(dir)
	switch {
	case err == nil:
		if !st.IsDir() {
			return "", fmt.Errorf("%s is a file, not a folder. Name a folder for --out.", out)
		}
	case errors.Is(err, os.ErrNotExist):
		if err := os.MkdirAll(dir, 0o777); err != nil {
			return "", err
		}
	default:
		return "", err
	}
	return dir, nil
}

// Writer writes files into the one folder; a file name is a plain name and never a path (writer).
type Writer struct {
	Dir   string
	Files []string // the paths written, in order
}

// NewWriter is writer(out).
func NewWriter(out string) (*Writer, error) {
	dir, err := OutFolder(out)
	if err != nil {
		return nil, err
	}
	return &Writer{Dir: dir}, nil
}

// Write writes content as UTF-8 into the folder.
func (w *Writer) Write(name, content string) error {
	if strings.ContainsAny(name, `\/`) || strings.HasPrefix(name, ".") {
		return fmt.Errorf(`"%s" is not a plain file name.`, name)
	}
	path := filepath.Join(w.Dir, name)
	if err := os.WriteFile(path, []byte(content), 0o666); err != nil {
		return err
	}
	w.Files = append(w.Files, path)
	return nil
}
