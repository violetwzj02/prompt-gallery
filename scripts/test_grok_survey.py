#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Offline checks for scripts/grok_survey.py (no network, no cookies)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import grok_survey  # noqa: E402

results: list[tuple[str, bool, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    results.append((label, ok, detail))
    print(("ok   " if ok else "FAIL ") + label + (f" — {detail}" if detail and not ok else ""))


POST = {
    "id": "root-1",
    "collectionName": "蒂法（最终幻想7）",
    "mediaType": "MEDIA_POST_TYPE_IMAGE",
    "mediaUrl": "https://imagine-public.x.ai/root-1.jpg",
    "originalPrompt": "【角色：蒂法】跪坐在浴缸边，侧身回眸",
    "title": "nested card",
    "childPosts": [
        {
            "id": "child-1",
            "mediaType": "MEDIA_POST_TYPE_IMAGE",
            "mediaUrl": "https://imagine-public.x.ai/child-1.jpg",
            "originalPrompt": "【角色：蒂法】跪坐在浴缸边，侧身回眸",
        },
        {
            "id": "child-2",
            "mediaType": "MEDIA_POST_TYPE_VIDEO",
            "mediaUrl": "https://imagine-public.x.ai/child-2.mp4",
            "hd1080MediaUrl": "https://imagine-public.x.ai/child-2_1080.mp4",
            "thumbnailImageUrl": "https://imagine-public.x.ai/child-2_thumb.jpg",
            "videoDuration": 6,
            "originalPrompt": "【角色：蒂法】缓慢转身",
            "childPosts": [
                {
                    "id": "grandchild-1",
                    "mediaType": "MEDIA_POST_TYPE_IMAGE",
                    "mediaUrl": "https://imagine-public.x.ai/grandchild-1.jpg",
                    "originalPrompt": "【角色：蒂法】缓慢转身 首帧",
                }
            ],
        },
    ],
    # The same media can also be echoed in these arrays; ids must not duplicate.
    "images": [{"id": "root-1", "mediaType": "MEDIA_POST_TYPE_IMAGE", "mediaUrl": "https://imagine-public.x.ai/root-1.jpg"}],
    "videos": [],
}

items = grok_survey.flatten_post(POST)
check("nested children are expanded", len(items) == 4, str([i["uuid"] for i in items]))
check("duplicate ids collapse", len({i["uuid"] for i in items}) == len(items))
check("video keeps 1080 url", any(i["type"] == "video" and i["url"].endswith("_1080.mp4") for i in items))
check("video keeps its poster", any(i["type"] == "video" and i["posterUrl"] for i in items))
check("still urls preserved", sum(1 for i in items if i["type"] == "still") == 3)

manifest = grok_survey.build_manifest([POST])
check("manifest counts every nested item", manifest["count"] == 4)
check(
    "character resolves from the folder name",
    all(i["character"] == "蒂法" for i in manifest["items"]),
    str({i["character"] for i in manifest["items"]}),
)
check("folder name outranks the prompt", manifest["items"][0]["character_confidence"] == "high")
check(
    "same prompt shares a grouping key",
    len({i["grouping_key"] for i in manifest["items"] if i["type"] == "still"}) < 3,
)

no_folder = grok_survey.build_manifest([{**POST, "collectionName": None}])
check(
    "prompt text still finds the character when the folder is missing",
    all(i["character"] == "蒂法" for i in no_folder["items"]),
    str({i["character"] for i in no_folder["items"]}),
)

unknown = grok_survey.build_manifest([{**POST, "collectionName": None, "originalPrompt": "a quiet room", "childPosts": []}])
check("unknown character stays unresolved", unknown["items"][0]["character"] is None)

check("sha1 grouping id is stable", grok_survey.sha1_short("蒂法 || prompt") == grok_survey.sha1_short("蒂法 || prompt"))

failed = [r for r in results if not r[1]]
if failed:
    print(f"\nFAILED {len(failed)}/{len(results)}")
    sys.exit(1)
print(f"\ngrok survey: {len(results)} checks passed")
