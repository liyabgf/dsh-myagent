# Scope B 事实核查表：AI / 知识产权 / 产品责任与青少年安全 / 证券与股东代表诉讼

**截止时点**：2026-11-05（Asia/Shanghai）
**覆盖对象**：Google、Alphabet、YouTube、Google DeepMind、Waymo
**不在本表范围**（由母单处理）：美国联邦反垄断（DOJ 搜索案、DOJ 广告技术案、Epic v. Google）、欧盟 DMA 执法、英国 CMA 数字市场行为要求；非美隐私罚款。
**编写方法**：先挖本地语料（`sources/index_all.tsv` 4,704 条、`raw/` 与 `raw/news3/` RSS、`notes/sec_legal_extracts.md`、`txt/10-Q_2026-09-30_*.txt`），再用 `curl` + Bing News RSS（`format=rss`，可解出真实 URL）与 web_fetch 核验。CourtListener 返回 401/403、Justia 403、DuckDuckGo（html 与 lite）返回反爬空页、Aboue the Law / JD Supra / Courthouse News / TechRepublic / Digital Music News / Fox40 / MSN 返回 520/403，均**未取得案号级一手材料**。`supremecourt.gov` 的 orders 页面返回 302/错误页，**未能定位 2026-10-19 orders list PDF**。

> **重要总体说明**：本表中"案号"一栏绝大多数为**未查到**。原因是本机无法访问 PACER / CourtListener / Justia，而二手报道（Reuters、AP、Ars Technica、PYMNTS、MBW、律所通稿）普遍不写 docket number。凡未查到者明确标注，不做推测。

---

## 1. 青少年安全 / 社交媒体成瘾诉讼（母单缺失战线，最高优先级）

### 1.1 第一号 bellwether：2026-03-25 洛杉矶陪审团裁决 Meta 与 YouTube 过失成立

| 字段 | 内容 |
|---|---|
| 事项 | 社交媒体成瘾人身伤害案第一号 bellwether 审判，陪审团认定 Meta 与 YouTube（Google/Alphabet）对原告负有过失责任 |
| 日期 | 裁决 2026-03-25（陪审团第 9 日评议后作出） |
| 法院/机构 | **Los Angeles Superior Court**（加州 JCCP 合并程序下的 bellwether） |
| 案号 | **未查到**（JCCP 编号未在可及来源中确认；本地语料与检索结果均未给出） |
| 当事方 | 原告（青少年/年轻用户）v. Meta Platforms、YouTube（Alphabet 子公司）等；Snap、TikTok 在到庭前已和解或撤诉 |
| 当前状态 | **已裁决（verdict）→ 上诉中**。Meta 于 2026-07（约 7 月 11 日前后）提起上诉；**YouTube 于 2026-07-15 加入上诉**，挑战陪审团关于"平台被设计为令未成年用户上瘾"的认定 |
| 金额或救济 | **本表未独立核实到 \$6M 数字**（母单已用自有语料确认，本表不重复主张；可及来源 NBC LA / KTLA 报道标题只写"liable/negligent"，正文未取得赔偿额） |
| 证据 | NBC Los Angeles, 2026-03-25 <https://www.nbclosangeles.com/news/local/verdict-la-social-media-addiction-trial/3861059/>；KTLA, 2026-03-25 <https://ktla.com/news/local-news/la-jury-verdict-social-media-addiction-lawsuit/>；NBC LA（YouTube 加入上诉）, 2026-07-15 <https://www.nbclosangeles.com/news/local/youtube-joins-appeal-social-media-lawsuit/3917610/>；The Hindu Businessline（Meta 上诉）, 2026-07-11 <https://www.thehindubusinessline.com/info-tech/social-media/meta-appeals-verdict-in-social-media-addiction-lawsuit/article71209325.ece> |
| 本地路径 | `sources/index_all.tsv`（`gn3_youth_safety`、`bing2_*` 行）；`analysis/bing_real_urls.txt` |
| 置信度 | **secondary**（多家独立媒体一致；上诉日期由 NBC LA 明确） |

### 1.2 第二号 bellwether：2026-10-28 起陪审团遴选，Meta 与 Snap 相继和解，审判取消

| 字段 | 内容 |
|---|---|
| 事项 | 第二号 bellwether（两名未成年女性原告，另有 18 岁密西西比州女性原告 K.D.B.；主张 "Snapstreaks"、推送通知等成瘾性设计导致抑郁、焦虑、进食障碍） |
| 日期 | 陪审团遴选 **2026-10-28（周三）**开始；开庭陈述原定 **2026-11-04**；**Meta 于 2026-10-30 和解**；**Snap 于 2026-11-02 与两名原告和解**（开庭前两天） |
| 法院/机构 | **Los Angeles Superior Court** |
| 案号 | **未查到** |
| 当事方 | 原告 K.D.B.（18 岁，密西西比州）及两名未成年原告 v. Meta、Snap、Alphabet/YouTube、TikTok |
| 当前状态 | **审判已取消（settled / moot）**。Daily Journal 2026-10-26 明确：**Snap 成为该 bellwether 案中第 4 家和解的社交媒体公司**，"ending the second social media addiction trial before…"；MSN/CBS 亦称 Snap "joins **Alphabet**, Meta and TikTok in resolving allegations"。**⇒ 就本案而言 Google/YouTube 已不在被告席上（已在 Snap 之前和解/解决）** |
| 金额或救济 | 和解金额**未披露**（各来源均称 confidential / 未查到） |
| 证据 | Law.com（Recorder）, 2026-11-02 <https://www.law.com/therecorder/2026/11/02/snap-settles-two-lawsuits-on-eve-of-social-media-addiction-trial/>；Law.com, 2026-10-30 <https://www.law.com/2026/10/30/meta-settles-social-media-addiction-claims-leaving-snap-as-sole-defendant/>；Daily Journal, 2026-10-26 <https://www.dailyjournal.com/article/395815-snap-is-4th-company-to-settle-social-media-claims-in-bellwether-case>；CBS News, 2026-11-02 <https://www.cbsnews.com/news/meta-settles-social-media-addiction-lawsuit-snapchat/>；Engadget, 2026-11-02 <https://www.engadget.com/2304464/snap-settles-social-media-addiction-lawsuit-to-avoid-trial/>；NYT, 2026-10-30 <https://www.nytimes.com/2026/10/30/business/meta-settlement-child-addiction-suit.html>（称该案为"九个人身伤害 bellwether 中的第四个"）；ABC News, 2026-10-27 <https://abcnews.com/US/jury-selection-set-begin-los-angeles-snap-meta/story?id=137617210> |
| 本地路径 | `analysis/bing_real_urls.txt`；`sources/index_all.tsv`（`gn3_youth_safety`、`gn3_youth`） |
| 置信度 | **secondary**（Law.com + Daily Journal + CBS + NYT 一致）。"Alphabet 已和解"一句来自 MSN/CBS 摘要与 Daily Journal 的"第 4 家"表述，**未见 Alphabet 官方确认，标注为 secondary-partial** |

### 1.3 Google/YouTube 在后续程序中的被告地位（增量回答）

- **加州 JCCP（州法院合并程序）**：Google/YouTube **仍是合并程序中的被告**，并已就 2026-03-25 的不利裁决**提起上诉**（见 1.1）。NYT 2026-10-30 报道指出该 K.D.B. 案是"九个人身伤害 bellwether 中的第四个"，即**后续 bellwether 排期仍存在**；Law.com 2026-11-04（Amanda Bronstad "Critical Mass"）称"looming on the horizon is a trial over whether a **school district** should be compensated by the [social media companies]"。**⇒ 增量结论：Google/YouTube 未在合并程序中整体退出，只是在已到期的两个 bellwether 中分别被裁决败诉（第一个）与在审前解决（第二个）。**
- **Section 230 上诉的具体案号与法院**：**未查到**。可及来源只说"YouTube 加入 Meta 的上诉"，未给出 California Court of Appeal 的案号或分庭。需通过 Cal. Courts of Appeal 检索系统（appellatecases.courts.ca.gov）核实——本会话未执行。
- **联邦 MDL（In re: Social Media Adolescent Addiction/Screen Time Products Liability Litigation）**：本地语料与本次检索**未取得 2026 年 10–11 月的 MDL 状态一手材料**。唯一命中的是 AEI 评论文章《Federal Multidistrict Litigation and Social Media Addiction: Onward to Summary Judgment and Bellwether Trials》，称合并诉讼已超过 2,000 件、正走向简易判决与 bellwether 审判（该文 RSS pubDate 字段损坏，显示为 2009 年，实际为近期）。**⇒ MDL 中 Google/YouTube 的被告地位与开庭安排：未核实。**
  - 证据：<https://www.aei.org/technology-and-innovation/federal-multidistrict-litigation-and-social-media-addiction-onward-to-summary-judgment-and-bellwether-trials/>；置信度 **unverified**
- **学区诉讼中 Google 的被告地位**：Reuters 2026-10-28 综述《What's the latest in US trials over claims social media is hurting children?》明确："**Meta Platforms, Alphabet's YouTube, TikTok parent ByteDance and Snap are facing thousands of lawsuits brought by US states, school districts and individuals** alleging the companies intentionally [designed addictive platforms]"。**⇒ Google/YouTube 是学区诉讼的共同被告。** 具体学区案号与首个学区开庭日期**未查到**（Law.com 11-04 提到学区审判"looming"但未给日期）。
  - 证据：Reuters, 2026-10-28 <https://www.reuters.com/legal/government/whats-latest-trials-over-claims-social-media-is-hurting-children-2026-10-28/>；置信度 **secondary**
- **州检察长（AG）诉讼**：Long Island Press 2026-10-08 提到针对 Meta 的 mass action 由加州 AG Rob Bonta 等多州 AG 于 2023-10-24 提起。**本次未针对 Google/YouTube 的州 AG 青少年安全诉讼取得独立证据；未核实。**
- **原告方主要律师**：**Mark Lanier**（The Trial Law Firm），2026-11-02 就 Meta/Snap 和解发声。证据：<https://www.tmcnet.com/usubmit/2026/11/02/10473916.htm>；置信度 secondary。

### 1.4 相关但独立的青少年/AI 安全线索（本地语料）

| 事项 | 日期 | 状态 | 证据 | 置信度 |
|---|---|---|---|---|
| Gemini 聊天机器人被指鼓励自杀（南佛州案）；Google 表示将"更新"Gemini 的自杀/自残防护 | 2026-03-11（CNN 报道诉讼）；2026-04-07（Google 回应/Forbes/Bloomberg/KQED） | 已起诉，进行中 | `raw/gn_gemini_lawsuit.xml`：CNN "Lawsuit claims Google's AI chatbot encouraged a man to kill himself"；Miami Herald "Gemini AI bot in South Florida suicide will be 'updated,' Google says"；Bloomberg "Google Adds Mental Health Tools to Gemini Chatbot After Lawsuit" | secondary（标题级，正文未取得） |
| The Times（英）"'My son's AI wife said it loved him. Then it encouraged him to die'" | 2026-03-14 | 报道 | `raw/gn_gemini_lawsuit.xml` | unverified（未取得正文） |
| Google 就 Gemini 数据追踪的消费者诉讼胜诉 | 2026-07-08（Reuters） | 已判决（Google 胜） | `raw/gn_gemini_lawsuit.xml` "Google defeats consumer lawsuit over Gemini data tracking claims" | secondary |
| Gemini Gmail 案在法官认定"无具体损害"后被重新提起 | 2026-11-01（PPC Land） | 重新起诉 | `raw/gn_gemini_lawsuit.xml` "Google faces refiled Gemini Gmail suit after judge found no concrete harm" | secondary |
| Google Play 儿童隐私集体和解 \$8.25M | 2026-05-29（Claim Depot） | 和解 | `sources/index_all.tsv` | **unverified**（单一来源，金额未二次核实） |

