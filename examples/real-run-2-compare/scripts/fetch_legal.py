#!/usr/bin/env python3
"""Stage 1 fetcher for Ticket 信息比对 (19dd5c9c).

Pulls primary/official sources and news-aggregate feeds about legal matters
facing Google / Alphabet into raw/, logging every attempt in
sources/manifest_stage1.csv.  Uses curl (system trust store) because python
urllib fails certificate verification on this host.  Writes only inside the
ticket directory.
"""
import csv
import os
import subprocess
import sys
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
SRC = os.path.join(ROOT, "sources")
MANIFEST = os.path.join(SRC, "manifest_stage1.csv")
os.makedirs(RAW, exist_ok=True)
os.makedirs(SRC, exist_ok=True)

SEC_UA = "LegalResearch research-agent/1.0 (contact: none) python-curl"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

GNEWS = "https://news.google.com/rss/search?q={q}&hl={hl}&gl={gl}&ceid={ceid}"

# (name, query text, window, locale)
QUERIES = [
    ("gn_antitrust", "Google antitrust", "90d", "en"),
    ("gn_search_monopoly_remedies", "Google search monopoly remedies Mehta", "240d", "en"),
    ("gn_adtech", "Google ad tech ruling remedy", "240d", "en"),
    ("gn_doj", "Justice Department Google lawsuit", "150d", "en"),
    ("gn_epic_play", "Epic Games Google Play ruling", "240d", "en"),
    ("gn_chrome_divestiture", "Google Chrome divestiture", "300d", "en"),
    ("gn_default_deals", "Google Apple default search deal antitrust", "240d", "en"),
    ("gn_eu_dma", "Google Digital Markets Act", "150d", "en"),
    ("gn_eu_fine", "European Commission Google fine", "300d", "en"),
    ("gn_eu_general_court", "General Court Google judgment", "300d", "en"),
    ("gn_uk_cma", "Google CMA strategic market status", "300d", "en"),
    ("gn_india_cci", "Google Competition Commission India order", "300d", "en"),
    ("gn_korea_kftc", "Google Korea KFTC fine", "300d", "en"),
    ("gn_states_ag", "Google state attorneys general lawsuit settlement", "300d", "en"),
    ("gn_privacy_settlement", "Google privacy settlement", "240d", "en"),
    ("gn_play_settlement", "Google Play antitrust settlement payout", "300d", "en"),
    ("gn_ai_copyright", "Google AI copyright lawsuit", "240d", "en"),
    ("gn_gemini_lawsuit", "Gemini lawsuit Google", "240d", "en"),
    ("gn_authors_publishers", "authors publishers sue Google Gemini training data", "300d", "en"),
    ("gn_youtube", "YouTube lawsuit antitrust creators", "240d", "en"),
    ("gn_waymo", "Waymo lawsuit investigation recall", "240d", "en"),
    ("gn_appeals", "Google appeal circuit court antitrust", "240d", "en"),
    ("gn_labor", "Google NLRB labor lawsuit union", "300d", "en"),
    ("gn_news_code", "Google news bargaining code Canada Australia", "300d", "en"),
    ("gn_consumer_fraud", "Google consumer protection fine attorney general", "300d", "en"),
    ("gn_zh_fanlongduan", "谷歌 反垄断 判决", "240d", "zh"),
    ("gn_zh_susong", "谷歌 诉讼 罚款", "240d", "zh"),
    ("gn_alphabet_legal", "Alphabet legal proceedings antitrust risk", "90d", "en"),
    ("gn_legal_press", "Google antitrust ruling court", "30d", "en"),
]

