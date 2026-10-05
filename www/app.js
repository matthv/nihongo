'use strict';

const STORE_KEY = 'nihongo:v1';
const PREFS_KEY = 'nihongo:prefs';
const BOX_DAYS = [0, 1, 2, 4, 7, 14, 30, 60, 120];
const DAY_MIN_ANSWERS = 10;
const REVIEW_BATCH = 40;
const PART_MAX = 8;

// ---------- Storage ----------

function defaults() {
  return { epoch: 0, name: '', nameT: 0, goal: 4, goalT: 0, lessons: {}, cards: {}, days: {} };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
  } catch {
    return defaults();
  }
}

const state = load();

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode: progress lives in memory only */ }
  sync.schedule();
}

function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, defaults(), next);
}

const prefs = (() => {
  const base = { voice: '', slow: false, listen: true };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return base; }
})();
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ---------- Merge (several devices) ----------

function newer(a, b, key = 't') { return (a?.[key] || 0) >= (b?.[key] || 0) ? a : b; }

// Union of both progressions; per card, the most recent answer wins. A reset or an import bumps
// the epoch, and the higher epoch replaces the other side entirely so the old progress does not come back.
function merge(a, b) {
  a = { ...defaults(), ...a };
  b = { ...defaults(), ...b };
  if (a.epoch !== b.epoch) {
    const winner = a.epoch > b.epoch ? a : b;
    return merge(winner, winner);
  }
  const n = newer(a, b, 'nameT');
  const g = newer(a, b, 'goalT');
  const out = { ...defaults(), epoch: a.epoch, name: n.name, nameT: n.nameT, goal: g.goal, goalT: g.goalT };
  for (const id of new Set([...Object.keys(a.lessons), ...Object.keys(b.lessons)])) {
    out.lessons[id] = { parts: Math.max(a.lessons[id]?.parts || 0, b.lessons[id]?.parts || 0) };
  }
  for (const id of new Set([...Object.keys(a.cards), ...Object.keys(b.cards)])) {
    out.cards[id] = { ...newer(a.cards[id], b.cards[id]) };
  }
  // Both devices count the same day: keep the larger count rather than adding them up.
  for (const d of new Set([...Object.keys(a.days), ...Object.keys(b.days)])) {
    out.days[d] = Math.max(a.days[d] || 0, b.days[d] || 0);
  }
  return out;
}

// ---------- Sync with the server ----------

const TOKEN_KEY = 'nihongo:token';
const VERSION_KEY = 'nihongo:syncVersion';
const USER_KEY = 'nihongo:user';

const sync = {
  token: null,
  version: 0,
  user: null,
  timer: null,
  busy: null,
  status: 'off', // off | ok | error | unauthorized
  lastAt: null,
  listeners: new Set(),

  init() {
    try {
      const url = new URL(location.href);
      const code = url.searchParams.get('code');
      if (code) {
        localStorage.setItem(TOKEN_KEY, code.trim());
        url.searchParams.delete('code');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
      this.token = localStorage.getItem(TOKEN_KEY);
      this.version = +(localStorage.getItem(VERSION_KEY) || 0);
      this.user = localStorage.getItem(USER_KEY);
    } catch { /* storage unavailable: no sync */ }
  },

  setStatus(s) {
    this.status = s;
    if (s === 'ok') this.lastAt = new Date();
    this.listeners.forEach(f => f());
  },

  async request(method, body) {
    const payload = body ? JSON.stringify(body) : undefined;
    const res = await fetch('api/progress', {
      method,
      headers: { Authorization: 'Bearer ' + this.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: payload,
      // keepalive lets the last save survive closing the tab, but browsers cap it at 64 KB.
      keepalive: document.visibilityState === 'hidden' && (payload?.length || 0) < 60000,
    });
    if (res.status === 401) { this.setStatus('unauthorized'); throw new Error('unauthorized'); }
    if (res.status !== 200 && res.status !== 409) throw new Error('HTTP ' + res.status);
    return { status: res.status, data: await res.json() };
  },

  remember(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
  },

  setVersion(v) {
    this.version = v;
    this.remember(VERSION_KEY, v);
  },

  setUser(u) {
    this.user = u;
    this.remember(USER_KEY, u);
  },

  applyRemote(remote) {
    const merged = merge(state, remote || {});
    const changed = JSON.stringify(merged) !== JSON.stringify(state);
    replaceState(merged);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    return { changed, differsFromRemote: !remote || JSON.stringify(merged) !== JSON.stringify(merge(remote, remote)) };
  },

  // Pull, merge, and push back if the merge holds something the server lacks. Returns true if local state changed.
  async pull() {
    if (!this.token) return false;
    if (this.busy) return this.busy;
    this.busy = (async () => {
      try {
        const { data } = await this.request('GET');
        this.setVersion(data.version);
        // Another learner's code on this device: take their progress as is, never mix two people's cards.
        if (this.user && data.user && data.user !== this.user) {
          replaceState(data.state || {});
          try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
          this.setUser(data.user);
          if (!data.state) await this.push();
          else this.setStatus('ok');
          return true;
        }
        if (data.user) this.setUser(data.user);
        const { changed, differsFromRemote } = this.applyRemote(data.state);
        if (differsFromRemote) await this.push();
        else this.setStatus('ok');
        return changed;
      } catch (e) {
        if (this.status !== 'unauthorized') this.setStatus('error');
        return false;
      } finally {
        this.busy = null;
      }
    })();
    return this.busy;
  },

  async push() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { status, data } = await this.request('PUT', { base: this.version, state });
      if (status === 200) { this.setVersion(data.version); this.setStatus('ok'); return; }
      this.setVersion(data.version);
      this.applyRemote(data.state);
    }
    throw new Error('conflits répétés');
  },

  schedule() {
    if (!this.token) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1500);
  },

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.token) return;
    if (this.busy) await this.busy;
    try { await this.push(); } catch { if (this.status !== 'unauthorized') this.setStatus('error'); }
  },

  setToken(token) {
    this.token = token || null;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }
    this.setStatus(token ? 'error' : 'off');
  },
};

