#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Parallel uploader: push a character folder to Drive and write album rows.

  python3 scripts/album_fast_upload.py --category 待归类 --dir "I:/wangzhanbending/18plus/待归类"

Resumable: files already in the Drive folder (by md5) are skipped. Rows are
inserted in batches of 100 after uploads finish.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib import parse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import album_import as imp  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", required=True)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--only-videos", action="store_true")
    args = ap.parse_args()

    folder = Path(args.dir)
    names = {}
    names_path = folder / "names.json"
    if names_path.is_file():
        names = json.loads(names_path.read_text(encoding="utf-8"))

    patterns = ["*.mp4"] if args.only_videos else ["*.jpg", "*.png", "*.webp"]
    files: list[Path] = []
    for pattern in patterns:
        files.extend(sorted(folder.glob(pattern)))
    if not files:
        raise SystemExit("没有可上传文件")

    token = imp.google_token()
    root = imp.album_root(token)
    cache_path = imp.STATE / "folders.json"
    cache = imp.load_ledger(cache_path, "folders")
    folder_id = imp.ensure_folder(token, root, args.category, cache)
    imp.save_ledger(cache_path, "folders", cache)

    existing = {}
    for child in imp.drive_list_children(token, folder_id):
        if child.get("md5Checksum"):
            existing[child["md5Checksum"]] = child
    print(f"云盘已有 {len(existing)} 个可去重文件；本地待传 {len(files)}")

    job_path = imp.STATE / f"upload-{args.category}.json"
    done = imp.load_ledger(job_path, "done")

    def work(path: Path) -> dict | None:
        digest = hashlib.md5(path.read_bytes()).hexdigest()
        if digest in existing:
            child = existing[digest]
            return {
                "drive_file_id": child["id"],
                "title": names.get(path.stem) or args.category,
                "source": "upload",
                "mime_type": None if path.suffix.lower() == ".mp4" else "image/jpeg",
                "size_bytes": min(int(child.get("size") or path.stat().st_size), 52428800),
                "auto_categories": [],
                "custom_categories": [args.category],
            }
        title = names.get(path.stem) or args.category
        name = f"{title}{path.suffix.lower()}"
        result = imp.upload_file(token, folder_id, path, name)
        got = result.get("md5Checksum")
        if got and got != digest:
            return None
        return {
            "drive_file_id": result["id"],
            "title": title,
            "source": "upload",
            "mime_type": None if path.suffix.lower() == ".mp4" else "image/jpeg",
            "size_bytes": min(int(result.get("size") or path.stat().st_size), 52428800),
            "auto_categories": [],
            "custom_categories": [args.category],
        }

    rows = []
    failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(work, p): p for p in files if p.stem not in done}
        for index, future in enumerate(as_completed(futures), 1):
            path = futures[future]
            try:
                row = future.result()
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print(f"  ! {path.name} {exc}", file=sys.stderr)
                continue
            if row:
                rows.append(row)
                done[path.stem] = row["drive_file_id"]
            if index % 25 == 0:
                imp.save_ledger(job_path, "done", done)
                print(f"  {index}/{len(futures)} 已上传", file=sys.stderr)

    imp.save_ledger(job_path, "done", done)
    if not rows:
        print(f"没有新行（失败 {failed}）")
        return
    headers = {**imp.supabase_headers(), "Prefer": "return=representation,resolution=ignore-duplicates"}
    inserted = 0
    for start in range(0, len(rows), 100):
        chunk = rows[start : start + 100]
        status, data = imp.http_json("POST", f"{imp.supabase_base()}/rest/v1/album_items?on_conflict=drive_file_id", headers, chunk)
        if status in (200, 201):
            inserted += len(data)
        else:
            print(f"  ! 写库失败 {status}: {str(data)[:200]}", file=sys.stderr)
    print(f"完成：上传 {len(rows)}，写库 {inserted}，失败 {failed}")


if __name__ == "__main__":
    main()