FIXED = [
    # --- SEC / EDGAR primary filings ------------------------------------
    ("sec_submissions_alphabet",
     "https://data.sec.gov/submissions/CIK0001652044.json", SEC_UA),
    ("sec_fts_antitrust_alphabet",
     "https://efts.sec.gov/LATEST/search-index?q=%22antitrust%22&ciks=0001652044", SEC_UA),
    ("sec_fts_legal_proceedings_alphabet",
     "https://efts.sec.gov/LATEST/search-index?q=%22legal+proceedings%22&ciks=0001652044", SEC_UA),
    ("sec_fts_alphabet_forms",
     "https://efts.sec.gov/LATEST/search-index?q=%22contingencies%22&ciks=0001652044", SEC_UA),
    # --- UK regulators ---------------------------------------------------
    ("uk_cma_google_news",
     "https://www.gov.uk/search/news-and-communications.json?"
     "keywords=google&organisations%5B%5D=competition-and-markets-authority"
     "&order=updated-newest&count=100", BROWSER_UA),
    ("uk_cma_google_all",
     "https://www.gov.uk/search/all.json?keywords=google&"
     "organisations%5B%5D=competition-and-markets-authority&order=updated-newest&count=100",
     BROWSER_UA),
    ("uk_ofcom_google",
     "https://www.gov.uk/search/news-and-communications.json?keywords=google"
     "&organisations%5B%5D=ofcom&order=updated-newest&count=60", BROWSER_UA),
    ("uk_ico_google",
     "https://www.gov.uk/search/news-and-communications.json?keywords=google"
     "&organisations%5B%5D=information-commissioner-s-office&order=updated-newest&count=60",
     BROWSER_UA),
    # --- European Commission --------------------------------------------
    ("eu_presscorner_google",
     "https://ec.europa.eu/commission/presscorner/api/search?text=google&language=en&pageSize=40",
     BROWSER_UA),
    ("eu_presscorner_dma",
     "https://ec.europa.eu/commission/presscorner/api/search?text=digital%20markets%20act"
     "&language=en&pageSize=40", BROWSER_UA),
    ("eu_presscorner_google_adtech",
     "https://ec.europa.eu/commission/presscorner/api/search?text=google%20advertising%20technology"
     "&language=en&pageSize=40", BROWSER_UA),
    ("eu_presscorner_google_search",
     "https://ec.europa.eu/commission/presscorner/api/search?text=google%20search"
     "&language=en&pageSize=40", BROWSER_UA),
    ("eu_dma_enforcement_page",
     "https://digital-markets-act.ec.europa.eu/enforcement_en", BROWSER_UA),
    ("eu_dma_gatekeepers_page",
     "https://digital-markets-act.ec.europa.eu/gatekeepers_en", BROWSER_UA),
    ("eu_competition_cases",
     "https://competition-cases.ec.europa.eu/search?text=google&type=case", BROWSER_UA),
    # --- US DOJ / FTC ----------------------------------------------------
    ("doj_atr_google_search_case",
     "https://www.justice.gov/atr/case/us-and-plaintiff-states-v-google-llc", BROWSER_UA),
    ("doj_atr_google_adtech_case",
     "https://www.justice.gov/atr/case/united-states-v-google-llc-0", BROWSER_UA),
    ("doj_atr_case_listing",
     "https://www.justice.gov/atr/cases?f%5B0%5D=case_type%3Aantitrust&title=google", BROWSER_UA),
    ("doj_opa_google",
     "https://www.justice.gov/opa/pr?title=google", BROWSER_UA),
    ("doj_atr_press",
     "https://www.justice.gov/atr/pr?title=google", BROWSER_UA),
    ("ftc_google_search",
     "https://www.ftc.gov/search?keys=google&page=0", BROWSER_UA),
    ("ftc_cases",
     "https://www.ftc.gov/legal-library/browse/cases-proceedings?search=google", BROWSER_UA),
    # --- Other regulators / AGs -----------------------------------------
    ("accc_media_releases_google",
     "https://www.accc.gov.au/media-centre/media-releases?search_api_fulltext=google",
     BROWSER_UA),
    ("texas_ag_google",
     "https://www.texasattorneygeneral.gov/news/releases?search=google", BROWSER_UA),
    ("cal_ag_google",
     "https://oag.ca.gov/news/press-releases?keys=google", BROWSER_UA),
    ("ny_ag_google",
     "https://ag.ny.gov/press-release?search=google", BROWSER_UA),
    ("cci_press_releases",
     "https://www.cci.gov.in/media-corner/press-releases", BROWSER_UA),
    ("kftc_english_news",
     "https://www.ftc.go.kr/eng/bbs/list.do?menu_no=6&bbs_no=9&searchCnd=1&searchWrd=google",
     BROWSER_UA),
    ("japan_jftc",
     "https://www.jftc.go.jp/en/pressrelease/index.html", BROWSER_UA),
    ("canada_online_news_act",
     "https://ised-isde.canada.ca/site/online-news-act/en", BROWSER_UA),
    # --- Case reference (Wikipedia API, plain-text extracts) -------------
    ("wp_us_v_google_2020",
     "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json"
     "&redirects=1&titles=United%20States%20v.%20Google%20LLC%20(2020)", BROWSER_UA),
    ("wp_us_v_google_2023",
     "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json"
     "&redirects=1&titles=United%20States%20v.%20Google%20LLC%20(2023)", BROWSER_UA),
    ("wp_epic_v_google",
     "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json"
     "&redirects=1&titles=Epic%20Games%2C%20Inc.%20v.%20Google%20LLC", BROWSER_UA),
    ("wp_google_v_eu_commission",
     "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json"
     "&redirects=1&titles=Google%20LLC%20v%20European%20Commission", BROWSER_UA),
    ("wp_digital_markets_act",
     "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json"
     "&redirects=1&titles=Digital%20Markets%20Act", BROWSER_UA),
    ("wp_search_google_litigation",
     "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=Google%20antitrust"
     "%20litigation&srlimit=30&format=json", BROWSER_UA),
    ("wp_search_google_privacy",
     "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=Google%20privacy"
     "%20lawsuit%20settlement&srlimit=30&format=json", BROWSER_UA),
    ("wp_search_ai_copyright",
     "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=artificial"
     "%20intelligence%20training%20copyright%20lawsuit&srlimit=30&format=json", BROWSER_UA),
    ("wp_google_lawsuits_list",
     "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=List%20of%20lawsuits"
     "%20involving%20Google&srlimit=10&format=json", BROWSER_UA),
    # --- Legal / tech press ---------------------------------------------
    ("arstechnica_google_tag",
     "https://arstechnica.com/tag/google/", BROWSER_UA),
    ("arstechnica_feed",
     "https://feeds.arstechnica.com/arstechnica/index", BROWSER_UA),
    ("theregister_google_search",
     "https://search.theregister.com/?q=google+antitrust", BROWSER_UA),
    ("theregister_legal_feed",
     "https://www.theregister.com/security/legal/headlines.atom", BROWSER_UA),
    ("justia_google_dockets",
     "https://dockets.justia.com/search?query=google+antitrust", BROWSER_UA),
    ("govinfo_google_hearings",
     "https://www.govinfo.gov/app/search/%7B%22query%22%3A%22google%20antitrust%22%7D",
     BROWSER_UA),
    ("congress_search_google",
     "https://www.congress.gov/search?q=%7B%22query%22%3A%22google%20antitrust%22%7D",
     BROWSER_UA),
    ("bing_gnews_legal",
     "https://www.bing.com/news/search?q=Google+lawsuit+antitrust&format=rss", BROWSER_UA),
]


