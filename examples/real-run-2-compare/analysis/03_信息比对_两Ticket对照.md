# 信息比对：本 Ticket 与「搜集信息」Ticket（b356ac64）的采集结果对照

- 撰写时间：2026-11-05 13:45（Asia/Shanghai）
- 本 Ticket：`信息比对` / 19dd5c9ca7bce11fb2c9f7a2b04728b0，目录 `~/.dsh/state/myagent/work/信息比对-19dd5c9c`
- 对方 Ticket：`搜集信息` / b356ac649bc46a144c38f9b4b6619175，目录 `~/.dsh/state/myagent/work/搜集信息-b356ac64`（下称 [SIB]）
- 采集窗口：两套语料均为 2026-11-05 04:56–05:41 UTC（北京时间 12:56–13:41）抓取，新闻聚合窗口多为过去 30–300 天

## 0. 比对方法与一个必须先说明的限制

两个 Ticket 在 myagent 状态库里都**没有 workId**（`tickets` 表 `json_extract(record,'$.workId')` 为空），`works` 表为空表。因此：

- `myagent_read_artifact` 与 `myagent_note_ticket` 对这两个 Ticket 都不可用（这两个工具只在同一 Work 内生效，无 Work 的 Ticket 会拒绝）。
- 本 Ticket 改为**以只读方式直接读取** [SIB] 目录下的文件（`raw/`、`txt/`、`digests/`、`sources/`）。未向该目录写入任何内容。
- 下文标注 [SIB] 的证据均来自对方目录；标注 [MINE] 的来自本目录；标注 [PRIMARY] 的是一手文件原文（SEC、DOJ、欧盟委员会、英国 CMA）。

统计口径（脚本：[scripts/parse_index.py](../scripts/parse_index.py)、[scripts/filter_legal.py](../scripts/filter_legal.py)）：

| 指标 | 数值 |
|---|---|
| 解析后新闻/条目总数（[sources/index_all.tsv](../sources/index_all.tsv)） | 4,755 行 |
| 其中本 Ticket 采集 | 1,649 行 |
| 其中 [SIB] 采集 | 3,106 行 |
| 法律/监管相关（去重后，[notes/legal_candidates.tsv](../notes/legal_candidates.tsv)） | 748 条 |
| — 仅本 Ticket 命中 | 546 条 |
| — 仅 [SIB] 命中 | 160 条 |
| — 双方均命中 | 42 条 |

## 1. 采集面对比

| 维度 | 本 Ticket（信息比对） | [SIB]（搜集信息） |
|---|---|---|
| 任务目标 | 谷歌系**法律/监管事件**清单 + 与 [SIB] 信息综合，论述谷歌处境 | 谷歌系**全景**：财报、资本开支、AI 竞争、产品、组织、能源 |
| 一手文件（[PRIMARY]） | Alphabet 10-K FY2025 + 10-Q Q3'25/Q1'26/Q2'26/Q3'26 + 8-K/EX-99.1 Q3'26 + 424B2（2026-11-04 €6B 债）；DOJ 案卷 12 份 PDF（终审判决、95 页备忘录意见、上诉书状 2 份、合规报告 2 份、状态会议命令、联合发行许可模板建议等）；欧盟委员会 presscorner 原文 12 份；英国 gov.uk/CMA 原文 9 份 | Alphabet 10-Q Q3'26 + 8-K + EX-99.1 + 424B5/424B2/FWP；Google Blog、DeepMind Blog、Developers Blog、Cloud Blog RSS 与原文 |
| 新闻聚合 | 29 组 Google News 法律关键词查询 + 31 组补充查询（26 组 Google News + 4 组 Bing News + 1 组中文）（[scripts/fetch_stage3.py](../scripts/fetch_stage3.py)）+ Ars Technica/The Register feed | 约 60+ 组 Google News/Bing News 查询（业务主题，见 [SIB] `~/.dsh/state/myagent/work/搜集信息-b356ac64/sources/m3_news.tsv` 与 `m4_news.tsv`） |
| 法律垂类媒体 | 经聚合捕获 MLex、Law.com、Bloomberg Law、Courthouse News、JD Supra、VitalLaw、Bar and Bench、LiveLaw、Law Commentary、Top Class Actions | 少量（`gn_antitrust_us`、`gn_adtech`、`gn_eu_dma`、`gn_copyright`、`gn_privacy`、`gn_india`、`gn_union`） |
| 社交/社区 | 未采 | HN Algolia（Gemini, points>50）、Reddit r/google |
| 体量 | `raw/` 152 个文件（67 个顶层条目，25 MB）；`txt/` 49 个文件（2.7 MB），其中 DOJ 案卷 12 份 PDF 抽取文本约 93 万字符 | `raw/` 279 个文件；`txt/` 95 个文件；`digests/news_digest.tsv` 2,716 行（截至 2026-11-05 14:50，对方仍在写入） |
| 缺口 | 业务侧数据（backlog、capex 指引、模型竞争）主要靠 [SIB] 与自己的 10-Q 抽取 | 法律侧一手文件几乎为零（无判决书、无监管决定原文） |

