#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download every asset of extra Imagine collections so they can be reviewed.

Read-only: talks to grok.com with a cookie, saves images + metadata under
I:\\wangzhanbending\\extra\\<slug>\\ and writes a numbered contact sheet set.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import time
from pathlib import Path
from urllib import error, request

STAGE = Path(r"I:\wangzhanbending")
COLLECTIONS = {
    "zhuanghui": "0edfd910-ec56-4814-a563-8b6e36c9dc07",  # 转绘
    "cc": "b807fefc-8cfe-47b2-bf31-8500180dfc00",  # CC
}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def cookie() -> str:
    raw = (os.environ.get("GROK_COOKIE") or "").strip()
    if not raw:
        raw = (STAGE / ".grok_cookie").read_text(encoding="utf-8").strip()
    return raw


def post_json(url: str, payload: dict, ck: str, timeout: int = 40) -> dict:
    body = json.dumps(payload).encode()
    req = request.Request(url, data=body, method="POST")
    for key, value in (
        ("Content-Type", "application/json"),
        ("User-Agent", UA),
        ("Cookie", ck),
        ("Origin", "https://grok.com"),
        ("Referer", "https://grok.com/imagine"),
    ):
        req.add_header(key, value)
    with request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_bytes(url: str, ck: str, timeout: int = 90) -> bytes:
    req = request.Request(url)
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", ck)
    with request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def list_assets(ck: str, collection_id: str) -> list[dict]:
    out: list[dict] = []
    cursor = None
    for _ in range(100):
        payload = {"collectionId": collection_id, "limit": 100}
        if cursor:
            payload["cursor"] = cursor
        data = post_json("https://grok.com/rest/media/collection/assets/list", payload, ck)
        out.extend(data.get("items") or [])
        cursor = data.get("nextCursor") or None
        if not cursor:
            break
        time.sleep(0.2)
    return out


def main() -> None:
    ck = cookie()
    for slug, cid in COLLECTIONS.items():
        outdir = STAGE / "extra" / slug
        outdir.mkdir(parents=True, exist_ok=True)
        assets = list_assets(ck, cid)
        meta_path = outdir / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
        print(f"[{slug}] {len(assets)} assets", file=sys.stderr)
        for index, asset in enumerate(assets, 1):
            aid = asset["assetId"]
            entry = meta.get(aid) or {}
            target = outdir / f"{index:03d}.jpg"
            if target.is_file() and target.stat().st_size > 0 and entry:
                continue
            try:
                detail = post_json("https://grok.com/rest/media/post/get", {"id": aid, "isNsfwEnabled": True}, ck)
                post = detail.get("post") or {}
                url = post.get("mediaUrl") or post.get("thumbnailImageUrl")
                mime = post.get("mimeType") or asset.get("mimeType")
                entry = {
                    "assetId": aid,
                    "index": index,
                    "mime": mime,
                    "rRated": post.get("rRated"),
                    "width": (post.get("resolution") or {}).get("width"),
                    "height": (post.get("resolution") or {}).get("height"),
                }
                if url and str(mime).startswith("image/"):
                    target.write_bytes(fetch_bytes(url, ck))
                    entry["file"] = target.name
                    entry["md5"] = hashlib.md5(target.read_bytes()).hexdigest()
                meta[aid] = entry
            except (error.URLError, error.HTTPError, KeyError) as exc:
                print(f"  ! {aid} {exc}", file=sys.stderr)
            if index % 10 == 0:
                meta_path.write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
                print(f"  {index}/{len(assets)}", file=sys.stderr)
            time.sleep(0.15)
        meta_path.write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
        got = len(list(outdir.glob("*.jpg")))
        print(f"[{slug}] 保存 {got} 张预览 -> {outdir}")


if __name__ == "__main__":
    main()
