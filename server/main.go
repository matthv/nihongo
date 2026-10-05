// Nihongo-sync stores each learner's progress so it follows them across devices.
// One JSON document per learner with a version number: a write based on a stale version gets 409 and the
// current document, so the page can merge and retry instead of overwriting another device's work.
package main

import (
	"bufio"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const maxBody = 2 << 20

var validName = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)

type document struct {
	Version int             `json:"version"`
	State   json.RawMessage `json:"state"`
	User    string          `json:"user,omitempty"`
}

type server struct {
	mu         sync.Mutex
	dir        string
	tokensPath string
}

// user rereads the tokens file on every request so learners can be added or tokens rotated without a restart.
// Each line is "<name> <token>"; the name picks the progress file.
func (sv *server) user(r *http.Request) (string, bool) {
	f, err := os.Open(sv.tokensPath)
	if err != nil {
		return "", false
	}
	defer f.Close()
	got := []byte(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	found := ""
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) != 2 || !validName.MatchString(fields[0]) || len(fields[1]) < 16 {
			continue
		}
		// No early exit: compare against every token so timing does not tell which line matched.
		if subtle.ConstantTimeCompare(got, []byte(fields[1])) == 1 {
			found = fields[0]
		}
	}
	return found, found != ""
}

func (sv *server) path(user string) string {
	return filepath.Join(sv.dir, "progress-"+user+".json")
}

func (sv *server) load(user string) (document, error) {
	var d document
	b, err := os.ReadFile(sv.path(user))
	if errors.Is(err, os.ErrNotExist) {
		return document{State: json.RawMessage("null")}, nil
	}
	if err != nil {
		return d, err
	}
	err = json.Unmarshal(b, &d)
	return d, err
}

func (sv *server) save(user string, d document) error {
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	tmp := sv.path(user) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, sv.path(user))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (sv *server) progress(w http.ResponseWriter, r *http.Request) {
	user, ok := sv.user(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	sv.mu.Lock()
	defer sv.mu.Unlock()

	current, err := sv.load(user)
	if err != nil {
		log.Printf("load %s: %v", user, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage"})
		return
	}
	current.User = user

	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, current)
	case http.MethodPut:
		var in struct {
			Base  int             `json:"base"`
			State json.RawMessage `json:"state"`
		}
		body := http.MaxBytesReader(w, r.Body, maxBody)
		if err := json.NewDecoder(body).Decode(&in); err != nil || len(in.State) == 0 || in.State[0] != '{' {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		if in.Base != current.Version {
			writeJSON(w, http.StatusConflict, current)
			return
		}
		next := document{Version: current.Version + 1, State: in.State}
		if err := sv.save(user, next); err != nil {
			log.Printf("save %s: %v", user, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "storage"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"version": next.Version, "user": user})
	default:
		w.Header().Set("Allow", "GET, PUT")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func main() {
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, ".config", "nihongo")
	addr := flag.String("addr", "127.0.0.1:8789", "listen address")
	data := flag.String("data", dir, "directory holding the progress files")
	tokens := flag.String("tokens", filepath.Join(dir, "tokens"), `file of "<name> <token>" lines`)
	flag.Parse()

	sv := &server{dir: *data, tokensPath: *tokens}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/progress", sv.progress)
	log.Printf("listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
