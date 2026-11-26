#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ingest the freshly generated 申鹤 batch from Grok into the local staging dir.

Only images whose stored prompt carries our template marker are taken, so older
generations are never mixed in. Each file is named <poseId>_<angle>_<n>.jpg and
the pose/angle are recovered from the prompt's bracketed block.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib import error, request

STAGE = Path(r"I:\wangzhanbending")
OUT = STAGE / "grok-gen" / "申鹤"
BASE = "https://grok.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
MARKER = "场景与光线："
ANGLES = {"正面平视": "front", "斜 45 度": "diag", "侧面平视": "side",
          "俯视机位，镜头从上往下": "high", "仰视机位，镜头从下往上": "low"}


def cookie() -> str:
    raw = (os.environ.get("GROK_COOKIE") or "").strip()
    if not raw:
        raw = (STAGE / ".grok_cookie").read_text(encoding="utf-8").strip()
    return raw


def get_json(path: str, ck: str, timeout: int = 45):
    req = request.Request(BASE + path)
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", ck)
    for attempt in range(3):
        try:
            with request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (error.URLError, error.HTTPError, ValueError) as exc:
            if attempt == 2:
                print(f"  ! {path} {exc}", file=sys.stderr)
                return None
            time.sleep(2)


def load_pose_map() -> dict[str, str]:
    src = Path(r"D:\deepseek win\work\poses.js").read_text(encoding="utf-8")
    data = json.loads(src[src.index("{"):].rstrip().rstrip(";"))
    return {p["zh"]: p["id"] for p in data["items"]}


def parse_bracket(prompt: str, poses: dict[str, str]) -> tuple[str, str] | None:
    m = re.search(r"（[^）]*姿势：([^，]+)，([^，]+)，", prompt)
    if not m:
        return None
    pose_zh, angle_zh = m.group(1).strip(), m.group(2).strip()
    pid = poses.get(pose_zh)
    code = ANGLES.get(angle_zh)
    if not pid or not code:
        return None
    return pid, code


def main() -> None:
    ck = cookie()
    OUT.mkdir(parents=True, exist_ok=True)
    poses = load_pose_map()
    ledger_path = OUT / "ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.is_file() else {}

    conv = get_json("/rest/app-chat/conversations?pageSize=200", ck) or {}
    convs = conv.get("conversations") or []
    print(f"会话 {len(convs)} 个", file=sys.stderr)

    candidates: dict[str, dict] = {}
    for c in convs:
        cid = c.get("conversationId") or c.get("id")
        if not cid:
            continue
        created = c.get("createTime") or ""
        if created[:10] < "2026-11-26":
            continue
        data = get_json(f"/rest/app-chat/conversations/{cid}/responses?pageSize=100", ck) or {}
        for r in data.get("responses") or []:
            for meta in r.get("fileAttachmentsMetadata") or []:
                uri = str(meta.get("fileUri") or "")
                if "/generated/" not in uri:
                    continue
                aid = str(meta.get("fileMetadataId") or "")
                candidates[aid] = {"assetId": aid, "fileUri": uri, "cid": cid,
                                   "created": r.get("createTime") or created}

    print(f"候选文件 {len(candidates)}", file=sys.stderr)

    kept = 0
    for aid, item in candidates.items():
        if aid in ledger:
            continue
        detail = get_json(f"/rest/assets/{aid}", ck)
        if not detail:
            continue
        prompt = ""
        gen = detail.get("mediaGenInput") or {}
        for node in gen.values():
            if isinstance(node, dict) and node.get("prompt"):
                prompt = str(node["prompt"])
                break
        if MARKER not in prompt:
            continue
        parsed = parse_bracket(prompt, poses)
        if not parsed:
            print(f"  ? 无法解析姿势 {aid}", file=sys.stderr)
            continue
        pid, angle = parsed
        count = 1 + sum(1 for v in ledger.values() if v.get("poseId") == pid and v.get("angle") == angle)
        target = OUT / f"{pid}_{angle}_{count}.jpg"
        try:
            req = request.Request(f"https://assets.grok.com/{detail['key']}")
            req.add_header("User-Agent", UA)
            req.add_header("Cookie", ck)
            with request.urlopen(req, timeout=120) as resp:
                blob = resp.read()
            expected = int(detail.get("sizeBytes") or 0)
            if expected and len(blob) != expected:
                print(f"  ! 大小不符 {aid} {len(blob)}!={expected}", file=sys.stderr)
                continue
            target.write_bytes(blob)
        except (error.URLError, error.HTTPError, KeyError) as exc:
            print(f"  ! 下载失败 {aid} {exc}", file=sys.stderr)
            continue
        ledger[aid] = {
            "poseId": pid, "angle": angle, "file": target.name, "bytes": len(blob),
            "prompt": prompt, "created": detail.get("createTime"),
            "rRated": detail.get("rRated"),
        }
        kept += 1
        if kept % 10 == 0:
            ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
            print(f"  已存 {kept}", file=sys.stderr)

    ledger_path.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"完成：新入库 {kept}，台账 {len(ledger)} 条 -> {OUT}")


if __name__ == "__main__":
    main()
