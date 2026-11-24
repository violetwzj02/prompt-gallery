#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Move files into the cloud album: Google Drive upload + Supabase rows.

Reads GROK_* credentials from the environment only; nothing is written to disk
except the ledger under covers-inbox/ (git-ignored).

Subcommands
  export    dump current album_items rows for review
  folders   create one Drive folder per character under the album root
  upload    upload downloaded media into those folders (md5 de-dup)
  rows      insert album_items rows for uploaded files
  titles    write readable titles back (by album id or by source uuid)

Environment
  SUPABASE_URL, SUPABASE_SERVICE_KEY        (or SUPABASE_ADMIN_JWT)
  GOOGLE_ACCESS_TOKEN                       short-lived token
  or GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
  ALBUM_DRIVE_FOLDER_ID                     album root folder id

Example
  python scripts/album_import.py export  --out covers-inbox/album/items.json
  python scripts/album_import.py upload  --manifest covers-inbox/quyi-survey/imagine-manifest.json \
                                         --downloads covers-inbox/quyi-downloads \
                                         --titles covers-inbox/quyi-survey/titles.json
  python scripts/album_import.py rows    --ledger covers-inbox/album/uploads.json
  python scripts/album_import.py titles  --map covers-inbox/album/titles.json --key id
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import sys
import time
from pathlib import Path
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "covers-inbox" / "album"
DRIVE_API = os.environ.get("GOOGLE_API_BASE", "https://www.googleapis.com") + "/drive/v3"
DRIVE_UPLOAD = os.environ.get("GOOGLE_UPLOAD_BASE", "https://www.googleapis.com") + "/upload/drive/v3"
FOLDER_MIME = "application/vnd.google-apps.folder"
ADULT = "18+"


def env(name: str, required: bool = True) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value and required:
        raise SystemExit(f"缺少环境变量 {name}")
    return value


def supabase_base() -> str:
    return env("SUPABASE_URL").rstrip("/")


def supabase_headers() -> dict:
    key = os.environ.get("SUPABASE_ADMIN_JWT") or env("SUPABASE_SERVICE_KEY")
    return {
        "apikey": os.environ.get("SUPABASE_SERVICE_KEY") or key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def http_json(method: str, url: str, headers: dict, payload=None, timeout: int = 60):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, method=method)
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body.strip() else None)
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        return exc.code, body