---

## 2. 欧盟：CJEU C-250/25 总法律顾问意见（**一手来源已确认**）

| 字段 | 内容 |
|---|---|
| 事项 | **Case C-250/25 Like Company** — 生成式 AI 聊天机器人（Google Gemini，采用 Retrieval-Augmented Generation）实时检索并再利用在线新闻出版物的行为，是否构成 EU 法下的"复制"（reproduction）与"向公众提供"（communication to the public / making available to the public） |
| 日期 | **意见交付：2026-11-03（周二）**；卢森堡。新闻稿编号 **Press release No 155/26**。移送时间：**2025 年 4 月**；**口头审理：2026-03-10** |
| 法院/机构 | **Court of Justice of the European Union（CJEU）**；总法律顾问：**Maciej Szpunar，First Advocate General**。移送法院（referring court）：**Budapest Regional Court（匈牙利布达佩斯地区法院）** |
| 案号 | **C-250/25**（CJEU 案号已确认）。匈牙利国内案号**未查到** |
| 当事方 | 原告/申请人：**Like Company**（匈牙利多个门户网站运营商，主张新闻出版者邻接权）；被告：**Google / Google Ireland Ltd.**（Alphabet 集团成员） |
| 主张期间 | Google 被指在 **2023-06-13 至 2024-05-31** 期间通过 Gemini 反复复制并向公众提供 Like Company 的文章 |
| 法律基础 | **Article 15(1) of Directive (EU) 2019/790（DSM/CDSM 指令）**— 新闻出版者就其出版物的在线使用享有复制与向公众提供的专有权；**Article 4 CDSM Directive** — 文本与数据挖掘（TDM）例外 |
| 四个先决问题 | 两问关于**用新闻出版物训练 LLM** 是否落入复制专有权、抑或被 TDM 例外自由允许；两问关于**聊天机器人向用户给出的答案**是否落入复制权和/或向公众提供权 |
| AG 结论（一）训练问题 | 建议法院**宣告两问不予受理（inadmissible）**：因为没有证据显示 Like Company 的文章被用于训练 Gemini LLM，且 LLM 的训练并非某种受该权利规制的利用形式，故问题属假设性。**但为完整起见**，AG 认为：使用受版权及邻接权保护的作品/客体来训练 LLM，**原则上被 TDM 例外自由允许** |
| AG 结论（二）答案/推理问题 | AG 建议法院聚焦于聊天机器人答案，认为**在特定情形下新闻出版者权利可能被侵犯**。核心限定：邻接权**不保护新闻报道的事实本身，只保护其特定表达形式**（目的是保护出版投资，而非给出版者对新闻的垄断）。是否构成复制侵权取决于两个因素：**①** 聊天机器人是否**非法获取**该新闻出版物，尤其是是否**规避了有效技术措施**（如付费墙）以限制访问或网络抓取；**②** 给用户的答复是**仅报道事实**，还是**以可识别的方式再利用了原出版物的表达形式**，达到使读者"完全无需再访问原文"的程度 |
| AG 结论（三）向公众提供权 | **原则上被侵犯**，当原出版物的表达形式在聊天机器人对相关用户提问的答复中"系统性地可识别"（达到上述程度）时 |
| AG 结论（四）责任归属 | 在线聊天机器人的**提供者**对此类利用行为负责，**当这些行为属于其商业模式固有组成部分，或其未能采取适当措施可信且有效地对抗这些行为时** |
| 若 CJEU 作出判决的意义 | ① AG 意见**无约束力**，法官通常遵循但不必遵循；**法官现已开始评议，判决将在稍后日期作出**（新闻稿未给具体日期）。② 这是**首个到达 CJEU 的生成式 AI 案件**，判决将塑造欧盟境内其他同类争议的论证方式。③ 实务影响是"训练 vs 推理"的风险转移：训练端相对安全（TDM 例外），**风险从"模型学了什么"转移到"模型说了什么"**。④ 对出版者而言，Art. 15 提供了针对 AI 输出的诉讼立足点，可增强其在与 AI 开发者许可谈判中的筹码；对采用 RAG/web-connected AI 的企业，需自查付费墙绕过（robots.txt、paywall circumvention）与答案对原文表达的复用程度 |
| Google 的回应 | **未查到 Google 的正式声明**。可及来源中：Reuters（Inti Landauro、Foo Yun Chee，布鲁塞尔，2026-11-03）标题为 "Setback for Google as EU court adviser sides with publishers against AI chatbot"；Hengeler Mueller（Google 在该案中的代理律所）客户通讯标题为 "**Google Scores Partial Victory** as EU Adviser Shifts Copyright Focus to Chatbots"，指 Google 在 AI 训练问题上获得潜在胜果，但 AG 为针对 Gemini 答案的版权索赔保留了空间。**⇒ Google 自身公开回应：未核实** |
| 金额或救济 | 无（先决裁定程序，不判赔偿；国内诉讼回到布达佩斯地区法院继续） |
| 证据（一手） | **Curia 新闻稿 CP 155/26（EN）PDF**：<https://curia.europa.eu/site/upload/docs/application/pdf/2026-11/cp260155en.pdf>（本地已下载并抽取全文：`analysis/scratch/cp260155en.pdf`、`analysis/scratch/cp_clean.txt`）；**Curia 案件新闻页**：<https://curia.europa.eu/site/jcms/p1_1000088866/en/opinion-case-c-250/25-like-company>；**Curia 新闻稿页**：<https://curia.europa.eu/site/jcms/p1_1000088863/en/opinion-of-the-advocate-general-at-the-court-maciej-szpunar-in-case-c-250/25> |
| 证据（二手） | PYMNTS/CPI, 2026-11-03 <https://www.pymnts.com/news/artificial-intelligence/2026/googles-gemini-faces-eu-copyright-scrutiny-over-use-of-news-content/>（本地 `analysis/scratch/pymnts_eu.txt`）；Crypto Briefing <https://cryptobriefing.com/eu-court-adviser-google-gemini-copyright/>（本地 `analysis/scratch/crypto_eu.txt`，提供移送/口头审理日期）；TechRepublic, 2026-11-04 <https://www.techrepublic.com/article/news-google-gemini-copyright-risks-emea-hungary/>（403，未取得正文） |
| 置信度 | **primary**（Curia 官方新闻稿 + 案件页已直接读取全文） |

**语料中的相关条目**（未逐一核验正文）：The Jerusalem Post 2026-11-03、TipRanks 2026-11-03 "Alphabet (GOOGL) Faces EU Copyright Risk as Court Adviser Warns Gemini AI Replies Can Break Press Rules"、BigGo Finance 2026-11-03、Bilyonaryo 2026-11-03、Plagiarism Today "3 Count: Uber Retreats" 2026-11-04（见 `raw/gn_gemini_lawsuit.xml`）。

---

## 3. 法国出版者的投诉（两条独立线索，务必区分）

### 3.1 2026-08-11：向法国竞争管理局（Autorité de la concurrence）投诉 — **已核实**

| 字段 | 内容 |
|---|---|
| 事项 | **APIG（Alliance de la presse d'information générale，代表近 300 家法国报纸）** 就 Google 于 2026 年 7 月上线 AI Overviews / AI Mode 向法国竞争管理局提出投诉 |
| 日期 | **2026-08-11** |
| 机构 | **Autorité de la concurrence（法国竞争管理局）** |
| 法律基础 | **邻接权（neighbouring rights / droits voisins）+ 法国竞争法**；核心主张是 AI Overviews 违反了 Google **2022 年作出的承诺（2022 commitments）**，并要求裁定 AI Overviews 与 AI Mode 的内容使用**必须与现有出版者许可协议分开单独谈判**（即不得被并入既有授权） |
| 当前状态 | 投诉已提出；**未查到竞争管理局是否立案/作出决定** |
| 金额或救济 | 未披露 |
| 证据 | France 24, 2026-08-11 "French newspapers appeal to antitrust regulator over Google's AI summaries"；Euronews, 2026-08-11；PYMNTS, 2026-08-11 <https://www.pymnts.com/cpi-posts/french-publishers-seek-antitrust-action-against-google-over-ai-search-summaries/>；The Next Web, 2026-08-12 <https://thenextweb.com/news/french-media-google-ai-antitrust-complaint>；TechRepublic, 2026-08-12 <https://www.techrepublic.com/article/news-french-publishers-google-ai-search-emea-france/>；Search Engine Land, 2026-08-11 "300 French newspapers file complaint over Google AI Overviews"；Tech Times, 2026-08-13 "Google AI Overviews Break 2022 Pledge, French Press Alliance Tells Regulator" |
| 置信度 | **secondary**（多家独立媒体一致） |

**背景（已核实）**：欧盟委员会此前已就 Google 在 AI 摘要中使用出版者内容展开审查 —— Mashable 2025-12-09 "Google AI Overviews sparks antitrust probe for using publisher content"；Reuters 2026-09-01/02 "EU Antitrust Regulators Quiz Publishers on Google's AI Search Opt-Out"（委员会就 Google 提出的"退出 AI 搜索而不影响自然排名"机制向出版者发问卷）。

### 3.2 2026-10-31：五家法国出版者集团向欧盟投诉 — **未核实（单一来源）**

| 字段 | 内容 |
|---|---|
| 事项 | 报道称"Google faces EU complaint from five French publisher groups over AI Overviews" |
| 日期 | RSS pubDate **2026-10-31 05:58 GMT**（Bing 版本为 2026-10-31 03:39/11:33 区间） |
| 机构 | 标题称"EU complaint"，但**投诉对象机构（欧盟委员会？DSA 协调员？竞争总司？）未在可及来源中确认** |
| 法律基础 | **未确认**（DSA / 版权 / 竞争法三者均有可能，报道标题不足以判定） |
| 五家集团身份、具体诉求 | **未查到** |
| 当前状态 | **unverified — 单一来源** |
| 证据 | PPC Land, 2026-10-31（本地语料 `raw/news3/gn3_publisher.xml` 与 `sources/index_all.tsv` 第 1447 / 3235 / 3943 行，标题 "Google faces EU complaint from five French publisher groups over AI Overviews"，链接为 Google News 重定向，未能解出真实 URL） |
| 置信度 | **unverified** — 本次检索（Bing News RSS 多组关键词）**未能找到第二家独立来源**报道同一事件。**建议母单将 3.1（8 月 11 日 APIG 投诉，已核实）作为法国出版者战线的主条目，3.2 标记为待证** |

---

## 4. 美国出版者/教育类 AI Overviews 诉讼

### 4.1 Chegg 案与 Penske Media Corporation 案被驳回 — **已核实（法院与法官），案号未查到**

