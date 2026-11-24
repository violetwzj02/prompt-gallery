#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mock-Drive + mock-Supabase test for scripts/album_import.py."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import parse

ROOT = Path(__file__).resolve().parents[1]
ALBUM_NAME = "风格 Prompt 图鉴·云端相册"
STATE = {"files": {}, "seq": 0, "posted": [], "patched": [], "folder_creates": 0}


def new_id() -> str:
    STATE["seq"] += 1
    return f"id{STATE['seq']:04d}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence
        pass

    def _json(self, status: int, payload) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _children(self, parent: str) -> list[dict]:
        return [
            {
                "id": f["id"],
                "name": f["name"],
                "mimeType": f["mimeType"],
                "md5Checksum": f.get("md5"),
                "size": f.get("size"),
            }
            for f in STATE["files"].values()
            if f.get("parents") == [parent]
        ]

    def do_GET(self):
        parsed = parse.urlsplit(self.path)
        if parsed.path == "/drive/v3/files":
            query = parse.parse_qs(parsed.query).get("q", [""])[0]
            parent = query.split("'")[1] if "'" in query else "root"
            self._json(200, {"files": self._children(parent)})
            return
        if parsed.path == "/rest/v1/album_items":
            self._json(200, [])
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        parsed = parse.urlsplit(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)

        if parsed.path == "/drive/v3/files":
            meta = json.loads(body.decode("utf-8"))
            fid = new_id()
            STATE["files"][fid] = {**meta, "id": fid}
            if meta.get("mimeType") == "application/vnd.google-apps.folder":
                STATE["folder_creates"] += 1
            self._json(200, {"id": fid})
            return

        if parsed.path == "/upload/drive/v3/files":
            boundary = self.headers.get("Content-Type", "").split("boundary=")[-1].encode()
            parts = body.split(b"--" + boundary)
            file_part = parts[2]
            head, _, data = file_part.partition(b"\r\n\r\n")
            data = data.rstrip(b"\r\n-")
            meta = json.loads(parts[1].partition(b"\r\n\r\n")[2].rstrip(b"\r\n").decode("utf-8"))
            digest = hashlib.md5(data).hexdigest()
            for existing in STATE["files"].values():
                if existing.get("md5") == digest:
                    self._json(409, {"error": "duplicate"})
                    return
            fid = new_id()
            STATE["files"][fid] = {
                "id": fid,
                "name": meta["name"],
                "parents": meta.get("parents"),
                "md5": digest,
                "size": len(data),
                "mimeType": "image/jpeg",
            }
            self._json(200, {"id": fid, "name": meta["name"], "md5Checksum": digest, "size": len(data)})
            return

        if parsed.path == "/rest/v1/album_items":
            rows = json.loads(body.decode("utf-8"))
            STATE["posted"].extend(rows)
            self._json(201, rows)
            return

        self._json(404, {"error": "not found"})

    def do_PATCH(self):
        parsed = parse.urlsplit(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        STATE["patched"].append({"query": parsed.query, "payload": payload})
        if parsed.path == "/rest/v1/album_items":
            self._json(200, [{"id": "x", **payload}])
            return
        self._json(404, {"error": "not found"})


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    STATE["files"]["rootfolder"] = {"id": "rootfolder", "name": ALBUM_NAME, "mimeType": "application/vnd.google-apps.folder", "parents": ["root"]}

    work = Path(tempfile.mkdtemp(prefix="pg-album-import-"))
    downloads = work / "downloads"
    (downloads / "stills").mkdir(parents=True)
    (downloads / "videos").mkdir(parents=True)
    (downloads / "stills" / "u1.jpg").write_bytes(b"jpeg-one")
    (downloads / "stills" / "u2.jpg").write_bytes(b"jpeg-two")
    (downloads / "videos" / "u3.mp4").write_bytes(b"mp4-three")

    manifest = {
        "items": [
            {"uuid": "u1", "type": "still", "character": "蒂法", "prompt": "kneeling side view"},
            {"uuid": "u2", "type": "still", "character": "蒂法", "prompt": "kneeling side view"},
            {"uuid": "u3", "type": "video", "character": "蒂法", "prompt": "slow turn"},
        ]
    }
    manifest_path = work / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    titles_path = work / "titles.json"
    titles_path.write_text(json.dumps({"u1": "蒂法·侧身跪坐", "u2": "蒂法·侧身跪坐 2"}, ensure_ascii=False), encoding="utf-8")

    env = {
        **os.environ,
        "SUPABASE_URL": base,
        "SUPABASE_SERVICE_KEY": "service-key",
        "GOOGLE_ACCESS_TOKEN": "tok",
        "GOOGLE_API_BASE": base,
        "GOOGLE_UPLOAD_BASE": base,
        "ALBUM_DRIVE_FOLDER_ID": "rootfolder",
    }
    state_dir = ROOT / "covers-inbox" / "album"

    def run(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "album_import.py"), *args],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(ROOT),
        )

    results: list[tuple[str, bool, str]] = []

    def check(label: str, ok: bool, detail: str = "") -> None:
        results.append((label, ok, detail))
        print(("ok   " if ok else "FAIL ") + label + (f" — {detail}" if detail and not ok else ""))

    # Clean the ledger so the test always starts from zero.
    for name in ("uploads.json", "folders.json"):
        target = state_dir / name
        if target.is_file():
            target.unlink()

    r = run("folders", "--manifest", str(manifest_path))
    check("folders exits 0", r.returncode == 0, r.stderr[-400:])
    check("one character folder created", STATE["folder_creates"] == 1, str(STATE["folder_creates"]))

    r = run("upload", "--manifest", str(manifest_path), "--downloads", str(downloads), "--titles", str(titles_path))
    check("upload exits 0", r.returncode == 0, r.stderr[-400:])
    images = [f for f in STATE["files"].values() if f["mimeType"] == "image/jpeg"]
    check("two stills uploaded, video skipped", len(images) == 2, str([f["name"] for f in images]))
    check("titles become Drive file names", {f["name"] for f in images} == {"蒂法·侧身跪坐.jpg", "蒂法·侧身跪坐 2.jpg"})

    r = run("upload", "--manifest", str(manifest_path), "--downloads", str(downloads), "--titles", str(titles_path))
    check("re-run is idempotent", r.returncode == 0 and len([f for f in STATE["files"].values() if f["mimeType"] == "image/jpeg"]) == 2, r.stderr[-300:])

    r = run("rows", "--ledger", str(state_dir / "uploads.json"))
    check("rows exits 0", r.returncode == 0, r.stderr[-400:])
    check("two album rows posted", len(STATE["posted"]) == 2, str(len(STATE["posted"])))
    first = STATE["posted"][0] if STATE["posted"] else {}
    check("row is 18+ with character category", first.get("auto_categories") == ["18+"] and first.get("custom_categories") == ["蒂法"], json.dumps(first, ensure_ascii=False))
    check("row keeps the readable title", first.get("title") == "蒂法·侧身跪坐", str(first.get("title")))

    map_path = work / "rename.json"
    map_path.write_text(json.dumps({"album-id-1": "甘雨·浴缸回眸"}, ensure_ascii=False), encoding="utf-8")
    r = run("titles", "--map", str(map_path), "--key", "id")
    check("titles exits 0", r.returncode == 0, r.stderr[-300:])
    check("title patch hits the right row", STATE["patched"] and "id=eq.album-id-1" in STATE["patched"][0]["query"], str(STATE["patched"][:1]))

    server.shutdown()
    failed = [r for r in results if not r[1]]
    if failed:
        print(f"\nFAILED {len(failed)}/{len(results)}")
        sys.exit(1)
    print(f"\nalbum import: {len(results)} checks passed")


if __name__ == "__main__":
    main()
