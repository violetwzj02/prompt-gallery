#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Collect every generated image the account has, grouped by conversation.

The media-post API only ever returns one image per post (childPosts is always
empty); the 4+ images you see in the viewer rail are the other generations of
the same conversation. They are only reachable through the chat history, where
each response carries `fileAttachmentAssetMetadata[].fileUri`
(users/<uid>/generated/<assetId>/image.jpg).

  python3 scripts/grok_conversation_media.py --out "I:/wangzhanbending/quyi-survey/chat-media.json"
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib import error, request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
BASE = "https://grok.com"


def cookie() -> str:
    raw = (os.environ.get("GROK_COOKIE") or "").strip()
    if not raw:
        raw = Path(r"I:\wangzhanbending\.grok_cookie").read_text(encoding="utf-8").strip()
    return raw


def get_json(path: str, ck: str, timeout: int = 60):
    req = request.Request(BASE + path)
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", ck)
    req.add_header("Accept", "*/*")
    req.add_header("Referer", "https://grok.com/imagine")
    with request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def list_conversations(ck: str) -> list[dict]:
    data = get_json("/rest/app-chat/conversations?pageSize=200", ck)
    return data.get("conversations") or []


def responses_of(ck: str, conversation_id: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for page in range(30):
        path = f"/rest/app-chat/conversations/{conversation_id}/responses?pageSize=100"
        if page:
            path += f"&pageToken={page}"
        data = get_json(path, ck)
        chunk = data.get("responses") or []
        added = 0
        for item in chunk:
            rid = str(item.get("responseId") or "")
            if rid and rid in seen:
                continue
            if rid:
                seen.add(rid)
            out.append(item)
            added += 1
        if not chunk or not added:
            break
        time.sleep(0.1)
    return out


def extract_assets(response: dict, conversation: dict) -> list[dict]:
    """Generated media live in fileAttachmentsMetadata (fileUri), not in the
    asset-metadata array, which only carries ids."""
    found = []
    for meta in response.get("fileAttachmentsMetadata") or []:
        uri = str(meta.get("fileUri") or "")
        mime = str(meta.get("fileMimeType") or "")
        if "/generated/" not in uri or not mime:
            continue
        found.append(
            {
                "assetId": str(meta.get("fileMetadataId") or ""),
                "fileUri": uri,
                "mime": mime,
                "conversationId": conversation.get("conversationId"),
                "conversationTitle": conversation.get("title"),
                "responseId": response.get("responseId"),
                "createTime": response.get("createTime"),
            }
        )
    return found


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=r"I:\wangzhanbending\quyi-survey\chat-media.json")
    args = ap.parse_args()

    ck = cookie()
    convs = list_conversations(ck)
    print(f"会话 {len(convs)} 个", file=sys.stderr)
    media: list[dict] = []
    per_conv: dict[str, int] = {}
    for index, conv in enumerate(convs, 1):
        cid = conv["conversationId"]
        try:
            responses = responses_of(ck, cid)
        except (error.URLError, error.HTTPError, ValueError) as exc:
            print(f"  ! {cid} {exc}", file=sys.stderr)
            continue
        count = 0
        for response in responses:
            for asset in extract_assets(response, conv):
                media.append(asset)
                count += 1
        per_conv[cid] = count
        if index % 10 == 0:
            print(f"  {index}/{len(convs)}（累计 {len(media)} 个资产）", file=sys.stderr)

    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "conversations": len(convs),
        "assets": media,
        "perConversation": per_conv,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    uniq = len({a["assetId"] for a in media if a["assetId"]})
    print(f"完成：{len(media)} 条引用，去重后 {uniq} 个资产 -> {out}")


if __name__ == "__main__":
    main()