// ---------- Dates ----------

function isoDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseDay(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); }
function mondayOf(s) { const d = parseDay(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoDay(d); }
function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }

// ---------- Audio ----------

const tts = {
  voices: [],
  listeners: new Set(),

  init() {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      this.voices = speechSynthesis.getVoices().filter(v => /^ja([-_]|$)/i.test(v.lang));
      this.listeners.forEach(f => f());
    };
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  },

  get available() { return this.voices.length > 0; },

  // Google voices sound the most natural on Chrome and Android, Kyoko on Apple devices.
  voice() {
    return this.voices.find(v => v.voiceURI === prefs.voice)
      || this.voices.find(v => /google/i.test(v.name))
      || this.voices.find(v => /kyoko/i.test(v.name))
      || this.voices.find(v => v.localService)
      || this.voices[0];
  },

  speak(text, rate) {
    if (!this.available) return Promise.resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.voice = this.voice();
    u.rate = rate || (prefs.slow ? 0.6 : 0.85);
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 4000);
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  },
};

// Single kana go through katakana so は is read "ha", not the particle "wa".
function say(item) {
  return tts.speak(item.type === 'kana' ? toKata(item.kana) : item.kana);
}

function canListen() { return prefs.listen && tts.available; }

// ---------- Helpers ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function setView(node, nav) {
  const view = document.getElementById('view');
  view.replaceChildren(node);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
  window.scrollTo(0, 0);
}

function shuffle(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function chunk(list, max) {
  if (!list.length) return [];
  const n = Math.ceil(list.length / max);
  const size = Math.ceil(list.length / n);
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const ICON_SOUND = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';

function soundButton(item, cls = '') {
  if (!tts.available) return '';
  return `<button type="button" class="sound ${cls}" data-say="${esc(item.id)}" aria-label="Écouter">${ICON_SOUND}</button>`;
}

// One delegated listener for every speaker button on the page.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-say]');
  if (b) { e.preventDefault(); say(ITEMS.get(b.dataset.say)); }
});

// ---------- Progress ----------

function lessonParts(lesson) {
  const kana = lesson.items.filter(i => i.type === 'kana');
  const words = lesson.items.filter(i => i.type === 'word');
  return [...chunk(kana, PART_MAX), ...chunk(words, PART_MAX)];
}

function partsDone(lesson) { return state.lessons[lesson.id]?.parts || 0; }
function lessonDone(lesson) { return partsDone(lesson) >= lessonParts(lesson).length; }
function nextLesson() { return LESSONS.find(l => !lessonDone(l)) || null; }
function lessonOpen(lesson) { const next = nextLesson(); return !next || lesson.n <= next.n; }

function dueCards(day = isoDay()) {
  return Object.entries(state.cards)
    .filter(([id, c]) => ITEMS.has(id) && c.due <= day)
    .sort(([, a], [, b]) => a.due < b.due ? -1 : a.due > b.due ? 1 : a.b - b.b)
    .map(([id]) => ITEMS.get(id));
}

function nextDue() {
  const today = isoDay();
  const future = Object.entries(state.cards).filter(([id, c]) => ITEMS.has(id) && c.due > today).map(([, c]) => c.due).sort();
  if (!future.length) return null;
  return { day: future[0], count: future.filter(d => d === future[0]).length };
}

function schedule(id, correct) {
  const today = isoDay();
  const c = state.cards[id] || { b: 0, n: 0, ko: 0 };
  c.b = correct ? Math.min((c.b || 0) + 1, BOX_DAYS.length - 1) : 1;
  c.due = addDays(today, correct ? BOX_DAYS[c.b] : 1);
  c.n = (c.n || 0) + 1;
  if (!correct) c.ko = (c.ko || 0) + 1;
  c.t = Date.now();
  state.cards[id] = c;
}

function countAnswer() {
  const d = isoDay();
  state.days[d] = (state.days[d] || 0) + 1;
}

