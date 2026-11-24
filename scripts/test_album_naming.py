#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mock-Drive/mock-Supabase test for scripts/album_naming.py."""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import parse

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
STATE = {"thumb_requests": 0, "patched": [], "no_thumb": {"file-3"}, "image_paths": []}


def make_jpeg(color) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (240, 320), color).save(buf, format="JPEG")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = parse.urlsplit(self.path)
        if parsed.path.startswith("/img/"):
            STATE["image_paths"].append(parsed.path)
            self._send(200, make_jpeg((120, 160, 200)), "image/jpeg")
            return
        if parsed.path.startswith("/drive/v3/files/"):
            STATE["thumb_requests"] += 1
            file_id = parsed.path.rsplit("/", 1)[-1]
            if file_id in STATE["no_thumb"]:
                self._send(200, json.dumps({"id": file_id}).encode())
                return
            port = self.server.server_address[1]
            link = f"http://127.0.0.1:{port}/img/{file_id}=s220"
            self._send(200, json.dumps({"id": file_id, "thumbnailLink": link}).encode())
            return
        self._send(404, b"{}")

    def do_PATCH(self):
        parsed = parse.urlsplit(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        STATE["patched"].append({"query": parsed.query, "payload": payload})
        self._send(200, json.dumps([payload]).encode())


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    work = Path(tempfile.mkdtemp(prefix="pg-album-naming-"))
    items = [
        {"id": f"album-{n}", "drive_file_id": f"file-{n}", "title": f"7d48331e-368a-409c-901a-6f89fa1cbd{n}"}
        for n in range(1, 6)
    ]
    items_path = work / "items.json"
    items_path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    thumbs = work / "thumbs"
    sheets = work / "sheets"

    env = {
        **os.environ,
        "SUPABASE_URL": base,
        "SUPABASE_SERVICE_KEY": "k",
        "GOOGLE_ACCESS_TOKEN": "tok",
        "GOOGLE_API_BASE": base,
    }

    def run(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "album_naming.py"), *args],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(ROOT),
        )

    results: list[tuple[str, bool, str]] = []

    def check(label: str, ok: bool, detail: str = "") -> None:
        results.append((label, ok, detail))
        print(("ok   " if ok else "FAIL ") + label + (f" — {detail}" if detail and not ok else ""))

    r = run("fetch", "--items", str(items_path), "--outdir", str(thumbs))
    check("fetch exits 0", r.returncode == 0, r.stderr[-400:])
    got = sorted(p.name for p in thumbs.glob("*.jpg"))
    check("4 of 5 previews downloaded (one has no thumbnail)", len(got) == 4, str(got))
    check(
        "preview is requested at the upgraded size",
        any(path.endswith("=w1024") for path in STATE["image_paths"]),
        str(STATE["image_paths"][:3]),
    )
    check("missing preview does not abort the batch", "失败 1" in r.stdout or "失败1" in r.stdout, r.stdout)

    r = run("sheet", "--thumbs", str(thumbs), "--outdir", str(sheets), "--per-sheet", "3", "--cols", "3")
    check("sheet exits 0", r.returncode == 0, r.stderr[-400:])
    pages = sorted(p.name for p in sheets.glob("sheet-*.jpg"))
    check("two contact sheets for four previews", pages == ["sheet-01.jpg", "sheet-02.jpg"], str(pages))
    labels = json.loads((sheets / "labels.json").read_text(encoding="utf-8"))
    flat = [album_id for page in labels.values() for album_id in page.values()]
    check("labels map every numbered cell", len(flat) == 4, str(flat))
    check("labels point at album ids", set(flat) <= {i["id"] for i in items}, str(flat))
    img = Image.open(sheets / "sheet-01.jpg")
    check("sheet image is a real JPEG", img.size[0] > 0 and img.size[1] > 0, str(img.size))

    names_path = work / "names.json"
    names_path.write_text(json.dumps({"album-1": "蒂法·坐地分腿", "album-2": "甘雨·浴缸回眸", "album-9": "不存在"}, ensure_ascii=False), encoding="utf-8")
    r = run("apply", "--map", str(names_path))
    check("apply exits 0", r.returncode == 0, r.stderr[-400:])
    patched_ok = [p for p in STATE["patched"] if "id=eq.album-1" in p["query"]]
    check("apply patches the right row", bool(patched_ok) and patched_ok[0]["payload"]["title"] == "蒂法·坐地分腿", str(STATE["patched"][:2]))
    check("apply sends every title", len(STATE["patched"]) == 3, str(len(STATE["patched"])))

    # Re-running fetch must not re-download what already exists; only the item
    # that had no preview is retried.
    before = STATE["thumb_requests"]
    r = run("fetch", "--items", str(items_path), "--outdir", str(thumbs))
    retried = STATE["thumb_requests"] - before
    check("fetch is incremental (only the missing one retried)", retried == 1, f"retried {retried}")

    server.shutdown()
    failed = [r for r in results if not r[1]]
    if failed:
        print(f"\nFAILED {len(failed)}/{len(results)}")
        sys.exit(1)
    print(f"\nalbum naming: {len(results)} checks passed")


if __name__ == "__main__":
    main()
