#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reconcile album rows against what is actually in each Drive folder.

Uploads can finish while the row insert fails (JWT/409), leaving files in Drive
with no album record. This walks every character folder, rebuilds the row from
the real file (md5 -> local name -> title) and upserts with
`resolution=ignore-duplicates`, so it fills gaps and never duplicates.

  python3 scripts/album_reconcile.py [--category 待归类 ...]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import album_import as imp  # noqa: E402

STAGE = Path(r"I:\wangzhanbending\18plus")


def local_index(folder: Path) -> dict[str, tuple[str, int]]:
    """md5 -> (assetId, size) for the local files of one character."""
    import hashlib

    out = {}
    for path in folder.glob("*"):
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".mp4"}:
            continue
        try:
            digest = hashlib.md5(path.read_bytes()).hexdigest()
        except OSError:
            continue
        out[digest] = (path.stem, path.stat().st_size)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", action="append", default=None, help="只处理这些分类")
    args = ap.parse_args()

    token = imp.google_token()
    root = imp.album_root(token)
    folders = {
        c["name"]: c["id"]
        for c in imp.drive_list_children(token, root)
        if c.get("mimeType") == "application/vnd.google-apps.folder" and not c["name"].startswith("__")
    }

    total_new = 0
    for name, folder_id in sorted(folders.items()):
        if args.category and name not in args.category:
            continue
        local_dir = STAGE / name
        if not local_dir.is_dir():
            continue
        names = {}
        names_path = local_dir / "names.json"
        if names_path.is_file():
            names = json.loads(names_path.read_text(encoding="utf-8"))
        index = local_index(local_dir)

        rows = []
        for child in imp.drive_list_children(token, folder_id):
            md5 = child.get("md5Checksum")
            if not md5 or md5 not in index:
                continue
            stem, size = index[md5]
            rows.append(
                {
                    "drive_file_id": child["id"],
                    "title": names.get(stem) or name,
                    "source": "upload",
                    "mime_type": None if child.get("name", "").lower().endswith(".mp4") else "image/jpeg",
                    "size_bytes": min(int(child.get("size") or size), 52428800),
                    "auto_categories": [],
                    "custom_categories": [name],
                }
            )
        if not rows:
            continue
        inserted = 0
        headers = {**imp.supabase_headers(), "Prefer": "return=representation,resolution=ignore-duplicates"}
        for start in range(0, len(rows), 100):
            chunk = rows[start : start + 100]
            status, data = imp.http_json("POST", f"{imp.supabase_base()}/rest/v1/album_items?on_conflict=drive_file_id", headers, chunk)
            if status in (200, 201):
                inserted += len(data)
            else:
                print(f"  ! {name} 写库失败 {status}: {str(data)[:160]}", file=sys.stderr)
        print(f"{name:<12} 云盘 {len(rows)}  新增记录 {inserted}")
        total_new += inserted
    print(f"补写记录合计 {total_new}")


if __name__ == "__main__":
    main()