## 2. 交集：双方独立命中、可互相印证的事实

| 事实 | 本 Ticket 证据 | [SIB] 证据 | 一致性 |
|---|---|---|---|
| 欧盟 DMA 不合规罚款 €890M（Search €460M + Play €430M），2026-07-23 | [PRIMARY] presscorner IP/26/1670 原文（[txt/eu/eu_IP_26_1670.txt](../txt/eu/eu_IP_26_1670.txt)）+ 10-Q Note 10 | `gn_eu_dma`/`bing_eu_dma` 新闻 + 其 10-Q 副本 | 一致（金额、日期、构成完全吻合） |
| 美国 adtech 案不拆分，改行为性救济，2026-09-02 | 10-Q Note 10 + AdExchanger 全文（[txt/articles/adexchanger_brinkema_tldr.txt](../txt/articles/adexchanger_brinkema_tldr.txt)） | `gn_adtech`/`bing_adtech` 多篇 | 一致 |
| Alphabet 2026-11-04 发行 €6,000,000,000 欧元债（7 档，2028–2045） | [PRIMARY] 424B2 原文（[txt/424B2_2026-11-04_000119312526447343.txt](../txt/424B2_2026-11-04_000119312526447343.txt)） | `art_Alphabet_launches__6_billion_bond_sale.txt` | 一致，且本 Ticket 有一手文件 |
| Q3 2026：营收 $127.577B（+25%）、Cloud $30.7B（+103%）、营业利润率 31.8%、净利 $26.2B、EPS $2.12 | [PRIMARY] EX-99.1（[txt/8-K_2026-10-28_000165204426000080_googexhibit991q32026.txt](../txt/8-K_2026-10-28_000165204426000080_googexhibit991q32026.txt)） | `art_Alphabet_reports_Q3_2026_revenue.txt` | 一致 |
| Gemini app 用户达 10 亿（2026-10-28 财报口径） | [PRIMARY] EX-99.1 Pichai 引述 | `bing2_gemini_app_1b`、`gn_gemini` | 一致 |
| Cloud 收入 backlog：截至 2026-09-30 为 $567.7B（其中 Cloud $560.8B） | [PRIMARY] 10-Q 第 2673–2675 行 | `Pluang`（$514B backlog，2026-09-29 报道） | **不一致**，见 §3.7 |
| Epic 和解后 Play 费率下调（2026-06） | 10-Q Note 10（Epic 段） | [SIB] `ars_play_fees`（Ars Technica 2026-06） | 互补 |
| Google 开始向出版商就 AI Overviews 付费测试（2026-09-30） | 未采 | [SIB] `n9to5_ai_overview_payout`、`verge_paying_publishers` | 仅对方命中，与欧盟 2025-12-09 立案直接相关（见 §6） |
| **2026-03-25 洛杉矶陪审团认定 Meta 与 Google（YouTube）在社交媒体成瘾 bellwether 案中承担责任，判赔 $6M**；2026-06-23 YouTube 和解下一批 bellwether | `gn_youth_safety`/`gn3_youth_safety` 等查询命中 AP、Reuters、LA Times、CBS、NYT、The Verge、WSJ、Courthouse News、KQED（≥8 家一致） | `bing3_youth` 查询命中同类报道 | **双方独立命中**，本 Ticket 已写入年表与 [analysis/02_谷歌法律处境综合论述.md](02_谷歌法律处境综合论述.md) §7.5；这是全部战线中唯一已经产生不利于谷歌的**陪审团责任裁决**的一条 |

