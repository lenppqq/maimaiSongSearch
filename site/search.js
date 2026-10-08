// Search by title, artist, kana reading or romaji.
// SEGA's `kana` field is a sort key: katakana without voicing marks, small kana enlarged,
// long-vowel marks spelled out, Latin uppercased, symbols removed. kanaKey() turns any
// query into the same shape, so "bibideba", "びびでば" and "ビビデバ" all match "ヒヒテハ".

const SMALL = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ', 'ヵ': 'カ', 'ヶ': 'ケ' };
const VOWEL = {};
for (const [v, row] of [['ア', 'アカサタナハマヤラワ'], ['イ', 'イキシチニヒミリ'], ['ウ', 'ウクスツヌフムユル'], ['エ', 'エケセテネヘメレ'], ['オ', 'オコソトノホモヨロヲ']]) {
  for (const ch of row) VOWEL[ch] = v;
}

export function hiraToKata(s) {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

export function kanaKey(s) {
  const t = hiraToKata((s || '').normalize('NFKC').toUpperCase())
    .normalize('NFD')
    .replace(/[゙゚]/g, '')
    .normalize('NFC');
  let out = '';
  for (let ch of t) {
    ch = SMALL[ch] || ch;
    if (ch === 'ー') ch = VOWEL[out.slice(-1)] || '';
    if (/[A-Z0-9ァ-ヺ]/.test(ch)) out += ch;
  }
  return out;
}

// Drop long-vowel spellings so "gosutoruru" matches SEGA's "コオストルウル".
export function collapseLong(k) {
  let out = '';
  for (const ch of k || '') {
    const v = VOWEL[out.slice(-1)];
    if (v && (ch === v || (v === 'オ' && ch === 'ウ') || (v === 'エ' && ch === 'イ'))) continue;
    out += ch;
  }
  return out;
}

export function foldText(s) {
  return hiraToKata((s || '').normalize('NFKC').toLowerCase()).replace(/[^\p{L}\p{N}]/gu, '');
}

const ROMA = {
  a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ',
  ka: 'カ', ki: 'キ', ku: 'ク', ke: 'ケ', ko: 'コ', ga: 'ガ', gi: 'ギ', gu: 'グ', ge: 'ゲ', go: 'ゴ',
  sa: 'サ', shi: 'シ', si: 'シ', su: 'ス', se: 'セ', so: 'ソ', za: 'ザ', ji: 'ジ', zi: 'ジ', zu: 'ズ', ze: 'ゼ', zo: 'ゾ',
  ta: 'タ', chi: 'チ', ti: 'チ', tsu: 'ツ', tu: 'ツ', te: 'テ', to: 'ト', da: 'ダ', di: 'ヂ', du: 'ヅ', de: 'デ', do: 'ド',
  na: 'ナ', ni: 'ニ', nu: 'ヌ', ne: 'ネ', no: 'ノ',
  ha: 'ハ', hi: 'ヒ', fu: 'フ', hu: 'フ', he: 'ヘ', ho: 'ホ', ba: 'バ', bi: 'ビ', bu: 'ブ', be: 'ベ', bo: 'ボ', pa: 'パ', pi: 'ピ', pu: 'プ', pe: 'ペ', po: 'ポ',
  ma: 'マ', mi: 'ミ', mu: 'ム', me: 'メ', mo: 'モ', ya: 'ヤ', yu: 'ユ', yo: 'ヨ',
  ra: 'ラ', ri: 'リ', ru: 'ル', re: 'レ', ro: 'ロ', wa: 'ワ', wo: 'ヲ',
  kya: 'キャ', kyu: 'キュ', kyo: 'キョ', gya: 'ギャ', gyu: 'ギュ', gyo: 'ギョ',
  sha: 'シャ', shu: 'シュ', sho: 'ショ', she: 'シェ', sya: 'シャ', syu: 'シュ', syo: 'ショ',
  ja: 'ジャ', ju: 'ジュ', jo: 'ジョ', je: 'ジェ', jya: 'ジャ', jyu: 'ジュ', jyo: 'ジョ',
  cha: 'チャ', chu: 'チュ', cho: 'チョ', che: 'チェ', tya: 'チャ', tyu: 'チュ', tyo: 'チョ',
  nya: 'ニャ', nyu: 'ニュ', nyo: 'ニョ', hya: 'ヒャ', hyu: 'ヒュ', hyo: 'ヒョ',
  bya: 'ビャ', byu: 'ビュ', byo: 'ビョ', pya: 'ピャ', pyu: 'ピュ', pyo: 'ピョ',
  mya: 'ミャ', myu: 'ミュ', myo: 'ミョ', rya: 'リャ', ryu: 'リュ', ryo: 'リョ',
  fa: 'ファ', fi: 'フィ', fe: 'フェ', fo: 'フォ', va: 'ヴァ', vi: 'ヴィ', vu: 'ヴ', ve: 'ヴェ', vo: 'ヴォ',
  wi: 'ウィ', we: 'ウェ', ye: 'イェ', thi: 'ティ', dhi: 'ディ',
};

// Returns katakana, or null when the text is not plain romaji.
export function romajiToKana(text) {
  const s = (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/l/g, 'r').replace(/[\s'\-.]/g, '');
  if (!/^[a-z0-9]+$/.test(s)) return null;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9]/.test(c)) { out += c; i++; continue; }
    if (c === 'n') {
      const next = s[i + 1];
      if (next === 'n') { out += 'ン'; i += 2; continue; }
      if (next === undefined || !/[aiueoy]/.test(next)) { out += 'ン'; i++; continue; }
    }
    if (c === s[i + 1] && !/[aiueon]/.test(c)) { out += 'ッ'; i++; continue; }
    let hit = false;
    for (const len of [3, 2, 1]) {
      const kana = ROMA[s.slice(i, i + len)];
      if (kana) { out += kana; i += len; hit = true; break; }
    }
    if (!hit) return null;
  }
  return out;
}