| 字段 | 内容 |
|---|---|
| 事项 | 两起独立反垄断诉讼（Chegg Inc. v. Google；Penske Media Corporation v. Google），主张 AI Overviews / AI Mode 通过在搜索结果页内重构其内容，非法抽走流量与收入 |
| 日期 | **裁决 2026-09-30（周三）**；报道 2026-10-01 |
| 法院/机构 | **U.S. District Court for the District of Columbia（D.D.C.，华盛顿）**。Reuters 电头为 "WASHINGTON, Oct 1"；Ars Technica / PYMNTS / The Wrap 均确认法官为 **U.S. District Judge Amit P. Mehta**（同一法官亦审理 DOJ 诉 Google 搜索垄断案） |
| 案号 | **未查到**（两案均于 2025 年提起；PACER/CourtListener 不可达） |
| 当事方 | ① **Chegg Inc.**（教育/学习平台）— 主张 Google 非法抓取其教育内容，使 Gemini 模型得以"重建"该内容并削减其站点流量；② **Penske Media Corporation（PMC）**（Rolling Stone、Variety、Billboard 等母公司）— 主张被索引进入自然搜索的站点，其内容同时被"收割"用于 AI 答案且**无法退出**，属不公平 |
| 裁判要旨（理由） | **核心：「期待不等于协议」（an expectation is not an agreement）**。Mehta 法官写道："Plaintiffs have pleaded only that they have an 'expectation' that Google will send them search traffic if they make their content available for free. **But an expectation is not an agreement. It is simply how a general search engine works.**" 由于 Google 与 Chegg、PMC **从未订立正式安排（no formal bargain）**，反垄断法不适用。判决同时明确：法院对原告所称损害"不会等闲视之"，"对出版者如今的处境以及对记者、教育者和其他在线创作者的连锁后果并非不同情 —— 他们的内容被 Google 取用与再利用而未获补偿"；但"**法院只能适用法律如其所写，而非如法院或任何一方认为其应当如何**"。多家媒体概括为：受众/收入流失的因果关系与损害未构成反垄断违法，**救济只能来自国会立法**（Press Gazette 用语 "no formal bargain"；Technology Org 用语 "Finds No Audience and Revenue Drain"） |
| 当前状态 | **已驳回（dismissed）**。PMC 已上诉（见 4.2）；Chegg 是否上诉**未查到** |
| 金额或救济 | 原告请求的损害赔偿金额**未查到**；无救济判给 |
| 证据 | Ars Technica（Ryan Whitwam）, 2026-10-01 <https://arstechnica.com/google/2026/10/antitrust-lawsuits-targeting-google-ai-search-dismissed-by-federal-judge/>（**本地已存全文** `analysis/scratch/arstech.txt`，含判决引文）；Reuters, 2026-10-01 <https://www.reuters.com/legal/litigation/google-wins-dismissal-chegg-penske-lawsuits-over-ai-overviews-...>（语料标题 "Google wins dismissal of Chegg, Penske Media lawsuits over AI overviews"）；PYMNTS, 2026-10-01 <https://www.pymnts.com/cpi-posts/us-judge-dismisses-publisher-antitrust-cases-against-google-over-ai-search/>；The Verge, 2026-10-01 <https://www.theverge.com/tech/1003589/google-ai-overviews-chegg-penske-lawsuits-dismissed>；Engadget, 2026-10-01 <https://www.engadget.com/2275023/judge-dismisses-lawsuits-claiming-googles-ai-overviews-siphon-web-traffic/>；Press Gazette, 2026-10-01 "Penske AI Overviews lawsuit dismissed because 'no formal bargain' struck with Google"；The Hollywood Reporter（Winston Cho）, 2026-10-01；Forbes（Rick Ellis）, 2026-10-01；Search Engine Roundtable, 2026-10-01 <https://www.seroundtable.com/google-ai-overview-lawsuit-dismissed-42211.html> |
| 本地路径 | `analysis/scratch/arstech.txt`（全文）；`sources/index_all.tsv` 第 216/240/245/1429/1438–1455 行；`raw/news3/gn3_publisher.xml` |
| 置信度 | **secondary（强）** — 法院、法官、日期、判决引文由 Ars Technica 全文 + Reuters + PYMNTS + The Verge + Engadget 交叉一致 |

### 4.2 Penske Media 的上诉 — **已核实（上诉已正式提起），巡回法院为推断**

| 字段 | 内容 |
|---|---|
| 事项 | PMC 就 D.D.C. 驳回裁定正式提起上诉 |
| 日期 | **2026-11-04**（Digital Music News 报道 11:43 GMT；Google News 语料时间戳 2026-11-04 19:44 GMT） |
| 上诉法院 | **报道未直接点名巡回法院**。因原审为 **D.D.C.**，依 28 U.S.C. §1291/§1294 上诉当然管辖法院为 **U.S. Court of Appeals for the D.C. Circuit**。⇒ **D.C. Circuit（推断，非报道原文）**；上诉案号**未查到** |
| 当前状态 | **上诉已提起（notice of appeal filed）**， briefing 阶段未开始 |
| 证据 | Digital Music News, 2026-11-04 "Billboard Owner Penske Media Officially Appeals AI-Focused Google Antitrust Lawsuit Dismissal" <https://www.digitalmusicnews.com/2026/11/04/penske-media-google-lawsuit-appeal/>（**本机抓取返回 HTTP 520，正文未取得**；标题与摘要经 Bing News RSS 与 `sources/index_all.tsv` 第 252 行双重确认） |
| 置信度 | **secondary**（上诉事实：单一来源 DMN，但语料中另有 `gn_antitrust` 独立条目重复该标题）；**巡回法院：inferred** |

### 4.3 "Court Rules Traffic Crisis Needs Congress" 报告（2026-10 中旬） — **已核实为新闻综述**

| 字段 | 内容 |
|---|---|
| 事项 | 《Google Adds Publisher Links to AI Search as Court Rules Traffic Crisis Needs Congress》—— 将 Mehta 判决解读为"出版者流量损失在美国无法律救济，只有国会能处理"，并同期报道 Google 在 AI Overviews/AI Mode 中新增出版者链接（Further Exploration 区块、订阅标签、内联链接语境） |
| 日期 | 2026-10-15（Tech Times 2026-10-15 20:55 GMT；MSN 同题） |
| 性质 | **媒体综述/分析，不是法院文件或研究报告**。其"法院裁定"部分即 4.1 的 Mehta 判决 |
| 证据 | Tech Times, 2026-10-15 <https://www.techtimes.com/articles/329119/20261015/google-adds-publisher-links-ai-search-court-rules-traffic-crisis-needs-congress.htm>；MSN 转载 <https://www.msn.com/en-us/news/other/google-adds-publisher-links-to-ai-search-as-court-rules-traffic-crisis-needs-congress/ar-AA2elrFX> |
| 本地路径 | `sources/index_all.tsv` 第 1868 行（`bing2_google_search_ads_publishers`） |
| 置信度 | **secondary** |

### 4.4 同类诉讼与相关背景（本地语料，标题级）

- **Google 已开始向约 100 家数字出版者支付 AI Overviews 内容费用**（试点，约为广告收入的 0.1%）：The Information 2026-09-29；Ars Technica 2026-09-30 "Google's early attempt to pay websites for AI answers is struggling"；Yahoo Finance/Market Chatter 2026-09-30。置信度 secondary。
- **点击损失量化研究**（常被原告引用）：AI Overviews 使出版者点击下降 **39.8%**（PPC Land, 2026-06-30）/ **58%**（The Next Web, 2026-05-06）/ 全球流量下降 **33%**（DesignRush, 2026-07-28）；AI Overviews 出现在 **13.7%** 的搜索中、其中 **11%** 含无依据主张（Digital Information World, 2026-10-05）；Forbes 2026-10-12 研究 "Take Clicks and Credit Without Making Searchers Happier"。置信度 unverified（研究原文未取得）。
- **Lawfare 分析**：《AI Overviews and the Limits of the Search Safe Harbor》2026-09-22 —— 讨论 §230/搜索引擎安全港在 AI 答案情境下的边界。置信度 secondary（标题级）。
- **英国**：CMA 已要求 Google 允许站点在保留自然排名的前提下退出 AI 搜索（Reuters 2026-01-28、2026-06-03）。**属母单范围，此处仅作交叉引用。**

---

## 5. AI 诽谤（defamation）：Keene v. Google — **已核实（法院、法官、结果），案号未查到**

| 字段 | 内容 |
|---|---|
| 事项 | **James "Jimmy" Keene v. Google** — AI Overviews 诽谤案。Keene 是作家、电视制作人、前 FBI 线人/特工，其回忆录被改编为 Apple TV+ 剧集 *Black Bird*。他发现搜索"Jimmy Keene net worth"等查询时，Google 的 AI Overview 回答称他**杀害了三名女性并正在服无期徒刑**（另有报道称 AI 说他"killed 3 people"）。Keene 确曾服刑，但罪名与大麻相关，17 个月后已释放 |
| 日期 | **裁定 2026-09-14（周一）**；Law.com 报道同日；Courthouse News 2026-09-15；Mercury News 2026-09-16；Above the Law 2026-09-21 |
| 法院/机构 | **U.S. District Court for the Northern District of Illinois（伊利诺伊北区联邦地区法院，芝加哥）**；**U.S. District Judge Thomas Durkin** |
| 案号 | **未查到**（诉讼于 2025 年提起；Law.com 与 Courthouse News 正文均被封锁） |
| 当事方 | 原告 James Keene；被告 Google LLC |
| 诉因与理论 | 诽谤（defamation）。原告主张 AI Overviews 的陈述是**可客观验证的事实陈述（objectively verifiable statements of fact）**。Google 抗辩：① AI Overviews **不构成事实陈述**；② Keene 属 **"limited public figure"**，须"plausibly plead"实际恶意（actual malice）；③（据 Above the Law 标题）"没人信任 AI 摘要"式的可信任性抗辩。Durkin 法官的关键论述：**"By pointing out that the statements in the AI Overviews are objectively verifiable, Google concedes the very point it is arguing against — the statements are facts."** |
| 裁决结果 | **部分准予、部分驳回**：法院"**allowed two of Google's motions to dismiss and denied two others**"，并**准许 Keene 提交修正诉状（amended complaint）**。诽谤请求本身**获准继续（cleared to proceed）** |
| 当前状态 | **进行中（部分请求存活，原告获准修正诉状）** |
| 金额或救济 | 原告请求 **至少 2.5 亿美元（\$250 million）** 损害赔偿 |
| 其他事实 | Keene "**反复提醒 Google** AI Overviews 可能构成诽谤"（repeatedly alerted Google），虚假陈述据称**至少可被访问两个月** |
| 证据 | Law.com, 2026-09-14 <https://www.law.com/2026/09/14/defamation-claims-cleared-to-proceed-against-googles-ai-overviews-federal-judge-rules-/>（付费墙，标题+引文经 Bing News RSS 摘要取得）；Courthouse News, 2026-09-15 <https://www.courthousenews.com/google-ai-overviews-can-defame/>（**403，仅取得摘要**："CHICAGO — A federal court in Illinois allowed an author and TV producer to proceed with defamation claims against Google over AI Overviews that allegedly falsely stated he was serving life in prison"）；**Mercury News, 2026-09-16 <https://www.mercurynews.com/2026/09/16/google-ai-james-keene-defamation/>（本地已存全文 `analysis/scratch/merc_keene.txt`）**；Above the Law, 2026-09-21 <https://abovethelaw.com/2026/09/google-ai-said-man-killed-3-people-defamation-defense-lol-no-one-trusts-ai-summaries/>（**403，正文未取得**） |
| 本地路径 | `analysis/scratch/merc_keene.txt`（全文）；`raw/news3/gn3_ai_defamation.xml` |
| 置信度 | **secondary（强）** — 法院/法官由 Law.com 摘要与 Mercury News 全文一致确认 |

