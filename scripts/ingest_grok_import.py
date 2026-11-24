#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ingest the phase-1 Miku Grok catalog into prompts.json, covers, and originals."""
from __future__ import annotations

import json
import re
import shutil
from collections import Counter, OrderedDict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMPORT = Path("/workspace/miku-grok-import")
PROMPTS = ROOT / "public" / "data" / "prompts.json"
META = ROOT / "public" / "data" / "meta.json"
ORIGINALS = ROOT / "public" / "data" / "originals.json"
ENTRIES = ROOT / "public" / "covers" / "entries"
ORIGINALS_DIR = ROOT / "public" / "covers" / "originals"
MAPPING = IMPORT / "mapping.json"

COLLECTION_ORDER = [
    ("人像写真", "grok-renxiang", "用途：Grok 人像写真提示词。"),
    ("海报封面", "grok-haibao", "用途：Grok 海报 / 封面提示词。"),
    ("插画角色", "grok-chahua", "用途：Grok 插画 / 角色设定提示词。"),
    ("场景概念", "grok-changjing", "用途：Grok 场景概念提示词。"),
    ("产品转化", "grok-chanpin", "用途：Grok 图生图 / 产品转化提示词。"),
]

STYLE_VOCAB = [
    "人像", "角色设定", "脸模", "精修", "转绘", "景别", "近景", "特写", "远景",
    "构图", "分镜", "可视化", "仙侠", "特效", "古风", "科幻", "巨构", "海报",
    "插画", "艺术字", "手写", "书法", "电商", "商品", "写实", "摄影", "电影感",
    "二次元", "Q版", "Midjourney", "图生图", "拼贴", "极简", "Cosplay",
]
MEDIUMS = ("图像", "视频", "模板", "图生提示词")
STRUCTURAL = {
    "人物", "场景", "构图", "特效", "周边", "艺术", "MJ", "MJ风格", "Grok", "自定义", "18+",
    "图像", "视频", "模板", "图生提示词",
    "人像写真", "海报封面", "插画角色", "场景概念", "产品转化",
    "仙侠人物特效", "短剧景别构图", "设计可视化", "脸模", "精修五大词",
    "黑底彩色手写艺术字", "巨构提示词", "未来景观", "邵氏赛博", "仙侠繁华试",
}

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
LETTER_RE = re.compile(r"[A-Za-z\u4e00-\u9fff]")


