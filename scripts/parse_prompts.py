# -*- coding: utf-8 -*-
"""Parse PROMPT_MASTER.md → public/data/prompts.json (same anchors as build_xlsx.py)."""
import re, json, os, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_MASTER = os.path.normpath(os.path.join(ROOT, "..", "prompt-library", "PROMPT_MASTER.md"))
OUT = os.path.join(ROOT, "public", "data", "prompts.json")

cat_map = {
    "renwu": "人物", "changjing": "场景", "goutu": "构图",
    "texiao": "特效", "zhoubian": "周边", "yishu": "艺术",
}
fallback = {
    "人物": "角色设定 / 人像精修 / 人物渲染",
    "场景": "环境 / 地点 / 场景类视觉",
    "构图": "镜头 / 分镜 / 版式 / 信息图",
    "特效": "光效 / 能量 / 法术特技",
    "周边": "商品化 / 纪念品 / 周边",
    "艺术": "插画风 / 艺术字 / 艺术海报",
}
cat_slug = {v: k for k, v in cat_map.items()}

def parse(master_path: str):
    text = open(master_path, encoding="utf-8").read()
    lines = text.split("\n")
    entries = []
    cat = None
    cur = None

    def finalize():
        nonlocal cur
        if cur is None:
            return
        usage_parts = []
        for bl in cur["body"].split("\n"):
            s = bl.strip()
            if s.startswith(">"):
                inner = re.sub(r"^>\s*", "", s).strip()
                if re.search(r"(用途|风格|适用|使用说明)", inner):
                    usage_parts.append(inner)
        usage = "；".join(usage_parts) if usage_parts else fallback[cur["cat"]]
        entries.append({
            "id": cur["id"],
            "category": cur["cat"],
            "categorySlug": cat_slug[cur["cat"]],
            "title": cur["title"],
            "usage": usage,
            "body": cur["body"].strip(),
            "source": cur["src"],
            "cover": None,
        })
        cur = None

    i, N = 0, len(lines)
    while i < N:
        line = lines[i].strip()
        m = re.match(r'<a id="([^"]+)"></a>', line)
        if m:
            aid = m.group(1)
            if aid in cat_map:
                finalize()
                cat = cat_map[aid]
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

def main():
    master = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MASTER
    if not os.path.isfile(master):
        raise SystemExit(f"Master not found: {master}")
    entries = parse(master)
    c = Counter(e["category"] for e in entries)
    payload = {
        "generatedFrom": os.path.basename(master),
        "count": len(entries),
        "categories": {k: c[k] for k in ["人物", "场景", "构图", "特效", "周边", "艺术"]},
        "items": entries,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Wrote {OUT} ({len(entries)} items)")
    for k, v in payload["categories"].items():
        print(f"  {k}: {v}")

if __name__ == "__main__":
    main()
