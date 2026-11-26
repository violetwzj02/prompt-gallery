#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ingest asset ids with a tolerant pose matcher, and never skip silently.

Pose names in the model's prompt can carry parentheses, e.g.
`站立V字（单腿侧高抬）`, while the pose atlas stores the bare name. Matching tries
exact -> normalised -> parenthetical stripped -> unique substring. Anything that
still fails is written to unparsed.json with the raw prompt, so a miss is visible
instead of being dropped.

  python3 scripts/ingest_ids_tolerant.py --ids ids.json --out DIR [--workers 8]
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
ANGLES = {"正面平视": "front", "斜 45 度": "diag", "斜45度": "diag", "侧面平视": "side",
          "俯视机位，镜头从上往下": "high", "仰视机位，镜头从下往上": "low"}
LOCK = threading.Lock()


def cookie() -> str:
    return (os.environ.get("GROK_COOKIE") or Path(r"I:\wangzhanbending\.grok_cookie").read_text(encoding="utf-8")).strip()


def fetch(url: str, ck: str, timeout: int = 90) -> bytes | None:
    for attempt in range(3):
        try:
            rq = request.Request(url)
            rq.add_header("User-Agent", UA)
            rq.add_header("Cookie", ck)
            with request.urlopen(rq, timeout=timeout) as resp:
                return resp.read()
        except (error.URLError, error.HTTPError):
            if attempt == 2:
                return None
    return None


def norm(text: str) -> str:
    text = text.replace("（", "(").replace("）", ")")
    text = re.sub(r"\s+", "", text)
    return text


def strip_tail_paren(text: str) -> str:
    return re.sub(r"\([^()]*\)\s*$", "", text).strip()


def build_index() -> tuple[dict[str, str], list[tuple[str, str]]]:
    src = Path(r"D:\deepseek win\work\poses.js").read_text(encoding="utf-8")
    data = json.loads(src[src.index("{"):].rstrip().rstrip(";"))
    exact: dict[str, str] = {}
    loose: list[tuple[str, str]] = []
    for p in data["items"]:
        zh, pid = p["zh"], p["id"]
        exact[zh] = pid
        exact[norm(zh)] = pid
        exact[strip_tail_paren(norm(zh))] = pid
        loose.append((norm(zh), pid))
        loose.append((strip_tail_paren(norm(zh)), pid))
    return exact, loose


def match_pose(raw: str, exact: dict[str, str], loose: list[tuple[str, str]]) -> str | None:
    for candidate in (raw, norm(raw), strip_tail_paren(norm(raw))):
        if candidate in exact:
            return exact[candidate]
    key = strip_tail_paren(norm(raw))
    hits = {pid for name, pid in loose if name and (name in key or key in name)}
    if len(hits) == 1:
        return hits.pop()
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    ck = cookie()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    exact, loose = build_index()
    ledger_path = out / "ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.is_file() else {}
    unparsed_path = out / "unparsed.json"
    unparsed = json.loads(unparsed_path.read_text(encoding="utf-8")) if unparsed_path.is_file() else {}

    ids = [i for i in json.loads(Path(args.ids).read_text(encoding="utf-8")) if i not in ledger]
    print(f"待查 {len(ids)}，已有台账 {len(ledger)}")
    stats = {"kept": 0, "skip": 0, "fail": 0, "unparsed": 0}

    def work(aid: str) -> None:
        raw = fetch(f"{BASE}/rest/assets/{aid}", ck, 45)
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
        # 视角可能整段缺失（用户某些 prompt 没写视角），此时仍按姿势归档，视角记为 na
        m = re.search(r"（[^）]*姿势：(.+?)，(正面平视|斜\s?45\s?度|侧面平视|俯视机位，镜头从上往下|仰视机位，镜头从下往上)，", prompt)
        if m:
            raw_pose, raw_angle = m.group(1), m.group(2)
        else:
            m2 = re.search(r"（[^）]*姿势：(.+?)，人体结构自然", prompt)
            raw_pose, raw_angle = (m2.group(1), None) if m2 else (None, None)
        pid = match_pose(raw_pose, exact, loose) if raw_pose else None
        code = ANGLES.get(re.sub(r"\s+", "", raw_angle)) if raw_angle else ("na" if pid else None)
        if not pid or not code:
            with LOCK:
                stats["unparsed"] += 1
                unparsed[aid] = {"pose": m.group(1) if m else None,
                                 "angle": m.group(2) if m else None,
                                 "prompt": prompt[:400]}
            return
        key = detail.get("key")
        blob = fetch("https://assets.grok.com/" + key, ck, 120) if key else None
        if not blob:
            with LOCK:
                stats["fail"] += 1
            return
        with LOCK:
            n = 1 + sum(1 for v in ledger.values() if v.get("poseId") == pid and v.get("angle") == code)
            dst = out / f"{pid}_{code}_{n}.jpg"
            dst.write_bytes(blob)
            ledger[aid] = {"poseId": pid, "angle": code, "file": dst.name, "bytes": len(blob),
                           "prompt": prompt, "created": detail.get("createTime"),
                           "rRated": detail.get("rRated")}
            stats["kept"] += 1
            if stats["kept"] % 25 == 0:
                ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
                print(f"  已存 {stats['kept']}", file=sys.stderr)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(work, ids))

    ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
    unparsed_path.write_text(json.dumps(unparsed, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"完成：入库 {stats['kept']}，非本批 {stats['skip']}，解析失败 {stats['unparsed']}，下载失败 {stats['fail']}，台账 {len(ledger)}")


if __name__ == "__main__":
    main()