function weekStats() {
  const monday = mondayOf(isoDay());
  const done = Object.entries(state.days).filter(([d, n]) => d >= monday && n >= DAY_MIN_ANSWERS).length;
  return { done, goal: state.goal };
}

function learnedCount(type, script) {
  return [...ITEMS.values()].filter(i => i.type === type && (!script || i.script === script) && state.cards[i.id]).length;
}

function updateBadge() {
  const n = dueCards().length;
  const el = document.getElementById('due-badge');
  el.textContent = n;
  el.hidden = n === 0;
}

// ---------- Exercises ----------

const TYPE_LABELS = { read: 'Lecture', pick: 'Choix', listen: 'Écoute', meaning: 'Sens' };

function exerciseTypes(item) {
  const choice = item.type === 'kana' ? 'pick' : 'meaning';
  return canListen() ? ['read', choice, 'listen'] : ['read', choice];
}

function randomType(item) {
  const types = exerciseTypes(item);
  const weights = { read: 4, pick: 2.5, meaning: 2.5, listen: 3.5 };
  let r = Math.random() * types.reduce((s, t) => s + weights[t], 0);
  for (const t of types) { r -= weights[t]; if (r <= 0) return t; }
  return types[0];
}

function distractors(item, n = 3) {
  const lesson = LESSONS.find(l => l.id === item.lesson);
  const key = soundKey(item.kana);
  const ok = o => o.id !== item.id && o.type === item.type && o.script === item.script
    && soundKey(o.kana) !== key && (item.type !== 'word' || o.meaning !== item.meaning);
  const all = [...ITEMS.values()].filter(ok);
  const seen = all.filter(o => state.cards[o.id] || o.lesson === item.lesson);
  // Same-lesson kana first: telling neighbours apart is the actual skill.
  const sameLesson = item.type === 'kana' ? shuffle(seen.filter(o => o.lesson === item.lesson)).slice(0, 2) : [];
  const similar = o => item.type === 'kana' ? o.kana.length === item.kana.length : Math.abs(o.kana.length - item.kana.length) <= 1;
  let pool = [...sameLesson, ...shuffle(seen.filter(o => !sameLesson.includes(o) && similar(o))), ...shuffle(seen.filter(o => !similar(o)))];
  if (pool.length < n) {
    const near = all.filter(o => !pool.includes(o)).sort((a, b) =>
      Math.abs(LESSONS.find(l => l.id === a.lesson).n - lesson.n) - Math.abs(LESSONS.find(l => l.id === b.lesson).n - lesson.n));
    pool = [...pool, ...near];
  }
  return pool.slice(0, n);
}