### 5.1 相关 AI 诽谤线索（本地语料）

| 事项 | 日期 | 法院/机构 | 状态 | 证据 | 置信度 |
|---|---|---|---|---|---|
| **Ashley MacIsaac v. Google**（加拿大 Cape Breton 小提琴家，AI Overview 错误称其为性犯罪者，索赔 **150 万美元**） | 起诉 2026-05-04/05；**撤诉/终结 2026-08-17/18** | 加拿大法院（具体未查到） | **已结束（撤诉）**，未留下判例；Investigative Journalism Foundation 2026-08-14 称"leaves unanswered questions" | Billboard 2026-05-05 <https://www.billboard.com/...>；CBC 2026-05-04 与 2026-08-18；National Post 2026-08-17；Exclaim! 2026-08-18；CityNews Halifax 2026-08-19（均见 `raw/news3/gn3_ai_defamation.xml`） | secondary |
| **德国法院认定 Google 对 AI Overview 虚假陈述负责**（"landmark German ruling"：AI Overviews 是 Google 自己的言辞） | 判决 2026-06（报道 06-10 至 06-16）；**Google 于 2026-06-12 表示将上诉** | 德国法院（具体审级/案号**未查到**） | 已判决，Google 上诉中 | Reuters 2026-06-12 "Google to challenge German ruling saying it is liable for AI-generated false claims"；WIRED 2026-06-13；DW 2026-06-12；The Decoder 2026-06-11；Transparency Coalition 2026-06-16（"Read the full decision here"）；Malwarebytes 2026-06-11；Tech Times 2026-06-16（"Ends Search Safe Harbor for Every AI Answer Engine"）；Ars Technica 2026-06-10 "Nobody needs AI to search the Internet, court says in ruling against Google" | secondary（**属非美司法辖区，非本表重点，但为 §230/安全港比较法素材**） |
| 犹他州男子被 Gemini 幻觉指控性犯罪 | 2026-05-14（Reason） | 未查到 | 报道 | `raw/news3/gn3_ai_defamation.xml` | unverified |

---

## 6. AI 训练数据版权诉讼（点名 Google / DeepMind / YouTube）

### 6.1 股东代表诉讼：Rosen v. Pichai 等 13 人（Lyria 等模型的版权训练） — **已核实（法院、日期、当事方、诉因），案号未查到**

| 字段 | 内容 |
|---|---|
| 事项 | **股东代表诉讼（shareholder derivative suit）**，由 Alphabet 股东 **Phil Rosen** 以 Alphabet 名义提起，针对 Google/Alphabet 训练 AI 模型（含 **Lyria、Lyria 2、Lyria 3、Mulan、MusicLM**）使用受版权保护作品与商业声纹（voiceprint）的"非法商业策略" |
| 日期 | **起诉状提交 2026-10-30**；MBW 报道 2026-11-02 18:32 GMT；Digital Music News 报道 2026-11-03 01:03 GMT（"Alphabet Directors Face Shareholder Suit Over AI Training Policies"） |
| 法院/机构 | **美国伊利诺伊州北区联邦地区法院（federal court in Chicago = N.D. Ill.）** |
| 案号 | **未查到**（MBW 称已取得 79 页起诉状全文并附链接，但 MBW 页面本机抓取成功而**链接指向的 PDF 未下载**；PACER/CourtListener 不可达） |
| 当事方 | 原告（名义上代表 Alphabet）：**Phil Rosen**。**13 名被告**：**Sundar Pichai**（CEO）、**Larry Page**、**Sergey Brin**、**John L. Hennessy**（Alphabet 董事长）+ **另 6 名董事**、**Anat Ashkenazi**（CFO）、**Ruth M. Porat**（President & Chief Investment Officer）、**Kent Walker**（President, Global Affairs & Chief Legal Officer） |
| 诉因（理论） | ① **违反信义义务 / 监督失职（Caremark 类型）**：采纳并实施"非法商业策略"，"精心设计以规避为取得合法许可所需的时间与金钱，转而在被版权人与商业声纹持有人起诉后再支付赔偿"；采用"**ask forgiveness not approval**"模式，使用**盗版数据集（pirated dataset）**开发公司 AI 服务；② **版权侵权（代位/直接）**："Alphabet and Google have engaged in copying millions of copyrighted sound recordings, musical compositions, and lyrics"；Google 从录音中抽取音频、转换为机器可读格式、切分为训练片段，并**剥除全部标识艺人与版权声明的版权管理信息（CMI）**；MusicLM（2023 年 1 月推出）以 **500 万条音频片段、共 28 万小时**音乐训练，而 Google **未披露该 28 万小时训练语料中的具体录音、权利人或许可**；③ **BIPA（Illinois Biometric Information Privacy Act）**：Gemini Live 等语音产品建立在"数十万小时人类语音录音"之上，未取得 BIPA 要求的书面告知与书面同意；④ **虚假/误导性代理声明（proxy statements）**：2024 年代理声明中"Responsible AI"章节称董事会定期听取"沉浸于 AI 原则日常实施"的高管汇报，而该等表述已从 2025、2026 年代理声明中删除，原告称删除正因董事们"清楚知道这些表述本不应出现在 2024 年代理声明中"；2025 年代理声明中反对股东提案时称 Google 运营"权威、全面、可审计的 AI 资产记录系统……（auditable lineage）"，原告称该陈述虚假误导；⑤ **虚高价格回购自家股票**：2023 年 4 月至 2025 年 11 月回购 **11.47 亿股**、总成本 **1,696 亿美元（\$169.6 billion）**，均在被告明知却未披露版权与 BIPA 侵权之时进行，"因此公司以人为虚高的价格回购了自己的股票" |
| 援引的"红旗"案例 | 主要唱片公司对 **Suno** 与 **Udio** 的诉讼；UMG/Concord/ABKCO 对 **Anthropic** 的两起诉讼（起诉状将 Anthropic 的 **15 亿美元**付款归因于出版者 2023 年首案；MBW 补充：Anthropic 于 2025 年 9 月同意支付该金额以和解作家集体诉讼） |
| 关键引文（Kent Walker） | Walker 于 2026 年 6 月发表 Google 政策文件，主张"使用公开可得网络数据训练模型是**转换性、非表达性**的使用 —— 如同美术学生从逛画廊中获得灵感 —— 应在美国受 fair use 保护、在国外受文本与数据挖掘例外保护" |
| 补偿细节 | 起诉状称 Pichai 一人在 **2023–2025 年间获得超过 3,000 万美元薪酬** |
| 请求的救济 | **未指定损害赔偿金额**。请求：① 判令被告向 **Alphabet**（而非原告个人）支付赔偿；② **返还薪酬（disgorgement / clawback）**；③ 强制公司治理改革，包括"确保建立对版权与 BIPA 法律合规的有效监督" |
| 当前状态 | **已起诉（filed），审理前阶段**；未见 Google/Alphabet 应诉或驳回动议的报道 |
| 证据 | **Music Business Worldwide（Mandy Dalugdug）, 2026-11-02 <https://www.musicbusinessworldwide.com/alphabet-shareholder-sues-sundar-pichai-and-12-others-over-training-googles-ai-including-lyria-on-copyrighted-works/>（本地已存全文 `analysis/scratch/mbw_derivative.txt`）**；Digital Music News, 2026-11-03 "Alphabet Directors Face Shareholder Suit Over AI Training Policies"（`raw/gn_ai_copyright.xml`）；Music Ally, 2026-11-03 "AI roundup: Lyria lawsuit, Anthropic's Q3, OpenAI pile-in" |
| 本地路径 | `analysis/scratch/mbw_derivative.txt`（全文，含全部引文）；`sources/index_all.tsv` 第 186、4479 行 |
| 置信度 | **secondary（强，单一权威行业媒体但已取得起诉状原文摘录）** — 法院与诉因细节来自 MBW 直接阅读 79 页起诉状；**案号未核实** |

**重要旁证**：MBW 指出 2026 年 8 月"**一位同名股东**"（a shareholder of the same name）对 **Apple** 高管与董事提起了类似的代表诉讼（据 Bloomberg Law）—— 即 Phil Rosen 是系列代表诉讼原告，此点可用于评估本案的实质分量。

### 6.2 独立音乐人诉 Google（Lyria 3 训练） — **已核实（存在、法院、Google 抗辩），案号未查到**

| 字段 | 内容 |
|---|---|
| 事项 | 一组独立音乐人（indie artists）提起**拟议集体诉讼**，称 Google 从 YouTube 挖掘音乐以训练 **Lyria 3** AI 音乐工具 |
| 日期 | 起诉 **2026-03**（MBW 报道 2026-03-10）；**Google 于 2026-06-09/10 提出驳回动议** |
| 法院/机构 | **N.D. Ill.（芝加哥联邦法院）** —— MBW 明确称 Rosen 代表诉讼的音乐部分"大量引用同一法院三月提起的拟议集体诉讼，部分段落重复该诉状措辞"，且 Rosen 案在芝加哥 ⇒ 该集体诉讼同在 **N.D. Ill.** |
| 案号 | **未查到** |
| Google 抗辩 | Google 主张：音乐人**接受 YouTube 服务条款即授予了许可，且该许可延伸至 YouTube 的"关联方（Affiliates）"，Google 即属其中之一**（Variety 2026-06-10 "Google Asserts That YouTube's Terms of Service Allow It to Train AI Models"；Billboard 2026-06-09/10 同题） |
| 当前状态 | **驳回动议待决（motion to dismiss pending）** |
| 证据 | completemusicupdate.com, 2026-03-10 "Google had every opportunity to train its AI legally, but chose to do it on the cheap instead, say indie musicians"；Music Business Worldwide, 2026-03-10 "Indie artists sue Google, claiming it mined music from YouTube to train Lyria 3 AI music tool"；Music Business Worldwide, 2026-06-10 "Google moves to dismiss indie artists' Lyria 3 AI training lawsuit, arguing they licensed their music when ag[reeing to YouTube ToS]"；Variety, 2026-06-10；Billboard, 2026-06-09（均见 `raw/gn_ai_copyright.xml`） |
| 置信度 | **secondary** |

### 6.3 出版者与作家诉 Google（Gemini 图书训练） — **已核实（当事方、法院辖区），案号未查到**