def build_query_urls():
    out = []
    for name, q, window, loc in QUERIES:
        if loc == "zh":
            url = GNEWS.format(q=urllib.parse.quote(q + " when:" + window),
                               hl="zh-CN", gl="CN", ceid="CN:zh-Hans")
        else:
            url = GNEWS.format(q=urllib.parse.quote(q + " when:" + window),
                               hl="en-US", gl="US", ceid="US:en")
        out.append((name, url, BROWSER_UA))
    return out


def ext_for(url, body):
    if isinstance(body, (bytes, bytearray)):
        body = body.decode("utf-8", "replace")
    head = body[:600].lstrip().lower()
    low = url.lower()
    if head.startswith("<?xml") or "<rss" in head or "<feed" in head:
        return ".xml"
    if head.startswith("{") or head.startswith("[") or low.endswith(".json"):
        return ".json"
    if "<html" in head or "<!doctype" in head:
        return ".html"
    return ".bin"


def fetch(name, url, ua):
    out_path = None
    for attempt in (1, 2):
        tmp = os.path.join(RAW, name + ".part")
        cmd = [
            "curl", "-sSL", "--compressed", "-m", "60",
            "-A", ua,
            "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
            "-H", "Accept-Language: en-US,en;q=0.9,zh-CN;q=0.8",
            "-w", "%{http_code}\\t%{size_download}\\t%{content_type}\\t%{url_effective}",
            "-o", tmp, url,
        ]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        except subprocess.TimeoutExpired:
            if attempt == 1:
                continue
            return (name, url, "timeout", 0, "", url, "", "curl timeout")
        meta = (p.stdout or "").strip().split("\t")
        code = meta[0] if meta else "000"
        nbytes = int(meta[1]) if len(meta) > 1 and meta[1].isdigit() else 0
        ctype = meta[2] if len(meta) > 2 else ""
        final = meta[3] if len(meta) > 3 else url
        body = b""
        if os.path.exists(tmp):
            with open(tmp, "rb") as f:
                body = f.read()
        if code == "200" and body:
            ext = ext_for(url, body)
            rel = os.path.join("raw", name + ext)
            os.replace(tmp, os.path.join(ROOT, rel))
            if os.path.exists(tmp):
                os.remove(tmp)
            return (name, url, code, len(body), ctype, final, rel, "")
        if os.path.exists(tmp):
            os.remove(tmp)
        if attempt == 1 and code in ("000", "429", "500", "502", "503"):
            time.sleep(2)
            continue
        err = (p.stderr or "").strip().replace("\n", " ")[:200]
        return (name, url, code, nbytes, ctype, final, "", err or f"http {code}")
    return (name, url, "err", 0, "", url, "", "unreachable")


def main():
    jobs = FIXED + build_query_urls()
    hdr = ["name", "url", "http_code", "bytes", "content_type", "final_url",
           "local_path", "fetched_at_utc", "error"]
    new = not os.path.exists(MANIFEST)
    ok = 0
    with open(MANIFEST, "a", newline="", encoding="utf-8") as mf:
        w = csv.writer(mf)
        if new:
            w.writerow(hdr)
        for name, url, ua in jobs:
            row = fetch(name, url, ua)
            w.writerow(list(row[:7]) + [time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), row[7]])
            mf.flush()
            if str(row[2]) == "200":
                ok += 1
            print(f"{str(row[2]):>7} {row[3]:>8} {name:<38} {row[7][:80]}", flush=True)
            time.sleep(0.4)
    print(f"\nfetched {ok}/{len(jobs)} OK", flush=True)


if __name__ == "__main__":
    main()
