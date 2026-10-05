package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	tokenA = "aaaaaaaaaaaaaaaaaaaa"
	tokenB = "bbbbbbbbbbbbbbbbbbbb"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	dir := t.TempDir()
	tok := filepath.Join(dir, "tokens")
	lines := "matthieu " + tokenA + "\n\n# comment\nbad/name cccccccccccccccccccc\nshort tok\nelle " + tokenB + "\n"
	if err := os.WriteFile(tok, []byte(lines), 0o600); err != nil {
		t.Fatal(err)
	}
	sv := &server{dir: dir, tokensPath: tok}
	return httptest.NewServer(http.HandlerFunc(sv.progress))
}

func do(t *testing.T, ts *httptest.Server, method, token, body string) (int, document) {
	t.Helper()
	req, _ := http.NewRequest(method, ts.URL, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var d document
	json.NewDecoder(res.Body).Decode(&d)
	return res.StatusCode, d
}

func TestAuth(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()
	for _, tok := range []string{"", "wrong-token-wrong-token", "cccccccccccccccccccc", "tok"} {
		if code, _ := do(t, ts, "GET", tok, ""); code != http.StatusUnauthorized {
			t.Errorf("token %q: got %d, want 401", tok, code)
		}
	}
	if _, d := do(t, ts, "GET", tokenB, ""); d.User != "elle" {
		t.Errorf("user = %q, want elle", d.User)
	}
}

func TestVersioningAndIsolation(t *testing.T) {
	ts := newTestServer(t)
	defer ts.Close()

	code, d := do(t, ts, "GET", tokenA, "")
	if code != 200 || d.Version != 0 || string(d.State) != "null" || d.User != "matthieu" {
		t.Fatalf("empty store: %d %+v", code, d)
	}
	if code, _ := do(t, ts, "PUT", tokenA, `{"base":0,"state":{"goal":4}}`); code != 200 {
		t.Fatalf("first put: %d", code)
	}
	code, d = do(t, ts, "PUT", tokenA, `{"base":0,"state":{"goal":5}}`)
	if code != http.StatusConflict || d.Version != 1 || !strings.Contains(string(d.State), `"goal":4`) {
		t.Fatalf("stale put: %d %+v", code, d)
	}
	if _, d := do(t, ts, "GET", tokenB, ""); d.Version != 0 || string(d.State) != "null" {
		t.Fatalf("other learner sees %+v", d)
	}
	for _, body := range []string{`{"base":1,"state":[]}`, `{"base":1}`, `nope`} {
		if code, _ := do(t, ts, "PUT", tokenA, body); code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", body, code)
		}
	}
	if code, _ := do(t, ts, "DELETE", tokenA, ""); code != http.StatusMethodNotAllowed {
		t.Errorf("delete: got %d", code)
	}
}
