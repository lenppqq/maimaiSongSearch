#!/usr/bin/env python3
"""Build site/data/songs.json for maimai DX International ver.

Sources:
  * SEGA's official International song JSON: the authority for which songs exist,
    their genre, levels and the in-game "Recommended" order (the `sort` field).
  * otoge-db's International file: adds BPM, International release dates, and the
    newest songs that SEGA's file has not caught up with yet.

The script refuses to publish data it does not understand (unknown genre, a new
game version, a big drop in song count). Fix data/versions.json or pass
--allow-shrink, then run it again.

Usage:
  python3 scripts/fetch_data.py                     download sources and update
  python3 scripts/fetch_data.py --source-dir DIR    use DIR/official.json and DIR/otoge.json
  python3 scripts/fetch_data.py --dry-run           report changes without writing
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "site" / "data"
SONGS_PATH = OUT_DIR / "songs.json"
CHANGES_PATH = OUT_DIR / "changes.json"
VERSIONS_PATH = ROOT / "data" / "versions.json"
OVERRIDES_PATH = ROOT / "data" / "overrides.json"

OFFICIAL_URL = "https://maimai.sega.com/assets/data/maimai_songs.json"
OTOGE_URL = "https://raw.githubusercontent.com/zvuc/otoge-db/main/maimai/data/music-ex-intl.json"
USER_AGENT = "maimaiSongSearch-data-bot (+https://github.com/lenppqq/maimaiSongSearch)"

MIN_OFFICIAL_SONGS = 1000   # SEGA's file has ~1,500 entries; far fewer means a broken response
SHRINK_LIMIT = 0.03         # refuse to drop more than 3% of songs in one update
VERSION_STEP = 500          # each release spans 500 version codes since MURASAKi PLUS

# In-game Genre folder order. Each genre lists the catcode spellings used by SEGA's
# International file and by otoge-db (which keeps the Japanese names).
GENRES = [
    ("pops_anime", "POPS＆ANIME", ["POPS＆ANIME", "POPS＆アニメ"]),
    ("niconico", "niconico＆VOCALOID™", ["niconico＆VOCALOID™", "niconico＆ボーカロイド"]),
    ("touhou", "東方Project", ["東方Project"]),
    ("game_variety", "GAME＆VARIETY", ["GAME＆VARIETY", "ゲーム＆バラエティ"]),
    ("maimai", "maimai", ["maimai"]),
    ("ongeki_chunithm", "オンゲキ＆CHUNITHM", ["オンゲキ＆CHUNITHM"]),
    ("utage", "宴会場", ["宴会場"]),
]
GENRE_ORDER = {key: i for i, (key, _, _) in enumerate(GENRES)}
DIFFS = ["bas", "adv", "exp", "mas", "remas"]
LEVEL_RE = re.compile(r"^\d{1,2}\+?\??$")
REQUIRED = ["title", "title_kana", "artist", "catcode", "version", "image_url"]


class DataError(Exception):
    """The data looks wrong. Nothing is written when this is raised."""


def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").strip()


_CATCODES = {norm(alias): key for key, _, aliases in GENRES for alias in aliases}


def genre_of(catcode: str, title: str) -> str:
    key = _CATCODES.get(norm(catcode))
    if key is None:
        raise DataError(
            f"未知分类 catcode={catcode!r}（曲目 {title!r}）。"
            f"请在 scripts/fetch_data.py 的 GENRES 里加上这个分类和它在游戏里的位置。"
        )
    return key


def version_folder(code: int, versions: list, intl_latest: int, from_official: bool):
    """Return (folder code, estimated?) for a song's version code."""
    if code < versions[0]["code"]:
        raise DataError(f"版本代号 {code} 小于已知最早版本")
    if code >= intl_latest + VERSION_STEP:
        if from_official:
            raise DataError(
                f"官方国际版数据出现版本代号 {code}，超出 data/versions.json 里的 "
                f"intlLatest={intl_latest}。国际版可能已经更新到新版本，请在 versions.json "
                f"里加上新版本名称并把 intlLatest 改成新版本代号。"
            )
        # A Japanese-version song that International received early; it shows up in
        # International's newest version folder as far as we can tell.
        return intl_latest, True
    return max(v["code"] for v in versions if v["code"] <= code), False


def charts_of(rec: dict, title: str) -> dict:
    charts = {}
    for chart_type, prefix in (("std", "lev_"), ("dx", "dx_lev_")):
        levels = {d: rec[prefix + d] for d in DIFFS if rec.get(prefix + d)}
        for lv in levels.values():
            if not LEVEL_RE.match(lv):
                raise DataError(f"无法识别的等级 {lv!r}（曲目 {title!r}）")
        if levels:
            charts[chart_type] = levels
    return charts


