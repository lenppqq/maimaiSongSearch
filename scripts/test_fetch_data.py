"""Unit tests for fetch_data.build and its guards. Run:
    python3 -m unittest discover -s scripts -p 'test_*.py' -v
"""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_data as fd  # noqa: E402

VERSIONS = {
    "intlLatest": 26500,
    "versions": [{"code": 10000, "name": "maimai"}, {"code": 26000, "name": "CiRCLE"},
                 {"code": 26500, "name": "CiRCLE PLUS"}],
}


def off(title, sort, catcode="POPS＆ANIME", version="26000", release="000000", **kw):
    rec = {"title": title, "title_kana": title.upper(), "artist": "A", "catcode": catcode,
           "version": version, "sort": str(sort), "image_url": f"{title}.png", "release": release,
           "dx_lev_bas": "3", "dx_lev_mas": "12+"}
    rec.update(kw)
    return rec


def oto(title, catcode="POPS＆アニメ", added="20260901", intl="1", version="26505", sort="5", **kw):
    rec = off(title, sort, catcode=catcode, version=version)
    rec.update({"intl": intl, "date_intl_added": added, "bpm": "180 (90-180)"})
    rec.update(kw)
    return rec


class BuildTest(unittest.TestCase):
    def setUp(self):
        self._min = fd.MIN_OFFICIAL_SONGS
        fd.MIN_OFFICIAL_SONGS = 1
        self.official = [
            off("Alpha", 0, release="260723"),
            off("Beta", 1),
            off("Gamma", 2, catcode="maimai", version="10000"),
        ]

    def tearDown(self):
        fd.MIN_OFFICIAL_SONGS = self._min

    def build(self, otoge=(), overrides=None, official=None):
        return fd.build(official or self.official, list(otoge), VERSIONS, overrides or {})

    def test_genre_order_and_dense_sort(self):
        payload, _ = self.build()
        self.assertEqual([s["title"] for s in payload["songs"]], ["Alpha", "Beta", "Gamma"])
        self.assertEqual([s["sort"] for s in payload["songs"]], [0, 1, 2])
        self.assertEqual(payload["songs"][2]["genre"], "maimai")

    def test_otoge_adds_bpm_and_date_to_official_song(self):
        payload, _ = self.build([oto("Beta", added="20200101")])
        beta = next(s for s in payload["songs"] if s["title"] == "Beta")
        self.assertEqual(beta["bpm"], 180.0)
        self.assertEqual(beta["added"], "20200101")
        self.assertEqual(beta["src"], "official")

    def test_newer_otoge_song_goes_to_top_of_its_genre(self):
        payload, _ = self.build([oto("Delta", added="20260901"), oto("Epsilon", added="20261001")])
        titles = [s["title"] for s in payload["songs"]]
        self.assertEqual(titles[:4], ["Epsilon", "Delta", "Alpha", "Beta"])
        self.assertTrue(payload["songs"][0]["sortEst"])

    def test_old_missing_otoge_song_is_skipped_with_warning(self):
        payload, warnings = self.build([oto("Old", added="20200101")])
        self.assertNotIn("Old", [s["title"] for s in payload["songs"]])
        self.assertTrue(any("Old" in w for w in warnings))

    def test_non_intl_otoge_song_is_ignored(self):
        payload, _ = self.build([oto("JPOnly", intl="0", added="20261001")])
        self.assertNotIn("JPOnly", [s["title"] for s in payload["songs"]])

    def test_unknown_genre_fails(self):
        with self.assertRaises(fd.DataError):
            self.build(official=self.official + [off("X", 9, catcode="NEW GENRE")])

    def test_new_version_in_official_fails(self):
        with self.assertRaises(fd.DataError):
            self.build(official=self.official + [off("X", 9, version="27000")])

    def test_future_version_in_otoge_is_clamped(self):
        payload, _ = self.build([oto("Delta", version="27002")])
        delta = next(s for s in payload["songs"] if s["title"] == "Delta")
        self.assertEqual(delta["ver"], 26500)
        self.assertTrue(delta["verEst"])

    def test_version_folder(self):
        v = VERSIONS["versions"]
        self.assertEqual(fd.version_folder(26012, v, 26500, True), (26000, False))
        self.assertEqual(fd.version_folder(26500, v, 26500, True), (26500, False))

    def test_bad_level_fails(self):
        with self.assertRaises(fd.DataError):
            self.build(official=self.official + [off("X", 9, dx_lev_mas="hard")])

    def test_utage_charts_sharing_a_title_get_distinct_ids(self):
        u = lambda lv: oto("[宴]W", catcode="宴会場", lev_utage=lv, kanji="宴", comment="c")
        payload, _ = self.build([u("10?"), u("11?")])
        ids = [s["id"] for s in payload["songs"] if s["title"] == "[宴]W"]
        self.assertEqual(len(set(ids)), 2)

    def test_overrides_exclude_and_patch(self):
        payload, _ = self.build()
        ids = {s["title"]: s["id"] for s in payload["songs"]}
        overrides = {"exclude": [ids["Beta"]], "patch": {ids["Gamma"]: {"sort": -5}}}
        # Gamma is in another genre, so a lower sort must not move it ahead of POPS songs.
        payload, _ = self.build(overrides=overrides)
        self.assertEqual([s["title"] for s in payload["songs"]], ["Alpha", "Gamma"])
        self.assertTrue(payload["songs"][1]["patched"])

    def test_overrides_unknown_id_warns(self):
        _, warnings = self.build(overrides={"exclude": ["nope"]})
        self.assertTrue(any("nope" in w for w in warnings))

    def test_shrink_guard(self):
        payload, _ = self.build()
        prev = copy.deepcopy(payload)
        prev["songs"] = prev["songs"] * 2
        with self.assertRaises(fd.DataError):
            fd.check_shrink(prev, payload, allow=False)
        fd.check_shrink(prev, payload, allow=True)

    def test_diff(self):
        before, _ = self.build()
        after_official = copy.deepcopy(self.official)
        after_official[1]["dx_lev_mas"] = "13"
        after, _ = self.build([oto("Delta")], official=after_official)
        d = fd.diff(before, after)
        self.assertEqual([s["title"] for s in d["added"]], ["Delta"])
        self.assertEqual([c["title"] for c in d["changed"]], ["Beta"])
        self.assertEqual(d["removed"], [])

    def test_too_few_official_songs_fails(self):
        fd.MIN_OFFICIAL_SONGS = 10
        with self.assertRaises(fd.DataError):
            self.build()


if __name__ == "__main__":
    unittest.main()
