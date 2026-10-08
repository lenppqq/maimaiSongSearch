// Pure functions that rebuild the in-game song wheel and plan a route to a song.
// No DOM access here, so tests can run the same code in Node and in the browser.

export const DIFFS = ['bas', 'adv', 'exp', 'mas', 'remas'];
export const CATEGORIES = ['genre', 'title', 'level', 'version', 'all'];
export const SORTS = ['recommended', 'title', 'level', 'date', 'bpm'];

// Title folders: kana rows first, then alphabet ranges, then numbers and symbols.
export const TITLE_BUCKETS = [
  { key: 'a', label: 'あ', chars: 'アイウエオヴ' },
  { key: 'ka', label: 'か', chars: 'カキクケコ' },
  { key: 'sa', label: 'さ', chars: 'サシスセソ' },
  { key: 'ta', label: 'た', chars: 'タチツテト' },
  { key: 'na', label: 'な', chars: 'ナニヌネノ' },
  { key: 'ha', label: 'は', chars: 'ハヒフヘホ' },
  { key: 'ma', label: 'ま', chars: 'マミムメモ' },
  { key: 'ya', label: 'や', chars: 'ヤユヨ' },
  { key: 'ra', label: 'ら', chars: 'ラリルレロ' },
  { key: 'wa', label: 'わ', chars: 'ワヲン' },
  { key: 'AD', label: 'A～D', chars: 'ABCD' },
  { key: 'EJ', label: 'E～J', chars: 'EFGHIJ' },
  { key: 'KO', label: 'K～O', chars: 'KLMNO' },
  { key: 'PS', label: 'P～S', chars: 'PQRS' },
  { key: 'TZ', label: 'T～Z', chars: 'TUVWXYZ' },
  { key: 'num', label: '数字・他', chars: '' },
];

const SMALL_KANA = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ', 'ヵ': 'カ', 'ヶ': 'ケ' };

function baseKana(ch) {
  const plain = ch.normalize('NFD').replace(/[゙゚]/g, '').normalize('NFC');
  return SMALL_KANA[plain] || plain;
}

export function titleBucket(kana) {
  const first = baseKana((kana || '').charAt(0)).toUpperCase();
  if (first) {
    for (const b of TITLE_BUCKETS) if (b.chars.includes(first)) return b.key;
  }
  return 'num';
}

// Kana sorts before Latin, Latin before digits, digits before anything else.
function charRank(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x30a1 && c <= 0x30fa) return 0;
  if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return 1;
  if (c >= 0x30 && c <= 0x39) return 2;
  return 3;
}

export function compareKana(a, b) {
  const x = Array.from(a || '');
  const y = Array.from(b || '');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const rx = charRank(x[i]);
    const ry = charRank(y[i]);
    if (rx !== ry) return rx - ry;
    return x[i].codePointAt(0) - y[i].codePointAt(0);
  }
  return x.length - y.length;
}

// '13+' sorts between 13 and 14. Utage levels end in '?'.
export function levelValue(lv) {
  if (!lv) return Infinity;
  const m = /^(\d+)(\+)?/.exec(lv);
  return m ? Number(m[1]) + (m[2] ? 0.5 : 0) : Infinity;
}

// The level the player sees for a song with the chosen difficulty and chart type.
// Falls back to the other chart type when the song lacks it, and from Re:MASTER to MASTER.
export function songLevel(song, diff, chartType) {
  if (song.utage) return song.utage.lv;
  const charts = song.charts || {};
  const other = chartType === 'dx' ? 'std' : 'dx';
  const chart = charts[chartType] || charts[other];
  if (!chart) return null;
  return chart[diff] || (diff === 'remas' ? chart.mas : null) || null;
}

function comparator(state) {
  const bySort = (a, b) => a.sort - b.sort;
  switch (state.sort) {
    case 'title':
      return (a, b) => compareKana(a.kana, b.kana) || bySort(a, b);
    case 'level':
      return (a, b) =>
        levelValue(songLevel(a, state.diff, state.chartType)) - levelValue(songLevel(b, state.diff, state.chartType)) ||
        bySort(a, b);
    case 'date':
      return (a, b) => (a.added || '99999999').localeCompare(b.added || '99999999') || bySort(a, b);
    case 'bpm':
      return (a, b) => (a.bpm ?? Infinity) - (b.bpm ?? Infinity) || bySort(a, b);
    default:
      return bySort;
  }
}

