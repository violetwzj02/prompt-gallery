#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Resolve collection assets into their conversation, then pull every sibling image.

/rest/assets/{id} gives sourceConversationId + mediaGenInput.prompt.
/rest/app-chat/conversations/{cid}/responses gives every generated file of that
conversation (fileAttachmentsMetadata[].fileUri), which is the "4+ images per
card" rail in the viewer.

  python3 scripts/grok_asset_graph.py --assets <collection-assets.json> --out <graph.json>
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


def get_json(path: str, ck: str, timeout: int = 45):
    req = request.Request(BASE + path)
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", ck)
    req.add_header("Referer", "https://grok.com/imagine")
    with request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def prompt_of(asset: dict) -> str | None:
    gen = asset.get("mediaGenInput") or {}
    for kind in ("imageToImage", "textToImage", "videoToImage", "imageToVideo"):
        node = gen.get(kind)
        if isinstance(node, dict) and node.get("prompt"):
            return str(node["prompt"])
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", default=r"I:\wangzhanbending\quyi-survey\collection-assets.json")
    ap.add_argument("--out", default=r"I:\wangzhanbending\quyi-survey\asset-graph.json")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    ck = cookie()
    raw = json.loads(Path(args.assets).read_text(encoding="utf-8"))
    assets = raw.get("assets") if isinstance(raw, dict) else raw
    if args.limit:
        assets = assets[: args.limit]

    out = Path(args.out)
    state = {"assets": {}, "conversations": {}, "files": {}}
    if out.is_file():
        state = json.loads(out.read_text(encoding="utf-8"))

    # 1) asset -> conversation + prompt
    for index, asset in enumerate(assets, 1):
        aid = asset.get("assetId")
        if not aid or aid in state["assets"]:
            continue
        try:
            detail = get_json(f"/rest/assets/{aid}", ck)
            state["assets"][aid] = {
                "conversationId": detail.get("sourceConversationId"),
                "rootConversationId": detail.get("rootAssetSourceConversationId"),
                "prompt": prompt_of(detail),
                "rRated": detail.get("rRated"),
                "mimeType": detail.get("mimeType"),
                "key": detail.get("key"),
                "createTime": detail.get("createTime"),
                "responseId": detail.get("responseId"),
            }
        except (error.URLError, error.HTTPError, ValueError) as exc:
            print(f"  ! asset {aid} {exc}", file=sys.stderr)
        if index % 20 == 0:
            out.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding="utf-8")
            print(f"  资产 {index}/{len(assets)}", file=sys.stderr)
        time.sleep(0.1)

    # 2) conversation -> every generated file
    cids = sorted({v.get("conversationId") for v in state["assets"].values() if v.get("conversationId")})
    print(f"会话 {len(cids)} 个", file=sys.stderr)
    for index, cid in enumerate(cids, 1):
        if cid in state["conversations"]:
            continue
        files: dict[str, dict] = {}
        for page in range(20):
            path = f"/rest/app-chat/conversations/{cid}/responses?pageSize=100"
            if page:
                path += f"&pageToken={page}"
            try:
                data = get_json(path, ck)
            except (error.URLError, error.HTTPError, ValueError) as exc:
                print(f"  ! conv {cid} {exc}", file=sys.stderr)
                break
            chunk = data.get("responses") or []
            if not chunk:
                break
            for response in chunk:
                for meta in response.get("fileAttachmentsMetadata") or []:
                    uri = str(meta.get("fileUri") or "")
                    if "/generated/" not in uri:
                        continue
                    fid = str(meta.get("fileMetadataId") or "")
                    files[fid] = {
                        "assetId": fid,
                        "fileUri": uri,
                        "mime": meta.get("fileMimeType"),
                        "responseId": response.get("responseId"),
                        "createTime": response.get("createTime"),
                    }
            time.sleep(0.1)
        state["conversations"][cid] = sorted(files.values(), key=lambda x: x.get("createTime") or "")
        print(f"  会话 {index}/{len(cids)}: {len(files)} 个文件", file=sys.stderr)
        out.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding="utf-8")

    out.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding="utf-8")
    in_album = {a.get("assetId") for a in assets}
    all_files = {f["assetId"] for files in state["conversations"].values() for f in files}
    print(
        f"完成：会话 {len(state['conversations'])}，会话内文件 {len(all_files)}，"
        f"其中已在集合/相册 {len(all_files & in_album)}，未入库 {len(all_files - in_album)}"
    )


if __name__ == "__main__":
    main()
