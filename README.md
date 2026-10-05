# Nihongo

Personal app to learn Japanese from zero, for two learners, served at https://nihongo.matthv.com.
Version 1 covers hiragana and katakana (24 lessons, about 220 kana and 230 words) with spaced repetition and audio.

- `www/` is served as is (static, no build step). Progress lives in localStorage and syncs through the server.
- `www/kana.js` holds the course (`LESSONS`: kana, words, notes, intros) and the romaji tools:
  `romaji()` (kana -> Hepburn) and `answerMatches()` (accepts Hepburn, Kunrei, macrons, `-` for ー, or kana typed
  with a Japanese keyboard; long o/e spelled おう/おお or えい/ええ count as the same).
- `www/app.js`: lessons are split into parts of at most 8 items; a part is learnt with a choice question then a
  typed one per item, after which each item becomes a card (Leitner boxes, `BOX_DAYS`, due dates by day).
  Reviews only move a card on its first answer of the session. A day counts toward the weekly goal at 10 answers.
- Audio is the browser's speech synthesis (`ja-JP` voice). Single kana are spoken in katakana so は is read "ha".
  Without a Japanese voice the listening exercises are hidden and the home page explains how to install one.
- Kana font: Klee One (Fontworks, OFL, `www/fonts/OFL.txt`), subset to kana only.

## Progress sync

`server/` is a small Go service (`nihongo-sync`, 127.0.0.1:8789, systemd unit `nihongo-sync`) behind `/api/progress`.
`~/.config/nihongo/tokens` has one `<name> <token>` line per learner (reread on every request); each learner has
`progress-<name>.json`, a JSON document with a version number. A stale write gets 409 and the page merges
(union, most recent answer per card, higher `epoch` wins after a reset or an import) then retries.
A device that receives another learner's code takes their progress as is instead of merging.
A browser gets its code once through `https://nihongo.matthv.com/?code=<token>` or the form in Réglages.

After changing the server: `cd server && ~/.local/go/bin/go test . && ~/.local/go/bin/go build -o nihongo-sync .`
then `sudo systemctl restart nihongo-sync`.

## Tools

- `outils/test.sh`: content checks (every word only uses kana already taught) and romaji conversion cases.
- `outils/devserver.py [port] [sync-port]`: serves `www/` and relays `/api/` to a local nihongo-sync.
- `outils/ui_test.py [url] [screenshot-dir]`: end-to-end run in headless Chrome with a fake Japanese voice
  (lesson, review, chart, sync, profile switch, no-voice mode). Start from empty progress files.
- `outils/icones.sh`: renders the home-screen icons.
- `outils/cdp.py`: minimal DevTools client used by the above (chrome-headless-shell, see `LD_LIBRARY_PATH` inside).
