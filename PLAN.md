# maimai Song Navigator — Plan

## Status (2026-10-08)

MVP is built and deployed. What changed from the original plan:

* **No build step.** The site is plain ES modules in `site/` and the data script is Python stdlib, because this Mac has no Node. CI runs the engine tests with Node.
* **SEGA's International JSON lags the cabinets.** On 2026-10-07 it was last modified 2026-07-17, while otoge-db already listed 25 International songs added 2026-07-31 to 2026-10-02. The script now merges otoge-db: songs it marks International and dated after the newest `release` in SEGA's file are added at the top of their genre with `sortEst: true`. Older songs missing from SEGA's file are skipped with a warning.
* **Join key.** Songs are matched on NFKC title + artist; Utage charts also on `lev_utage`, because SEGA's International comments are English and otoge-db's are Japanese.
* **Search.** Matches title, artist, SEGA's kana sort key, hiragana/katakana and romaji, with long vowels folded so "gosutoruru" finds ゴーストルール. English nicknames ("ghost rule") still need an alias list.
* **Update pipeline.** `.github/workflows/update-and-deploy.yml` runs daily, fails on unknown genres, new version codes, a >3% song-count drop or malformed fields, commits `site/data/*.json` when changed, and deploys to GitHub Pages. Manual fixes live in `data/overrides.json`. See README.

Still open: the arcade test checklist in §1.4, aliases, unlock-aware counts.

---

A mobile-first web app for maimai DX **International ver.** (US cabinets). You type a song,
tell the app how your song list is currently grouped/sorted in-game, and it tells you
which folder to open and how many swipes / button presses get you to the song.

---

## 1. What we know about the game (research summary)

### 1.1 Song-select controls (International ver.)
| Action | Input |
|---|---|
| Move to folder/song on the **left** | Button **6** (one step per press) |
| Move to folder/song on the **right** | Button **3** (one step per press) |
| Scroll fast | Slide finger left/right **near the center of the screen** (official FAQ). Songs-per-swipe is **not documented** → must be calibrated. |
| Open category / sort menu | The blue (1P) / red (2P) ◀▶ buttons above the Aime reader |
| Switch DX ↔ Standard chart | Buttons 7 + 2 together |
| Difficulty down / up | Buttons 8 / 1 (and 6 / 3 on the difficulty screen) |
| Confirm / back | 4 / 5 |

Song select has an on-screen timer (FAQ hints ~99 s), which is the whole reason this app exists.

### 1.2 Grouping ("Category") and Sort options
Only **one** grouping and **one** sort can be active at a time (filters don't exist in DX).

**Category (grouping):** Genre *(default)* · Title · Level · Version · Rank · All songs.
Later versions also show extra folders (e.g. "新曲だよ！/New songs", recommendation, play-history folders). Their presence/position on the intl build must be checked in-game.

**Sort (within every folder):** Recommended *(default)* · Title · Level · Date added · BPM · Rank · FC/AP mark · SYNC mark · DX score.
Rank/FC/AP/SYNC/DX-score orders depend on the player's own scores, so the app will **not** support them (we can't know the order). Level grouping/sort uses the *currently selected difficulty* of the player.