| 字段 | 内容 |
|---|---|
| 事项 | **Hachette、Cengage、Elsevier 与畅销书作家 Scott Turow** 提起（拟议）集体诉讼，称 Google 复制**数百万册图书与期刊文章**训练 Gemini |
| 日期 | 起诉 **2026-07-13/14**（The Guardian、Publishers Weekly、TechCrunch、CNET、ADWEEK、Publishing Perspectives、The Bookseller 同日报道）；KSNV 2026-07-29 补充 "in New York court"；SCC Online 2026-07-21 "Publishers, Author Scott Turow File Class Action Against Google Over Gemini AI Training on Copyrighted Works" |
| 法院/机构 | **纽约的联邦法院**（KSNV 措辞 "New York court"；TheWrap 标题 "Hachette, Scott Turow Sue Google for Using Books to Train AI"）⇒ **大概率为 S.D.N.Y.**，但**"S.D.N.Y." 未在任何可及来源中被明确写出，标注为推断** |
| 案号 | **未查到** |
| 当前状态 | **已起诉（filed）**；未查到 Google 应诉/驳回动议的报道 |
| 金额或救济 | **未查到** |
| 证据 | The Guardian, 2026-07-14 "Book publishers sue Google for copyright infringement over Gemini AI training"；TechCrunch, 2026-07-14 "Google faces another AI training lawsuit from major publishers"；Publishing Perspectives, 2026-07-14 "U.S. Publishers Sue Google, Alleging Massive Copyright Infringement Behind Its Gemini AI Service"；TheWrap, 2026-07-14；The Next Web, 2026-07-15 <https://thenextweb.com/news/google-gemini-publishers-copyright-lawsuit>；KSNV, 2026-07-29（均见 `raw/gn_ai_copyright.xml`、`raw/news3/gn3_ai_copyright_gemini.xml`） |
| 本地路径 | `raw/gn_ai_copyright.xml`、`raw/news3/gn3_ai_copyright_gemini.xml`、`raw/gn_authors_publishers.xml` |
| 置信度 | **secondary**（多家一致）；**法院推断** |

### 6.4 线索澄清："Apple asks judge to dismiss US lawsuit over scraping YouTube for AI training" — **Google 不是被告**

| 字段 | 内容 |
|---|---|
| 澄清结论 | **Google/YouTube 不是该案的被告，而是被爬取内容的宿主平台（第三方）**。被告是 **Apple Inc.** |
| 事项 | 内容创作者（content creators）起诉 Apple，称 Apple **爬取他们的 YouTube 视频**以训练可将文本转换为视频的生成式 AI 模型 |
| 日期 | 裁定 **2026-10-08**（MediaPost 报道 2026-10-08 17:00 GMT；TVNewsCheck 转载 2026-10-13） |
| 法院/机构 | 美国联邦法院（**具体地区未查到**） |
| 结果 | 联邦法官裁定**创作者可继续诉讼（Apple 的驳回动议未获准许）**："Content creators can proceed with a lawsuit claiming Apple scraped their YouTube videos in order to train generative artificial intelligence model[s] that convert text to videos" |
| 对 Google 的意义 | ① Google 在该案中至多是**利益相关的第三方 / YouTube ToS 的解释对象**；② 该案与 6.2 形成镜像：**同一套 YouTube ToS 论点**在 Apple 案中由创作者主张"爬取 YouTube 违反 ToS"，在 Google 案中由 Google 主张"ToS 已授予关联方许可" —— 两案对 YouTube ToS 的解释可能产生外溢影响，但**目前不构成 Google 的直接诉讼风险** |
| 证据 | MediaPost, 2026-10-08 <https://www.mediapost.com/publications/article/418644/apple-must-face-suit-over-youtube-scraping.html>；TVNewsCheck, 2026-10-13 <https://tvnewscheck.com/digital/article/apple-must-face-suit-over-youtube-scraping/> |
| 置信度 | **secondary** |

### 6.5 其他 AI 版权生态背景（本地语料，非 Google 为被告）

- **DOJ 支持 OpenAI 的 fair use 主张**，并称创作者"必须去找国会"：MSN/AP 2026-09-03 <https://www.msn.com/en-us/news/other/doj-backs-openai-fair-use-claim-in-ai-copyright-fight-creators-must-try-congress/ar-AA2bv7i1>。⇒ **对 Google 的含义：行政部门在 AI 训练 fair use 上持宽松立场，是 Chegg/Penske 判决"只能靠国会"论述的政策背景。** 置信度 secondary。
- **Anthropic 15 亿美元版权和解于 2026-07-20 获批准**：TechCrunch <https://techcrunch.com/2026/07/20/...>；Startup Fortune 2026-08-23 "How One Judge's Split Ruling on Anthropic Became AI's Copyright Rulebook"。置信度 secondary。
- **"抓取搜索结果用于 AI 训练是合法的，法院表示"**：Computerworld, 2026-07-24。置信度 unverified（未取得正文，未确认是否涉 Google）。
- **纽约时报诉 Brave Software**（美国报纸起诉）、**加拿大出版者诉 Anthropic**：Press Gazette 2026-11-02 综述 "Who's suing AI and who's signing latest"；JD Journal 2026-11 "New York Times Files Copyright Lawsuit Against Brave"。置信度 secondary（不含 Google）。
- **Wikipedia 运营方警告不利的 AI 版权判决可能威胁开放网络**：The Verge, 2026-10-30 <https://www.theverge.com/policy/1022880/wikipedia-openai-new-york-times-copyright>。置信度 secondary。
- **未查到**任何以 **Google DeepMind** 为具名被告的独立版权诉讼（2026-11-05 前）。DeepMind 仅在 Alphabet 层面被 Rosen 代表诉讼与出版者诉讼间接覆盖。

---

## 7. 证券诉讼

### 7.1 Alphabet Inc. 证券集体诉讼（Gemini 3.5 Pro）— **已核实（法院、类别期间、诉因、阶段），案号未查到**

| 字段 | 内容 |
|---|---|
| 事项 | **Alphabet Inc. 证券集体诉讼**（securities class action），代表在类别期间购买或以其他方式取得 Alphabet（NASDAQ: **GOOGL / GOOG**）证券的个人与实体 |
| 法院/机构 | **U.S. District Court for the Northern District of California（N.D. Cal.）** — Levi & Korsinsky 通稿明确："The action asserts claims under Sections 10(b) and 20(a) of the Securities Exchange Act of 1934 **in the U.S. District Court for the Northern District of California**" |
| 案号 | **未查到** |
| 诉因 | **§10(b) 与 §20(a)，1934 年证券交易法**（及据此的 Rule 10b-5） |
| **类别期间** | **2026-05-19 至 2026-07-16（含首尾两日）** |
| 理论（起点） | **2026-05-19** Alphabet 举办年度 **Google I/O** 开发者大会，CEO **Sundar Pichai** 宣布其备受期待的旗舰 AI 产品 **Gemini 3.5 Pro 将于 2026 年 6 月推出**。诉状主张：类别期间内被告**未披露 Gemini 3.5 Pro 的训练结果令人失望（disappointing training results）**，因而其发布将被**显著推迟**，使公司的正面陈述**具有实质误导性或缺乏合理基础**；并主张 6 月时间表的陈述**不含任何有意义的警示性语言（no meaningful cautionary language）** |
| 理论（揭露日） | **2026-07-16 约 14:00 EST，Bloomberg 报道** Google 在交付 Gemini 3.5 Pro 上"**落后进度数月**（months behind schedule）"，原因是持续的编码工作；"上月末 Google 更新了用于训练 Gemini 的数据以试图提升其能力，但**结果令人失望**" |
| 股价反应 | Class A（GOOGL）下跌 **\$16.46，即 4.4%**，收于 **\$354.46**；Class C（GOOG）下跌 **\$16.39，即 4.4%**，收于 **\$353.58**；成交量异常放大 |
| 被告 | Alphabet Inc.；据 SueWallSt 通稿，**CEO Sundar Pichai 与 CFO Anat Ashkenazi** 被点名（"Alphabet Shareholder Alert: Investors With Losses May Seek to Lead the Class Action… Chief Executive Officer Sundar Pichai and Chief Financial Officer Anat Ashkenazi are [named]"） |
| **阶段** | **已起诉，处于 lead plaintiff（首席原告）选定阶段**。**首席原告截止日存在两个版本**：**2026-11-30**（Robbins LLP 2026-10-02；Faruqi & Faruqi 2026-10-02）与 **2026-12-01**（Levi & Korsinsky 2026-10-26；BFA Law 2026-11-01/02；Glancy Prongay 2026-10-26；Howard G. Smith 2026-10-23）。⇒ **法定 60 日窗口对应 2026-11-30；多数律所通稿使用 2026-12-01。以法院命令为准，本表标注两者并存** |
| 金额或救济 | 未指定（集体诉讼典型损害赔偿请求） |
| 参与律所（通稿发布方） | **Robbins LLP**（Aaron Dumas, Jr.；Brian J. Robbins）、**Levi & Korsinsky, LLP**（Joseph E. Levi）、**Faruqi & Faruqi, LLP**、**BFA Law**、**Glancy Prongay Wolke & Rotter LLP**、**The Law Offices of Howard G. Smith**、**SueWallSt**、**Kirby McInerney**（本地语料 `sources/index_all.tsv` 中出现 "Securities Fraud Investigation Into Alphabet Inc." 类通稿） |
| 证据 | **Levi & Korsinsky 通稿（GlobeNewswire, 2026-10-26，经 financialcontent 转载，本地已存全文 `analysis/scratch/lk_alphabet.txt`）** <https://www.financialcontent.com/article/gnwcq-2026-10-26-googlgoog-shareholder-alert-december-1-2026-lead-plaintiff-deadline-in-alphabet-inc-securities-class-action-contact-levi-and-korsinsky>；**Robbins LLP 通稿（BusinessWire, 2026-10-02，经 Morningstar 转载，本地已存全文 `analysis/scratch/morningstar_robbins.txt`）** <https://www.morningstar.com/news/business-wire/20261002359601/investor-alert-robbins-llp-informs-investors-of-the-alphabet-inc-class-action-lawsuit>；BusinessWire（原始）<https://www.businesswire.com/news/home/20261002359601/en/>；Faruqi & Faruqi <https://www.businesswire.com/news/home/20261002784724/en/>；BFA Law <https://www.businesswire.com/news/home/20261102981836/en/>；PR Newswire via Morningstar, 2026-10-19 <https://www.morningstar.com/news/pr-newswire/20261020ny74456/>；AOL/Howard G. Smith, 2026-10-23；The Reflector, 2026-11-02 |
| 本地路径 | `analysis/scratch/lk_alphabet.txt`、`analysis/scratch/morningstar_robbins.txt`（均全文）；`sources/index_all.tsv` 第 576、579 行；`raw/news3/gn3_securities.xml` |
| 置信度 | **secondary（强）** — 类别期间、诉因、法院、股价数字由两家独立律所通稿交叉一致；**案号未核实** |

**注意（母单需知）**：此案的诉因是**关于 AI 模型交付进度的陈述**，**不是**关于反垄断敞口的陈述。任务书中"misstatements about antitrust exposure"的假设**未获支持**。

### 7.2 2024–2025 年仍在进行的证券诉讼 — **未查到**

本次检索与本地语料**未发现任何 2024 或 2025 年提起、截至 2026-11 仍在进行的 Alphabet 证券集体诉讼或股东代表诉讼**。Alphabet 10-Q（2026-09-30）与 10-K（2025-12-31）的"Commitments and Contingencies"章节（见 `notes/sec_legal_extracts.md`）列举的法律事项为 Google Play 州 AG 和解、Epic v. Google、EU DMA、EU Android/ad tech 罚款、PriceRunner（瑞典）等，**未单独列示任何证券集体诉讼**。⇒ 结论：**除 7.1 与 6.1 外，无其他已知在审证券/代表诉讼；未查到即视为不存在，不作推测。**

