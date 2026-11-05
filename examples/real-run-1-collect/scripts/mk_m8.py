#!/usr/bin/env python3
"""Build manifest m8: selected articles by title fragment + gap-filling Bing queries."""
import urllib.parse

FRAGS = [
    "Google value plunges by $500bn",
    "Google confirms Gemini models hacked three companies",
    "Google Just Put 1 Executive in Charge of Gemini",
    "YouTube now requires creators to have twice as many watch hours",
    "Google Cloud power event knocks out UK banks",
    "Europe's Financial Regulators Query Google Over Cloud Outage",
    "Alphabet's CFO signals AI spending could top $300 billion",
    "Alphabet Raised $41 Billion in One Quarter",
    "AI buildout hits snag as Google and Microsoft",
    "Googlebook officially launched: Price, specifications",
    "Googlebook Launches at $899",
    "Waymo to end exclusive Uber robotaxi tie-up",
    "Google's AI Exposure Exceeds the $1 Trillion",
    "Waymo co-CEO addresses scrapped Uber deal",
    "Alphabet sinks 10% as it holds 2026 capex unchanged",
    "Google Should Relax Ad Tech Rules, Appoint Antitrust Monitor",
    "Alphabet's October wipeout hits $758 billion",
    "Google expands AI Search ads globally",
    "Alphabet kicks off €6 billion bond sale",
    "Unions gain access to thousands of Google workers",
    "Google DeepMind Safety Researcher Quits Over AI Existential Risk",
    "Alphabet's Revenue Rises 25% as Profit Falls",
]

QUERIES = [
    ("spacex_writedown", "Alphabet SpaceX writedown third quarter 2026"),
    ("isomorphic_funding", "Isomorphic Labs funding valuation 2026"),
    ("deepmind_nda2", "DeepMind researchers NDA ban speaking publicly protest"),
    ("waymo_uber", "Waymo Uber exclusive partnership ends Austin Atlanta"),
    ("gfiber_sale", "Google Fiber sale buyer 2026"),
    ("french_publishers", "French newspapers Google AI Overviews complaint competition authority"),
    ("publishers_paid", "Google paying publishers AI Overviews licensing"),
    ("capex_2027", "Alphabet 2027 capital expenditures increase guidance"),
    ("cloud_capacity", "Google Cloud capacity constrained 2027 Kurian"),
    ("ai_mode_ads", "Google AI Mode ads expansion countries advertisers"),
    ("waymo_overseas", "Waymo overseas expansion cash burning CNBC"),
    ("search_data_sharing", "Google search data sharing syndication remedies compliance"),
]

rows = [l.rstrip("\n").split("\t") for l in open("digests/news_digest.tsv", encoding="utf-8")]
seen = set()
for frag in FRAGS:
    for r in rows:
        if len(r) < 6 or not r[2].startswith("bing"):
            continue
        if frag.lower() in r[4].lower() and r[5].startswith("http") and r[5] not in seen:
            seen.add(r[5])
            slug = "art8_" + frag.replace(" ", "_")[:38]
            for ch in "'\"?,$€:;/":
                slug = slug.replace(ch, "")
            print(f"{slug}\t{r[5]}")
            break
    else:
        print(f"# MISS\t{frag}")

for slug, q in QUERIES:
    print(f"bing4_{slug}\thttps://www.bing.com/news/search?q={urllib.parse.quote_plus(q)}&format=rss&setlang=en-US&cc=US")
