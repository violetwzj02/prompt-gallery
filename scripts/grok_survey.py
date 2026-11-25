#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Survey Grok Imagine media into the manifest that ingest_quyi.py already reads.

Two stages, each usable on its own:

  python3 scripts/grok_survey.py list      --out covers-inbox/quyi-survey/raw-posts.json
  python3 scripts/grok_survey.py manifest  --out covers-inbox/quyi-survey/imagine-manifest.json
  python3 scripts/grok_survey.py download  --manifest covers-inbox/quyi-survey/imagine-manifest.json

`list` needs a logged-in cookie (sso / sso-rw). `manifest` and `download` work
offline from the saved listing, so a survey can be re-derived without re-hitting
the API. Nothing here writes into the git tree: covers-inbox/ is ignored.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
SURVEY_DIR = ROOT / "covers-inbox" / "quyi-survey"
DOWNLOADS = ROOT / "covers-inbox" / "quyi-downloads"

LIST_URL = "https://grok.com/rest/media/post/list"
COLLECTION_URL = "https://grok.com/rest/media/collection/assets/list"
POST_GET_URL = "https://grok.com/rest/media/post/get"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Character names the project already ships folders for. Longest first so that
# 「甘露寺蜜璃」 wins over 「蜜璃」 and 「Dragon Girl」 over 「龙」.
CHARACTER_ALIASES: dict[str, tuple[str, str | None]] = {
    "甘雨": ("甘雨", "原神"),
    "申鹤": ("申鹤", "原神"),
    "蒂法": ("蒂法", "最终幻想7"),
    "Tifa": ("蒂法", "最终幻想7"),
    "雷神": ("雷神", "原神"),
    "雷电将军": ("雷神", "原神"),
    "Raiden": ("雷神", "原神"),
    "Saber": ("Saber", "Fate"),
    "阿尔托莉雅": ("Saber", "Fate"),
    "小舞": ("小舞", "斗罗大陆"),
    "小医仙": ("小医仙", "斗破苍穹"),
    "陆雪琪": ("陆雪琪", "诛仙"),
    "萧薰儿": ("萧薰儿", "斗破苍穹"),
    "千仞雪": ("千仞雪", "斗罗大陆"),
    "盛彩儿": ("盛彩儿", "神印王座"),
    "韩雅": ("韩雅", None),
    "宁荣荣": ("宁荣荣", "斗罗大陆"),
    "真希波": ("真希波", "新世纪福音战士"),
    "不知火舞": ("不知火舞", "拳皇"),
    "Mai Shiranui": ("不知火舞", "拳皇"),
    "伊芙": ("伊芙", "剑灵"),
    "洛琪": ("洛琪", None),
    "爱丽丝": ("爱丽丝", "最终幻想7"),
    "Aerith": ("爱丽丝", "最终幻想7"),
    "甘露寺蜜璃": ("甘露寺蜜璃", "鬼灭之刃"),
    "绘梨衣": ("绘梨衣", "龙族"),
    "Caster": ("Caster", "Fate"),
    "Dragon Girl": ("Dragon Girl", "百炼成神"),
    "凤年芸": ("凤年芸", "百炼成神"),
    "唐舞桐": ("唐舞桐", "斗罗大陆"),
    "明日香": ("明日香", "新世纪福音战士"),
    "Asuka": ("明日香", "新世纪福音战士"),
    "清霄": ("清霄", None),
    "玛丽·萝丝": ("玛丽·萝丝", "死或生"),
    "Marie Rose": ("玛丽·萝丝", "死或生"),
    "米拉珍": ("米拉珍", "妖精的尾巴"),
    "胡蝶忍": ("胡蝶忍", "鬼灭之刃"),
    "艾达王": ("艾达王", "生化危机"),
    "Ada Wong": ("艾达王", "生化危机"),
    "葛城美里": ("葛城美里", "新世纪福音战士"),
    "远坂凛": ("远坂凛", "Fate"),
    "金克丝": ("金克丝", "英雄联盟"),
    "Jinx": ("金克丝", "英雄联盟"),
    "霞": ("霞", "死或生"),
    "Kasumi": ("霞", "死或生"),
    "露西": ("露西", None),
    "Lucy": ("露西", None),
    "D.Va": ("D.Va", "守望先锋"),
    "Dva": ("D.Va", "守望先锋"),
    "2B": ("2B", "尼尔：机械纪元"),
}