def is_mostly_chinese(text: str) -> bool:
    letters = LETTER_RE.findall(text or "")
    if not letters:
        return False
    cjk = CJK_RE.findall(text or "")
    return len(cjk) / len(letters) >= 0.4


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ingest_cover(src: Path, entry_id: str) -> tuple[str, dict]:
    """Copy original and write display JPEG. Returns (cover relpath, originals.json entry)."""
    ENTIRES = ENTRIES
    ENTIRES.mkdir(parents=True, exist_ok=True)
    ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = src.suffix.lower()
    if suffix == ".jpeg":
        suffix = ".jpg"
    original_name = f"{entry_id}{suffix}"
    original_path = ORIGINALS_DIR / original_name
    shutil.copy2(src, original_path)
    dest = ENTIRES / f"{entry_id}.jpg"
    if suffix == ".jpg":
        shutil.copy2(src, dest)
    else:
        im = Image.open(src)
        if im.mode in ("RGBA", "P", "LA"):
            rgba = im.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (12, 14, 16))
            bg.paste(rgba, mask=rgba.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        im.save(dest, "JPEG", quality=92, optimize=True)
    rel = f"covers/entries/{entry_id}.jpg"
    return rel, {
        "original": f"covers/originals/{original_name}",
        "filename": original_name,
        "bytes": original_path.stat().st_size,
    }


def build_body(item: dict) -> str:
    lines = [f"来源：[Miku Inspiration / Grok]({item['detailUrl']})"]
    extra = []
    if item.get("sourceCategory"):
        extra.append(f"原始分类：{item['sourceCategory']}")
    author = (item.get("author") or "").strip()
    origin = (item.get("source") or "").strip()
    if author and origin:
        extra.append(f"作者：{author}（{origin}）")
    elif author:
        extra.append(f"作者：{author}")
    elif origin:
        extra.append(f"上游来源：{origin}")
    if extra:
        lines.append("")
        lines.extend(extra)
    lines += ["", "**提示词**：", "", item["prompt"].rstrip()]
    return "\n".join(lines) + "\n"


def build_facets(items: list[dict]) -> dict:
    medium_counts = Counter(it["medium"] for it in items if it.get("medium"))
    aspect_counts = Counter(it["aspect"] for it in items if it.get("aspect"))
    style_counts: Counter = Counter()
    for it in items:
        for tag in it.get("tags") or []:
            if tag in STYLE_VOCAB and tag not in STRUCTURAL and tag != it.get("aspect"):
                style_counts[tag] += 1
    return {
        "medium": [{"name": m, "count": medium_counts[m]} for m in MEDIUMS if medium_counts[m] > 0],
        "aspect": [
            {"name": a, "count": aspect_counts[a]}
            for a in sorted(aspect_counts, key=lambda x: (-aspect_counts[x], x))
        ],
        "style": [{"name": t, "count": style_counts[t]} for t in STYLE_VOCAB if style_counts[t] > 0],
    }


def main() -> None:
    mapping = json.loads(MAPPING.read_text(encoding="utf-8"))
    importable = mapping["items"]
    if len(importable) != 35:
        raise SystemExit(f"expected 35 importable items, got {len(importable)}")

    col_meta = {name: (cid, usage) for name, cid, usage in COLLECTION_ORDER}
    by_col: dict[str, list[dict]] = OrderedDict((name, []) for name, _, _ in COLLECTION_ORDER)
    for rec in importable:
        col = rec["proposedCollection"]
        if col not in by_col:
            raise SystemExit(f"unknown collection {col} for {rec['sourceId']}")
        by_col[col].append(rec)

    prompts = json.loads(PROMPTS.read_text(encoding="utf-8"))
    existing_ids = {it["id"] for it in prompts["items"]}
    if any(it["id"].startswith("grok-") for it in prompts["items"]):
        raise SystemExit("prompts.json already has grok- items; refuse to double-ingest")

    originals = json.loads(ORIGINALS.read_text(encoding="utf-8"))
    new_items: list[dict] = []
    new_collections: list[dict] = []

    for col_name, rows in by_col.items():
        parent_id, usage = col_meta[col_name]
        total = len(rows)
        new_collections.append({
            "id": parent_id,
            "name": col_name,
            "category": "Grok",
            "count": total,
        })
        for index, rec in enumerate(rows, 1):
            entry_id = rec["suggestedId"]
            if entry_id in existing_ids:
                raise SystemExit(f"id collision: {entry_id}")
            src_name = rec.get("localImage")
            if not src_name:
                raise SystemExit(f"missing local image for {entry_id}")
            src = IMPORT / "images" / src_name
            if not src.is_file():
                raise SystemExit(f"image not found: {src}")
            cover, original_ref = ingest_cover(src, entry_id)
            originals.setdefault("files", {})[cover] = original_ref
            title = rec.get("suggestedTitle") or rec["title"]
            prompt = rec["prompt"]
            tags = list(rec["proposedTags"])
            if "Grok" not in tags:
                tags.insert(0, "Grok")
            item = {
                "id": entry_id,
                "category": "Grok",
                "categorySlug": "grok",
                "title": title,
                "usage": usage,
                "body": build_body(rec),
                "source": rec["detailUrl"],
                "cover": cover,
                "covers": [cover],
                "parentId": parent_id,
                "collection": col_name,
                "collectionIndex": index,
                "collectionTotal": total,
                "tags": tags,
                "medium": rec["medium"],
                "aspect": rec.get("aspect"),
                "promptText": prompt,
                "duplicateNote": None,
                "duplicateOf": None,
            }
            if is_mostly_chinese(prompt):
                item["chinesePrompt"] = prompt
            else:
                item["grokPrompt"] = prompt
            new_items.append(item)
            existing_ids.add(entry_id)
            print(f"ingested {entry_id} -> {cover} ({original_ref['bytes']} bytes original)")

    all_items = prompts["items"] + new_items
    cat_counts: dict[str, int] = {}
    for it in all_items:
        cat_counts[it["category"]] = cat_counts.get(it["category"], 0) + 1
    # keep original category key order, then Grok
    ordered = {}
    for key in ["人物", "场景", "构图", "特效", "周边", "艺术", "MJ", "Grok"]:
        if key in cat_counts:
            ordered[key] = cat_counts[key]
    for key, value in cat_counts.items():
        if key not in ordered:
            ordered[key] = value

    collections = list(prompts.get("collections") or []) + new_collections
    facets = build_facets(all_items)
    generated = prompts.get("generatedFrom") or ""
    suffix = " + miku grok inspiration 2026-11-24"
    if suffix not in generated:
        generated = (generated + suffix).strip(" +")

    prompts["generatedFrom"] = generated
    prompts["count"] = len(all_items)
    prompts["categories"] = ordered
    prompts["collections"] = collections
    prompts["tagFacets"] = facets
    prompts["items"] = all_items

    originals["count"] = len(originals.get("files") or {})
    originals.setdefault(
        "note",
        "Uncompressed originals for download. Display still uses covers/entries JPEGs.",
    )

    meta = {
        "generatedFrom": generated,
        "masterCount": prompts.get("masterCount"),
        "count": prompts["count"],
        "categories": ordered,
        "collections": collections,
        "tagFacets": facets,
    }

    write_json(PROMPTS, prompts)
    write_json(META, meta)
    write_json(ORIGINALS, originals)
    print(f"done: +{len(new_items)} items, total={len(all_items)}, originals={originals['count']}")
    print("categories", ordered)
    print("new collections", [(c["id"], c["count"]) for c in new_collections])


if __name__ == "__main__":
    main()