// Runs a queue of questions. Each entry needs `need` correct answers; a miss sends it back a few places later.
function runQuiz(node, { entries, onAnswer, onDone, quitTo = '#/' }) {
  const queue = [...entries];
  const total = entries.reduce((s, e) => s + e.need, 0);
  let answered = 0;
  const stats = { first: 0, items: entries.length, missed: [] };

  node.innerHTML = `
    <div class="quiz">
      <div class="qtop">
        <a class="quit" href="${quitTo}" aria-label="Quitter">✕</a>
        <div class="bar"><span></span></div>
      </div>
      <div class="qbody"></div>
    </div>`;
  const body = node.querySelector('.qbody');
  const bar = node.querySelector('.bar span');
  let keyHandler = null;
  const setKeys = f => {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = f;
    if (f) document.addEventListener('keydown', f);
  };
  // The listener must not outlive the quiz when the user navigates away.
  window.addEventListener('hashchange', () => setKeys(null), { once: true });

  const next = () => {
    bar.style.width = `${Math.round(100 * answered / total)}%`;
    const entry = queue.shift();
    if (!entry) { setKeys(null); onDone(stats); return; }
    ask(entry);
  };

  const ask = entry => {
    const { item } = entry;
    const type = entry.plan?.[entry.step || 0] || randomType(item);
    const isWord = item.type === 'word';
    let prompt, answerHtml;
    let options = null;
    if (type === 'read') {
      prompt = `<div class="big jp">${esc(item.kana)}</div><p class="ask">${isWord ? 'Comment se lit ce mot ?' : 'Comment se lit ce kana ?'}</p>`;
      answerHtml = `
        <form class="typed" autocomplete="off">
          <input class="romaji" type="text" placeholder="en romaji, ex. ${isWord ? 'neko' : 'ka'}" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="done" aria-label="Lecture en romaji">
          <div class="row"><button class="btn">Valider</button><button type="button" class="btn ghost dunno">Je ne sais pas</button></div>
        </form>`;
    } else {
      options = shuffle([item, ...distractors(item)]);
      if (type === 'pick') prompt = `<div class="big ro">${esc(item.ro)}</div><p class="ask">Quel kana se lit ainsi ?</p>`;
      else if (type === 'meaning') prompt = `<div class="big fr">${esc(item.meaning)}</div><p class="ask">Quel mot veut dire ça ?</p>`;
      else prompt = `<button type="button" class="play" aria-label="Réécouter">${ICON_SOUND}</button><p class="ask">${isWord ? 'Quel mot as-tu entendu ?' : 'Quel kana as-tu entendu ?'}</p>`;
      answerHtml = `<div class="choices ${isWord ? 'words' : ''}">${options.map((o, i) =>
        `<button type="button" class="choice jp" data-i="${i}"><kbd>${i + 1}</kbd>${esc(o.kana)}</button>`).join('')}</div>`;
    }
    body.innerHTML = `
      <p class="qtype">${TYPE_LABELS[type]}</p>
      <div class="prompt">${prompt}</div>
      <div class="answer">${answerHtml}</div>
      <div class="feedback" hidden></div>`;

    const play = body.querySelector('.play');
    if (play) {
      play.addEventListener('click', () => say(item));
      say(item);
    }

    let done = false;
    const finish = (correct, given) => {
      if (done) return;
      done = true;
      const first = !entry.tried;
      entry.tried = true;
      answered += correct ? 1 : 0;
      if (first && correct) stats.first++;
      if (!correct && !stats.missed.includes(item)) stats.missed.push(item);
      onAnswer?.(entry, correct, first);
      if (correct) {
        entry.need--;
        entry.step = (entry.step || 0) + 1;
        if (entry.need > 0) queue.splice(Math.min(queue.length, 3 + Math.floor(Math.random() * 3)), 0, entry);
      } else {
        queue.splice(Math.min(queue.length, 2 + Math.floor(Math.random() * 2)), 0, entry);
      }
      bar.style.width = `${Math.round(100 * answered / total)}%`;
      showFeedback(correct, given);
    };

    const showFeedback = (correct, given) => {
      const fb = body.querySelector('.feedback');
      const note = !correct && item.note ? `<p class="note">${esc(item.note)}</p>` : '';
      const givenHtml = !correct && given ? `<p class="given">Ta réponse : <span class="${isKana(given) ? 'jp' : ''}">${esc(given)}</span></p>` : '';
      fb.className = `feedback ${correct ? 'good' : 'bad'}`;
      fb.innerHTML = `
        <p class="verdict">${correct ? 'Bien joué !' : 'Pas tout à fait.'}</p>
        <div class="reveal">
          <span class="jp kana">${esc(item.kana)}</span>
          <span class="ro">${esc(item.ro)}</span>
          ${isWord ? `<span class="fr">${esc(item.meaning)}</span>` : ''}
          ${soundButton(item)}
        </div>
        ${givenHtml}${note}
        <button type="button" class="btn next">Continuer</button>`;
      fb.hidden = false;
      const nextBtn = fb.querySelector('.next');
      nextBtn.addEventListener('click', next);
      nextBtn.focus({ preventScroll: true });
      fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (type !== 'listen' || !correct) say(item);
      setKeys(e => { if (e.key === 'Enter' && e.target === document.body) { e.preventDefault(); next(); } });
    };

    if (options) {
      const buttons = [...body.querySelectorAll('.choice')];
      const choose = i => {
        if (done) return;
        const correct = options[i] === item;
        buttons.forEach((b, j) => {
          b.disabled = true;
          if (options[j] === item) b.classList.add('right');
          else if (j === i) b.classList.add('wrong');
        });
        finish(correct, null);
      };
      buttons.forEach((b, i) => b.addEventListener('click', () => choose(i)));
      setKeys(e => {
        if (done || e.ctrlKey || e.metaKey || e.altKey) return;
        const i = +e.key - 1;
        if (i >= 0 && i < buttons.length) { e.preventDefault(); choose(i); }
      });
    } else {
      const form = body.querySelector('form');
      const input = form.querySelector('input');
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (done) return;
        const v = input.value.trim();
        if (!v) { input.focus(); return; }
        const correct = answerMatches(v, item);
        input.disabled = true;
        input.classList.add(correct ? 'right' : 'wrong');
        form.querySelectorAll('button').forEach(b => b.disabled = true);
        finish(correct, v);
      });
      form.querySelector('.dunno').addEventListener('click', () => {
        input.disabled = true;
        form.querySelectorAll('button').forEach(b => b.disabled = true);
        finish(false, null);
      });
      setKeys(null);
      input.focus({ preventScroll: true });
    }
  };

  next();
}

function itemRow(item) {
  return `<li class="item">
    <span class="jp kana">${esc(item.kana)}</span>
    <span class="ro">${esc(item.ro)}</span>
    ${item.meaning ? `<span class="fr">${esc(item.meaning)}</span>` : ''}
    ${soundButton(item)}
    ${item.note ? `<p class="note">${esc(item.note)}</p>` : ''}
  </li>`;
}

function summaryHtml(stats, title) {
  const missed = stats.missed.length
    ? `<p>À revoir :</p><ul class="items compact">${stats.missed.map(itemRow).join('')}</ul>`
    : '<p>Aucune erreur, bravo !</p>';
  return `<div class="card done">
    <h1>${title}</h1>
    <p class="score"><b>${stats.first}</b> / ${stats.items} du premier coup</p>
    ${missed}
    <div class="row"><a class="btn" href="#/">Retour à l'accueil</a></div>
  </div>`;
}