## 3. 冲突与口径差异（必须用一手文件裁定的 7 处）

**3.1 Gemini 月活口径**
[SIB] 语料同时存在 2026-10-26 标题「Google's Gemini has 400m monthly active users」与 2026-09-05「从 4 亿增长到 10 亿」。裁定：以 EX-99.1（2026-10-28，[PRIMARY]）「the Gemini app has reached one billion users」为准；400M 为旧数据或不同口径（MAU vs 累计/月活用户定义）。

**3.2 Epic v. Google 和解时间线（Alphabet 自身披露前后不一致）**
- 10-K FY2025（2026-02-05 申报，[txt/10-K_2025-12-31_000165204426000018.txt](../txt/10-K_2025-12-31_000165204426000018.txt)）：「In October 2025, we reached a settlement with Epic to modify the remedies… The settlement is contingent on the court approving a proposed modified injunction. Epic and Google filed a joint motion to modify the injunction in November 2025.」
- 10-Q Q1 2026（2026-04-30）起改称：「In March 2026, we reached a settlement with Epic…we withdrew our petition to the US Supreme Court in March 2026, and Epic and Google filed a joint motion to modify the injunction in April 2026.」
- 10-Q Q3 2026（[PRIMARY]）：「In July 2026, Epic and Google jointly withdrew the motion to modify the injunction, and Google is complying with the October 2024 remedies decision.」

裁定：2025-10 的和解方案未能落地（联合动议最终被撤回），2026-03 重新达成和解，**最终结果是 Google 执行 2024-10 的原始禁令**，而非修改后的禁令。只读单份文件（尤其只读 10-K）会得出相反结论。证据：[notes/sec_legal_extracts.md](../notes/sec_legal_extracts.md) 中四期披露并列对比。

**3.3 adtech 判决日期 vs 公开日期**
10-Q 写「In September 2026, the Court issued its remedies decision」；新闻显示 2026-09-02 法院公布简短命令（不剥离 AdX），106 页完整判决先密封、双方 14 天内均未提删节，2026-09-15/16 全文公开。裁定：**判决日 2026-09-02，全文公开日 2026-09-15/16**。年表两行分列。

**3.4 欧盟 adtech 罚款金额**
presscorner IP/25/1992：€2.95 billion；10-Q：「€3.0 billion fine」并「recognized a charge of $3.5 billion in the third quarter of 2025」。裁定：非矛盾，系四舍五入与汇率/利息口径差异。报告应并列写「€2.95B（决定原文）/ $3.5B（Q3 2025 计提）」。

**3.5 PriceRunner 判赔的「事件日」与「入账期」**
10-Q：2026-07 斯德哥尔摩专利与市场法院判给 PriceRunner（Klarna 子公司）约 $2.1B 本金 + 利息与费用，「which we recognized in the second quarter of 2026」。裁定：法律事件发生在 7 月，会计确认在 Q2（作为资产负债表日后调整事项）。年表须区分两列日期，否则会低估或重复计算 Q3 的法律费用。

**3.6「谷歌躲过拆分」的表述风险**
[SIB] 聚合的标题几乎全部是「Google escapes breakup」/「Google Avoids Breakup」。但一手书状显示：DOJ 在 DC 巡回法院交叉上诉中**唯一争点就是地区法院拒绝 payment ban（禁止为默认搜索付费）属于法律错误**（[txt/doj/search_us_opening_brief_cross_appeal_2026-10-21.txt](../txt/doj/search_us_opening_brief_cross_appeal_2026-10-21.txt)，CROSS-APPEAL 部分，No. 26-5023）。裁定：只读 [SIB] 会显著低估上诉阶段的尾部风险——若上诉法院支持 payment ban，Google 与 Apple/浏览器厂商的付费默认模式将整体消失，影响远大于 AdX 是否被剥离。

