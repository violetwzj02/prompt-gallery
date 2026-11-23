#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Character-folder and grouping checks for scripts/ingest_quyi.py."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import ingest_quyi as q


class ResolveCharacterTests(unittest.TestCase):
    def test_short_display_keeps_franchise(self):
        r = q.resolve_character("甘雨（原神）", "high", "aaaaaaaa-1111")
        self.assertEqual(r["displayName"], "甘雨")
        self.assertEqual(r["franchise"], "原神")
        self.assertEqual(r["collectionId"], "eighteen-ganyu")
        self.assertFalse(r["pending"])

    def test_priority_examples(self):
        for raw, display, slug in (
            ("申鹤（原神）", "申鹤", "shenhe"),
            ("蒂法（最终幻想7）", "蒂法", "tifa"),
            ("雷神（原神）", "雷神", "raiden"),
        ):
            r = q.resolve_character(raw, "high")
            self.assertEqual(r["displayName"], display)
            self.assertEqual(r["collectionId"], f"eighteen-{slug}")

    def test_medium_confidence_keeps_name(self):
        r = q.resolve_character("小医仙（斗破苍穹）", "medium")
        self.assertEqual(r["displayName"], "小医仙")
        self.assertFalse(r["pending"])

    def test_overrides_do_not_invent(self):
        r = q.resolve_character(
            "Dragon Girl（Apotheosis / 百炼成神，英文名未给出对应中文）", "high"
        )
        self.assertEqual(r["displayName"], "Dragon Girl")
        self.assertEqual(r["franchise"], "百炼成神")
        r2 = q.resolve_character("Feng Nianyun / 凤年芸（百炼成神）", "high")
        self.assertEqual(r2["displayName"], "凤年芸")

    def test_pending_buckets(self):
        cases = [
            (None, "uncertain", "bbbbbbbb", "nameless"),
            ("一战苍穹未具名角色", "uncertain", "cccccccc", "source-pending-label"),
            ("魅魔（未具名）", "uncertain", "dddddddd", "source-pending-label"),
            ("未具名（白骑士洛丽塔）", "uncertain", "eeeeeeee", "source-pending-label"),
            ("甘雨（原神）", "uncertain", "ffffffff", "uncertain"),
        ]
        for name, conf, uuid, reason in cases:
            r = q.resolve_character(name, conf, uuid)
            self.assertEqual(r["displayName"], "待归类", msg=name)
            self.assertTrue(r["pending"])
            self.assertEqual(r["pendingReason"], reason)

    def test_promptless_uuids_go_pending(self):
        for prefix in q.PROMPTLESS_UUID_PREFIXES:
            r = q.resolve_character("蒂法（最终幻想7）", "high", f"{prefix}-ffff-xxxx")
            self.assertEqual(r["displayName"], "待归类")
            self.assertEqual(r["pendingReason"], "promptless-still")

    def test_sort_puts_examples_first_and_pending_last(self):
        names = ["待归类", "小舞", "蒂法", "甘雨", "申鹤", "雷神", "Saber"]
        counts = {"小舞": 13, "Saber": 14, "蒂法": 17, "甘雨": 11, "申鹤": 14, "雷神": 3, "待归类": 59}
        ordered = q.sort_display_names(names, counts)
        self.assertEqual(ordered[:4], ["甘雨", "申鹤", "蒂法", "雷神"])
        self.assertEqual(ordered[-1], "待归类")
        self.assertEqual(ordered[4], "Saber")  # higher count than 小舞 after priority block