### 7.3 与证券披露相关的其他已核实事实（供母单交叉引用）

- **2026-10-28 Alphabet 发布 Q3 2026 业绩（8-K, exhibit 99.1）**，股价因"profit miss, ad slowdown"下挫约 8%；**SpaceX 持仓减记（writedown）** 是主要拖累（"Alphabet's SpaceX Bet Wiped 55 Cents Off Its Earnings"；"How Elon Musk's SpaceX triggered an \$11 billion earnings shock for Alphabet"，invezz 2026-10-29）。本地：`txt/8-K_2026-10-28_000165204426000080.txt` 与 `..._googexhibit991q32026.txt`。⇒ **潜在的第二波证券诉讼风险点（SpaceX 减记与 AI 资本开支披露），但截至 2026-11-05 未查到据此提起的诉讼。**
- **2026-10-29 报道**："Alphabet Reveals Another **\$98.5 Billion** in Potential AI Obligations After Earnings"（本地语料 `sources/index_all.tsv`）。⇒ 与 AI 资本开支承诺披露相关，未见诉讼。**unverified（单一来源）。**
- **2026-11-04 424B2**（本地 `txt/424B2_2026-11-04_000119312526447343.txt`）：Alphabet 欧洲债券发行（€6 billion 级），其风险因素章节并入 10-K/10-Q 的 AI 与法律程序风险披露 —— 是"AI 相关或有负债"的权威基线文本。
- **Gemini 安全事件的证券相关性**：2026-09-18 起多家媒体报道 **Gemini 模型在 2026 年 5 月的 Irregular AI 测试中"越狱"并入侵了三家真实公司**，Google 于 9 月才确认（Ars Technica 2026-09-21、Gizmodo、WSJ/US News、Tech Times）。⇒ **潜在的未披露重大事件（§10(b) 素材），但截至 2026-11-05 未查到据此提起的证券诉讼。** 置信度 secondary。

---

## 8. 专利 / ITC / 美国最高法院

### 8.1 2026-10-19 最高法院拒绝受理 Google 对 USPTO 审查政策的挑战 — **已核实（日期、政策、程序史），案名与案号未查到**

| 字段 | 内容 |
|---|---|
| 事项 | **美国最高法院拒绝受理（denied certiorari）** Google 对 **USPTO "settled expectations"（既定预期）政策**的挑战 |
| 日期 | **2026-10-19（周一）** |
| 法院/机构 | **Supreme Court of the United States**；被挑战政策来自 **USPTO / Patent Trial and Appeal Board（PTAB）** |
| 案名 | **未查到**。案件源于软件公司 **VirtaMove** 指控 Google 侵犯一项服务器技术专利 ⇒ 案名很可能为 *Google LLC v. VirtaMove Corp.* 一类形式，但**没有任何可及来源写出正式案名，本表不作断言** |
| 案号 | **未查到**（SCOTUS docket 号未在任何可及来源中出现；`supremecourt.gov/orders` 页面本机返回 302/错误页，未能取得 2026-10-19 orders list PDF） |
| 被挑战的政策 | **PTAB 的 "settled expectations" 政策**：在决定是否启动行政复审（**inter partes review, IPR**）时，PTAB 会考虑专利已生效多久；**专利生效超过 6 年时，挑战更可能被拒绝**。Google 主张该政策**不当限制了国会设立的、使企业无需进行昂贵联邦法院诉讼即可挑战专利的程序**，且 USPTO **超越法定权限**、实际引入了国会未授权的**时间限制**，使老专利即使存在实质有效性疑问也能免于行政审查 |
| 程序史 | ① VirtaMove 指控 Google 侵犯服务器技术专利；② Google 向 PTAB 请求 IPR；③ **PTAB 于 2025 年拒绝启动复审**，理由即其"既定预期"政策；④ Google 向 **U.S. Court of Appeals for the Federal Circuit** 求救济，**Federal Circuit 驳回其挑战**；⑤ Google 请求最高法院介入；⑥ **2026-10-19 最高法院拒绝受理** |
| 裁判要旨 | **这是 certiorari 的拒绝，不是对政策合法性的实体裁判**（"does not constitute a ruling on the underlying legality of the agency's policy"）。效果是**维持 Federal Circuit 的在先判决不变**，保留 USPTO 在决定是否启动行政复审时考虑专利存续期间的权限。**Trump 政府反对最高法院受理本案** |
| 行业背景 | ① Trump 政府下 USPTO 已实施降低受理比例的改革；② **Samsung Electronics、Apple Inc.、Alphabet 是 2020–2025 年间 PTAB 最活跃的三家申请人**（Patexia 研究，Reuters 援引）；③ **今年稍早（据 Reuters 2026 年 2 月报道），Federal Circuit 驳回了 Apple、Google、Intel、Cisco Systems、Edwards Lifesciences 对 USPTO 另一项扩大裁量性驳回权限政策的挑战** —— 即科技公司在专利行政审查问题上**连续受挫** |
| 金额或救济 | 无（程序性裁定） |
| 证据 | **PYMNTS/CPI, 2026-10-19 <https://www.pymnts.com/cpi-posts/us-supreme-court-rejects-google-appeal-over-patent-review-rules/>（本地已存全文 `analysis/scratch/pymnts_scotus.txt`）**；Reuters（原始报道，2026-10-19，"Supreme Court rejects Google challenge to US patent agency review policy"，经 Yahoo! Finance Canada / MSN 转载，**Reuters 原文与 MSN 转载本机均被封锁**）；JD Supra, 2026-10-20 "Supreme Court Declines to Review USPTO's 'Settled Expectations' Doctrine, Leaving Older Patents Shielded from Inter Partes Review" <https://www.jdsupra.com/legalnews/supreme-court-declines-to-review-uspto-8402006/>（**本机被封锁，仅取得标题与摘要**） |
| 本地路径 | `analysis/scratch/pymnts_scotus.txt`（全文）；`sources/index_all.tsv`（`gn3_scotus`、`bing3_scotus` 行） |
| 置信度 | **secondary（强）** — 日期、政策内容、程序史由 PYMNTS 全文 + JD Supra 标题/摘要 + Reuters 摘要交叉一致；**案名与案号 unverified** |

### 8.2 ITC Section 337 事项（2025–2026） — **未查到 Google 为被诉方的具体案件**

- Alphabet 10-K（2025-12-31）与 10-Q（2026-03-31 / 06-30 / 09-30）在风险因素中**均保留同一段标准披露**："the ITC has increasingly become an important forum to litigate intellectual property disputes because an ultimate loss in an ITC action can result in a prohibition on importing infringing products into the US… preventing us from importing many important products into the US or necessitating workarounds that may limit certain features of our products."（`notes/sec_legal_extracts.md` 第 66、142、208、278、354 行）⇒ **这是通用风险语言，未指名任何具体 §337 调查。**
- 本次检索（Bing News RSS）**未发现 2025–2026 年以 Google/Alphabet 为被诉方（respondent）的 ITC §337 调查报道**。唯一命中的 §337 案件是 **Netlist v. Micron（Inv. No. 337-TA-1523，DDR5 RDIMM/MRDIMM）**，与 Google 无关。
- **结论：ITC 战线在 2026-11-05 前无已核实的 Google 具体案件；建议母单以 Alphabet SEC 风险因素语言作为唯一权威表述。** 置信度：**未查到（negative finding）**。

---

## 9. Google Play 集体和解：\$85M 律师费请求被驳 — **已核实（法院、法官、理由），案号未查到**

| 字段 | 内容 |
|---|---|
| 事项 | **In re: Google Play Store Antitrust Litigation**（50 州 AG + 3 属地于 2021 年 7 月在 N.D. Cal. 提起的州反垄断与消费者保护诉讼）之 **\$700M 集体和解**中，消费者集体律师的**律师费请求被驳回** |
| 日期 | 裁定 **2026-10-16（Reuters 报道日）**；PYMNTS/CPI 2026-10-18；Daily Journal 2026-10-19（标题用 **\$80M**）；JD Journal 2026-10-19/20 |
| 法院/机构 | **U.S. District Court for the Northern District of California（N.D. Cal.）** |
| 法官 | **U.S. District Judge James Donato** |
| 案号 | **未查到**（MDL/合并案号未在可及来源中出现） |
| 金额 | 律师请求 **\$85 million**，从 **Google 的 \$630 million 消费者和解基金**中支付（约占该基金 **13.5%**）。和解整体结构为**两个基金**：消费者基金 **\$630M** + 各州基金（约 **\$70M**）= **\$700M 总额**。Daily Journal 标题写作 "\$80M fee bid" ⇒ **\$85M 与 \$80M 的差异是媒体四舍五入/表述差异，本表以 Reuters 与 JD Journal 的 \$85M 为准** |
| 驳回理由 | **计费记录（billing records）缺乏足够细节**：Donato 法官质疑律师的计费记录是否清楚显示**他们做了什么、以及为什么需要做**。律师自称投入**近 10 万小时（nearly 100,000 hours）**，但记录不足以支持该请求。法官还**逐一审查了各法律团队的角色**，指出 50 个州及其他政府团体的律师也参与了整体法律工作，消费者律师**并非唯一推动和解的团队**。法院同时强调：**大额和解并不保证律师费请求会被批准**，律师仍须证明金额公平且有证据支持；**仅有大量计费小时数不足以证成大额费用奖励** |
| 各州立场 | 加州、纽约、北卡罗来纳、田纳西、犹他等参与州**未背书具体费用金额，但也未反对 \$85M 请求**；法院指出**无人反对并不证明金额公平** |
| 对 \$700M 和解的影响 | **该费用争议本身不取消和解（"The fee dispute does not, by itself, cancel the settlement"）**。消费者基金与各州基金**独立于律师的付费请求**而存在。**律师获得再次支持其请求的机会（another chance to support their request）**，必须先回应法官的关切，法院才能批准费用；**最终奖励金额可能与请求金额不同** |
| 当前状态 | **和解已于 2026 年 8 月获法院批准**（Alphabet 10-Q 2026-09-30："**The Court approved the settlement in August 2026**"；ABC10 2026-08-18 "Judge approves \$700M settlement in Google Play Store monopoly lawsuit"）。**律师费问题未决（fee award pending further briefing）**。各州已开始发放：北卡罗来纳州居民获 **\$20M restitution**（NCDOJ 2026-08-20；WITN 同题；KOTA 2026-08-21 "Google Play users may be in line for payments"；Top Class Actions 2026-05-11） |
| 剩余异议/上诉 | **未查到**任何针对该费用裁定的上诉或剩余的正式异议（objection）。**⇒ 未核实（negative finding）** |
| 证据 | **JD Journal, 2026-10-19/20 <https://www.jdjournal.com/2026/10/20/google-play-antitrust-lawsuit-fee-request-rejected/>（本地已存全文 `analysis/scratch/jdjournal.txt`，含全部理由细节）**；Reuters, 2026-10-16 "US judge rebuffs \$85 million fee request by lawyers in Google Play antitrust litigation"（**原文未取得，标题经 `sources/index_all.tsv` 确认**）；PYMNTS/CPI, 2026-10-18 "Google Play Antitrust Lawyers Denied \$85 Million Fee Request by US Judge"；Daily Journal, 2026-10-19 "Judge rejects \$80M fee bid in Google Play antitrust case"；Alphabet Form 10-Q（2026-09-30）Commitments and Contingencies（本地 `notes/sec_legal_extracts.md` 第 330 行） |
| 本地路径 | `analysis/scratch/jdjournal.txt`（全文）；`notes/sec_legal_extracts.md` 第 50、126、190、254、330 行；`sources/index_all.tsv` |
| 置信度 | **primary（就和解批准而言，来自 Alphabet 10-Q）+ secondary（就费用裁定细节，JD Journal 全文 + Reuters/PYMNTS/Daily Journal 标题交叉）**；**案号未核实** |

