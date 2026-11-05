#!/usr/bin/env python3
"""Summarize saved HN Algolia JSON responses: date, points, comments, title, url, objectID.

Usage: python3 scripts/parse_hn.py raw/hn_*.json
"""
import glob, json, sys, time

def main():
    rows = []
    for path in sys.argv[1:] or glob.glob("raw/hn*.json"):
        try:
            d = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            print(f"# skip {path}: {e}")
            continue
        tag = path.split("/")[-1].rsplit(".", 1)[0]
        for h in d.get("hits", []):
            rows.append((h.get("created_at", "")[:10], h.get("points") or 0, h.get("num_comments") or 0,
                         (h.get("title") or "").strip(), h.get("url") or "", h.get("objectID"), tag))
    seen = set()
    for r in sorted(rows, key=lambda x: (x[0], x[1]), reverse=True):
        if r[5] in seen:
            continue
        seen.add(r[5])
        hn = f"https://news.ycombinator.com/item?id={r[5]}"
        print(f"{r[0]}\tpts={r[1]}\tc={r[2]}\t{r[3][:110]}\t{(r[4] or '')[:120]}\t{hn}")

if __name__ == "__main__":
    main()