def parse_bpm(text) -> float | None:
    m = re.match(r"\s*(\d+(?:\.\d+)?)", str(text or ""))
    return float(m.group(1)) if m else None


def match_key(rec: dict) -> tuple:
    """Identity used to join SEGA's file with otoge-db. Several Utage charts share a
    title and artist, so their level tells them apart. (Comments differ by language.)"""
    return (norm(rec.get("title", "")), norm(rec.get("artist", "")), rec.get("lev_utage") or "")


def release_cutoff(official: list) -> str:
    """Latest release date in SEGA's file as YYYYMMDD. Songs otoge-db added to
    International after this date are ones SEGA's file has not caught up with."""
    dates = [r.get("release", "") for r in official if re.match(r"^\d{6}$", r.get("release", ""))]
    dates = [d for d in dates if d != "000000"]
    return ("20" + max(dates)) if dates else "00000000"


def base_id(rec: dict) -> str:
    raw = "\x00".join(match_key(rec))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def validate_official(official) -> None:
    if not isinstance(official, list):
        raise DataError("官方数据不是 JSON 数组")
    if len(official) < MIN_OFFICIAL_SONGS:
        raise DataError(f"官方数据只有 {len(official)} 首，少于 {MIN_OFFICIAL_SONGS}，可能是 SEGA 返回了错误内容")
    seen = set()
    for rec in official:
        # Presence only: one real title is a single full-width space.
        missing = [f for f in REQUIRED + ["sort"] if f not in rec]
        if missing:
            raise DataError(f"官方数据缺少字段 {missing}：{rec.get('title')!r}")
        try:
            s = int(rec["sort"])
        except ValueError:
            raise DataError(f"sort 不是整数：{rec['sort']!r}（{rec['title']!r}）")
        if s in seen:
            raise DataError(f"sort 重复：{s}")
        seen.add(s)


def song_from(rec: dict, src: str, versions: list, intl_latest: int, extra: dict | None) -> dict:
    title = rec["title"]
    genre = genre_of(rec["catcode"], title)
    try:
        code = int(rec["version"])
    except ValueError:
        raise DataError(f"版本代号不是整数：{rec['version']!r}（{title!r}）")
    folder, ver_est = version_folder(code, versions, intl_latest, from_official=(src == "official"))
    song = {
        "title": title,
        "kana": rec["title_kana"],
        "artist": rec["artist"],
        "genre": genre,
        "ver": folder,
        "verCode": code,
        "img": rec["image_url"],
    }
    if genre == "utage":
        lv = rec.get("lev_utage")
        if not lv or not LEVEL_RE.match(lv):
            raise DataError(f"宴会场曲目等级无法识别：{lv!r}（{title!r}）")
        song["utage"] = {"lv": lv, "kanji": rec.get("kanji", ""), "comment": rec.get("comment", "")}
        if rec.get("buddy"):
            song["utage"]["buddy"] = True
    else:
        charts = charts_of(rec, title)
        if not charts:
            raise DataError(f"曲目没有任何谱面等级：{title!r}")
        song["charts"] = charts
    if ver_est:
        song["verEst"] = True
    if rec.get("date") == "NEW":
        song["isNew"] = True
    if rec.get("key"):
        song["locked"] = True
    info = extra or rec  # otoge-db carries bpm and dates
    bpm = parse_bpm(info.get("bpm"))
    if bpm:
        song["bpm"] = bpm
    added = info.get("date_intl_added")
    if added and re.match(r"^\d{8}$", added):
        song["added"] = added
    song["src"] = src
    return song


