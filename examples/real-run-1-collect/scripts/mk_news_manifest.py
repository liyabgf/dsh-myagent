#!/usr/bin/env python3
"""Emit manifest rows (NAME<TAB>URL) for Bing News RSS + Google News RSS queries.

Usage: python3 scripts/mk_news_manifest.py > sources/m3_news.tsv
"""
import urllib.parse

QUERIES = [
    ("alphabet_earnings", '"Alphabet" earnings Q3 2026'),
    ("alphabet_capex", "Alphabet capex data center spending"),
    ("alphabet_bonds", "Alphabet bond sale debt"),
    ("google_search_decline", "Google Search AI Overviews traffic publishers"),
    ("google_search_share", "Google search market share ChatGPT"),
    ("google_ads", "Google advertising revenue AI Mode ads"),
    ("gemini", "Gemini Google app users"),
    ("gemini4", '"Gemini 4"'),
    ("antigravity", "Google Antigravity IDE"),
    ("deepmind_talent", "Google DeepMind researcher leaves poached"),
    ("google_cloud", "Google Cloud revenue backlog TPU"),
    ("tpu", "Google TPU Anthropic Meta"),
    ("youtube", "YouTube revenue TV advertising"),
    ("waymo", "Waymo expansion robotaxi"),
    ("android_pixel", "Pixel 11 Android 17"),
    ("chromeos", "Google Android ChromeOS merge"),
    ("googlebook", "Googlebook Google laptop"),
    ("layoffs", "Google layoffs restructuring 2026"),
    ("union", "Alphabet Workers Union Google employees"),
    ("antitrust_us", "Google antitrust remedy appeal Chrome divestiture"),
    ("adtech", "Google ad tech case ruling break up"),
    ("eu_dma", "Google EU DMA fine European Commission"),
    ("copyright", "Google AI copyright lawsuit authors ruling"),
    ("privacy", "Google privacy lawsuit settlement data"),
    ("india", "Google India CCI antitrust Android"),
    ("energy", "Google data center electricity utility bills"),
    ("suncatcher", "Google Project Suncatcher satellite TPU"),
    ("pichai", "Sundar Pichai interview"),
    ("gemini_schools", "Google schools AI Search disable"),
    ("other_bets", "Alphabet Other Bets Verily Wing Isomorphic"),
]

def row(name, url):
    print(f"{name}\t{url}")

for slug, q in QUERIES:
    qq = urllib.parse.quote_plus(q)
    row(f"bing_{slug}", f"https://www.bing.com/news/search?q={qq}&format=rss&setlang=en-US&cc=US")
    row(f"gn_{slug}", "https://news.google.com/rss/search?q=" +
        urllib.parse.quote_plus(q + " when:45d") + "&hl=en-US&gl=US&ceid=US:en")