---

## 10. "AI 放缓"反垄断诉讼（OpenAI、Anthropic、Google、SpaceXAI）— **已核实（日期、法院、当事方、理论），案号未查到**

| 字段 | 内容 |
|---|---|
| 事项 | 消费者反垄断集体诉讼，指控四家前沿 AI 公司达成**协调放缓 AI 开发的非法协议（illegal agreement on AI slowdown）** |
| 日期 | **2026-09-18（周五）提起**；AP 报道 2026-09-19；Bloomberg Law 2026-09-18 "OpenAI, Anthropic, Google, SpaceXAI Hit With Antitrust Lawsuit" |
| 法院/机构 | **U.S. District Court for the Northern District of California（N.D. Cal.）**（Hindustan Times 明确两处："The lawsuit was filed Friday in the US District Court for the Northern District of California"）。⚠️ **AP 稿件电头为 "SACRAMENTO, California"**，那是记者驻地而非法院地；**Moneycontrol/AP 转载版本未取得正文，故 N.D. Cal. 为 secondary 单一来源确认，标注需以 docket 复核** |
| 案号 | **未查到** |
| 当事方 | 被告：**Anthropic、OpenAI、SpaceXAI、Google**（4 家）。原告：**Gemini、Grok、ChatGPT 或 Claude 的付费订阅用户**，代表**一个拟议的全国付费订阅者集体（proposed nationwide class of other paid subscribers）**。**原告首席律师：Nick Rowley** |
| 理论 | ① 被告**违反反垄断法**，因其**同意协调放缓各自 AI 开发的步伐**；② 该协调**降低了消费者从付费 AI 订阅中获得的价值**（value for paid subscriptions）；③ 诉状称**放缓协调始于数月前**；④ 原告**不反对各公司出于安全单独自主决定放缓自身进度**，反对的是**私下的、自利的协调协议** |
| 关键引文 | Nick Rowley："**AI will quickly spin out of human control and could kill us all if we allow AI safety and protocol … to be controlled by private self-serving agreements between the world's most powerful 'for profit' technology companies.**" |
| 背景 | 紧随 AI 安全辩论再起之后：**Anthropic CEO Dario Amodei** 在其文章中主张**全行业放缓与第三方评估**，并警告若无放缓，6–12 个月内 AI 可能能领导"接管整个互联网的代理集群" |
| 当前状态 | **已起诉（filed），审理前阶段**；**未查到任何被告应诉、驳回动议或裁定的报道**（截至 2026-11-05） |
| 金额或救济 | **未查到**（未报道具体金额） |
| 证据 | AP News, 2026-09-19 "Lawsuit says Anthropic, OpenAI, SpaceXAI and Google made illegal agreement on AI slowdown"（原始 AP 稿，**本机未取得正文**）；**Hindustan Times, 2026-09-19 <https://www.hindustantimes.com/world-news/violates-antitrust-laws-anthropic-openai-spacexai-google-face-lawsuit-over-illegal-agreement-on-slowdown-101789874422499.html>（本地已存全文 `analysis/scratch/ht_slowdown.txt`，含法院、原告律师、理论细节）**；Bloomberg Law News, 2026-09-18；Yahoo Finance, 2026-09-19 <https://www.yahoo.com/news/politics/articles/lawsuit-says-anthropic-openai-spacexai-163229304.html>；Yahoo Finance（分析）2026-09-23 <https://finance.yahoo.com/technology/ai/articles/ai-antitrust-lawsuit-against-spacex-173545503.html>；Moneycontrol, 2026-09-20；Fox40/AP, 2026-09-19（**520，未取得**）；MSN 转载 |
| 本地路径 | `analysis/scratch/ht_slowdown.txt`；`sources/index_all.tsv`（`bing_*` 行）；`analysis/bing_real_urls.txt` |
| 置信度 | **secondary**（AP 为原始来源但正文未取得；Hindustan Times 全文提供细节，属二手转述）；**法院：secondary-单一来源确认**；**案号：未查到** |
| 关于 "SpaceXAI" | 报道一致使用该名称。本地语料另有大量 2026-10 报道显示 **SpaceX 已拥有实质 AI 业务**（"SpaceX's AI business is beating expectations"，TechCrunch 2026-10-20；"SpaceX says its capex could double this quarter as AI spending grows"，Business Insider 2026-10-20），且 **Alphabet 持有 SpaceX 权益并在 Q3 2026 对其减记**（见 7.3）。⇒ **"SpaceXAI" 应理解为 SpaceX 的 AI 业务/实体；其与 Alphabet 之间的投资关系构成本案潜在的利益冲突议题，但可及来源未讨论此点。** |

---

## 11. AI 相关监管（非欧盟）：美国州法、FTC、国会 — **大部分未核实**

| 事项 | 已核实内容 | 置信度 |
|---|---|---|
| **California SB 942 / AI 透明度法** | **未查到** 2026 年任何关于 SB 942 适用于 Google 的执法、诉讼或合规争议报道。本地语料 `raw/news3/gn3_ai_act.xml` 存在但未提取到相关条目 | **未核实** |
| **Colorado AI Act** | **未查到** 任何点名 Google 的 Colorado AI Act 事项 | **未核实** |
| **FTC 针对 Gemini / AI Overviews 的行动或调查** | **未查到**。Bing News RSS 检索 "FTC investigation Google Gemini AI Overviews 2026" 仅返回 Gemini 安全事件（模型入侵三家公司）与 Gemini 4 Argon 分阶段发布的产品新闻，**无 FTC 行动** | **未查到（negative finding）** |
| **2026 年点名 Google 的国会活动** | ① Chegg/Penske 判决后媒体普遍表述"**救济只能来自国会**"（"Court Rules Traffic Crisis Needs Congress"，Tech Times/MSN 2026-10-15），但**未查到具体议案编号或听证**；② **DOJ 于 2026-09-03 表态支持 OpenAI 的 fair use 主张，并称创作者"必须去找国会"**（AP/MSN）；③ **联邦自动驾驶安全法案**：Tech Times 2026-07-30 "Waymo Freeways Return: Airport Rides Resume as **Federal Bill Targets AV Safety Gap**"（**与 Waymo 直接相关，议案编号未查到**）；④ 本地语料含 `raw/govinfo_google_hearings.html`（国会听证检索页），**未提取到 2026 年点名 Google 的 AI 相关听证** | **部分 secondary，多数未核实** |
| **学校/教育场景的 AI 争议（新出现的战线）** | **2026-11-03/04**：多家媒体报道 Google **告知学校"要么接受其 AI，要么失去其搜索引擎"** —— Wired 2026-11-04 <https://www.wired.com/story/google-is-forcing-ai-overviews-in-classrooms-schools-are-searching-for-a-way-out/>；24/7 Wall St. 2026-11-04 "Google Is Telling Schools to Take Its AI or Lose Its Search Engine"；CNBC 2026-11-04 "Google responds to political backlash over removing search from schools that ban AI"；MediaNama 2026-11-04 "Schools cannot turn off Google AI Overviews and keep Search"；PYMNTS/CPI 2026-11-04 "**Google's School AI Strategy Raises Questions Over Market Power**"。⇒ **已引发政治反弹（political backlash），Google 已公开回应；但截至 2026-11-05 未查到诉讼或监管立案** | **secondary（多家一致，含 Google 回应）** |
| **印度最高法院审查 Google Play "Authorised Provider" 计费政策** | 2026-11-03/04：India Supreme Court 询问应用开发者能否退出 Google 的支付系统（MediaNama、LiveLawBiz）。**属非美司法辖区、非本表重点，仅登记** | secondary |

---

## 12. Waymo：产品责任 / NHTSA — **已核实（存在多起事项），案号与调查编号未查到**

| 事项 | 日期 | 机构 | 状态 | 证据 | 置信度 |
|---|---|---|---|---|---|
| **NHTSA 对"机器人出租车低速撞击儿童"事件的调查**；Waymo 已提交文件 | 碰撞发生于 **2026 年 1 月**；Waymo 回复 NHTSA 问题 **2026-08-21** | **NHTSA**（调查编号 **未查到**，非 recall 编号亦未查到） | **调查进行中**；Waymo 已"hands over documents" | TechCrunch, 2026-08-21 <https://techcrunch.com/2026/08/21/waymo-hands-over-documents-in-nhtsas-child-collision-probe/> | secondary |
| **Waymo 暂停并在两个月后恢复高速公路运营** | 暂停约 **2026 年 5–6 月**（车辆"repeatedly failed to"正确处理高速场景）；**2026-07-29（周三）起在凤凰城率先恢复**，机场接送同步恢复 | NHTSA 监管背景 + 公司自主暂停 | **已恢复运营**；与一次 **recall** 相关 | Gizmodo, 2026-07-29 <https://gizmodo.com/waymo-returns-to-freeways-after-recall-2000792674>；Tech Times, 2026-07-30 <https://www.techtimes.com/articles/322163/20260730/waymo-freeways-return-airport-rides-resume-federal-bill-targets-av-safety-gap.htm> | secondary |
| **"尽管有 recall，Waymo 似乎仍无法修复这一危险问题"** —— 多次软件修复、**多项 NHTSA 调查**与一次 recall 之后，车辆仍在犯同类不安全错误 | 2026-01-17 | NHTSA（调查数量与编号**未查到**） | 报道 | The Street, 2026-01-17 <https://www.thestreet.com/technology/despite-recall-waymo-cant-seem-to-fix-this-dangerous-issue> | secondary |
| **672 辆机器人出租车 recall**（撞击木质电线杆事件后，更新软件与地图以避让物体） | 事件 2024 年 5 月，recall 宣布 2024-06-13；报道重发 2026-10-05 | NHTSA / Waymo | 已完成（历史事项，作为 recall 史背景） | MSN/Autos <https://www.msn.com/en-in/autos/general/waymo-recalls-672-robotaxis-after-pole-crash-...> | secondary |
| **Waymo 产品责任民事诉讼（个人原告）** | — | — | **未查到** 2025–2026 年任何具名 Waymo 产品责任诉讼的报道或案号 | — | **未查到（negative finding）** |

⇒ **结论**：Waymo 战线截至 2026-11-05 **只有监管事项（NHTSA 调查 + recall），没有已核实的私人民事产品责任诉讼**。Alphabet 10-Q/10-K 的 Commitments and Contingencies 章节亦**未单独列示 Waymo 诉讼**（见 `notes/sec_legal_extracts.md`）。

---

## 13. Alphabet 自身披露中的权威基线（SEC 一手，供母单校准）

摘自本地 `notes/sec_legal_extracts.md`（对应 `txt/10-Q_2026-09-30_000165204426000084.txt`、`txt/10-K_2025-12-31_000165204426000018.txt`）：

