#!/usr/bin/env python3
"""Minimal HTML -> readable text converter (stdlib only).

Usage: html2txt.py IN.html OUT.txt
Keeps paragraph/block structure, drops script/style/nav, collapses whitespace.
"""
import os
import re
import sys
from html.parser import HTMLParser

SKIP = {"script", "style", "noscript", "svg", "head", "nav", "footer", "form", "button"}
BLOCK = {"p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6",
         "section", "article", "td", "th", "blockquote", "pre", "ul", "ol", "table"}


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
        elif tag in BLOCK:
            self.out.append("\n")
            if tag in ("h1", "h2", "h3", "h4"):
                self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in SKIP and self.skip:
            self.skip -= 1
        elif tag in BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def convert(html_text):
    p = Text()
    p.feed(html_text)
    txt = "".join(p.out)
    txt = txt.replace("\u00a0", " ").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in txt.split("\n")]
    out, blank = [], 0
    for ln in lines:
        if ln:
            out.append(ln)
            blank = 0
        else:
            blank += 1
            if blank <= 1:
                out.append("")
    return "\n".join(out).strip() + "\n"


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8", errors="replace") as f:
        body = f.read()
    text = convert(body)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"{src} -> {dst} ({len(text)} chars)")


if __name__ == "__main__":
    main()
