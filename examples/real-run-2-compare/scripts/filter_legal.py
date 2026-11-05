#!/usr/bin/env python3
"""Stage 3: filter the parsed index down to legal/regulatory items.

Reads sources/index_all.tsv, scores each row on legal vocabulary (EN + ZH),
normalises dates, dedupes on normalised title, and writes:
  notes/legal_candidates.tsv  (score, date, corpus, source, title, publisher, link, snippet)
  notes/legal_top.md          (score >= 3, grouped by month, readable)
"""
import csv
import os
import re
import sys
from collections import defaultdict
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "sources", "index_all.tsv")
NOTES = os.path.join(ROOT, "notes")
os.makedirs(NOTES, exist_ok=True)

STRONG = [
    "antitrust", "monopoly", "lawsuit", "sued", "sues", "suit against", "court rules",
    "court of justice", "general court", "ruling", "verdict", "injunction", "fine of",
    "fined", "penalty", "settlement", "consent decree", "indictment", "subpoena",
    "damages", "jury", "appeal", "appellate", "supreme court", "class action",
    "divest", "break up", "breakup", "remedies", "remedy", "regulator", "enforcement",
    "statement of objections", "non-compliance", "digital markets act", "dma fine",
    "digital services act", "gdpr", "data protection", "privacy", "attorney general",
    "doj", "justice department", "ftc", "cci", "cma", "kftc", "accc", "bundeskartellamt",
    "competition commission", "copyright", "patent", "trademark", "infringement",
    "nlrb", "labor board", "wrongful termination", "discrimination", "defamation",
    "fraud", "tax evasion", "securities", "probe", "investigation", "hearing", "trial",
    "complaint", "order", "sanction", "judgment", "litigation", "arbitration",
    "诉讼", "起诉", "法院", "判决", "罚款", "反垄断", "上诉", "和解", "调查", "监管", "禁令", "侵权", "裁决",
]
WEAK = ["google", "alphabet", "youtube", "waymo", "gemini", "android", "chrome", "search"]
NEG = ["recipe", "how to", "review:", "hands-on", "best ", "deal:", "watch ", "trailer"]


def score(text):
    t = text.lower()
    s = 0
    hits = []
    for k in STRONG:
        if k in t:
            s += 2
            hits.append(k)
    if any(w in t for w in WEAK):
        s += 1
    for n in NEG:
        if n in t:
            s -= 2
    return s, hits


def norm_date(raw):
    raw = (raw or "").strip()
    if not raw:
        return ""
    try:
        return parsedate_to_datetime(raw).strftime("%Y-%m-%d")
    except Exception:
        pass
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r"(\d{4})[/-](\d{2})[/-](\d{2})", raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return raw[:10]


def norm_title(t):
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", t.lower())[:110]


def main():
    rows = []
    with open(INDEX, encoding="utf-8") as f:
        r = csv.DictReader(f, delimiter="\t")
        for row in r:
            text = f"{row['title']} {row['snippet']}"
            s, hits = score(text)
            if s < 3:
                continue
            rows.append({
                "score": s,
                "date": norm_date(row["date_utc"]),
                "corpus": row["corpus"],
                "source": row["source_name"],
                "title": row["title"],
                "publisher": row["publisher"],
                "link": row["link"],
                "snippet": row["snippet"],
                "hits": ",".join(hits[:6]),
            })
    seen = {}
    for r in rows:
        key = norm_title(r["title"])
        if key in seen:
            old = seen[key]
            if r["score"] > old["score"] or (r["score"] == old["score"] and r["date"] > old["date"]):
                seen[key] = r
            if not old["corpus"].endswith("+sibling") and r["corpus"] != old["corpus"]:
                old["corpus"] = old["corpus"] + "+" + r["corpus"]
        else:
            seen[key] = dict(r)
    dedup = sorted(seen.values(), key=lambda x: (x["date"] or "0000", -x["score"]), reverse=True)

    tsv = os.path.join(NOTES, "legal_candidates.tsv")
    with open(tsv, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["date", "score", "corpus", "source", "publisher",
                                          "title", "link", "hits", "snippet"], delimiter="\t")
        w.writeheader()
        for r in dedup:
            w.writerow({k: r.get(k, "") for k in w.fieldnames})

    by_month = defaultdict(list)
    for r in dedup:
        by_month[(r["date"] or "undated")[:7]].append(r)
    md = ["# 法律/监管相关条目（按月份，去重后）\n",
          f"来源：sources/index_all.tsv；筛选脚本：scripts/filter_legal.py；条目数：{len(dedup)}\n"]
    for month in sorted(by_month, reverse=True):
        md.append(f"\n## {month} ({len(by_month[month])})\n")
        for r in by_month[month][:60]:
            pub = f" [{r['publisher']}]" if r["publisher"] else ""
            md.append(f"- {r['date']} · s{r['score']} · {r['corpus']}/{r['source']}{pub} — "
                      f"{r['title']}\n  - {r['link']}\n  - {r['snippet'][:220]}\n")
    with open(os.path.join(NOTES, "legal_top.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md))
    print(f"legal items: {len(dedup)} (from {len(rows)} scored rows)", file=sys.stderr)
    print(f"  -> {os.path.relpath(tsv, ROOT)}", file=sys.stderr)
    print(f"  -> notes/legal_top.md", file=sys.stderr)


if __name__ == "__main__":
    main()
