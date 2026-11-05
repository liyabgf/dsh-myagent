#!/usr/bin/env python3
"""Consolidate Bing News RSS + Google News RSS dumps into one dated digest.

Bing links are apiclick redirects; the real URL is the 'url=' query parameter.
Google News links stay as news.google.com redirects (publisher + date + headline
is still citable); the publisher name is taken from <source> or the title suffix.

Usage: python3 scripts/digest_news.py > digests/news_digest.tsv
"""
import glob, html, os, re, sys, urllib.parse
import xml.etree.ElementTree as ET

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def clean(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()

def load(path):
    data = open(path, "rb").read()
    data = re.sub(rb"xmlns(:\w+)?=\"[^\"]*\"", b"", data)
    data = re.sub(rb"<(/?)\w+:", rb"<\1", data)
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return []
    out = []
    for it in root.findall(".//item"):
        t = it.find("title"); l = it.find("link"); d = it.find("pubDate"); s = it.find("source")
        title = clean(t.text if t is not None else "")
        link = (l.text or "").strip() if l is not None and l.text else ""
        date = (d.text or "").strip() if d is not None and d.text else ""
        src = clean(s.text if s is not None else "")
        if not src:
            m = re.search(r"\s-\s([^-]{2,60})$", title)
            src = m.group(1) if m else ""
        out.append((date, title, link, src))
    return out

def real_url(link):
    if "bing.com/news/apiclick" in link:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
        if "url" in q:
            return q["url"][0]
    return link

def main():
    rows = []
    for path in sorted(glob.glob(os.path.join(BASE, "raw", "bing*.xml"))) + \
               sorted(glob.glob(os.path.join(BASE, "raw", "gn*.xml"))):
        topic = os.path.basename(path).rsplit(".", 1)[0]
        engine = "bing" if topic.startswith("bing") else "gnews"
        topic = re.sub(r"^(bing|gn)(2)?_", "", topic)
        for date, title, link, src in load(path):
            rows.append((date, topic, engine, src, title, real_url(link)))
    for r in sorted(rows, key=lambda x: x[0], reverse=True):
        print("\t".join(r))

if __name__ == "__main__":
    main()