**Genre folder order** (matches the official data's `sort` blocks):
POPS & ANIME → niconico & VOCALOID → 東方Project → GAME & VARIETY → maimai → ONGEKI & CHUNITHM → 宴会場 (Utage)

**Title folders** (official FAQ: kana rows first; alphabet/number titles come *after* わ):
あ か さ た な は ま や ら わ · A–D · E–J · K–O · P–S · T–Z · 数字・他
(bucket boundaries taken from the community viewer mai-notes; verify on cabinet)

**Level folders:** 1 … 7, 7+, 8, 8+ … 14, 14+, 15 (one folder per displayed level).

**Version folders:** one per release, oldest→newest (mapping from data `version` code below).

### 1.3 Open data sources (all verified reachable on 2026-10-07)
| Source | URL | Notes |
|---|---|---|
| **Official SEGA intl song JSON** (primary) | `https://maimai.sega.com/assets/data/maimai_songs.json` | 1,467 entries (incl. 79 Utage). Fields: `title`, `title_kana`, `artist`, `catcode`, `version`, `sort`, `release`, `image_url`, `lev_*` (Standard), `dx_lev_*` (DX), `lev_remas`, `lev_utage`/`kanji`/`comment` (Utage), `key` (locked/unlock-required), `date: "NEW"`, `buddy`. Up to date through CiRCLE PLUS even though the HTML page says "last update 2023". |
| Official JP JSON (for diffing / future songs) | `https://maimai.sega.jp/data/maimai_songs.json` | 1,602 entries, same schema, JP catcode names. |
| **otoge-db** augmented intl file | `https://github.com/zvuc/otoge-db/raw/main/maimai/data/music-ex-intl.json` | Adds `intl` (0/1 availability), `date_intl_added`, `bpm`, chart constants, note counts, chart designers, wiki links. Uses JP catcode names. Good for BPM/date-added sorts and region locks. |
| Jacket images | `https://maimaidx-eng.com/maimai-mobile/img/Music/{image_url}` | 200 OK; the `maimai.sega.com/assets/img/music/` path is 404. |
| DXRating (optional, aliases/community) | https://github.com/gekichumai/dxrating (MIT) | Public catalog API advertised (`/api/v1/dxdata`) but 404 on dxrating.net as of today; treat as optional. |
| arcade-songs (zetaraku) | https://arcade-songs.zetaraku.dev/maimai/ | Reference UI; no stable public JSON found. |

Key facts from analyzing the official intl JSON:
* `sort` is a **globally unique integer 0–1534**, contiguous blocks per genre in the in-game genre order. Within a genre, newest additions (incl. songs that just got a DX chart) come first — this is almost certainly the in-game **"Recommended"** order. **Must be confirmed on a cabinet (test T1 below).**
* `title_kana` is a **pre-normalized sort key**: uppercase ASCII or katakana only, dakuten removed (ビビデバ→ヒヒテハ), small kana enlarged (ショウ→シヨウ), long vowel resolved (ハロー→ハロオ), symbols stripped. Perfect for title folders + title sort. 796 start with katakana, 661 with Latin, 10 with digits.
* Duplicate titles exist (two different songs called **Link**) → always show artist + genre in results.
* `version` code → folder name (verified by sampling known songs):
  `10000` maimai · `11000` maimai PLUS · `12000` GreeN · `13000` GreeN PLUS · `14000` ORANGE · `15000` ORANGE PLUS · `16000` PiNK · `17000` PiNK PLUS · `18000` MURASAKi · `18500` MURASAKi PLUS · `19000` MiLK · `19500` MiLK PLUS · `19900` FiNALE · `20000` でらっくす (DX) · `20500` DX PLUS · `21000` Splash · `21500` Splash PLUS · `22000` UNiVERSE · `22500` UNiVERSE PLUS · `23000` FESTiVAL · `23500` FESTiVAL PLUS · `24000` BUDDiES · `24500` BUDDiES PLUS · `25000` PRiSM · `25500` PRiSM PLUS · `26000` CiRCLE · `26500` CiRCLE PLUS (current intl) · `27000` MAGiCAL (JP only). Rule: `floor(version / 500) * 500`, except pre-DX uses 1000 steps with 18500/19500/19900 exceptions.

### 1.4 Things we could NOT find documented (must test at the arcade)
These are the assumptions the whole navigation math rests on. Treat as a one-visit test checklist:

* **T1** Recommended order within a genre folder == ascending `sort`? Check first/last 5 songs of POPS & ANIME and maimai folders.
* **T2** Where the cursor lands when you open a folder (first song? last-played song? middle?).
* **T3** Does the song wheel **wrap around** (can you go left from the first song to the last)?
* **T4** How many songs one center-screen swipe moves, and whether it depends on swipe speed/length. Also whether holding button 3/6 auto-repeats.
* **T5** Exact title-folder boundaries (A–D / E–J …) and where digit/symbol titles and the kana rows split; whether Latin titles inside a kana-row folder can occur.
* **T6** Which extra folders exist on the intl build in Genre view and where (New songs, Recommended, History, Favorites, Utage) — they shift folder counts.
* **T7** Whether locked songs (`key`) and un-unlocked songs are hidden (FAQ says yes) — these shift indices per player.
* **T8** Which Sort options exist on the intl build (BPM / Date-added may lag JP).
* **T9** Level grouping: which chart (DX vs Standard) decides the folder when a song has both.
* **T10** Is there a "random select" entry at the end of each folder (FESTiVAL+ feature) that counts as a wheel slot?

Build the engine so each of these is a **config flag / strategy**, not hard-coded.

---

## 2. Product scope

### 2.1 Core user flow
1. **Search** a song (title, kana, romaji, artist, partial/fuzzy). Results show jacket, title, artist, genre, levels.
2. **Tell the app your in-game state** (persisted in localStorage):
   * Category: Genre / Title / Level / Version / All
   * Sort: Recommended / Title / Level / Date added / BPM
   * Selected difficulty + chart type (needed for Level grouping)
   * Optional: "I'm currently in folder X on song Y" (else assume default start)
   * Calibration: songs per swipe (default e.g. 10 until T4 known)
3. **Get directions**, e.g.
   > **Folder:** niconico & VOCALOID (folder 2 of 7 — press **3** once from POPS & ANIME)
   > **Song:** #87 of 338 from the left (#252 from the right)
   > Fastest: swipe **left→right 8×** (≈80 songs), then press **3** ×7
   > Landmarks: you should pass "Song A" … arrive between "Song B" and "Song C".
4. **Neighbor strip**: 3–5 jackets before/after the target so the player can confirm visually and self-correct if their unlock state shifts the index.

### 2.2 Nice-to-have (later)
* "Me-aware" index correction: let the user mark songs they haven't unlocked; those are removed from counts.
* Aliases / nicknames search (community alias lists, e.g. DXRating aliases).
* Share link with state in URL; favorites; recent searches.
* Offline PWA (arcades have bad reception).
* JP-version toggle (same code, different JSON + catcode names).

### 2.3 Out of scope
Score-dependent sorts (Rank / FC-AP / SYNC / DX score), account login, chart constants/rating math.

---

## 3. Architecture

**Static SPA, no backend.** Everything runs client-side on a ~1 MB song dataset.

* **Stack:** Vite + TypeScript + React (or Svelte — pick one, keep it small), Tailwind for mobile layout, `minisearch` (or `fuse.js`) for fuzzy search, `wanakana` for kana⇄romaji, Vitest for unit tests, Playwright for one smoke E2E.
* **Hosting:** GitHub Pages or Cloudflare Pages. PWA via `vite-plugin-pwa`.
* **Data refresh:** GitHub Action (daily) runs the ingest script, commits `public/data/songs.json` if changed.

### 3.1 Repo layout
```
maimaiSongSearch/
  PLAN.md
  scripts/
    fetch-data.ts        # download official intl JSON (+ otoge-db), validate, normalize → public/data/songs.json
  src/
    data/
      types.ts           # Song, Chart, Difficulty, ChartType, Genre, VersionFolder
      versions.ts        # version-code → folder-name table (§1.3)
      genres.ts          # catcode → display name + order
      kana.ts            # gojūon collation + title-bucket (あ/か/…/A–D/…/数字他) logic
      load.ts            # fetch songs.json, build search index
    engine/
      grouping.ts        # buildFolders(songs, state) → Folder[] for Genre/Title/Level/Version/All
      sorting.ts         # within-folder comparators: recommended(sort), title(title_kana), level, dateAdded, bpm
      navigate.ts        # locate(song, folders) → {folderIdx, songIdx, folderSize}; plan(moves, calibration) → steps
      config.ts          # assumption flags: wrapAround, cursorStart, randomSlotAtEnd, extraFolders, songsPerSwipe
    ui/
      SearchBox, ResultList, StateBar (category/sort/difficulty), Directions, NeighborStrip, CalibrationSheet
    App.tsx
  public/data/songs.json
  tests/
    fixtures/           # small hand-made song sets + a frozen snapshot of the real JSON
    grouping.test.ts, sorting.test.ts, navigate.test.ts, kana.test.ts
```

### 3.2 Normalized song record
```ts
type Song = {
  id: string;             // stable: `${catcode}|${title}|${artist}` hash (official JSON has no id)
  title: string; titleKana: string; artist: string;
  romaji?: string;        // generated from titleKana (wanakana) for search only
  genre: 'pops_anime'|'niconico'|'touhou'|'game_variety'|'maimai'|'ongeki_chunithm'|'utage';
  versionCode: number; versionFolder: string;
  sortIndex: number;      // official `sort`
  charts: { type:'std'|'dx'|'utage'; levels: Partial<Record<'bas'|'adv'|'exp'|'mas'|'remas'|'utage', string>> }[];
  locked: boolean;        // `key` present
  isNew: boolean;         // `date === 'NEW'`
  bpm?: number; dateIntlAdded?: string; intlAvailable: boolean;   // from otoge-db when matched
  image: string;          // image_url
}
```
Join official ↔ otoge-db on `(title, artist)` after normalizing catcode names (JP↔EN); log unmatched rows in the ingest script so data drift is visible.

### 3.3 Navigation engine (pure functions, fully unit-tested)
```
buildFolders(songs, {category, sort, difficulty, chartType, config}) -> Folder[]
   Folder = { key, label, songs: Song[] }   // ordered exactly as the wheel shows them
locate(songId, folders) -> { folderIdx, idxInFolder, folderCount, folderSize }
planFolderMoves(fromFolderIdx, toFolderIdx, folderCount, wrap) -> { dir, presses }
planSongMoves(fromIdx, toIdx, size, {wrap, songsPerSwipe}) -> { dir, swipes, presses, landmarks[] }
```
Rules:
* Choose the shorter direction only if `wrapAround` is confirmed (T3); otherwise always from the cursor-start position (T2, default = first song).
* Swipes are approximate: emit `swipes = floor(distance / songsPerSwipe) - 1` (undershoot on purpose) and finish with button presses; show landmark titles at each expected swipe stop.
* Title collation: bucket by first char of `titleKana` (kana row table / Latin ranges / digits); within bucket compare by gojūon-normalized `titleKana` then `sortIndex` as tiebreak.
* Level grouping: folder = displayed level of the chosen difficulty on the chosen chart type; songs lacking that chart are excluded from that folder.
* Utage songs only appear in Genre view (own folder) — exclude elsewhere until T6 says otherwise.

---

## 4. Milestones

**M0 — Arcade test visit (can be done any time, unblocks accuracy).** Run T1–T10 with the checklist above; photograph folder lists. Record answers in `src/engine/config.ts` defaults and in a `RESEARCH.md`.

**M1 — Data pipeline (½ day).** `scripts/fetch-data.ts`: download, validate schema (zod), normalize, join otoge-db, emit `songs.json`; commit a frozen fixture for tests. GitHub Action for daily refresh.

**M2 — Engine + tests (1 day).** `grouping/sorting/navigate/kana` with Vitest. Golden tests: e.g. "Genre+Recommended: 愛♡スクリ～ム！ is POPS & ANIME #1", "Title: titles starting with digits land in 数字・他", "Version: CiRCLE PLUS folder has 24 songs".

**M3 — UI MVP (1–2 days).** Search → pick → directions + neighbor strip; state bar with category/sort/difficulty; settings persisted. Large touch targets, dark theme, works one-handed on a phone.

**M4 — Calibration & assumptions UI (½ day).** "Songs per swipe" slider with a quick calibration helper ("open folder X, swipe once, which song are you on?"). Toggles for wrap-around / cursor-start until confirmed.

**M5 — Ship (½ day).** PWA offline caching of data + jackets on demand, deploy to Pages, README.

**M6 — Polish.** Aliases, unlock-aware indices, romaji search quality, share links, JP toggle.

---

## 5. Risks and mitigations
| Risk | Mitigation |
|---|---|
| `sort` ≠ in-game Recommended order | T1 at arcade; fall back to alternative comparator (version desc, then kana) behind a flag. Neighbor strip lets users self-correct regardless. |
| Hidden/locked songs shift indices per player | Show neighbors + landmarks; later add "songs I haven't unlocked" list. |
| Swipe distance varies | Undershoot swipes, finish with exact presses; calibration slider. |
| SEGA changes JSON shape/URL | Schema validation in ingest; CI fails loudly; otoge-db as secondary source. |
| Intl build lags JP (sort options, extra folders) | Config flags per region; only expose options confirmed in T6/T8. |

---

## 6. Sources
* Official intl how-to-play (button map): https://maimai.sega.com/play/howto/
* Official intl song JSON: https://maimai.sega.com/assets/data/maimai_songs.json
* Official JP song JSON: https://maimai.sega.jp/data/maimai_songs.json
* maimai攻略wiki FAQ (category/sort lists, swipe-to-scroll, alphabet after わ行): https://gamerch.com/maimai/533362
* maimai攻略wiki ゲームシステム: https://gamerch.com/maimai/533359
* All Rhythm Game Wiki — maimai DX (grouping/sorting, per-player sort): https://argw.miraheze.org/wiki/Maimai_DX
* SilentBlue — DX changes (horizontal wheel, buttons): https://silentblue.remywiki.com/maimai_DX:1st/Changes
* otoge-db (augmented intl data): https://github.com/zvuc/otoge-db
* mai-notes (title bucket labels): https://mai-notes.com/
* DXRating: https://github.com/gekichumai/dxrating · arcade-songs: https://arcade-songs.zetaraku.dev/maimai/
* MaiUp (intl catalog sizing reference): https://github.com/Anormalm/MaiUp
