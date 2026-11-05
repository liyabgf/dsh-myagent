#!/usr/bin/env python3
"""Dump RSS/Atom items from saved raw files as compact TSV lines.

Usage: python3 scripts/parse_rss.py raw/file.xml [max_items]
Prints: DATE \t TITLE \t LINK \t SOURCE
"""
import html, re, sys, xml.etree.ElementTree as ET

def txt(el, tag, ns=None):
    if ns:
        c = el.find(f"{{{ns}}}{tag}")
        if c is not None and c.text:
            return c.text.strip()
    c = el.find(tag)
    return c.text.strip() if c is not None and c.text else ""

def main():
    path = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    data = open(path, "rb").read()
    data = re.sub(rb"xmlns(:\w+)?=\"[^\"]*\"", b"", data, count=0)  # strip ns for simplicity
    data = re.sub(rb"<(/?)\w+:", rb"<\1", data)
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        print(f"PARSE_ERROR {path}: {e}")
        return
    items = root.findall(".//item")
    if not items:
        items = root.findall(".//entry")
    for it in items[:limit]:
        title = html.unescape(txt(it, "title") or txt(it, "title", ""))
        title = re.sub(r"\s+", " ", title)
        link = txt(it, "link")
        if not link:
            l = it.find("link")
            link = l.get("href", "") if l is not None else ""
        date = txt(it, "pubDate") or txt(it, "published") or txt(it, "updated") or txt(it, "date")
        src = txt(it, "source")
        if not src:
            m = re.search(r"\s-\s([^-]+)$", title)
            src = m.group(1) if m else ""
        desc = re.sub(r"<[^>]+>", " ", txt(it, "description") or txt(it, "summary") or "")
        desc = re.sub(r"\s+", " ", html.unescape(desc))[:300]
        print(f"{date}\t{title}\t{link}\t{src}\t{desc}")

if __name__ == "__main__":
    main()
