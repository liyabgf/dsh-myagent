#!/usr/bin/env python3
"""Print prose-only body text of converted articles.

Usage: python3 scripts/body.py txt/file.txt [max_chars] [skip_lines]
"""
import sys

def main():
    path = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 2500
    skip = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    lines = [l.strip() for l in open(path, encoding="utf-8", errors="replace")]
    keep, seen = [], set()
    for l in lines:
        if len(l) < 75:
            continue
        k = l[:70]
        if k in seen:
            continue
        seen.add(k)
        keep.append(l)
    print("\n".join(keep[skip:])[:n])

if __name__ == "__main__":
    main()
