#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Give every 18+ card a readable 「角色 · 画面特色」 title.

Titles live in public/data/quyi-cards.json (the file the homepage renders), so
this rewrites that file's `title` field only. The pose/venue/camera wording is
derived from each card's own prompt — nothing is invented, and a card whose
prompt says nothing about pose keeps the bare character name.

  python3 scripts/quyi_titles.py            # dry run, prints the mapping
  python3 scripts/quyi_titles.py --write    # update quyi-cards.json
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARDS = ROOT / "public" / "data" / "quyi-cards.json"

# (category, regex, label). First match in a category wins; categories are
# joined in this order, so titles read 姿态 · 细节 · 机位/场景.
RULES: list[tuple[str, str, str]] = [
    # --- 姿态 ---
    ("stance", r"sitting on the ground|sit on the ground|坐在地上|坐地", "坐地"),
    ("stance", r"sitting on a concrete ledge|坐矮台", "坐矮台"),
    ("stance", r"sitting sideways on a wooden deck", "侧坐木台"),
    ("stance", r"sitting on a black chair|Sitting on a mahogany chair|坐在.{0,6}椅子", "坐椅"),
    ("stance", r"lying on a window seat", "卧窗台"),
    ("stance", r"shallow water", "水中"),
    ("stance", r"lying on (?:her )?back|仰卧|躺着", "仰躺"),
    ("stance", r"kneeling halfway|半跪", "半跪"),
    ("stance", r"kneeling with knees spread", "跪坐分膝"),
    ("stance", r"kneeling on one knee", "单膝跪"),
    ("stance", r"squatting|蹲", "蹲姿"),
    ("stance", r"on all fours|趴着|趴在地", "趴伏"),
    ("stance", r"leaning against|靠墙|倚墙", "靠墙"),
    ("stance", r"standing|站姿", "站姿"),
    ("stance", r"sitting|坐姿", "坐姿"),
    # --- 腿 ---
    ("legs", r"legs spread wide in a V-?shape|V字|双腿大幅分开|legs spread in a V", "分腿V字"),
    ("legs", r"knees spread apart", "双膝分开"),
    ("legs", r"legs crossed|翘起.{0,4}腿|翘着二郎腿", "翘腿"),
    ("legs", r"knees up|单膝抬起|one knee raised", "单膝抬起"),
    ("legs", r"legs slightly apart", "双腿微分"),
    # --- 手 ---
    ("hands", r"hands behind (?:the |her )?head|双手抱头|hands placed behind", "双手抱头"),
    ("hands", r"hands on hips|双手叉腰", "双手叉腰"),
    ("hands", r"双手后撑", "双手后撑"),
    ("hands", r"hands placed on the floor|hands extended to the sides|双手撑地|撑着瓷砖", "双手撑地"),
    ("hands", r"hand behind the head", "单手抱头"),
    ("hands", r"touching (?:her )?(?:toes|feet)|触碰脚尖", "触碰脚尖"),
    ("hands", r"pulling (?:her )?stockings|拉扯着丝袜", "拉丝袜"),
    ("hands", r"stretching|伸懒腰", "伸懒腰"),
    ("hands", r"resting on (?:her )?thighs", "手搭膝上"),
    ("hands", r"chin resting on one hand", "托腮"),
    # --- 机位 ---
    ("camera", r"low angle looking up|微地面仰视|仰视拍摄|低角度", "低角度仰拍"),
    ("camera", r"high angle looking down|俯视机位|镜头从上往下|俯拍", "俯拍"),
    ("camera", r"from behind|背面|背对镜头", "背面"),
    ("camera", r"three-quarter|四分之三侧", "四分之三侧"),
    ("camera", r"side view|侧身|侧面", "侧身"),
    ("camera", r"frontal view|正面", "正面"),
    # --- 场景 ---
    ("scene", r"shallow water|水边|水面", "水景"),
    ("scene", r"window|窗边|窗台", "窗边"),
    ("scene", r"forest|森林", "林间"),
    ("scene", r"blue sky|天空", "户外"),
    ("scene", r"红木椅|mahogany", "红木椅"),
    ("scene", r"白丝|white stockings", "白丝"),
    ("scene", r"黑丝|black stockings", "黑丝"),
]

CATEGORY_ORDER = ["stance", "legs", "hands", "camera", "scene"]
MAX_LABELS = 3


def pose_clause(prompt: str | None) -> str:
    text = (prompt or "").replace("\n", " ")
    for pattern in (
        r"整体姿势(?:和拍摄角度)?[：:]\s*([^；;]{6,240})",
        r"姿势[：:]\s*([^；;]{4,200})",
        r"((?:sitting|standing|kneeling|crouching|lying|leaning|straddling|squatting|on all fours|bent over)[^,]{0,140})",
        r"([^。；]{0,40}(?:坐|跪|躺|趴|站|蹲|靠|倚|跨|侧卧)[^。；]{0,80})",
    ):
        found = re.search(pattern, text, re.I)
        if found:
            return found.group(1).strip()
    return ""


def describe(prompt: str | None) -> str:
    source = f"{pose_clause(prompt)} {(prompt or '').replace(chr(10), ' ')}".lower()
    picked: dict[str, str] = {}
    for category, pattern, label in RULES:
        if category in picked:
            continue
        if re.search(pattern, source, re.I):
            picked[category] = label
    labels = [picked[c] for c in CATEGORY_ORDER if c in picked]
    # 姿态已经说清楚时不再重复同一概念。
    redundant = {
        ("水中", "水景"): "水景",
        ("跪坐分膝", "双膝分开"): "双膝分开",
        ("坐椅", "红木椅"): "红木椅",
        ("坐矮台", "窗边"): None,
    }
    drop = redundant.get((picked.get("stance"), picked.get("legs"))) or redundant.get(
        (picked.get("stance"), picked.get("scene"))
    )
    if drop:
        labels = [label for label in labels if label != drop]
    return " ".join(labels[:MAX_LABELS])


def build_titles(items: list[dict]) -> dict[str, str]:
    titles: dict[str, str] = {}
    used: dict[str, int] = {}
    for item in items:
        character = (item.get("collection") or item.get("title") or "").strip()
        detail = describe(item.get("promptText"))
        if not character:
            continue
        if not detail:
            # 提示词里没有可用的画面描述时保留原名，不靠编号凑数。
            titles[item["id"]] = item.get("title") or character
            continue
        base = f"{character} · {detail}"
        used[base] = used.get(base, 0) + 1
        titles[item["id"]] = base if used[base] == 1 else f"{base}（{used[base]}）"
    return titles


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="改写 quyi-cards.json 的 title")
    ap.add_argument("--cards", default=str(CARDS))
    args = ap.parse_args()

    path = Path(args.cards)
    data = json.loads(io.open(path, encoding="utf-8").read())
    items = data.get("items") or []
    titles = build_titles(items)

    changed = 0
    for item in items:
        next_title = titles.get(item["id"])
        if not next_title:
            continue
        if item.get("title") != next_title:
            changed += 1
        if args.write:
            item["title"] = next_title
        else:
            print(f"{item['id']}\t{item.get('title')}\t→\t{next_title}")

    if args.write:
        io.open(path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        )
        print(f"已更新 {changed} 张卡片的标题 -> {path}", file=sys.stderr)
    else:
        print(f"待更新 {changed} 张（preview 模式，未写盘）", file=sys.stderr)


if __name__ == "__main__":
    main()
