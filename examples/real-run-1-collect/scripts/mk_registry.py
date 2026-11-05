#!/usr/bin/env python3
"""Build sources/registry.md from sources/manifest.csv.

Columns: name,url,http_code,bytes,content_type,final_url,fetched_at_utc,local_path
Output groups successful captures by registrable domain, with fetch time and local copy path.
"""
import csv, os, re
from collections import defaultdict
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows = list(csv.DictReader(open(os.path.join(BASE, "sources", "manifest.csv"), encoding="utf-8")))

def domain(u):
    h = urlparse(u).netloc.lower()
    return re.sub(r"^www\.", "", h)

ok = [r for r in rows if r["http_code"] == "200" and r["local_path"]]
bad = [r for r in rows if not (r["http_code"] == "200" and r["local_path"])]
by = defaultdict(list)
for r in ok:
    by[domain(r["url"])].append(r)

out = []
out.append("# 信息源登记表 (Source Registry)\n")
out.append(f"抓取工具: `scripts/fetch.py` (curl, UA=Chrome/126 桌面; sec.gov 使用研究用途 UA)。")
out.append(f"每条记录含: 原始 URL、HTTP 状态、字节数、抓取时间(UTC)、本地留档路径。")
out.append(f"成功留档 {len(ok)} 条, 失败/未留档 {len(bad)} 条。\n")
out.append("本地留档位于 `raw/`, 正文纯文本转换位于 `txt/`。所有引文均可据此逐条复核。\n")
out.append("## 一、一手来源 (Primary sources)\n")
prim = ["sec.gov", "blog.google", "deepmind.google", "developers.googleblog.com", "cloud.google.com",
        "waymo.com", "openai.com", "artificialanalysis.ai", "hn.algolia.com"]
seen = set()
for d in prim:
    for r in by.get(d, []):
        seen.add(r["url"])
        out.append(f"- [{r['name']}]({r['url']}) — HTTP {r['http_code']}, {r['bytes']} bytes, "
                   f"fetched {r['fetched_at_utc']}, 留档: `{r['local_path']}`")
out.append("\n## 二、媒体与社区来源 (按域名)\n")
for d in sorted(by):
    if d in prim:
        continue
    out.append(f"### {d} ({len(by[d])})")
    for r in sorted(by[d], key=lambda x: x["fetched_at_utc"], reverse=True):
        out.append(f"- [{r['name']}]({r['url']}) — {r['bytes']}B, {r['fetched_at_utc']}, `{r['local_path']}`")
    out.append("")
if bad:
    out.append("\n## 三、抓取失败或未留档 (记录以备核查)\n")
    for r in bad:
        out.append(f"- {r['name']} — {r['url']} — HTTP {r['http_code']} ({r['fetched_at_utc']})")
open(os.path.join(BASE, "sources", "registry.md"), "w", encoding="utf-8").write("\n".join(out) + "\n")
print(f"wrote sources/registry.md: {len(ok)} ok, {len(bad)} failed, {len(by)} domains")