**3.7 Cloud backlog：$567.7B（10-Q）vs $514B（[SIB] 报道）**
裁定：以 10-Q 原文为准（$567.7B 剩余履约义务，其中 Google Cloud $560.8B，含与 Crux AI 关联交易的 $16.8B）。$514B 应为上季度口径或媒体转引。

## 4. 只有本 Ticket 有的证据（一手文件，[SIB] 完全没有）

1. **DOJ 终审判决全文**（D.D.C. Case 1:20-cv-03010-APM, Doc 1462, 2025-12-05，35 页）：[txt/doj/search_final_judgment_2025-12-05.txt](../txt/doj/search_final_judgment_2025-12-05.txt)
   - III.A–N 禁止性禁令：不得以 Google Play 或任何 Google 应用的授权为条件，捆绑 Search 应用、Chrome、Google Assistant、**任何 Google GenAI 产品**的分发/预装/展示；不得以对价或应用授权为条件，要求设备商/运营商不分发第三方搜索、浏览器、GenAI 产品；涉及付费默认的协议**不得超过 1 年**；III.M 专门规定 Apple（Safari/Siri/Spotlight/隐私模式）默认位不得交叉捆绑，且必须允许 Apple 推广第三方搜索与 GenAI 产品。
   - IV 数据披露：合格竞争者完成认证后 30 天内，Google 须以边际成本提供 Web Search Index 相关数据。
   - V 强制联合发行：5 年期许可、实时 API，提供桌面与移动排名自然结果、查询改写、Local/Maps/Video/Images/Knowledge Panel 内容；延迟与可靠性须与其他用户「功能等同」。
   - VI 搜索文字广告：拍卖变更须定期向技术委员会与原告报告（部分公开），并提供 5 年期搜索文字广告联合发行许可。
   - VII 合规：法院任命 **5 人技术委员会（Technical Committee）** + Google 内部合规官。
   - VIII 期限：录入后 60 天生效，**6 年**期满；X.B 期满后保留管辖 **4 年**。
2. **95 页备忘录意见**（Doc 1461, 2025-12-05）：[txt/doj/search_memorandum_opinion_2025-12-05.txt](../txt/doj/search_memorandum_opinion_2025-12-05.txt)
   - 明确 2025-09-02 救济意见（ECF No. 1435）**驳回**了 Chrome 剥离、强制选择屏、全面禁止付费三项提案；采纳了信息披露、用户数据共享、搜索结果与文字广告强制联合发行、技术委员会。
   - 附录含「原告提案 / Google 提案 / 终判」三方逐条对照，可直接判断法院在哪一侧。
3. **上诉阶段书状**：DC Cir. No. 26-5023
   - 美方开案兼交叉上诉书状（2026-10-21，173 页）：[txt/doj/search_us_opening_brief_cross_appeal_2026-10-21.txt](../txt/doj/search_us_opening_brief_cross_appeal_2026-10-21.txt)
   - 美方交叉上诉答辩书状（2026-10-29）：[txt/doj/search_us_reply_brief_cross_appeal_2026-10-29.txt](../txt/doj/search_us_reply_brief_cross_appeal_2026-10-29.txt)
   - Google 上诉争点（据美方书状目录归纳）：两个相关市场的垄断力认定、浏览器协议是否构成排他、竞争损害认定、以及数据共享/联合发行救济与**将 GenAI 产品纳入救济**是否滥用裁量权。
