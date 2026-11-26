#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Walk /rest/assets pages, keep today's 申鹤 batch, download and name it.

/rest/assets returns one asset per page with a nextPageToken; the token is fed
back as both pageToken and cursor because the server has changed the name at
least once. Assets without our template marker are skipped, so old generations
never enter the batch.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib import error, parse, request

BASE = "https://grok.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
MARKER = "场景与光线："
ANGLES = {"正面平视": "front", "斜 45 度": "diag", "侧面平视": "side",
          "俯视机位，镜头从上往下": "high", "仰视机位，镜头从下往上": "low"}
OUT = Path(r"I:\wangzhanbending\grok-gen\申鹤")
RAW = Path(r"I:\wangzhanbending\grok-gen\申鹤-raw")
SINCE = os.environ.get("SINCE", "2026-11-26T15:00:00")


def ck() -> str:
    return (os.environ.get("GROK_COOKIE") or Path(r"I:\wangzhanbending\.grok_cookie").read_text(encoding="utf-8")).strip()


def get(path: str, cookie: str, tries: int = 4):
    req = request.Request(BASE + path)
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", cookie)
    for i in range(tries):
        try:
            with request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (error.URLError, error.HTTPError, ValueError):
            if i == tries - 1:
                return None
            time.sleep(1.5 + i)


def poses() -> dict[str, str]:
    src = Path(r"D:\deepseek win\work\poses.js").read_text(encoding="utf-8")
    data = json.loads(src[src.index("{"):].rstrip().rstrip(";"))
    return {p["zh"]: p["id"] for p in data["items"]}


def main() -> None:
    cookie = ck()
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    pmap = poses()
    ledger_path = OUT / "ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.is_file() else {}
    seen_path = RAW / "seen.json"
    seen = set(json.loads(seen_path.read_text(encoding="utf-8"))) if seen_path.is_file() else set()

    token = None
    pages = 0
    kept = 0
    while pages < 600:
        q = {
            "pageSize": "100",
            "orderBy": "ORDER_BY_CREATE_TIME",
            "sortDirection": "SORT_DIRECTION_DESCENDING",
        }
        if token:
            q["pageToken"] = token
        data = get("/rest/assets?" + parse.urlencode(q), cookie)
        pages += 1
        if not data:
            break
        batch = data.get("assets") or []
        nxt = data.get("nextPageToken")
        for a in batch:
            aid = a.get("assetId")
            created = str(a.get("createTime") or "")
            if not aid or aid in seen:
                continue
            seen.add(aid)
            if created and created < SINCE:
                continue
            detail = get(f"/rest/assets/{aid}", cookie)
            if not detail:
                continue
            prompt = ""
            for node in (detail.get("mediaGenInput") or {}).values():
                if isinstance(node, dict) and node.get("prompt"):
                    prompt = str(node["prompt"])
                    break
            if MARKER not in prompt:
                continue
            m = re.search(r"（[^）]*姿势：([^，]+)，([^，]+)，", prompt)
            pid = pmap.get(m.group(1).strip()) if m else None
            code = ANGLES.get(m.group(2).strip()) if m else None
            if not pid or not code:
                continue
            count = 1 + sum(1 for v in ledger.values() if v.get("poseId") == pid and v.get("angle") == code)
            dst = OUT / f"{pid}_{code}_{count}.jpg"
            try:
                rq = request.Request("https://assets.grok.com/" + detail["key"])
                rq.add_header("User-Agent", UA)
                rq.add_header("Cookie", cookie)
                blob = request.urlopen(rq, timeout=120).read()
            except Exception as exc:  # noqa: BLE001
                print(f"  ! {aid} {str(exc)[:60]}", file=sys.stderr)
                continue
            dst.write_bytes(blob)
            ledger[aid] = {"poseId": pid, "angle": code, "file": dst.name, "bytes": len(blob),
                           "prompt": prompt, "created": created, "rRated": detail.get("rRated")}
            kept += 1
            print(f"+ {dst.name} ({kept})", file=sys.stderr)
            if kept % 5 == 0:
                ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
                seen_path.write_text(json.dumps(sorted(seen)), encoding="utf-8")
        if batch:
            print(f"page {pages}: {len(batch)} assets, kept {kept}", file=sys.stderr)
        if not nxt or nxt == token:
            break
        token = nxt
        time.sleep(0.2)

    ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
    seen_path.write_text(json.dumps(sorted(seen)), encoding="utf-8")
    print(f"扫描 {pages} 页，命名入库 {kept}，台账 {len(ledger)}")


if __name__ == "__main__":
    main()