def build(official: list, otoge: list, versions_cfg: dict, overrides: dict):
    """Pure merge step. Returns (payload, warnings)."""
    warnings = []
    validate_official(official)
    versions = sorted(versions_cfg["versions"], key=lambda v: v["code"])
    intl_latest = int(versions_cfg["intlLatest"])
    if intl_latest not in {v["code"] for v in versions}:
        raise DataError(f"intlLatest={intl_latest} 不在 versions 列表里")

    otoge_by_key: dict = {}
    for rec in otoge or []:
        otoge_by_key.setdefault(match_key(rec), []).append(rec)

    entries = []  # (song, raw sort, id seed)
    official_keys = set()
    for rec in sorted(official, key=lambda r: int(r["sort"])):
        key = match_key(rec)
        official_keys.add(key)
        extra = (otoge_by_key.get(key) or [None])[0]
        if extra is not None and extra.get("intl") == "0":
            warnings.append(f"otoge-db 标记为非国际版，但官方数据收录，保留：{rec['title']}")
        song = song_from(rec, "official", versions, intl_latest, extra)
        entries.append((song, float(rec["sort"]), base_id(rec)))

    # Newer International songs that SEGA's file does not list yet.
    cutoff = release_cutoff(official)
    newer = []
    for r in otoge or []:
        if r.get("intl") != "1" or match_key(r) in official_keys:
            continue
        if (r.get("date_intl_added") or "") > cutoff:
            newer.append(r)
        else:
            warnings.append(f"otoge-db 有但官方数据没有，且不是新歌，跳过：{r.get('title')}")
    newer.sort(key=lambda r: (-(int(r.get("date_intl_added") or 0)), int(r.get("sort") or 0)))
    genre_min: dict = {}
    for song, raw, _ in entries:
        genre_min[song["genre"]] = min(raw, genre_min.get(song["genre"], raw))
    per_genre_count: dict = {}
    for rec in newer:
        for f in REQUIRED:
            if f not in rec:
                raise DataError(f"otoge-db 新曲缺少字段 {f}：{rec.get('title')!r}")
        song = song_from(rec, "otoge", versions, intl_latest, rec)
        song["sortEst"] = True
        g = song["genre"]
        n = per_genre_count.get(g, 0)
        per_genre_count[g] = n + 1
        # Newest first at the top of its genre; exact in-game position is unknown.
        raw = genre_min.get(g, 0) - 1000 + n
        entries.append((song, raw, base_id(rec)))

    # Stable ids: hash of title/artist(/utage comment); suffix on collision.
    used: dict = {}
    by_id = {}
    for song, raw, seed in entries:
        n = used.get(seed, 0)
        used[seed] = n + 1
        sid = seed if n == 0 else f"{seed}-{n + 1}"
        song["id"] = sid
        song["_raw"] = raw
        by_id[sid] = song

    for sid in overrides.get("exclude", []):
        if by_id.pop(sid, None) is None:
            warnings.append(f"overrides.exclude 里的 id 不存在：{sid}")
    for sid, fields in (overrides.get("patch") or {}).items():
        song = by_id.get(sid)
        if song is None:
            warnings.append(f"overrides.patch 里的 id 不存在：{sid}")
            continue
        for k, v in fields.items():
            if k == "sort":
                song["_raw"] = float(v)
            else:
                song[k] = v
        song["patched"] = True
    for rec in overrides.get("add", []):
        if not rec.get("id") or rec["id"] in by_id:
            raise DataError(f"overrides.add 记录缺少 id 或 id 重复：{rec.get('id')!r}")
        song = dict(rec)
        song["_raw"] = float(song.pop("sort", 1e9))
        song.setdefault("src", "manual")
        genre_of_key = song.get("genre")
        if genre_of_key not in GENRE_ORDER:
            raise DataError(f"overrides.add 的 genre 无效：{genre_of_key!r}")
        by_id[song["id"]] = song

    songs = sorted(by_id.values(), key=lambda s: (GENRE_ORDER[s["genre"]], s["_raw"], s["id"]))
    for i, song in enumerate(songs):
        del song["_raw"]
        song["sort"] = i

    ordered = [{k: s[k] for k in SONG_KEY_ORDER if k in s} for s in songs]
    payload = {
        "schema": 1,
        "intlLatest": intl_latest,
        "genres": [{"key": k, "name": name} for k, name, _ in GENRES],
        "versions": [v for v in versions if v["code"] <= intl_latest],
        "songs": ordered,
    }
    return payload, warnings


SONG_KEY_ORDER = [
    "id", "title", "kana", "artist", "genre", "ver", "verCode", "sort", "charts", "utage",
    "bpm", "added", "img", "isNew", "locked", "sortEst", "verEst", "patched", "src",
]


def content_of(payload: dict) -> dict:
    return {k: payload[k] for k in ("schema", "intlLatest", "genres", "versions", "songs")}


def diff(prev: dict | None, new: dict) -> dict:
    old = {s["id"]: s for s in (prev or {}).get("songs", [])}
    cur = {s["id"]: s for s in new["songs"]}
    added = [cur[i] for i in cur if i not in old]
    removed = [old[i] for i in old if i not in cur]
    changed = []
    for i in cur.keys() & old.keys():
        a, b = old[i], cur[i]
        fields = [k for k in ("title", "artist", "genre", "ver", "charts", "utage") if a.get(k) != b.get(k)]
        if fields:
            changed.append({"id": i, "title": b["title"], "fields": fields,
                            "before": {k: a.get(k) for k in fields}, "after": {k: b.get(k) for k in fields}})
    return {"added": added, "removed": removed, "changed": changed}


