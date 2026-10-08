// Engine and search tests. Run in Node:  node tests/engine.test.mjs
// or in a browser via tests/index.html (no build step, no dependencies).
import { buildFolders, planRoute, moves, titleBucket, compareKana, levelValue, songLevel, locate } from '../site/engine.js';
import { buildIndex, search, kanaKey, romajiToKana } from '../site/search.js';

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ---------- synthetic data ----------
const song = (id, genre, sort, extra = {}) => ({
  id, title: id, kana: id.toUpperCase(), artist: 'x', genre, ver: 26000, sort,
  charts: { dx: { bas: '3', mas: '12' } }, img: '', ...extra,
});
const mini = {
  genres: [{ key: 'pops_anime', name: 'POPS' }, { key: 'maimai', name: 'maimai' }, { key: 'utage', name: '宴会場' }],
  versions: [{ code: 10000, name: 'maimai' }, { code: 26000, name: 'CiRCLE' }],
  songs: [
    song('b', 'pops_anime', 0, { charts: { dx: { mas: '13+' } }, bpm: 200 }),
    song('a', 'pops_anime', 1, { charts: { dx: { mas: '13' } }, bpm: 120, ver: 10000 }),
    song('c', 'maimai', 2, { charts: { std: { mas: '12' }, dx: { mas: '14' } } }),
    song('u', 'utage', 3, { charts: undefined, utage: { lv: '13?', kanji: '宴' } }),
  ],
};
const ids = (folder) => folder.songs.map((s) => s.id);

test('genre folders keep genre order and recommended sort', () => {
  const f = buildFolders(mini, { category: 'genre', sort: 'recommended' });
  eq(f.map((x) => x.key), ['pops_anime', 'maimai', 'utage']);
  eq(ids(f[0]), ['b', 'a']);
});

test('title sort uses kana order', () => {
  const f = buildFolders(mini, { category: 'genre', sort: 'title' });
  eq(ids(f[0]), ['a', 'b']);
});

test('level folders follow chosen chart type, utage folder last', () => {
  const dx = buildFolders(mini, { category: 'level', sort: 'recommended', diff: 'mas', chartType: 'dx' });
  eq(dx.map((x) => x.label), ['Lv 13', 'Lv 13+', 'Lv 14', '宴会場']);
  const std = buildFolders(mini, { category: 'level', sort: 'recommended', diff: 'mas', chartType: 'std' });
  eq(std.map((x) => x.label), ['Lv 12', 'Lv 13', 'Lv 13+', '宴会場']);
});

test('version folders skip empty versions and can reverse', () => {
  const f = buildFolders(mini, { category: 'version', sort: 'recommended', versionOrder: 'new-first' });
  eq(f.map((x) => x.label), ['CiRCLE', 'maimai', '宴会場']);
});

test('bpm sort', () => {
  const f = buildFolders(mini, { category: 'all', sort: 'bpm' });
  eq(ids(f[0]), ['a', 'b', 'c']);
});

test('remaster falls back to master', () => {
  eq(songLevel(mini.songs[0], 'remas', 'dx'), '13+');
  eq(songLevel(mini.songs[3], 'mas', 'dx'), '13?');
});

test('levelValue orders plus levels', () => {
  ok(levelValue('13') < levelValue('13+') && levelValue('13+') < levelValue('14'));
  eq(levelValue('12+?'), 12.5);
});

test('title buckets', () => {
  eq(titleBucket('アイトル'), 'a');
  eq(titleBucket('ヴアイ'), 'a');
  eq(titleBucket('ワカイ'), 'wa');
  eq(titleBucket('ンツアツアツ'), 'wa');
  eq(titleBucket('DEEP'), 'AD');
  eq(titleBucket('JUMP'), 'EJ');
  eq(titleBucket('ZETA'), 'TZ');
  eq(titleBucket('39'), 'num');
  eq(titleBucket(''), 'num');
});

test('compareKana: kana before latin before digits', () => {
  const list = ['39', 'ALPHA', 'イ', 'ア', 'AB', 'アア'];
  eq([...list].sort(compareKana), ['ア', 'アア', 'イ', 'AB', 'ALPHA', '39']);
});

test('moves without wrap', () => {
  eq(moves(0, 5, 10, false), { dir: 'right', steps: 5 });
  eq(moves(7, 2, 10, false), { dir: 'left', steps: 5 });
  eq(moves(3, 3, 10, false), { dir: 'none', steps: 0 });
});

test('moves with wrap picks the shorter way', () => {
  eq(moves(0, 23, 25, true), { dir: 'left', steps: 2 });
  eq(moves(0, 12, 25, true), { dir: 'right', steps: 12 });
});

function bigFolder(n) {
  return [{ key: 'f0', label: 'F0', songs: [song('x', 'maimai', 0)] },
    { key: 'f1', label: 'F1', songs: Array.from({ length: n }, (_, i) => song('s' + i, 'maimai', i)) }];
}

test('route: swipes then presses, landmarks at each swipe', () => {
  const r = planRoute(bigFolder(25), 's23', { songsPerSwipe: 10 });
  eq([r.folder.index, r.folder.dir, r.folder.steps], [1, 'right', 1]);
  eq([r.song.fromLeft, r.song.fromRight, r.song.dir, r.song.swipes, r.song.presses], [24, 2, 'right', 2, 3]);
  eq(r.song.landmarks.map((l) => l.song.id), ['s10', 's20']);
});

