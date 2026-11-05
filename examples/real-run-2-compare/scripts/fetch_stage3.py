#!/usr/bin/env python3
"""Stage 3: targeted primary-document collection.

Parts:
  uk      - CMA / gov.uk news pages about Google (SMS designations, conduct
            requirements, mobile platforms consultation, commitments)
  eu      - European Commission presscorner document details + extra searches
  doj     - DOJ ATR case documents (final judgment, opinion, appellate briefs,
            compliance reports) as PDF + extracted text via vendor/pypdf
  news    - extra Google News / Bing News queries for gaps (youth safety, AI
            copyright, India, Korea, Japan, Brazil, DSA, tax, securities)

Writes raw/<part>/..., txt/<part>/..., sources/manifest_stage3.csv.
"""
import csv
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, os.path.join(ROOT, "vendor"))
from html2txt import convert  # noqa: E402

MANIFEST = os.path.join(ROOT, "sources", "manifest_stage3.csv")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)

UK_PAGES = [
    "cma-confirms-google-has-strategic-market-status-in-search-services",
    "cma-confirms-apple-and-google-have-strategic-market-status-in-mobile-platforms",
    "cma-proposes-package-of-measures-to-improve-google-search-services-in-uk",
    "cma-secures-fairer-deal-for-publishers-and-improves-google-search-services-in-uk",
    "further-cma-action-to-secure-a-fairer-deal-for-businesses-and-improve-google-search",
    "cma-strengthens-proposals-allowing-people-choice-over-their-search-service",
    "cma-consults-on-new-requirements-for-apple-and-googles-mobile-platforms",
    "cma-secures-commitments-from-apple-and-google-to-improve-fairness-in-app-store-processes-and-enhance-ios-interoperability",
    "cma-proposes-action-to-drive-more-competition-on-mobile-platforms",
    "cma-takes-first-steps-to-ensure-choice-in-business-software",
]

EU_REFS = [
    "IP/26/1670",   # DMA fines EUR 890m (Play + Search), 2026-07-23
    "IP/26/1634",   # guidance: AI interoperability Android + Search data, 2026-07-16
    "IP/26/887",    # feedback on Android interoperability measures, 2026-04-27
    "IP/26/825",    # proposals on search data sharing, 2026-04-16
    "IP/26/333",    # Wiz acquisition approved, 2026-02-10
    "IP/26/202",    # proceedings to assist compliance, 2026-01-27
    "IP/25/2964",   # investigation: anticompetitive conduct online ..., 2025-12-09
    "IP/25/2675",   # DMA investigation: demoting media websites, 2025-11-13
    "IP/25/1992",   # ad tech fine EUR 2.95bn, 2025-09-05
    "STATEMENT/25/2034",
    "SPEECH/25/2460",
    "IP/25/811",    # preliminary findings DMA, 2025-03-19
]
EU_SEARCHES = [
    "Google Android judgment Court of Justice",
    "Google Digital Services Act",
    "Google Wiz",
    "Google Shopping damages",
    "Google artificial intelligence regulation",
    "Google tax ruling",
]

