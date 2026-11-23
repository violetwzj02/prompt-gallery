#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build homepage 18+ extras and album-import metadata from the Imagine「去衣」manifest.

Does not commit, deploy, or copy uncompressed originals into the git tree.
Display JPEGs are written only with --write-display-covers (opt-in, still not originals).

Usage:
  python3 scripts/ingest_quyi.py
  python3 scripts/ingest_quyi.py --write-display-covers
"""
from __future__ import annotations

import argparse
import subprocess
import hashlib
import json
import re
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "covers-inbox" / "quyi-survey" / "imagine-manifest.json"
DEFAULT_DOWNLOADS = ROOT / "covers-inbox" / "quyi-downloads"
CARDS_OUT = ROOT / "public" / "data" / "quyi-cards.json"
META_OUT = ROOT / "public" / "data" / "quyi-meta.json"
ALBUM_OUT = ROOT / "covers-inbox" / "quyi-survey" / "album-import.json"
ENTRIES = ROOT / "public" / "covers" / "entries"

ADULT_CATEGORY = "18+"
ADULT_SLUG = "eighteen"
PENDING_NAME = "待归类"
PENDING_SLUG = "pending"

# Manifest names that are labels, not confident character folders.
PENDING_SOURCE_NAMES = {
    "一战苍穹未具名角色",
    "未具名（白骑士洛丽塔）",
    "魅魔（未具名）",
}

PROMPTLESS_UUID_PREFIXES = ("1b5f5dd6", "6c246c5c", "a6966521", "e4e2c858")

# User-example names first in subnav / album drawers.
PRIORITY_DISPLAY = ("甘雨", "申鹤", "蒂法", "雷神")

# Only for names the default 「名（作品）」split cannot handle. Do not invent names.
DISPLAY_OVERRIDES: dict[str, tuple[str, str | None]] = {
    "Dragon Girl（Apotheosis / 百炼成神，英文名未给出对应中文）": ("Dragon Girl", "百炼成神"),
    "Feng Nianyun / 凤年芸（百炼成神）": ("凤年芸", "百炼成神"),
}

# Stable short slugs for collection ids (eighteen-<slug>). Explicit so CJK ids stay readable.
SLUG_BY_DISPLAY: dict[str, str] = {
    "甘雨": "ganyu",
    "申鹤": "shenhe",
    "蒂法": "tifa",
    "雷神": "raiden",
    "Saber": "saber",
    "小舞": "xiaowu",
    "小医仙": "xiaoyixian",
    "陆雪琪": "luxueqi",
    "萧薰儿": "xiaoxuner",
    "02": "02",
    "D.Va": "dva",
    "千仞雪": "qianrenxue",
    "盛彩儿": "shengcaier",
    "韩雅": "hanya",
    "宁荣荣": "ningrongrong",
    "真希波": "makinami",
    "不知火舞": "mai",
    "伊芙": "eve",
    "洛琪": "luoqi",
    "爱丽丝": "aerith",
    "甘露寺蜜璃": "kanroji",
    "绘梨衣": "erii",
    "Caster": "caster",
    "Dragon Girl": "dragon-girl",
    "凤年芸": "fengnianyun",
    "唐舞桐": "tangwutong",
    "明日香": "asuka",
    "清霄": "qingxiao",
    "玛丽·萝丝": "marie-rose",
    "米拉珍": "mirajane",
    "胡蝶忍": "shinobu",
    "艾达王": "ada",
    "葛城美里": "misato",
    "远坂凛": "rin",
    "金克丝": "jinx",
    "霞": "kasumi",
    "露西": "lucy",
    PENDING_NAME: PENDING_SLUG,
}

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_SUFFIXES = {".mp4", ".webm", ".mov"}


def short_hash(text: str, n: int = 12) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:n]


def collection_id_for(display: str) -> str:
    slug = SLUG_BY_DISPLAY.get(display)
    if not slug:
        ascii_slug = re.sub(r"[^a-z0-9]+", "-", display.lower()).strip("-")
        slug = ascii_slug if ascii_slug and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", ascii_slug) else f"c-{short_hash(display, 8)}"
    return f"{ADULT_SLUG}-{slug}"


def split_manifest_name(raw: str) -> tuple[str, str | None]:
    if raw in DISPLAY_OVERRIDES:
        return DISPLAY_OVERRIDES[raw]
    m = re.fullmatch(r"(.+)（(.+)）", raw)
    if m:
        return m.group(1).strip(), m.group(2).strip() or None
    return raw.strip(), None


def resolve_character(name: str | None, confidence: str | None, uuid: str | None = None) -> dict:
    """Map a manifest character to a folder / subnav display name.

    High and medium confidence named characters keep a short display name.
    Uncertain, nameless, 一战苍穹未具名, 魅魔, 白骑士洛丽塔, and the four
    promptless stills all go to 待归类. Names are never guessed.
    """
    conf = (confidence or "").strip().lower()
    raw = (name or "").strip() or None
    promptless = bool(uuid and uuid.startswith(PROMPTLESS_UUID_PREFIXES))
    pending_reason = None
    if promptless:
        pending_reason = "promptless-still"
    elif not raw:
        pending_reason = "nameless"
    elif raw in PENDING_SOURCE_NAMES:
        pending_reason = "source-pending-label"
    elif conf not in {"high", "medium"}:
        pending_reason = "uncertain"

    if pending_reason:
        return {
            "displayName": PENDING_NAME,
            "franchise": None,
            "slug": PENDING_SLUG,
            "collectionId": collection_id_for(PENDING_NAME),
            "pending": True,
            "sourceName": raw,
            "confidence": conf or None,
            "pendingReason": pending_reason,
        }

    display, franchise = split_manifest_name(raw)
    return {
        "displayName": display,
        "franchise": franchise,
        "slug": SLUG_BY_DISPLAY.get(display) or collection_id_for(display).split("-", 1)[-1],
        "collectionId": collection_id_for(display),
        "pending": False,
        "sourceName": raw,
        "confidence": conf,
        "pendingReason": None,
    }


def sort_display_names(names: list[str], counts: dict[str, int] | None = None) -> list[str]:
    counts = counts or {}
    named = [n for n in names if n != PENDING_NAME]
    pending = [n for n in names if n == PENDING_NAME]

    def key(name: str) -> tuple:
        try:
            prio = PRIORITY_DISPLAY.index(name)
        except ValueError:
            prio = len(PRIORITY_DISPLAY)
        # After the four examples, larger folders first, then name.
        return (prio, 0 if prio < len(PRIORITY_DISPLAY) else -(counts.get(name, 0)), name)

    return sorted(named, key=key) + pending


def load_manifest(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    raise SystemExit(f"Unexpected manifest shape in {path}")


def find_download(uuid: str, media_type: str, downloads: Path) -> dict:
    """Locate a downloaded file for this uuid without moving it."""
    if not downloads.exists():
        return {"path": None, "preview": None, "kind": None}

    stems = [uuid, uuid.replace("-", "")]
    files: list[Path] = []
    for folder in (downloads / "stills", downloads / "videos", downloads / "quality-probes", downloads):
        if not folder.is_dir():
            continue
        for p in folder.rglob("*"):
            if p.is_file() and any(uuid in p.name or uuid in str(p.relative_to(downloads)) for _ in [0]):
                files.append(p)

    # Also accept exact children like stills/<uuid>.jpg
    for stem in stems:
        for folder in (downloads / "stills", downloads / "videos", downloads, downloads / stem):
            if not folder.exists():
                continue
            if folder.is_file():
                files.append(folder)
                continue
            if folder.is_dir():
                for p in folder.iterdir():
                    if p.is_file() and (p.stem == stem or p.stem.startswith(stem) or stem in p.name):
                        files.append(p)

    unique: list[Path] = []
    seen: set[Path] = set()
    for p in files:
        rp = p.resolve()
        if rp in seen:
            continue
        seen.add(rp)
        unique.append(p)

    poster = downloads / "posters" / f"{uuid}.jpg"
    if poster.is_file():
        unique.append(poster)
    image = next((p for p in unique if p.suffix.lower() in IMAGE_SUFFIXES), None)
    video = next((p for p in unique if p.suffix.lower() in VIDEO_SUFFIXES), None)
    preview = None
    for p in unique:
        low = p.name.lower()
        if p.suffix.lower() in IMAGE_SUFFIXES and "preview" in low:
            preview = p
            break

    if media_type == "video":
        return {
            "path": str(video) if video else None,
            "preview": str(preview or image) if (preview or image) else None,
            "kind": "video" if video else ("image" if image else None),
        }
    return {
        "path": str(image) if image else None,
        "preview": None,
        "kind": "image" if image else None,
    }


def rel_if_possible(path: str | None) -> str | None:
    if not path:
        return None
    p = Path(path)
    try:
        return str(p.resolve().relative_to(ROOT))
    except ValueError:
        return str(p)


def group_key(item: dict) -> str:
    return item.get("grouping_key") or f"{item.get('character') or 'uncertain'} || {item.get('prompt') or item.get('uuid')}"


def card_title(display: str, still_count: int, video_only: bool, promptless: bool, group_index: int | None = None) -> str:
    if promptless:
        return f"{display} · 无提示词组图"
    if video_only:
        return f"{display} · 视频"
    if still_count >= 2:
        return f"{display} · 同一提示词 · {still_count} 张"
    return display


def build_payload(items: list[dict], downloads: Path, write_display: bool) -> tuple[dict, dict, dict]:
    enriched = []
    for it in items:
        uuid = str(it.get("uuid") or "")
        resolved = resolve_character(it.get("character"), it.get("character_confidence"), uuid)
        found = find_download(uuid, it.get("type") or "still", downloads)
        enriched.append({**it, "_resolved": resolved, "_download": found})

    groups: dict[str, list[dict]] = OrderedDict()
    for it in sorted(enriched, key=lambda x: (x.get("type") != "still", str(x.get("uuid") or ""))):
        groups.setdefault(group_key(it), []).append(it)

    # Count raw imagine items per display folder (for subnav / drawers).
    folder_item_counts: dict[str, int] = defaultdict(int)
    for it in enriched:
        folder_item_counts[it["_resolved"]["displayName"]] += 1

    cards: list[dict] = []
    album_items: list[dict] = []
    by_collection: dict[str, list[dict]] = defaultdict(list)

    for gkey, members in groups.items():
        resolved = members[0]["_resolved"]
        display = resolved["displayName"]
        stills = [m for m in members if m.get("type") != "video"]
        videos = [m for m in members if m.get("type") == "video"]
        prompt = next((m.get("prompt") for m in members if m.get("prompt")), None)
        promptless = all(not m.get("prompt") for m in members)
        gid = short_hash(gkey)

        def tags_for(medium: str) -> list[str]:
            tags = [ADULT_CATEGORY, display, medium, "去衣"]
            if resolved.get("franchise"):
                tags.append(resolved["franchise"])
            # unique, stable order
            out, seen = [], set()
            for t in tags:
                if t and t not in seen:
                    seen.add(t)
                    out.append(t)
            return out

        def source_body(prompt_text: str | None, member: dict, extra: str = "") -> str:
            lines = [
                "> 来源：Grok Imagine · 去衣标签",
                f"> 角色文件夹：{display}",
            ]
            if resolved.get("franchise"):
                lines.append(f"> 作品：{resolved['franchise']}")
            if resolved.get("sourceName") and resolved["sourceName"] != display:
                lines.append(f"> 清单名：{resolved['sourceName']}")
            if extra:
                lines.append(extra)
            lines.append("")
            if prompt_text:
                lines.append(prompt_text)
            elif promptless:
                lines.append("（Imagine 详情页未提供提示词，仅有图层编辑界面。）")
            return "\n".join(lines) + "\n"

        def maybe_covers(card_id: str, media_members: list[dict], use_preview_for_video: bool = False) -> tuple[str | None, list[str] | None]:
            """Return (cover, covers) using already-written display JPEGs, or nulls.

            Never invent images. --write-display-covers copies/reencodes from downloads
            into public/covers/entries only (not originals/).
            """
            rels: list[str] = []
            for i, member in enumerate(media_members, start=1):
                uuid = member.get("uuid") or ""
                suffix = "" if len(media_members) == 1 else f"-{i:02d}"
                dest_jpg = ENTRIES / f"{card_id}{suffix}.jpg"
                dest_rel = f"covers/entries/{dest_jpg.name}"
                src = None
                dl = member.get("_download") or {}
                if use_preview_for_video:
                    src = dl.get("preview") or dl.get("path")
                else:
                    src = dl.get("path") or dl.get("preview")
                # write_display_jpeg can extract a JPEG poster from an mp4.
                if write_display and src:
                    written = write_display_jpeg(Path(src), dest_jpg)
                    if written:
                        rels.append(dest_rel)
                        continue
                # If a previous ingest already wrote a display file, keep it.
                if dest_jpg.exists():
                    rels.append(dest_rel)
            if not rels:
                return None, None
            return rels[0], rels

        # Homepage: stills in a group become one swipe card (covers[]).
        still_card_id = None
        if stills:
            still_card_id = f"quyi-{gid}"
            cover, covers = maybe_covers(still_card_id, stills)
            title = card_title(display, len(stills), False, promptless)
            card = {
                "id": still_card_id,
                "category": ADULT_CATEGORY,
                "categorySlug": ADULT_SLUG,
                "title": title,
                "usage": " · ".join(
                    p for p in [
                        ADULT_CATEGORY,
                        "去衣",
                        resolved.get("franchise"),
                        f"{len(stills)} 张同一提示词" if len(stills) >= 2 else None,
                    ] if p
                ),
                "body": source_body(prompt, stills[0]),
                "source": "Grok Imagine · 去衣",
                "cover": cover,
                "covers": covers,
                "parentId": resolved["collectionId"],
                "collection": display,
                "collectionIndex": None,  # filled later
                "collectionTotal": None,
                "tags": tags_for("图像"),
                "medium": "图像",
                "aspect": None,
                "promptText": prompt or "",
                "grokPrompt": prompt or None,
                "duplicateNote": None,
                "duplicateOf": None,
            }
            if not card["grokPrompt"]:
                card.pop("grokPrompt", None)
            if not card["covers"]:
                card.pop("covers", None)
            cards.append(card)
            by_collection[display].append(card)

        # Videos: if this group has no stills, merge same-prompt videos into one card
        # (preview frames can fill covers[] later). If there is already a still card,
        # keep each video as a sibling — CoverGallery is for stills.
        if videos and not stills:
            vid_id = f"quyi-{gid}"
            cover, covers = maybe_covers(vid_id, videos, use_preview_for_video=True)
            n = len(videos)
            title = f"{display} · 视频" if n == 1 else f"{display} · 同一提示词 · {n} 段视频"
            durations = "、".join(v.get("duration") for v in videos if v.get("duration"))
            usage_bits = [ADULT_CATEGORY, "去衣", resolved.get("franchise"), "视频"]
            if durations:
                usage_bits.append(durations)
            vcard = {
                "id": vid_id,
                "category": ADULT_CATEGORY,
                "categorySlug": ADULT_SLUG,
                "title": title,
                "usage": " · ".join(p for p in usage_bits if p),
                "body": source_body(prompt or videos[0].get("prompt"), videos[0], extra="> 媒介：视频（首页卡片使用预览帧；原片在云端相册导入后阅览。）"),
                "source": "Grok Imagine · 去衣",
                "cover": cover,
                "covers": covers,
                "parentId": resolved["collectionId"],
                "collection": display,
                "collectionIndex": None,
                "collectionTotal": None,
                "tags": tags_for("视频"),
                "medium": "视频",
                "aspect": None,
                "promptText": (prompt or videos[0].get("prompt") or ""),
                "grokPrompt": (prompt or videos[0].get("prompt") or None),
                "duplicateNote": None,
                "duplicateOf": None,
            }
            if not vcard["grokPrompt"]:
                vcard.pop("grokPrompt", None)
            if not vcard["covers"]:
                vcard.pop("covers", None)
            cards.append(vcard)
            by_collection[display].append(vcard)
        else:
            for vid in videos:
                vid_id = f"quyi-v-{str(vid.get('uuid') or gid)[:12]}"
                cover, covers = maybe_covers(vid_id, [vid], use_preview_for_video=True)
                title = card_title(display, 0, True, False)
                duration = vid.get("duration")
                usage_bits = [ADULT_CATEGORY, "去衣", resolved.get("franchise"), "视频"]
                if duration:
                    usage_bits.append(duration)
                vcard = {
                    "id": vid_id,
                    "category": ADULT_CATEGORY,
                    "categorySlug": ADULT_SLUG,
                    "title": title,
                    "usage": " · ".join(p for p in usage_bits if p),
                    "body": source_body(prompt or vid.get("prompt"), vid, extra="> 媒介：视频（首页卡片使用预览帧；原片在云端相册导入后阅览。）"),
                    "source": "Grok Imagine · 去衣",
                    "cover": cover,
                    "covers": covers,
                    "parentId": resolved["collectionId"],
                    "collection": display,
                    "collectionIndex": None,
                    "collectionTotal": None,
                    "tags": tags_for("视频"),
                    "medium": "视频",
                    "aspect": None,
                    "promptText": (prompt or vid.get("prompt") or ""),
                    "grokPrompt": (prompt or vid.get("prompt") or None),
                    "duplicateNote": None,
                    "duplicateOf": None,
                }
                if still_card_id:
                    vcard["duplicateNote"] = f"与 {still_card_id} 同一提示词的视频"
                if not vcard["grokPrompt"]:
                    vcard.pop("grokPrompt", None)
                if not vcard["covers"]:
                    vcard.pop("covers", None)
                cards.append(vcard)
                by_collection[display].append(vcard)

        # Album metadata: one row per Imagine item (folder holds every still/video).
        homepage_prompt_id = still_card_id or (f"quyi-v-{str(videos[0].get('uuid'))[:12]}" if videos else None)
        for member in members:
            dl = member.get("_download") or {}
            is_video = member.get("type") == "video"
            # Existing album_items.mime_type check only allows jpeg/png/webp/gif.
            # Never upload the mp4; extract a poster JPEG into the gitignored downloads tree.
            poster_rel = None
            if is_video and dl.get("path") and Path(dl["path"]).suffix.lower() in VIDEO_SUFFIXES:
                poster = Path(dl["path"]).resolve().parent.parent / "posters" / f"{member.get('uuid')}.jpg"
                if (poster.exists() and poster.stat().st_size > 0) or extract_video_poster(Path(dl["path"]), poster):
                    poster_rel = rel_if_possible(str(poster))
            image_src = dl.get("preview") if is_video else dl.get("path")
            source = poster_rel or rel_if_possible(image_src)
            album_items.append({
                "uuid": member.get("uuid"),
                "type": member.get("type"),
                "title": f"{display} · {(member.get('uuid') or '')[:8]}",
                "displayCharacter": display,
                "sourceName": resolved.get("sourceName"),
                "franchise": resolved.get("franchise"),
                "confidence": resolved.get("confidence"),
                "autoCategories": [ADULT_CATEGORY],
                "customCategories": [display],
                "sourcePath": source,
                "originalPath": rel_if_possible(dl.get("path")) if is_video else None,
                "previewPath": poster_rel or rel_if_possible(dl.get("preview")),
                "downloadFound": bool(source or dl.get("path") or dl.get("preview")),
                "promptId": homepage_prompt_id,
                "groupingKey": gkey,
                "pending": resolved["pending"],
                "uploadKind": "preview-image" if is_video else "image",
                "blockedReason": (
                    "album_items currently accepts only jpeg/png/webp/gif; the mp4 is kept out of the album row and a poster frame is used instead."
                    if is_video else None
                ),
            })

    # Fill collection index / total in display-name order of cards, then preferred folder order.
    ordered_folders = sort_display_names(list(by_collection.keys()), folder_item_counts)
    collections = []
    for display in ordered_folders:
        col_cards = by_collection[display]
        total = len(col_cards)
        cid = col_cards[0]["parentId"]
        for i, card in enumerate(col_cards, start=1):
            card["collectionIndex"] = i
            card["collectionTotal"] = total
        collections.append({
            "id": cid,
            "name": display,
            "category": ADULT_CATEGORY,
            "count": total,
            "pending": display == PENDING_NAME,
            "franchise": next((c.get("tags") for c in col_cards), None) and next(
                (
                    t for t in col_cards[0]["tags"]
                    if t not in {ADULT_CATEGORY, display, "图像", "视频", "去衣"}
                ),
                None,
            ),
            "imagineItemCount": folder_item_counts.get(display, 0),
        })

    characters = []
    for c in collections:
        characters.append({
            "displayName": c["name"],
            "franchise": c.get("franchise"),
            "slug": c["id"].split("-", 1)[-1],
            "collectionId": c["id"],
            "cardCount": c["count"],
            "imagineItemCount": c.get("imagineItemCount", 0),
            "pending": bool(c.get("pending")),
        })

    downloaded = sum(1 for a in album_items if a["downloadFound"])
    swipe_cards = sum(1 for c in cards if c.get("covers") and len(c["covers"]) >= 2)
    # Planned still swipe groups even without files. Multi-item keys also include
    # mixed (1 still + videos) and video-only groups, which are not still swipe cards.
    planned_swipe = 0
    multi_item_groups = 0
    mixed_groups = 0
    video_only_groups = 0
    for _gkey, members in groups.items():
        if len(members) >= 2:
            multi_item_groups += 1
        stills = [m for m in members if m.get("type") != "video"]
        videos = [m for m in members if m.get("type") == "video"]
        if len(stills) >= 2:
            planned_swipe += 1
        elif stills and videos:
            mixed_groups += 1
        elif len(videos) >= 2:
            video_only_groups += 1

    cards_payload = {
        "generatedFrom": "Grok Imagine 去衣 inventory (imagine-manifest.json)",
        "note": "18+ extras for the homepage. Display JPEGs and video posters live under covers/entries; official downloads stay out of the git tree.",
        "count": len(cards),
        "collections": [{"id": c["id"], "name": c["name"], "category": c["category"], "count": c["count"]} for c in collections],
        "items": cards,
    }
    meta_payload = {
        "generatedFrom": "Grok Imagine 去衣 inventory (imagine-manifest.json)",
        "pendingName": PENDING_NAME,
        "priorityDisplay": list(PRIORITY_DISPLAY),
        "characters": characters,
        "stats": {
            "manifestItems": len(items),
            "homepageCards": len(cards),
            "plannedSwipeGroups": planned_swipe,
            "multiItemGroups": multi_item_groups,
            "mixedStillVideoGroups": mixed_groups,
            "videoOnlyGroups": video_only_groups,
            "swipeCardsWithCovers": swipe_cards,
            "albumRows": len(album_items),
            "downloadsFound": downloaded,
        },
    }
    album_payload = {
        "generatedFrom": "Grok Imagine 去衣 inventory (imagine-manifest.json)",
        "note": "Admin-only album import plan. Upload from sourcePath when present; do not copy these files into public/covers/originals or the git repo. Visibility stays admin-only.",
        "categoriesToEnsure": ordered_folders,
        "autoCategory": ADULT_CATEGORY,
        "rootFolderName": "风格 Prompt 图鉴·云端相册",
        "stats": {
            "rows": len(album_items),
            "downloadsFound": downloaded,
            "downloadsMissing": len(album_items) - downloaded,
        },
        "items": album_items,
    }
    return cards_payload, meta_payload, album_payload


def extract_video_poster(src: Path, dest: Path) -> bool:
    """Write one JPEG frame from a video. Poster only — the mp4 is never copied into public/."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.jpg")
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                "0.3",
                "-i",
                str(src),
                "-frames:v",
                "1",
                "-q:v",
                "3",
                str(tmp),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
            print(f"warn: ffmpeg poster failed for {src.name}: {result.stderr[-400:]}", file=sys.stderr)
            if tmp.exists():
                tmp.unlink()
            return False
        tmp.replace(dest)
        return True
    except FileNotFoundError:
        print("warn: ffmpeg not found; cannot make video posters", file=sys.stderr)
        return False
    except Exception as exc:
        print(f"warn: could not extract poster from {src}: {exc}", file=sys.stderr)
        if tmp.exists():
            tmp.unlink()
        return False


