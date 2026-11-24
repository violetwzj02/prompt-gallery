#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate the built-in Grok category import (counts, ids, covers, collections)."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMPTS = ROOT / "public" / "data" / "prompts.json"
META = ROOT / "public" / "data" / "meta.json"
ORIGINALS = ROOT / "public" / "data" / "originals.json"
TYPES = ROOT / "src" / "types.ts"

EXPECTED_TOTAL = 251
EXPECTED_GROK = 35
EXPECTED_COLLECTIONS = {
    "grok-renxiang": ("人像写真", 16),
    "grok-haibao": ("海报封面", 8),
    "grok-chahua": ("插画角色", 6),
    "grok-changjing": ("场景概念", 3),
    "grok-chanpin": ("产品转化", 2),
}
SKIPPED_IDS = {"grok-3580", "grok-3581", "grok-6541", "grok-2838"}
SKIPPED_TITLES = {"日系朦胧感美女", "梦幻般美女胶片照片", "林间斑驳阳光下的格纹自拍", "女子公寓电梯内自拍"}
REQUIRED_SOURCE_IDS = {
    3584, 3585, 3586, 3589, 3593, 6488, 6517, 6524, 6561, 2745, 2758, 2774,
    2775, 2859, 3027, 3071, 3569, 3570, 3571, 3572, 3573, 3574, 3576, 3591,
    3577, 3578, 3579, 3582, 3583, 3590, 3568, 3575, 3592, 3587, 3588,
}

failures: list[str] = []


def check(name: str, cond, detail="") -> None:
    if cond:
        print(f"ok  {name}")
        return
    msg = f"fail  {name}" + (f": {detail}" if detail else "")
    print(msg)
    failures.append(msg)


def main() -> int:
    data = json.loads(PROMPTS.read_text(encoding="utf-8"))
    meta = json.loads(META.read_text(encoding="utf-8"))
    originals = json.loads(ORIGINALS.read_text(encoding="utf-8"))
    items = data["items"]
    grok = [it for it in items if it["category"] == "Grok"]

    check("prompts count field", data["count"] == EXPECTED_TOTAL, f"{data['count']}")
    check("items length", len(items) == EXPECTED_TOTAL, f"{len(items)}")
    check("meta count", meta["count"] == EXPECTED_TOTAL, f"{meta['count']}")
    check("Grok item count", len(grok) == EXPECTED_GROK, f"{len(grok)}")
    check("categories.Grok", data["categories"].get("Grok") == EXPECTED_GROK, str(data["categories"]))
    check("meta.categories.Grok", meta["categories"].get("Grok") == EXPECTED_GROK)
    check("existing 人物 count unchanged", data["categories"].get("人物") == 27, str(data["categories"].get("人物")))
    check("existing MJ count unchanged", data["categories"].get("MJ") == 18)

    ids = [it["id"] for it in items]
    check("all ids unique", len(ids) == len(set(ids)), f"dupes={ [i for i,n in Counter(ids).items() if n>1] }")
    check("no skipped ids", not (set(ids) & SKIPPED_IDS), str(set(ids) & SKIPPED_IDS))
    check(
        "no skipped titles in Grok or 18+",
        not any(it["title"] in SKIPPED_TITLES and it["category"] in {"Grok", "18+"} for it in items),
    )

    grok_ids = {it["id"] for it in grok}
    expected_ids = {f"grok-{n}" for n in REQUIRED_SOURCE_IDS}
    check("expected grok ids present", grok_ids == expected_ids, f"missing={expected_ids-grok_ids} extra={grok_ids-expected_ids}")
    check("all grok ids use grok- prefix", all(it["id"].startswith("grok-") for it in grok))
    check("all grok slugs are grok", all(it["categorySlug"] == "grok" for it in grok))

    types = TYPES.read_text(encoding="utf-8")
    check("types include BuiltinCategory Grok", "| 'Grok'" in types or '| "Grok"' in types)
    check("types CATEGORY_SLUG Grok", "Grok: 'grok'" in types)
    check("types FIXED_RAIL includes Grok", "'Grok'" in types)

    by_parent = Counter(it["parentId"] for it in grok)
    collections = {c["id"]: c for c in data.get("collections") or []}
    meta_cols = {c["id"]: c for c in meta.get("collections") or []}
    for cid, (name, count) in EXPECTED_COLLECTIONS.items():
        check(f"collection {cid} item count", by_parent[cid] == count, f"{by_parent[cid]}")
        col = collections.get(cid)
        check(f"collection {cid} listed", col is not None)
        if col:
            check(f"collection {cid} name", col["name"] == name, col["name"])
            check(f"collection {cid} category", col["category"] == "Grok")
            check(f"collection {cid} count field", col["count"] == count, str(col["count"]))
        check(f"meta collection {cid}", meta_cols.get(cid, {}).get("count") == count)
        members = [it for it in grok if it["parentId"] == cid]
        indexes = [it["collectionIndex"] for it in members]
        check(
            f"collection {cid} indexes 1..n",
            sorted(indexes) == list(range(1, count + 1)),
            str(indexes),
        )
        check(f"collection {cid} total field", all(it["collectionTotal"] == count and it["collection"] == name for it in members))

    check("collection counts sum to 35", sum(by_parent.values()) == EXPECTED_GROK)

    files = originals.get("files") or {}
    for it in grok:
        cover = it.get("cover") or ""
        path = ROOT / "public" / cover
        check(f"cover exists {it['id']}", path.is_file(), cover)
        covers = it.get("covers") or []
        check(f"covers[] has display jpg {it['id']}", cover in covers and cover.endswith(".jpg"))
        ref = files.get(cover)
        check(f"originals.json maps {it['id']}", isinstance(ref, dict) and bool(ref.get("original")))
        if ref:
            opath = ROOT / "public" / ref["original"]
            check(f"original file exists {it['id']}", opath.is_file(), ref.get("original"))
            if opath.is_file() and ref.get("bytes"):
                check(f"original size {it['id']}", opath.stat().st_size == ref["bytes"], f"{opath.stat().st_size} vs {ref['bytes']}")
        check(f"source is share url {it['id']}", str(it.get("source") or "").startswith("https://miku.app.itstudio.club/") and "/inspiration/share/" in str(it.get("source")))
        check(f"promptText present {it['id']}", bool((it.get("promptText") or "").strip()))
        check(f"has chinese or grok prompt {it['id']}", bool(it.get("chinesePrompt") or it.get("grokPrompt")))

    girl = next((it for it in grok if it["id"] == "grok-3584"), None)
    check("Gril typo cleaned", girl is not None and girl["title"] == "Raw photoreal high fidelity Girl")
    bio = next((it for it in grok if it["id"] == "grok-3568"), None)
    check(
        "BioEden title cleaned",
        bio is not None and bio["title"] == "BioEden Reveal Trailer" and "![" not in bio["title"] and "<" not in bio["title"],
    )
    check("BioEden prompt semantics kept", bio is not None and "BioEden" in (bio.get("promptText") or ""))

    cat_jpg = ROOT / "public" / "covers" / "categories" / "grok.jpg"
    cat_svg = ROOT / "public" / "covers" / "categories" / "grok.svg"
    check("category grok.jpg exists", cat_jpg.is_file() and cat_jpg.stat().st_size > 0)
    check("category grok.svg exists", cat_svg.is_file() and "Grok" in cat_svg.read_text(encoding="utf-8"))

    if failures:
        print(f"\n{len(failures)} failed")
        return 1
    print("\nall grok import checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
