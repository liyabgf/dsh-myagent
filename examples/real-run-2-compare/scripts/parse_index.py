#!/usr/bin/env python3
"""Parse fetched corpora (mine + sibling Ticket b356ac64) into one compact index.

Writes sources/index_all.tsv with columns:
  corpus, source_name, date_utc, title, publisher, link, snippet

Corpora:
  mine      -> <this ticket>/raw/*
  sibling   -> ../搜集信息-b356ac64/raw/*  (read-only)
Handles RSS/Atom XML, Google News / Bing News RSS, gov.uk search JSON,
EU presscorner JSON, SEC submissions JSON, Wikipedia API JSON.
"""
import glob
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sources", "index_all.tsv")
CORPORA = {
    "mine": [os.path.join(ROOT, "raw"), os.path.join(ROOT, "raw", "news3"),
             os.path.join(ROOT, "raw", "eu"), os.path.join(ROOT, "raw", "uk")],
    "sibling": ["~/.dsh/state/myagent/work/搜集信息-b356ac64/raw",
                "~/.dsh/state/myagent/work/搜集信息-b356ac64/txt"],
}

TAG = re.compile(r"<[^>]+>")
WS = re.compile(r"\s+")


def clean(text, limit=320):
    if text is None:
        return ""
    if isinstance(text, bytes):
        text = text.decode("utf-8", "replace")
    text = html.unescape(text)
    text = TAG.sub(" ", text)
    text = WS.sub(" ", text).strip()
    return text[:limit]


def local(elem):
    return elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag


def find_text(elem, *names):
    for child in elem.iter():
        if local(child) in names and (child.text or "").strip():
            return child.text.strip()
    return ""


def parse_feed(path):
    rows = []
    try:
        tree = ET.parse(path)
    except ET.ParseError:
        return rows
    root = tree.getroot()
    entries = []
    for elem in root.iter():
        if local(elem) in ("item", "entry"):
            entries.append(elem)
    for e in entries:
        title = find_text(e, "title")
        link = ""
        for child in e.iter():
            if local(child) == "link":
                link = child.get("href") or (child.text or "").strip()
                if link:
                    break
        date = find_text(e, "pubDate", "published", "updated", "date")
        desc = find_text(e, "description", "summary", "content")
        pub = ""
        m = re.match(r"^(.*?)\s+-\s+([^-]{2,40})$", title)
        if m:
            title, pub = m.group(1).strip(), m.group(2).strip()
        src = find_text(e, "source")
        if not pub and src:
            pub = src
        rows.append((date, clean(title, 240), pub, link, clean(desc, 400)))
    return rows


def parse_govuk(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return rows
    for it in data.get("results", []) or []:
        rows.append((
            it.get("public_timestamp", it.get("content_store_document_type", "")),
            clean(it.get("title"), 240),
            (it.get("organisations") or [{}])[0].get("title", "") if isinstance(it.get("organisations"), list) else "",
            "https://www.gov.uk" + it.get("link", "") if it.get("link", "").startswith("/") else it.get("link", ""),
            clean(it.get("description"), 400),
        ))
    return rows


def parse_presscorner(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return rows
    for it in data.get("docuLanguageListResources", []) or []:
        ref = it.get("refCode", "")
        rows.append((
            it.get("eventDate", ""),
            clean(it.get("title"), 240),
            "European Commission",
            f"https://ec.europa.eu/commission/presscorner/detail/en/{ref.replace('/', '_')}" if ref else "",
            clean(it.get("leadText"), 400) + f" [{it.get('docutype', {}).get('description', '')} {ref}]",
        ))
    return rows


def parse_wikipedia(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return rows
    q = data.get("query", {})
    for pg in (q.get("pages") or {}).values():
        rows.append(("", clean(pg.get("title"), 240), "Wikipedia",
                     f"https://en.wikipedia.org/wiki/{pg.get('title','').replace(' ', '_')}",
                     clean(pg.get("extract"), 400)))
    for hit in q.get("search") or []:
        rows.append(("", clean(hit.get("title"), 240), "Wikipedia",
                     f"https://en.wikipedia.org/wiki/{hit.get('title','').replace(' ', '_')}",
                     clean(hit.get("snippet"), 400)))
    return rows


def parse_sec_submissions(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return rows
    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    for i, form in enumerate(forms[:120]):
        acc = recent.get("accessionNumber", [""])[i].replace("-", "")
        doc = recent.get("primaryDocument", [""])[i]
        rows.append((
            recent.get("filingDate", [""])[i],
            f"{form} filed {recent.get('filingDate', [''])[i]} ({recent.get('reportDate', [''])[i]})",
            "SEC EDGAR / Alphabet Inc.",
            f"https://www.sec.gov/Archives/edgar/data/1652044/{acc}/{doc}",
            f"items={recent.get('items', [''])[i]} primary={doc}",
        ))
    return rows


def classify(path, name):
    n = name.lower()
    try:
        with open(path, "rb") as f:
            head = f.read(300).decode("utf-8", "replace").lower()
    except OSError:
        return "unknown"
    if head.startswith("<?xml") or "<rss" in head or "<feed" in head:
        return "feed"
    if head.lstrip().startswith(("{", "[")):
        if "presscorner" in n or "eu_press" in n or n.startswith("eu_"):
            return "presscorner"
        if "submissions" in n:
            return "sec"
        if "wp_" in n or "wikipedia" in n:
            return "wikipedia"
        if "gov.uk" in n or n.startswith("uk_"):
            return "govuk"
        if "sec_fts" in n:
            return "secfts"
        return "json"
    if "<html" in head or "<!doctype" in head:
        return "html"
    if "sec_submissions" in n:
        return "sec"
    return "text"


def main():
    rows = []
    for corpus, dirs in CORPORA.items():
        for d in dirs:
            for path in sorted(glob.glob(os.path.join(d, "*"))):
                if not os.path.isfile(path) or path.endswith(".part"):
                    continue
                name = os.path.basename(path)
                stem = os.path.splitext(name)[0]
                kind = classify(path, name)
                if kind == "feed":
                    parsed = parse_feed(path)
                elif kind == "govuk":
                    parsed = parse_govuk(path)
                elif kind == "presscorner":
                    parsed = parse_presscorner(path)
                elif kind == "wikipedia":
                    parsed = parse_wikipedia(path)
                elif kind == "sec":
                    parsed = parse_sec_submissions(path)
                else:
                    continue
                for date, title, pub, link, snippet in parsed:
                    if not title:
                        continue
                    rows.append((corpus, stem, date or "", title, pub, link,
                                 snippet.replace("\t", " ").replace("\n", " ")))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("corpus\tsource_name\tdate_utc\ttitle\tpublisher\tlink\tsnippet\n")
        for r in rows:
            f.write("\t".join(str(x) for x in r) + "\n")
    mine = sum(1 for r in rows if r[0] == "mine")
    sib = sum(1 for r in rows if r[0] == "sibling")
    print(f"index rows: {len(rows)} (mine={mine}, sibling={sib}) -> {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