def write_display_jpeg(src: Path, dest: Path) -> bool:
    if not src.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    suffix = src.suffix.lower()
    try:
        if suffix in VIDEO_SUFFIXES:
            return extract_video_poster(src, dest)
        if suffix in {".jpg", ".jpeg"}:
            # Official stills are already display JPEGs. Copy as-is; do not also
            # write a second originals tree or the video files into git.
            dest.write_bytes(src.read_bytes())
            return True
        if suffix in IMAGE_SUFFIXES:
            from PIL import Image

            im = Image.open(src)
            if im.mode in ("RGBA", "P"):
                im = im.convert("RGB")
            else:
                im = im.convert("RGB")
            im.save(dest, "JPEG", quality=92, optimize=True)
            return True
    except Exception as exc:
        print(f"warn: could not write display jpeg {dest.name} from {src}: {exc}", file=sys.stderr)
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build 18+ quyi extras from the Imagine manifest.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--downloads", type=Path, default=DEFAULT_DOWNLOADS)
    parser.add_argument("--write-display-covers", action="store_true", help="Write optimized JPEGs to public/covers/entries (not originals).")
    parser.add_argument("--cards-out", type=Path, default=CARDS_OUT)
    parser.add_argument("--meta-out", type=Path, default=META_OUT)
    parser.add_argument("--album-out", type=Path, default=ALBUM_OUT)
    args = parser.parse_args(argv)

    if not args.manifest.is_file():
        print(f"manifest not found: {args.manifest}", file=sys.stderr)
        return 1

    items = load_manifest(args.manifest)
    cards, meta, album = build_payload(items, args.downloads, args.write_display_covers)
    args.cards_out.parent.mkdir(parents=True, exist_ok=True)
    args.meta_out.parent.mkdir(parents=True, exist_ok=True)
    args.album_out.parent.mkdir(parents=True, exist_ok=True)
    args.cards_out.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.meta_out.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.album_out.write_text(json.dumps(album, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    stats = meta["stats"]
    print(
        f"wrote {args.cards_out.relative_to(ROOT)} ({stats['homepageCards']} cards, "
        f"{stats['plannedSwipeGroups']} planned swipe groups)"
    )
    print(f"wrote {args.meta_out.relative_to(ROOT)} ({len(meta['characters'])} character folders)")
    try:
        album_rel = args.album_out.relative_to(ROOT)
    except ValueError:
        album_rel = args.album_out
    print(
        f"wrote {album_rel} ({stats['albumRows']} album rows, "
        f"{stats['downloadsFound']} downloads found, {stats['albumRows'] - stats['downloadsFound']} waiting)"
    )
    if args.write_display_covers:
        with_cover = sum(1 for it in cards["items"] if it.get("cover"))
        print(f"display covers present on {with_cover}/{len(cards['items'])} cards")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
