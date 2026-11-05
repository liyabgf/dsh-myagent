#!/usr/bin/env python3
"""Second wave of news/community queries -> manifest rows."""
import urllib.parse

QUERIES = [
    ("gfiber", "Alphabet G Fiber sale divestiture"),
    ("wing", "Wing drone delivery Alphabet"),
    ("isomorphic", "Isomorphic Labs drug discovery"),
    ("verily", "Verily Alphabet health"),
    ("otherbets2", "Alphabet Other Bets losses"),
    ("hassabis", "Demis Hassabis Google DeepMind CEO role"),
    ("jeffdean", "Jeff Dean leaves Google"),
    ("kurian", "Thomas Kurian Google Cloud"),
    ("gemini_enterprise", "Gemini Enterprise Google Workspace"),
    ("argon", "Gemini 4 Argon launch"),
    ("carbon", "Gemini 4 Carbon benchmark"),
    ("aimode_users", "Google AI Mode users monthly"),
    ("search_share2", "Google search share StatCounter decline"),
    ("publishers", "Google AI Overviews publishers traffic lawsuit"),
    ("chrome_share", "Google Chrome browser market share"),
    ("waymo_rides", "Waymo weekly rides record"),
    ("india_cci", "Google India CCI Play Store ruling"),
    ("trump_google", "Trump Google antitrust Section 301 Europe"),
    ("nvidia_tpu", "Google TPU Nvidia competition"),
    ("crux", "Crux AI Blackstone Google joint venture"),
    ("dc_opposition", "Google data center opposition residents water"),
    ("preferred", "Alphabet preferred stock offering investors"),
    ("employee_ai", "Google employees AI coding internal tools productivity"),
    ("youtube_tv", "YouTube TV NFL creators revenue share"),
    ("epic_play", "Google Play Epic settlement sideloading fees"),
    ("gemini_app_1b", "Gemini app one billion users"),
    ("google_health", "Google AI health guidance framework"),
    ("deepmind_military", "Google DeepMind Pentagon military contract"),
    ("google_search_ads_publishers", "Google Zero click search publishers revenue"),
    ("alphabet_analyst", "Alphabet analysts downgrade price target November 2026"),
]

for slug, q in QUERIES:
    print(f"bing2_{slug}\thttps://www.bing.com/news/search?q={urllib.parse.quote_plus(q)}&format=rss&setlang=en-US&cc=US")
    print(f"gn2_{slug}\thttps://news.google.com/rss/search?q={urllib.parse.quote_plus(q + ' when:90d')}&hl=en-US&gl=US&ceid=US:en")

HN = [
    ("hn_google", "Google"),
    ("hn_googlebook", "Googlebook"),
    ("hn_antigravity", "Antigravity"),
    ("hn_waymo", "Waymo"),
    ("hn_gemini4", "Gemini 4"),
    ("hn_tpu", "Google TPU"),
    ("hn_ai_overviews", "AI Overviews"),
    ("hn_deepmind", "DeepMind"),
]
for slug, q in HN:
    print(f"{slug}\thttps://hn.algolia.com/api/v1/search?query={urllib.parse.quote_plus(q)}"
          f"&tags=story&numericFilters=created_at_i%3E1785542400,points%3E80&hitsPerPage=40")
