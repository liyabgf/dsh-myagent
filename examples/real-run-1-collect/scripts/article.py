#!/usr/bin/env python3
"""Extract readable text from a saved article and print title/date plus body.

Usage: python3 scripts/article.py raw/file.html [max_chars]
"""
import re, sys
from html2txt import T  # reuse parser

def main():
    path = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 6000
    raw = open(path, encoding="utf-8", errors="replace").read()
    p = T()
    p.feed(raw)
    text = "".join(p.out)
    text = re.sub(r"[ \t\xa0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    head = raw[:20000]
    t = re.search(r"<title[^>]*>(.*?)</title>", head, re.S | re.I)
    title = re.sub(r"\s+", " ", t.group(1)).strip() if t else ""
    d = re.search(r'"datePublished"\s*:\s*"([^"]+)"', head) or \
        re.search(r'property="article:published_time"\s+content="([^"]+)"', head) or \
        re.search(r'<time[^>]+datetime="([^"]+)"', head)
    date = d.group(1) if d else ""
    a = re.search(r'"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"', head) or \
        re.search(r'name="author"\s+content="([^"]+)"', head)
    author = a.group(1) if a else ""
    print(f"### TITLE: {title}\n### DATE: {date}\n### AUTHOR: {author}\n### FILE: {path}")
    print(text[:limit])

if __name__ == "__main__":
    main()
