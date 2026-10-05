'use strict';
// Content and conversion checks; run with outils/test.sh (headless Chrome).
(() => {
  const fails = [];
  const eq = (got, want, what) => { if (got !== want) fails.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

  // Every word only uses kana taught in its lesson or before.
  const known = new Set(['ー', 'っ', 'ッ']);
  const seenIds = new Set();
  for (const lesson of LESSONS) {
    for (const k of lesson.kana.split(' ').filter(Boolean)) {
      for (const c of k) known.add(c);
    }
    for (const it of lesson.items) {
      if (seenIds.has(it.id)) fails.push('duplicate ' + it.id);
      seenIds.add(it.id);
      if (it.type !== 'word') continue;
      for (const c of it.kana) if (!known.has(c)) fails.push(`${lesson.id} ${it.kana}: ${c} not taught yet`);
      if ((lesson.script === 'kata') !== /[ァ-ヺ]/.test(it.kana)) fails.push(`${lesson.id} ${it.kana}: wrong script`);
      if (!answerMatches(it.ro, it)) fails.push(`${it.kana}: own romaji ${it.ro} rejected`);
    }
  }

  const ro = {
    'あい': 'ai', 'しゃしん': 'shashin', 'きって': 'kitte', 'ちょっと': 'chotto', 'がっこう': 'gakkou', 'ケーキ': 'keeki',
    'コーヒー': 'koohii', 'ほんや': "hon'ya", 'きんえん': "kin'en", 'まっちゃ': 'matcha', 'パーティー': 'paatii',
    'ぎゅうにゅう': 'gyuunyuu', 'じゃあね': 'jaane', 'フォーク': 'fooku', 'はなぢ': 'hanaji', 'つづく': 'tsuzuku',
  };
  for (const [k, r] of Object.entries(ro)) eq(romaji(k), r, 'romaji ' + k);

  const accept = [
    ['しゃしん', ['shashin', 'syasin', 'SHASHIN', 'sha shin', 'しゃしん', 'シャシン']],
    ['こんにちは', ['konnichiwa', 'konnichiha', "kon'nichiwa"]],
    ['がっこう', ['gakkou', 'gakkō', 'gakkoo']],
    ['コーヒー', ['koohii', 'ko-hi-', 'kōhī', 'kouhii', 'こーひー', 'こおひい']],
    ['パーティー', ['paatii', 'pa-ti-', 'pātī']],
    ['まっちゃ', ['matcha', 'maccha', 'mattya']],
    ['ほん', ['hon', 'honn']],
    ['おんな', ['onna']],
    ['ちょっと', ['chotto', 'tyotto']],
    ['つづく', ['tsuzuku', 'tuduku', 'tsuduku']],
    ['ジェットコースター', ['jettokoosutaa', 'jettoko-suta-']],
    ['ぎゅうにゅう', ['gyuunyuu', 'gyūnyū']],
  ];
  for (const [kana, inputs] of accept) {
    const it = ITEMS.get('w:' + kana) || { kana, ro: romaji(kana) };
    for (const i of inputs) if (!answerMatches(i, it)) fails.push(`${kana}: rejects ${i}`);
  }
  const reject = [['がっこう', 'gako'], ['きって', 'kite'], ['おばあさん', 'obasan'], ['ほん', 'hono'], ['コーヒー', 'kohi']];
  for (const [kana, i] of reject) if (answerMatches(i, ITEMS.get('w:' + kana))) fails.push(`${kana}: accepts ${i}`);

  const kanaAccept = [['し', 'shi'], ['し', 'si'], ['ち', 'ti'], ['つ', 'tu'], ['ふ', 'hu'], ['を', 'o'], ['を', 'wo'], ['ん', 'n'], ['ぢ', 'ji'], ['ぢ', 'di'], ['づ', 'zu'], ['ティ', 'ti'], ['ファ', 'fa'], ['じゃ', 'ja'], ['じゃ', 'zya'], ['シ', 'shi']];
  for (const [k, i] of kanaAccept) if (!answerMatches(i, ITEMS.get('k:' + k))) fails.push(`${k}: rejects ${i}`);
  for (const [k, i] of [['し', 'chi'], ['お', 'wo'], ['ん', 'nu'], ['じ', 'zi ']]) {
    const it = ITEMS.get('k:' + k);
    if (k === 'じ') { if (!answerMatches(i, it)) fails.push('じ: rejects zi'); continue; }
    if (answerMatches(i, it) && k !== 'お') fails.push(`${k}: accepts ${i}`);
  }

  window.TEST_RESULT = { count: ITEMS.size, lessons: LESSONS.length, fails };
})();
