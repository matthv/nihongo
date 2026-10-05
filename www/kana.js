'use strict';

// ---------- Readings ----------

const BASE = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'wo', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
};

// Two-kana syllables: palatalized ones and the sounds katakana uses for loanwords.
const COMBO = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo', びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', てぃ: 'ti', でぃ: 'di', でゅ: 'dyu',
  ちぇ: 'che', しぇ: 'she', じぇ: 'je', うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
};

const SMALL_Y = { ゃ: 'a', ゅ: 'u', ょ: 'o' };

function toHira(s) {
  return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
function toKata(s) {
  return s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
}
function isKana(s) { return /[ぁ-ゖァ-ヺー]/.test(s); }

function vowelOf(h) {
  if (SMALL_Y[h]) return SMALL_Y[h];
  const r = BASE[h];
  return r && r !== 'n' ? r[r.length - 1] : '';
}

// Hiragana form with the long-vowel mark spelled out, so コーヒー and こおひい compare equal.
function normalize(s) {
  const h = toHira(s.trim()).replace(/\s+/g, '');
  let out = '';
  for (const c of h) {
    if (c === 'ー') {
      const v = vowelOf(out[out.length - 1]);
      out += { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' }[v] || '';
    } else out += c;
  }
  return out;
}

// Hepburn romaji of a kana string.
function romaji(s) {
  const h = toHira(s);
  let out = '';
  let geminate = false;
  for (let i = 0; i < h.length; i++) {
    const c = h[i];
    if (c === 'っ') { geminate = true; continue; }
    if (c === 'ー') { out += out.match(/[aeiou](?=[^aeiou]*$)/)?.[0] || ''; continue; }
    let r = COMBO[c + (h[i + 1] || '')];
    if (r) i++;
    else r = BASE[c] ?? c;
    if (c === 'ん' && /^[aeiouy]/.test(BASE[h[i + 1]] || COMBO[(h[i + 1] || '') + (h[i + 2] || '')] || '')) r = "n'";
    if (geminate) { out += r.startsWith('ch') ? 't' : r[0]; geminate = false; }
    out += r;
  }
  return out;
}

// ---------- Typed romaji -> kana ----------

const TYPED = (() => {
  const t = {};
  const add = (k, ...v) => { t[k] = [...new Set([...(t[k] || []), ...v])]; };
  for (const [k, r] of Object.entries(BASE)) if (!/[ぁぃぅぇぉ]/.test(k) && k !== 'ん') add(r, k);
  for (const [k, r] of Object.entries(COMBO)) add(r, k);
  // Kunrei-shiki and other spellings people actually type.
  add('si', 'し'); add('ti', 'ち'); add('tu', 'つ', 'とぅ'); add('hu', 'ふ'); add('zi', 'じ'); add('di', 'ぢ');
  add('du', 'づ', 'どぅ'); add('o', 'を'); add('wo', 'お');
  for (const [c, k] of [['k', 'き'], ['n', 'に'], ['h', 'ひ'], ['m', 'み'], ['r', 'り'], ['g', 'ぎ'], ['b', 'び'], ['p', 'ぴ']]) {
    for (const [v, y] of [['a', 'ゃ'], ['u', 'ゅ'], ['o', 'ょ']]) add(c + 'y' + v, k + y);
  }
  for (const [p, k] of [['sy', 'し'], ['ty', 'ち'], ['cy', 'ち'], ['zy', 'じ'], ['jy', 'じ'], ['dy', 'ぢ']]) {
    for (const [v, y] of [['a', 'ゃ'], ['u', 'ゅ'], ['o', 'ょ']]) add(p + v, k + y);
  }
  add('dyu', 'でゅ'); add('ye', 'いぇ'); add('va', 'ゔぁ'); add('vi', 'ゔぃ'); add('ve', 'ゔぇ'); add('vo', 'ゔぉ');
  return t;
})();
const TYPED_MAX = Math.max(...Object.keys(TYPED).map(k => k.length));

// Every kana spelling the input could stand for (ti may be ち or てぃ, o may be お or を...), capped.
function typedToKana(input) {
  const s = input.toLowerCase().trim()
    .replace(/[āâ]/g, 'aa').replace(/[īî]/g, 'ii').replace(/[ūû]/g, 'uu').replace(/[ēê]/g, 'ee').replace(/[ōô]/g, 'ou')
    .replace(/[’`]/g, "'").replace(/[\s.]+/g, '');
  const results = new Set();
  const walk = (i, acc) => {
    if (results.size >= 200) return;
    if (i >= s.length) { results.add(acc); return; }
    const c = s[i], next = s[i + 1] || '';
    if (c === '-') return walk(i + 1, acc + 'ー');
    if (c === "'") return walk(i + 1, acc);
    if (c === 'n') {
      if (next === "'") return walk(i + 2, acc + 'ん');
      if (next === 'n') {
        const after = s[i + 2] || '';
        return walk(/[aeiouy]/.test(after) ? i + 1 : i + 2, acc + 'ん');
      }
      if (!/[aeiouy]/.test(next)) return walk(i + 1, acc + 'ん');
    }
    if (c === 't' && next === 'c' && s[i + 2] === 'h') return walk(i + 1, acc + 'っ');
    if (/[bcdfghjklmpqrstvwxyz]/.test(c) && c === next) return walk(i + 1, acc + 'っ');
    let matched = false;
    for (let len = Math.min(TYPED_MAX, s.length - i); len >= 1; len--) {
      const opts = TYPED[s.slice(i, i + len)];
      if (!opts) continue;
      matched = true;
      for (const k of opts) walk(i + len, acc + k);
      break;
    }
    if (!matched) return;
  };
  walk(0, '');
  return [...results].map(r => loose(normalize(r)));
}

// Long o and e sound the same whether written おう/おお or えい/ええ, so typing gakkoo is fine.
function loose(h) {
  let out = '';
  for (const c of h) {
    const v = vowelOf(out[out.length - 1]);
    out += c === 'う' && v === 'o' ? 'お' : c === 'い' && v === 'e' ? 'え' : c;
  }
  return out;
}

// Accepts romaji in any common spelling, or kana typed with a Japanese keyboard.
function answerMatches(input, item) {
  const target = loose(normalize(item.kana));
  if (isKana(input)) return loose(normalize(input)) === target;
  const typed = input.toLowerCase().replace(/\s+/g, '');
  if (typed && (item.accept || []).includes(typed)) return true;
  const candidates = typedToKana(input);
  if (candidates.includes(target)) return true;
  return item.ro ? typedToKana(item.ro).some(c => candidates.includes(c)) : false;
}

// ---------- Course ----------

const PRONUNCIATION = `
<p>Le japonais se lit presque comme il s'écrit, avec quelques réflexes à prendre quand on parle français :</p>
<ul>
  <li><b>u</b> se dit « ou », lèvres peu arrondies. <b>e</b> se dit « é ».</li>
  <li>Le <b>u</b> de <i>su</i> ou <i>tsu</i> est souvent presque muet : <i>desu</i> sonne « dèss ».</li>
  <li><b>g</b> est toujours dur (<i>gi</i> = « gui »). <b>j</b> se dit « dj », <b>ch</b> « tch », <b>sh</b> « ch ».</li>
  <li><b>h</b> s'entend, comme un souffle. <b>r</b> est un petit battement de langue, entre r et l.</li>
  <li><b>y</b> comme dans « yaourt », <b>w</b> comme « ou ».</li>
</ul>`;

const NOTES = {
  う: 'Un « ou » léger, lèvres peu arrondies.',
  え: 'Se dit « é ».',
  し: 'Se lit « shi » (comme « chi » en français), jamais « si ».',
  ち: 'Se lit « chi », c\'est-à-dire « tchi ».',
  つ: 'Se lit « tsu », un son qui n\'existe pas en français : « ts » suivi d\'un « ou » léger.',
  ふ: 'Se lit « fu » : un souffle entre f et h, sans toucher les dents.',
  は: 'Se lit « ha ». Mais quand il sert de particule (こんにちは), il se dit « wa ».',
  へ: 'Se lit « he ». Comme particule (« vers »), il se dit « e ».',
  ら: 'Le r japonais : la langue tape une fois derrière les dents, entre r et l.',
  を: 'S\'écrit « wo » mais se dit « o ». Il ne sert que de particule (le complément d\'objet).',
  ん: 'Le seul kana sans voyelle : un « n » qui ne se termine pas.',
  じ: 'Se dit « dji ».',
  ぢ: 'Se dit comme じ (« dji »). Rare : on le croise dans quelques mots composés.',
  づ: 'Se dit comme ず (« dzou »). Rare, comme ぢ.',
  ぎ: '« gui », le g reste dur.',
  げ: '« gué », le g reste dur.',
  ゆ: '« you ».',
  ぬ: 'Attention à ne pas le confondre avec め : ぬ a une petite boucle à la fin.',
  め: 'Sans boucle, contrairement à ぬ.',
  ね: 'Ressemble à れ et わ : ね finit par une boucle.',
  れ: 'Ressemble à ね et わ : れ finit par une queue qui remonte vers la droite.',
  わ: 'Ressemble à ね et れ : わ finit par un arrondi, sans boucle.',
  る: 'Comme ろ, mais avec une petite boucle en bas.',
  ろ: 'Comme る, mais sans boucle.',
  き: 'Deux traits horizontaux ; さ n\'en a qu\'un.',
  さ: 'Un seul trait horizontal ; き en a deux.',
  シ: '« shi » : les traits sont plutôt alignés verticalement à gauche, le grand trait monte depuis le bas.',
  ツ: '« tsu » : les petits traits sont alignés en haut, le grand trait descend depuis le haut.',
  ソ: '« so » : le petit trait est presque vertical, le grand descend depuis le haut.',
  ン: '« n » : le petit trait est presque horizontal, le grand monte depuis le bas.',
  ヲ: 'Se dit « o ». Presque jamais utilisé en katakana.',
  ヂ: 'Se dit comme ジ. Très rare.',
  ヅ: 'Se dit comme ズ. Très rare.',
  ティ: 'Pour les mots étrangers : « ti » (パーティー, party).',
  ディ: 'Pour les mots étrangers : « di ».',
  ウィ: 'Pour les mots étrangers : « oui ».',
  ウォ: 'Pour les mots étrangers : « ouo ».',
};

const KATA_MARK = `<p>En katakana, le trait <b>ー</b> allonge la voyelle qui le précède : ケーキ se lit <i>kēki</i> (kéé-ki).
Tiens bien la voyelle deux fois plus longtemps : au Japon, la durée change le sens des mots.</p>`;

const LESSONS = [
  { id: 'h01', script: 'hira', title: 'Les voyelles', kana: 'あ い う え お',
    intro: `<p>Les <b>hiragana</b> sont le premier alphabet du japonais : chaque signe note une syllabe. Ils servent à écrire les mots japonais et la grammaire.</p>${PRONUNCIATION}`,
    words: [['あい', 'amour'], ['いえ', 'maison'], ['うえ', 'dessus, en haut'], ['あお', 'bleu'], ['いいえ', 'non']] },
  { id: 'h02', script: 'hira', title: 'K', kana: 'か き く け こ',
    words: [['かお', 'visage'], ['あき', 'automne'], ['えき', 'gare'], ['いけ', 'étang'], ['ここ', 'ici'], ['きく', 'écouter'], ['こえ', 'voix'], ['あかい', 'rouge'], ['いく', 'aller'], ['おおきい', 'grand']] },
  { id: 'h03', script: 'hira', title: 'S', kana: 'さ し す せ そ',
    words: [['すし', 'sushi'], ['あさ', 'matin'], ['いす', 'chaise'], ['かさ', 'parapluie'], ['しお', 'sel'], ['すき', 'aimer bien'], ['せかい', 'monde'], ['おかし', 'friandise'], ['あし', 'pied, jambe'], ['そこ', 'là']] },
  { id: 'h04', script: 'hira', title: 'T', kana: 'た ち つ て と',
    words: [['たかい', 'haut, cher'], ['ちかい', 'proche'], ['くつ', 'chaussures'], ['て', 'main'], ['そと', 'dehors'], ['した', 'dessous, en bas'], ['うた', 'chanson'], ['つくえ', 'bureau (meuble)'], ['ちいさい', 'petit'], ['あつい', 'chaud'], ['とけい', 'montre, horloge']] },
  { id: 'h05', script: 'hira', title: 'N', kana: 'な に ぬ ね の',
    words: [['なつ', 'été'], ['いぬ', 'chien'], ['ねこ', 'chat'], ['なに', 'quoi'], ['あね', 'grande sœur'], ['くに', 'pays'], ['おかね', 'argent'], ['なか', 'dedans, intérieur'], ['ぬの', 'tissu']] },
  { id: 'h06', script: 'hira', title: 'H', kana: 'は ひ ふ へ ほ',
    words: [['はな', 'fleur'], ['ひと', 'personne'], ['ふね', 'bateau'], ['ほし', 'étoile'], ['へそ', 'nombril'], ['はこ', 'boîte'], ['ひとつ', 'un (objet)'], ['ふたつ', 'deux (objets)'], ['さいふ', 'portefeuille'], ['へた', 'maladroit']] },
  { id: 'h07', script: 'hira', title: 'M', kana: 'ま み む め も',
    words: [['まち', 'ville'], ['みみ', 'oreille'], ['むし', 'insecte'], ['め', 'œil'], ['あめ', 'pluie'], ['なまえ', 'nom, prénom'], ['さむい', 'froid (temps)'], ['うみ', 'mer'], ['みせ', 'magasin'], ['いま', 'maintenant'], ['くも', 'nuage'], ['もも', 'pêche (fruit)']] },
  { id: 'h08', script: 'hira', title: 'Y', kana: 'や ゆ よ',
    words: [['やま', 'montagne'], ['ゆき', 'neige'], ['ふゆ', 'hiver'], ['へや', 'chambre, pièce'], ['やさい', 'légume'], ['ゆめ', 'rêve'], ['よこ', 'côté'], ['やすみ', 'repos, congé']] },
  { id: 'h09', script: 'hira', title: 'R', kana: 'ら り る れ ろ',
    words: [['はる', 'printemps'], ['よる', 'nuit'], ['くるま', 'voiture'], ['そら', 'ciel'], ['さる', 'singe'], ['りす', 'écureuil'], ['くすり', 'médicament'], ['ろく', 'six'], ['ふるい', 'vieux, ancien'], ['あたらしい', 'nouveau'], ['しろい', 'blanc'], ['くろい', 'noir']] },
  { id: 'h10', script: 'hira', title: 'W et N', kana: 'わ を ん',
    words: [['わたし', 'je, moi'], ['かわ', 'rivière'], ['ほん', 'livre'], ['にほん', 'Japon'], ['せんせい', 'professeur'], ['みかん', 'mandarine'], ['おんな', 'femme'], ['わるい', 'mauvais'], ['こんにちは', 'bonjour', 'konnichiwa'], ['さん', 'trois'], ['よん', 'quatre']] },
  { id: 'h11', script: 'hira', title: 'G et Z', kana: 'が ぎ ぐ げ ご ざ じ ず ぜ ぞ',
    intro: `<p>Les deux petits traits <b>゛</b> (<i>dakuten</i>) rendent la consonne sonore : か <i>ka</i> devient が <i>ga</i>, さ <i>sa</i> devient ざ <i>za</i>.</p>`,
    words: [['かぎ', 'clé'], ['かぜ', 'vent'], ['みず', 'eau'], ['かぞく', 'famille'], ['ごご', 'après-midi'], ['げんき', 'en forme'], ['じかん', 'temps (durée)'], ['ごはん', 'riz, repas'], ['りんご', 'pomme'], ['なぜ', 'pourquoi'], ['かんじ', 'kanji'], ['ちず', 'carte (géographique)']] },
  { id: 'h12', script: 'hira', title: 'D, B et P', kana: 'だ ぢ づ で ど ば び ぶ べ ぼ ぱ ぴ ぷ ぺ ぽ',
    intro: `<p>Même principe : た <i>ta</i> devient だ <i>da</i>, は <i>ha</i> devient ば <i>ba</i>. Le petit rond <b>゜</b> (<i>handakuten</i>) donne un p : ぱ <i>pa</i>.</p>`,
    words: [['でんわ', 'téléphone'], ['まど', 'fenêtre'], ['からだ', 'corps'], ['どこ', 'où'], ['ともだち', 'ami, amie'], ['かばん', 'sac'], ['へび', 'serpent'], ['ぶた', 'cochon'], ['たべもの', 'nourriture'], ['えんぴつ', 'crayon'], ['さんぽ', 'promenade'], ['てんぷら', 'tempura'], ['はなぢ', 'saignement de nez'], ['つづく', 'continuer'], ['こんばんは', 'bonsoir', 'konbanwa']] },
  { id: 'h13', script: 'hira', title: 'Sons doubles et longs', kana: '',
    intro: `<p>Pas de nouveau signe ici, mais deux règles qui changent le sens des mots.</p>
<p><b>Le petit っ</b> double la consonne qui suit : on marque une petite pause avant. きって <i>kitte</i> (timbre) se dit « kit-té ».</p>
<p><b>Les voyelles longues</b> s'écrivent en ajoutant une voyelle : おかあさん <i>okaasan</i>. Pour les sons « o » et « é » longs, on écrit souvent う et い : とうきょう <i>toukyou</i>, せんせい <i>sensei</i>.</p>
<p>Comparez おばさん <i>obasan</i> (tante) et おばあさん <i>obaasan</i> (grand-mère) : seule la durée du « a » change.</p>`,
    words: [['がっこう', 'école'], ['きって', 'timbre'], ['ざっし', 'magazine'], ['きっぷ', 'billet (de train)'], ['みっつ', 'trois (objets)'], ['おかあさん', 'mère'], ['おとうさん', 'père'], ['おばあさん', 'grand-mère'], ['おばさん', 'tante'], ['おじいさん', 'grand-père'], ['おじさん', 'oncle'], ['おにいさん', 'grand frère']] },
  { id: 'h14', script: 'hira', title: 'Syllabes combinées', kana: 'きゃ きゅ きょ しゃ しゅ しょ ちゃ ちゅ ちょ にゃ にゅ にょ ひゃ ひゅ ひょ みゃ みゅ みょ りゃ りゅ りょ',
    intro: `<p>Un kana en <i>-i</i> suivi d'un petit ゃ, ゅ ou ょ forme une seule syllabe : き + ゃ = きゃ <i>kya</i>, し + ょ = しょ <i>sho</i>.</p>
<p>Le petit kana compte pour la même syllabe : きゃ se dit d'un coup, pas « ki-ya ».</p>`,
    words: [['きょう', 'aujourd\'hui'], ['しゃしん', 'photo'], ['おちゃ', 'thé'], ['いしゃ', 'médecin'], ['しゅくだい', 'devoirs'], ['りょこう', 'voyage'], ['ひゃく', 'cent'], ['きゅう', 'neuf'], ['ちょっと', 'un peu'], ['いっしょ', 'ensemble'], ['じしょ', 'dictionnaire'], ['でんしゃ', 'train']] },
  { id: 'h15', script: 'hira', title: 'Syllabes combinées sonores', kana: 'ぎゃ ぎゅ ぎょ じゃ じゅ じょ びゃ びゅ びょ ぴゃ ぴゅ ぴょ',
    words: [['ぎゅうにゅう', 'lait'], ['じゅぎょう', 'cours (en classe)'], ['びょういん', 'hôpital'], ['じゃあね', 'salut ! (en partant)'], ['じょうず', 'doué, habile'], ['じゅう', 'dix'], ['さんびゃく', 'trois cents'], ['はっぴゃく', 'huit cents'], ['きんぎょ', 'poisson rouge']] },

  { id: 'k01', script: 'kata', title: 'Voyelles et K', kana: 'ア イ ウ エ オ カ キ ク ケ コ',
    intro: `<p>Les <b>katakana</b> notent les mêmes sons que les hiragana, avec des traits plus anguleux. Ils servent surtout aux mots venus d'autres langues : カメラ <i>kamera</i>, appareil photo.</p>${KATA_MARK}`,
    words: [['ケーキ', 'gâteau'], ['ココア', 'chocolat chaud'], ['カカオ', 'cacao'], ['オーケー', 'd\'accord (OK)']] },
  { id: 'k02', script: 'kata', title: 'S et T', kana: 'サ シ ス セ ソ タ チ ツ テ ト',
    words: [['タクシー', 'taxi'], ['スキー', 'ski'], ['テスト', 'contrôle, test'], ['セーター', 'pull'], ['アイス', 'glace'], ['スーツ', 'costume'], ['ソース', 'sauce']] },
  { id: 'k03', script: 'kata', title: 'N et H', kana: 'ナ ニ ヌ ネ ノ ハ ヒ フ ヘ ホ',
    words: [['ネクタイ', 'cravate'], ['ノート', 'cahier'], ['コーヒー', 'café (boisson)'], ['ナイフ', 'couteau'], ['テニス', 'tennis'], ['ヒーター', 'radiateur']] },
  { id: 'k04', script: 'kata', title: 'M, Y et R', kana: 'マ ミ ム メ モ ヤ ユ ヨ ラ リ ル レ ロ',
    words: [['カメラ', 'appareil photo'], ['ホテル', 'hôtel'], ['トマト', 'tomate'], ['アメリカ', 'États-Unis'], ['クリーム', 'crème'], ['タオル', 'serviette'], ['ユーロ', 'euro'], ['メール', 'e-mail'], ['アニメ', 'dessin animé'], ['ヨーヨー', 'yo-yo']] },
  { id: 'k05', script: 'kata', title: 'W et N', kana: 'ワ ヲ ン',
    words: [['ワイン', 'vin'], ['ラーメン', 'ramen'], ['フランス', 'France'], ['レモン', 'citron'], ['メロン', 'melon'], ['カーテン', 'rideau'], ['ハンカチ', 'mouchoir']] },
  { id: 'k06', script: 'kata', title: 'Sons sonores', kana: 'ガ ギ グ ゲ ゴ ザ ジ ズ ゼ ゾ ダ ヂ ヅ デ ド バ ビ ブ ベ ボ パ ピ プ ペ ポ',
    words: [['パン', 'pain'], ['ゲーム', 'jeu vidéo'], ['テレビ', 'télévision'], ['バス', 'bus'], ['ドア', 'porte'], ['ピアノ', 'piano'], ['ギター', 'guitare'], ['ゼロ', 'zéro'], ['デザート', 'dessert'], ['ボール', 'ballon'], ['パスポート', 'passeport'], ['スプーン', 'cuillère'], ['ビール', 'bière'], ['ズボン', 'pantalon'], ['ペン', 'stylo']] },
  { id: 'k07', script: 'kata', title: 'Syllabes combinées', kana: 'キャ キュ キョ シャ シュ ショ チャ チュ チョ ニャ ニュ ニョ ヒャ ヒュ ヒョ ミャ ミュ ミョ リャ リュ リョ',
    intro: `<p>Mêmes règles qu'en hiragana : petit ャ ュ ョ pour les syllabes combinées, petit ッ pour doubler la consonne.</p>`,
    words: [['ベッド', 'lit'], ['カップ', 'tasse'], ['シャツ', 'chemise'], ['チョコレート', 'chocolat'], ['メニュー', 'menu'], ['ニュース', 'actualités'], ['キャベツ', 'chou'], ['ショッピング', 'shopping']] },
  { id: 'k08', script: 'kata', title: 'Syllabes combinées sonores', kana: 'ギャ ギュ ギョ ジャ ジュ ジョ ビャ ビュ ビョ ピャ ピュ ピョ',
    words: [['ジュース', 'jus de fruits'], ['ジャム', 'confiture'], ['コンピューター', 'ordinateur'], ['ジョギング', 'jogging']] },
  { id: 'k09', script: 'kata', title: 'Sons étrangers', kana: 'ファ フィ フェ フォ ティ ディ チェ シェ ジェ ウィ ウェ ウォ',
    intro: `<p>Pour les sons qui n'existent pas en japonais, les katakana combinent un kana et une petite voyelle : フ + ァ = ファ <i>fa</i>, テ + ィ = ティ <i>ti</i>.</p>`,
    words: [['パーティー', 'fête, soirée'], ['フォーク', 'fourchette'], ['カフェ', 'café (lieu)'], ['シェフ', 'chef cuisinier'], ['ソファー', 'canapé'], ['ファイル', 'fichier, classeur'], ['ティッシュ', 'mouchoir en papier'], ['チェック', 'vérification'], ['ジェットコースター', 'montagnes russes']] },
];

// Readings a learner may type for a single kana besides its Hepburn spelling.
const EXTRA_ACCEPT = { を: ['o', 'wo'], ヲ: ['o', 'wo'], ぢ: ['ji', 'di', 'zi'], ヂ: ['ji', 'di', 'zi'], づ: ['zu', 'du'], ヅ: ['zu', 'du'], ん: ['n', 'nn'], ン: ['n', 'nn'] };

// Kana that share a sound: never offered as each other's distractor.
function soundKey(kana) { return romaji(normalize(kana)); }

const SOUND_NOTES = 'うえしちつふらんじぢづぎげゆ';

const ITEMS = new Map();
for (const [n, lesson] of LESSONS.entries()) {
  lesson.n = n;
  lesson.items = [];
  for (const k of lesson.kana.split(' ').filter(Boolean)) {
    // Katakana reuse the hiragana note only when it is about the sound, not the shape.
    const note = NOTES[k] || (SOUND_NOTES.includes(toHira(k)) ? NOTES[toHira(k)] : undefined);
    const item = { id: 'k:' + k, type: 'kana', kana: k, script: lesson.script, lesson: lesson.id, ro: romaji(k), accept: EXTRA_ACCEPT[k], note };
    ITEMS.set(item.id, item);
    lesson.items.push(item);
  }
  for (const [kana, meaning, ro] of lesson.words) {
    const item = { id: 'w:' + kana, type: 'word', kana, meaning, script: lesson.script, lesson: lesson.id, ro: ro || romaji(kana) };
    ITEMS.set(item.id, item);
    lesson.items.push(item);
  }
}

// Gojūon chart layout for the reference page.
const CHART = {
  base: ['あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの', 'はひふへほ', 'まみむめも', 'や・ゆ・よ', 'らりるれろ', 'わ・・・を', 'ん・・・・'],
  voiced: ['がぎぐげご', 'ざじずぜぞ', 'だぢづでど', 'ばびぶべぼ', 'ぱぴぷぺぽ'],
  combo: ['きゃきゅきょ', 'しゃしゅしょ', 'ちゃちゅちょ', 'にゃにゅにょ', 'ひゃひゅひょ', 'みゃみゅみょ', 'りゃりゅりょ', 'ぎゃぎゅぎょ', 'じゃじゅじょ', 'びゃびゅびょ', 'ぴゃぴゅぴょ'],
};