DOJ_DOCS = [
    ("search_final_judgment_2025-12-05", "https://www.justice.gov/atr/media/1421546/dl?inline"),
    ("search_memorandum_opinion_2025-12-05", "https://www.justice.gov/atr/media/1421681/dl?inline"),
    ("search_us_reply_brief_cross_appeal_2026-10-29", "https://www.justice.gov/atr/media/1469586/dl?inline"),
    ("search_us_opening_brief_cross_appeal_2026-10-21", "https://www.justice.gov/atr/media/1454586/dl?inline"),
    ("search_plaintiffs_2nd_compliance_report_2026-09-17", "https://www.justice.gov/atr/media/1461926/dl?inline"),
    ("search_plaintiffs_1st_compliance_report_2026-05-04", "https://www.justice.gov/atr/media/1439461/dl?inline"),
    ("search_order_2026-08-25_status_conference", "https://www.justice.gov/atr/media/1459051/dl?inline"),
    ("search_syndication_recommendation_2026-10-13", "https://www.justice.gov/atr/media/1466831/dl?inline"),
    ("search_syndication_recommendation_full_2026-10-13", "https://www.justice.gov/atr/media/1466841/dl?inline"),
    ("search_joint_status_report_2026-10-14", "https://www.justice.gov/atr/media/1458106/dl?inline"),
    ("search_joint_status_report_2026-09-30", "https://www.justice.gov/atr/media/1456686/dl?inline"),
    ("search_order_2026-05-29", "https://www.justice.gov/atr/media/1443466/dl?inline"),
]
DOJ_PAGES = [
    ("doj_atr_cases_google", "https://www.justice.gov/atr/cases?title=google"),
    ("doj_atr_adtech_candidate1", "https://www.justice.gov/atr/case/united-states-and-plaintiff-states-v-google-llc"),
    ("doj_atr_adtech_candidate2", "https://www.justice.gov/atr/case/us-v-google-llc"),
    ("doj_atr_adtech_candidate3", "https://www.justice.gov/atr/case/google-ad-technology"),
    ("doj_atr_adtech_candidate4", "https://www.justice.gov/atr/case/united-states-v-google-llc"),
    ("doj_atr_digital_platforms", "https://www.justice.gov/atr/digital-platforms"),
]

NEWS_QUERIES = [
    ("gn3_youth_safety", "Google YouTube social media addiction youth trial", "240d", "en"),
    ("gn3_ai_defamation", "Google AI Overviews defamation lawsuit", "240d", "en"),
    ("gn3_ai_copyright_gemini", "Gemini copyright lawsuit authors training data Google", "240d", "en"),
    ("gn3_india", "Google India antitrust order penalty 2026", "300d", "en"),
    ("gn3_korea", "Google Korea fine regulator 2026", "300d", "en"),
    ("gn3_japan", "Google Japan smartphone software competition act", "300d", "en"),
    ("gn3_brazil", "Google Brazil Cade antitrust", "300d", "en"),
    ("gn3_australia", "Google Australia ACCC digital platform regulation", "300d", "en"),
    ("gn3_canada", "Google Canada Online News Act competition", "300d", "en"),
    ("gn3_dsa", "Google Search Digital Services Act investigation European Commission", "300d", "en"),
    ("gn3_ai_act", "Google AI Act compliance European Union", "300d", "en"),
    ("gn3_tax", "Google tax dispute Italy France Spain assessment", "300d", "en"),
    ("gn3_securities", "Alphabet securities class action shareholders antitrust disclosure", "300d", "en"),
    ("gn3_waymo", "Waymo NHTSA investigation crash lawsuit", "300d", "en"),
    ("gn3_pricerunner", "PriceRunner Google damages Sweden", "300d", "en"),
    ("gn3_chrome_appeal", "Google Chrome appeal DC Circuit remedies", "300d", "en"),
    ("gn3_adtech_edva", "Google ad tech Virginia court remedies decision 2026", "300d", "en"),
    ("gn3_texas_adtech", "Google Texas ad tech trial state attorneys general", "300d", "en"),
    ("gn3_epic_compliance", "Google Play Epic injunction compliance billing", "300d", "en"),
    ("gn3_wiz", "Google Wiz acquisition antitrust approval", "300d", "en"),
    ("gn3_labor", "Google Alphabet Workers Union NLRB complaint 2026", "300d", "en"),
    ("gn3_privacy_tx", "Google Texas privacy settlement biometric", "300d", "en"),
    ("gn3_incognito", "Google incognito tracking lawsuit settlement", "300d", "en"),
    ("gn3_publisher", "publishers Google AI Overviews traffic lawsuit", "240d", "en"),
    ("gn3_zh_eu", "谷歌 欧盟 罚款 数字市场法", "300d", "zh"),
    ("gn3_zh_adtech", "谷歌 广告技术 判决 拆分", "300d", "zh"),
    ("bing3_adtech_remedy", "https://www.bing.com/news/search?q=Google+ad+tech+remedies+decision+Virginia&format=rss&setlang=en-US&cc=US", None, None),
    ("bing3_dma_fine", "https://www.bing.com/news/search?q=Google+DMA+fine+890+million&format=rss&setlang=en-US&cc=US", None, None),
    ("bing3_ecj_android", "https://www.bing.com/news/search?q=Google+Android+ECJ+4.1+billion+judgment&format=rss&setlang=en-US&cc=US", None, None),
    ("bing3_scotus", "https://www.bing.com/news/search?q=Google+Supreme+Court+certiorari+antitrust&format=rss&setlang=en-US&cc=US", None, None),
    ("bing3_youth", "https://www.bing.com/news/search?q=Google+YouTube+social+media+youth+trial+lawsuit&format=rss&setlang=en-US&cc=US", None, None),
]


