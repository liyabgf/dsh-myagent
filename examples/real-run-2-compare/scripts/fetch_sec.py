#!/usr/bin/env python3
"""Stage 2: pull Alphabet's own SEC filings (primary source) into raw/sec + txt.

Downloads the latest 10-K and the last four 10-Qs, the Q3-2026 earnings 8-K and
its EX-99.1, converts them to text, and cuts the "Legal Matters" /
"Antitrust Matters" passages out of each into notes/sec_legal_extracts.md so the
disclosures can be compared period over period.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw", "sec")
TXT = os.path.join(ROOT, "txt")
NOTES = os.path.join(ROOT, "notes")
for d in (RAW, TXT, NOTES):
    os.makedirs(d, exist_ok=True)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from html2txt import convert  # noqa: E402

UA = "Research research@example.com"
CIK = "1652044"
SUB = os.path.join(ROOT, "raw", "sec_submissions_alphabet.json")
MANIFEST = os.path.join(ROOT, "sources", "manifest_stage2_sec.csv")


def curl(url, dest):
    cmd = ["curl", "-sSL", "--compressed", "-m", "120", "-A", UA, "-o", dest,
           "-w", "%{http_code}\t%{size_download}", url]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    code, size = (p.stdout or "\t0").split("\t")[0], (p.stdout or "\t0").split("\t")[-1]
    return code, size


def log(msg):
    print(msg, flush=True)
    with open(os.path.join(ROOT, "notes", "fetch_stage2.log"), "a", encoding="utf-8") as f:
        f.write(msg + "\n")


def load_filings():
    """Return list of (form, filingDate, reportDate, accession, primaryDoc) newest first."""
    with open(SUB, encoding="utf-8") as f:
        data = json.load(f)
    rows = []
    recent = data["filings"]["recent"]
    n = len(recent["form"])
    for i in range(n):
        rows.append((recent["form"][i], recent["filingDate"][i], recent["reportDate"][i],
                     recent["accessionNumber"][i], recent["primaryDocument"][i]))
    for extra in data["filings"].get("files", []):
        url = extra["name"]
        if not url.startswith("http"):
            url = "https://www.sec.gov/Archives/edgar/daily-index/" + url.lstrip("/")
        tmp = os.path.join(RAW, "index_" + os.path.basename(url))
        code, _ = curl(url, tmp)
        if code != "200":
            log(f"  ! older index failed {code} {url}")
            continue
        try:
            with open(tmp, encoding="utf-8") as f:
                od = json.load(f)
        except json.JSONDecodeError:
            continue
        r = od.get("filings", od).get("recent", od.get("filings", {}))
        for i in range(len(r.get("form", []))):
            rows.append((r["form"][i], r["filingDate"][i], r.get("reportDate", [""] * 999)[i],
                         r["accessionNumber"][i], r["primaryDocument"][i]))
    return rows


def doc_url(acc, doc):
    return f"https://www.sec.gov/Archives/edgar/data/{CIK}/{acc.replace('-', '')}/{doc}"


def main():
    rows = load_filings()
    picked = []
    # latest 10-K and last four 10-Qs
    for form, want in (("10-K", 1), ("10-Q", 4)):
        got = 0
        for r in rows:
            if r[0] == form and got < want:
                picked.append(r)
                got += 1
    # Q3-2026 earnings 8-K + exhibit, Nov-2026 bond prospectus
    for r in rows:
        if r[0] == "8-K" and r[1].startswith("2026-10-28"):
            picked.append(r)
        if r[0] == "424B2" and r[1].startswith("2026-11"):
            picked.append(r)
    seen, todo = set(), []
    for r in picked:
        if r[3] in seen:
            continue
        seen.add(r[3])
        todo.append(r)

    man = open(MANIFEST, "a", encoding="utf-8")
    if os.path.getsize(MANIFEST) == 0:
        man.write("form,filing_date,report_date,accession,url,http_code,bytes,local\n")
    for form, fdate, rdate, acc, doc in todo:
        url = doc_url(acc, doc)
        base = f"{form}_{rdate or fdate}_{acc.replace('-', '')}"
        dest = os.path.join(RAW, base + ".htm")
        code, size = curl(url, dest)
        man.write(f"{form},{fdate},{rdate},{acc},{url},{code},{size},raw/sec/{os.path.basename(dest)}\n")
        man.flush()
        log(f"{code:>4} {size:>9} {form} filed {fdate} report {rdate}")
        if code != "200":
            continue
        with open(dest, encoding="utf-8", errors="replace") as f:
            html = f.read()
        text = convert(html)
        tpath = os.path.join(TXT, base + ".txt")
        with open(tpath, "w", encoding="utf-8") as f:
            f.write(text)
        log(f"      -> {os.path.relpath(tpath, ROOT)} ({len(text)} chars)")
        # exhibits for 8-K filings
        if form == "8-K":
            idx = os.path.join(RAW, base + "_index.json")
            c2, _ = curl(f"https://www.sec.gov/Archives/edgar/data/{CIK}/{acc.replace('-', '')}/index.json", idx)
            if c2 == "200":
                with open(idx, encoding="utf-8") as f:
                    items = json.load(f)["directory"]["item"]
                for it in items:
                    nm = it["name"]
                    if nm.endswith(".htm") and nm != doc and ("ex" in nm.lower() or "99" in nm):
                        eurl = f"https://www.sec.gov/Archives/edgar/data/{CIK}/{acc.replace('-', '')}/{nm}"
                        edest = os.path.join(RAW, base + "_" + nm)
                        c3, s3 = curl(eurl, edest)
                        man.write(f"EX,{fdate},{rdate},{acc},{eurl},{c3},{s3},raw/sec/{os.path.basename(edest)}\n")
                        man.flush()
                        if c3 == "200":
                            with open(edest, encoding="utf-8", errors="replace") as f:
                                et = convert(f.read())
                            etp = os.path.join(TXT, base + "_" + nm.replace(".htm", ".txt"))
                            with open(etp, "w", encoding="utf-8") as f:
                                f.write(et)
                            log(f"      exhibit {nm} -> {os.path.relpath(etp, ROOT)} ({len(et)} chars)")
    man.close()

    # --- cut legal passages -------------------------------------------
    out = ["# Alphabet SEC 披露中的法律事项（按申报期对比）\n"]
    pat = re.compile(
        r"(Note \d+\. Commitments and Contingencies.*?)(?=Note \d+\. Stockholders|Note \d+\. [A-Z])",
        re.S)
    for path in sorted(glob_txt := __import__("glob").glob(os.path.join(TXT, "*.txt"))):
        with open(path, encoding="utf-8") as f:
            text = f.read()
        name = os.path.basename(path)
        m = pat.search(text)
        if not m:
            continue
        section = m.group(1)
        keep = section[section.find("Legal Matters"):] if "Legal Matters" in section else section
        out.append(f"\n## {name}\n\n```\n{keep.strip()[:14000]}\n```\n")
    with open(os.path.join(NOTES, "sec_legal_extracts.md"), "w", encoding="utf-8") as f:
        f.write("".join(out))
    log("wrote notes/sec_legal_extracts.md")


if __name__ == "__main__":
    main()
