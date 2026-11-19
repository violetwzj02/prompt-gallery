# -*- coding: utf-8 -*-
"""Build scripts/imagine-manifest.json from public/data/prompts.json."""
from __future__ import annotations

import json
import os
import re
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROMPTS = os.path.join(ROOT, "public", "data", "prompts.json")
OLD = os.path.join(HERE, "imagine-prompts.json")
OUT = os.path.join(HERE, "imagine-manifest.json")
PROGRESS = os.path.join(HERE, "imagine-progress.json")

IMAGINE_ASPECTS = ("1:1", "2:3", "3:4", "4:3", "16:9", "9:16")

# Unusual source ratios → nearest Imagine-supported ratio.
ASPECT_MAP = {
    "3:1": ("16:9", "超宽幅 3:1 映射为 16:9"),
    "21:9": ("16:9", "21:9 映射为 16:9"),
    "2:1": ("16:9", "2:1 映射为 16:9"),
    "9:10": ("3:4", "9:10 映射为 3:4"),
    "4:5": ("3:4", "4:5 映射为 3:4"),
    "5:4": ("4:3", "5:4 映射为 4:3"),
    "3:2": ("4:3", "3:2 映射为 4:3"),
}

DEFAULT_ASPECT = {
    "人物": "3:4",
    "场景": "16:9",
    "构图": "16:9",
    "特效": "3:4",
    "周边": "4:3",
    "艺术": "3:4",
}

MJ_FLAGS = re.compile(
    r"\s*--(?:ar|v|s|stylize|style|iw|q|chaos|weird|tile|stop|seed|no|niji|hd|p|raw|sw|cw|w|h)\b[^\s]*",
    re.I,
)

# Fully rewritten Imagine prompts for safety / IP. Official names never appear here.
SPECIAL: dict[str, dict] = {
    "renwu-7": {
        "imaginePrompt": (
            "Candid phone snapshot of an adult East Asian woman in her mid-20s, "
            "porcelain-doll makeup aesthetic, large soft eyes, clearly adult facial structure and body, "
            "casual everyday clothes, fully clothed, non-sexual, indoor natural light, "
            "casual lifestyle photo, photorealistic, no watermark, no text."
        ),
        "flags": [
            {
                "type": "sensitive",
                "note": "源条目写「超幼态」「幼态脸成人」；封面必须明确为二十多岁成年女性、着衣、非性化。",
            }
        ],
    },
    "renwu-6": {
        "imaginePrompt": (
            "Tasteful artistic boudoir fashion photograph of an adult woman, Rembrandt single-light, "
            "dark low-key atmosphere, champagne silk fabric, sensual but elegant and commercial, "
            "real photography, fully tasteful, no nudity, no explicit sexual content, "
            "cinematic shadows, photorealistic, no watermark, no text."
        ),
        "flags": [
            {
                "type": "sensitive",
                "note": "源条目为暧昧艺术私房；封面保持克制、无裸露、无露骨性内容。",
            }
        ],
    },
    "renwu-4": {
        "imaginePrompt": (
            "Official anime key-visual movie poster style, cinematic lighting, a poised elegant young woman "
            "with long dark hair and a cool expression, dramatic rim light, high-production Japanese animation "
            "poster quality, detailed background bokeh, original character, no copyrighted character names, "
            "no logos, no text, no watermark."
        ),
        "flags": [
            {
                "type": "copyright-ip",
                "note": "源条目涉及「黑川茜」；封面改为同气质的原创角色，不出现官方名或商标。",
            }
        ],
    },
    "renwu-10": {
        "imaginePrompt": (
            "Ultra-wide cinematic studio photograph of an adult woman lying sideways across a seamless white cyc, "
            "long auburn-brown hair with straight bangs loosely braided, calm slightly commanding expression, "
            "white long-sleeve dress shirt, slim black tie, black tailored shorts, sheer black tights, "
            "black patent heels, high-end live-action fashion editorial, photorealistic, no copyrighted character, "
            "no logos, no text, no watermark."
        ),
        "flags": [
            {
                "type": "copyright-ip",
                "note": "源条目为《电锯人》玛奇玛 COS；封面改为相近造型的原创角色，不出现作品名或角色名。3:1 画幅映射为 16:9。",
            }
        ],
    },
    "renwu-17": {
        "imaginePrompt": (
            "Cute chibi character doodle in pencil and loose watercolor, sketchy lines, light washes, "
            "white paper background, an original sci-fi fantasy operator-inspired design with silver hair "
            "and a dark coat, charming handmade look, not a copyrighted character, no logos, no watermark."
        ),
        "flags": [
            {
                "type": "copyright-ip",
                "note": "源条目为《明日方舟》Q 版；封面改为原创角色，不出现作品名、干员名或商标。",
            }
        ],
    },
    "yishu-41": {
        "imaginePrompt": (
            "Minimal cinematic 16:9 story poster, a lone silver-haired adult woman standing in a desolate "
            "windswept landscape under a dramatic sky, stark typography-free composition, restrained key-visual "
            "style, original character, no copyrighted names, no logos, no watermark."
        ),
        "flags": [
            {
                "type": "copyright-ip",
                "note": "源条目为明日方舟 SideStory / 塔露拉；封面改为原创角色与极简剧情海报气质，不出现官方名。",
            }
        ],
    },
    "yishu-25": {
        "imaginePrompt": (
            "9:16 vertical brutalist editorial character poster, oversized cropped typography used as abstract "
            "graphic shapes, extreme crop of an original stylized figure, raw concrete and high-contrast ink, "
            "no real brand names, no logos, no trademarked wordmarks, no watermark."
        ),
        "flags": [
            {
                "type": "copyright-ip",
                "note": "源条目含 voxCAT 品牌；封面去掉真实商标与品牌名。",
            }
        ],
    },
    "yishu-9": {
        "imaginePrompt": (
            "Oil-pastel and crayon illustration, thick waxy strokes, visible paper tooth, colorful naive-art "
            "texture, a simple still-life bouquet on textured paper, charming handmade look, no text, no watermark."
        ),
        "flags": [
            {
                "type": "incomplete",
                "note": "源库标明原文截断、内容缺失；此封面提示词仅根据「油画棒 / 蜡笔」风格推断，待正文补全后再修订。",
            }
        ],
    },
}