test('route: wrap goes left from the first song', () => {
  const r = planRoute(bigFolder(25), 's23', { songsPerSwipe: 10, wrap: true });
  eq([r.song.dir, r.song.steps, r.song.swipes, r.song.presses], ['left', 2, 0, 2]);
});

test('route: random slot makes the loop one longer', () => {
  const r = planRoute(bigFolder(25), 's23', { songsPerSwipe: 0, wrap: true, randomSlot: true });
  eq([r.song.dir, r.song.steps], ['left', 3]);
});

test('route: starts from current song in the same folder', () => {
  const r = planRoute(bigFolder(25), 's3', { currentId: 's10', songsPerSwipe: 10 });
  eq([r.song.startIsCurrent, r.song.dir, r.song.steps, r.folder.dir], [true, 'left', 7, 'none']);
  ok(r.folder.fromCurrent);
});

test('route: current song in another folder moves folders from there', () => {
  const r = planRoute(bigFolder(25), 's3', { currentId: 'x', songsPerSwipe: 10 });
  eq([r.folder.dir, r.folder.steps, r.song.startIsCurrent, r.song.steps], ['right', 1, false, 3]);
});

test('route: neighbors around target', () => {
  const r = planRoute(bigFolder(25), 's0', {});
  eq(r.neighbors.map((n) => n.offset), [0, 1, 2, 3]);
  const w = planRoute(bigFolder(25), 's0', { wrap: true });
  eq(w.neighbors.map((n) => n.song.id), ['s22', 's23', 's24', 's0', 's1', 's2', 's3']);
});

test('kanaKey matches SEGA sort keys', () => {
  eq(kanaKey('ビビデバ'), 'ヒヒテハ');
  eq(kanaKey('はいよろこんで'), 'ハイヨロコンテ');
  eq(kanaKey('ハロー'), 'ハロオ');
  eq(kanaKey('ショウ'), 'シヨウ');
  eq(kanaKey('Overdose!'), 'OVERDOSE');
});

test('romajiToKana', () => {
  eq(kanaKey(romajiToKana('bibideba')), 'ヒヒテハ');
  eq(kanaKey(romajiToKana('haiyorokonde')), 'ハイヨロコンテ');
  eq(kanaKey(romajiToKana('poppu')), 'ホツフ');
  eq(romajiToKana('漢字'), null);
});

// ---------- real data ----------
export async function run(loadDb, log = console.log) {
  const db = await loadDb();
  if (db) {
    const index = buildIndex(db.songs);
    const first = (q) => (search(index, q)[0] || {}).title;
    test('real: every song is in exactly one genre folder', () => {
      const f = buildFolders(db, { category: 'genre', sort: 'recommended' });
      eq(f.reduce((n, x) => n + x.songs.length, 0), db.songs.length);
      eq(f.map((x) => x.key), db.genres.map((g) => g.key));
    });
    test('real: every category covers every song once', () => {
      for (const category of ['title', 'version', 'all']) {
        const f = buildFolders(db, { category, sort: 'title', diff: 'mas', chartType: 'dx' });
        eq(f.reduce((n, x) => n + x.songs.length, 0), db.songs.length, category);
      }
    });
    test('real: title folders appear in game order', () => {
      const f = buildFolders(db, { category: 'title', sort: 'title' });
      eq(f.map((x) => x.key).slice(-7), ['AD', 'EJ', 'KO', 'PS', 'TZ', 'num', 'utage']);
    });
    test('real: search', () => {
      eq(first('bibideba'), 'ビビデバ');
      eq(first('ビビデバ'), 'ビビデバ');
      eq(first('overdose'), 'Overdose');
      eq(first('aisukuriimu'), '愛♡スクリ～ム！');
      eq(first('39'), '39');
      eq(first('gosutoruru'), 'ゴーストルール');
      eq(first('ごーすとるーる'), 'ゴーストルール');
      ok(search(index, 'ハロー').some((s) => s.title === '＊ハロー、プラネット。'), 'ハロー');
      eq(search(index, 'link').filter((s) => s.title === 'Link').length, 2);
    });
    test('real: route to a real song resolves', () => {
      const target = db.songs.find((s) => s.title === 'ビビデバ');
      const f = buildFolders(db, { category: 'genre', sort: 'recommended' });
      const r = planRoute(f, target.id, { songsPerSwipe: 10 });
      eq(r.folder.label, 'POPS＆ANIME');
      eq(locate(f, target.id).index, r.song.index);
    });
  }

  let failed = 0;
  for (const c of cases) {
    try {
      await c.fn();
      log(`ok   ${c.name}`);
    } catch (e) {
      failed++;
      log(`FAIL ${c.name}: ${e.message}`);
    }
  }
  log(`${cases.length - failed}/${cases.length} passed`);
  return failed;
}

const isNodeMain = typeof process !== 'undefined' && process.argv?.[1]?.endsWith('engine.test.mjs');
if (isNodeMain) {
  const { readFile } = await import('node:fs/promises');
  const loadDb = async () => JSON.parse(await readFile(new URL('../site/data/songs.json', import.meta.url), 'utf8'));
  const failed = await run(loadDb);
  process.exit(failed ? 1 : 0);
}