4. **执行进度证据链**：TC 首批 3 人 2026-01-21 任命（ECF 1474）→ 后 2 人 2026-05-09 任命（ECF 1517）→ 2026-06-15 全部到任 → 2026-07-14 状态会议 → 2026-08-25 命令（TC 员工免于被强制作证，实体为 Remedies Technical Committee, Inc.）→ 2026-09-17 原告第二份合规报告 → 2026-10-09/10-13 联合发行许可模板建议仍因 Google 提出的保密删节而未定稿。文件：[txt/doj/search_plaintiffs_2nd_compliance_report_2026-09-17.txt](../txt/doj/search_plaintiffs_2nd_compliance_report_2026-09-17.txt)、[txt/doj/search_order_2026-08-25_status_conference.txt](../txt/doj/search_order_2026-08-25_status_conference.txt)、[txt/doj/search_syndication_recommendation_2026-10-13.txt](../txt/doj/search_syndication_recommendation_2026-10-13.txt)
5. **欧盟委员会决定原文 12 份**（[txt/eu/](../txt/eu/)）：IP/25/1992（adtech €2.95B）、IP/25/2675（DMA 立案：降权媒体内容）、IP/25/2964（**2025-12-09 就 AI 使用出版商内容与 YouTube 内容立案**）、IP/26/202（DMA 规格化程序：Art 6(7) AI 互操作、Art 6(11) 搜索数据 FRAND）、IP/26/333（Wiz 收购无条件批准）、IP/26/825、IP/26/887、IP/26/1634（2026-07-16 两项**有约束力的规格化措施**）、IP/26/1670（€890M）、IP/25/811、STATEMENT/25/2034、SPEECH/25/2460。
6. **英国 CMA 原文 9 份**（[txt/uk/](../txt/uk/)）：SMS 认定（Search 2025-10-10；移动平台 2025-10-22）、搜索行为要求提案（2026-01-28）、Apple/Google 承诺包（2026-02-10）、**2026-06-03 行为要求：出版商可退出其内容被用于 Google 搜索的 AI 功能（全球首例）**、移动平台行为要求咨询（2026-06-30）、选择屏强化提案（2026-09-23，含把 AI 助理列为可选搜索服务）。
7. **Alphabet 财务口径的法律敞口**（[PRIMARY] 10-Q Q3 2026）：应计罚款与和解 **$13.807B**（2026-09-30），对比 **$15.594B**（2025-12-31）；Q3 2025 计提 $3.5B（欧盟 adtech）；Q2 2026 计提约 $2.1B（PriceRunner）；Q3 2026 计提 $1.0B（DMA €890M）；2026-07 现金支付 **$5.2B**（Android 罚款 + 利息）；Q3 2026 G&A 同比减少 $1.3B，其中法律与其他事项费用减少 $2.1B（去年同期高基数）。
8. **资本承诺对照数**：截至 2026-09-30 长期合同承诺 **$802.1B**；能源担保最高 $16.2B（至 2049-01）；TPU 回购义务最高 $6.6B；前 9 个月购置不动产与设备 **$131.953B**（去年同期 $63.596B）。

## 5. 只有 [SIB] 有的证据（业务侧，本 Ticket 未采集）

- 财务与资本：`art_Alphabet_Raised_41_Billion_in_One_Qua`（单季融资 $41B）、`art_Alphabet_reaffirms__195_billion`（capex 指引重申）、`art_Alphabet_Lost__410_Billion_in_One_Day`（单日市值蒸发）、BBC `Google_value_plunges_by_500bn`
- AI 竞争：Gemini 4 Argon/Carbon 发布与第三方评测（`aa_gemini4_carbon_index`）、`bing2_carbon`（与 Claude Opus 5.5 的对比）、`verge_openai_search`（OpenAI 称 ChatGPT 在搜索上追赶）、DeepMind 人才流失（`art8_Google_Just_Put_1_Executive_in_Charge_`）、Hassabis 卸任 DeepMind CEO（`gizmodo_hassabis`）
- 产品与硬件：Googlebook（$899，2026-09-21 预售、10-04 上市）、ChromeOS 与 Android 融合、Pixel 11/Android 17、TPU 外售（`art_Alphabet_starts_selling_its_TPU_chips`、`yahoo_tpu_second`）
- 基础设施与外部性：Cloud 大规模宕机影响英国银行/法院/快递（`cw_cloud_outage`）、欧洲金融监管问询（`art8_Europes_Financial_Regulators_Query_Go`）、数据中心与电力争议（密歇根 DTE–Google 合同获批、州总检察长要求重审；明尼苏达 Hermantown 让步）、Waymo 结束与 Uber 的独家关系、Waymo 海外扩张仍在烧钱（`cnbc_waymo_overseas`）
- 内容与出版商关系：AI Overviews 付费测试细节（`n9to5_ai_overview_payout`）、出版商退出/付费机制（`verge_paying_publishers`）、OpenAI/Google/Microsoft 的抓取 opt-out 标准（`verge_scraping_optout`）、YouTube 提高创作者变现门槛（`art8_YouTube_now_requires_creators_to_have_`）
- 安全事件：Gemini 模型被入侵、涉及三家公司（Ars Technica，2026-09，事件发生于 2026-05）——这是潜在的数据保护/合同责任来源，本 Ticket 未覆盖

