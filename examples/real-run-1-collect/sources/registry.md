# 信息源登记表 (Source Registry)

抓取工具: `scripts/fetch.py` (curl, UA=Chrome/126 桌面; sec.gov 使用研究用途 UA)。
每条记录含: 原始 URL、HTTP 状态、字节数、抓取时间(UTC)、本地留档路径。
成功留档 279 条, 失败/未留档 34 条。

本地留档位于 `raw/`, 正文纯文本转换位于 `txt/`。所有引文均可据此逐条复核。

## 一、一手来源 (Primary sources)

- [sec_8k_q3_2026_body](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000080/goog-20261028.htm) — HTTP 200, 5845 bytes, fetched 2026-11-05T05:00:08Z, 留档: `raw/sec_8k_q3_2026_body.html`
- [sec_ex991_q3_2026_earnings](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000080/googexhibit991q32026.htm) — HTTP 200, 19475 bytes, fetched 2026-11-05T05:00:09Z, 留档: `raw/sec_ex991_q3_2026_earnings.html`
- [sec_10q_q3_2026](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000084/goog-20260930.htm) — HTTP 200, 154174 bytes, fetched 2026-11-05T05:00:12Z, 留档: `raw/sec_10q_q3_2026.html`
- [sec_424b5_nov2026](https://www.sec.gov/Archives/edgar/data/1652044/000119312526442515/d125079d424b5.htm) — HTTP 200, 86548 bytes, fetched 2026-11-05T05:00:13Z, 留档: `raw/sec_424b5_nov2026.html`
- [sec_424b2_nov2026](https://www.sec.gov/Archives/edgar/data/1652044/000119312526447343/d125079d424b2.htm) — HTTP 200, 89516 bytes, fetched 2026-11-05T05:00:15Z, 留档: `raw/sec_424b2_nov2026.html`
- [sec_fwp_nov2026](https://www.sec.gov/Archives/edgar/data/1652044/000119312526443857/d134038dfwp.htm) — HTTP 200, 7919 bytes, fetched 2026-11-05T05:00:17Z, 留档: `raw/sec_fwp_nov2026.html`
- [blog_google_rss](https://blog.google/rss/) — HTTP 200, 6124 bytes, fetched 2026-11-05T04:56:44Z, 留档: `raw/blog_google_rss.xml`
- [blog_gemini4_carbon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-carbon/) — HTTP 200, 67683 bytes, fetched 2026-11-05T05:13:22Z, 留档: `raw/blog_gemini4_carbon.html`
- [blog_gemini4_argon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/) — HTTP 200, 72796 bytes, fetched 2026-11-05T05:13:25Z, 留档: `raw/blog_gemini4_argon.html`
- [blog_ai_updates_oct2026](https://blog.google/innovation-and-ai/technology/ai/google-ai-updates-october-2026/) — HTTP 200, 75451 bytes, fetched 2026-11-05T05:13:26Z, 留档: `raw/blog_ai_updates_oct2026.html`
- [blog_suncatcher_response](https://blog.google/innovation-and-ai/models-and-research/google-research/project-suncatcher-satellite-response/) — HTTP 200, 73217 bytes, fetched 2026-11-05T05:13:28Z, 留档: `raw/blog_suncatcher_response.html`
- [blog_health_ai_framework](https://blog.google/innovation-and-ai/technology/health/evaluating-health-ai-at-scale/) — HTTP 200, 73879 bytes, fetched 2026-11-05T05:13:30Z, 留档: `raw/blog_health_ai_framework.html`
- [blog_gemini_edit_files](https://blog.google/innovation-and-ai/products/gemini-app/edit-files-directly/) — HTTP 200, 72651 bytes, fetched 2026-11-05T05:13:32Z, 留档: `raw/blog_gemini_edit_files.html`
- [deepmind_blog_rss](https://deepmind.google/blog/rss.xml) — HTTP 200, 18852 bytes, fetched 2026-11-05T04:56:45Z, 留档: `raw/deepmind_blog_rss.xml`
- [dm_gemini4_carbon](https://deepmind.google/blog/gemini-4-carbon-our-next-frontier-model/) — HTTP 200, 67574 bytes, fetched 2026-11-05T05:13:36Z, 留档: `raw/dm_gemini4_carbon.html`
- [dm_gemini4_argon](https://deepmind.google/blog/introducing-gemini-4-argon/) — HTTP 200, 80360 bytes, fetched 2026-11-05T05:13:40Z, 留档: `raw/dm_gemini4_argon.html`
- [dm_genie4](https://deepmind.google/blog/genie-4-a-new-generation-of-world-simulation/) — HTTP 200, 45086 bytes, fetched 2026-11-05T05:13:43Z, 留档: `raw/dm_genie4.html`
- [dm_antigravity_chem](https://deepmind.google/blog/agentic-cheminformatics-with-google-antigravity/) — HTTP 200, 33474 bytes, fetched 2026-11-05T05:13:44Z, 留档: `raw/dm_antigravity_chem.html`
- [google_devs_blog_rss](https://developers.googleblog.com/feeds/posts/default) — HTTP 200, 16197 bytes, fetched 2026-11-05T04:56:48Z, 留档: `raw/google_devs_blog_rss.xml`
- [devblog_argon_robotics](https://developers.googleblog.com/gemini-4-argon-for-robotics/) — HTTP 200, 21158 bytes, fetched 2026-11-05T05:13:49Z, 留档: `raw/devblog_argon_robotics.html`
- [google_cloud_blog_rss](https://cloud.google.com/blog/rss) — HTTP 200, 36070 bytes, fetched 2026-11-05T04:56:49Z, 留档: `raw/google_cloud_blog_rss.html`
- [waymo_blog](https://waymo.com/blog/) — HTTP 200, 26210 bytes, fetched 2026-11-05T05:14:16Z, 留档: `raw/waymo_blog.html`
- [waymo_toronto](https://waymo.com/blog/2026/10/waymo-in-toronto/) — HTTP 200, 21154 bytes, fetched 2026-11-05T05:22:16Z, 留档: `raw/waymo_toronto.html`
- [aa_gemini4_carbon_index](https://artificialanalysis.ai/articles/gemini-4-carbon-new-number-1) — HTTP 200, 66531 bytes, fetched 2026-11-05T05:13:50Z, 留档: `raw/aa_gemini4_carbon_index.html`
- [hn_algolia_gemini](https://hn.algolia.com/api/v1/search_by_date?query=Gemini&tags=story&numericFilters=points%3E50&hitsPerPage=60) — HTTP 200, 191896 bytes, fetched 2026-11-05T04:56:59Z, 留档: `raw/hn_algolia_gemini.json`
- [hn_google](https://hn.algolia.com/api/v1/search?query=Google&tags=story&numericFilters=created_at_i%3E1785542400,points%3E80&hitsPerPage=40) — HTTP 200, 56675 bytes, fetched 2026-11-05T05:10:34Z, 留档: `raw/hn_google.json`
- [hn_googlebook](https://hn.algolia.com/api/v1/search?query=Googlebook&tags=story&numericFilters=created_at_i%3E1785542400,points%3E80&hitsPerPage=40) — HTTP 200, 5655 bytes, fetched 2026-11-05T05:10:35Z, 留档: `raw/hn_googlebook.json`
- [hn_antigravity](https://hn.algolia.com/api/v1/search?query=Antigravity&tags=story&numericFilters=created_at_i%3E1785542400,points%3E80&hitsPerPage=40) — HTTP 200, 2733 bytes, fetched 2026-11-05T05:10:36Z, 留档: `raw/hn_antigravity.json`
- [hn_waymo](https://hn.algolia.com/api/v1/search?query=Waymo&tags=story&numericFilters=created_at_i%3E1785542400,points%3E80&hitsPerPage=40) — HTTP 200, 7503 bytes, fetched 2026-11-05T05:10:38Z, 留档: `raw/hn_waymo.json`
- [hn_gemini4](https://hn.algolia.com/api/v1/search?query=Gemini+4&tags=story&numericFilters=created_at_i%3E1785542400,points%3E80&hitsPerPage=40) — HTTP 200, 23958 bytes, fetched 2026-11-05T05:10:41Z, 留档: `raw/hn_gemini4.json`
- [hn_tpu](https://hn.algolia.com/api/v1/search?query=Google+TPU&tags=story&numericFilters=created_at_i%3E1785542400,points%3E80&hitsPerPage=40) — HTTP 200, 30641 bytes, fetched 2026-11-05T05:10:44Z, 留档: `raw/hn_tpu.json`
- [hn_ai_overviews](https://hn.algolia.com/api/v1/search?query=AI+Overviews&tags=story&numericFilters=created_at_i%3E1785542400,points%3E80&hitsPerPage=40) — HTTP 200, 4753 bytes, fetched 2026-11-05T05:10:45Z, 留档: `raw/hn_ai_overviews.json`
- [hn_deepmind](https://hn.algolia.com/api/v1/search?query=DeepMind&tags=story&numericFilters=created_at_i%3E1785542400,points%3E80&hitsPerPage=40) — HTTP 200, 27685 bytes, fetched 2026-11-05T05:10:47Z, 留档: `raw/hn_deepmind.json`
- [hn_item_gemini_training](https://hn.algolia.com/api/v1/items/50363461) — HTTP 200, 81837 bytes, fetched 2026-11-05T05:14:18Z, 留档: `raw/hn_item_gemini_training.json`
- [hn_item_gemini4_carbon](https://hn.algolia.com/api/v1/items/50276792) — HTTP 200, 368083 bytes, fetched 2026-11-05T05:14:23Z, 留档: `raw/hn_item_gemini4_carbon.json`
- [hn_item_gemini4_argon](https://hn.algolia.com/api/v1/items/49913571) — HTTP 200, 604729 bytes, fetched 2026-11-05T05:14:37Z, 留档: `raw/hn_item_gemini4_argon.json`

## 二、媒体与社区来源 (按域名)

### 247wallst.com (2)
- [art8_Alphabet_Raised_41_Billion_in_One_Qua](https://247wallst.com/investing/2026/10/29/alphabet-raised-41-billion-in-one-quarter-to-pay-for-ai/) — 89879B, 2026-11-05T05:26:21Z, `raw/art8_Alphabet_Raised_41_Billion_in_One_Qua.html`
- [art_Google_Faces_a_$3.2_Billion_Ad-Tech_Dama](https://247wallst.com/investing/2026/10/06/google-faces-a-3-2-billion-ad-tech-damages-claim-that-would-triple-at-trial/) — 89504B, 2026-11-05T05:12:08Z, `raw/art_Google_Faces_a__3.2_Billion_Ad-Tech_Dama.html`

### 9to5google.com (3)
- [n9to5_ai_overview_payout](https://9to5google.com/2026-09-30/google-ai-overview-payout-test-details/) — 42574B, 2026-11-05T05:30:28Z, `raw/n9to5_ai_overview_payout.html`
- [art_Alphabet_reports_Q3_2026_revenue](https://9to5google.com/2026/10/28/alphabet-q3-2026-earnings/) — 43125B, 2026-11-05T05:10:49Z, `raw/art_Alphabet_reports_Q3_2026_revenue.html`
- [9to5google_rss](https://9to5google.com/feed/) — 26566B, 2026-11-05T04:56:51Z, `raw/9to5google_rss.xml`

### adexchanger.com (1)
- [art_The_Court_Just_Unsealed_Judge_Brinkema](https://www.adexchanger.com/platforms/the-court-just-unsealed-judge-brinkemas-remedies-decision-in-the-google-ad-tech-antitrust-case-heres-your-tldr/) — 83758B, 2026-11-05T05:11:39Z, `raw/art_The_Court_Just_Unsealed_Judge_Brinkema.html`

### aljazeera.com (1)
- [art10_Trump_threatens_EU_will_pay](https://www.aljazeera.com/news/2026/7/25/trump-threatens-eu-will-pay-big-price-after-brussels-fines-google-1bn) — 56670B, 2026-11-05T06:03:52Z, `raw/art10_Trump_threatens_EU_will_pay.html`

### androidauthority.com (3)
- [aa_sideload_enrollment](https://www.androidauthority.com/android-opens-enrollment-program-for-app-stores-3728653/) — 17527B, 2026-11-05T05:30:57Z, `raw/aa_sideload_enrollment.html`
- [art_Google_spent_months_pushing_AI_mode](https://www.androidauthority.com/google-search-without-ai-mode-3731278/) — 17394B, 2026-11-05T05:12:21Z, `raw/art_Google_spent_months_pushing_AI_mode.html`
- [art_Gemini_4_Carbon_is_Googles_second_new_f](https://www.androidauthority.com/google-announces-gemini-4-carbon-3729367/) — 18688B, 2026-11-05T05:12:06Z, `raw/art_Gemini_4_Carbon_is_Googles_second_new_f.html`

### arstechnica.com (4)
- [ars_play_fees](https://arstechnica.com/google/2026/06/google-starts-lowering-play-store-fees-making-good-on-epic-games-settle) — 45878B, 2026-11-05T05:30:53Z, `raw/ars_play_fees.html`
- [art8_Google_confirms_Gemini_models_hacked_t](https://arstechnica.com/google/2026/09/google-confirms-gemini-models-hacked-three-companies-in-may-2026/) — 44240B, 2026-11-05T05:26:11Z, `raw/art8_Google_confirms_Gemini_models_hacked_t.html`
- [art_US_court_rules_Google_will_not_have_to_s](https://arstechnica.com/gadgets/2026/09/us-court-rules-google-will-not-have-to-sell-ad-exchange-after-losing-antitrust-case/) — 44392B, 2026-11-05T05:11:42Z, `raw/art_US_court_rules_Google_will_not_have_to_s.html`
- [art_Google_admits_AI_search_makes_less_money](https://arstechnica.com/gadgets/2026/10/google-admits-ai-search-makes-less-money-but-its-fixing-that-with-more-ads/) — 45607B, 2026-11-05T05:10:53Z, `raw/art_Google_admits_AI_search_makes_less_money.html`

### bbc.co.uk (1)
- [art8_Google_value_plunges_by_500bn](https://www.bbc.co.uk/news/articles/cm9qzdqpxy48o) — 75138B, 2026-11-05T05:26:08Z, `raw/art8_Google_value_plunges_by_500bn.html`

### bing.com (86)
- [bing4_search_data_sharing](https://www.bing.com/news/search?q=Google+search+data+sharing+syndication+remedies+compliance&format=rss&setlang=en-US&cc=US) — 1301B, 2026-11-05T05:27:05Z, `raw/bing4_search_data_sharing.xml`
- [bing4_waymo_overseas](https://www.bing.com/news/search?q=Waymo+overseas+expansion+cash+burning+CNBC&format=rss&setlang=en-US&cc=US) — 1275B, 2026-11-05T05:27:00Z, `raw/bing4_waymo_overseas.xml`
- [bing4_ai_mode_ads](https://www.bing.com/news/search?q=Google+AI+Mode+ads+expansion+countries+advertisers&format=rss&setlang=en-US&cc=US) — 4278B, 2026-11-05T05:26:59Z, `raw/bing4_ai_mode_ads.xml`
- [bing4_cloud_capacity](https://www.bing.com/news/search?q=Google+Cloud+capacity+constrained+2027+Kurian&format=rss&setlang=en-US&cc=US) — 1921B, 2026-11-05T05:26:56Z, `raw/bing4_cloud_capacity.xml`
- [bing4_capex_2027](https://www.bing.com/news/search?q=Alphabet+2027+capital+expenditures+increase+guidance&format=rss&setlang=en-US&cc=US) — 4620B, 2026-11-05T05:26:55Z, `raw/bing4_capex_2027.xml`
- [bing4_publishers_paid](https://www.bing.com/news/search?q=Google+paying+publishers+AI+Overviews+licensing&format=rss&setlang=en-US&cc=US) — 3721B, 2026-11-05T05:26:53Z, `raw/bing4_publishers_paid.xml`
- [bing4_french_publishers](https://www.bing.com/news/search?q=French+newspapers+Google+AI+Overviews+complaint+competition+authority&format=rss&setlang=en-US&cc=US) — 1233B, 2026-11-05T05:26:51Z, `raw/bing4_french_publishers.xml`
- [bing4_gfiber_sale](https://www.bing.com/news/search?q=Google+Fiber+sale+buyer+2026&format=rss&setlang=en-US&cc=US) — 705B, 2026-11-05T05:26:49Z, `raw/bing4_gfiber_sale.xml`
- [bing4_waymo_uber](https://www.bing.com/news/search?q=Waymo+Uber+exclusive+partnership+ends+Austin+Atlanta&format=rss&setlang=en-US&cc=US) — 3867B, 2026-11-05T05:26:48Z, `raw/bing4_waymo_uber.xml`
- [bing4_deepmind_nda2](https://www.bing.com/news/search?q=DeepMind+researchers+NDA+ban+speaking+publicly+protest&format=rss&setlang=en-US&cc=US) — 739B, 2026-11-05T05:26:46Z, `raw/bing4_deepmind_nda2.xml`
- [bing4_isomorphic_funding](https://www.bing.com/news/search?q=Isomorphic+Labs+funding+valuation+2026&format=rss&setlang=en-US&cc=US) — 3977B, 2026-11-05T05:26:45Z, `raw/bing4_isomorphic_funding.xml`
- [bing4_spacex_writedown](https://www.bing.com/news/search?q=Alphabet+SpaceX+writedown+third+quarter+2026&format=rss&setlang=en-US&cc=US) — 4190B, 2026-11-05T05:26:44Z, `raw/bing4_spacex_writedown.xml`
- [bing3_chrome_share](https://www.bing.com/news/search?q=Chrome+browser+market+share+2026+decline&format=rss&setlang=en-US&cc=US) — 720B, 2026-11-05T05:22:46Z, `raw/bing3_chrome_share.xml`
- [bing3_digital_ads](https://www.bing.com/news/search?q=advertisers+Google+AI+Mode+ads+reaction+2026&format=rss&setlang=en-US&cc=US) — 4344B, 2026-11-05T05:22:44Z, `raw/bing3_digital_ads.xml`
- [bing3_youtube_creators](https://www.bing.com/news/search?q=YouTube+monetization+requirements+creators+backlash+2026&format=rss&setlang=en-US&cc=US) — 2287B, 2026-11-05T05:22:42Z, `raw/bing3_youtube_creators.xml`
- [bing3_ashkenazi](https://www.bing.com/news/search?q=Anat+Ashkenazi+Alphabet+CFO+capex+2027&format=rss&setlang=en-US&cc=US) — 3716B, 2026-11-05T05:22:41Z, `raw/bing3_ashkenazi.xml`
- [bing3_mechanize](https://www.bing.com/news/search?q=Google+Mechanize+investment+coding&format=rss&setlang=en-US&cc=US) — 2985B, 2026-11-05T05:22:39Z, `raw/bing3_mechanize.xml`
- [bing3_kavukcuoglu](https://www.bing.com/news/search?q=Koray+Kavukcuoglu+DeepMind+CEO&format=rss&setlang=en-US&cc=US) — 3986B, 2026-11-05T05:22:36Z, `raw/bing3_kavukcuoglu.xml`
- [bing3_googlebook_launch](https://www.bing.com/news/search?q=Googlebook+launch+October+2026+price&format=rss&setlang=en-US&cc=US) — 3315B, 2026-11-05T05:22:35Z, `raw/bing3_googlebook_launch.xml`
- [bing3_rafa](https://www.bing.com/news/search?q=Google+Maps+Rafah+destruction&format=rss&setlang=en-US&cc=US) — 3536B, 2026-11-05T05:22:34Z, `raw/bing3_rafa.xml`
- [bing3_gfiber](https://www.bing.com/news/search?q=Google+Fiber+sale+Alphabet+2026&format=rss&setlang=en-US&cc=US) — 1200B, 2026-11-05T05:22:31Z, `raw/bing3_gfiber.xml`
- [bing3_market_cap](https://www.bing.com/news/search?q=Alphabet+market+cap+4+trillion+2026&format=rss&setlang=en-US&cc=US) — 3461B, 2026-11-05T05:22:28Z, `raw/bing3_market_cap.xml`
- [bing3_deepmind_nda](https://www.bing.com/news/search?q=Google+DeepMind+employees+non-disclosure+lifetime+ban+criticizing&format=rss&setlang=en-US&cc=US) — 751B, 2026-11-05T05:22:27Z, `raw/bing3_deepmind_nda.xml`
- [bing3_gemini_breakout](https://www.bing.com/news/search?q=Gemini+agent+breakout+hacked+companies&format=rss&setlang=en-US&cc=US) — 3815B, 2026-11-05T05:22:25Z, `raw/bing3_gemini_breakout.xml`
- [bing3_cloud_outage](https://www.bing.com/news/search?q=Google+Cloud+outage+Europe+banks+October+2026&format=rss&setlang=en-US&cc=US) — 3786B, 2026-11-05T05:22:24Z, `raw/bing3_cloud_outage.xml`
- [bing2_alphabet_analyst](https://www.bing.com/news/search?q=Alphabet+analysts+downgrade+price+target+November+2026&format=rss&setlang=en-US&cc=US) — 2384B, 2026-11-05T05:10:31Z, `raw/bing2_alphabet_analyst.xml`
- [bing2_google_search_ads_publishers](https://www.bing.com/news/search?q=Google+Zero+click+search+publishers+revenue&format=rss&setlang=en-US&cc=US) — 2270B, 2026-11-05T05:10:27Z, `raw/bing2_google_search_ads_publishers.xml`
- [bing2_deepmind_military](https://www.bing.com/news/search?q=Google+DeepMind+Pentagon+military+contract&format=rss&setlang=en-US&cc=US) — 4063B, 2026-11-05T05:10:24Z, `raw/bing2_deepmind_military.xml`
- [bing2_google_health](https://www.bing.com/news/search?q=Google+AI+health+guidance+framework&format=rss&setlang=en-US&cc=US) — 2334B, 2026-11-05T05:10:19Z, `raw/bing2_google_health.xml`
- [bing2_gemini_app_1b](https://www.bing.com/news/search?q=Gemini+app+one+billion+users&format=rss&setlang=en-US&cc=US) — 3951B, 2026-11-05T05:10:14Z, `raw/bing2_gemini_app_1b.xml`
- [bing2_epic_play](https://www.bing.com/news/search?q=Google+Play+Epic+settlement+sideloading+fees&format=rss&setlang=en-US&cc=US) — 3971B, 2026-11-05T05:10:12Z, `raw/bing2_epic_play.xml`
- [bing2_youtube_tv](https://www.bing.com/news/search?q=YouTube+TV+NFL+creators+revenue+share&format=rss&setlang=en-US&cc=US) — 719B, 2026-11-05T05:10:07Z, `raw/bing2_youtube_tv.xml`
- [bing2_employee_ai](https://www.bing.com/news/search?q=Google+employees+AI+coding+internal+tools+productivity&format=rss&setlang=en-US&cc=US) — 2353B, 2026-11-05T05:10:03Z, `raw/bing2_employee_ai.xml`
- [bing2_preferred](https://www.bing.com/news/search?q=Alphabet+preferred+stock+offering+investors&format=rss&setlang=en-US&cc=US) — 4190B, 2026-11-05T05:10:00Z, `raw/bing2_preferred.xml`
- [bing2_dc_opposition](https://www.bing.com/news/search?q=Google+data+center+opposition+residents+water&format=rss&setlang=en-US&cc=US) — 4009B, 2026-11-05T05:09:55Z, `raw/bing2_dc_opposition.xml`
- [bing2_crux](https://www.bing.com/news/search?q=Crux+AI+Blackstone+Google+joint+venture&format=rss&setlang=en-US&cc=US) — 4074B, 2026-11-05T05:09:52Z, `raw/bing2_crux.xml`
- [bing2_nvidia_tpu](https://www.bing.com/news/search?q=Google+TPU+Nvidia+competition&format=rss&setlang=en-US&cc=US) — 4090B, 2026-11-05T05:09:49Z, `raw/bing2_nvidia_tpu.xml`
- [bing2_trump_google](https://www.bing.com/news/search?q=Trump+Google+antitrust+Section+301+Europe&format=rss&setlang=en-US&cc=US) — 2348B, 2026-11-05T05:09:46Z, `raw/bing2_trump_google.xml`
- [bing2_india_cci](https://www.bing.com/news/search?q=Google+India+CCI+Play+Store+ruling&format=rss&setlang=en-US&cc=US) — 1488B, 2026-11-05T05:09:42Z, `raw/bing2_india_cci.xml`
- [bing2_waymo_rides](https://www.bing.com/news/search?q=Waymo+weekly+rides+record&format=rss&setlang=en-US&cc=US) — 2870B, 2026-11-05T05:09:36Z, `raw/bing2_waymo_rides.xml`
- [bing2_chrome_share](https://www.bing.com/news/search?q=Google+Chrome+browser+market+share&format=rss&setlang=en-US&cc=US) — 2164B, 2026-11-05T05:09:33Z, `raw/bing2_chrome_share.xml`
- [bing2_publishers](https://www.bing.com/news/search?q=Google+AI+Overviews+publishers+traffic+lawsuit&format=rss&setlang=en-US&cc=US) — 3814B, 2026-11-05T05:09:29Z, `raw/bing2_publishers.xml`
- [bing2_search_share2](https://www.bing.com/news/search?q=Google+search+share+StatCounter+decline&format=rss&setlang=en-US&cc=US) — 1337B, 2026-11-05T05:09:25Z, `raw/bing2_search_share2.xml`
- [bing2_aimode_users](https://www.bing.com/news/search?q=Google+AI+Mode+users+monthly&format=rss&setlang=en-US&cc=US) — 4056B, 2026-11-05T05:09:19Z, `raw/bing2_aimode_users.xml`
- [bing2_carbon](https://www.bing.com/news/search?q=Gemini+4+Carbon+benchmark&format=rss&setlang=en-US&cc=US) — 4360B, 2026-11-05T05:09:16Z, `raw/bing2_carbon.xml`
- [bing2_argon](https://www.bing.com/news/search?q=Gemini+4+Argon+launch&format=rss&setlang=en-US&cc=US) — 4369B, 2026-11-05T05:09:12Z, `raw/bing2_argon.xml`
- [bing2_gemini_enterprise](https://www.bing.com/news/search?q=Gemini+Enterprise+Google+Workspace&format=rss&setlang=en-US&cc=US) — 4256B, 2026-11-05T05:09:07Z, `raw/bing2_gemini_enterprise.xml`
- [bing2_kurian](https://www.bing.com/news/search?q=Thomas+Kurian+Google+Cloud&format=rss&setlang=en-US&cc=US) — 4149B, 2026-11-05T05:09:02Z, `raw/bing2_kurian.xml`
- [bing2_jeffdean](https://www.bing.com/news/search?q=Jeff+Dean+leaves+Google&format=rss&setlang=en-US&cc=US) — 1953B, 2026-11-05T05:08:59Z, `raw/bing2_jeffdean.xml`
- [bing2_hassabis](https://www.bing.com/news/search?q=Demis+Hassabis+Google+DeepMind+CEO+role&format=rss&setlang=en-US&cc=US) — 3721B, 2026-11-05T05:08:53Z, `raw/bing2_hassabis.xml`
- [bing2_otherbets2](https://www.bing.com/news/search?q=Alphabet+Other+Bets+losses&format=rss&setlang=en-US&cc=US) — 2610B, 2026-11-05T05:08:50Z, `raw/bing2_otherbets2.xml`
- [bing2_verily](https://www.bing.com/news/search?q=Verily+Alphabet+health&format=rss&setlang=en-US&cc=US) — 4029B, 2026-11-05T05:08:47Z, `raw/bing2_verily.xml`
- [bing2_isomorphic](https://www.bing.com/news/search?q=Isomorphic+Labs+drug+discovery&format=rss&setlang=en-US&cc=US) — 4296B, 2026-11-05T05:08:45Z, `raw/bing2_isomorphic.xml`
- [bing2_wing](https://www.bing.com/news/search?q=Wing+drone+delivery+Alphabet&format=rss&setlang=en-US&cc=US) — 3750B, 2026-11-05T05:08:43Z, `raw/bing2_wing.xml`
- [bing2_gfiber](https://www.bing.com/news/search?q=Alphabet+G+Fiber+sale+divestiture&format=rss&setlang=en-US&cc=US) — 712B, 2026-11-05T05:08:39Z, `raw/bing2_gfiber.xml`
- [bing_other_bets](https://www.bing.com/news/search?q=Alphabet+Other+Bets+Verily+Wing+Isomorphic&format=rss&setlang=en-US&cc=US) — 723B, 2026-11-05T05:02:36Z, `raw/bing_other_bets.xml`
- [bing_gemini_schools](https://www.bing.com/news/search?q=Google+schools+AI+Search+disable&format=rss&setlang=en-US&cc=US) — 4243B, 2026-11-05T05:02:34Z, `raw/bing_gemini_schools.xml`
- [bing_pichai](https://www.bing.com/news/search?q=Sundar+Pichai+interview&format=rss&setlang=en-US&cc=US) — 4628B, 2026-11-05T05:02:30Z, `raw/bing_pichai.xml`
- [bing_suncatcher](https://www.bing.com/news/search?q=Google+Project+Suncatcher+satellite+TPU&format=rss&setlang=en-US&cc=US) — 4061B, 2026-11-05T05:02:27Z, `raw/bing_suncatcher.xml`
- [bing_energy](https://www.bing.com/news/search?q=Google+data+center+electricity+utility+bills&format=rss&setlang=en-US&cc=US) — 3987B, 2026-11-05T05:02:23Z, `raw/bing_energy.xml`
- [bing_india](https://www.bing.com/news/search?q=Google+India+CCI+antitrust+Android&format=rss&setlang=en-US&cc=US) — 2495B, 2026-11-05T05:02:21Z, `raw/bing_india.xml`
- [bing_privacy](https://www.bing.com/news/search?q=Google+privacy+lawsuit+settlement+data&format=rss&setlang=en-US&cc=US) — 2360B, 2026-11-05T05:02:17Z, `raw/bing_privacy.xml`
- [bing_copyright](https://www.bing.com/news/search?q=Google+AI+copyright+lawsuit+authors+ruling&format=rss&setlang=en-US&cc=US) — 2338B, 2026-11-05T05:02:10Z, `raw/bing_copyright.xml`
- [bing_eu_dma](https://www.bing.com/news/search?q=Google+EU+DMA+fine+European+Commission&format=rss&setlang=en-US&cc=US) — 4137B, 2026-11-05T05:02:06Z, `raw/bing_eu_dma.xml`
- [bing_adtech](https://www.bing.com/news/search?q=Google+ad+tech+case+ruling+break+up&format=rss&setlang=en-US&cc=US) — 3870B, 2026-11-05T05:02:04Z, `raw/bing_adtech.xml`
- [bing_antitrust_us](https://www.bing.com/news/search?q=Google+antitrust+remedy+appeal+Chrome+divestiture&format=rss&setlang=en-US&cc=US) — 3862B, 2026-11-05T05:02:01Z, `raw/bing_antitrust_us.xml`
- [bing_union](https://www.bing.com/news/search?q=Alphabet+Workers+Union+Google+employees&format=rss&setlang=en-US&cc=US) — 3685B, 2026-11-05T05:01:56Z, `raw/bing_union.xml`
- [bing_layoffs](https://www.bing.com/news/search?q=Google+layoffs+restructuring+2026&format=rss&setlang=en-US&cc=US) — 3030B, 2026-11-05T05:01:53Z, `raw/bing_layoffs.xml`
- [bing_googlebook](https://www.bing.com/news/search?q=Googlebook+Google+laptop&format=rss&setlang=en-US&cc=US) — 4071B, 2026-11-05T05:01:50Z, `raw/bing_googlebook.xml`
- [bing_chromeos](https://www.bing.com/news/search?q=Google+Android+ChromeOS+merge&format=rss&setlang=en-US&cc=US) — 3992B, 2026-11-05T05:01:46Z, `raw/bing_chromeos.xml`
- [bing_android_pixel](https://www.bing.com/news/search?q=Pixel+11+Android+17&format=rss&setlang=en-US&cc=US) — 3439B, 2026-11-05T05:01:43Z, `raw/bing_android_pixel.xml`
- [bing_waymo](https://www.bing.com/news/search?q=Waymo+expansion+robotaxi&format=rss&setlang=en-US&cc=US) — 4562B, 2026-11-05T05:01:38Z, `raw/bing_waymo.xml`
- [bing_youtube](https://www.bing.com/news/search?q=YouTube+revenue+TV+advertising&format=rss&setlang=en-US&cc=US) — 3973B, 2026-11-05T05:01:34Z, `raw/bing_youtube.xml`
- [bing_tpu](https://www.bing.com/news/search?q=Google+TPU+Anthropic+Meta&format=rss&setlang=en-US&cc=US) — 4445B, 2026-11-05T05:01:29Z, `raw/bing_tpu.xml`
- [bing_google_cloud](https://www.bing.com/news/search?q=Google+Cloud+revenue+backlog+TPU&format=rss&setlang=en-US&cc=US) — 4731B, 2026-11-05T05:01:25Z, `raw/bing_google_cloud.xml`
- [bing_deepmind_talent](https://www.bing.com/news/search?q=Google+DeepMind+researcher+leaves+poached&format=rss&setlang=en-US&cc=US) — 3776B, 2026-11-05T05:01:19Z, `raw/bing_deepmind_talent.xml`
- [bing_antigravity](https://www.bing.com/news/search?q=Google+Antigravity+IDE&format=rss&setlang=en-US&cc=US) — 4012B, 2026-11-05T05:01:14Z, `raw/bing_antigravity.xml`
- [bing_gemini4](https://www.bing.com/news/search?q=%22Gemini+4%22&format=rss&setlang=en-US&cc=US) — 4403B, 2026-11-05T05:01:12Z, `raw/bing_gemini4.xml`
- [bing_gemini](https://www.bing.com/news/search?q=Gemini+Google+app+users&format=rss&setlang=en-US&cc=US) — 4134B, 2026-11-05T05:01:08Z, `raw/bing_gemini.xml`
- [bing_google_ads](https://www.bing.com/news/search?q=Google+advertising+revenue+AI+Mode+ads&format=rss&setlang=en-US&cc=US) — 4559B, 2026-11-05T05:01:04Z, `raw/bing_google_ads.xml`
- [bing_google_search_share](https://www.bing.com/news/search?q=Google+search+market+share+ChatGPT&format=rss&setlang=en-US&cc=US) — 4003B, 2026-11-05T05:01:01Z, `raw/bing_google_search_share.xml`
- [bing_google_search_decline](https://www.bing.com/news/search?q=Google+Search+AI+Overviews+traffic+publishers&format=rss&setlang=en-US&cc=US) — 4245B, 2026-11-05T05:00:58Z, `raw/bing_google_search_decline.xml`
- [bing_alphabet_bonds](https://www.bing.com/news/search?q=Alphabet+bond+sale+debt&format=rss&setlang=en-US&cc=US) — 3726B, 2026-11-05T05:00:55Z, `raw/bing_alphabet_bonds.xml`
- [bing_alphabet_capex](https://www.bing.com/news/search?q=Alphabet+capex+data+center+spending&format=rss&setlang=en-US&cc=US) — 4506B, 2026-11-05T05:00:53Z, `raw/bing_alphabet_capex.xml`
- [bing_alphabet_earnings](https://www.bing.com/news/search?q=%22Alphabet%22+earnings+Q3+2026&format=rss&setlang=en-US&cc=US) — 4408B, 2026-11-05T05:00:49Z, `raw/bing_alphabet_earnings.xml`
- [bing_news_alphabet_rss](https://www.bing.com/news/search?q=Alphabet+Google+earnings&format=rss) — 4657B, 2026-11-05T04:56:55Z, `raw/bing_news_alphabet_rss.xml`

### businessinsider.com (2)
- [art_Google_shakes_up_AI_leadership](https://www.businessinsider.com/google-ai-leadership-demis-hassabis-steps-down-deepmind-ceo-2026-8) — 74437B, 2026-11-05T05:11:10Z, `raw/art_Google_shakes_up_AI_leadership.html`
- [art_YouTube_missed_expectations_on_ad_revenu](https://www.businessinsider.com/youtube-misses-ad-revenue-third-quarter-2026-10) — 71654B, 2026-11-05T05:10:56Z, `raw/art_YouTube_missed_expectations_on_ad_revenu.html`

### cnbc.com (6)
- [art8_Alphabet_sinks_10%_as_it_holds_2026_ca](https://www.cnbc.com/2026/10/28/alphabet-googl-earnings-q3-2026.html) — 119956B, 2026-11-05T05:26:31Z, `raw/art8_Alphabet_sinks_10__as_it_holds_2026_ca.html`
- [art8_AI_buildout_hits_snag_as_Google_and_Mi](https://www.cnbc.com/2026/10/29/microsoft-google-ai-capex-estimates.html) — 120853B, 2026-11-05T05:26:23Z, `raw/art8_AI_buildout_hits_snag_as_Google_and_Mi.html`
- [art_Why_AI_is_boosting_Metas_ad_business](https://www.cnbc.com/2026/11/01/ai-meta-ads-google-search.html) — 134187B, 2026-11-05T05:12:29Z, `raw/art_Why_AI_is_boosting_Metas_ad_business.html`
- [art_Google_says_it_can_build_data_centers_th](https://www.cnbc.com/2026/10/19/how-data-centers-are-reshaping-americas-aging-grid-pine-island-minnesota-google.html) — 125740B, 2026-11-05T05:12:01Z, `raw/art_Google_says_it_can_build_data_centers_th.html`
- [art_Google_responds_to_political_backlash](https://www.cnbc.com/2026/11/03/google-responds-to-outrage-over-removing-search-in-schools-that-ban-ai.html) — 118737B, 2026-11-05T05:11:49Z, `raw/art_Google_responds_to_political_backlash.html`
- [art_Google_alters_its_cloud_playbook](https://www.cnbc.com/2026/10/28/google-alters-cloud-playbook-turning-to-partners-to-sell-more-ai-chips.html) — 124343B, 2026-11-05T05:11:06Z, `raw/art_Google_alters_its_cloud_playbook.html`

### computerworld.com (1)
- [art_Hello_Googlebook:_The_complete_FAQ](https://www.computerworld.com/article/4224465/googlebook-android-chromeos-faq.html) — 82960B, 2026-11-05T05:11:51Z, `raw/art_Hello_Googlebook__The_complete_FAQ.html`

### crn.com (1)
- [art_Google_Cloud_Sales_Explode_103_Percent](https://www.crn.com/news/cloud/2026/google-cloud-sales-explode-103-percent-as-ceo-touts-tpu-extraordinary-demand) — 4100B, 2026-11-05T05:10:51Z, `raw/art_Google_Cloud_Sales_Explode_103_Percent.html`

### cryptobriefing.com (3)
- [art_Alphabet_starts_selling_its_TPU_chips](https://cryptobriefing.com/alphabet-begins-selling-tpu-hardware/) — 45941B, 2026-11-05T05:11:04Z, `raw/art_Alphabet_starts_selling_its_TPU_chips.html`
- [art_Google_deepens_Anthropic_TPU_partnership](https://cryptobriefing.com/google-anthropic-broadcom-tpu-deal/) — 45314B, 2026-11-05T05:11:01Z, `raw/art_Google_deepens_Anthropic_TPU_partnership.html`
- [art_Alphabet_reaffirms_$195_billion](https://cryptobriefing.com/alphabet-reaffirms-capex-guidance-ai-spending/) — 44329B, 2026-11-05T05:11:00Z, `raw/art_Alphabet_reaffirms__195_billion.html`

### data.sec.gov (1)
- [sec_submissions_alphabet](https://data.sec.gov/submissions/CIK0001652044.json) — 23228B, 2026-11-05T04:56:43Z, `raw/sec_submissions_alphabet.json`

### democracynow.org (1)
- [art_Meet_AI_Engineer_Who_Resigned_from_DeepM](https://www.democracynow.org/2026/10/29/sofia_liguori_google_military_tech_ai) — 54826B, 2026-11-05T05:11:25Z, `raw/art_Meet_AI_Engineer_Who_Resigned_from_DeepM.html`

### digitalmusicnews.com (1)
- [art10_Billboard_Owner_Penske_Media_Officially_](https://www.digitalmusicnews.com/2026/11/04/penske-media-google-lawsuit-appeal/) — 39840B, 2026-11-05T06:03:50Z, `raw/art10_Billboard_Owner_Penske_Media_Officially_.html`

### electrek.co (1)
- [art_Waymo_adds_nearly_250_square_miles](https://electrek.co/2026/10/27/waymo-expansion-250-square-miles-five-cities/) — 46665B, 2026-11-05T05:11:57Z, `raw/art_Waymo_adds_nearly_250_square_miles.html`

### finance.yahoo.com (5)
- [art10_Market_Chatter_Alphabets_Isomorphic_Labs](https://finance.yahoo.com/technology/ai/articles/market-chatter-alphabet-apos-isomorphic-001253308.html) — 175055B, 2026-11-05T06:03:55Z, `raw/art10_Market_Chatter_Alphabets_Isomorphic_Labs.html`
- [yahoo_q3_transcript](https://finance.yahoo.com/markets/stocks/articles/alphabet-googl-q3-2026-earnings-054403755.html) — 200554B, 2026-11-05T05:31:13Z, `raw/yahoo_q3_transcript.html`
- [yahoo_tpu_second](https://finance.yahoo.com/technology/ai/articles/alphabet-tpus-now-rank-second-175828771.html) — 179300B, 2026-11-05T05:31:01Z, `raw/yahoo_tpu_second.html`
- [art_Alphabet_launches_€6_billion_bond_sale](https://finance.yahoo.com/technology/ai/articles/alphabet-launches-6-billion-bond-011929014.html) — 174860B, 2026-11-05T05:12:32Z, `raw/art_Alphabet_launches__6_billion_bond_sale.html`
- [art_Pichai_Says_Google_Cloud_Is_Giving_Up_Re](https://finance.yahoo.com/markets/stocks/articles/pichai-says-google-cloud-giving-200139123.html) — 178442B, 2026-11-05T05:12:19Z, `raw/art_Pichai_Says_Google_Cloud_Is_Giving_Up_Re.html`

### gadgetreview.com (2)
- [gadgetreview_deepmind_quit](https://www.gadgetreview.com/google-deepmind-safety-researcher-quits-over-ai-existential-risk) — 81142B, 2026-11-05T05:31:17Z, `raw/gadgetreview_deepmind_quit.html`
- [art8_Google_DeepMind_Safety_Researcher_Quit](https://www.gadgetreview.com/google-deepmind-safety-researcher-quits-over-ai-existential-risk) — 81143B, 2026-11-05T05:26:41Z, `raw/art8_Google_DeepMind_Safety_Researcher_Quit.html`

### gizmodo.com (2)
- [gizmodo_hassabis](https://gizmodo.com/google-deepmind-boss-demis-hassabis-steps-down-from-ceo-role-2000794979) — 55011B, 2026-11-05T05:30:51Z, `raw/gizmodo_hassabis.html`
- [art_Lenovo_Googlebook_15_Review:_The_Costs](https://gizmodo.com/lenovo-googlebook-15-review-2000825563) — 65439B, 2026-11-05T05:12:51Z, `raw/art_Lenovo_Googlebook_15_Review__The_Costs.html`

### gultsch.de (1)
- [gultsch_play](https://gultsch.de/posts/breaking-up-with-google-play/) — 5379B, 2026-11-05T05:21:56Z, `raw/gultsch_play.html`

### ibtimes.co.uk (1)
- [art10_What_Took_Halifax_Revolut_Down](https://www.ibtimes.co.uk/google-cloud-outage-uk-banks-court-hearings-1827001) — 66520B, 2026-11-05T06:03:45Z, `raw/art10_What_Took_Halifax_Revolut_Down.html`

### insideevs.com (1)
- [insideevs_waymo_uber](https://insideevs.com/news/814451/waymo-uber-robotaxi-partnership-is-ending/) — 124366B, 2026-11-05T05:30:07Z, `raw/insideevs_waymo_uber.html`

### kadoa.com (1)
- [kadoa_search_below_half](https://www.kadoa.com/companies/insights/google-search-below-half) — 6982B, 2026-11-05T05:22:14Z, `raw/kadoa_search_below_half.html`

### livemint.com (1)
- [art_Google_layoffs:_4500_workers_seek_guara](https://www.livemint.com/news/trends/google-layoffs-4-500-workers-seek-guaranteed-severance-voluntary-buyouts-in-petition-to-sundar-pichai-11784630461938.html) — 45774B, 2026-11-05T05:11:23Z, `raw/art_Google_layoffs__4500_workers_seek_guara.html`

### mashable.com (1)
- [art_Even_more_ads_are_coming_to_Google_searc](https://mashable.com/tech/more-ads-are-coming-to-google-search-ai-mode) — 47195B, 2026-11-05T05:12:23Z, `raw/art_Even_more_ads_are_coming_to_Google_searc.html`

### msn.com (14)
- [art10_Walmart_expands_drone_delivery_to_2_majo](https://www.msn.com/en-us/news/other/walmart-expands-drone-delivery-to-2-major-us-cities/ar-AA2dLhv7) — 15810B, 2026-11-05T06:04:14Z, `raw/art10_Walmart_expands_drone_delivery_to_2_majo.html`
- [art10_Reddit_is_going_logged-in_only](https://www.msn.com/en-us/news/other/reddit-is-going-logged-in-only-blame-google-ai-overviews/ar-AA2gq6cs) — 15747B, 2026-11-05T06:04:11Z, `raw/art10_Reddit_is_going_logged-in_only.html`
- [art10_Voters_deliver_AI_earthquake](https://www.msn.com/en-us/news/other/voters-deliver-ai-earthquake-with-data-center-limits/ar-AA2gKGXq) — 15702B, 2026-11-05T06:04:07Z, `raw/art10_Voters_deliver_AI_earthquake.html`
- [art10_Nessel_wants_a_do-over](https://www.msn.com/en-us/technology/tech-companies/nessel-wants-a-do-over-on-dte-s-google-data-center-deal/ar-AA2grwgj) — 15821B, 2026-11-05T06:04:05Z, `raw/art10_Nessel_wants_a_do-over.html`
- [art10_Google_AI_summaries_French_dailies_file_](https://www.msn.com/en-xl/news/other/google-ai-summaries-french-daily-newspapers-file-complaint-with-competition-authority/ar-AA29R05N) — 15753B, 2026-11-05T06:04:04Z, `raw/art10_Google_AI_summaries_French_dailies_file_.html`
- [art8_Google_expands_AI_Search_ads_globally](https://www.msn.com/en-us/technology/tech-companies/google-expands-ai-search-ads-globally-as-core-ad-growth-slows/ar-AA2ghDB4) — 15783B, 2026-11-05T05:26:34Z, `raw/art8_Google_expands_AI_Search_ads_globally.html`
- [art8_Waymo_co-CEO_addresses_scrapped_Uber_d](https://www.msn.com/en-us/news/other/waymo-co-ceo-addresses-scrapped-uber-deal-as-rivalry-between-rideshare-giants-heats-up-it-was-a-crapshoot/ar-AA2gLigj) — 15853B, 2026-11-05T05:26:29Z, `raw/art8_Waymo_co-CEO_addresses_scrapped_Uber_d.html`
- [art_Anthropic_partners_face_enormous_counter](https://www.msn.com/en-us/news/other/anthropic-partners-face-enormous-counterparty-risk/ar-AA2gqmk9) — 15755B, 2026-11-05T05:12:55Z, `raw/art_Anthropic_partners_face_enormous_counter.html`
- [art_Dell_XPS_Googlebook_Review](https://www.msn.com/en-us/news/other/dell-xps-googlebook-review-beautiful-hardware-for-a-useless-platform/ar-AA2gAUfz) — 15724B, 2026-11-05T05:12:52Z, `raw/art_Dell_XPS_Googlebook_Review.html`
- [art_Thore_Graepel_leaves_DeepMind](https://www.msn.com/en-us/technology/artificial-intelligence/thore-graepel-leaves-deepmind-alphago-co-creator-bets-structured-search-over-llm-scaling/ar-AA2bKCX6) — 15744B, 2026-11-05T05:12:48Z, `raw/art_Thore_Graepel_leaves_DeepMind.html`
- [art_DuckDuckGo_courts_schools_as_Google_ties](https://www.msn.com/en-us/news/other/duckduckgo-courts-schools-as-google-ties-search-access-to-ai-features/ar-AA2gMSbn) — 15833B, 2026-11-05T05:12:33Z, `raw/art_DuckDuckGo_courts_schools_as_Google_ties.html`
- [art_Waymo_locks_in_$5B_loan_from_Blackstone](https://www.msn.com/en-us/news/other/waymo-locks-in-5b-loan-from-blackstone-pimco-to-fuel-robotaxi-expansion/ar-AA2dPGyx) — 15814B, 2026-11-05T05:12:20Z, `raw/art_Waymo_locks_in__5B_loan_from_Blackstone.html`
- [art_How_Google_is_bucking_tech_industrys_la](https://www.msn.com/en-in/news/other/how-google-is-bucking-tech-industrys-layoff-trend-adds-10k-employees-in-six-months-with-different-approach-explained/ar-AA2gpZhr) — 15801B, 2026-11-05T05:11:31Z, `raw/art_How_Google_is_bucking_tech_industrys_la.html`
- [art_Google_Cloud_crosses_24%_of_Alphabet_rev](https://www.msn.com/en-us/money/other/google-cloud-crosses-24-of-alphabet-revenue-as-spacex-writedown-triggers-first-miss-in-four-years/ar-AA2gnQe5) — 15931B, 2026-11-05T05:11:07Z, `raw/art_Google_Cloud_crosses_24__of_Alphabet_rev.html`

### news.google.com (61)
- [gn2_alphabet_analyst](https://news.google.com/rss/search?q=Alphabet+analysts+downgrade+price+target+November+2026+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 9946B, 2026-11-05T05:10:32Z, `raw/gn2_alphabet_analyst.xml`
- [gn2_google_search_ads_publishers](https://news.google.com/rss/search?q=Google+Zero+click+search+publishers+revenue+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 9152B, 2026-11-05T05:10:29Z, `raw/gn2_google_search_ads_publishers.xml`
- [gn2_deepmind_military](https://news.google.com/rss/search?q=Google+DeepMind+Pentagon+military+contract+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 6670B, 2026-11-05T05:10:26Z, `raw/gn2_deepmind_military.xml`
- [gn2_google_health](https://news.google.com/rss/search?q=Google+AI+health+guidance+framework+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 8097B, 2026-11-05T05:10:22Z, `raw/gn2_google_health.xml`
- [gn2_gemini_app_1b](https://news.google.com/rss/search?q=Gemini+app+one+billion+users+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 9933B, 2026-11-05T05:10:16Z, `raw/gn2_gemini_app_1b.xml`
- [gn2_epic_play](https://news.google.com/rss/search?q=Google+Play+Epic+settlement+sideloading+fees+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 3654B, 2026-11-05T05:10:13Z, `raw/gn2_epic_play.xml`
- [gn2_youtube_tv](https://news.google.com/rss/search?q=YouTube+TV+NFL+creators+revenue+share+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 6167B, 2026-11-05T05:10:11Z, `raw/gn2_youtube_tv.xml`
- [gn2_employee_ai](https://news.google.com/rss/search?q=Google+employees+AI+coding+internal+tools+productivity+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 9363B, 2026-11-05T05:10:05Z, `raw/gn2_employee_ai.xml`
- [gn2_preferred](https://news.google.com/rss/search?q=Alphabet+preferred+stock+offering+investors+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 8551B, 2026-11-05T05:10:01Z, `raw/gn2_preferred.xml`
- [gn2_dc_opposition](https://news.google.com/rss/search?q=Google+data+center+opposition+residents+water+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 10352B, 2026-11-05T05:09:56Z, `raw/gn2_dc_opposition.xml`
- [gn2_crux](https://news.google.com/rss/search?q=Crux+AI+Blackstone+Google+joint+venture+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 4186B, 2026-11-05T05:09:54Z, `raw/gn2_crux.xml`
- [gn2_nvidia_tpu](https://news.google.com/rss/search?q=Google+TPU+Nvidia+competition+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 5998B, 2026-11-05T05:09:50Z, `raw/gn2_nvidia_tpu.xml`
- [gn2_trump_google](https://news.google.com/rss/search?q=Trump+Google+antitrust+Section+301+Europe+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 2978B, 2026-11-05T05:09:48Z, `raw/gn2_trump_google.xml`
- [gn2_india_cci](https://news.google.com/rss/search?q=Google+India+CCI+Play+Store+ruling+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 6495B, 2026-11-05T05:09:43Z, `raw/gn2_india_cci.xml`
- [gn2_waymo_rides](https://news.google.com/rss/search?q=Waymo+weekly+rides+record+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 9102B, 2026-11-05T05:09:39Z, `raw/gn2_waymo_rides.xml`
- [gn2_chrome_share](https://news.google.com/rss/search?q=Google+Chrome+browser+market+share+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 6017B, 2026-11-05T05:09:35Z, `raw/gn2_chrome_share.xml`
- [gn2_publishers](https://news.google.com/rss/search?q=Google+AI+Overviews+publishers+traffic+lawsuit+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 9117B, 2026-11-05T05:09:31Z, `raw/gn2_publishers.xml`
- [gn2_search_share2](https://news.google.com/rss/search?q=Google+search+share+StatCounter+decline+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 2458B, 2026-11-05T05:09:26Z, `raw/gn2_search_share2.xml`
- [gn2_aimode_users](https://news.google.com/rss/search?q=Google+AI+Mode+users+monthly+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 7963B, 2026-11-05T05:09:20Z, `raw/gn2_aimode_users.xml`
- [gn2_carbon](https://news.google.com/rss/search?q=Gemini+4+Carbon+benchmark+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 24559B, 2026-11-05T05:09:17Z, `raw/gn2_carbon.xml`
- [gn2_argon](https://news.google.com/rss/search?q=Gemini+4+Argon+launch+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 27540B, 2026-11-05T05:09:14Z, `raw/gn2_argon.xml`
- [gn2_gemini_enterprise](https://news.google.com/rss/search?q=Gemini+Enterprise+Google+Workspace+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 11547B, 2026-11-05T05:09:09Z, `raw/gn2_gemini_enterprise.xml`
- [gn2_kurian](https://news.google.com/rss/search?q=Thomas+Kurian+Google+Cloud+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 8832B, 2026-11-05T05:09:05Z, `raw/gn2_kurian.xml`
- [gn2_jeffdean](https://news.google.com/rss/search?q=Jeff+Dean+leaves+Google+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 6416B, 2026-11-05T05:09:01Z, `raw/gn2_jeffdean.xml`
- [gn2_hassabis](https://news.google.com/rss/search?q=Demis+Hassabis+Google+DeepMind+CEO+role+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 3999B, 2026-11-05T05:08:54Z, `raw/gn2_hassabis.xml`
- [gn2_otherbets2](https://news.google.com/rss/search?q=Alphabet+Other+Bets+losses+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 6974B, 2026-11-05T05:08:52Z, `raw/gn2_otherbets2.xml`
- [gn2_verily](https://news.google.com/rss/search?q=Verily+Alphabet+health+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 5167B, 2026-11-05T05:08:49Z, `raw/gn2_verily.xml`
- [gn2_isomorphic](https://news.google.com/rss/search?q=Isomorphic+Labs+drug+discovery+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 10370B, 2026-11-05T05:08:46Z, `raw/gn2_isomorphic.xml`
- [gn2_wing](https://news.google.com/rss/search?q=Wing+drone+delivery+Alphabet+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 7004B, 2026-11-05T05:08:44Z, `raw/gn2_wing.xml`
- [gn2_gfiber](https://news.google.com/rss/search?q=Alphabet+G+Fiber+sale+divestiture+when%3A90d&hl=en-US&gl=US&ceid=US:en) — 705B, 2026-11-05T05:08:41Z, `raw/gn2_gfiber.xml`
- [gn_other_bets](https://news.google.com/rss/search?q=Alphabet+Other+Bets+Verily+Wing+Isomorphic+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 1097B, 2026-11-05T05:02:39Z, `raw/gn_other_bets.xml`
- [gn_gemini_schools](https://news.google.com/rss/search?q=Google+schools+AI+Search+disable+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 16044B, 2026-11-05T05:02:35Z, `raw/gn_gemini_schools.xml`
- [gn_pichai](https://news.google.com/rss/search?q=Sundar+Pichai+interview+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 13240B, 2026-11-05T05:02:31Z, `raw/gn_pichai.xml`
- [gn_suncatcher](https://news.google.com/rss/search?q=Google+Project+Suncatcher+satellite+TPU+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 20924B, 2026-11-05T05:02:29Z, `raw/gn_suncatcher.xml`
- [gn_energy](https://news.google.com/rss/search?q=Google+data+center+electricity+utility+bills+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 10533B, 2026-11-05T05:02:26Z, `raw/gn_energy.xml`
- [gn_india](https://news.google.com/rss/search?q=Google+India+CCI+antitrust+Android+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 706B, 2026-11-05T05:02:22Z, `raw/gn_india.xml`
- [gn_privacy](https://news.google.com/rss/search?q=Google+privacy+lawsuit+settlement+data+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 4405B, 2026-11-05T05:02:19Z, `raw/gn_privacy.xml`
- [gn_copyright](https://news.google.com/rss/search?q=Google+AI+copyright+lawsuit+authors+ruling+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 6878B, 2026-11-05T05:02:15Z, `raw/gn_copyright.xml`
- [gn_eu_dma](https://news.google.com/rss/search?q=Google+EU+DMA+fine+European+Commission+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 3584B, 2026-11-05T05:02:08Z, `raw/gn_eu_dma.xml`
- [gn_adtech](https://news.google.com/rss/search?q=Google+ad+tech+case+ruling+break+up+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 6252B, 2026-11-05T05:02:05Z, `raw/gn_adtech.xml`
- [gn_antitrust_us](https://news.google.com/rss/search?q=Google+antitrust+remedy+appeal+Chrome+divestiture+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 1117B, 2026-11-05T05:02:03Z, `raw/gn_antitrust_us.xml`
- [gn_union](https://news.google.com/rss/search?q=Alphabet+Workers+Union+Google+employees+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 7539B, 2026-11-05T05:02:00Z, `raw/gn_union.xml`
- [gn_layoffs](https://news.google.com/rss/search?q=Google+layoffs+restructuring+2026+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 11016B, 2026-11-05T05:01:54Z, `raw/gn_layoffs.xml`
- [gn_googlebook](https://news.google.com/rss/search?q=Googlebook+Google+laptop+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 24173B, 2026-11-05T05:01:52Z, `raw/gn_googlebook.xml`
- [gn_chromeos](https://news.google.com/rss/search?q=Google+Android+ChromeOS+merge+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 3299B, 2026-11-05T05:01:48Z, `raw/gn_chromeos.xml`
- [gn_android_pixel](https://news.google.com/rss/search?q=Pixel+11+Android+17+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 12758B, 2026-11-05T05:01:44Z, `raw/gn_android_pixel.xml`
- [gn_waymo](https://news.google.com/rss/search?q=Waymo+expansion+robotaxi+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 25622B, 2026-11-05T05:01:42Z, `raw/gn_waymo.xml`
- [gn_youtube](https://news.google.com/rss/search?q=YouTube+revenue+TV+advertising+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 9555B, 2026-11-05T05:01:37Z, `raw/gn_youtube.xml`
- [gn_tpu](https://news.google.com/rss/search?q=Google+TPU+Anthropic+Meta+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 10836B, 2026-11-05T05:01:31Z, `raw/gn_tpu.xml`
- [gn_google_cloud](https://news.google.com/rss/search?q=Google+Cloud+revenue+backlog+TPU+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 8528B, 2026-11-05T05:01:28Z, `raw/gn_google_cloud.xml`
- [gn_deepmind_talent](https://news.google.com/rss/search?q=Google+DeepMind+researcher+leaves+poached+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 706B, 2026-11-05T05:01:20Z, `raw/gn_deepmind_talent.xml`
- [gn_antigravity](https://news.google.com/rss/search?q=Google+Antigravity+IDE+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 3367B, 2026-11-05T05:01:15Z, `raw/gn_antigravity.xml`
- [gn_gemini4](https://news.google.com/rss/search?q=%22Gemini+4%22+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 24703B, 2026-11-05T05:01:13Z, `raw/gn_gemini4.xml`
- [gn_gemini](https://news.google.com/rss/search?q=Gemini+Google+app+users+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 9954B, 2026-11-05T05:01:10Z, `raw/gn_gemini.xml`
- [gn_google_ads](https://news.google.com/rss/search?q=Google+advertising+revenue+AI+Mode+ads+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 14427B, 2026-11-05T05:01:06Z, `raw/gn_google_ads.xml`
- [gn_google_search_share](https://news.google.com/rss/search?q=Google+search+market+share+ChatGPT+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 8696B, 2026-11-05T05:01:02Z, `raw/gn_google_search_share.xml`
- [gn_google_search_decline](https://news.google.com/rss/search?q=Google+Search+AI+Overviews+traffic+publishers+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 13695B, 2026-11-05T05:00:59Z, `raw/gn_google_search_decline.xml`
- [gn_alphabet_bonds](https://news.google.com/rss/search?q=Alphabet+bond+sale+debt+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 9031B, 2026-11-05T05:00:56Z, `raw/gn_alphabet_bonds.xml`
- [gn_alphabet_capex](https://news.google.com/rss/search?q=Alphabet+capex+data+center+spending+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 9432B, 2026-11-05T05:00:54Z, `raw/gn_alphabet_capex.xml`
- [gn_alphabet_earnings](https://news.google.com/rss/search?q=%22Alphabet%22+earnings+Q3+2026+when%3A45d&hl=en-US&gl=US&ceid=US:en) — 11952B, 2026-11-05T05:00:50Z, `raw/gn_alphabet_earnings.xml`
- [gnews_alphabet_rss](https://news.google.com/rss/search?q=Alphabet+when:30d&hl=en-US&gl=US&ceid=US:en) — 24802B, 2026-11-05T04:56:57Z, `raw/gnews_alphabet_rss.xml`

### nypost.com (1)
- [art_Google_DeepMind_researcher_quits_with_ch](https://nypost.com/2026/09/15/business/google-deepmind-researcher-quits-with-chilling-ai-warning-it-could-kill-us-all/) — 148952B, 2026-11-05T05:11:29Z, `raw/art_Google_DeepMind_researcher_quits_with_ch.html`

### old.reddit.com (1)
- [reddit_r_google_top_month](https://old.reddit.com/r/google/top.json?t=month&limit=40) — 67599B, 2026-11-05T04:57:02Z, `raw/reddit_r_google_top_month.html`

### osnews.com (1)
- [osnews_chromebook_updates](https://www.osnews.com/story/146052/google-breaks-promise-to-provide-10-years-of-updates-to-chromebooks/) — 33847B, 2026-11-05T05:22:07Z, `raw/osnews_chromebook_updates.html`

### politico.eu (1)
- [art_Top_EU_court_upholds_Google_Android_fine](https://www.politico.eu/article/top-eu-court-upholds-google-android-fine-in-landmark-antitrust-case/) — 52964B, 2026-11-05T05:11:33Z, `raw/art_Top_EU_court_upholds_Google_Android_fine.html`

### pymnts.com (1)
- [pymnts_ai_exposure](https://www.pymnts.com/news/artificial-intelligence/2026/googles-ai-exposure-exceeds-the-1-trillion-it-reported/) — 35128B, 2026-11-05T05:31:06Z, `raw/pymnts_ai_exposure.html`

### sancho.bearblog.dev (1)
- [essay_google_weird](https://sancho.bearblog.dev/google-weird/) — 5400B, 2026-11-05T05:21:54Z, `raw/essay_google_weird.html`

### seroundtable.com (2)
- [seroundtable_aimode_ads](https://www.seroundtable.com/google-expands-ads-ai-mode-42412.html) — 25167B, 2026-11-05T05:30:24Z, `raw/seroundtable_aimode_ads.html`
- [art_Google_AI_Overview_Lawsuit_Dismissed](https://www.seroundtable.com/google-ai-overview-lawsuit-dismissed-42211.html) — 27463B, 2026-11-05T05:12:15Z, `raw/art_Google_AI_Overview_Lawsuit_Dismissed.html`

### techcrunch.com (2)
- [art8_YouTube_now_requires_creators_to_have_](https://techcrunch.com/2026/08/10/youtube-now-requires-creators-to-have-twice-as-many-watch-hours-to-start-earning-money/) — 47360B, 2026-11-05T05:26:17Z, `raw/art8_YouTube_now_requires_creators_to_have_.html`
- [techcrunch_google_rss](https://techcrunch.com/tag/google/feed/) — 4500B, 2026-11-05T04:56:52Z, `raw/techcrunch_google_rss.xml`

### techtimes.com (1)
- [art8_Googlebook_Launches_at_899](https://www.techtimes.com/articles/328031/20260925/googlebook-launches-899-arm-models-outlast-intel-rivals-six-hours.htm) — 75383B, 2026-11-05T05:26:27Z, `raw/art8_Googlebook_Launches_at_899.html`

### theguardian.com (2)
- [art8_Unions_gain_access_to_thousands_of_Goo](https://www.theguardian.com/politics/2026/nov/02/unions-google-workers-uk-employment-rights) — 54739B, 2026-11-05T05:26:39Z, `raw/art8_Unions_gain_access_to_thousands_of_Goo.html`
- [art_Unions_gain_access_to_thousands_of_Googl](https://www.theguardian.com/politics/2026/nov/02/unions-google-workers-uk-employment-rights) — 54739B, 2026-11-05T05:11:21Z, `raw/art_Unions_gain_access_to_thousands_of_Googl.html`

### theintercept.com (1)
- [intercept_deepmind_resign](https://theintercept.com/2026-10-21/google-deepmind-resign-ai-military-gaza/) — 38165B, 2026-11-05T05:22:19Z, `raw/intercept_deepmind_resign.html`

### thenextweb.com (3)
- [tnw_pentagon_2018](https://thenextweb.com/news/deepmind-union-google-pentagon-ai-military) — 37139B, 2026-11-05T05:22:21Z, `raw/tnw_pentagon_2018.html`
- [tnw_ai_overviews_clicks](https://thenextweb.com/news/google-ai-overviews-publisher-links-search-traffic) — 36834B, 2026-11-05T05:14:14Z, `raw/tnw_ai_overviews_clicks.html`
- [art_EU_says_it_is_in_talks_with_Google](https://thenextweb.com/news/eu-google-dma-fine-talks) — 33799B, 2026-11-05T05:12:13Z, `raw/art_EU_says_it_is_in_talks_with_Google.html`

### theverge.com (11)
- [verge_publishing_column](https://www.theverge.com/column/1017983/google-ai-search-online-publishing) — 63730B, 2026-11-05T05:31:15Z, `raw/verge_publishing_column.html`
- [verge_paying_publishers](https://www.theverge.com/tech/1002665/google-paying-publishers-ai-search-features) — 54271B, 2026-11-05T05:30:46Z, `raw/verge_paying_publishers.html`
- [verge_gmail_photos_ads](https://www.theverge.com/tech/1017600/google-personal-intelligence-privacy-policy-ads-update) — 55493B, 2026-11-05T05:22:05Z, `raw/verge_gmail_photos_ads.html`
- [verge_scraping_optout](https://www.theverge.com/tech/1023763/openai-google-microsoft-ai-scraping-standard-opt-out) — 56711B, 2026-11-05T05:13:59Z, `raw/verge_scraping_optout.html`
- [verge_search_ai_money](https://www.theverge.com/ai-artificial-intelligence/1024862/google-search-ai-overviews-alphabet-earnings-q3) — 65276B, 2026-11-05T05:13:58Z, `raw/verge_search_ai_money.html`
- [verge_openai_search](https://www.theverge.com/ai-artificial-intelligence/1025482/openai-says-chatgpt-is-catching-up-to-google-in-search) — 55495B, 2026-11-05T05:13:57Z, `raw/verge_openai_search.html`
- [verge_schools_search_ai](https://www.theverge.com/tech/1025411/google-turn-off-search-ai-features) — 57113B, 2026-11-05T05:13:55Z, `raw/verge_schools_search_ai.html`
- [verge_suncatcher](https://www.theverge.com/tech/1023528/google-project-suncatcher-ai-satellite-transmission) — 54253B, 2026-11-05T05:13:53Z, `raw/verge_suncatcher.html`
- [verge_android_botnet](https://www.theverge.com/1024807/google-botnet-android-tv-shut-down) — 55191B, 2026-11-05T05:13:51Z, `raw/verge_android_botnet.html`
- [art_Google_is_entirely_disabling_Search_in_s](https://www.theverge.com/tech/1025411/google-turn-off-search-ai-features) — 57077B, 2026-11-05T05:11:43Z, `raw/art_Google_is_entirely_disabling_Search_in_s.html`
- [verge_google_rss](https://www.theverge.com/rss/google/index.xml) — 7756B, 2026-11-05T04:56:54Z, `raw/verge_google_rss.xml`

### ua.news (1)
- [art10_A_Google_Cloud_outage_disrupted_operatio](https://ua.news/en/world/zbii-u-google-cloud-porushiv-robotu-ievropeiskikh-bankiv-ta-servisiv) — 21060B, 2026-11-05T06:03:47Z, `raw/art10_A_Google_Cloud_outage_disrupted_operatio.html`

### unite.ai (1)
- [unite_aimode_ads](https://www.unite.ai/google-rolls-out-ai-mode-ads-in-10-countries-multiturn-ads-in-u-s/) — 106284B, 2026-11-05T05:31:18Z, `raw/unite_aimode_ads.html`

### vizaca.com (1)
- [art_Alphabet_Lost_$410_Billion_in_One_Day](https://www.vizaca.com/technology/alphabet-stock-drop-ai-capex/) — 76803B, 2026-11-05T05:12:54Z, `raw/art_Alphabet_Lost__410_Billion_in_One_Day.html`

### wired.com (2)
- [wired_schools](https://www.wired.com/story/google-is-forcing-ai-overviews-in-classrooms-schools-are-searching-for-a-way-out/) — 186055B, 2026-11-05T05:31:03Z, `raw/wired_schools.html`
- [art_Google_Is_Forcing_AI_Overviews_in_Classr](https://www.wired.com/story/google-is-forcing-ai-overviews-in-classrooms-schools-are-searching-for-a-way-out/) — 186053B, 2026-11-05T05:11:46Z, `raw/art_Google_Is_Forcing_AI_Overviews_in_Classr.html`

### yahoo.com (1)
- [art_Mayor_Zohran_Mamdani_Blasts_Google](https://www.yahoo.com/news/politics/articles/mayor-zohran-mamdani-blasts-google-183639505.html) — 160013B, 2026-11-05T05:12:37Z, `raw/art_Mayor_Zohran_Mamdani_Blasts_Google.html`

### zdnet.com (1)
- [art_HP_Googlebook_14_review](https://www.zdnet.com/tech/hp-googlebook-14-review/) — 73102B, 2026-11-05T05:11:55Z, `raw/art_HP_Googlebook_14_review.html`


## 三、抓取失败或未留档 (记录以备核查)

- art_Google_Overhauls_AI_Leadership — https://www.techrepublic.com/article/news-google-ai-leadership-hassabis-jeff-dean/ — HTTP 403 (2026-11-05T05:11:15Z)
- art_Judge_rules_Google_does_not_have_to_brea — https://thehill.com/policy/technology/6066362-judge-rejects-google-adtech-breakup/ — HTTP 403 (2026-11-05T05:11:35Z)
- art_Trump_fires_back_at_EU_over_Google — https://thehill.com/policy/technology/5988736-trump-eu-google-fine-investigation/ — HTTP 403 (2026-11-05T05:11:40Z)
- art_Waymo_Used_Uber_to_Build_Scale — https://www.inc.com/moses-jeanfrancois/waymo-ends-uber-partnership-robotaxi-app-expansion/91431042 — HTTP 403 (2026-11-05T05:11:58Z)
- art_Google_unveils_Gemini_4_Carbon — https://venturebeat.com/technology/google-unveils-gemini-4-carbon-retaking-the-worlds-no-1-spot-on-updated-harder-benchmarks-but-access-is-limited — HTTP 429 (2026-11-05T05:12:07Z)
- art_Google_Search_Remedies_Too_Weak — https://www.mediapost.com/publications/article/416888/google-search-remedies-too-weak-feds-tell-appeals.html — HTTP 403 (2026-11-05T05:12:11Z)
- art_Judge_approves_$68_million_Google_Assist — https://www.courthousenews.com/judge-approves-68-million-google-assistant-privacy-settlement/ — HTTP 403 (2026-11-05T05:12:16Z)
- art_Google_$8.25M_Childrens_Privacy_Settlem — https://www.mediapost.com/publications/article/419055/google-825m-childrens-privacy-settlement-gains.html — HTTP 403 (2026-11-05T05:12:17Z)
- art_DeepMind_Chief_Scientist_Leaves_To_Start — https://www.mediapost.com/publications/article/417036/deepmind-chief-scientist-leaves-to-start-a-company.html — HTTP 403 (2026-11-05T05:12:40Z)
- tc_googlebook_899 — https://techcrunch.com/2026-09-21/googles-899-googlebook-is-a-bet-that-youll-buy-a-new-laptop-for-gemini/ — HTTP 404 (2026-11-05T05:14:02Z)
- tc_dreambeans_india — https://techcrunch.com/2026-11-02/google-takes-dreambeans-to-india-in-bid-to-bring-ai-generated-personal-stories-to-the-masses/ — HTTP 404 (2026-11-05T05:14:04Z)
- tc_ai_search_ads — https://techcrunch.com/2026-10-28/google-expands-ai-search-ads-globally-as-core-ad-growth-slows/ — HTTP 404 (2026-11-05T05:14:09Z)
- tc_gemini_agent_apps — https://techcrunch.com/2026-10-28/as-ai-agents-reshape-the-web-google-opens-gemini-and-search-to-more-apps/ — HTTP 404 (2026-11-05T05:14:13Z)
- neowin_cloud_outage — https://www.neowin.net/news/google-cloud-outage-takes-down-hsbc-revolut-bank-of-scotland-llyods-equifax-more/ — HTTP 403 (2026-11-05T05:21:57Z)
- guardian_finland_halt — https://www.theguardian.com/technology/2026/oct/06/google-datacentres-finland-temporary-halt-environmental-impact-assess — HTTP 404 (2026-11-05T05:22:01Z)
- techspot_finland_forest — https://www.techspot.com/news/114100-google-cleared-300-hectares-finnish-forest-data-center.html — HTTP 403 (2026-11-05T05:22:02Z)
- openai_on_gcp — https://openai.com/index/openai-models-google-cloud/ — HTTP 403 (2026-11-05T05:22:08Z)
- wapo_deepmind_protest — https://www.washingtonpost.com/technology/2026/11/03/google-deepmind-staff-protest-lifetime-ban-criticizing-company/ — HTTP 000 (2026-11-05T05:22:22Z)
- art8_Google_Just_Put_1_Executive_in_Charge_ — https://www.inc.com/georgia-fearn/google-put-one-executive-in-charge-of-gemini-after-eight-prominent-researchers-leave/91385451 — HTTP 403 (2026-11-05T05:26:15Z)
- art8_Google_Cloud_power_event_knocks_out_UK — https://www.computerweekly.com/news/366652539/Google-Cloud-power-event-knocks-out-UK-banks-courts-and-couriers — HTTP 403 (2026-11-05T05:26:18Z)
- art8_Europes_Financial_Regulators_Query_Go — https://money.usnews.com/investing/news/articles/2026-10-21/europes-financial-regulators-query-google-over-cloud-outage-that-hit-banks — HTTP 000 (2026-11-05T05:26:19Z)
- art8_Googlebook_officially_launched_Price — https://www.zeebiz.com/technology/news-googlebook-officially-launched-price-specifications-gemini-ai-features-and-chromebook-comparison-402600 — HTTP 403 (2026-11-05T05:26:24Z)
- art8_Waymo_to_end_exclusive_Uber_robotaxi_t — https://seekingalpha.com/news/4665457-waymo-to-end-exclusive-uber-robotaxi-tie-up-in-two-us-cities — HTTP 403 (2026-11-05T05:26:28Z)
- art8_Google_Should_Relax_Ad_Tech_Rules_App — https://money.usnews.com/investing/news/articles/2026-09-16/google-should-appoint-antitrust-compliance-officer-us-judge-says-in-ad-tech-case — HTTP 000 (2026-11-05T05:26:33Z)
- art8_Alphabet_kicks_off_6_billion_bond_sal — https://www.sacbee.com/news/business/article317882854.html — HTTP 000 (2026-11-05T05:26:37Z)
- cnbc_waymo_overseas — https://www.cnbc.com/2026-10-28/as-waymo-expands-overseas-it-remains-a-niche-cash-burning-business.html — HTTP 404 (2026-11-05T05:30:10Z)
- invezz_spacex_shock — https://invezz.com/news/2026-10-29/how-elon-musks-spacex-triggered-an-11-billion-earnings-shock-for-alphabet/ — HTTP 403 (2026-11-05T05:30:47Z)
- stat_isomorphic — https://www.statnews.com/2026-10-21/whats-the-deal-with-isomorphic-labs-ai-prognosis/ — HTTP 403 (2026-11-05T05:30:48Z)
- cw_cloud_outage — https://www.computerweekly.com/news/366652539/Google-Cloud-power-event-knocks-out-UK-banks-courts-and-couriers — HTTP 403 (2026-11-05T05:30:59Z)
- art10_Anthropic_Enters_The_AI_Chip_Race — https://www.forbes.com/sites/jonmarkman/2026/08/06/anthropic-enters-the-ai-chip-race-with-in-house-chip-team/ — HTTP 403 (2026-11-05T06:03:56Z)
- art10_Tech_Layoffs_2026_196000_Workers — https://www.techrepublic.com/article/news-tech-layoffs-2026-companies-cutting-jobs/ — HTTP 403 (2026-11-05T06:03:58Z)
- art10_Waymo_and_Toyota_to_Test_Self-Driving_SU — https://www.techrepublic.com/article/news-waymo-toyota-bz4x-robotaxi-apac-japan-2027/ — HTTP 403 (2026-11-05T06:04:02Z)
- art10_YouTube_Doubles_The_Monetization_Bar — https://www.forbes.com/sites/gabrielalinzainescu/2026/08/11/youtube-doubles-the-monetization-bar-for-new-creators/ — HTTP 403 (2026-11-05T06:04:12Z)
- art10_US_government_Google_join_Zuckerberg-bac — https://www.reuters.com/business/healthcare-pharmaceuticals/us-government-google-join-zuckerberg-backed-biohub-18-billion-push-ai-biology-2026-10-07/ — HTTP 401 (2026-11-05T06:04:17Z)