def curl(url, dest, timeout=90):
    cmd = ["curl", "-sSL", "--compressed", "-m", str(timeout), "-A", UA,
           "-H", "Accept: */*", "-o", dest,
           "-w", "%{http_code}\t%{size_download}\t%{content_type}", url]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 30)
    except subprocess.TimeoutExpired:
        return "timeout", 0, ""
    parts = (p.stdout or "").split("\t")
    code = parts[0] if parts else "000"
    size = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
    ctype = parts[2] if len(parts) > 2 else ""
    return code, size, ctype


def log(man, name, url, code, size, local, note=""):
    man.writerow([name, url, code, size, local, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), note])
    MF.flush()
    print(f"{code:>7} {size:>9} {name:<52} {note[:60]}", flush=True)


def part_uk(man):
    d = os.path.join(ROOT, "raw", "uk")
    t = os.path.join(ROOT, "txt", "uk")
    os.makedirs(d, exist_ok=True)
    os.makedirs(t, exist_ok=True)
    for slug in UK_PAGES:
        url = f"https://www.gov.uk/government/news/{slug}"
        dest = os.path.join(d, slug + ".html")
        code, size, _ = curl(url, dest)
        if code != "200":
            url = f"https://www.gov.uk/government/speeches/{slug}"
            code, size, _ = curl(url, dest)
        note = ""
        if code == "200":
            with open(dest, encoding="utf-8", errors="replace") as f:
                text = convert(f.read())
            with open(os.path.join(t, slug + ".txt"), "w", encoding="utf-8") as f:
                f.write(text)
            m = re.search(r"(Published|Last updated)\s*\n?\s*([0-9]{1,2} \w+ [0-9]{4})", text)
            note = m.group(0).replace("\n", " ") if m else ""
        log(man, "uk_" + slug, url, code, size, f"raw/uk/{slug}.html", note)
        time.sleep(0.3)


def part_eu(man):
    d = os.path.join(ROOT, "raw", "eu")
    t = os.path.join(ROOT, "txt", "eu")
    os.makedirs(d, exist_ok=True)
    os.makedirs(t, exist_ok=True)
    for ref in EU_REFS:
        name = "eu_" + ref.replace("/", "_")
        url = ("https://ec.europa.eu/commission/presscorner/api/documents?reference="
               + urllib.parse.quote(ref) + "&language=en")
        dest = os.path.join(d, name + ".json")
        code, size, _ = curl(url, dest)
        note = ""
        if code == "200":
            try:
                data = json.load(open(dest, encoding="utf-8"))
                res = data.get("docuLanguageResource") or {}
                body = convert(res.get("htmlContent", "") or "")
                title = res.get("title", "")
                with open(os.path.join(t, name + ".txt"), "w", encoding="utf-8") as f:
                    f.write(f"# {title}\nref={ref}\n\n{body}\n")
                note = f"{data.get('eventDate', '')} {title[:60]}"
            except Exception as exc:  # noqa: BLE001
                note = f"parse error: {exc}"
        log(man, name, url, code, size, f"raw/eu/{name}.json", note)
        time.sleep(0.3)
    for q in EU_SEARCHES:
        name = "eu_search_" + re.sub(r"[^a-z0-9]+", "_", q.lower())[:40]
        url = ("https://ec.europa.eu/commission/presscorner/api/search?text="
               + urllib.parse.quote(q) + "&language=en&pageSize=30")
        dest = os.path.join(d, name + ".json")
        code, size, _ = curl(url, dest)
        note = ""
        if code == "200":
            try:
                data = json.load(open(dest, encoding="utf-8"))
                items = data.get("docuLanguageListResources") or []
                note = f"total={data.get('totalNumber')} n={len(items)} | " + " ; ".join(
                    f"{i.get('eventDate')} {i.get('refCode')}" for i in items[:6])
            except Exception:
                pass
        log(man, name, url, code, size, f"raw/eu/{name}.json", note)
        time.sleep(0.3)