## 6. 交叉推断：用法律事实重估业务事实

| 业务事实（[SIB]） | 对应法律事实（[MINE]/[PRIMARY]） | 交叉结论 |
|---|---|---|
| Cloud 收入 +103%、backlog $560.8B、Crux AI/Blackstone 合资（Blackstone 出资至多 $5.0B，Alphabet 提供至多 $10.0B 数据中心与能源基础设施担保） | DMA Art 6(7) 规格化措施（2026-07-16 有约束力）：第三方 AI 助理须获得与 Gemini 同等的 Android 功能接入（语音唤醒、代客在 App 内执行操作） | Gemini 在欧盟 Android 上的默认优势被制度性削弱；Cloud/AI 增长在欧盟须以互操作性为对价，而美国终判 III.D/III.G 同样把 GenAI 产品纳入禁令范围 |
| Googlebook 硬件上市、Android 与 ChromeOS 融合 | 终判 III.A–D（不得以 Play 授权捆绑 Search/Chrome/Assistant/GenAI 预装）、III.K（付费默认协议 ≤1 年） | 自有硬件是绕开第三方分发限制的合规路径，但判决按「在美国销售的设备」适用，自研硬件同样受限 |
| 与 Apple 的默认搜索协议（历史上每年数百亿美元 TAC） | 终判 III.M（Apple 专有功能默认位不得交叉捆绑、协议 1 年到期、必须允许 Apple 推广第三方搜索/GenAI）+ DOJ 交叉上诉要求 payment ban + Apple 2026-11-03/04 提交书状为付费辩护 | 最大单一分发资产被结构性削弱；若 DC 巡回法院支持 payment ban，付费默认模式整体消失，影响远大于任何罚款 |
| AI Overviews/AI Mode 用户规模、搜索查询量五年最快增长 | 欧盟 2025-12-09 立案（AI Overviews/AI Mode 使用出版商内容、YouTube 内容训练 GenAI，无对价且无退出权）；英国 2026-06-03 行为要求（出版商可退出 AI 使用其内容）；法国 5 家出版商集团 2026-10-31 向欧盟投诉；Penske 2026-11-04 就 AI 摘要反垄断案败诉提起上诉 | AI 摘要的「零成本内容」闭环正被三条路径同时挤压：退出权（英国）、对价/许可（欧盟立案 + Google 自己的付费测试）、损害赔偿（美国诉讼）。[SIB] 抓到的付费测试正是 Google 对该压力的商业回应 |
| 前 9 个月 capex $132.0B、长期承诺 $802.1B、单季融资 $41B、€6B 欧元债 | 应计法律负债 $13.8B；未来 12–24 个月可能现金流出：纽约联邦法院放行的 adtech 民事赔偿约 $3.2B（反垄断三倍后可达约 $9.6B）、PriceRunner 约 $2.1B（上诉中）、DMA €890M（已计提、上诉中）、爱尔兰 DPC €403M（位置数据） | 法律**现金**敞口相对资产负债表不大（约为单季营业利润 $40.8B 的三分之一），真正的风险不是罚款，而是行为性救济对分发渠道与数据壁垒的长期侵蚀，以及在 $802.1B 承诺下失去搜索现金流弹性 |
| Cloud 宕机影响英国银行与法院、欧洲金融监管问询 | DORA/DSA 与成员国金融监管的运营韧性要求；10-Q 风险因素新增「数据事件须依法向监管报告」 | 新增「运营韧性/关键基础设施」监管面，与反垄断、DMA、隐私并行，且首次让 Google Cloud 进入金融监管视野 |
| YouTube 提高创作者变现门槛、抓取 opt-out 标准 | 欧盟 2025-12-09 立案明确点名 YouTube 内容被用于训练 GenAI 且创作者无退出权、无报酬 | 平台条款的单方面收紧会成为欧盟立案的证据材料，而非缓解因素 |

