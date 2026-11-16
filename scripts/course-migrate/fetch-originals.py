#!/usr/bin/env python3
"""Downloads a course's original videos from Kajabi's signed links (2026-11-13).

  python3 -I fetch-originals.py <manifest.json> <links.json>

links.json is {"<lesson_id>": ["<signed url>", ...]}, saved by the browser from the Kajabi admin
pages (posts/<id>/edit carries the «Download video» link). The links are never printed. Each file
lands next to the compressed folder as <file from the manifest>, with a .json holding its sha256.
"""
import hashlib, json, os, subprocess, sys

manifest, links = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
dest = os.path.dirname(manifest["videoDir"])
os.makedirs(dest, exist_ok=True)
for lesson in manifest["lessons"]:
    if lesson["type"] != "video":
        continue
    out = os.path.join(dest, lesson["file"])
    urls = [u for u in links.get(str(lesson["lesson_id"]), []) if ".mp4" in u or ".mov" in u or ".m4v" in u]
    if os.path.exists(out + ".json"):
        print(f"have {lesson['file']}"); continue
    if len(urls) != 1:
        sys.exit(f"{lesson['title']}: expected one video link, found {len(urls)}")
    r = subprocess.run(["curl", "-sS", "--fail", "--retry", "3", "-C", "-", "-o", out, urls[0]], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"{lesson['title']}: download failed ({r.returncode})")
    h = hashlib.sha256()
    with open(out, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    meta = {"lesson_id": lesson["lesson_id"], "title": lesson["title"], "original_filename": urls[0].split("?")[0].split("/")[-1],
            "bytes": os.path.getsize(out), "sha256": h.hexdigest()}
    json.dump(meta, open(out + ".json", "w"), ensure_ascii=False, indent=2)
    print(f"got {lesson['file']}: {meta['bytes'] / 1e6:.0f} MB")
