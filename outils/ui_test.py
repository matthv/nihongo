"""End-to-end check of the app in headless Chrome against outils/devserver.py, with a fake Japanese voice.
Usage: python3 outils/ui_test.py [base-url] [screenshot-dir]"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8797/'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
TOKEN_A, TOKEN_B = 'a' * 20, 'b' * 20

FAKE_TTS = '''
Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
  getVoices: () => [{ name: 'Google 日本語', lang: 'ja-JP', voiceURI: 'g', localService: false }],
  speak(u) { (window.__spoken = window.__spoken || []).push(u.text); setTimeout(() => u.onend && u.onend(), 5); },
  cancel() {}, addEventListener() {},
}});
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
'''

# Answers the question on screen, right or wrong, the way a learner would.
ANSWER = '''(right) => {
  const q = document.querySelector('.qbody');
  if (!q || !q.querySelector('.feedback[hidden]')) return 'none';
  const type = q.querySelector('.qtype').textContent;
  const items = [...ITEMS.values()];
  if (type === 'Lecture') {
    const kana = q.querySelector('.big').textContent;
    const it = items.find(i => i.kana === kana);
    q.querySelector('input').value = right ? it.ro : 'xyz';
    q.querySelector('form').requestSubmit();
    return 'read';
  }
  let target;
  if (type === 'Choix') target = o => romaji(o) === q.querySelector('.big').textContent || items.find(i => i.kana === o && i.ro === q.querySelector('.big').textContent);
  else if (type === 'Sens') target = o => items.find(i => i.kana === o && i.meaning === q.querySelector('.big').textContent);
  else { const said = window.__spoken[window.__spoken.length - 1]; target = o => toKata(o) === toKata(said); }
  const buttons = [...q.querySelectorAll('.choice')];
  const kana = b => b.childNodes[1].textContent;
  const good = buttons.find(b => target(kana(b)));
  (right ? good : buttons.find(b => b !== good)).click();
  return type;
}'''

def play(b, wrong_every=0, limit=400):
    n = 0
    while n < limit:
        r = b.js(f'({ANSWER})({ "false" if wrong_every and n % wrong_every == wrong_every - 1 else "true" })')
        if r == 'none':
            if b.js('!!document.querySelector(".done")'): return n
            raise SystemExit('stuck: ' + str(b.js('document.querySelector("main").innerText.slice(0, 300)')))
        n += 1
        b.js('document.querySelector(".feedback .next").click()')
    raise SystemExit('too many questions')

fails = []
def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond: fails.append(what)

def shot(b, name):
    if SHOTS: b.shot(os.path.join(SHOTS, name + '.png'), full=True)

if __name__ != '__main__':
    raise ImportError('run as a script')

b = Browser(width=390, height=844, mobile=True)
try:
    b.ws.call('Page.addScriptToEvaluateOnNewDocument', source=FAKE_TTS)
    b.go(BASE + '?code=' + TOKEN_A, wait=1.5)
    b.js('localStorage.clear()')
    b.go(BASE + '?code=' + TOKEN_A + '#/', wait=1.5)
    check('こんにちは' in b.js('document.querySelector("h1").textContent'), 'home renders')
    check(b.js('location.search') == '', 'code removed from the URL')
    shot(b, '1-home')

    b.go(BASE + '#/lecon/h01', wait=0.8)
    check(b.js('document.querySelectorAll(".cards .item").length') == 5, 'lesson h01 shows 5 kana')
    shot(b, '2-lesson')
    b.js('document.querySelector(".start").click()', wait=0.3)
    shot(b, '3-question')
    n = play(b, wrong_every=4)
    check(n >= 10, f'part 1 played ({n} answers)')
    shot(b, '4-summary')
    cards = b.js('JSON.stringify(state.cards)')
    check(len(json.loads(cards)) == 5, '5 cards scheduled')
    check(b.js('state.lessons.h01.parts') == 1, 'part 1 recorded')

    # Second part (words), then the lesson is done and h02 becomes next.
    b.js('[...document.querySelectorAll(".done a")].find(a => a.textContent === "Partie suivante").click()', wait=0.5)
    b.js('document.querySelector(".start").click()', wait=0.3)
    play(b)
    check(b.js('nextLesson().id') == 'h02', 'h02 is next')

    # Make everything due and review it, with a few misses.
    b.js('for (const c of Object.values(state.cards)) c.due = "2020-01-01"; save()')
    b.go(BASE + '#/', wait=0.5)
    check('révision' in b.js('document.querySelector(".card.primary h2").textContent'), 'reviews offered')
    b.go(BASE + '#/revision', wait=0.5)
    shot(b, '5-review')
    play(b, wrong_every=3)
    c = json.loads(b.js('JSON.stringify(state.cards)'))
    boxes = sorted(v['b'] for v in c.values())
    check(boxes.count(1) >= 1 and boxes.count(2) >= 1, f'boxes after review {boxes}')
    check(b.js('dueCards().length') == 0, 'nothing due after review')

    b.go(BASE + '#/tableau', wait=0.5)
    check(b.js('document.querySelectorAll(".cell.known").length') == 5, 'chart highlights learned kana')
    shot(b, '6-chart')
    b.go(BASE + '#/reglages', wait=0.5)
    b.js('const i = document.querySelector("#name"); i.value = "Matthieu"; i.dispatchEvent(new Event("change"))')
    time.sleep(2.5)
    check('Active' in b.js('document.querySelector("#sync-status").textContent'), 'sync active')
    shot(b, '7-settings')
    local = b.js('JSON.stringify(state)')

    # Second learner on the same browser: their (empty) progress replaces the first one.
    b.js(f'document.querySelector("#sync-off").hidden = true; document.querySelector("#sync-form").hidden = false; document.querySelector("#sync-code").value = "{TOKEN_B}"; document.querySelector("#sync-form").requestSubmit()', wait=2)
    check(b.js('Object.keys(state.cards).length') == 0 and b.js('state.name') == '', 'other learner starts empty')
    check(b.js('sync.user') == 'elle', 'profile switched')

    # Back to the first learner: progress comes back from the server.
    b.go(BASE + '?code=' + TOKEN_A + '#/', wait=2)
    check(b.js('Object.keys(state.cards).length') == 12 - 2 or b.js('Object.keys(state.cards).length') == len(c), 'first learner progress restored')
    check(b.js('state.name') == 'Matthieu', 'name restored')

    # No voice: listening exercises disappear and a hint shows.
    b.ws.call('Page.addScriptToEvaluateOnNewDocument', source='Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} } });')
    b.go(BASE + '?novoice#/', wait=1)
    check(b.js('!!document.querySelector(".card.warn")'), 'no-voice warning')
    check(b.js('exerciseTypes(ITEMS.get("k:あ")).includes("listen")') is False, 'no listening without voice')
finally:
    b.close()

print('\n' + ('ALL OK' if not fails else f'{len(fails)} FAIL'))
sys.exit(1 if fails else 0)