class GroupingTests(unittest.TestCase):
    def test_same_prompt_stills_merge_and_videos_stay_siblings(self):
        items = [
            {
                "uuid": "11111111-aaaa-bbbb-cccc-000000000001",
                "type": "still",
                "prompt": "pose A prompt",
                "character": "甘雨（原神）",
                "character_confidence": "high",
                "grouping_key": "甘雨（原神） || pose A prompt",
            },
            {
                "uuid": "11111111-aaaa-bbbb-cccc-000000000002",
                "type": "still",
                "prompt": "pose A prompt",
                "character": "甘雨（原神）",
                "character_confidence": "high",
                "grouping_key": "甘雨（原神） || pose A prompt",
            },
            {
                "uuid": "22222222-aaaa-bbbb-cccc-000000000003",
                "type": "video",
                "duration": "0:10",
                "prompt": "pose A prompt",
                "character": "甘雨（原神）",
                "character_confidence": "high",
                "grouping_key": "甘雨（原神） || pose A prompt",
            },
            {
                "uuid": "33333333-aaaa-bbbb-cccc-000000000004",
                "type": "still",
                "prompt": "another pose",
                "character": "申鹤（原神）",
                "character_confidence": "high",
                "grouping_key": "申鹤（原神） || another pose",
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            cards, meta, album = q.build_payload(items, Path(tmp), write_display=False)
        still_cards = [c for c in cards["items"] if c["medium"] == "图像"]
        video_cards = [c for c in cards["items"] if c["medium"] == "视频"]
        ganyu_swipe = next(c for c in still_cards if c["collection"] == "甘雨")
        self.assertEqual(ganyu_swipe["category"], "18+")
        self.assertEqual(ganyu_swipe["parentId"], "eighteen-ganyu")
        self.assertEqual(ganyu_swipe["grokPrompt"], "pose A prompt")
        self.assertIn("同一提示词 · 2 张", ganyu_swipe["title"])
        self.assertEqual(len(video_cards), 1)
        self.assertEqual(video_cards[0]["parentId"], "eighteen-ganyu")
        self.assertIn("quyi-", video_cards[0].get("duplicateNote") or "")
        self.assertIsNone(ganyu_swipe.get("cover"))  # no downloads, no fake images
        self.assertEqual(len(album["items"]), 4)
        self.assertTrue(all(row["autoCategories"] == ["18+"] for row in album["items"]))
        self.assertEqual({row["displayCharacter"] for row in album["items"]}, {"甘雨", "申鹤"})
        self.assertEqual(meta["characters"][0]["displayName"], "甘雨")
        self.assertEqual(meta["stats"]["plannedSwipeGroups"], 1)
        self.assertEqual(meta["stats"]["downloadsFound"], 0)

    def test_promptless_stack_is_one_pending_card(self):
        items = []
        for i, prefix in enumerate(q.PROMPTLESS_UUID_PREFIXES):
            items.append({
                "uuid": f"{prefix}-0000-0000-0000-00000000000{i}",
                "type": "still",
                "prompt": None,
                "character": None,
                "character_confidence": "uncertain",
                "grouping_key": "uncertain || [no prompt in UI: layer/segments indoor bun / beige pants group]",
            })
        with tempfile.TemporaryDirectory() as tmp:
            cards, meta, album = q.build_payload(items, Path(tmp), write_display=False)
        self.assertEqual(len(cards["items"]), 1)
        card = cards["items"][0]
        self.assertEqual(card["collection"], "待归类")
        self.assertEqual(card["parentId"], "eighteen-pending")
        self.assertNotIn("grokPrompt", card)
        self.assertIn("无提示词", card["title"])
        self.assertTrue(all(row["customCategories"] == ["待归类"] for row in album["items"]))
        self.assertEqual(meta["characters"][-1]["displayName"], "待归类")


class ManifestSmokeTests(unittest.TestCase):
    def test_real_manifest_if_present(self):
        if not q.DEFAULT_MANIFEST.is_file():
            self.skipTest("manifest not on disk")
        items = q.load_manifest(q.DEFAULT_MANIFEST)
        self.assertEqual(len(items), 211)
        with tempfile.TemporaryDirectory() as tmp:
            cards, meta, album = q.build_payload(items, Path(tmp), write_display=False)
        self.assertEqual(meta["stats"]["plannedSwipeGroups"], 25)
        self.assertEqual(meta["stats"]["multiItemGroups"], 30)
        self.assertEqual(album["stats"]["rows"], 211)
        names = [c["displayName"] for c in meta["characters"]]
        self.assertEqual(names[:4], ["甘雨", "申鹤", "蒂法", "雷神"])
        self.assertEqual(names[-1], "待归类")
        # No guessed folders for the reserved pending source labels.
        self.assertNotIn("一战苍穹未具名角色", names)
        self.assertNotIn("魅魔", names)
        self.assertNotIn("白骑士洛丽塔", names)
        pending_cards = [c for c in cards["items"] if c["collection"] == "待归类"]
        self.assertTrue(pending_cards)
        # Every homepage card is 18+ with a character collection.
        for card in cards["items"]:
            self.assertEqual(card["category"], "18+")
            self.assertTrue(card["parentId"].startswith("eighteen-"))
            self.assertEqual(card["collection"], next(ch["displayName"] for ch in meta["characters"] if ch["collectionId"] == card["parentId"]))


if __name__ == "__main__":
    unittest.main()