# Concrete stand-ins so template cards still yield a strong cover still.
TEMPLATE_FILL = {
    "goutu-3-01": (
        "Apple-keynote style exploded-view product diagram of a pair of wireless earbuds, 16:9, "
        "components floating in orderly layers with thin leader lines, clean pale gray background, "
        "realistic metal plastic and mesh textures, soft studio shadows, no garbled text, no watermark."
    ),
    "goutu-3-02": (
        "16:9 chalkboard teaching diagram in Chinese about photosynthesis, dark green blackboard, "
        "white pale-yellow and light-blue chalk lines, title plus three clear steps, arrows and simple drawings, "
        "hand-drawn but tidy layout, no photo, no watermark."
    ),
    "goutu-3-03": (
        "16:9 modern technical architecture diagram of a fictional cloud app, blue-gray professional whitepaper style, "
        "boxes for user entry, API gateway, services, database, queue, model service and monitoring, "
        "clear Chinese labels and arrows, no glow, no decoration overload, no watermark."
    ),
    "goutu-3-04": (
        "9:16 fictional Chinese mobile app UI screenshot for a quiet reading app, realistic product prototype "
        "not a concept illustration, top navigation, content list, bottom action button, generous whitespace, "
        "modern Chinese internet design, no real-platform logos, no celebrities, no watermark."
    ),
    "goutu-3-05": (
        "16:9 science magazine cover illustration with a strong visual metaphor about time and memory, "
        "bright clever slightly absurdist but not scary, clear subject left of center, empty space for a later title, "
        "no typography, no logo, no watermark."
    ),
    "renwu-3-03": (
        "Vertical Korean-idol style character profile card, minimal magazine layout, pure white background, "
        "thin dividers, an original young man in a cream knit vest, front side and back full-body views, "
        "six expression headshots, neatly labeled info modules, no real celebrity, no watermark."
    ),
    "goutu-5": (
        "Cinematic cover still that itself demonstrates craft: a low-angle portrait at golden hour, "
        "shallow depth of field f/1.8, backlight with long shadows, soft teal-and-orange grade, "
        "photoreal, no typography, no watermark."
    ),
}


def is_mostly_english(text: str) -> bool:
    letters = re.findall(r"[A-Za-z]", text)
    cjk = re.findall(r"[\u4e00-\u9fff]", text)
    return len(letters) >= 40 and len(letters) > len(cjk) * 1.2


