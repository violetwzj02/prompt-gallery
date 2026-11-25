#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Move one character's rated images from Grok into the cloud album, byte-exact.

  python3 scripts/grok_album_sync.py --character "D.Va" [--limit 32] [--dry-run]
  python3 scripts/grok_album_sync.py --character "D.Va" --upload

Stage 1 (default): download every rRated file of that character to
I:/wangzhanbending/18plus/<角色>/ and verify size against /rest/assets sizeBytes.
Stage 2 (--upload): upload those files that are not yet in Drive, compare md5,
then insert album_items rows (18+ + 角色).
Windows: browsing uses Drive thumbnailLink; download keeps original bytes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import album_import as imp  # noqa: E402

STAGE = Path(r"I:\wangzhanbending")
GRAPH = STAGE / "quyi-survey" / "asset-graph.json"
REPORT = STAGE / "quyi-survey" / "character-report.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
BASE = "https://grok.com"


def cookie() -> str:
    return (os.environ.get("GROK_COOKIE") or (STAGE / ".grok_cookie").read_text(encoding="utf-8")).strip()


def assets_for(character: str) -> list[dict]:
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    convs = [row["cid"] for row in report["conversations"] if row["character"] == character]
    picked: dict[str, dict] = {}
    for cid in convs:
        for f in graph["conversations"].get(cid, []):
            meta = graph["assets"].get(f["assetId"]) or {}
            if not meta.get("rRated"):
                continue
            if f["assetId"] in picked:
                continue
            picked[f["assetId"]] = {
                "assetId": f["assetId"],
                "conversationId": cid,
                "key": meta.get("key"),
                "sizeBytes": meta.get("sizeBytes"),
                "mimeType": meta.get("mimeType") or "image/jpeg",
                "prompt": meta.get("prompt"),
                "createTime": meta.get("createTime") or f.get("createTime"),
            }
    return list(picked.values())


def safe_ext(mime: str) -> str:
    return {"image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4"}.get(mime, ".jpg")


def fetch_size(aid: str, ck: str) -> int | None:
    """sizeBytes is authoritative in /rest/assets; the graph does not carry it."""
    req = request.Request(f"{BASE}/rest/assets/{aid}")
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", ck)
    try:
        with request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return int(data["sizeBytes"]) if data.get("sizeBytes") else None
    except Exception:
        return None


def download(character: str, limit: int | None, dry_run: bool) -> None:
    items = assets_for(character)
    items.sort(key=lambda x: x.get("createTime") or "")
    if limit:
        items = items[:limit]
    outdir = STAGE / "18plus" / character
    outdir.mkdir(parents=True, exist_ok=True)
    ledger_path = outdir / "ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.is_file() else {}
    print(f"{character}: 待处理 {len(items)} 条 -> {outdir}")
    ck = cookie()
    ok = failed = skipped = 0
    for item in items:
        aid = item["assetId"]
        ext = safe_ext(item["mimeType"])
        target = outdir / f"{aid}{ext}"
        if not item.get("sizeBytes"):
            item["sizeBytes"] = fetch_size(aid, cookie())
        if aid in ledger and target.is_file() and item["sizeBytes"] and target.stat().st_size == int(item["sizeBytes"]):
            skipped += 1
            continue
        if dry_run:
            print(f"  [dry] {aid} {item['sizeBytes']}B")
            continue
        url = f"https://assets.grok.com/{item['key']}"
        try:
            req = request.Request(url)
            req.add_header("User-Agent", UA)
            req.add_header("Cookie", ck)
            with request.urlopen(req, timeout=120) as resp:
                data = resp.read()
            if item["sizeBytes"] and len(data) != int(item["sizeBytes"]):
                print(f"  ! 大小不符 {aid}: 期望 {item['sizeBytes']} 实得 {len(data)}", file=sys.stderr)
                failed += 1
                continue
            target.write_bytes(data)
            ledger[aid] = {
                **item,
                "file": target.name,
                "md5": hashlib.md5(data).hexdigest(),
                "bytes": len(data),
            }
            ok += 1
            print(f"  ↓ {target.name} {len(data)}B", file=sys.stderr)
        except (error.URLError, error.HTTPError) as exc:
            print(f"  ! {aid} {exc}", file=sys.stderr)
            failed += 1
        if (ok + failed) % 10 == 0:
            ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
    ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"下载：成功 {ok}，跳过 {skipped}，失败 {failed}，台账 {len(ledger)} 条")


def upload(character: str) -> None:
    outdir = STAGE / "18plus" / character
    names_path = outdir / "names.json"
    names = json.loads(names_path.read_text(encoding="utf-8")) if names_path.is_file() else {}
    ledger_path = outdir / "ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.is_file() else {}
    if not ledger:
        raise SystemExit("本地台账为空，先跑下载")
    token = imp.google_token()
    root_id = imp.album_root(token)
    cache_path = imp.STATE / "folders.json"
    cache = imp.load_ledger(cache_path, "folders")
    folder_id = imp.ensure_folder(token, root_id, character, cache)
    imp.save_ledger(cache_path, "folders", cache)

    drive_md5 = {}
    for child in imp.drive_list_children(token, folder_id):
        if child.get("md5Checksum"):
            drive_md5[child["md5Checksum"]] = child

    rows = []
    uploaded = reused = 0
    for aid, item in ledger.items():
        path = outdir / item["file"]
        if not path.is_file():
            continue
        md5 = item.get("md5") or hashlib.md5(path.read_bytes()).hexdigest()
        if md5 in drive_md5:
            reused += 1
            rows.append({
                "drive_file_id": drive_md5[md5]["id"],
                "title": names.get(aid) or character,
                "source": "upload",
                "mime_type": "image/jpeg" if path.suffix == ".jpg" else None,
                "size_bytes": min(int(item.get("bytes") or path.stat().st_size), 52428800),
                "auto_categories": ["18+"],
                "custom_categories": [character],
            })
            continue
        if path.suffix == ".mp4":
            continue  # videos wait for the 视频 category
        result = imp.upload_file(token, folder_id, path, f"{character}·{aid[:8]}.jpg")
        got = result.get("md5Checksum")
        if got and got != md5:
            print(f"  ! md5 不一致 {aid}: 本地 {md5} Drive {got}", file=sys.stderr)
            continue
        uploaded += 1
        rows.append({
            "drive_file_id": result["id"],
            "title": names.get(aid) or character,
            "source": "upload",
            "mime_type": "image/jpeg",
            "size_bytes": min(int(result.get("size") or path.stat().st_size), 52428800),
            "auto_categories": ["18+"],
            "custom_categories": [character],
        })
    if rows:
        status, data = imp.http_json(
            "POST",
            f"{imp.supabase_base()}/rest/v1/album_items",
            {**imp.supabase_headers(), "Prefer": "return=representation,resolution=merge-duplicates"},
            rows,
        )
        if status not in (200, 201):
            raise SystemExit(f"写相册失败 {status}: {str(data)[:300]}")
        print(f"上传：新增 {uploaded}，复用 {reused}，写库 {len(data)} 条")
    else:
        print("没有可写的行")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--character", required=True)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--upload", action="store_true")
    args = ap.parse_args()
    if args.upload:
        upload(args.character)
    else:
        download(args.character, args.limit, args.dry_run)


if __name__ == "__main__":
    main()
