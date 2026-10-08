import { buildFolders, planRoute, songLevel, CATEGORIES, SORTS, DIFFS } from './engine.js';
import { buildIndex, search } from './search.js';
import { t, lang, setLang } from './i18n.js';

const JACKET_BASE = 'https://maimaidx-eng.com/maimai-mobile/img/Music/';
const DIFF_LABEL = { bas: 'BASIC', adv: 'ADVANCED', exp: 'EXPERT', mas: 'MASTER', remas: 'Re:MASTER' };
const SETTINGS_KEY = 'mss.settings';
const CURRENT_KEY = 'mss.current';
const DEFAULTS = {
  category: 'genre', sort: 'recommended', diff: 'mas', chartType: 'dx',
  versionOrder: 'old-first', wrap: false, randomSlot: false, spp: 10, swipeDir: 'rtl',
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function readStore(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const app = {
  db: null,
  index: null,
  byId: new Map(),
  settings: { ...DEFAULTS, ...readStore(SETTINGS_KEY, {}) },
  currentId: readStore(CURRENT_KEY, null),
  targetId: null,
  query: '',
  changes: null,
};

function targetFromHash() {
  const m = /song=([\w-]+)/.exec(location.hash);
  return m ? m[1] : null;
}

function genreName(key) {
  return (app.db.genres.find((g) => g.key === key) || {}).name || key;
}
function versionName(code) {
  return (app.db.versions.find((v) => v.code === code) || {}).name || code;
}

function jacket(song, cls = 'jacket') {
  return `<img class="${cls}" src="${JACKET_BASE}${esc(song.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;
}

function levelChips(song) {
  if (song.utage) return `<span class="lv utage">${esc(song.utage.kanji)} ${esc(song.utage.lv)}</span>`;
  const { diff, chartType } = app.settings;
  const parts = [];
  for (const type of ['dx', 'std']) {
    const chart = song.charts?.[type];
    if (!chart) continue;
    const lv = chart[diff] || (diff === 'remas' ? chart.mas : null);
    if (!lv) continue;
    const active = type === chartType ? ' active' : '';
    parts.push(`<span class="lv ${diff}${active}"><b>${t('chart_' + type)}</b> ${esc(lv)}</span>`);
  }
  return parts.join('');
}

function songMeta(song) {
  return `<span class="tag">${esc(genreName(song.genre))}</span><span class="tag">${esc(versionName(song.ver))}</span>`;
}

// ---------- settings ----------

function renderSettings() {
  const s = app.settings;
  const opt = (value, label, selected) => `<option value="${value}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
  $('#set-category').innerHTML = CATEGORIES.map((c) => opt(c, t('cat_' + c), s.category)).join('');
  $('#set-sort').innerHTML = SORTS.map((c) => opt(c, t('sort_' + c), s.sort)).join('');
  $('#set-diff').innerHTML = DIFFS.map((d) => opt(d, DIFF_LABEL[d], s.diff)).join('');
  $('#set-chart').innerHTML = ['dx', 'std'].map((c) => opt(c, t('chart_' + c), s.chartType)).join('');
  $('#set-version-order').innerHTML = [['old-first', t('vo_old')], ['new-first', t('vo_new')]].map(([v, l]) => opt(v, l, s.versionOrder)).join('');
  $('#set-swipe-dir').innerHTML = [['rtl', t('fingerRtl')], ['ltr', t('fingerLtr')]].map(([v, l]) => opt(v, l, s.swipeDir)).join('');
  $('#set-spp').value = s.spp;
  $('#set-wrap').checked = s.wrap;
  $('#set-random').checked = s.randomSlot;
}

function bindSettings() {
  const update = (patch) => {
    Object.assign(app.settings, patch);
    writeStore(SETTINGS_KEY, app.settings);
    renderResults();
    renderRoute();
  };
  $('#set-category').addEventListener('change', (e) => update({ category: e.target.value }));
  $('#set-sort').addEventListener('change', (e) => update({ sort: e.target.value }));
  $('#set-diff').addEventListener('change', (e) => update({ diff: e.target.value }));
  $('#set-chart').addEventListener('change', (e) => update({ chartType: e.target.value }));
  $('#set-version-order').addEventListener('change', (e) => update({ versionOrder: e.target.value }));
  $('#set-swipe-dir').addEventListener('change', (e) => update({ swipeDir: e.target.value }));
  $('#set-spp').addEventListener('input', (e) => {
    const n = Math.max(0, Math.min(200, Math.floor(Number(e.target.value) || 0)));
    update({ spp: n });
  });
  $('#set-wrap').addEventListener('change', (e) => update({ wrap: e.target.checked }));
  $('#set-random').addEventListener('change', (e) => update({ randomSlot: e.target.checked }));
}

// ---------- search ----------

function renderResults() {
  const list = $('#results');
  if (!app.db) return;
  if (!app.query.trim()) { list.innerHTML = ''; return; }
  const songs = search(app.index, app.query);
  if (!songs.length) { list.innerHTML = `<li class="empty">${esc(t('noResults'))}</li>`; return; }
  list.innerHTML = songs.map((song) => `
    <li class="result${song.id === app.targetId ? ' selected' : ''}" data-id="${esc(song.id)}">
      <button class="pick" data-action="target" data-id="${esc(song.id)}">
        ${jacket(song)}
        <span class="info">
          <span class="title">${esc(song.title)}</span>
          <span class="artist">${esc(song.artist)}</span>
          <span class="meta">${songMeta(song)}${levelChips(song)}</span>
        </span>
      </button>
      <button class="here" data-action="current" data-id="${esc(song.id)}">${esc(t('iAmHere'))}</button>
    </li>`).join('');
}

function setTarget(id) {
  app.targetId = id;
  if (targetFromHash() !== id) history.replaceState(null, '', id ? `#song=${id}` : location.pathname + location.search);
  renderResults();
  renderRoute();
  if (id) $('#route').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setCurrent(id) {
  app.currentId = id;
  writeStore(CURRENT_KEY, id);
  renderCurrent();
  renderRoute();
}

function renderCurrent() {
  const box = $('#current');
  const song = app.currentId && app.byId.get(app.currentId);
  if (!song) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `${jacket(song, 'jacket small')}<span>${esc(t('cursorOn'))}：<b>${esc(song.title)}</b></span>
    <button data-action="clear-current">${esc(t('clear'))}</button>`;
}

// ---------- route ----------

function fingerFor(dir) {
  const toward3 = app.settings.swipeDir === 'rtl' ? t('fingerRtl') : t('fingerLtr');
  const toward6 = app.settings.swipeDir === 'rtl' ? t('fingerLtr') : t('fingerRtl');
  return dir === 'left' ? toward6 : toward3;
}

function renderRoute() {
  const box = $('#route');
  if (!app.db) return;
  const song = app.targetId && app.byId.get(app.targetId);
  if (!song) { box.innerHTML = `<p class="prompt">${esc(t('pickPrompt'))}</p>`; return; }

  const s = app.settings;
  const folders = buildFolders(app.db, s);
  const plan = planRoute(folders, song.id, { currentId: app.currentId, wrap: s.wrap, randomSlot: s.randomSlot, songsPerSwipe: s.spp });
  if (!plan) { box.innerHTML = `<p class="prompt">${esc(t('noResults'))}</p>`; return; }

  const f = plan.folder;
  const btnF = f.dir === 'left' ? '6' : '3';
  let folderLine;
  if (f.dir === 'none') folderLine = f.fromCurrent ? t('alreadyInFolder') : t('isFirstFolder');
  else folderLine = f.fromCurrent ? t('fromCurrentFolder', f.fromLabel, btnF, f.steps) : t('fromFirstFolder', f.fromLabel, btnF, f.steps);

  const p = plan.song;
  const btnS = p.dir === 'left' ? '6' : '3';
  const actions = [];
  if (p.dir === 'none') actions.push(t('onIt'));
  else {
    if (p.swipes) actions.push(t('swipe', p.swipes, fingerFor(p.dir)));
    if (p.presses) actions.push(p.swipes ? t('thenPress', btnS, p.presses) : t('press', btnS, p.presses));
  }
  const startSong = p.startIsCurrent ? app.byId.get(app.currentId) : null;
  const startLine = startSong ? t('startCurrent', startSong.title) : t('startFirst');

  const landmarks = p.landmarks.length
    ? `<div class="landmarks"><p>${esc(t('landmarksTitle'))}</p><ol>${p.landmarks.map((l) =>
        `<li><span class="n">${esc(t('landmarkN', l.swipe))}</span>${l.song ? esc(l.song.title) : esc(t('randomSlot'))}</li>`).join('')}</ol></div>`
    : '';

  const neighbors = plan.neighbors.map((n) => `
    <button class="nb${n.offset === 0 ? ' target' : ''}" data-action="target" data-id="${esc(n.song.id)}">
      ${jacket(n.song, 'jacket')}
      <span class="nb-off">${n.offset === 0 ? '★' : (n.offset > 0 ? '+' : '') + n.offset}</span>
      <span class="nb-title">${esc(n.song.title)}</span>
    </button>`).join('');

  const notes = [t('noteHidden')];
  if (song.sortEst && s.sort === 'recommended') notes.unshift(t('noteEst'));
  if (song.verEst && s.category === 'version') notes.unshift(t('noteVerEst'));
  if (song.locked) notes.unshift(t('noteLocked'));
  if (s.category === 'level' || s.sort === 'level') notes.push(t('noteLevel'));
  if (s.sort === 'date') notes.push(t('noteDate'));

  box.innerHTML = `
    <div class="target-card">
      ${jacket(song, 'jacket big')}
      <div class="info">
        <h2>${esc(song.title)}</h2>
        <p class="artist">${esc(song.artist)}</p>
        <p class="meta">${songMeta(song)}${levelChips(song)}</p>
      </div>
    </div>
    <ol class="steps">
      <li class="step">
        <h3><span class="num">1</span>${esc(t('step1'))}</h3>
        <p class="big">${esc(f.label)}</p>
        <p>${esc(t('folderOf', f.index + 1, f.count))}</p>
        <p class="action">${esc(folderLine)}</p>
      </li>
      <li class="step">
        <h3><span class="num">2</span>${esc(t('step2'))}</h3>
        <p class="big">${esc(t('fromLeft', p.fromLeft))}</p>
        <p>${esc(t('countAndRight', p.count, p.fromRight))}</p>
        <p class="action">${actions.map(esc).join('<br>')}</p>
        <p class="hint">${esc(startLine)}</p>
        ${landmarks}
      </li>
    </ol>
    <h3 class="nb-head">${esc(t('neighborsTitle'))}</h3>
    <div class="neighbors">${neighbors}</div>
    <button class="set-here" data-action="current" data-id="${esc(song.id)}">${esc(t('setHere'))}</button>
    <ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
}

// ---------- chrome ----------

function renderStatic() {
  document.title = t('appTitle');
  $('#app-title').textContent = t('appTitle');
  $('#app-sub').textContent = t('appSub');
  $('#lang').textContent = t('langToggle');
  $('#lbl-game').textContent = t('gameSettings');
  $('#lbl-category').textContent = t('category');
  $('#lbl-sort').textContent = t('sort');
  $('#lbl-diff').textContent = t('difficulty');
  $('#lbl-chart').textContent = t('chartType');
  $('#q').placeholder = t('searchPlaceholder');
  $('#lbl-assumptions').textContent = t('assumptions');
  $('#lbl-spp').textContent = t('spp');
  $('#hint-spp').textContent = t('sppHint');
  $('#lbl-wrap').textContent = t('wrap');
  $('#lbl-random').textContent = t('randomSlotSetting');
  $('#lbl-version-order').textContent = t('versionOrder');
  $('#lbl-swipe-dir').textContent = t('swipeDir');
  $('#sources').textContent = t('sources');
  renderMeta();
}

function renderMeta() {
  const el = $('#data-info');
  if (!app.db) { el.textContent = t('loading'); return; }
  const date = (app.db.generatedAt || '').slice(0, 10);
  let text = t('dataInfo', app.db.songs.length, date);
  if (app.changes && !app.changes.initial) text += ' · ' + t('latest', app.changes.date, app.changes.added.length, app.changes.removed.length);
  el.textContent = text;
}

function renderAll() {
  renderStatic();
  renderSettings();
  renderCurrent();
  renderResults();
  renderRoute();
}

async function load() {
  renderAll();
  try {
    const res = await fetch('data/songs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    app.db = await res.json();
  } catch (e) {
    $('#data-info').textContent = t('loadError');
    return;
  }
  app.index = buildIndex(app.db.songs);
  for (const s of app.db.songs) app.byId.set(s.id, s);
  if (app.currentId && !app.byId.has(app.currentId)) setCurrent(null);
  app.targetId = targetFromHash();
  renderAll();
  fetch('data/changes.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => { app.changes = c; renderMeta(); })
    .catch(() => {});
}

let timer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(timer);
  timer = setTimeout(() => { app.query = e.target.value; renderResults(); }, 80);
});
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(timer);
    app.query = e.target.value;
    renderResults();
    const first = $('#results [data-action="target"]');
    if (first) first.click();
  }
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  if (action === 'target') setTarget(id);
  else if (action === 'current') setCurrent(id);
  else if (action === 'clear-current') setCurrent(null);
});
window.addEventListener('hashchange', () => {
  const id = targetFromHash();
  if (id !== app.targetId) { app.targetId = id; renderResults(); renderRoute(); }
});
$('#lang').addEventListener('click', () => { setLang(lang() === 'zh' ? 'en' : 'zh'); renderAll(); });

bindSettings();
setLang(lang());
load();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
