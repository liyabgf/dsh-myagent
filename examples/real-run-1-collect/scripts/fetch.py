#!/usr/bin/env python3
"""Fetch a list of URLs, save raw bodies, append rows to sources/manifest.csv.

Usage: python3 scripts/fetch.py manifest.tsv
manifest.tsv lines: NAME<TAB>URL   ('#' comments allowed)
"""
import csv, os, re, subprocess, sys, time, urllib.parse

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "raw")
MAN = os.path.join(BASE, "sources", "manifest.csv")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
os.makedirs(RAW, exist_ok=True)
os.makedirs(os.path.dirname(MAN), exist_ok=True)

new = not os.path.exists(MAN)
fh = open(MAN, "a", newline="", encoding="utf-8")
w = csv.writer(fh)
if new:
    w.writerow(["name", "url", "http_code", "bytes", "content_type", "final_url", "fetched_at_utc", "local_path"])

def slug(name):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:120]

SEC_UA = "Independent research alice.research@example.com"

def fetch(name, url):
    path_guess = os.path.join(RAW, slug(name))
    ua = SEC_UA if "sec.gov" in urllib.parse.urlparse(url).netloc else UA
    cmd = ["curl", "-sS", "-L", "-m", "45", "--compressed", "-A", ua,
           "-H", "Accept-Language: en-US,en;q=0.9",
           "-o", path_guess, "-w", "%{http_code}\t%{size_download}\t%{content_type}\t%{url_effective}", url]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=70)
    except subprocess.TimeoutExpired:
        return [name, url, "TIMEOUT", 0, "", url, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), ""]
    out = p.stdout.strip().split("\t")
    code = out[0] if out else "ERR"
    size = out[1] if len(out) > 1 else "0"
    ctype = out[2] if len(out) > 2 else ""
    final = out[3] if len(out) > 3 else url
    ext = ".html"
    c = (ctype or "").lower()
    if "xml" in c or url.endswith(".xml"):
        ext = ".xml"
    elif "json" in c:
        ext = ".json"
    elif "rss" in c:
        ext = ".xml"
    if code.startswith("2") and size and int(size) > 0:
        os.replace(path_guess, path_guess + ext)
        local = os.path.relpath(path_guess + ext, BASE)
    else:
        try:
            os.remove(path_guess)
        except OSError:
            pass
        local = ""
    row = [name, url, code, size, ctype, final, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), local]
    w.writerow(row); fh.flush()
    print(f"{code}\t{size}\t{name}\t{local}", file=sys.stderr)
    return row

def main():
    for line in open(sys.argv[1], encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        fetch(parts[0], parts[1])

if __name__ == "__main__":
    main()