def strip_mj(text: str) -> str:
    cleaned = MJ_FLAGS.sub("", text)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip(" ,;.")


def pick_aspect(item: dict) -> tuple[str, str | None, str | None]:
    """Return (imagineAspect, sourceAspect or default, mapping note)."""
    raw = item.get("aspect")
    note = None
    source = raw
    if not raw:
        source = DEFAULT_ASPECT.get(item.get("category") or "艺术", "3:4")
        # posters already in title often
        title = item.get("title") or ""
        m = re.search(r"(16:9|9:16|3:4|4:3|1:1|2:3|3:1|9:10)", title)
        if m:
            source = m.group(1)
        note = f"条目未标注画幅，按{'标题' if m else '大类默认'}采用 {source}"
    if source in IMAGINE_ASPECTS:
        return source, raw, note
    mapped, map_note = ASPECT_MAP.get(source, ("16:9", f"{source} 映射为 16:9"))
    note = "; ".join(x for x in (note, map_note) if x)
    return mapped, raw, note


def wrap_cover(text: str) -> str:
    body = strip_mj((text or "").strip())
    if not body:
        return "A single cinematic cover still, high quality, no watermark, no UI chrome."
    if is_mostly_english(body):
        if not re.search(r"no watermark|no text", body, re.I):
            body = body.rstrip(".") + ". No watermark, no typography unless the scene itself is lettering."
        return body
    return (
        f"A single strong cover still that faithfully depicts the following scene: {body} "
        "High quality, cinematic lighting, follow the medium implied by the description, "
        "no watermark, no UI chrome, no extra typography unless the scene itself is lettering."
    )


def build_item(it: dict) -> dict:
    imagine_aspect, source_aspect, aspect_note = pick_aspect(it)
    flags: list[dict] = []
    special = SPECIAL.get(it["id"])
    if special:
        imagine = special["imaginePrompt"]
        flags.extend(special.get("flags") or [])
    elif it["id"] in TEMPLATE_FILL:
        imagine = TEMPLATE_FILL[it["id"]]
    else:
        imagine = wrap_cover(it.get("promptText") or it.get("body") or it.get("title") or "")

    if it.get("duplicateOf") or it.get("duplicateNote"):
        flags.append(
            {
                "type": "duplicate",
                "note": it.get("duplicateNote")
                or (f"与 {it['duplicateOf']} 内容相同" if it.get("duplicateOf") else "源库标注为重复条目"),
            }
        )

    rec = {
        "id": it["id"],
        "title": it["title"],
        "category": it["category"],
        "collection": it.get("collection"),
        "aspect": source_aspect,
        "imagineAspect": imagine_aspect,
        "promptText": it.get("promptText") or "",
        "imaginePrompt": imagine,
        "outfile": f"covers/entries/{it['id']}.jpg",
        "outfilePng": f"covers/entries/{it['id']}.png",
        "flags": flags,
    }
    if aspect_note:
        rec["aspectNote"] = aspect_note
    return rec


def main():
    data = json.loads(open(PROMPTS, encoding="utf-8").read())
    items = [build_item(it) for it in data["items"]]
    assert len(items) == data["count"]

    flag_counts = Counter()
    mapped = 0
    for rec in items:
        for f in rec["flags"]:
            flag_counts[f["type"]] += 1
        if rec.get("aspectNote") and "映射" in rec["aspectNote"]:
            mapped += 1

    payload = {
        "generatedFrom": "public/data/prompts.json",
        "count": len(items),
        "imagineAspects": list(IMAGINE_ASPECTS),
        "notes": (
            "Paste imaginePrompt into grok.com/imagine. Use imagineAspect when the UI allows a ratio. "
            "Save the result to outfile (jpg) or outfilePng. Do not use official character or brand names."
        ),
        "items": items,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    progress = {
        "completed": [],
        "failed": [],
        "pending": [rec["id"] for rec in items],
    }
    with open(PROGRESS, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)

    print(f"Wrote {OUT} ({len(items)} items)")
    print(f"Wrote {PROGRESS}")
    print("Flags:", dict(flag_counts))
    print(f"Aspect mappings noted: {mapped}")
    print("Imagine aspect mix:", Counter(r["imagineAspect"] for r in items))
    print("Special / template ids:", sorted(set(SPECIAL) | set(TEMPLATE_FILL)))


if __name__ == "__main__":
    main()