// ---------- Views ----------

function weekHtml() {
  const { done, goal } = weekStats();
  const dots = Array.from({ length: Math.max(goal, done) }, (_, i) => `<span class="dot ${i < done ? 'on' : ''}"></span>`).join('');
  const msg = done >= goal ? 'Objectif de la semaine atteint !' : `${done} / ${goal} séances cette semaine`;
  return `<div class="week"><div class="dots">${dots}</div><span>${msg}</span></div>`;
}

function voiceWarning() {
  if (tts.available) return '';
  return `<div class="card warn">
    <p><b>Pas de voix japonaise sur cet appareil</b> : les exercices d'écoute sont désactivés.</p>
    <p class="small">iPhone : Réglages › Accessibilité › Contenu énoncé › Voix › Japonais.
    Android : Paramètres › Accessibilité › Synthèse vocale, puis installer le japonais.
    Sur ordinateur, Chrome et Safari en proposent une.</p>
  </div>`;
}

function viewHome() {
  const due = dueCards().length;
  const next = nextLesson();
  const later = nextDue();
  const hello = state.name ? `こんにちは, ${esc(state.name)} !` : 'こんにちは !';
  const kanaTotal = [...ITEMS.values()].filter(i => i.type === 'kana').length;
  const wordTotal = ITEMS.size - kanaTotal;

  let reviewCard;
  if (due) {
    reviewCard = `<div class="card primary">
      <h2>${due} révision${due > 1 ? 's' : ''} à faire</h2>
      <p>${due > REVIEW_BATCH ? `On en fait ${REVIEW_BATCH} par séance, les plus anciennes d'abord.` : 'Quelques minutes pour ancrer ce que tu as appris.'}</p>
      <a class="btn" href="#/revision">Réviser</a>
    </div>`;
  } else if (later) {
    const d = daysBetween(isoDay(), later.day);
    const when = d === 1 ? 'demain' : `dans ${d} jours`;
    reviewCard = `<div class="card"><h2>Rien à réviser</h2><p>Prochaines révisions ${when} (${later.count}).</p></div>`;
  } else reviewCard = '';

  let lessonCard;
  if (next) {
    const parts = lessonParts(next);
    const done = partsDone(next);
    const preview = parts[done].map(i => i.kana).slice(0, 8).join(' ');
    const label = parts[done][0].type === 'word' ? 'Vocabulaire' : 'Nouveaux kana';
    lessonCard = `<div class="card ${due ? '' : 'primary'}">
      <p class="eyebrow">${next.script === 'hira' ? 'Hiragana' : 'Katakana'} · leçon ${next.n + 1}${parts.length > 1 ? ` · partie ${done + 1}/${parts.length}` : ''}</p>
      <h2>${esc(next.title)}</h2>
      <p class="preview"><span class="small">${label} :</span> <span class="jp">${esc(preview)}</span></p>
      ${due > 20 ? '<p class="small">Conseil : fais d\'abord tes révisions.</p>' : ''}
      <a class="btn ${due ? 'ghost' : ''}" href="#/lecon/${next.id}">${done ? 'Continuer' : 'Commencer'}</a>
    </div>`;
  } else {
    lessonCard = `<div class="card"><h2>Kana terminés !</h2><p>Tous les hiragana et katakana sont vus. La suite arrive : vocabulaire et phrases du quotidien.</p></div>`;
  }

  const lessonList = script => LESSONS.filter(l => l.script === script).map(l => {
    const total = lessonParts(l).length;
    const done = partsDone(l);
    const status = done >= total ? 'done' : l === next ? 'current' : lessonOpen(l) ? '' : 'locked';
    const kana = l.kana ? l.kana.split(' ').slice(0, 5).join('') : l.words.slice(0, 2).map(w => w[0]).join(' ');
    const inner = `<span class="num">${l.n + 1}</span><span class="t">${esc(l.title)}</span><span class="jp k">${esc(kana)}</span>`;
    return status === 'locked'
      ? `<li class="lesson locked">${inner}</li>`
      : `<li class="lesson ${status}"><a href="#/lecon/${l.id}">${inner}</a></li>`;
  }).join('');

  setView(h(`<div>
    <h1 class="hello jp-mixed">${hello}</h1>
    ${weekHtml()}
    ${voiceWarning()}
    ${reviewCard}
    ${lessonCard}
    <div class="stats">
      <div><b>${learnedCount('kana', 'hira')}</b><span>hiragana</span></div>
      <div><b>${learnedCount('kana', 'kata')}</b><span>katakana</span></div>
      <div><b>${learnedCount('word')}</b><span>mots / ${wordTotal}</span></div>
    </div>
    <h2 class="section">Parcours</h2>
    <h3 class="sub">Hiragana <span class="jp">ひらがな</span></h3>
    <ol class="lessons">${lessonList('hira')}</ol>
    <h3 class="sub">Katakana <span class="jp">カタカナ</span></h3>
    <ol class="lessons">${lessonList('kata')}</ol>
  </div>`), 'home');
}

function viewLesson(id) {
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson) return viewNotFound();
  if (!lessonOpen(lesson)) { location.hash = '#/'; return; }
  const parts = lessonParts(lesson);
  const done = partsDone(lesson);
  const finished = done >= parts.length;
  const part = finished ? lesson.items : parts[done];
  const kanaItems = part.filter(i => i.type === 'kana');
  const wordItems = part.filter(i => i.type === 'word');
  const intro = lesson.intro && (done === 0 || finished)
    ? `<div class="intro">${lesson.intro}</div>`
    : lesson.intro ? `<details class="intro"><summary>Rappel de la leçon</summary>${lesson.intro}</details>` : '';

  const node = h(`<div>
    <p class="eyebrow"><a href="#/">Accueil</a> · ${lesson.script === 'hira' ? 'Hiragana' : 'Katakana'} · leçon ${lesson.n + 1}</p>
    <h1>${esc(lesson.title)}</h1>
    ${parts.length > 1 && !finished ? `<p class="small">Partie ${done + 1} sur ${parts.length}</p>` : ''}
    ${intro}
    ${kanaItems.length ? `<h2 class="section">${finished ? 'Kana' : 'Nouveaux kana'}</h2><ul class="items cards">${kanaItems.map(itemRow).join('')}</ul>` : ''}
    ${wordItems.length ? `<h2 class="section">${finished ? 'Mots' : 'Nouveaux mots'}</h2><ul class="items">${wordItems.map(itemRow).join('')}</ul>` : ''}
    <div class="actions">
      ${finished
        ? `<a class="btn" href="#/entrainement/${lesson.id}">S'entraîner sur cette leçon</a><p class="small">L'entraînement ne change pas tes révisions.</p>`
        : `<button class="btn start">C'est parti</button><p class="small">${tts.available ? 'Touche un kana pour l\'entendre, puis lance les exercices.' : ''}</p>`}
    </div>
  </div>`);
  // Tapping the whole tile plays it: bigger target on a phone than the speaker icon.
  node.querySelectorAll('.cards .item').forEach(li => li.addEventListener('click', e => {
    if (!e.target.closest('[data-say]')) say(ITEMS.get(li.querySelector('[data-say]')?.dataset.say || ''));
  }));
  node.querySelector('.start')?.addEventListener('click', () => learnPart(lesson, done));
  setView(node, 'home');
}

// New items: a choice question first, then reading it unaided.
function learnPart(lesson, index) {
  const part = lessonParts(lesson)[index];
  const node = h('<div></div>');
  setView(node, 'home');
  const entries = shuffle(part).map(item => {
    const choice = item.type === 'kana' ? 'pick' : 'meaning';
    const first = canListen() && Math.random() < 0.5 ? 'listen' : choice;
    return { item, need: 2, plan: [first, 'read'] };
  });
  runQuiz(node, {
    entries,
    quitTo: `#/lecon/${lesson.id}`,
    onAnswer() { countAnswer(); save(); },
    onDone(stats) {
      for (const item of part) if (!state.cards[item.id]) schedule(item.id, true);
      state.lessons[lesson.id] = { parts: Math.max(partsDone(lesson), index + 1) };
      save();
      updateBadge();
      const parts = lessonParts(lesson);
      const more = index + 1 < parts.length;
      const nextL = nextLesson();
      node.innerHTML = summaryHtml(stats, more ? 'Partie terminée' : 'Leçon terminée');
      const row = node.querySelector('.row');
      const go = more ? [`#/lecon/${lesson.id}`, 'Partie suivante'] : nextL ? [`#/lecon/${nextL.id}`, 'Leçon suivante'] : null;
      if (go) {
        row.querySelector('.btn').classList.add('ghost');
        row.insertAdjacentHTML('afterbegin', `<a class="btn" href="${go[0]}">${go[1]}</a>`);
      }
      node.querySelector('.card').insertAdjacentHTML('beforeend', '<p class="small">Ces éléments reviendront demain dans tes révisions.</p>');
    },
  });
}