CHARACTER_ALIASES_SORTED = sorted(CHARACTER_ALIASES, key=len, reverse=True)

IMAGE_SUFFIX = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_SUFFIX = {".mp4", ".webm", ".mov"}


def sha1_short(text: str, n: int = 12) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:n]


def cookie_header(raw: str | None) -> str:
    raw = (raw or os.environ.get("GROK_COOKIE") or "").strip()
    if not raw:
        raise SystemExit(
            "缺少 Grok 登录态。用 --cookie 'sso=...; sso-rw=...' 或设置环境变量 GROK_COOKIE。"
        )
    return raw


def post_json(url: str, payload: dict, cookie: str, timeout: int = 40) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "*/*")
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", cookie)
    req.add_header("Origin", "https://grok.com")
    req.add_header("Referer", "https://grok.com/imagine")
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise SystemExit(f"Grok 接口返回 {exc.code}：{detail}") from exc
    except error.URLError as exc:
        raise SystemExit(f"Grok 网络错误：{exc.reason}") from exc


def fetch_collection(cookie: str, collection_id: str, page_size: int, max_pages: int) -> dict:
    """Every asset in one Imagine collection (the「去衣」tag is a collection)."""
    assets: list[dict] = []
    cursor: str | None = None
    seen: set[str] = set()
    for page in range(max_pages):
        payload: dict = {"collectionId": collection_id, "limit": page_size}
        if cursor:
            payload["cursor"] = cursor
        data = post_json(COLLECTION_URL, payload, cookie)
        chunk = data.get("items") or []
        for asset in chunk:
            aid = str(asset.get("assetId") or "")
            if aid and aid not in seen:
                seen.add(aid)
                assets.append(asset)
        cursor = data.get("nextCursor") or None
        print(f"  第 {page + 1} 页：+{len(chunk)}，累计 {len(assets)}", file=sys.stderr)
        if not cursor or not chunk:
            break
        time.sleep(0.3)
    return {"collectionId": collection_id, "count": len(assets), "assets": assets}


def fetch_details(cookie: str, assets: list[dict], out: Path) -> list[dict]:
    """Expand each collection asset into its full post (children included)."""
    posts: list[dict] = []
    if out.is_file():
        previous = json.loads(out.read_text(encoding="utf-8"))
        posts = previous.get("posts") or []
    have = {str(p.get("id")) for p in posts}
    for index, asset in enumerate(assets, 1):
        aid = str(asset.get("assetId") or "")
        if not aid or aid in have:
            continue
        for attempt in range(3):
            try:
                data = post_json(POST_GET_URL, {"id": aid, "isNsfwEnabled": True}, cookie)
                post = data.get("post")
                if isinstance(post, dict):
                    posts.append(post)
                    have.add(aid)
                break
            except (SystemExit, Exception) as exc:  # noqa: BLE001 - retry transient failures
                if attempt == 2:
                    print(f"  ! {aid} {exc}", file=sys.stderr)
                else:
                    time.sleep(2 + attempt * 2)
        if index % 20 == 0:
            out.write_text(json.dumps({"posts": posts}, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"  详情 {index}/{len(assets)}（已存 {len(posts)}）", file=sys.stderr)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"posts": posts}, indent=2, ensure_ascii=False), encoding="utf-8")
    return posts


def fetch_listing(cookie: str, page_size: int, max_pages: int, extra: dict | None = None) -> dict:
    posts: list[dict] = []
    cursor: str | None = None
    seen: set[str] = set()
    for page in range(max_pages):
        payload: dict = {"limit": page_size}
        if cursor:
            payload["cursor"] = cursor
        if extra:
            payload.update(extra)
        data = post_json(LIST_URL, payload, cookie)
        chunk = data.get("posts") or []
        for post in chunk:
            pid = str(post.get("id") or "")
            if pid and pid in seen:
                continue
            if pid:
                seen.add(pid)
            posts.append(post)
        cursor = data.get("nextCursor") or None
        print(f"  第 {page + 1} 页：+{len(chunk)} 条，累计 {len(posts)}", file=sys.stderr)
        if not cursor or not chunk:
            break
        time.sleep(0.4)
    return {"posts": posts, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}


def media_kind(media: dict) -> str:
    raw = str(media.get("mediaType") or "").upper()
    if "VIDEO" in raw:
        return "video"
    if "IMAGE" in raw:
        return "still"
    url = str(media.get("mediaUrl") or "")
    suffix = Path(url.split("?")[0]).suffix.lower()
    if suffix in VIDEO_SUFFIX:
        return "video"
    return "still"


