#!/usr/bin/env python3
"""Select full article URLs from digests/news_digest.tsv by title fragments.

Usage: python3 scripts/pick_articles.py fragments.txt > sources/m4_articles.tsv
Each line of fragments.txt is a lowercase substring matched against the title.
"""
import sys

rows = [l.rstrip("\n").split("\t") for l in open("digests/news_digest.tsv", encoding="utf-8")]
seen = set()
out = []
for frag in open(sys.argv[1], encoding="utf-8"):
    frag = frag.strip()
    if not frag or frag.startswith("#"):
        continue
    hit = None
    for r in rows:
        if len(r) < 6 or r[2] != "bing":
            continue
        if frag.lower() in r[4].lower() and r[5].startswith("http"):
            hit = r
            break
    if hit is None:
        out.append(f"# MISS\t{frag}")
        continue
    slug = "art_" + frag.replace(" ", "_")[:40].replace("/", "_").replace("'", "").replace("?", "").replace(",", "")
    key = hit[5]
    if key in seen:
        continue
    seen.add(key)
    out.append(f"{slug}\t{key}")
print("\n".join(out))