function viewReview() {
  const items = dueCards().slice(0, REVIEW_BATCH);
  if (!items.length) { location.hash = '#/'; return; }
  const node = h('<div></div>');
  setView(node, 'review');
  runQuiz(node, {
    entries: items.map(item => ({ item, need: 1 })),
    onAnswer(entry, correct, first) {
      // Only the first answer moves the card; the retries are there to fix the memory before leaving.
      if (first) schedule(entry.item.id, correct);
      countAnswer();
      save();
    },
    onDone(stats) {
      updateBadge();
      node.innerHTML = summaryHtml(stats, 'Révisions terminées');
      const left = dueCards().length;
      if (left) node.querySelector('.row').insertAdjacentHTML('afterbegin', `<a class="btn" href="#/revision">Encore ${Math.min(left, REVIEW_BATCH)}</a>`);
    },
  });
}

function viewPractice(id) {
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson || !lessonDone(lesson)) return viewNotFound();
  const node = h('<div></div>');
  setView(node, 'home');
  runQuiz(node, {
    entries: shuffle(lesson.items).map(item => ({ item, need: 1 })),
    quitTo: `#/lecon/${id}`,
    onAnswer() { countAnswer(); save(); },
    onDone(stats) {
      node.innerHTML = summaryHtml(stats, 'Entraînement terminé');
      node.querySelector('.row').insertAdjacentHTML('afterbegin', `<a class="btn ghost" href="#/entrainement/${id}">Recommencer</a>`);
    },
  });
}

