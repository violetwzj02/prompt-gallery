#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build homepage 18+ cards from the local album originals.

Grouping rule (user's rule): one card per (character, original prompt). A card
keeps every image of the group so the homepage can flip through them.

  python3 scripts/quyi_cards_from_local.py            # covers only (option B)
  python3 scripts/quyi_cards_from_local.py --all      # covers + every image (A)

Covers go to public/covers/quyi/<cardId>.webp, images to
public/covers/quyi/<cardId>-<n>.webp. Nothing is uploaded; publishing is a
separate step.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import io
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import quyi_titles as qt  # noqa: E402

STAGE = Path(r"I:\wangzhanbending\18plus")
GRAPH = Path(r"I:\wangzhanbending\quyi-survey\asset-graph.json")
OUT = ROOT / "public" / "covers" / "quyi"
CARDS = ROOT / "public" / "data" / "quyi-cards-album.json"
CARDS_MAIN = ROOT / "public" / "data" / "quyi-cards.json"
MAX_EDGE = 420
QUALITY = 74


def card_id(character: str, prompt: str, index: int) -> str:
    digest = hashlib.sha1(f"{character}|{prompt}".encode()).hexdigest()[:10]
    return f"{index:03d}-{digest}"


def save_webp(src: Path, dst: Path) -> int:
    with Image.open(src) as img:
        img = img.convert("RGB")
        img.thumbnail((MAX_EDGE, MAX_EDGE * 2), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        img.save(dst, "WEBP", quality=QUALITY, method=4)
    return dst.stat().st_size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="同时导出卡内每一张图")
    args = ap.parse_args()

    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    assets = graph["assets"]

    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for folder in sorted(glob.glob(str(STAGE / "*"))):
        if not os.path.isdir(folder):
            continue
        character = os.path.basename(folder)
        for path in sorted(Path(folder).glob("*.jpg")):
            meta = assets.get(path.stem) or {}
            prompt = re.sub(r"\s+", "", meta.get("prompt") or "")[:160]
            key = (character, prompt or f"__noprompt__{path.stem}")
            buckets[key].append({"path": path, "created": meta.get("createTime") or ""})

    groups = sorted(buckets.items(), key=lambda kv: (-len(kv[1]), kv[0][0]))
    cards = []
    total_bytes = 0
    for index, ((character, prompt), items) in enumerate(groups, 1):
        items.sort(key=lambda it: it["created"])
        cid = card_id(character, prompt, index)
        description = qt.describe(prompt) if prompt and not prompt.startswith("__noprompt__") else None
        title = f"{character} · {description}" if description else character
        cover = OUT / f"{cid}.webp"
        total_bytes += save_webp(items[0]["path"], cover)
        images = []
        if args.all:
            for n, item in enumerate(items, 1):
                target = OUT / f"{cid}-{n}.webp"
                total_bytes += save_webp(item["path"], target)
                images.append(f"covers/quyi/{target.name}")
        cards.append(
            {
                "id": f"album-{cid}",
                "title": title,
                "collection": character,
                "category": "18+",
                "cover": f"covers/quyi/{cover.name}",
                "images": images,
                "imageCount": len(items),
                "prompt": prompt[:120] or None,
            }
        )

    # ---- 合并进首页数据：18+ 用相册卡片替换，其他分类原样保留 ----
    data = json.loads(CARDS_MAIN.read_text(encoding="utf-8"))
    keep = [item for item in data.get("items", []) if item.get("category") != "18+"]
    counters: dict[str, int] = defaultdict(int)
    totals: dict[str, int] = defaultdict(int)
    for card in cards:
        totals[card["collection"]] += 1

    new_items = []
    for card in cards:
        character = card["collection"]
        counters[character] += 1
        index = counters[character]
        slug = re.sub(r"[^a-z0-9]+", "-", character.lower()).strip("-") or "x"
        new_items.append(
            {
                "id": card["id"],
                "category": "18+",
                "categorySlug": "eighteen",
                "title": card["title"],
                "usage": f"18+ · 云端相册 · {character}",
                "body": "> 来源：Grok Imagine · 云端相册\n> 角色文件夹：" + character,
                "source": "cloud-album",
                "cover": card["cover"],
                "covers": card["images"] or [card["cover"]],
                "parentId": f"eighteen-{slug}",
                "collection": character,
                "collectionIndex": index,
                "collectionTotal": totals[character],
                "tags": [],
                "medium": "photo",
                "aspect": "portrait",
                "promptText": card["prompt"] or "",
                "grokPrompt": card["prompt"] or "",
                "imageCount": card["imageCount"],
            }
        )

    old_cols = {c["name"]: c for c in data.get("collections", []) if c.get("category") != "18+"}
    new_cols = []
    for character, total in sorted(totals.items(), key=lambda kv: -kv[1]):
        slug = re.sub(r"[^a-z0-9]+", "-", character.lower()).strip("-") or "x"
        new_cols.append({"id": f"eighteen-{slug}", "name": character, "category": "18+", "count": total})

    data["items"] = new_items + keep
    data["collections"] = new_cols + list(old_cols.values())
    data["generatedFrom"] = "cloud album (18+) + curated library"
    data["count"] = len(data["items"])
    CARDS_MAIN.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"卡片 {len(cards)}（18+ 已替换），导出体积 {total_bytes/1024/1024:.1f} MB，条目总计 {len(data['items'])}")


if __name__ == "__main__":
    main()
