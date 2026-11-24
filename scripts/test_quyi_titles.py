#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Checks for scripts/quyi_titles.py (pure functions + a temp-file write)."""
from __future__ import annotations

import io
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import quyi_titles as qt  # noqa: E402

results: list[tuple[str, bool, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    results.append((label, ok, detail))
    print(("ok   " if ok else "FAIL ") + label + (f" — {detail}" if detail and not ok else ""))


EN = (
    "sitting on the ground with legs spread wide in a V-shape, knees bent outward, feet flat on "
    "the floor, torso upright, arms raised with hands behind the head, elbows flared outward, "
    "frontal view, slightly low angle"
)
check("english pose -> 坐地 分腿V字 双手抱头", qt.describe(EN) == "坐地 分腿V字 双手抱头", qt.describe(EN))

CN = (
    "定角色：{《最终幻想》中的蒂法}。全景微地面仰视拍摄效果。 整体姿势和拍摄角度：半跪着在地上，"
    "一只手向下伸，一只手向后撑住小腿，呈现着伸懒腰状态"
)
check("chinese 整体姿势 clause parsed", qt.pose_clause(CN).startswith("半跪着在地上"), qt.pose_clause(CN))
check("chinese pose -> 半跪 伸懒腰 低角度仰拍", qt.describe(CN) == "半跪 伸懒腰 低角度仰拍", qt.describe(CN))

INLINE = "单人全身镜头，姿势：双手后撑挺胸，俯视机位，镜头从上往下，人体结构自然"
check("inline 姿势： clause parsed", qt.pose_clause(INLINE).startswith("双手后撑挺胸"), qt.pose_clause(INLINE))
check("inline pose -> 双手后撑 俯拍", qt.describe(INLINE) == "双手后撑 俯拍", qt.describe(INLINE))

check("hands on hips is 叉腰 not 后撑", "双手叉腰" in qt.describe("standing with hands on hips, frontal view"), qt.describe("standing with hands on hips, frontal view"))
check("shallow water does not repeat 水景", qt.describe("lying on her back in shallow water") == "水中", qt.describe("lying on her back in shallow water"))
check("mahogany chair does not repeat 坐椅", qt.describe("坐在一张红木椅子上弯着腰") == "坐椅", qt.describe("坐在一张红木椅子上弯着腰"))
check("prompt without pose yields no detail", qt.describe("去除该角色所有衣物，展示裸体") == "", qt.describe("去除该角色所有衣物，展示裸体"))

items = [
    {"id": "a", "collection": "蒂法", "title": "蒂法", "promptText": EN},
    {"id": "b", "collection": "蒂法", "title": "蒂法", "promptText": EN},
    {"id": "c", "collection": "待归类", "title": "待归类 · 同一提示词 · 4 张", "promptText": "去除该角色所有衣物"},
    {"id": "d", "collection": "Saber", "title": "Saber", "promptText": CN},
]
titles = qt.build_titles(items)
check("duplicate pose gets a suffix", titles["b"] == "蒂法 · 坐地 分腿V字 双手抱头（2）", titles["b"])
check("detail-less card keeps its original title", titles["c"] == "待归类 · 同一提示词 · 4 张", titles["c"])
check("named card gets 角色 · 特色", titles["d"] == "Saber · 半跪 伸懒腰 低角度仰拍", titles["d"])

# --write must only touch `title`, and must round-trip the rest of the file.
tmp = Path(tempfile.mkdtemp(prefix="pg-quyi-titles-"))
cards = tmp / "quyi-cards.json"
payload = {"count": len(items), "collections": [{"id": "x"}], "items": items}
cards.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
sys.argv = ["quyi_titles.py", "--write", "--cards", str(cards)]
qt.main()
after = json.loads(cards.read_text(encoding="utf-8"))
check("write keeps unrelated keys", after["count"] == len(items) and after["collections"] == [{"id": "x"}])
check("write applies the new title", after["items"][3]["title"] == "Saber · 半跪 伸懒腰 低角度仰拍", after["items"][3]["title"])
check("write is idempotent", qt.build_titles(after["items"])["d"] == after["items"][3]["title"])
shutil.rmtree(tmp, ignore_errors=True)

failed = [r for r in results if not r[1]]
if failed:
    print(f"\nFAILED {len(failed)}/{len(results)}")
    sys.exit(1)
print(f"\nquyi titles: {len(results)} checks passed")
