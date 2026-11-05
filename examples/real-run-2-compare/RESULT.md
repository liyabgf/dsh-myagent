# 信息比对

- Ticket: 19dd5c9ca7bce11fb2c9f7a2b04728b0
- State: ready
- At: 2026-11-05T07:29:13.535Z
- Authorized by: operator via session
- Policy version: 670e0f054cdfaf9a

## Scope

Work in this Ticket's own directory. Produce files there and report what they are; do not change anything outside it.

## Summary

任务完成。谷歌系法律事件已按一手文件重建为可审计的年表，并与另一 Ticket（搜集信息 / b356ac64）的业务信息合并成综合论述。

**先读这三个文件**
1. `analysis/02_谷歌法律处境综合论述.md` —— 主论述（308 行）。核心判断：谷歌在反垄断上赢了"不拆分"（Chrome 不剥离、AdX 不剥离），但输掉了对**分发、数据、内容**三项独占权；罚款可计提、制度不可计提。三条最重要的具体发现：(a) DC 巡回法院 No. 26-5023 交叉上诉中司法部**唯一争点是 payment ban**——这是唯一能摧毁付费默认模式（TAC）的尾部风险，Apple 已于 2026-11-03/04 出庭辩护；(b) 欧盟已从"开罚单"转向"写规格书"——2026-07-16 依 DMA 发布**有约束力**措施，要求第三方 AI 助理获得与 Gemini 同等的 Android 接入、第三方搜索引擎（含 AI 聊天机器人）获得 FRAND 搜索数据；(c) 2026-03-25 洛杉矶陪审团认定 Meta 与 **YouTube** 过失成立、平台被设计成使儿童成瘾（判赔 $6M），YouTube 2026-07-15 加入上诉、并已就第二号 bellwether 在 Snap 之前和解——这是唯一已经输掉陪审团裁决的战线，且改变的是责任规则而非市场规则。另有 §7.5（青少年安全）、§9（财务翻译：应计罚款与和解 $13.807B、2026-07 实付 $5.2B，对照前 9 个月 capex $131.953B、长期承诺 $802.1B、**回购归零并净融资 +$115.757B**）、§11（12–24 个月情景分析，概率标注为主观估计）。
2. `analysis/01_法律事件年表.md` + `analysis/legal-events-chronology.csv` —— **137 条**事件、45 个板块，每条含日期/机构或法院/案号或决定编号/状态/金额/证据（本地路径或 URL）/置信度（high 75、medium 57、low 5；PRIMARY 66 条）。
3. `analysis/03_信息比对_两Ticket对照.md` —— 标题所指的"信息比对"：采集面对比、双方独立命中的交集、**7 处冲突及裁定**（Gemini 用户口径、Epic 和解时间线在 Alphabet 自身 10-K 与 10-Q 之间自相矛盾、adtech 判决日 vs 解封日、€2.95B vs €3.0B、PriceRunner 事件日 vs 入账期、"躲过拆分"的误读、backlog $567.7B vs $514B）、只有本 Ticket 有的一手证据、只有对方有的业务证据、6 组交叉推断、10 项缺口。

**其余交付物**：`analysis/05_监管与法律风险自述与敞口量化.md`（Alphabet 自己写给投资者/债权人的 9 组风险原文引用含行号 + `legal-exposure-register.csv` 50 行，按"已支付/已计提/已作出待缴/已判决/已批准待分配/请求中/理论上限"分类，避免跨币种跨状态错误相加）；`analysis/04_给搜集信息Ticket的口径修正.md`（14 条）；`README.md`（阅读顺序、目录、证据分级、局限、复现命令）。

**证据基础**：一手文件为主——Alphabet 8 份 SEC 文件（10-K FY2025、10-Q Q3'25/Q1'26/Q2'26/Q3'26、8-K+EX-99.1、424B2 €6B 欧元债）；DOJ 案卷 12 份 PDF（2025-12-05 终审判决与 95 页备忘录意见、DC Cir. 上诉书状 2 份共 31 万字符、两份合规报告、2026-08-25 命令、许可模板建议）；欧盟委员会 presscorner 原文 12 份；英国 CMA 原文 9 份；Curia 新闻稿 No 155/26（C-250/25 总法律顾问意见全文）；爱尔兰 DPC €403M 官方新闻稿；英国 CAT 案件表。新闻侧：三阶段共 76+78 个源，两套语料统一索引 4,755 行，法律相关去重 748 条（仅本 Ticket 546 / 仅对方 160 / 双方 42）。8 个可复现脚本在 `scripts/`。

**两个子任务**：`notes/scope_a_jurisdictions_privacy.md`（472 行，非美国辖区+隐私，含 14 条"未核实或被证伪"清单）与 `notes/scope_b_ai_ip_securities.md`（472 行，AI/知识产权/证券/青少年安全）均已交付并全部吸收。其关键纠正包括：€403M 是**爱尔兰 DPC** 而非欧盟；韩国机关是 **KMCC**（Google KRW 42.9bn + Apple 20.81bn）而非 KCC/KFTC；英国 CAT 的 Rodger 开发者集体（£260M）与 Coll 消费者集体（>£1bn，2026-10-06 开审）是两案；Chegg/Penske 由 D.D.C. 的 **Mehta 法官**（与 DOJ 搜索案同一人）于 2026-09-30 以"期待不等于协议"驳回。

