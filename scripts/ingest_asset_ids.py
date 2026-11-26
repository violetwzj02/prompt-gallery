#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download a list of asset ids, keep only the current 申鹤 batch, name by pose+angle.

  python3 scripts/ingest_asset_ids.py --ids ids_new.json --out "I:/wangzhanbending/grok-gen/申鹤"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib import error, request

BASE = "https://grok.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
MARKER = "场景与光线："
ANGLES = {"正面平视": "front", "斜 45 度": "diag", "侧面平视": "side",
          "俯视机位，镜头从上往下": "high", "仰视机位，镜头从下往上": "low"}
LOCK = threading.Lock()


def ck() -> str:
    return (os.environ.get("GROK_COOKIE") or Path(r"I:\wangzhanbending\.grok_cookie").read_text(encoding="utf-8")).strip()


def fetch(url: str, cookie: str, timeout: int = 90) -> bytes | None:
    for i in range(3):
        try:
            rq = request.Request(url)
            rq.add_header("User-Agent", UA)
            rq.add_header("Cookie", cookie)
            with request.urlopen(rq, timeout=timeout) as resp:
                return resp.read()
        except (error.URLError, error.HTTPError):
            if i == 2:
                return None
    return None


def _norm(text: str) -> str:
    text = text.replace("（", "(").replace("）", ")")
    text = re.sub(r"\s+", "", text)
    return text


def poses() -> dict[str, str]:
    src = Path(r"D:\deepseek win\work\poses.js").read_text(encoding="utf-8")
    data = json.loads(src[src.index("{"):].rstrip().rstrip(";"))
    pmap: dict[str, str] = {}
    for p in data["items"]:
        pmap[p["zh"]] = p["id"]
        pmap[_norm(p["zh"])] = p["id"]
        pmap[_norm(re.sub(r"\([^)]*\)$", "", p["zh"]))] = p["id"]
    return pmap


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    cookie = ck()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    pmap = poses()
    ledger_path = out / "ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.is_file() else {}
    ids = [i for i in json.loads(Path(args.ids).read_text(encoding="utf-8")) if i not in ledger]
    print(f"待查 {len(ids)} 条，已有台账 {len(ledger)}")

    stats = {"kept": 0, "skip": 0, "fail": 0}

    def work(aid: str) -> None:
        raw = fetch(f"{BASE}/rest/assets/{aid}", cookie, 45)
        if not raw:
            with LOCK:
                stats["fail"] += 1
            return
        try:
            detail = json.loads(raw.decode("utf-8"))
        except ValueError:
            with LOCK:
                stats["fail"] += 1
            return
        prompt = ""
        for node in (detail.get("mediaGenInput") or {}).values():
            if isinstance(node, dict) and node.get("prompt"):
                prompt = str(node["prompt"])
                break
        if MARKER not in prompt:
            with LOCK:
                stats["skip"] += 1
            return
        m = re.search(r"（[^）]*姿势：([^，]+)，([^，]+)，", prompt)
        raw_pose = m.group(1).strip() if m else ""
        pid = pmap.get(raw_pose) or pmap.get(_norm(raw_pose)) or pmap.get(_norm(re.sub(r"\([^)]*\)$", "", raw_pose))) if m else None
        code = ANGLES.get(m.group(2).strip()) if m else None
        if not pid or not code:
            with LOCK:
                stats["skip"] += 1
            return
        key = detail.get("key")
        blob = fetch("https://assets.grok.com/" + key, cookie, 120) if key else None
        if not blob:
            with LOCK:
                stats["fail"] += 1
            return
        with LOCK:
            n = 1 + sum(1 for v in ledger.values() if v.get("poseId") == pid and v.get("angle") == code)
            dst = out / f"{pid}_{code}_{n}.jpg"
            dst.write_bytes(blob)
            ledger[aid] = {"poseId": pid, "angle": code, "file": dst.name, "bytes": len(blob),
                           "prompt": prompt, "created": detail.get("createTime"), "rRated": detail.get("rRated")}
            stats["kept"] += 1
            if stats["kept"] % 20 == 0:
                ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
                print(f"  已存 {stats['kept']}", file=sys.stderr)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(work, ids))

    ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"完成：入库 {stats['kept']}，非本批 {stats['skip']}，失败 {stats['fail']}，台账 {len(ledger)}")


if __name__ == "__main__":
    main()