export function buildIndex(songs) {
  return songs.map((song) => ({
    song, title: foldText(song.title), artist: foldText(song.artist), kana: song.kana || '', loose: collapseLong(song.kana || ''),
  }));
}

export function search(index, query, limit = 40) {
  const qText = foldText(query);
  if (!qText) return [];
  const qKana = kanaKey(query);
  const roma = romajiToKana(query);
  const qRoma = roma ? kanaKey(roma) : '';
  const loose = [...new Set([qKana, qRoma].filter((q) => q.length >= 2).map(collapseLong))];
  const results = [];
  for (const row of index) {
    let score = 0;
    if (row.title === qText) score = 100;
    else if (row.title.startsWith(qText)) score = 85;
    else if (row.title.includes(qText)) score = 65;
    if (qKana) {
      if (row.kana === qKana) score = Math.max(score, 95);
      else if (row.kana.startsWith(qKana)) score = Math.max(score, 75);
      else if (qKana.length >= 2 && row.kana.includes(qKana)) score = Math.max(score, 55);
    }
    if (qRoma.length >= 2 && qRoma !== qKana) {
      if (row.kana.startsWith(qRoma)) score = Math.max(score, 70);
      else if (qRoma.length >= 3 && row.kana.includes(qRoma)) score = Math.max(score, 50);
    }
    if (!score) {
      for (const q of loose) {
        if (row.loose.startsWith(q)) score = Math.max(score, 68);
        else if (q.length >= 3 && row.loose.includes(q)) score = Math.max(score, 48);
      }
    }
    if (!score && qText.length >= 2 && row.artist.includes(qText)) score = 30;
    if (score) {
      if (row.song.genre === 'utage') score -= 5;
      results.push({ song: row.song, score });
    }
  }
  results.sort((a, b) => b.score - a.score || a.song.title.length - b.song.title.length || a.song.sort - b.song.sort);
  return results.slice(0, limit).map((r) => r.song);
}