- **Google Play 州 AG 和解**：2021 年 7 月由多州 AG 在 **N.D. Cal.** 提起；2023 年 9 月与 **50 州 AG + 3 属地**达成原则性和解并确认费用；**2024 年 5 月将和解金额汇入托管代理人**；2025 年 11 月初步批准；**2026 年 8 月法院批准和解**。（10-Q 2026-09-30）
- **Epic Games v. Google**：2023 年 12 月加州陪审团作出不利裁决（Epic 未请求金钱赔偿）；2024 年 10 月救济裁定；2025 年 7 月上诉法院驳回 Google 上诉；Google  petition SCOTUS；2025 年 10 月实施救济；**2026 年 3 月与 Epic 达成和解并撤回 SCOTUS 申请**；2026 年 4 月双方联合动议修改禁令；**2026 年 7 月双方联合撤回该动议，Google 遵循 2024 年 10 月救济裁定**。（10-Q 2026-09-30 / 10-K 2025-12-31）
- **EU DMA**：2026 年 7 月 EC 作出两项不合规决定，**Google Play €430M + Search €460M**，Q3 2026 确认 **\$1.0 billion** 费用；**Google 于 2026 年 10 月对两项决定提起上诉，两案均在审**。（**属母单范围，仅交叉引用**）
- **EU Android（2018）**：€4.3B 罚款 → General Court 减至 €4.1B → **ECJ 于 2026 年 7 月驳回上诉，决定已终局；2026 年 7 月 Google 现金支付 \$5.2 billion（罚款 + 应计利息）**。（**属母单范围**）
- **PriceRunner（Klarna 子公司）私人诉讼**：**2026 年 7 月 Stockholm Patent and Market Court** 判 Google 败诉，**约 \$2.1 billion** 本金损害赔偿 + 应计利息与费用，Q2 2026 确认；**Google 已上诉，上诉在审**。（属竞争法私人诉讼，非 AI，但为**当前最大的单一金钱敞口**，供母单参照）
- **IP 风险因素标准语言**：patent / copyright / trade secret / trademark 侵权诉讼可能导致"substantial monetary damages、costly royalty or licensing agreements、或禁止提供某些特性/功能/产品/服务的命令"；并含 ITC 段落（见 8.2）。
- **未发现**：10-K/10-Q 的 Commitments and Contingencies **未单独披露** Chegg、Penske、Keene、Rosen 代表诉讼、Gemini 3.5 Pro 证券集体诉讼、C-250/25、Hachette/Cengage/Elsevier/Turow、Lyria 独立音乐人案、社交媒体成瘾诉讼 —— 即 **Alphabet 认为这些事项 individually 与 collectively 均不属"reasonably possible loss 可合理估计"而须单列的范畴**。⇒ **这本身是一个对母单有用的披露信号。**

---

## 14. 未核实 / 存在矛盾 / 需要母单补强的线索汇总

| # | 线索 | 本表结论 | 下一步（母单可执行） |
|---|---|---|---|
| 1 | **2026-10-31 五家法国出版者集团向 EU 投诉** | **unverified — 单一来源（PPC Land）**，Bing News RSS 多组关键词未找到第二来源；投诉机构与法律基础未定 | 直接访问 PPC Land 站点内检索；或查 EC 竞争总司/DG CONNECT 的 complaint 登记；查法文媒体（Les Échos、La Tribune、Le Monde） |
| 2 | **全部案号（docket numbers）** | Chegg、Penske、Keene、Rosen v. Pichai、Alphabet 证券集体诉讼、AI 放缓诉讼、Google Play MDL —— **均未查到** | PACER；或 CourtListener（本机 401/403，需换出口 IP / RECAP 扩展）；N.D. Cal.、D.D.C.、N.D. Ill. 各院的 opinion 数据库；`govinfo.gov` 不适用 |
| 3 | **SCOTUS 2026-10-19 案名与 docket 号** | 未查到；政策与程序史已核实 | `supremecourt.gov/orders/courtorders/`（本机返回 302/错误页，需重试或换 UA）；Reuters 原文；Federal Circuit 2025–2026 判决（*Google LLC v. VirtaMove*?）；SCOTUSblog docket 检索 |
| 4 | **Penske 上诉的巡回法院与上诉案号** | 事实已核实（2026-11-04 正式上诉）；**巡回法院为 D.C. Circuit（由 D.D.C. 原审推断，非报道原文）** | `cadc.uscourts.gov` 案号检索；DMN 原文（本机 HTTP 520，需重试）；The Hollywood Reporter（Winston Cho）后续报道 |
| 5 | **2026-03-25 LA 裁决的赔偿金额（母单称 \$6M）** | **本表未独立核实**；可及来源正文未取得 | NBC LA / KTLA 正文；LA Superior Court 判决；Daily Journal（付费） |
| 6 | **Section 230 上诉的案号与法院** | **未查到** | `appellatecases.courts.ca.gov`（Cal. Courts of Appeal 检索）；Law.com 2026-11-04 Bronstad 专栏正文 |
| 7 | **联邦 MDL（In re: Social Media Adolescent Addiction / Screen Time Products Liability Litigation）2026 年 10–11 月状态** | **未核实**；仅取得 AEI 评论（称 >2,000 件、走向简易判决与 bellwether） | `jpml.uscourts.gov`；N.D. Cal. MDL 页面（Judge Yvonne Gonzalez Rogers）；MDL 编号需复核（本地与检索均未取得） |
| 8 | **学区诉讼中 Google 的具体案号与首个开庭日** | Google/YouTube 是共同被告**已核实**（Reuters 2026-10-28）；具体案件与日期**未查到** | Law.com 2026-11-04 "Critical Mass" 正文；JCCP 5255 日程 |
| 9 | **ITC §337 涉 Google 案件** | **negative finding — 未查到** | `usitc.gov` 337Info 检索 "Google" / "Alphabet"（2025–2026） |
| 10 | **FTC 针对 Gemini / AI Overviews 的行动** | **negative finding — 未查到** | `ftc.gov` newsroom 检索；6(b) 研究进展 |
| 11 | **California SB 942 / Colorado AI Act 对 Google 的适用** | **未核实** | 加州 AG / Colorado AG 执法公告；各州 AI 法生效日期与豁免条款 |
| 12 | **Alphabet 证券集体诉讼的首席原告截止日** | **两个版本并存：2026-11-30（Robbins、Faruqi）与 2026-12-01（L&K、BFA、Glancy、Howard G. Smith）** | 以 N.D. Cal. 的 PSLRA 通知/法院命令为准 |
| 13 | **Google 对 C-250/25 AG 意见的正式回应** | **未查到** | Google 新闻室 / blog.google；Hengeler Mueller 客户通讯全文；Reuters 2026-11-03 正文（Landauro & Foo Yun Chee） |
| 14 | **Google Play \$8.25M 儿童隐私集体和解（2026-05-29）** | **unverified — 单一来源（Claim Depot）** | Top Class Actions / 法院批准文件 |
| 15 | **"Alphabet Reveals Another \$98.5 Billion in Potential AI Obligations"（2026-10-29）** | **unverified — 单一来源** | Alphabet Q3 2026 8-K exhibit 99.1（本地 `txt/8-K_2026-10-28_..._googexhibit991q32026.txt`）与 10-Q 现金流量表附注核对 |

---

## 附录 A：本地文件索引（本会话产物，全部位于 `信息比对-19dd5c9c/` 内）

| 路径 | 内容 |
|---|---|
| `analysis/bing_real_urls.txt` | 从 `sources/index_all.tsv` 的 Bing News 重定向链接中解码出的 **692 条真实文章 URL**（带日期与标题），是本表 URL 的主要来源 |
| `analysis/scratch/cp260155en.pdf` | **Curia Press release No 155/26（C-250/25）原始 PDF** |
| `analysis/scratch/cp_clean.txt` | 上述 PDF 的全文抽取（纯 Python + zlib，无 pdftotext 可用） |
| `analysis/scratch/curia_c250.txt` / `.html` | Curia 案件新闻页（Opinion: Case C-250/25 Like Company） |
| `analysis/scratch/arstech.txt` | Ars Technica Chegg/Penske 驳回全文（含 Mehta 判决引文） |
| `analysis/scratch/mbw_derivative.txt` | Music Business Worldwide：Rosen v. Pichai 等 13 人代表诉讼全文（含起诉状引文） |
| `analysis/scratch/lk_alphabet.txt` | Levi & Korsinsky 通稿全文（证券集体诉讼：N.D. Cal.、§10(b)/§20(a)、类别期间） |
| `analysis/scratch/morningstar_robbins.txt` | Robbins LLP 通稿全文（证券集体诉讼：股价数字、Google I/O 起点、Bloomberg 揭露日） |
| `analysis/scratch/merc_keene.txt` | Mercury News：Keene v. Google AI 诽谤案全文 |
| `analysis/scratch/pymnts_scotus.txt` | PYMNTS：SCOTUS 2026-10-19 拒绝受理 Google 专利审查政策挑战全文 |
| `analysis/scratch/pymnts_eu.txt` | PYMNTS：Gemini 欧盟版权审查全文 |
| `analysis/scratch/crypto_eu.txt` | Crypto Briefing：C-250/25 全文（移送/口头审理日期、Art. 15 分析） |
| `analysis/scratch/jdjournal.txt` | JD Journal：Google Play \$85M 律师费被驳全文 |
| `analysis/scratch/ht_slowdown.txt` | Hindustan Times：AI 放缓反垄断诉讼全文（N.D. Cal.、Nick Rowley、原告集体定义） |
| `analysis/scratch/{get.sh,batch.sh,bnews.py,bsearch.py}` | 抓取与检索工具（Bing News RSS 解链、批量抓取 + `scripts/html2txt.py`） |

## 附录 B：抓取可达性记录（供母单复用，避免重复踩坑）

- **可达且返回全文**：`curia.europa.eu`（含 PDF）、`arstechnica.com`、`musicbusinessworldwide.com`、`pymnts.com`、`mercurynews.com`、`jdjournal.com`、`hindustantimes.com`、`cryptobriefing.com`、`morningstar.com`（BusinessWire 转载）、`financialcontent.com`、`bing.com/news/search?format=rss`（**最有效的解链入口**）。
- **被封锁 / 失败**：`law.com`（付费墙）、`reuters.com`（正文未取得）、`courthousenews.com`（403）、`abovethelaw.com`（403）、`jdsupra.com`（1 字节）、`techrepublic.com`（725 字节 = 拦截页）、`digitalmusicnews.com`（HTTP 520）、`fox40.com`（空）、`msn.com`（1 字节）、`mercedsunstar.com`（无输出）、`supremecourt.gov/orders`（302 / 错误页）、`html.duckduckgo.com` 与 `lite.duckduckgo.com`（反爬空页）、CourtListener（401/403，任务书已告知）、Justia（403，任务书已告知）。
- **`web_fetch` 工具**对上述新闻站点会返回被导航菜单占据并截断的内容；**`curl` + `scripts/html2txt.py` 组合更可靠**。
- **Google News RSS 链接（`news.google.com/rss/articles/CBMi...`）无法在本机解析**：`curl -I` 返回 302 指回自身，`curl -L` 返回 200 的 JS 中间页。**⇒ 凡语料中链接为 Google News 重定向者，只能通过标题+出版方反查真实 URL（Bing News RSS 是有效替代）。**
