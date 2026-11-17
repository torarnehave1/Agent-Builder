#!/usr/bin/env python3
"""Writes a course manifest for «Strikkekurs fra A til Å» from the lesson list read in Kajabi.

  python3 make-manifest.py <slug> <title> <category> <kajabi category id> <lessons.txt>

lessons.txt has one lesson per line: `<lesson id> | <title>` for a video, and
`<lesson id> | <title> | <pdf file name> | <body text>` for a text lesson.
"""
import json, os, re, sys

slug, title, category, cat_id, src = sys.argv[1:6]
base = f"/Volumes/T7/Kajabi/video/den-lille-strikkeskolen/{slug}"


def slugify(s):
    s = s.lower().replace("å", "a").replace("ø", "o").replace("æ", "ae")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


lessons = []
for line in open(src, encoding="utf-8"):
    parts = [p.strip() for p in line.rstrip("\n").split(" | ")]
    if len(parts) < 2:
        continue
    lesson = {"lesson_id": int(parts[0]), "title": parts[1]}
    if len(parts) >= 4:
        lesson.update(type="text", info=parts[3].replace("\\n", "\n"), pdf=parts[2])
    else:
        lesson.update(type="video", file=f"{parts[0]}-{slugify(parts[1])}.mp4")
    lessons.append(lesson)

manifest = {
    "world": "sodesign.no", "slug": slug, "title": title, "album": title,
    "folder": f"kurs/{slug}", "metaArea": "#KURS #STRIKKESKOLEN #STRIKKEKURSFRAATILÅ",
    "glossary": "strikking", "language": "no",
    "product": {"kind": "course", "status": "draft",
                "access": {"type": "membership", "ref": "den-lille-strikkeskolen"},
                "category": [category], "level": None},
    "source": {"system": "kajabi", "product_id": 503165, "product": "Den lille strikkeskolen",
               "module": "Strikkekurs fra A til Å", "category_id": int(cat_id)},
    "videoDir": f"{base}/Komprimert", "lessons": lessons,
}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"{slug}.json")
json.dump(manifest, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
os.makedirs(f"{base}/Komprimert", exist_ok=True)
print(out, len(lessons), "lessons")
