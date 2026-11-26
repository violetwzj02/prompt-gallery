#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Name an exported Grok batch and stage it for upload.

The Grok library downloads files as <assetId>.jpg. For each file we read the
stored prompt from /rest/assets, recover pose + angle from the bracketed block,
and rename to <poseId>_<angle>_<n>.jpg so the album gets meaningful titles.

  python3 scripts/rename_exported_batch.py --src "I:/wangzhanbending/grok-gen/申鹤-raw" --out "I:/wangzhanbending/grok-gen/申鹤"
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from urllib import error, request

BASE = "https://grok.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
MARKER = "场景与光线："
ANGLES = {"正面平视": "front", "斜 45 度": "diag", "侧面平视": "side",
          "俯视机位，镜头从上往下": "high", "仰视机位，镜头从下往上": "low"}


def cookie() -> str:
    return (os.environ.get("GROK_COOKIE") or Path(r"I:\wangzhanbending\.grok_cookie").read_text(encoding="utf-8")).strip()


def get_json(path: str, ck: str):
    req = request.Request(BASE + path)
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", ck)
    for attempt in range(3):
        try:
            with request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (error.URLError, error.HTTPError, ValueError):
            if attempt == 2:
                return None
            time.sleep(2)


def load_poses() -> dict[str, str]:
    src = Path(r"D:\deepseek win\work\poses.js").read_text(encoding="utf-8")
    data = json.loads(src[src.index("{"):].rstrip().rstrip(";"))
    return {p["zh"]: p["id"] for p in data["items"]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    poses = load_poses()
    ck = cookie()
    ledger_path = out / "ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.is_file() else {}

    files = [p for p in src.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    print(f"待处理 {len(files)} 个文件")
    used = unparsed = 0
    for path in sorted(files):
        aid = path.stem
        if aid in ledger:
            continue
        detail = get_json(f"/rest/assets/{aid}", ck)
        if not detail:
            unparsed += 1
            continue
        prompt = ""
        for node in (detail.get("mediaGenInput") or {}).values():
            if isinstance(node, dict) and node.get("prompt"):
                prompt = str(node["prompt"])
                break
        if MARKER not in prompt:
            unparsed += 1
            continue
        m = re.search(r"（[^）]*姿势：([^，]+)，([^，]+)，", prompt)
        pid = poses.get(m.group(1).strip()) if m else None
        code = ANGLES.get(m.group(2).strip()) if m else None
        if not pid or not code:
            unparsed += 1
            continue
        count = 1 + sum(1 for v in ledger.values() if v.get("poseId") == pid and v.get("angle") == code)
        target = out / f"{pid}_{code}_{count}{path.suffix.lower()}"
        shutil.copy2(path, target)
        ledger[aid] = {
            "poseId": pid, "angle": code, "file": target.name,
            "bytes": target.stat().st_size, "prompt": prompt,
            "created": detail.get("createTime"), "rRated": detail.get("rRated"),
        }
        used += 1
        if used % 10 == 0:
            ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
            print(f"  已命名 {used}")
    ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"完成：命名 {used}，跳过 {unparsed}，台账 {len(ledger)}")


if __name__ == "__main__":
    main()