def pdf_text(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    try:
        r = PdfReader(path)
        return "\n".join((pg.extract_text() or "") for pg in r.pages)
    except Exception:
        return None


def part_doj(man):
    d = os.path.join(ROOT, "raw", "doj")
    t = os.path.join(ROOT, "txt", "doj")
    os.makedirs(d, exist_ok=True)
    os.makedirs(t, exist_ok=True)
    for name, url in DOJ_PAGES:
        dest = os.path.join(d, name + ".html")
        code, size, _ = curl(url, dest)
        if code == "200" and size > 4000:
            with open(dest, encoding="utf-8", errors="replace") as f:
                text = convert(f.read())
            with open(os.path.join(t, name + ".txt"), "w", encoding="utf-8") as f:
                f.write(text)
        log(man, name, url, code, size, f"raw/doj/{name}.html")
        time.sleep(0.3)
    for name, url in DOJ_DOCS:
        dest = os.path.join(d, name + ".pdf")
        code, size, ctype = curl(url, dest, timeout=120)
        note = ctype[:40]
        if code == "200" and size > 1000:
            txt = pdf_text(dest)
            if txt is None:
                note += " | pypdf unavailable"
            else:
                tp = os.path.join(t, name + ".txt")
                with open(tp, "w", encoding="utf-8") as f:
                    f.write(txt)
                note += f" | text {len(txt)} chars"
        log(man, name, url, code, size, f"raw/doj/{name}.pdf", note)
        time.sleep(0.4)


def part_news(man):
    d = os.path.join(ROOT, "raw", "news3")
    os.makedirs(d, exist_ok=True)
    for entry in NEWS_QUERIES:
        name = entry[0]
        if entry[2] is None:
            url = entry[1]
        else:
            q, window, loc = entry[1], entry[2], entry[3]
            if loc == "zh":
                url = ("https://news.google.com/rss/search?q="
                       + urllib.parse.quote(q + " when:" + window)
                       + "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans")
            else:
                url = ("https://news.google.com/rss/search?q="
                       + urllib.parse.quote(q + " when:" + window)
                       + "&hl=en-US&gl=US&ceid=US:en")
        dest = os.path.join(d, name + ".xml")
        code, size, _ = curl(url, dest)
        log(man, name, url, code, size, f"raw/news3/{name}.xml")
        time.sleep(0.4)


def main():
    global MF
    parts = sys.argv[1:] or ["uk", "eu", "doj", "news"]
    new = not os.path.exists(MANIFEST)
    with open(MANIFEST, "a", newline="", encoding="utf-8") as mf:
        MF = mf
        man = csv.writer(mf)
        if new:
            man.writerow(["name", "url", "http_code", "bytes", "local_path", "fetched_at_utc", "note"])
        if "uk" in parts:
            part_uk(man)
        if "eu" in parts:
            part_eu(man)
        if "doj" in parts:
            part_doj(man)
        if "news" in parts:
            part_news(man)


if __name__ == "__main__":
    main()
