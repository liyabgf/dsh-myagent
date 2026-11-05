# 搜集信息 — Ticket b356ac649bc46a144c38f9b4b6619175

**任务**：搜集真实网络渠道，取得谷歌系（Alphabet / Google）各部门的最新变动与社会反馈；形成简报并简略分析其内部矛盾与外部矛盾。
**范围要求**：信息源必须真实可追溯。
**采集时间**：2026-11-05 12:52–14:05 (UTC+8)｜**数据主体时段**：2026 年 8–11 月（Q3 2026 财报季），必要处回溯至 2026 年 1 月。

## 先读什么

1. **[brief.md](brief.md)** — 简报正文（中文）。九节：摘要 → 集团财务与融资拐点 → 七个部门/业务线的最新变动 → 监管与法律战线 → 分层社会反馈（含 Hacker News 量化表）→ 内部矛盾 8 条 → 外部矛盾 8 条 → 带时间锚的后续观察点 → 方法与局限。末尾 **附录 A：断言—来源对照表（113 行）**，每行给出断言、原始 URL、本地留档路径。
2. **[sources/registry.md](sources/registry.md)** — 全部 279 个成功抓取页面的登记表：URL、HTTP 状态、字节数、抓取时间（UTC）、本地路径；另列 34 条失败/未留档记录（付费墙、反爬、JS 渲染）。
3. **[digests/news_digest.tsv](digests/news_digest.tsv)** — 2,549 条新闻聚合结果（Bing News RSS + Google News RSS，约 90 组查询词），字段：日期、主题、引擎、媒体名、标题、原始 URL。

## 目录结构

```
brief.md                  简报正文 + 附录 A 断言—来源对照表
README.md                 本文件
raw/                      269 个原始抓取页面（HTML/XML/JSON，42MB），文件名与 manifest 的 name 列一致
txt/                      raw 中文章页的纯文本转换（便于逐句核对）
digests/news_digest.tsv   新闻聚合检索结果合并表
sources/manifest.csv      抓取总账（name,url,http_code,bytes,content_type,final_url,fetched_at_utc,local_path）
sources/registry.md       人类可读的登记表（由 manifest.csv 生成）
sources/m1.tsv … m10.tsv  各批次抓取清单（可复现）
sources/frags1.txt        按标题片段挑选文章的输入
scripts/fetch.py          抓取器（curl，写入 manifest.csv 并留档 raw/）
scripts/html2txt.py       HTML → 纯文本（跳过 nav/header/footer/script）
scripts/body.py           从纯文本中抽取正文段落
scripts/parse_rss.py      单个 RSS 文件解析
scripts/digest_news.py    合并全部 RSS 归档为 news_digest.tsv（解出 Bing 的真实 URL）
scripts/mk_news_manifest.py / mk_news_manifest2.py / mk_m8.py   查询词 → 抓取清单
scripts/pick_articles.py  按标题片段从 digest 中取出完整 URL
scripts/parse_hn.py       HN Algolia 结果 → 日期/分数/评论数/标题/URL/HN 链接
scripts/gnews_decode.py   Google News 重定向链接解码尝试（本环境返回 302，未成功；已记录）
scripts/mk_registry.py    生成 sources/registry.md
scripts/mk_appendix.py    生成 brief.md 附录 A（URL 与路径直接取自 manifest.csv，避免手抄错误）
```

## 如何复核任一条断言

1. 在 `brief.md` 附录 A 找到该断言行，取其 URL 或本地路径。
2. 本地路径指向 `raw/`（原始字节）与 `txt/`（纯文本）；用 `read` 或 `grep` 直接查看。
3. 若要重新抓取：`python3 scripts/fetch.py sources/m1.tsv`（或对应批次文件），新增记录会追加到 `sources/manifest.csv`。
4. 财务数字的一手来源固定为 SEC 文件：
   - 8-K/EX-99.1 业绩公告：`raw/sec_ex991_q3_2026_earnings.html`
   - 10-Q（含法律事项、Wiz/Intersect 收购、GFiber 持有待售、Crux AI、Waymo 贷款、RPO）：`raw/sec_10q_q3_2026.html`
   - 欧元债最终条款 424B2：`raw/sec_424b2_nov2026.html`
   - 财报电话会实录（第三方转录）：`raw/yahoo_q3_transcript.html`
   凡媒体数字与 SEC 文件不一致，简报以 SEC 文件为准并在正文注明。

## 可信度标注规则（正文中一致使用）

- 〔一手〕：SEC 文件、官方博客（blog.google / deepmind.google / developers.googleblog.com / waymo.com）、财报电话会实录、Artificial Analysis 榜单原文、HN Algolia API 原始 JSON。
- 〔多源〕：两家以上独立媒体，且关键数字互相印证。
- 〔单源〕：仅一家来源；已在正文标明（例如 $84.75B 股权融资计划、或有承诺 $98.5B、2027 FCF −$37B、TPU 销售额的分析师测算）。
- 〔仅标题〕：链接来自已归档的 Bing News / Google News RSS 条目，正文因付费墙或反爬未能留档；此类断言在正文中逐条标注，不作为结论的唯一支撑。

## 已知缺口（不影响主结论，但影响覆盖度）

- Reuters（HTTP 401）、WSJ、Bloomberg、The Information、NYT 部分文章、STAT、abc.xyz（403）、Inc.、The Hill、TechRepublic、MediaPost、ComputerWeekly、Invezz：正文未留档，仅标题可查。
- Reddit：`old.reddit.com` 的 JSON 接口重定向到登录页，社区情绪量化改用 Hacker News（分数/评论数/评论原文均已归档）。
- CourtListener API：401（需 token），法院文书未直接调取；诉讼进展以 10-Q 的 Legal Matters 注记 + 法律媒体为准。
- 未找到 GFiber 出售的买家与对价（仅有一手"持有待售 $7.1B PP&E"披露）。
