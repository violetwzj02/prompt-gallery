# -*- coding: utf-8 -*-
"""Parse PROMPT_MASTER.md → public/data/prompts.json.

Starts from the same 106 master anchors as build_xlsx.py, then explodes
known collections into one JSON item per independently copyable sub-prompt.
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, OrderedDict
from difflib import SequenceMatcher

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_MASTER = os.path.normpath(os.path.join(ROOT, "..", "prompt-library", "PROMPT_MASTER.md"))
OUT = os.path.join(ROOT, "public", "data", "prompts.json")
META_OUT = os.path.join(ROOT, "public", "data", "meta.json")

CAT_MAP = {
    "renwu": "人物",
    "changjing": "场景",
    "goutu": "构图",
    "texiao": "特效",
    "zhoubian": "周边",
    "yishu": "艺术",
}
CAT_SLUG = {v: k for k, v in CAT_MAP.items()}
CAT_SLUG["MJ"] = "mj"
CAT_SLUG["18+"] = "eighteen"
MJ_CATEGORY = "MJ"
MJ_SLUG = "mj"
# Cards that belong in the MJ 大类. Shao 赛博 cards and 米山舞风格 are assigned in
# merge_obsidian_styles; they are listed here so a later apply_mj_category
# pass is idempotent. renwu-28 is intentionally excluded (body: 非 Midjourney).
MJ_ITEM_IDS = {
    *{f"renwu-{n}" for n in range(18, 28)},
    *{f"changjing-9-{n:02d}" for n in range(1, 8)},
    "yishu-47",  # 米山舞风格
}
FALLBACK_USAGE = {
    "人物": "角色设定 / 人像精修 / 人物渲染",
    "场景": "环境 / 地点 / 场景类视觉",
    "构图": "镜头 / 分镜 / 版式 / 信息图",
    "特效": "光效 / 能量 / 法术特技",
    "周边": "商品化 / 纪念品 / 周边",
    "艺术": "插画风 / 艺术字 / 艺术海报",
    "MJ": "仅适用于 Midjourney 的提示词",
}

# Clean collection display names (no ×N suffix).
COLLECTION_NAMES = {
    "texiao-1": "仙侠人物特效",
    "goutu-1": "短剧景别构图",
    "goutu-3": "设计可视化",
    "renwu-1": "脸模",
    "renwu-3": "精修五大词",
    "yishu-28": "黑底彩色手写艺术字",
    "changjing-7": "巨构提示词",
    "changjing-4": "未来景观",
    "changjing-9": "邵氏赛博",
    "changjing-10": "仙侠繁华试",
    "grok-renxiang": "人像写真",
    "grok-haibao": "海报封面",
    "grok-chahua": "插画角色",
    "grok-changjing": "场景概念",
    "grok-chanpin": "产品转化",
}

# Controlled style / purpose vocabulary. Order is the UI facet order.
STYLE_VOCAB = [
    "人像",
    "角色设定",
    "脸模",
    "精修",
    "转绘",
    "景别",
    "近景",
    "特写",
    "远景",
    "构图",
    "分镜",
    "可视化",
    "仙侠",
    "特效",
    "古风",
    "科幻",
    "巨构",
    "海报",
    "插画",
    "艺术字",
    "手写",
    "书法",
    "电商",
    "商品",
    "写实",
    "摄影",
    "电影感",
    "二次元",
    "Q版",
    "Midjourney",
    "图生图",
    "拼贴",
    "极简",
    "Cosplay",
]

MEDIUMS = ("图像", "视频", "模板", "图生提示词")

# Extra style tags guaranteed for every card in a collection.
COLLECTION_STYLE = {
    "仙侠人物特效": ["仙侠"],
    "短剧景别构图": ["景别"],
    "设计可视化": ["可视化"],
    "脸模": ["脸模", "人像"],
    "精修五大词": ["精修"],
    "黑底彩色手写艺术字": ["艺术字", "手写", "书法"],
    "巨构提示词": ["巨构"],
    "未来景观": ["科幻", "巨构"],
}

# keyword → style tags (applied to title + collection + prompt; usage only if not the category fallback)
STYLE_RULES = [
    (r"Midjourney|--ar\s|--v\s|--style raw", ["Midjourney"]),
    (r"仙侠|灵力|灵气|道韵|佛光|煞气|剑意", ["仙侠", "特效"]),
    (r"特效|光效|法术", ["特效"]),
    (r"脸模|天鹅脸|鹿系脸|狐系脸|猫系脸|脸型", ["脸模", "人像"]),
    (r"人像|肖像|五官|写真", ["人像"]),
    (r"精修|去瑕|去除提示词|真实感提示词", ["精修"]),
    (r"转绘|转真人", ["转绘"]),
    (r"角色设定|设定卡|三视图", ["角色设定"]),
    (r"分镜|一镜到底|视频生成", ["分镜"]),
    (r"可视化|架构图|爆炸视图|教学图|封面图", ["可视化"]),
    (r"古风|古典|东方|仙宫|天宫|神龙", ["古风"]),
    (r"科幻|sci-?fi|futuristic|未来巨构|未来景观", ["科幻"]),
    (r"巨构|megastructure|神龙", ["巨构"]),
    (r"海报", ["海报"]),
    (r"插画|illustration", ["插画"]),
    (r"电商", ["电商", "商品"]),
    (r"商品|产品打光|白底图|冰箱贴", ["商品"]),
    (r"写实|超真实|真实摄影", ["写实"]),
    (r"摄影|镜头|85mm|EOS", ["摄影"]),
    (r"电影感|cinematic", ["电影感"]),
    (r"二次元|动漫|动画海报", ["二次元"]),
    (r"Q\s*版", ["Q版", "插画"]),
    (r"图生|参考图|照片\s*→|照片→", ["图生图"]),
    (r"拼贴|胶带|邮票|撕纸", ["拼贴"]),
    (r"极简", ["极简"]),
    (r"Cosplay|COS", ["Cosplay", "人像"]),
]

ASPECT_RE = re.compile(
    r"(?<![\d])(16:9|9:16|3:4|4:3|3:1|1:1|9:10|21:9|2:1|4:5|5:4|2:3|3:2)(?![\d])"
)
AR_FLAG_RE = re.compile(r"--ar\s+(\d+:\d+)")

CN_NUM = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
}


def extract_usage(body: str, cat: str) -> str:
    parts = []
    for bl in body.split("\n"):
        s = bl.strip()
        if s.startswith(">"):
            inner = re.sub(r"^>\s*", "", s).strip()
            if re.search(r"(用途|风格|适用|使用说明)", inner):
                parts.append(inner)
    return "；".join(parts) if parts else FALLBACK_USAGE[cat]


def extract_prompt_text(body: str) -> str:
    """Best-effort pure prompt for unsplit entries (mirrors promptExtract.ts, plus fences)."""
    fences = re.findall(r"```(?:\w+)?\n(.*?)```", body, re.S)
    fences = [f.strip() for f in fences if f.strip()]
    if len(fences) == 1:
        return fences[0]
    if len(fences) > 1:
        return "\n\n".join(fences)

    lines = body.split("\n")
    chunks: list[str] = []
    collecting = False
    buf: list[str] = []

    def flush():
        nonlocal collecting, buf
        t = "\n".join(buf).strip()
        if t:
            chunks.append(t)
        buf = []
        collecting = False

    for raw in lines:
        stripped = raw.strip()
        if re.match(r"^\*\*提示词\*\*", stripped) or re.match(r"^提示词[：:]", stripped):
            flush()
            collecting = True
            after = re.sub(r"^\*\*提示词\*\*\s*[：:]?\s*", "", stripped)
            after = re.sub(r"^提示词[：:]\s*", "", after)
            if after:
                buf.append(after)
            continue
        if collecting:
            if (
                re.match(r"^#{1,3}\s", stripped)
                or re.match(r"^\*\*[^*]+\*\*\s*[：:]?\s*$", stripped)
                or re.match(r"^---+$", stripped)
                or (stripped.startswith(">") and re.search(r"用途|风格|适用|说明", stripped))
            ):
                flush()
                continue
            if stripped == "" and buf and buf[-1] == "":
                flush()
                continue
            buf.append(raw.rstrip())
    flush()
    if chunks:
        return "\n\n".join(chunks).strip()

    paras = []
    for p in re.split(r"\n{2,}", body):
        kept = []
        for l in p.split("\n"):
            t = l.strip()
            if not t:
                continue
            if t.startswith(">"):
                continue
            if re.match(r"^#{1,6}\s", t):
                continue
            if re.match(r"^---+$", t):
                continue
            if re.match(r"^\*\*[^*]+\*\*\s*$", t):
                continue
            kept.append(re.sub(r"^\*\*[^*]+\*\*[：:]\s*", "", l))
        text = "\n".join(kept).strip()
        if len(text) > 40:
            paras.append(text)
    if not paras:
        return body.strip()
    paras.sort(key=len, reverse=True)
    return paras[0]


def detect_aspect(*texts: str) -> str | None:
    blob = "\n".join(t for t in texts if t)
    m = AR_FLAG_RE.search(blob)
    if m:
        return m.group(1)
    m = ASPECT_RE.search(blob)
    return m.group(1) if m else None


def detect_medium(title: str, usage: str, body: str, parent_id: str | None, collection: str | None) -> str:
    blob = f"{title}\n{usage}\n{collection or ''}"
    pid = parent_id or ""
    if pid == "goutu-5" or "图生提示词" in title:
        return "图生提示词"
    if pid in {"goutu-3"} or "模板型" in usage or "【占位符】" in body[:800]:
        # 角色设定卡 is also a fill-in template
        if pid == "goutu-3":
            return "模板"
    if pid == "renwu-3" and "设定卡" in title:
        return "模板"
    if re.search(r"视频|分镜|一镜到底", title) or re.search(r"视频生成|分镜脚本|一镜到底", usage):
        return "视频"
    if "模板" in title or (collection == "设计可视化"):
        return "模板"
    return "图像"


# These tags are too common inside recipe bodies (e.g. "远景元素", "手写文字").
# Only mine them from the title, collection name, and non-fallback usage line.
TITLE_STYLE_RULES = [
    (r"景别", ["景别"]),
    (r"头肩|近景", ["近景"]),
    (r"大特写|特写", ["特写"]),
    (r"大远景|远景|鸟瞰", ["远景"]),
    (r"艺术字|手写", ["艺术字", "手写"]),
    (r"书法|狂草", ["书法", "艺术字"]),
]


def detect_style_tags(title: str, usage: str, collection: str | None, body_head: str = "") -> list[str]:
    usage_ok = usage if usage and usage not in FALLBACK_USAGE.values() else ""
    title_blob = "\n".join([title, collection or "", usage_ok])
    body_blob = "\n".join([title, collection or "", usage_ok, body_head[:1200]])
    found: list[str] = []
    for tag in COLLECTION_STYLE.get(collection or "", []):
        if tag not in found:
            found.append(tag)
    for pat, tags in TITLE_STYLE_RULES:
        if re.search(pat, title_blob, re.I):
            for tag in tags:
                if tag not in found:
                    found.append(tag)
    for pat, tags in STYLE_RULES:
        if re.search(pat, body_blob, re.I):
            for tag in tags:
                if tag not in found:
                    found.append(tag)
    return found[:6]


def build_tags(
    category: str,
    collection: str | None,
    medium: str,
    aspect: str | None,
    style: list[str],
) -> list[str]:
    tags: list[str] = []
    for t in [category, collection, medium, aspect, *style]:
        if t and t not in tags:
            tags.append(t)
    return tags[:8]


def child_id(parent_id: str, index: int) -> str:
    return f"{parent_id}-{index:02d}"


def parse_master(text: str) -> list[dict]:
    lines = text.split("\n")
    entries: list[dict] = []
    cat = None
    cur = None

    def finalize():
        nonlocal cur
        if cur is None:
            return
        usage = extract_usage(cur["body"], cur["cat"])
        entries.append(
            {
                "id": cur["id"],
                "category": cur["cat"],
                "categorySlug": CAT_SLUG[cur["cat"]],
                "title": cur["title"],
                "usage": usage,
                "body": cur["body"].strip(),
                "source": cur["src"],
                "cover": None,
            }
        )
        cur = None

    i, N = 0, len(lines)
    while i < N:
        line = lines[i].strip()
        m = re.match(r'<a id="([^"]+)"></a>', line)
        if m:
            aid = m.group(1)
            if aid in CAT_MAP:
                finalize()
                cat = CAT_MAP[aid]
            elif re.match(r"[a-z]+-\d+", aid):
                finalize()
                j = i + 1
                while j < N and not lines[j].startswith("### "):
                    j += 1
                title = lines[j].replace("### ", "", 1).strip() if j < N else ""
                src = ""
                sm = re.search(r"（原\s*(.+?)\s*）", title)
                if sm:
                    src = sm.group(1)
                    title = title[: title.index("（原")].strip()
                k = j + 1
                buf = []
                while k < N and not re.match(r'<a id="', lines[k].strip()):
                    buf.append(lines[k])
                    k += 1
                cur = {"id": aid, "cat": cat, "title": title, "body": "\n".join(buf), "src": src}
            i += 1
            continue
        i += 1
    finalize()
    return entries


# ---------------------------------------------------------------------------
# Splitters
# ---------------------------------------------------------------------------

FENCE_ITEM = re.compile(r"^###\s+(\d+)\.\s+(.+)$", re.M)
CN_SECTION = re.compile(r"^##\s+([一二三四五六七八九十]+)、\s*(.+)$", re.M)
FACE_ITEM = re.compile(r"^##\s+(\d+)\.\s+(.+)$", re.M)
EXAMPLE_ITEM = re.compile(r"^###\s+例\s*(\d+)\s*｜\s*(.+)$", re.M)


def _cut_after(body: str, headings: tuple[str, ...]) -> str:
    return re.split(r"\n## (?:%s)\b" % "|".join(headings), body, maxsplit=1)[0]


def split_numbered_fences(body: str) -> list[dict]:
    cut = _cut_after(body, ("OCR 说明", "调用建议"))
    matches = list(FENCE_ITEM.finditer(cut))
    items = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(cut)
        chunk = cut[start:end]
        fence = re.search(r"```(?:\w+)?\n(.*?)```", chunk, re.S)
        prompt = fence.group(1).strip() if fence else chunk.strip()
        note_m = re.search(r">\s*\*\*注：\*\*\s*(.+)", chunk)
        note = note_m.group(1).strip() if note_m else None
        items.append(
            {
                "index": int(m.group(1)),
                "title": m.group(2).strip(),
                "prompt": prompt,
                "body": f"```\n{prompt}\n```",
                "note": note,
            }
        )
    return items


def _parse_screenshot_ref(note: str, current_index: int) -> int | None:
    """Map phrases like 与截图 3 第 4 条 / 与本截图第 4 条 to a 1-based item index.

    These collections are laid out 5 items per screenshot.
    """
    if not note:
        return None
    m = re.search(r"与截图\s*(\d+)\s*第\s*(\d+)\s*条", note)
    if m:
        shot, k = int(m.group(1)), int(m.group(2))
        return (shot - 1) * 5 + k
    m = re.search(r"与本截图第\s*(\d+)\s*条", note)
    if m:
        k = int(m.group(1))
        shot = (current_index - 1) // 5 + 1
        return (shot - 1) * 5 + k
    m = re.search(r"与截图\s*(\d+)\s*和截图\s*(\d+)", note)
    return None


def split_cn_sections(body: str) -> list[dict]:
    cut = _cut_after(body, ("调用建议",))
    matches = list(CN_SECTION.finditer(cut))
    items = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(cut)
        chunk = cut[start:end].strip()
        # trim leading/trailing ---
        chunk = re.sub(r"^---+\s*", "", chunk)
        chunk = re.sub(r"\s*---+$", "", chunk).strip()
        title = m.group(2).strip()
        items.append(
            {
                "index": CN_NUM.get(m.group(1), i + 1),
                "title": title,
                "prompt": chunk,
                "body": chunk,
                "note": None,
            }
        )
    return items


def split_renwu_faces(body: str) -> list[dict]:
    cut = _cut_after(body, ("调用建议",))
    matches = list(FACE_ITEM.finditer(cut))
    items = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(cut)
        chunk = cut[start:end].strip()
        chunk = re.sub(r"^---+\s*", "", chunk)
        chunk = re.sub(r"\s*---+$", "", chunk).strip()
        kw = ""
        km = re.search(r"\*\*风格关键词\*\*\s*[：:]?\s*(.+)", chunk)
        if km:
            kw = km.group(1).strip()
        prompt = ""
        pm = re.search(r"\*\*提示词\*\*\s*[：:]?\s*\n?(.*)", chunk, re.S)
        if pm:
            prompt = pm.group(1).strip()
            prompt = re.sub(r"\s*---+$", "", prompt).strip()
        else:
            prompt = chunk
        body_parts = []
        if kw:
            body_parts.append(f"**风格关键词**：{kw}")
        body_parts.append("**提示词**：\n" + prompt)
        items.append(
            {
                "index": int(m.group(1)),
                "title": m.group(2).strip(),
                "prompt": prompt,
                "body": "\n\n".join(body_parts),
                "note": None,
                "extra_style": kw,
            }
        )
    return items


def split_yishu_examples(body: str) -> list[dict]:
    matches = list(EXAMPLE_ITEM.finditer(body))
    items = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        chunk = body[start:end].strip()
        prompt = chunk
        pm = re.search(r"提示词[：:]\s*(.*?)(?=\n\n[（(]注|\n### |\Z)", chunk, re.S)
        if pm:
            prompt = pm.group(1).strip()
        note = None
        nm = re.search(r"[（(]注：(.+?)[）)]", chunk, re.S)
        if nm:
            note = nm.group(1).strip()
        body = f"提示词：{prompt}"
        if note:
            body += f"\n\n（注：{note}）"
        items.append(
            {
                "index": int(m.group(1)),
                "title": m.group(2).strip(),
                "prompt": prompt,
                "body": body,
                "note": note,
            }
        )
    return items


def split_changjing_7(body: str) -> list[dict]:
    items = []
    # 神龙绕天宫
    m = re.search(
        r"####\s*神龙绕天宫[^\n]*\n+(.*?)(?=\n#### |\Z)",
        body,
        re.S,
    )
    if m:
        prompt = m.group(1).strip()
        prompt = re.sub(r"\s*---+$", "", prompt).strip()
        items.append(
            {
                "index": 1,
                "title": "神龙绕天宫",
                "prompt": prompt,
                "body": prompt,
                "note": None,
            }
        )
    m2 = re.search(r"####\s*未来巨构景观[^\n]*\n+(.*)", body, re.S)
    if m2:
        block = m2.group(1).strip()
        for n, para in _split_numbered_paras(block):
            items.append(
                {
                    "index": 1 + n,  # 2..5 after 神龙
                    "title": f"未来巨构景观 {n}",
                    "prompt": para,
                    "body": para,
                    "note": None,
                }
            )
    return items


def _split_numbered_paras(block: str) -> list[tuple[int, str]]:
    block = re.sub(r"\s*---+\s*$", "", block).strip()
    parts = re.split(r"(?m)^(\d+)\.\s+", block)
    # parts = [preamble, num, text, num, text, ...]
    out = []
    i = 1
    while i < len(parts) - 1:
        try:
            n = int(parts[i])
        except ValueError:
            i += 1
            continue
        para = parts[i + 1].strip()
        para = re.sub(r"\s*---+$", "", para).strip()
        if para:
            out.append((n, para))
        i += 2
    return out


def split_changjing_4(body: str) -> list[dict]:
    items = []
    for n, para in _split_numbered_paras(body):
        items.append(
            {
                "index": n,
                "title": f"未来景观 {n}",
                "prompt": para,
                "body": para,
                "note": None,
            }
        )
    return items


SPLITTERS = {
    "texiao-1": ("仙侠人物特效", split_numbered_fences),
    "goutu-1": ("短剧景别构图", split_numbered_fences),
    "goutu-3": ("设计可视化", split_cn_sections),
    "renwu-1": ("脸模", split_renwu_faces),
    "renwu-3": ("精修五大词", split_cn_sections),
    "yishu-28": ("黑底彩色手写艺术字", split_yishu_examples),
    "changjing-7": ("巨构提示词", split_changjing_7),
    "changjing-4": ("未来景观", split_changjing_4),
}

# Known OCR / source duplicate mappings: parent_id -> {later_index: earlier_index}
KNOWN_DUPLICATES = {
    "texiao-1": {26: 16, 28: 27},
    "goutu-1": {25: 1, 19: 14, 30: 29},
}


def make_item(
    *,
    id: str,
    category: str,
    title: str,
    usage: str,
    body: str,
    source: str,
    parent_id: str | None,
    collection: str | None,
    collection_index: int | None,
    collection_total: int | None,
    prompt_text: str,
    duplicate_note: str | None = None,
    extra_blob: str = "",
) -> dict:
    medium = detect_medium(title, usage, body, parent_id, collection)
    aspect = detect_aspect(title, usage, body, prompt_text, collection or "")
    # Do not mine a collection's shared usage for child cards — it leaks sibling themes.
    usage_for_tags = usage if parent_id is None else ""
    style = detect_style_tags(title, usage_for_tags, collection, f"{extra_blob}\n{prompt_text}")
    tags = build_tags(category, collection, medium, aspect, style)
    return {
        "id": id,
        "category": category,
        "categorySlug": CAT_SLUG[category],
        "title": title,
        "usage": usage,
        "body": body,
        "source": source,
        "cover": None,
        "parentId": parent_id,
        "collection": collection,
        "collectionIndex": collection_index,
        "collectionTotal": collection_total,
        "tags": tags,
        "medium": medium,
        "aspect": aspect,
        "promptText": prompt_text,
        "duplicateNote": duplicate_note,
        "duplicateOf": None,
    }


def explode(entries: list[dict]) -> tuple[list[dict], list[tuple[str, str, int]]]:
    out: list[dict] = []
    report: list[tuple[str, str, int]] = []
    for e in entries:
        fn = SPLITTERS.get(e["id"])
        if not fn:
            item = make_item(
                id=e["id"],
                category=e["category"],
                title=e["title"],
                usage=e["usage"],
                body=e["body"],
                source=e["source"],
                parent_id=None,
                collection=None,
                collection_index=None,
                collection_total=None,
                prompt_text=extract_prompt_text(e["body"]),
                extra_blob=e["title"] + "\n" + e["usage"],
            )
            out.append(item)
            continue

        collection, splitter = fn
        children_raw = splitter(e["body"])
        if not children_raw:
            # fallback: keep as single if splitter failed
            print(f"WARNING: splitter for {e['id']} returned 0 items; keeping as single", file=sys.stderr)
            item = make_item(
                id=e["id"],
                category=e["category"],
                title=e["title"],
                usage=e["usage"],
                body=e["body"],
                source=e["source"],
                parent_id=None,
                collection=None,
                collection_index=None,
                collection_total=None,
                prompt_text=extract_prompt_text(e["body"]),
            )
            out.append(item)
            continue

        total = len(children_raw)
        # Use declared index if present, else 1..N
        kids = []
        known = KNOWN_DUPLICATES.get(e["id"], {})
        for raw in children_raw:
            idx = raw["index"]
            note = raw.get("note")
            dup_of = None
            if idx in known:
                dup_of = child_id(e["id"], known[idx])
                if not note:
                    note = f"与 {children_raw[known[idx] - 1]['title'] if known[idx] - 1 < len(children_raw) else dup_of} 内容相同"
            elif note:
                ref = _parse_screenshot_ref(note, idx)
                if ref:
                    dup_of = child_id(e["id"], ref)
            item = make_item(
                id=child_id(e["id"], idx),
                category=e["category"],
                title=raw["title"],
                usage=e["usage"],
                body=raw["body"],
                source=e["source"],
                parent_id=e["id"],
                collection=collection,
                collection_index=idx,
                collection_total=total,
                prompt_text=raw["prompt"],
                duplicate_note=note,
                extra_blob=raw.get("extra_style", "") or "",
            )
            if dup_of:
                item["duplicateOf"] = dup_of
                if not item["duplicateNote"]:
                    item["duplicateNote"] = f"与 {dup_of} 内容相同"
            kids.append(item)
        out.extend(kids)
        report.append((e["id"], e["title"], total))
    return out, report


def resolve_cross_duplicates(items: list[dict]) -> None:
    """Mark near-identical promptText as duplicates (keep later → earlier)."""
    by_text: dict[str, str] = {}
    normalized = []
    for it in items:
        key = re.sub(r"\s+", " ", (it.get("promptText") or "")).strip().lower()
        normalized.append((it, key))

    for i, (it, key) in enumerate(normalized):
        if not key or len(key) < 40:
            continue
        if it.get("duplicateOf"):
            # still try to keep existing
            pass
        # exact normalized match
        if key in by_text:
            if not it.get("duplicateOf"):
                it["duplicateOf"] = by_text[key]
                src = next((x for x in items if x["id"] == by_text[key]), None)
                label = src["title"] if src else by_text[key]
                if not it.get("duplicateNote"):
                    it["duplicateNote"] = f"与「{label}」内容相同"
            continue
        # fuzzy against already seen (for changjing-4 vs changjing-7 punctuation drift)
        matched = None
        for prev_key, prev_id in list(by_text.items()):
            if abs(len(prev_key) - len(key)) > max(40, 0.15 * max(len(prev_key), len(key))):
                continue
            if SequenceMatcher(None, prev_key, key).ratio() >= 0.92:
                matched = prev_id
                break
        if matched and not it.get("duplicateOf"):
            it["duplicateOf"] = matched
            src = next((x for x in items if x["id"] == matched), None)
            label = src["title"] if src else matched
            it["duplicateNote"] = it.get("duplicateNote") or f"与「{label}」内容基本相同"
            continue
        by_text[key] = it["id"]


def build_meta(items: list[dict], generated_from: str, master_count: int) -> dict:
    cat_counts = {k: 0 for k in ["人物", "场景", "构图", "特效", "周边", "艺术", "MJ", "Grok"]}
    for it in items:
        cat_counts[it["category"]] = cat_counts.get(it["category"], 0) + 1

    collections: dict[str, dict] = OrderedDict()
    for it in items:
        if not it.get("parentId"):
            continue
        pid = it["parentId"]
        if pid not in collections:
            collections[pid] = {
                "id": pid,
                "name": it["collection"],
                "category": it["category"],
                "count": 0,
            }
        collections[pid]["count"] += 1

    medium_counts = Counter(it["medium"] for it in items if it.get("medium"))
    aspect_counts = Counter(it["aspect"] for it in items if it.get("aspect"))

    style_counts: Counter = Counter()
    structural = set(["人物", "场景", "构图", "特效", "周边", "艺术", "MJ", "MJ风格", "Grok"]) | set(COLLECTION_NAMES.values()) | set(MEDIUMS)
    for it in items:
        for t in it.get("tags") or []:
            if t in STYLE_VOCAB and t not in structural and t != it.get("aspect"):
                style_counts[t] += 1

    # facet lists in stable vocab order, only those that appear
    style_facets = [{"name": t, "count": style_counts[t]} for t in STYLE_VOCAB if style_counts[t] > 0]
    medium_facets = [{"name": m, "count": medium_counts[m]} for m in MEDIUMS if medium_counts[m] > 0]
    aspect_facets = [
        {"name": a, "count": aspect_counts[a]}
        for a in sorted(aspect_counts, key=lambda x: (-aspect_counts[x], x))
    ]

    return {
        "generatedFrom": generated_from,
        "masterCount": master_count,
        "count": len(items),
        "categories": cat_counts,
        "collections": list(collections.values()),
        "tagFacets": {
            "medium": medium_facets,
            "aspect": aspect_facets,
            "style": style_facets,
        },
    }



def apply_mj_category(items: list[dict]) -> int:
    """Put only the Midjourney-specific cards into the MJ 大类.

    Membership is MJ_ITEM_IDS (renwu-18..27, the seven 邵氏赛博 cards, and yishu-47 米山舞风格).
    All other cards keep their original 大类. The retired 「MJ风格」 tag is
    stripped everywhere; members may keep a 「MJ」 tag.
    """
    moved = 0
    for it in items:
        tags = [t for t in (it.get("tags") or []) if t != "MJ风格"]
        if it.get("id") in MJ_ITEM_IDS:
            if it.get("category") != MJ_CATEGORY or it.get("categorySlug") != MJ_SLUG:
                moved += 1
            it["category"] = MJ_CATEGORY
            it["categorySlug"] = MJ_SLUG
            if "MJ" not in tags:
                tags.insert(0, "MJ")
        else:
            if it.get("category") in (MJ_CATEGORY, "MJ风格"):
                # Should have been restored already; do not invent a 大类 here.
                pass
            tags = [t for t in tags if t != "MJ"]
        it["tags"] = tags
    return moved


def recategorize_master_as_mj(items: list[dict]) -> int:
    """Backward-compatible name; no longer moves the whole master library."""
    return apply_mj_category(items)


COVER_DIR = os.path.join(ROOT, "public", "covers", "entries")


def _public_file(rel: str) -> bool:
    if not rel or not isinstance(rel, str):
        return False
    return os.path.isfile(os.path.join(ROOT, "public", rel))


def _existing_covers(paths) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    if not isinstance(paths, list):
        return out
    for src in paths:
        if not isinstance(src, str):
            continue
        rel = src.strip()
        if not rel or rel in seen or not _public_file(rel):
            continue
        seen.add(rel)
        out.append(rel)
    return out


def reattach_covers(items: list[dict], previous_path: str = OUT) -> int:
    """Restore cover / covers paths after a re-parse. Never overwrites or deletes files."""
    prev: dict[str, str] = {}
    prev_covers: dict[str, list] = {}
    if os.path.isfile(previous_path):
        try:
            with open(previous_path, encoding="utf-8") as f:
                old = json.load(f)
            for it in old.get("items") or []:
                cid = it.get("id")
                if not cid:
                    continue
                cover = it.get("cover")
                if cover:
                    prev[cid] = cover
                covers = it.get("covers")
                if isinstance(covers, list) and covers:
                    prev_covers[cid] = covers
        except (OSError, json.JSONDecodeError):
            prev = {}
            prev_covers = {}

    attached = 0
    for it in items:
        if it.get("cover") and _public_file(it["cover"]):
            attached += 1
        else:
            cover = prev.get(it["id"])
            if not cover:
                for ext in (".jpg", ".jpeg", ".png", ".webp"):
                    candidate = os.path.join(COVER_DIR, f"{it['id']}{ext}")
                    if os.path.isfile(candidate):
                        cover = f"covers/entries/{it['id']}{ext}"
                        break
            if cover and _public_file(cover):
                it["cover"] = cover
                attached += 1
            elif it.get("cover") and not _public_file(it["cover"]):
                # Never keep a cover path that is not on disk.
                it["cover"] = None

        covers = it.get("covers")
        if not isinstance(covers, list) or not covers:
            covers = prev_covers.get(it["id"])
        existing = _existing_covers(covers)
        if existing:
            it["covers"] = existing
        else:
            it.pop("covers", None)
    return attached



# Do not let a re-parse clobber already-curated copy on existing cards.
PRESERVE_TEXT_FIELDS = (
    "promptText",
    "body",
    "title",
    "usage",
    "source",
    "medium",
    "aspect",
    "duplicateNote",
    "duplicateOf",
    "parentId",
    "collection",
    "collectionIndex",
    "collectionTotal",
    "chinesePrompt",
    "grokPrompt",
)


def preserve_existing_text(items: list[dict], previous_path: str = OUT) -> int:
    """Restore text and identity fields from the previous prompts.json.

    Category, categorySlug, tags, and cover / covers are left to the
    recategorize / supplement / reattach steps.
    """
    if not os.path.isfile(previous_path):
        return 0
    try:
        with open(previous_path, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, json.JSONDecodeError):
        return 0
    prev = {it["id"]: it for it in old.get("items") or [] if it.get("id")}
    kept = 0
    for it in items:
        src = prev.get(it["id"])
        if not src:
            continue
        changed = False
        for field in PRESERVE_TEXT_FIELDS:
            if field in src and it.get(field) != src.get(field):
                it[field] = src.get(field)
                changed = True
        if changed:
            kept += 1
    return kept


def preserve_extra_items(items: list[dict], previous_path: str = OUT) -> int:
    """Keep cards that exist only in the previous prompts.json (e.g. yishu-50).

    A master re-parse plus the Obsidian supplement would otherwise drop
    user-added entries. Re-insert them next to their previous neighbors
    when possible.
    """
    if not os.path.isfile(previous_path):
        return 0
    try:
        with open(previous_path, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, json.JSONDecodeError):
        return 0
    old_items = [it for it in (old.get("items") or []) if it.get("id")]
    if not old_items:
        return 0
    new_ids = {it["id"] for it in items if it.get("id")}
    extras = [it for it in old_items if it["id"] not in new_ids]
    if not extras:
        return 0
    old_ids = [it["id"] for it in old_items]
    id_to_index = {it["id"]: i for i, it in enumerate(items)}
    for extra in extras:
        idx = old_ids.index(extra["id"])
        inserted = False
        for prev_id in reversed(old_ids[:idx]):
            if prev_id in id_to_index:
                pos = id_to_index[prev_id] + 1
                items.insert(pos, extra)
                inserted = True
                break
        if not inserted:
            items.append(extra)
        id_to_index = {it["id"]: i for i, it in enumerate(items)}
    return len(extras)


def main():
    master = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MASTER
    if not os.path.isfile(master):
        raise SystemExit(f"Master not found: {master}")
    text = open(master, encoding="utf-8").read()
    entries = parse_master(text)
    print(f"Master anchors: {len(entries)}")
    items, report = explode(entries)
    resolve_cross_duplicates(items)
    # Master cards stay in their original 大类. MJ membership is applied after
    # the Obsidian supplement (and any extra cards such as yishu-50) is merged.

    meta = build_meta(items, os.path.basename(master), len(entries))
    payload = {
        "generatedFrom": os.path.basename(master),
        "masterCount": len(entries),
        "count": len(items),
        "categories": meta["categories"],
        "collections": meta["collections"],
        "tagFacets": meta["tagFacets"],
        "items": items,
    }
    # Keep the Obsidian 2026-11-20 supplement after a master re-parse.
    from merge_obsidian_styles import apply_to_payload
    payload, meta = apply_to_payload(payload, meta)
    payload.pop("_mergeAdded", None)
    payload.pop("_mergeReplaced", None)
    items = payload["items"]
    extras = preserve_extra_items(items)
    apply_mj_category(items)
    attached = reattach_covers(items)
    preserved = preserve_existing_text(items)
    # Covers / preserved text do not affect meta counts; extra cards and
    # MJ membership do.
    meta = build_meta(
        items,
        payload.get("generatedFrom") or os.path.basename(master),
        payload.get("masterCount") or len(entries),
    )
    payload.update(
        {
            "generatedFrom": meta["generatedFrom"],
            "masterCount": meta["masterCount"],
            "count": meta["count"],
            "categories": meta["categories"],
            "collections": meta["collections"],
            "tagFacets": meta["tagFacets"],
        }
    )
    payload["items"] = items

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    with open(META_OUT, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\nWrote {OUT}")
    print(f"Wrote {META_OUT}")
    print(f"Total items: {len(items)}  (from {len(entries)} master entries)")
    print(f"Covers reattached: {attached}")
    print(f"Existing text preserved: {preserved}")
    print(f"Extra cards preserved: {extras}\n")
    print("Split report (parent → N children):")
    print(f"{'id':<16} {'children':>8}  title")
    print("-" * 60)
    split_ids = {r[0] for r in report}
    for pid, title, n in report:
        print(f"{pid:<16} {n:>8}  {title}")
    kept = len(entries) - len(split_ids)
    print("-" * 60)
    print(f"{'unsplit':<16} {kept:>8}  kept as single cards")
    print()
    print("Per-category counts:")
    for k, v in payload["categories"].items():
        print(f"  {k}: {v}")
    dups = [it for it in items if it.get("duplicateOf")]
    print(f"\nDuplicate cards marked: {len(dups)}")
    for it in dups:
        print(f"  {it['id']} → {it['duplicateOf']}  ({it.get('duplicateNote')})")


if __name__ == "__main__":
    main()
