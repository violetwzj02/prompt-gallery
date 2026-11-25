#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import one extra Imagine collection into the cloud album as its own category.

  python3 scripts/album_extra_import.py --slug zhuanghui --category 转绘 \
      --dir "I:/wangzhanbending/extra/zhuanghui" --names "I:/wangzhanbending/extra/zhuanghui/names.json"

Steps: ensure the album category exists -> ensure the Drive folder -> upload each
image (md5 de-dup against the folder) -> insert album_items rows.
Titles come from names.json keyed by file stem ("001"); missing entries fall back
to "<category> · 未命名".
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib import parse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import album_import as imp  # noqa: E402

STATE = ROOT / "covers-inbox" / "album"


def ensure_category(name: str) -> None:
    headers = {**imp.supabase_headers(), "Prefer": "return=representation"}
    status, data = imp.http_json("GET", f"{imp.supabase_base()}/rest/v1/album_categories?select=name,kind&name=eq.{parse.quote(name)}", headers)
    if status == 200 and data:
        print(f"分类已存在：{name}（{data[0].get('kind')}）")
        return
    status, data = imp.http_json(
        "POST",
        f"{imp.supabase_base()}/rest/v1/album_categories",
        headers,
        {"name": name, "kind": "custom"},
    )
    if status not in (200, 201):
        if status == 409:
            print(f"分类已存在：{name}")
            return
        raise SystemExit(f"建分类失败 {status}: {data}")
    print(f"已建分类：{name}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True)
    ap.add_argument("--category", required=True)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--names", default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    folder = Path(args.dir)
    images = sorted(p for p in folder.glob("*.jpg") if p.is_file())
    if args.limit:
        images = images[: args.limit]
    if not images:
        raise SystemExit(f"{folder} 里没有图片")

    names: dict[str, str] = {}
    if args.names and Path(args.names).is_file():
        names = json.loads(Path(args.names).read_text(encoding="utf-8"))

    meta = {}
    meta_path = folder / "meta.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))

    if args.dry_run:
        print(f"[dry-run] 会处理 {len(images)} 张 -> 分类「{args.category}」")
        for image in images[:3]:
            print("  ", image.name, "->", names.get(image.stem, f"{args.category} · 未命名"))
        return

    ensure_category(args.category)
    token = imp.google_token()
    root_id = imp.album_root(token)
    cache_path = STATE / "folders.json"
    folder_cache = imp.load_ledger(cache_path, "folders")
    target_id = imp.ensure_folder(token, root_id, args.category, folder_cache)
    imp.save_ledger(cache_path, "folders", folder_cache)

    existing = set()
    for child in imp.drive_list_children(token, target_id):
        if child.get("md5Checksum"):
            existing.add(child["md5Checksum"])

    ledger_path = STATE / f"uploads-{args.slug}.json"
    ledger = imp.load_ledger(ledger_path, "uploads")
    rows = []
    for image in images:
        digest = hashlib.md5(image.read_bytes()).hexdigest()
        if digest in existing:
            print(f"  跳过重复 {image.name}", file=sys.stderr)
            continue
        title = names.get(image.stem) or f"{args.category} · 未命名"
        uploaded = imp.upload_file(token, target_id, image, f"{title}.jpg")
        existing.add(uploaded.get("md5Checksum") or digest)
        ledger[image.stem] = {
            "driveFileId": uploaded["id"],
            "title": title,
            "size": int(uploaded.get("size") or image.stat().st_size),
        }
        rows.append(
            {
                "drive_file_id": uploaded["id"],
                "title": title,
                "source": "upload",
                "mime_type": "image/jpeg",
                "size_bytes": min(int(uploaded.get("size") or image.stat().st_size), 52428800),
                "auto_categories": [],
                "custom_categories": [args.category],
            }
        )
        print(f"  ↑ {title}", file=sys.stderr)
        if len(rows) % 10 == 0:
            imp.save_ledger(ledger_path, "uploads", ledger)

    imp.save_ledger(ledger_path, "uploads", ledger)
    if not rows:
        print("没有需要写入的图片")
        return
    headers = {**imp.supabase_headers(), "Prefer": "return=representation"}
    status, data = imp.http_json("POST", f"{imp.supabase_base()}/rest/v1/album_items", headers, rows)
    if status not in (200, 201):
        raise SystemExit(f"写相册失败 {status}: {str(data)[:300]}")
    print(f"完成：上传 {len(rows)} 张，写入相册 {len(data)} 条")


if __name__ == "__main__":
    main()