function viewChart(script = 'hira') {
  const conv = script === 'kata' ? toKata : s => s;
  const cell = k => {
    if (k === '・') return '<span class="cell empty"></span>';
    const kana = conv(k);
    const item = ITEMS.get('k:' + kana);
    const known = item && state.cards[item.id];
    return `<button type="button" class="cell ${known ? 'known' : ''}" ${item && tts.available ? `data-say="${esc(item.id)}"` : ''}>
      <span class="jp">${esc(kana)}</span><span class="ro">${esc(romaji(kana))}</span></button>`;
  };
  const grid = (rows, size) => `<div class="grid g${size}">${rows.map(r =>
    (size === 3 ? r.match(/../g) : [...r]).map(cell).join('')).join('')}</div>`;
  const extra = script === 'kata'
    ? `<h2 class="section">Sons étrangers</h2><div class="grid g4">${['ファ', 'フィ', 'フェ', 'フォ', 'ティ', 'ディ', 'チェ', 'シェ', 'ジェ', 'ウィ', 'ウェ', 'ウォ'].map(k => {
      const item = ITEMS.get('k:' + k);
      return `<button type="button" class="cell ${state.cards[item.id] ? 'known' : ''}" ${tts.available ? `data-say="${esc(item.id)}"` : ''}><span class="jp">${k}</span><span class="ro">${esc(item.ro)}</span></button>`;
    }).join('')}</div>`
    : '';
  setView(h(`<div>
    <h1>Tableau des kana</h1>
    <div class="tabs">
      <a href="#/tableau" class="${script === 'hira' ? 'on' : ''}">Hiragana</a>
      <a href="#/tableau/katakana" class="${script === 'kata' ? 'on' : ''}">Katakana</a>
    </div>
    <p class="small">En couleur : les kana déjà appris.${tts.available ? ' Touche un kana pour l\'entendre.' : ''}</p>
    ${grid(CHART.base, 5)}
    <h2 class="section">Avec <span class="jp">゛</span> et <span class="jp">゜</span></h2>
    ${grid(CHART.voiced, 5)}
    <h2 class="section">Syllabes combinées</h2>
    ${grid(CHART.combo, 3)}
    ${extra}
  </div>`), 'chart');
}

