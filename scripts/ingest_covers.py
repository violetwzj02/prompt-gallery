#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Copy generated covers into public/covers/entries and update prompts.json + progress."""
from __future__ import annotations

import json, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "covers-inbox"
ENTRIES = ROOT / "public" / "covers" / "entries"
PROMPTS = ROOT / "public" / "data" / "prompts.json"
PROGRESS = ROOT / "scripts" / "imagine-progress.json"
MANIFEST = ROOT / "scripts" / "imagine-manifest.json"

def main(ids: list[str] | None = None) -> None:
    ENTIRES = ENTRIES
    ENTIRES.mkdir(parents=True, exist_ok=True)
    prompts = json.loads(PROMPTS.read_text(encoding="utf-8"))
    progress = json.loads(PROGRESS.read_text(encoding="utf-8")) if PROGRESS.exists() else {
        "completed": [], "failed": [], "pending": []
    }
    by_id = {it["id"]: it for it in prompts["items"]}
    found = []
    for p in sorted(INBOX.iterdir()) if INBOX.exists() else []:
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        stem = p.stem
        if ids and stem not in ids:
            continue
        if stem not in by_id:
            print(f"skip unknown {p.name}")
            continue
        dest = ENTIRES / f"{stem}.jpg"
        if p.suffix.lower() in {".jpg", ".jpeg"}:
            shutil.copy2(p, dest)
        else:
            try:
                from PIL import Image
                im = Image.open(p)
                if im.mode in ("RGBA", "P"):
                    im = im.convert("RGB")
                else:
                    im = im.convert("RGB")
                im.save(dest, "JPEG", quality=92, optimize=True)
            except Exception as e:
                # keep original extension as fallback
                dest = ENTIRES / f"{stem}{p.suffix.lower()}"
                shutil.copy2(p, dest)
                print(f"warn: jpeg convert failed for {p.name}: {e}; copied as {dest.name}")
        rel = f"covers/entries/{dest.name}"
        by_id[stem]["cover"] = rel
        if stem not in progress.get("completed", []):
            progress.setdefault("completed", []).append(stem)
        if stem in progress.get("pending", []):
            progress["pending"].remove(stem)
        found.append((stem, dest, dest.stat().st_size))
        print(f"ingested {stem} -> {rel} ({dest.stat().st_size} bytes)")
    PROMPTS.write_text(json.dumps(prompts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    PROGRESS.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"done: {len(found)} covers, prompts.json updated, completed={len(progress.get('completed', []))}")

if __name__ == "__main__":
    main(sys.argv[1:] or None)
