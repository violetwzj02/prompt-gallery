#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Name the cloud album by looking at it: thumbnails -> contact sheets -> titles.

Three offline-ish stages, each re-runnable:

  fetch   items.json + Drive token  ->  <thumbs>/<album_id>.jpg
  sheet   thumbs                    ->  <sheets>/sheet-01.jpg + labels.json (编号 -> album_id)
  apply   names.json {album_id: 标题} ->  PATCH album_items.title

`sheet` and `apply` never touch Drive; only `fetch` needs a Drive token, and only
`apply` needs Supabase. Nothing is uploaded and nothing is renamed until apply.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import album_import as imp  # noqa: E402

DEFAULT_STAGE = Path(os.environ.get("ALBUM_STAGE_DIR", r"I:\wangzhanbending"))
DRIVE_API = os.environ.get("GOOGLE_API_BASE", "https://www.googleapis.com") + "/drive/v3"


def http_bytes(url: str, headers: dict, timeout: int = 90) -> bytes:
    req = request.Request(url)
    for key, value in headers.items():
        req.add_header(key, value)
    with request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def thumbnail_url(token: str, file_id: str, width: int = 1024) -> str | None:
    url = f"{DRIVE_API}/files/{parse.quote(file_id)}?fields=id,thumbnailLink&supportsAllDrives=true"
    status, data = imp.http_json("GET", url, imp.drive_headers(token))
    if status != 200 or not isinstance(data, dict):
        return None
    link = (data.get("thumbnailLink") or "").strip()
    if not link:
        return None
    return link.replace("=s220", f"=w{width}")


def cmd_fetch(args) -> None:
    token = imp.google_token()
    items = json.loads(Path(args.items).read_text(encoding="utf-8"))
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    done = skipped = failed = 0
    for item in items:
        album_id = item.get("id")
        file_id = item.get("drive_file_id")
        if not album_id or not file_id:
            skipped += 1
            continue
        target = outdir / f"{album_id}.jpg"
        if target.is_file() and target.stat().st_size > 0:
            skipped += 1
            continue
        try:
            link = thumbnail_url(token, file_id)
            if not link:
                failed += 1
                print(f"  ! {album_id} 没有缩略图", file=sys.stderr)
                continue
            target.write_bytes(http_bytes(link, {"User-Agent": "prompt-gallery-naming"}))
            done += 1
            if done % 20 == 0:
                print(f"  已取 {done} 张缩略图", file=sys.stderr)
        except (error.URLError, error.HTTPError) as exc:
            failed += 1
            print(f"  ! {album_id} {exc}", file=sys.stderr)
    print(f"缩略图：新增 {done}，跳过 {skipped}，失败 {failed} -> {outdir}")


def cmd_sheet(args) -> None:
    from PIL import Image, ImageDraw

    thumbs = Path(args.thumbs)
    outdir = Path(args.outdir or (thumbs / "sheets"))
    outdir.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in thumbs.glob("*.jpg") if p.is_file())
    if not files:
        raise SystemExit(f"{thumbs} 里没有缩略图，先跑 fetch")

    per_sheet = max(1, args.per_sheet)
    cols = args.cols
    cell_w, cell_h = args.cell_width, args.cell_height
    labels: dict[str, dict[str, str]] = {}
    for page_start in range(0, len(files), per_sheet):
        chunk = files[page_start : page_start + per_sheet]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (247, 247, 248))
        draw = ImageDraw.Draw(sheet)
        pg = page_start // per_sheet + 1
        labels[f"sheet-{pg:02d}"] = {}
        for offset, path in enumerate(chunk):
            number = page_start + offset + 1
            row, col = divmod(offset, cols)
            try:
                image = Image.open(path).convert("RGB")
            except Exception:  # noqa: BLE001 - a broken preview must not kill the sheet
                image = Image.new("RGB", (cell_w, cell_h), (225, 225, 228))
            image.thumbnail((cell_w - 8, cell_h - 28))
            x = col * cell_w + (cell_w - image.width) // 2
            y = row * cell_h + 24 + (cell_h - 28 - image.height) // 2
            sheet.paste(image, (x, y))
            draw.rectangle([col * cell_w, row * cell_h, (col + 1) * cell_w - 1, (row + 1) * cell_h - 1], outline=(208, 208, 214))
            draw.text((col * cell_w + 8, row * cell_h + 6), f"#{number:03d}", fill=(20, 20, 24))
            labels[f"sheet-{pg:02d}"][f"{number:03d}"] = path.stem
        sheet.save(outdir / f"sheet-{pg:02d}.jpg", quality=88)
    (outdir / "labels.json").write_text(json.dumps(labels, indent=2, ensure_ascii=False), encoding="utf-8")
    pages = len(labels)
    print(f"联系表：{pages} 张，覆盖 {len(files)} 个条目 -> {outdir}")


def cmd_apply(args) -> None:
    mapping = json.loads(Path(args.map).read_text(encoding="utf-8"))
    headers = {**imp.supabase_headers(), "Prefer": "return=representation"}
    base = imp.supabase_base()
    updated = failed = 0
    for album_id, title in mapping.items():
        title = str(title or "").strip()
        if not title:
            continue
        status, data = imp.http_json(
            "PATCH",
            f"{base}/rest/v1/album_items?id=eq.{parse.quote(str(album_id))}",
            headers,
            {"title": title},
        )
        if status not in (200, 204):
            failed += 1
            print(f"  ! {album_id}: {status} {data}", file=sys.stderr)
            continue
        updated += 1
        if updated % 20 == 0:
            print(f"  已更新 {updated} 条", file=sys.stderr)
    print(f"标题写入：成功 {updated}，失败 {failed}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("fetch", help="从 Drive 取每个条目的预览图")
    p.add_argument("--items", default=str(ROOT / "covers-inbox/album/items.json"))
    p.add_argument("--outdir", default=str(DEFAULT_STAGE / "album-thumbs"))
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("sheet", help="把预览图拼成带编号的联系表")
    p.add_argument("--thumbs", default=str(DEFAULT_STAGE / "album-thumbs"))
    p.add_argument("--outdir", default=None)
    p.add_argument("--per-sheet", type=int, default=12)
    p.add_argument("--cols", type=int, default=4)
    p.add_argument("--cell-width", type=int, default=360)
    p.add_argument("--cell-height", type=int, default=420)
    p.set_defaults(func=cmd_sheet)

    p = sub.add_parser("apply", help="把命名结果写回 album_items.title")
    p.add_argument("--map", required=True)
    p.set_defaults(func=cmd_apply)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