def check_shrink(prev: dict | None, new: dict, allow: bool) -> None:
    if not prev or allow:
        return
    before, after = len(prev.get("songs", [])), len(new["songs"])
    if before and after < before * (1 - SHRINK_LIMIT):
        raise DataError(
            f"曲目数从 {before} 降到 {after}，超过 {SHRINK_LIMIT:.0%} 的保护线。"
            f"如果确实是游戏删除了曲目，用 --allow-shrink 重新运行。"
        )


def summarize(d: dict, total: int, prev_total: int, warnings: list, today: str) -> str:
    lines = [f"## 曲库更新 {today}", "", f"- 曲目总数：{total}（之前 {prev_total}）",
             f"- 新增 {len(d['added'])} 首，删除 {len(d['removed'])} 首，信息变动 {len(d['changed'])} 首"]
    if d["added"]:
        lines += ["", "### 新增"] + [f"- {s['title']} / {s['artist']}" for s in d["added"]]
    if d["removed"]:
        lines += ["", "### 删除"] + [f"- {s['title']} / {s['artist']}" for s in d["removed"]]
    if d["changed"]:
        lines += ["", "### 变动"] + [f"- {c['title']}：{', '.join(c['fields'])}" for c in d["changed"]]
    if warnings:
        lines += ["", "### 警告"] + [f"- {w}" for w in warnings]
    return "\n".join(lines) + "\n"


def fetch(url: str, retries: int = 3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
                return json.loads(body.decode("utf-8")), resp.headers.get("Last-Modified")
        except Exception as e:  # network or JSON error
            last = e
            time.sleep(2 * (attempt + 1))
    raise DataError(f"下载失败 {url}：{last}")


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source-dir", type=Path, help="read official.json and otoge.json from this folder")
    ap.add_argument("--allow-shrink", action="store_true", help="accept a large drop in song count")
    ap.add_argument("--dry-run", action="store_true", help="print the summary without writing files")
    ap.add_argument("--commit-msg", type=Path, help="write a git commit message here when data changed")
    args = ap.parse_args(argv)

    try:
        if args.source_dir:
            official = load_json(args.source_dir / "official.json")
            otoge = load_json(args.source_dir / "otoge.json", [])
            official_lm = otoge_lm = None
        else:
            official, official_lm = fetch(OFFICIAL_URL)
            try:
                otoge, otoge_lm = fetch(OTOGE_URL)
            except DataError as e:  # supplementary source; publish without it
                print(f"::warning::{e}", file=sys.stderr)
                otoge, otoge_lm = [], None
        payload, warnings = build(official, otoge, load_json(VERSIONS_PATH), load_json(OVERRIDES_PATH, {}))
        prev = load_json(SONGS_PATH)
        check_shrink(prev, payload, args.allow_shrink)
    except DataError as e:
        print(f"::error::{e}", file=sys.stderr)
        return 1

    for w in warnings:
        print(f"::warning::{w}", file=sys.stderr)

    if prev and content_of(prev) == content_of(payload):
        print("曲库没有变化。")
        return 0

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    # The first build has nothing to compare against, so it reports no per-song changes.
    d = diff(prev, payload) if prev else {"added": [], "removed": [], "changed": []}
    summary = summarize(d, len(payload["songs"]), len((prev or {}).get("songs", [])), warnings, today)
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(summary)
    if args.dry_run:
        return 0

    payload = {
        "schema": payload["schema"],
        "generatedAt": now.isoformat(timespec="seconds"),
        "sources": {
            "official": {"url": OFFICIAL_URL, "lastModified": official_lm, "count": len(official)},
            "otoge": {"url": OTOGE_URL, "lastModified": otoge_lm, "count": len(otoge or [])},
        },
        **{k: v for k, v in payload.items() if k != "schema"},
    }
    write_json(SONGS_PATH, payload)
    brief = lambda s: {"id": s["id"], "title": s["title"], "artist": s["artist"]}
    write_json(CHANGES_PATH, {
        "date": today,
        "initial": prev is None,
        "added": [brief(s) for s in d["added"]],
        "removed": [brief(s) for s in d["removed"]],
        "changed": [{"id": c["id"], "title": c["title"], "fields": c["fields"]} for c in d["changed"]],
    })
    if args.commit_msg:
        head = f"data: update song list (+{len(d['added'])} -{len(d['removed'])} ~{len(d['changed'])})"
        args.commit_msg.write_text(head + "\n\n" + summary, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