function viewSettings() {
  const voices = tts.voices;
  const current = tts.voice();
  const node = h(`<div>
    <h1>Réglages</h1>

    <div class="card">
      <h2>Profil</h2>
      <label class="field">Prénom <input id="name" type="text" maxlength="30" value="${esc(state.name)}" autocomplete="given-name"></label>
      <label class="field">Objectif : séances par semaine
        <select id="goal">${[1, 2, 3, 4, 5, 6, 7].map(n => `<option ${n === state.goal ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </label>
      <p class="small">Une journée compte comme séance dès ${DAY_MIN_ANSWERS} réponses.</p>
    </div>

    <div class="card">
      <h2>Audio</h2>
      ${voices.length ? `
        <label class="field">Voix
          <select id="voice">${voices.map(v => `<option value="${esc(v.voiceURI)}" ${v === current ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
        </label>
        <label class="check"><input type="checkbox" id="slow" ${prefs.slow ? 'checked' : ''}> Parler lentement</label>
        <label class="check"><input type="checkbox" id="listen" ${prefs.listen ? 'checked' : ''}> Exercices d'écoute</label>
        <div class="row"><button class="btn ghost" id="test-voice">Tester : <span class="jp">こんにちは</span></button></div>
        <p class="small">Ces réglages ne valent que pour cet appareil.</p>`
        : voiceWarning()}
    </div>

    <div class="card" id="sync-card">
      <h2>Synchronisation</h2>
      <p>Ta progression suit ton code d'accès sur tous tes appareils. Chaque personne a le sien.</p>
      <p id="sync-status"></p>
      <div class="row" id="sync-on">
        <button class="btn" id="sync-now">Synchroniser maintenant</button>
        <button class="btn ghost" id="sync-off">Déconnecter cet appareil</button>
      </div>
      <form class="row" id="sync-form">
        <input type="password" id="sync-code" placeholder="Code d'accès" autocomplete="off">
        <button class="btn">Connecter</button>
      </form>
    </div>

    <div class="card">
      <h2>Sauvegarde</h2>
      <div class="row">
        <button class="btn ghost" id="export">Exporter (JSON)</button>
        <label class="btn ghost file">Importer<input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn danger" id="reset">Tout effacer</button>
      </div>
    </div>
    <p class="small credits">Police des kana : Klee One (Fontworks, licence OFL).</p>
  </div>`);

  node.querySelector('#name').addEventListener('change', e => {
    state.name = e.target.value.trim();
    state.nameT = Date.now();
    save();
  });
  node.querySelector('#goal').addEventListener('change', e => {
    state.goal = +e.target.value;
    state.goalT = Date.now();
    save();
  });
  node.querySelector('#voice')?.addEventListener('change', e => { prefs.voice = e.target.value; savePrefs(); tts.speak('こんにちは'); });
  node.querySelector('#slow')?.addEventListener('change', e => { prefs.slow = e.target.checked; savePrefs(); });
  node.querySelector('#listen')?.addEventListener('change', e => { prefs.listen = e.target.checked; savePrefs(); });
  node.querySelector('#test-voice')?.addEventListener('click', () => tts.speak('こんにちは'));

  const renderSync = () => {
    const el = node.querySelector('#sync-status');
    const time = sync.lastAt ? sync.lastAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    el.innerHTML = {
      off: 'Désactivée : la progression reste sur cet appareil.',
      ok: `<strong class="ok">Active</strong>${sync.user ? ` · profil <b>${esc(sync.user)}</b>` : ''}${time ? ` · synchronisé à ${time}` : ''}`,
      error: '<strong class="ko">Serveur injoignable</strong> pour l\'instant, nouvel essai à la prochaine réponse.',
      unauthorized: '<strong class="ko">Code refusé.</strong>',
    }[sync.status];
    node.querySelector('#sync-on').hidden = !sync.token;
    node.querySelector('#sync-form').hidden = !!sync.token && sync.status !== 'unauthorized';
  };
  sync.listeners.clear();
  sync.listeners.add(renderSync);
  renderSync();
  node.querySelector('#sync-now').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    await sync.pull();
    e.currentTarget.disabled = false;
  });
  node.querySelector('#sync-off').addEventListener('click', () => {
    if (confirm('Déconnecter cet appareil ? La progression déjà présente ici est conservée.')) { sync.setToken(null); renderSync(); }
  });
  node.querySelector('#sync-form').addEventListener('submit', async e => {
    e.preventDefault();
    const code = node.querySelector('#sync-code').value.trim();
    if (!code) return;
    if (sync.token && sync.status !== 'unauthorized') await sync.flush();
    sync.setToken(code);
    await sync.pull();
    renderSync();
    if (sync.status === 'ok') { node.querySelector('#name').value = state.name; updateBadge(); }
  });

  node.querySelector('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nihongo-${isoDay()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  node.querySelector('#import').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (typeof data !== 'object' || !data.cards) throw new Error('format');
      if (!confirm('Remplacer la progression actuelle par celle du fichier ?')) return;
      replaceState({ ...data, epoch: Date.now() });
      save();
      location.hash = '#/';
    } catch {
      alert('Fichier illisible.');
    }
  });
  node.querySelector('#reset').addEventListener('click', () => {
    if (!confirm('Effacer toute la progression, sur tous tes appareils ?')) return;
    replaceState({ epoch: Date.now(), name: state.name, nameT: state.nameT });
    save();
    location.hash = '#/';
  });
  setView(node, 'settings');
}

function viewNotFound() {
  setView(h('<div><h1>Page introuvable</h1><p><a href="#/">Retour à l\'accueil</a></p></div>'), '');
}

// ---------- Router ----------

function route() {
  const path = location.hash.replace(/^#\/?/, '');
  let m;
  updateBadge();
  if (path === '') viewHome();
  else if (path === 'revision') viewReview();
  else if (path === 'tableau') viewChart('hira');
  else if (path === 'tableau/katakana') viewChart('kata');
  else if (path === 'reglages') viewSettings();
  else if ((m = path.match(/^lecon\/([hk]\d{2})$/))) viewLesson(m[1]);
  else if ((m = path.match(/^entrainement\/([hk]\d{2})$/))) viewPractice(m[1]);
  else viewNotFound();
}

const inQuiz = () => !!document.querySelector('.quiz');

window.addEventListener('hashchange', route);

// "Next part" or "Again" link to the page already in the address bar: no hashchange fires, so route by hand.
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
});

// Another device may have moved on: refresh on return, but never under a running quiz.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    if (sync.timer) sync.flush();
    return;
  }
  const changed = await sync.pull();
  if (changed && !inQuiz()) route();
});

// Voices often arrive after the first render (Chrome loads them asynchronously).
tts.listeners.add(() => { if (!inQuiz()) route(); });

(async () => {
  sync.init();
  tts.init();
  if (sync.token) await Promise.race([sync.pull(), new Promise(r => setTimeout(r, 4000))]);
  route();
})();