**未能完成的部分（如实标注）**：**所有案件的案号均未取得**——CourtListener API 401、其 HTML 403，Justia 403，supremecourt.gov/orders 302，law.com 与 reuters.com 正文封锁；补齐需要 PACER 访问权或更换出口 IP。EDVA adtech 106 页救济判决全文、纽约 88 页意见、C-604/22 P 判决原文、印度/韩国/日本/波兰/土耳其原始决定亦未取得，相关条目在年表中已降为 medium/low 置信。跨 Ticket 事实传递通道不可用：`myagent_note_ticket` 返回 `collaboration_refused`（两个 Ticket 都无 workId，不属于任何 Work），故 14 条修正以 `analysis/04_...md` 文件形式给出；对方目录全程只读，未修改。

## Files

- README.md
- analysis/01_法律事件年表.md
- analysis/02_谷歌法律处境综合论述.md
- analysis/03_信息比对_两Ticket对照.md
- analysis/04_给搜集信息Ticket的口径修正.md
- analysis/05_监管与法律风险自述与敞口量化.md
- analysis/legal-events-chronology.csv
- analysis/legal-exposure-register.csv
- analysis/bing_real_urls.txt
- notes/scope_a_jurisdictions_privacy.md
- notes/scope_b_ai_ip_securities.md
- notes/sec_legal_extracts.md
- notes/legal_candidates.tsv
- notes/legal_top.md
- notes/fetch_stage1.log
- notes/fetch_stage2.log
- notes/fetch_stage3.log
- sources/index_all.tsv
- sources/manifest_stage1.csv
- sources/manifest_stage2_sec.csv
- sources/manifest_stage3.csv
- scripts/fetch_legal.py
- scripts/fetch_sec.py
- scripts/fetch_stage3.py
- scripts/html2txt.py
- scripts/parse_index.py
- scripts/filter_legal.py
- scripts/build_chronology.py
- scripts/build_exposure_register.py
- txt/10-K_2025-12-31_000165204426000018.txt
- txt/10-Q_2025-09-30_000165204425000091.txt
- txt/10-Q_2026-03-31_000165204426000048.txt
- txt/10-Q_2026-06-30_000165204426000071.txt
- txt/10-Q_2026-09-30_000165204426000084.txt
- txt/424B2_2026-11-04_000119312526447343.txt
- txt/8-K_2026-10-28_000165204426000080.txt
- txt/8-K_2026-10-28_000165204426000080_googexhibit991q32026.txt
- txt/doj/search_final_judgment_2025-12-05.txt
- txt/doj/search_memorandum_opinion_2025-12-05.txt
- txt/doj/search_us_opening_brief_cross_appeal_2026-10-21.txt
- txt/doj/search_us_reply_brief_cross_appeal_2026-10-29.txt
- txt/doj/search_plaintiffs_1st_compliance_report_2026-05-04.txt
- txt/doj/search_plaintiffs_2nd_compliance_report_2026-09-17.txt
- txt/doj/search_order_2026-08-25_status_conference.txt
- txt/doj/search_order_2026-05-29.txt
- txt/doj/search_syndication_recommendation_2026-10-13.txt
- txt/doj/search_syndication_recommendation_full_2026-10-13.txt
- txt/doj/search_joint_status_report_2026-09-30.txt
- txt/doj/search_joint_status_report_2026-10-14.txt
- txt/eu/eu_IP_26_1670.txt
- txt/eu/eu_IP_26_1634.txt
- txt/eu/eu_IP_26_887.txt
- txt/eu/eu_IP_26_825.txt
- txt/eu/eu_IP_26_333.txt
- txt/eu/eu_IP_26_202.txt
- txt/eu/eu_IP_25_2964.txt
- txt/eu/eu_IP_25_2675.txt
- txt/eu/eu_IP_25_1992.txt
- txt/eu/eu_IP_25_811.txt
- txt/eu/eu_STATEMENT_25_2034.txt
- txt/eu/eu_SPEECH_25_2460.txt
- txt/uk/cma-confirms-google-has-strategic-market-status-in-search-services.txt
- txt/uk/cma-confirms-apple-and-google-have-strategic-market-status-in-mobile-platforms.txt
- txt/uk/cma-proposes-package-of-measures-to-improve-google-search-services-in-uk.txt
- txt/uk/cma-secures-fairer-deal-for-publishers-and-improves-google-search-services-in-uk.txt
- txt/uk/cma-consults-on-new-requirements-for-apple-and-googles-mobile-platforms.txt
- txt/uk/cma-secures-commitments-from-apple-and-google-to-improve-fairness-in-app-store-processes-and-enhance-ios-interoperability.txt
- txt/uk/cma-strengthens-proposals-allowing-people-choice-over-their-search-service.txt
- txt/uk/cma-proposes-action-to-drive-more-competition-on-mobile-platforms.txt
- txt/uk/cma-takes-first-steps-to-ensure-choice-in-business-software.txt
- txt/articles/247wallst_adtech_3_2b.txt
- txt/articles/adexchanger_brinkema_tldr.txt
- txt/articles/yahoo_adtech_remedies.txt
- txt/doj_atr_google_search_case.txt
- txt/texas_ag_google.txt
- txt/eu_dma_gatekeepers_page.txt