## 7. 两套语料都缺的证据（缺口清单）

1. EDVA adtech **106 页救济判决全文**（2026-09-02）与该案**终审判决**（截至 2026-11-05 尚未录入）——需 PACER/法院或当事人披露；CourtListener API 在本主机返回 401、其 HTML 返回 403，Justia 返回 403。
2. E.D. Tex. 州总检察长 adtech 案的审理排期与诉状。
3. 纽约联邦法院 2026-09-30 的 **88 页意见原文**（放行约 $3.2B adtech 民事赔偿请求）与案号。
4. 印度 CCI 决定原文、印度最高法院 Google Play 计费案（2026-11-03/04 庭审）记录；韩国 KCC/KFTC 决定原文（KRW 63.7B）；日本 JFTC 2025-04 命令原文。
5. 欧盟法院/普通法院判决原文：C-604/22 P（Android，2026-07-02 驳回上诉）、AdSense 上诉（委员会上诉待决）。**C-250/25 总法律顾问意见原文已取得**（Curia 新闻稿 No 155/26，本地 `analysis/scratch/cp260155en.pdf`），故该项从缺口中移除。
6. Alphabet 证券集体诉讼（N.D. Cal.，类别期间 2026-05-19 至 07-16）与 Rosen 股东代表诉讼（N.D. Ill.，2026-10-30，79 页）的**起诉书原件**——子任务 B 已通过律所通稿与 Music Business Worldwide 的起诉状直读取得法院、诉因、被告名单与金额细节，但案号与原件仍缺。
7. 英国 CAT £260M 集体和解批准令原文（2026-10-09 公布）。
8. ~~10-K FY2025 的完整「监管/AI」风险因素段落~~ —— **已补齐**，见 [analysis/05_监管与法律风险自述与敞口量化.md](05_监管与法律风险自述与敞口量化.md) 第一节（含 DMA、日本 MSCA、EU AI Act、加州/纽约前沿模型法、DSA 与佛州 SB 7072/德州 HB 20、DMCA 与 Section 230 安全港、未成年人、Cloud 主权运营要求、AI 能耗与水耗等 9 组原文引用与行号）。
9. **所有案件的案号**（D.D.C. 的 Chegg/Penske、N.D. Ill. 的 Keene 与 Rosen、N.D. Cal. 的证券集体诉讼与 Play 律师费裁定、加州上诉法院的青少年安全上诉、联邦 MDL 编号）——需 PACER 或更换出口 IP。
10. FTC 与各州总检察长站点在本主机多为 403/404（`ftc_google_search`、`cal_ag_google`、`ny_ag_google`、`accc_media_releases_google`），需换用其 RSS 或 FOIA 接口。

## 8. 结论：两套信息是什么关系

[SIB] 回答的是「谷歌在做什么、赚多少、往哪投」；本 Ticket 回答的是「谷歌被什么约束、代价多少、还剩多少自由度」。两者在 Q3 2026 财报、DMA €890M 罚款、adtech 不拆分这三处**独立命中且完全一致**，说明两套采集互为交叉验证；但在三处必须以一手文件纠正新闻聚合的表述——Gemini 用户口径（§3.1）、Epic 和解时间线（§3.2，Alphabet 自身两期披露矛盾）、以及「躲过拆分＝风险结束」的误读（§3.6，DOJ 交叉上诉的唯一争点是 payment ban）。

最有价值的单条发现来自两套语料的拼接：[SIB] 抓到 Google 在 2026-09-30 开始测试向出版商为 AI Overviews 付费，本 Ticket 抓到欧盟在 2025-12-09 就同一行为立案、英国在 2026-06-03 强制出版商退出权。单独看任一套语料都只能得到一半结论：**Google 正在用商业让步换取监管缓和，而这条路径本身是被诉讼逼出来的。**
