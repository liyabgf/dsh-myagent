#!/usr/bin/env python3
"""Convert saved HTML to readable plain text (stdlib only).

Usage: python3 scripts/html2txt.py raw/file.html [out.txt]
Keeps table cell separation with ' | ' and row breaks.
"""
import html, re, sys
from html.parser import HTMLParser

SKIP = {"script", "style", "noscript", "svg", "head", "nav", "header", "footer",
        "aside", "form", "button", "select", "figure", "picture"}

class T(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
        if tag in ("p", "div", "br", "li", "tr", "table", "section", "article", "h1", "h2", "h3", "h4"):
            self.out.append("\n")
        if tag in ("td", "th"):
            self.out.append(" | ")
    def handle_endtag(self, tag):
        if tag in SKIP and self.skip:
            self.skip -= 1
        if tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4"):
            self.out.append("\n")
    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)

def main():
    src = sys.argv[1]
    p = T()
    p.feed(open(src, encoding="utf-8", errors="replace").read())
    text = "".join(p.out)
    text = re.sub(r"[ \t\xa0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = html.unescape(text)
    if len(sys.argv) > 2:
        open(sys.argv[2], "w", encoding="utf-8").write(text)
        print(f"wrote {sys.argv[2]} chars={len(text)}", file=sys.stderr)
    else:
        sys.stdout.write(text)

if __name__ == "__main__":
    main()