def best_image_url(media: dict) -> str | None:
    return media.get("mediaUrl") or media.get("hdMediaUrl")


def best_video_url(media: dict) -> str | None:
    for key in ("hd1080MediaUrl", "hdMediaUrl", "mediaUrl"):
        url = media.get(key)
        if isinstance(url, str) and url:
            return url
    return None


def flatten_post(post: dict, parent_id: str | None = None) -> list[dict]:
    """One api post -> every media item it contains, children first-class."""
    out: list[dict] = []
    seen: set[str] = set()

    def walk(node: dict, parent: str | None) -> None:
        uid = str(node.get("id") or "")
        if not uid or uid in seen:
            return
        seen.add(uid)
        kind = media_kind(node)
        prompt = str(node.get("originalPrompt") or node.get("prompt") or "").strip()
        url = best_image_url(node) if kind == "still" else best_video_url(node)
        poster = node.get("thumbnailImageUrl") if kind == "video" else None
        out.append(
            {
                "uuid": uid,
                "postId": uid,
                "rootPostId": parent_id or uid,
                "type": kind,
                "prompt": prompt or None,
                "url": url,
                "posterUrl": poster,
                "duration": node.get("videoDuration"),
                "resolution": node.get("resolution"),
                "model": node.get("modelName"),
                "rRated": bool(node.get("rRated")),
                "moderated": bool(node.get("moderated")),
            }
        )
        for child in node.get("childPosts") or []:
            if isinstance(child, dict):
                walk(child, parent_id or uid)
        for group in ("images", "videos"):
            for child in node.get(group) or []:
                if isinstance(child, dict):
                    walk(child, parent_id or uid)

    walk(post, parent_id)
    return out


def detect_character(media: dict, folder: str | None) -> tuple[str | None, str | None]:
    """Folder name wins when the library groups by character; otherwise read the prompt."""
    if folder:
        for alias in CHARACTER_ALIASES_SORTED:
            if alias in folder:
                return CHARACTER_ALIASES[alias][0], "high"
        if folder.strip():
            return folder.strip(), "medium"
    prompt = str(media.get("prompt") or "")
    for alias in CHARACTER_ALIASES_SORTED:
        if alias in prompt:
            return CHARACTER_ALIASES[alias][0], "high"
    return None, None


def build_manifest(posts: list[dict], folder_of=sys.maxsize) -> dict:
    items: list[dict] = []
    seen_uuid: set[str] = set()
    for post in posts:
        folder = post.get("collectionName") or post.get("folderName") or post.get("projectName")
        for media in flatten_post(post):
            if media["uuid"] in seen_uuid:
                continue
            seen_uuid.add(media["uuid"])
            character, confidence = detect_character(media, folder)
            grouping_key = f"{character or 'uncertain'} || {media.get('prompt') or media['uuid']}"
            items.append(
                {
                    **media,
                    "character": character,
                    "character_confidence": confidence,
                    "folder": folder,
                    "grouping_key": grouping_key,
                    "groupingId": sha1_short(grouping_key),
                }
            )
    return {
        "generatedFrom": "Grok Imagine media library survey",
        "count": len(items),
        "items": items,
    }