// Returns the folders in wheel order, each with its songs in wheel order.
// Utage charts only ever appear in their own folder, placed last.
export function buildFolders(db, state) {
  const regular = db.songs.filter((s) => s.genre !== 'utage');
  const utage = db.songs.filter((s) => s.genre === 'utage');
  const utageName = (db.genres.find((g) => g.key === 'utage') || {}).name || '宴会場';
  let folders = [];

  switch (state.category) {
    case 'genre':
      folders = db.genres.map((g) => ({ key: g.key, label: g.name, songs: db.songs.filter((s) => s.genre === g.key) }));
      break;
    case 'title':
      folders = TITLE_BUCKETS.map((b) => ({ key: b.key, label: b.label, songs: regular.filter((s) => titleBucket(s.kana) === b.key) }));
      break;
    case 'level': {
      const byLevel = new Map();
      for (const s of regular) {
        const lv = songLevel(s, state.diff, state.chartType);
        if (!lv) continue;
        if (!byLevel.has(lv)) byLevel.set(lv, []);
        byLevel.get(lv).push(s);
      }
      folders = [...byLevel.keys()]
        .sort((a, b) => levelValue(a) - levelValue(b))
        .map((lv) => ({ key: 'lv' + lv, label: 'Lv ' + lv, songs: byLevel.get(lv) }));
      break;
    }
    case 'version': {
      const versions = state.versionOrder === 'new-first' ? [...db.versions].reverse() : db.versions;
      folders = versions.map((v) => ({ key: 'v' + v.code, label: v.name, songs: regular.filter((s) => s.ver === v.code) }));
      break;
    }
    default:
      folders = [{ key: 'all', label: 'ALL', songs: regular }];
  }
  if (state.category !== 'genre') folders.push({ key: 'utage', label: utageName, songs: utage });

  const cmp = comparator(state);
  return folders
    .filter((f) => f.songs.length > 0)
    .map((f) => ({ ...f, songs: [...f.songs].sort(cmp) }));
}

export function locate(folders, songId) {
  for (let fi = 0; fi < folders.length; fi++) {
    const index = folders[fi].songs.findIndex((s) => s.id === songId);
    if (index !== -1) return { folderIdx: fi, index };
  }
  return null;
}

// 'right' means button 3 (next), 'left' means button 6 (previous).
export function moves(from, to, size, wrap) {
  if (from === to) return { dir: 'none', steps: 0 };
  if (!wrap) return to > from ? { dir: 'right', steps: to - from } : { dir: 'left', steps: from - to };
  const right = (((to - from) % size) + size) % size;
  const left = size - right;
  return right <= left ? { dir: 'right', steps: right } : { dir: 'left', steps: left };
}

const mod = (n, m) => ((n % m) + m) % m;

/**
 * Plan how to reach targetId.
 * opts.currentId   song the cursor is on now (optional)
 * opts.wrap        the wheel loops from the last song back to the first
 * opts.randomSlot  a "random" entry sits after the last song of every folder
 * opts.songsPerSwipe  songs skipped by one fast swipe; 0 disables swipes
 */
export function planRoute(folders, targetId, opts = {}) {
  const target = locate(folders, targetId);
  if (!target) return null;
  const wrap = !!opts.wrap;
  const current = opts.currentId ? locate(folders, opts.currentId) : null;

  const fromFolder = current ? current.folderIdx : 0;
  const folderMove = moves(fromFolder, target.folderIdx, folders.length, wrap);

  const folder = folders[target.folderIdx];
  const count = folder.songs.length;
  const size = count + (opts.randomSlot ? 1 : 0);
  const startIsCurrent = !!current && current.folderIdx === target.folderIdx;
  const start = startIsCurrent ? current.index : 0;
  const songMove = moves(start, target.index, size, wrap);

  const spp = Math.max(0, Math.floor(opts.songsPerSwipe || 0));
  const swipes = spp > 1 ? Math.floor(songMove.steps / spp) : 0;
  const presses = songMove.steps - swipes * spp;
  const sign = songMove.dir === 'left' ? -1 : 1;
  const landmarks = [];
  for (let k = 1; k <= swipes; k++) {
    const raw = start + sign * k * spp;
    const idx = wrap ? mod(raw, size) : raw;
    landmarks.push({ swipe: k, index: idx, song: folder.songs[idx] || null });
  }

  const neighbors = [];
  for (let d = -3; d <= 3; d++) {
    let idx = target.index + d;
    if (idx < 0 || idx >= count) {
      if (!wrap || count < 7) continue;
      idx = mod(idx, count);
    }
    neighbors.push({ offset: d, index: idx, song: folder.songs[idx] });
  }

  return {
    folder: {
      index: target.folderIdx,
      count: folders.length,
      label: folder.label,
      key: folder.key,
      fromIndex: fromFolder,
      fromLabel: folders[fromFolder].label,
      fromCurrent: !!current,
      ...folderMove,
    },
    song: {
      index: target.index,
      count,
      fromLeft: target.index + 1,
      fromRight: count - target.index,
      start,
      startIsCurrent,
      ...songMove,
      songsPerSwipe: spp,
      swipes,
      presses,
      landmarks,
    },
    neighbors,
  };
}