def google_token() -> str:
    token = (os.environ.get("GOOGLE_ACCESS_TOKEN") or "").strip()
    if token:
        return token
    refresh = env("GOOGLE_REFRESH_TOKEN")
    payload = parse.urlencode(
        {
            "client_id": env("GOOGLE_CLIENT_ID"),
            "client_secret": env("GOOGLE_CLIENT_SECRET"),
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    req = request.Request("https://oauth2.googleapis.com/token", data=payload, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["access_token"]


def drive_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def drive_list_children(token: str, parent: str) -> list[dict]:
    query = parse.quote(f"'{parent}' in parents and trashed = false")
    url = f"{DRIVE_API}/files?q={query}&fields=files(id,name,mimeType,md5Checksum,size)&pageSize=1000"
    status, data = http_json("GET", url, drive_headers(token))
    if status != 200:
        raise SystemExit(f"Drive 列表失败 {status}: {data}")
    return (data or {}).get("files") or []


def ensure_folder(token: str, parent: str, name: str, cache: dict[str, str]) -> str:
    if name in cache:
        return cache[name]
    for child in drive_list_children(token, parent):
        if child.get("mimeType") == FOLDER_MIME and child.get("name") == name:
            cache[name] = child["id"]
            return child["id"]
    status, data = http_json(
        "POST",
        f"{DRIVE_API}/files?fields=id",
        drive_headers(token),
        {"name": name, "mimeType": FOLDER_MIME, "parents": [parent]},
    )
    if status not in (200, 201):
        raise SystemExit(f"创建文件夹失败 {status}: {data}")
    cache[name] = data["id"]
    print(f"  新建文件夹 {name} -> {data['id']}", file=sys.stderr)
    return data["id"]


def upload_file(token: str, folder: str, path: Path, name: str) -> dict:
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    boundary = "----pg" + hashlib.md5(str(time.time()).encode()).hexdigest()
    meta = json.dumps({"name": name, "parents": [folder]}).encode("utf-8")
    body = b"".join(
        [
            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode(),
            meta,
            f"\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n".encode(),
            path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    req = request.Request(
        f"{DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,md5Checksum,size",
        data=body,
        method="POST",
    )
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", f"multipart/related; boundary={boundary}")
    with request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_ledger(path: Path, key: str) -> dict:
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8")).get(key, {})
    return {}


def save_ledger(path: Path, key: str, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = {}
    if path.is_file():
        existing = json.loads(path.read_text(encoding="utf-8"))
    existing[key] = value
    path.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")


def album_root(token: str) -> str:
    folder = (os.environ.get("ALBUM_DRIVE_FOLDER_ID") or "").strip()
    if folder:
        return folder
    for child in drive_list_children(token, "root"):
        if child.get("mimeType") == FOLDER_MIME and child.get("name") == "风格 Prompt 图鉴·云端相册":
            return child["id"]
    raise SystemExit("找不到云端相册根目录，请设置 ALBUM_DRIVE_FOLDER_ID")


def cmd_export(args) -> None:
    url = (
        f"{supabase_base()}/rest/v1/album_items"
        "?select=id,drive_file_id,title,source,prompt_id,mime_type,size_bytes,"
        "auto_categories,custom_categories,created_at"
        "&order=created_at.asc&limit=100000"
    )
    status, data = http_json("GET", url, supabase_headers())
    if status != 200:
        raise SystemExit(f"读取相册失败 {status}: {data}")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"导出 {len(data)} 条 -> {out}")


def cmd_folders(args) -> None:
    token = google_token()
    root = album_root(token)
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    names = sorted({i.get("character") for i in manifest.get("items", []) if i.get("character")})
    cache_path = STATE / "folders.json"
    cache = load_ledger(cache_path, "folders")
    for name in names:
        ensure_folder(token, root, name, cache)
    save_ledger(cache_path, "folders", cache)
    print(f"文件夹就绪 {len(cache)} 个")


def cmd_upload(args) -> None:
    token = google_token()
    root = album_root(token)
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    titles = json.loads(Path(args.titles).read_text(encoding="utf-8")) if args.titles else {}
    downloads = Path(args.downloads)
    cache_path = STATE / "folders.json"
    folder_cache = load_ledger(cache_path, "folders")
    ledger_path = STATE / "uploads.json"
    done = load_ledger(ledger_path, "uploads")

    existing_md5: set[str] = set()
    for child in drive_list_children(token, root):
        if child.get("md5Checksum"):
            existing_md5.add(child["md5Checksum"])
    for folder_id in set(folder_cache.values()):
        for child in drive_list_children(token, folder_id):
            if child.get("md5Checksum"):
                existing_md5.add(child["md5Checksum"])
    print(f"云盘已有 {len(existing_md5)} 个可去重的文件", file=sys.stderr)

    pending = 0
    for item in manifest.get("items", []):
        uuid = item.get("uuid")
        if not uuid or uuid in done:
            continue
        if item.get("type") == "video" and not args.videos:
            continue
        source = (downloads / "videos" / f"{uuid}.mp4") if item.get("type") == "video" else (
            downloads / "stills" / f"{uuid}.jpg"
        )
        if not source.is_file():
            fallback = list(downloads.rglob(f"{uuid}*"))
            source = next((p for p in fallback if p.is_file()), source)
        if not source.is_file():
            continue
        digest = hashlib.md5(source.read_bytes()).hexdigest()
        character = item.get("character") or "待归类"
        if digest in existing_md5:
            done[uuid] = {"skipped": True, "md5": digest, "reason": "duplicate"}
            continue
        folder_id = ensure_folder(token, root, character, folder_cache)
        title = (titles.get(uuid) or "").strip() or character
        ext = source.suffix.lower() or ".jpg"
        name = f"{title}{ext}"
        uploaded = upload_file(token, folder_id, source, name)
        existing_md5.add(uploaded.get("md5Checksum") or digest)
        done[uuid] = {
            "driveFileId": uploaded["id"],
            "md5": uploaded.get("md5Checksum") or digest,
            "size": int(uploaded.get("size") or source.stat().st_size),
            "title": title,
            "character": character,
            "type": item.get("type"),
            "prompt": item.get("prompt"),
        }
        pending += 1
        print(f"  ↑ {name} ({done[uuid]['size']}B) -> {character}", file=sys.stderr)
        if pending % 10 == 0:
            save_ledger(cache_path, "folders", folder_cache)
            save_ledger(ledger_path, "uploads", done)

    save_ledger(cache_path, "folders", folder_cache)
    save_ledger(ledger_path, "uploads", done)
    real = sum(1 for v in done.values() if not v.get("skipped"))
    print(f"上传台账 {real} 项（跳过重复 {len(done) - real}）")


def cmd_rows(args) -> None:
    ledger = load_ledger(Path(args.ledger), "uploads")
    rows = []
    for uuid, info in ledger.items():
        if info.get("skipped"):
            continue
        if info.get("type") == "video":
            continue  # album_items.mime_type only accepts images
        rows.append(
            {
                "drive_file_id": info["driveFileId"],
                "title": info.get("title") or info.get("character") or None,
                "source": "upload",
                "mime_type": "image/jpeg",
                "size_bytes": min(int(info.get("size") or 0), 52428800),
                "auto_categories": [ADULT],
                "custom_categories": [info["character"]] if info.get("character") else [],
            }
        )
    if not rows:
        print("没有需要写入的行")
        return
    status, data = http_json(
        "POST",
        f"{supabase_base()}/rest/v1/album_items",
        {**supabase_headers(), "Prefer": "return=representation,resolution=merge-duplicates"},
        rows,
    )
    if status not in (200, 201):
        raise SystemExit(f"写相册失败 {status}: {data}")
    print(f"写入 {len(data)} 条相册记录")


def cmd_titles(args) -> None:
    mapping = json.loads(Path(args.map).read_text(encoding="utf-8"))
    field = "id" if args.key == "id" else "drive_file_id"
    updated = 0
    for key, title in mapping.items():
        if not str(title).strip():
            continue
        status, data = http_json(
            "PATCH",
            f"{supabase_base()}/rest/v1/album_items?{field}=eq.{parse.quote(str(key))}",
            {**supabase_headers(), "Prefer": "return=representation"},
            {"title": str(title).strip()},
        )
        if status not in (200, 204):
            print(f"  ! {key}: {status} {data}", file=sys.stderr)
            continue
        updated += 1
        if updated % 20 == 0:
            print(f"  已更新 {updated}", file=sys.stderr)
    print(f"标题更新 {updated} 条（{field}）")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("export")
    p.add_argument("--out", default=str(STATE / "items.json"))
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("folders")
    p.add_argument("--manifest", default=str(ROOT / "covers-inbox/quyi-survey/imagine-manifest.json"))
    p.set_defaults(func=cmd_folders)

    p = sub.add_parser("upload")
    p.add_argument("--manifest", default=str(ROOT / "covers-inbox/quyi-survey/imagine-manifest.json"))
    p.add_argument("--downloads", default=str(ROOT / "covers-inbox/quyi-downloads"))
    p.add_argument("--titles", default=None)
    p.add_argument("--videos", action="store_true", help="连视频原文件一起上传")
    p.set_defaults(func=cmd_upload)

    p = sub.add_parser("rows")
    p.add_argument("--ledger", default=str(STATE / "uploads.json"))
    p.set_defaults(func=cmd_rows)

    p = sub.add_parser("titles")
    p.add_argument("--map", required=True)
    p.add_argument("--key", choices=["id", "drive"], default="id")
    p.set_defaults(func=cmd_titles)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