def safe_name(text: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', "_", text).strip()[:120]


def download_manifest(manifest_path: Path, outdir: Path, limit: int | None) -> None:
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = data.get("items") or []
    stills = outdir / "stills"
    videos = outdir / "videos"
    posters = outdir / "posters"
    for folder in (stills, videos, posters):
        folder.mkdir(parents=True, exist_ok=True)
    ledger_path = outdir / "ledger.json"
    ledger: dict[str, str] = {}
    if ledger_path.is_file():
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))

    done = 0
    for item in items:
        if limit is not None and done >= limit:
            break
        uuid = item["uuid"]
        if uuid in ledger:
            continue
        if item["type"] == "video":
            url, target = item.get("url"), videos / f"{uuid}.mp4"
        else:
            url, target = item.get("url"), stills / f"{uuid}.jpg"
        if not url:
            continue
        try:
            req = request.Request(url)
            req.add_header("User-Agent", UA)
            with request.urlopen(req, timeout=90) as resp:
                target.write_bytes(resp.read())
            digest = hashlib.md5(target.read_bytes()).hexdigest()
            ledger[uuid] = digest
            done += 1
            print(f"  {uuid} -> {target.name} ({digest[:8]})", file=sys.stderr)
            if item["type"] == "video" and item.get("posterUrl"):
                poster = posters / f"{uuid}.jpg"
                preq = request.Request(item["posterUrl"])
                preq.add_header("User-Agent", UA)
                with request.urlopen(preq, timeout=60) as resp:
                    poster.write_bytes(resp.read())
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the batch
            print(f"  ! {uuid} {exc}", file=sys.stderr)
        time.sleep(0.15)

    ledger_path.write_text(json.dumps(ledger, indent=2, ensure_ascii=False), encoding="utf-8")
    dupes = len(ledger) - len(set(ledger.values()))
    print(f"下载完成：{len(ledger)} 项，重复内容 {dupes} 组")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="拉取媒体库列表")
    p_list.add_argument("--cookie", default=None)
    p_list.add_argument("--page-size", type=int, default=100)
    p_list.add_argument("--max-pages", type=int, default=200)
    p_list.add_argument("--filter", default=None, help="透传给接口的 filter 字段")
    p_list.add_argument("--out", default=str(SURVEY_DIR / "raw-posts.json"))

    p_col = sub.add_parser("collection", help="枚举某个 collection（标签）里的全部资产")
    p_col.add_argument("--cookie", default=None)
    p_col.add_argument("--collection-id", required=True)
    p_col.add_argument("--page-size", type=int, default=100)
    p_col.add_argument("--max-pages", type=int, default=200)
    p_col.add_argument("--out", default=str(SURVEY_DIR / "collection-assets.json"))

    p_det = sub.add_parser("details", help="逐个拉取资产详情（含嵌套子图）")
    p_det.add_argument("--cookie", default=None)
    p_det.add_argument("--assets", default=str(SURVEY_DIR / "collection-assets.json"))
    p_det.add_argument("--out", default=str(SURVEY_DIR / "raw-posts.json"))

    p_manifest = sub.add_parser("manifest", help="把列表展开成嵌套完整的清单")
    p_manifest.add_argument("--posts", default=str(SURVEY_DIR / "raw-posts.json"))
    p_manifest.add_argument("--out", default=str(SURVEY_DIR / "imagine-manifest.json"))

    p_dl = sub.add_parser("download", help="下载清单里的全部媒体")
    p_dl.add_argument("--manifest", default=str(SURVEY_DIR / "imagine-manifest.json"))
    p_dl.add_argument("--outdir", default=str(DOWNLOADS))
    p_dl.add_argument("--limit", type=int, default=None)

    args = ap.parse_args()

    if args.cmd == "list":
        cookie = cookie_header(args.cookie)
        extra = {"filter": args.filter} if args.filter else None
        data = fetch_listing(cookie, args.page_size, args.max_pages, extra)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"已保存 {len(data['posts'])} 条 post -> {out}")
        return

    if args.cmd == "collection":
        cookie = cookie_header(args.cookie)
        data = fetch_collection(cookie, args.collection_id, args.page_size, args.max_pages)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        kinds: dict[str, int] = {}
        for asset in data["assets"]:
            kinds[asset.get("mimeType") or "?"] = kinds.get(asset.get("mimeType") or "?", 0) + 1
        print(f"collection 共 {data['count']} 个资产 {kinds} -> {out}")
        return

    if args.cmd == "details":
        cookie = cookie_header(args.cookie)
        raw = json.loads(Path(args.assets).read_text(encoding="utf-8"))
        assets = raw.get("assets") if isinstance(raw, dict) else raw
        posts = fetch_details(cookie, assets or [], Path(args.out))
        print(f"已取详情 {len(posts)} 条 -> {args.out}")
        return

    if args.cmd == "manifest":
        raw = json.loads(Path(args.posts).read_text(encoding="utf-8"))
        posts = raw.get("posts") if isinstance(raw, dict) else raw
        manifest = build_manifest(posts or [])
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
        stills = sum(1 for i in manifest["items"] if i["type"] == "still")
        videos = manifest["count"] - stills
        named = sum(1 for i in manifest["items"] if i["character"])
        print(f"清单 {manifest['count']} 项（静图 {stills} / 视频 {videos}，已识别角色 {named}） -> {out}")
        return

    if args.cmd == "download":
        download_manifest(Path(args.manifest), Path(args.outdir), args.limit)


if __name__ == "__main__":
    main()
