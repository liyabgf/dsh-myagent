#!/usr/bin/env python3
"""Resolve Google News RSS redirect links (news.google.com/rss/articles/<ID>) to publisher URLs.

Method: read the article splash page to obtain data-n-a-sg / data-n-a-ts, then call the
batchexecute endpoint Fbv4je. Prints TSV: ID <TAB> URL  (or ID <TAB> FAIL:<reason>).
Usage: python3 scripts/gnews_decode.py ids.txt
"""
import json, re, subprocess, sys, time, urllib.parse

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

def curl(url, data=None):
    cmd = ["curl", "-sS", "-m", "30", "--compressed", "-A", UA, url]
    if data:
        cmd += ["-H", "Content-Type: application/x-www-form-urlencoded;charset=UTF-8", "--data", data]
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.stdout

def decode(art_id):
    page = curl(f"https://news.google.com/rss/articles/{art_id}")
    sg = re.search(r'data-n-a-sg="([^"]+)"', page)
    ts = re.search(r'data-n-a-ts="([^"]+)"', page)
    if not sg or not ts:
        return None, "no-signature"
    payload = ["garturlreq", [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None,
               None, None, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0], art_id, ts.group(1), sg.group(1)]
    freq = json.dumps([["Fbv4je", json.dumps(payload), None, "generic"]])
    body = "f.req=" + urllib.parse.quote(freq)
    resp = curl("https://news.google.com/_/DotsSplashUi/data/batchexecute", body)
    for line in resp.splitlines():
        line = line.strip().lstrip(")]}'")
        if not line.startswith("["):
            continue
        try:
            arr = json.loads(line)
        except json.JSONDecodeError:
            continue
        for el in arr:
            if isinstance(el, list) and len(el) > 2 and el[0] == "Fbv4je":
                inner = json.loads(el[2])
                if isinstance(inner, list) and len(inner) > 1 and isinstance(inner[1], str):
                    return inner[1], "ok"
    return None, "no-url-in-response"

def main():
    for line in open(sys.argv[1], encoding="utf-8"):
        aid = line.strip()
        if not aid or aid.startswith("#"):
            continue
        url, status = decode(aid)
        print(f"{aid}\t{url or 'FAIL:' + status}", flush=True)
        time.sleep(0.4)

if __name__ == "__main__":
    main()
