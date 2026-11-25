#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild public/data/quyi-meta.json from the cloud album.

The 18+ subnav must list the same characters, in the same order, as the album
drawers. Cards only exist for a subset, so characters that live only in the
album are marked `albumOnly` and the subnav links them to the album drawer
instead of filtering to an empty list.

  python3 scripts/quyi_meta_from_album.py [--write]
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import album_import as imp  # noqa: E402

CARDS = ROOT / "public" / "data" / "quyi-cards.json"
META = ROOT / "public" / "data" / "quyi-meta.json"
PRIORITY = ["甘雨", "申鹤", "蒂法", "雷神"]
FRANCHISE = {
    "甘雨": "原神", "申鹤": "原神", "雷神": "原神", "蒂法": "最终幻想7", "Saber": "Fate",
    "小舞": "斗罗大陆", "小医仙": "斗破苍穹", "陆雪琪": "诛仙", "萧薰儿": "斗破苍穹",
    "千仞雪": "斗罗大陆", "盛彩儿": "神印王座", "宁荣荣": "斗罗大陆", "真希波": "新世纪福音战士",
    "不知火舞": "拳皇", "爱丽丝": "最终幻想7", "甘露寺蜜璃": "鬼灭之刃", "绘梨衣": "龙族",
    "凤年芸": "百炼成神", "唐舞桐": "斗罗大陆", "明日香": "新世纪福音战士", "玛丽·萝丝": "死或生",
    "米拉珍": "妖精的尾巴", "胡蝶忍": "鬼灭之刃", "艾达王": "生化危机", "葛城美里": "新世纪福音战士",
    "远坂凛": "Fate", "金克丝": "英雄联盟", "露西": None, "D.Va": "守望先锋", "02": "国家队",
}
SLUG = {
    "甘雨": "ganyu", "申鹤": "shenhe", "蒂法": "tifa", "雷神": "raiden", "Saber": "saber",
    "小舞": "xiaowu", "小医仙": "xiaoyixian", "陆雪琪": "luxueqi", "萧薰儿": "xiaoxuner",
    "千仞雪": "qianrenxue", "盛彩儿": "shengcaier", "宁荣荣": "ningrongrong", "真希波": "makinami",
    "不知火舞": "mai", "爱丽丝": "aerith", "甘露寺蜜璃": "kanroji", "绘梨衣": "erii",
    "凤年芸": "fengnianyun", "唐舞桐": "tangwutong", "明日香": "asuka", "玛丽·萝丝": "marie-rose",
    "米拉珍": "mirajane", "胡蝶忍": "shinobu", "艾达王": "ada", "葛城美里": "misato",
    "远坂凛": "rin", "金克丝": "jinx", "露西": "lucy", "D.Va": "dva", "02": "02",
    "待归类": "pending", "视频": "video",
}


def fetch_rows() -> list[dict]:
    rows: list[dict] = []
    for offset in range(0, 5000, 1000):
        status, page = imp.http_json(
            "GET",
            f"{imp.supabase_base()}/rest/v1/album_items?select=custom_categories&limit=1000&offset={offset}",
            imp.supabase_headers(),
        )
        if status != 200 or not page:
            break
        rows += page
        if len(page) < 1000:
            break
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    cards = json.loads(CARDS.read_text(encoding="utf-8"))
    card_counts = Counter()
    canonical: dict[str, str] = {}
    for item in cards.get("items", []):
        name = item.get("collection")
        if name:
            card_counts[name] += 1
            canonical.setdefault(name.lower(), name)

    album_counts = Counter()
    for row in fetch_rows():
        for raw in row.get("custom_categories") or []:
            name = canonical.get(raw.lower(), raw)
            album_counts[name] += 1

    names = list(dict.fromkeys([*album_counts.keys(), *card_counts.keys()]))
    characters = []
    for name in names:
        album = album_counts.get(name, 0)
        cards_n = card_counts.get(name, 0)
        characters.append(
            {
                "displayName": name,
                "franchise": FRANCHISE.get(name),
                "slug": SLUG.get(name) or name.lower().replace(" ", "-"),
                "collectionId": f"eighteen-{SLUG.get(name) or name.lower()}",
                "cardCount": cards_n,
                "imagineItemCount": album,
                "albumCount": album,
                "albumOnly": cards_n == 0 and album > 0,
                "pending": name in {"待归类", "视频"},
            }
        )

    def sort_key(item: dict):
        try:
            return (0, PRIORITY.index(item["displayName"]), 0, "")
        except ValueError:
            pass
        if item["pending"]:
            return (2, 0, -item["albumCount"], item["displayName"])
        return (1, 0, -max(item["albumCount"], item["cardCount"]), item["displayName"])

    characters.sort(key=sort_key)
    meta = {
        "generatedFrom": "cloud album + quyi-cards (album-first subnav)",
        "pendingName": "待归类",
        "priorityDisplay": PRIORITY,
        "characters": characters,
        "stats": {
            "cards": sum(card_counts.values()),
            "albumItems": sum(album_counts.values()),
            "characters": len([c for c in characters if not c["pending"]]),
        },
    }
    text = json.dumps(meta, ensure_ascii=False, indent=2) + "\n"
    if args.write:
        META.write_text(text, encoding="utf-8")
        print(f"写入 {META}：{len(characters)} 个分类（其中仅相册 {sum(1 for c in characters if c['albumOnly'])} 个）")
    else:
        print(text[:1200])
        print(f"... 共 {len(characters)} 个分类")


if __name__ == "__main__":
    main()
