# Alphabet / Google：非美国辖区诉讼与监管 + 数据隐私 / 消费者保护 事实清单

**截点：2026-11-05（Asia/Shanghai）。范围（Scope A）：非美国诉讼与监管事项，加数据隐私与消费者保护。不含美国联邦反垄断（DOJ Search、DOJ Ad Tech、Epic v. Google）、EU DMA 执法、UK CMA 数字市场事项（由母单处理）。**

方法与置信度约定

本地语料先挖（`sources/index_all.tsv`、`notes/legal_candidates.tsv`、`raw/news3/*.xml`、`notes/sec_legal_extracts.md`、`txt/10-K_2025-12-31_000165204426000018.txt`、`txt/10-Q_2026-09-30_000165204426000084.txt`），再用 `curl` 抓官方页与主流媒体校验。**confidence 标记**：`primary` = 官方文件/公司 SEC 披露；`secondary` = 两家以上主流媒体或一家专业法律媒体；`unverified` = 单一来源或无法回到原始决定。

金额口径三种状态分开记：**已作出（imposed）**、**已支付（paid）**、**已计提（accrued）**、**仅提出请求（claimed）**。币种一律照原文，折算照引用来源给出的数字，不自行换算。

一条重要的口径提示：Alphabet 在 2026 年 Q3 10-Q 中，除 EC 的 Android（2026 年 7 月现金支付 52 亿美元）与 DMA 罚款（计提 10 亿美元）外，**未对下列任何非美国罚款单独计提或披露金额**；其在 "Privacy Matters" 段落仅笼统称存在多辖区调查与诉讼。这意味着爱尔兰 DPC 的 4.03 亿欧元罚款在 2026 年 Q3 报表中未被单独量化披露（10-Q 于 2026-10-28 提交，晚于 9-21 决定）。

---

## 一、确认事项总表

| # | 事项 | 首次发生 | 最新进展 | 机构 / 法院 | 案号 / 决定编号 | 金额 | 状态 | 置信度 |
|---|---|---|---|---|---|---|---|---|
| 1 | WinZO 诉 Google（真金游戏） | 2023（WinZO 投诉） | 2026-09-08/09 结案 | CCI | 未取得 | 无 | 因 Online Gaming Act 生效而关闭调查，无认定、无救济 | secondary |
| 2 | 印度 App 开发者诉 Google Play 计费 / "Authorised Provider" | 2022（合同变更 2022-10-03） | 2026-11-03 开庭，下次 2026-12-01 | Supreme Court of India | 未取得（Madras HC 上诉） | 未量化 | 审理中；争点为 PSS Act 管辖权与条款效力 | secondary |
| 3 | CCI Play 计费处罚 | 2022-10 | 2025-03-28/29 NCLAT 改判 | CCI → NCLAT → SC | CCI 案号未取得 | ₹936.44 crore → NCLAT 减至 ₹216.69 crore | Google 已向 SC 上诉（2025-07/08） | secondary |
| 4 | CCI Android TV 承诺和解 | 2022 | 2025-04-22 CCI 接受 | CCI | 未取得 | ₹20.24 crore | 已结案（承诺/和解） | secondary |
| 5 | 韩国 KMCC 对 Google + Apple 应用内支付罚款 | 2023-10（KCC 预告） | 2026-10-28 决定 | Korea Media and Communications Commission (KMCC) | 未取得（书面决定 2026-11 出） | 合计 KRW 63.71 bn（≈US$47.6m）；Google KRW 42.9 bn、Apple KRW 20.81 bn | 已作出 + 纠正令；两家均表异议，未确认起诉 | secondary（高） |
| 6 | KFTC "Project Hug" 应用商店案 | 2026-07-01 | 2026-07-01 立案 | Korea Fair Trade Commission | 未取得 | 潜在上限 KRW 850 bn（媒体估算，非决定） | 审理中 | secondary |
| 7 | 日本 JFTC 排除措置命令（Search 分销 / Android 协议） | 2023-10（立案） | 2025-04-15/16 命令 | Japan Fair Trade Commission | 未取得 | 无罚款 | 命令生效，Google 已改约 | primary（SEC 10-K）+ secondary |
| 8 | 日本 MSCA 合规 | 2024-06 立法 | 2026-08-26 行业投诉/调查报告 | JFTC（指定 Apple、Google） | — | — | 2025-12-18 全面生效；2026 年合规评估进行中 | secondary |
| 9 | 澳大利亚 ACCC Search 分销和解 | 2022-06（立案） | 2025-12 法院批准 | ACCC / Federal Court of Australia | 未取得 | A$55m（≈US$36m） | 和解生效，含 Android 协议修改 | primary（SEC 10-K，金额为 secondary） |
| 10 | 波兰 UOKiK 出版者报酬案 | 2026-10-05 | 2026-10-05 提出指控 | UOKiK（Prezes UOKiK, Tomasz Chróstny） | 未取得 | 上限为营业额 10% | 调查/抗辩阶段 | secondary（多源含波兰本地媒体） |
| 11 | 土耳其 RK 对 AI Overviews / AI Mode 调查 | 2026-08-27（预调查决定） | 2026-11-02 公告立案 | Rekabet Kurumu (RK) | Law No. 4054 Art. 41 程序 | 未定 | 调查中 + 2026-10-08 临时措施 | secondary |
| 12 | 加拿大 Competition Bureau 广告技术滥用案 | 2024-11（起诉） | 2026-03-05 宪法抗辩被驳 | Competition Tribunal | 未取得 | 未定 | 实体审理推进 | secondary |
| 13 | 巴西 CADE 新闻内容/出版者报酬案 | 2026-04-23/24 | 2026-04-24 立案 | CADE | 未取得 | 未定 | 行政程序进行中 | secondary |
| 14 | 爱尔兰 DPC 位置数据 GDPR 罚款 | 2020-02（立案） | 2026-09-21 决定 | Irish Data Protection Commission | own-volition inquiry（决定号未公布） | **€403m**（≈US$463m） | 已作出；6 个月内整改；完整决定待公布 | **primary** |
| 15 | 美国 Texas 主导隐私和解 | 2025-05-09 宣布 | 2025-10 完成（finalized） | Texas AG（Paxton）/ 两案 | 未取得 | **$1.4bn**（另报 $1.375bn） | 已支付/已计提并完成 | primary（SEC 10-K）+ secondary |
| 16 | Google Assistant 隐私集体诉讼和解 | 2026-01-26 宣布 | 2026-10-13 终审批准 | N.D. Cal. | 未取得 | **$68m** | 终审批准 | secondary |
| 17 | 儿童隐私（Play Store 应用）和解 | 2026-01 宣布 | 2026-10-22/23 终审批准 | 美国联邦法院（N.D. Cal.） | 未取得 | **$8.25m** | 终审批准 | secondary |
| 18 | Android 数据传输和解 | 2026-01-28 宣布 | 2026-08 终审批准 | N.D. Cal. | 未取得 | **$135m** | 终审批准 | secondary |
| 19 | Web & App Activity 隐私陪审团裁决 | 2025-09-03 | 2026-08-27 律师费动议 | N.D. Cal. | 未取得 | **$425.7m** 裁决 | 裁决（非和解），后续程序 | secondary |
| 20 | YouTube 儿童隐私和解 | 2025-08 宣布 | 2026-01-13 终审批准 | 美国联邦法院 | 未取得 | **$30m** | 终审批准 | secondary |
| 21 | 英国 CAT：开发者集体诉讼和解（Rodger） | 2022 提起 | 2026-09-15/16 批准，2026-10-09 公布 | Competition Appeal Tribunal | 未取得 | **£260m**（≈US$353–354m；£160m 赔偿 + £100m 费用） | 已批准，分配待批 | secondary |
| 22 | 英国 CAT：消费者集体诉讼（Coll） | 2022 提起 | 2026-10-06 开审 | Competition Appeal Tribunal | 未取得 | 请求 >£1bn（≈US$1.33bn） | 审理中 | secondary |
| 23 | 英国 CAT：BIRA 诉 Alphabet/Google | 2026-10-16 | 2026-10-16 立案 | Competition Appeal Tribunal | 1795/7/7/26 | 未披露 | 新立案 | primary（CAT 案件表） |
| 24 | 密歇根 DTE–Google 数据中心供电合同 | 2026-10-01 批准 | 2026-10-30 Nessel 申请复审 | Michigan Public Service Commission | **U-22058** | 未涉罚款；合同 20 年 | 复审申请待决 | secondary |
| 25 | 美国 DOJ 诉 Google（USERRA 军役复职） | 2026-10-29 起诉 | 同 | S.D.N.Y.（US Attorney's Office 民权单元） | 未取得 | 未定（追索欠薪 + 差额赔偿） | 起诉 | secondary（多家），日期存在聚合器错标 |
| 26 | NLRB / Alphabet Workers Union 联合雇主 | 2023–2024 | 2026-04-08/09 命令 Google 谈判 | NLRB | 未取得 | 无 | Google 抗辩中；第九巡回 | secondary |
| 27 | Waymo × NHTSA 儿童碰撞调查 | 2026-01-23 事故 | 2026-08-21 提交文件 | NHTSA ODI（+ NTSB 并行） | 未取得 | 无 | 调查中 | secondary |
| 28 | Waymo 召回（三次） | 2025-12 | 2026-06 | NHTSA | 未取得 | 无罚款 | 已提交召回/OTA | secondary |

---

## 二、印度 India

**1. CCI 关闭 WinZO 诉 Google（真金游戏）案 —— 2026-09-08/09**

事项：WinZO 就 Google Play 对真金游戏（RMG）应用的准入/计费政策向 CCI 投诉 Google 滥用支配地位。CCI 于 2026-09-08（多家 9 日报道）关闭该调查，理由为印度《Online Gaming Act》（禁止在线真金游戏）生效后，涉案行为的事实基础消失；报道措辞为 "no verdict, no remedy" —— 即未作违法认定，也未给救济。首次发生：2023 年 WinZO 投诉（2025-08-01 Fortune India 报道 CCI 复审 Play 政策时 WinZO 仍在主张）。最新进展：2026-09-09。机构：Competition Commission of India。案号：未取得（本地语料与检索均未给出）。金额：无。

状态：已结案（关闭），非和解、非罚款。置信度：secondary（LiveLawBiz 2026-09-08；Business Standard 2026-09-08；Bar and Bench 2026-09-09；Exchange4Media 2026-09-09；CNBC TV18 2026-09-08；Outlook Respawn 2026-09-10；BMI 2026-09-09；Focus Gaming News 2026-09-09；Asia Gaming Brief 2026-09-09 —— 九家独立媒体一致）。

证据：`sources/index_all.tsv`（行 585–599 区段，`gn_india_cci` 源）；`raw/news3/gn3_india` 相关条目；检索输出 `analysis/web/india_winzo.xml`、`analysis/web/bi_winzo.xml`。

**2. 印度最高法院：Play 计费 / "Authorised Provider" 条款 —— 2026-11-03 开庭**

事项：印度 App 开发者（Matrimony.com、Shaadi.com、Naukri、Kuku FM 等）起诉 Google，请求确认 Google Play 支付条款非法、不可执行。核心争点有二：(a) Google 于 **2022-10-03** 修改合同引入的 **"Authorised Provider"** 定义——只有"经 Google 授权"的第三方才能处理 Play 内支付，开发者称此前可自由选用 Razorpay、Paytm 等；(b) 合同 **Clause 15.3** 的支付限制与收费。开发者主张两条均违反《Payment and Settlement Systems Act, 2007》（PSS Act）第 24 条及 RBI 指引；Google（资深律师 Sajan Poovayya）主张这是被包装成合同争议的竞争法问题，CCI 已审查过计费政策并认定费率并非不合理或过高。

程序史：Madras High Court 独任法官驳回起诉；2024-01-19 分庭维持"争点属 Competition Act 与 PSS Act 主管机构管辖"；最高法院受理上诉但未给临时救济。**2026-11-03** 由 **Justices PS Narasimha 与 Alok Aradhe** 开庭，法庭直接询问"开发者能否在合同中退出该支付体系"；**下次开庭 2026-12-01**。

对母单线索的校正：线索称"hearings 3–4 Nov 2026"。实际庭期为 **11 月 3 日**；11 月 4 日的报道（MediaNama、Communications Today）与 11 月 5 日（The 420.in）是对同一庭期的后续报道，未见 11 月 4 日另有一次独立庭期。另有 2026-11-03《The Economic Times》"SC to decide forum for Google billing disputes"、Business Standard 同日、LiveLawBiz 同日报道，均指向同一庭期。

金额：本案未见量化赔偿请求（请求为宣告性与禁令性救济）。置信度：secondary（MediaNama 2026-11-03/04 详讯；ET、Business Standard、LiveLawBiz、The 420.in 交叉印证）。

证据：`https://www.medianama.com/2026/11/223-google-play-billing-case-supreme-court/`；本地 `analysis/web/a_india_sc.html`、`analysis/web/india_sc_nov26.xml`；`sources/index_all.tsv`（`gn_india_cci` 2026-11-03 条目）。

**3. CCI 对 Google Play 计费的两项处罚与 NCLAT 改判**

- CCI 2022-10 认定 Google 通过 Play 计费政策滥用支配地位，罚款 **₹936.44 crore**，并令其允许第三方计费；Google 推出 User Choice Billing（改用替代计费时佣金低 4 个百分点）。
- **2025-03-28/29**：NCLAT 维持违法认定，将罚款降至 **₹216.69 crore**。
- Google 于 **2025-07-24** 向最高法院提起上诉（LawBeat、Business Standard 同日）；**2025-08-08** 最高法院受理该上诉（The Hindu、LawBeat：排期 11 月）。
- 平行事项：2025-08-05 最高法院中止 Testbook 对 Google 计费政策的挑战（MediaNama、ETLegalWorld）。
- 金额性质：**已作出**（CCI），后经上诉审减；是否已缴纳未见披露。

置信度：secondary。证据：`sources/index_all.tsv`、`analysis/web/sc_nclat.xml`；本地 `analysis/web/a_india_sc.html` 亦复述 ₹936.44 crore → ₹216.69 crore 链条。

**4. CCI 接受 Google 的 Android TV 承诺和解 —— 2025-04-22**

CCI 就 Android TV 反竞争行为接受 Google 的承诺/和解，金额 **₹20.24 crore**（约 240 万美元级）。置信度：secondary（Times of India 2025-04-22；SCC Online 2025-04-29；MediaNama 2025-04-22）。性质：**和解金/承诺**，非抗辩后罚款。

**5. CCI 其他 2025–2026 Google 相关处理**

- **2026-03-24/31**：CCI 认定 Google 终止某开发者 Play 商店账号不构成滥用支配地位（LiveLawBiz 2026-03-24；MediaNama 2026-03-31 "CCI rejects abuse of dominance complaint against Google over Play Store ban"）。无罚款。
- **2026-08-19**：Moneycontrol 报道 Google、IndiGo 两案待 CCI 决定，监管方延长承诺（commitment）时间表 —— 即 Google 另有一项进行中的承诺程序（案由未在语料中明确）。
- **2026-05-14**：印度媒体机构转向 CCI，指 Google 与 Meta 主导数字广告生态（BMI）。属新投诉线索，未见立案确认。
- 税费/商标类旁支（不入本表）：Delhi HC "Hindware" 关键词广告裁决与 Google 上诉（2026-06 至 07，MediaNama）。

**6. 印尼（非母单要求，但对"非美国"图景有用）**：KPPU 对 Google Play Billing 的罚款 **Rp 203 billion**，印尼最高法院 **2026-03-13/15** 驳回 Google 最终上诉（Kompas 2026-03-13/16；Jakarta Post 2026-03-15；MLex 2026-03-13）。置信度：secondary。

---

## 三、韩国 Korea

**7. KMCC 对 Google 与 Apple 的应用内支付罚款 —— 2026-10-28（本单核心校正项）**

母单线索为"KRW 63.7 billion on Google and Apple（late Oct 2026, ~US$47.6m combined）：which regulator (KCC/KFTC), which statute"。核实结果：

- **监管机构不是 KFTC，也不是原 KCC**，而是 **Korea Media and Communications Commission（KMCC，방송미디어통신위원회）**——KCC 的继任机构。Korea Herald 明确写 "The commission's predecessor, the Korea Communications Commission, proposed fines totaling 68 billion won in October 2023, but a final ruling was repeatedly postponed amid administrative disruptions and organizational changes." 主席 **Kim Jong-cheol**。
- **法律依据**：经修订的 **Telecommunications Business Act**（2021 年禁止强制应用内支付体系的修法）。报道称这是该 2021 年法律下的**首次执法**（"first enforcement action under Korea's 2021 law banning mandatory in-app payment systems"）。
- **决定日期**：2026-10-28（周三）。KMCC 于同日表决通过。
- **金额**：合计 **KRW 63.71 billion**；其中 **Google KRW 42.9 billion**、**Apple KRW 20.81 billion**。折算：Korea Herald/Yonhap 报 **US$47.6m**（另一篇同社稿件报 **US$45m**），UPI 报 $47.6M，Anadolu 报 $45M —— **折算差异来自汇率口径，原始韩元数字一致**。
- **行为认定**：两家"实质上强制"开发者使用其应用内支付；对使用第三方支付者仍收 **26%** 佣金，叠加开发者自身支付处理与运营成本后使替代方案"商业上不具吸引力"；Google 限制跨支付方式的价格展示；Apple 要求使用第三方计费须另行提交应用；两家均限制应用外支付选项。另认定两家**无正当理由拖延应用审核**（不说明原因、无明确完成时限）。Apple 另因 **2015-07 至 2023-01** 对韩国开发者按含税价、对海外开发者按不含税价计算 30% 佣金而受罚，监管方估算因此多收 **KRW 149.6 billion**；该部分 Apple 因自愿修改政策获减 20%。强制支付部分因两家"明知被调查仍未纠正"而**加罚 20%**。违法程度被定为 "very serious violation"。
- **救济**：罚款 + 纠正令（允许外部支付链接、调整第三方支付费率至合理水平、Google 修改第三方支付 UX 指引、Apple 取消"须单独提交应用"要求、公开披露纠正令、1 个月内提交合规计划、3 个月内落实）；**未移送刑事告发**。
- **后续程序**：书面决定 2026 年 11 月出；KMCC 将审查 Google 2026 年 3 月宣布的外部购买与降费新政（认定"尚未在韩国生效"，故未计入本次罚款）。
- **当事方立场（2026-10-29）**：Apple 称"不同意，相信现行做法符合《电信事业法》，正在评估法律选项"；Google 称监管方未充分认可其合规努力，将在审阅书面决定后决定应对；**两家均未确认提起行政诉讼**。

置信度：secondary（高）。Korea Herald 2026-10-28 17:35 与 17:40 两稿、2026-10-29 10:44 一稿；Reuters 2026-10-28 13:04；UPI 2026-10-29；Euronews 2026-10-28；Anadolu 2026-10-28；Mobile World Live 2026-10-28；Fast Company 2026-10-28；NeoTeo 2026-10-31；Chosunbiz 2026-11-02。

证据：`https://www.koreaherald.com/article/10918101`、`/10918092`、`/10918750`；本地 `analysis/web/kh_10918101.html`、`kh_10918092.html`、`kh_10918750.html`；`raw/news3/gn3_korea.xml`。

**8. KFTC "Project Hug" / 应用商店支配地位案 —— 2026-07-01**

KFTC 于 2026-07-01 就对 Google 在 Android 应用商店的行为（报道口径："Project Hug"，以利益诱导游戏公司放弃竞争性商店/独家上架）启动正式反垄断程序；Reuters 称 KFTC 指控 Google 滥用其地位；Korea JoongAng Daily 报"Google 可能面临最高 **KRW 850 billion** 罚款"（按营业额法上限估算，**非已作出的罚款**）。SBS 报道标题同口径。置信度：secondary（Reuters、KJDA、Telecompaper、PYMNTS、MediaNama）。状态：审理中；与第 7 项是两个不同机关、不同法律的两条线。

证据：`raw/news3/gn3_korea.xml`；`analysis/web/korea_kftc.xml`。

---

## 四、日本 Japan

**9. JFTC 排除措置命令（Search 分销 / Android 协议）—— 2025-04-15/16**

- **原子文件（primary）**：Alphabet 2025 年 10-K："In October 2023, the Japanese Fair Trade Commission (JFTC) opened an investigation into Search distribution practices. In April 2025, the JFTC issued a cease-and-desist order requiring us to make changes to our Android agreements to ensure they are consistent with Japanese antitrust law. **The JFTC did not impose monetary penalties.**"（`txt/10-K_2025-12-31_000165204426000018.txt`；摘录见 `notes/sec_legal_extracts.md` 第 32–34 行）
- 媒体口径：2025-04-15/16，JFTC 首次对 Google 发出排除措置命令（cease-and-desist），要求停止迫使 Android 手机厂商预装 Chrome 等 Google 应用、停止以收入分成换取排除竞争搜索引擎（CNBC 2025-04-15；The Japan Times 2025-04-16；The Independent 2025-04-16）。**此为先例性命令**（"In a first, Japan issues cease-and-desist order against Google"）。
- 金额：**无罚款**（primary）。
- 案号：未取得。

置信度：primary（无罚款与命令事实）+ secondary（行为细节）。

**10. Smartphone Software Competition Promotion Act（MSCA）与 2026 年跟进**

- 法律正式英文名：**Act on Promotion of Competition for Specified Smartphone Software**（母单称 "Smartphone Software Competition Promotion Act"，同一法）。2024 年 6 月立法，属事前规制（ex ante）模式，覆盖 OS、应用商店、应用内支付、浏览器、搜索引擎。
- **2025-03**：JFTC 正式指定 **Apple Inc.、iTunes K.K.、Google LLC** 为适用对象。**2025-12-18** 全面生效。
- 合规动作：Google 引入默认搜索引擎/浏览器选择屏（choice screen），并将替代计费计划扩展至所有面向日本用户销售数字内容的 App；Apple 开放第三方应用市场（抽成低至 5%），第三方支付费率区间 5%–26%。
- **2026-08-26**：八家日本行业组织（含 Mobile Content Forum）发布开发者调查与意见书，称 MSCA 生效 8 个月后**超过九成开发者未使用**新开放的替代商店或支付系统，原因是费用结构使其"经济上不合理"；并指两家公司的部分条款**可能本身违反 MSCA**，正式要求 JFTC 加强执法。报道同时称 JFTC 正准备发布下一轮合规评估。
- **2026-07-23**：The Japan Times 报道 JFTC 将新设部门（bureau）专责 Big Tech —— 执法能力建设信号。
- 2026 年**未见**JFTC 对 Google 作出新的正式处分（罚款或命令）。

置信度：secondary。证据：`https://www.techtimes.com/articles/325680/...`；本地 `analysis/web/d_jp.html`；`raw/news3/gn3_japan.xml`、`analysis/web/japan_mscpa.xml`、`japan_jftc.xml`。

---

## 五、澳大利亚 Australia

**11. ACCC Search 分销调查与 2025 年和解（2025-12 法院批准）**

- **primary**：Alphabet 2025 年 10-K："in June 2022, the Australian Competition and Consumer Commission (ACCC) opened an investigation into Search distribution practices. In August 2025, we agreed to a settlement with the ACCC requiring, among other things, changes to our Android agreements. We recognized a charge in the second quarter of 2025, and **the settlement was approved by the court in December 2025**."（`notes/sec_legal_extracts.md` 第 32 行）
- 金额：**A$55 million** 罚款（约 **US$36 million**）——Reuters 2025-08-18 "Google agrees $36 million fine for anti-competitive deals with Australia telcos"；ICLG 2025-08-18 "Google agrees AUD 55 million fine for anti-competitive conduct"。**金额为 secondary；"和解 + 2025-12 法院批准 + Q2 2025 计提"为 primary。**
- 性质：与 Telstra、Optus 等电信商的默认搜索引擎安排；和解要求修改 Android 协议。已**计提**并已获法院批准。
- 置信度：primary（结构/时点）+ secondary（金额）。

**12. 新闻议价：News Bargaining Incentive（2026）**

2026-04-28 政府公布草案（对未与本地媒体达成协议的大型平台征 2%–2.25%  levy）；2026-08-12 修改；**2026-08-20/21 国会通过**（Reuters 2026-08-20；NPR 2026-08-21；The Straits Times 同日）。适用于 Google、Meta、Microsoft/TikTok 等。Google 于 2026-07-30 在 blog.google 发布回应。置信度：secondary。状态：立法通过，属立法/征税而非对 Google 的处罚。

---

## 六、波兰 Poland

**13. UOKiK 对 Google 四家公司提出滥用支配地位指控 —— 2026-10-05**

- 机构与人物：**Prezes UOKiK（波兰竞争与消费者保护局主席）Tomasz Chróstny**，2026-10-05（周一）宣布。
- 被指控主体（四家）：**Alphabet Inc.、Google LLC、Google Ireland Limited、Google Poland**。
- 事由：在与波兰报刊出版者就"Google 搜索、Google News、Google Discover 使用其出版物应获报酬"的谈判中涉嫌滥用支配地位。法律基础为实施欧盟 **DSM 指令（2019/790）Art. 15** 出版者邻接权的波兰 2024 年《著作权法》修正案。
- 具体指控：(a) Google 在报价时**未向出版者提供可核验费率所需的数据**——包括内容使用方式、相关收入、测算参数，造成信息不对称；(b) **未与多数波兰报刊出版者签订**规范使用与报酬的协议。
- 救济与后果：最高可处**营业额 10%** 的罚款；若双方未达成协议，报酬水平可由 **UKE（电子通信局）主席**确定。UOKiK 明确表示其**不是 Google 与出版者之间争议的一方**，也不评判报酬水平是否适当；各公司责任将在程序中分别分析。
- Google 回应（经 PAP）：称自己是"唯一对出版者采取结构化报酬方式的平台"，已与欧洲 5,500 余家新闻网站（含波兰 70 余家）、波兰 20 余家出版者签约（含 PAP，约占波兰新闻内容 60%），并在 26 个欧盟国家签约。
- 与欧盟程序的关系：UOKiK 称欧委会 2025 年 12 月就"Google 在 AI 服务中使用出版者内容"启动的正式程序属**不同领域**；波兰程序聚焦搜索、Google News、Google Discover。
- 状态：指控已提出（postawienie zarzutów），调查/抗辩阶段；**尚未罚款**。

置信度：secondary（媒体2.pl 2026-10-05 详讯；RMF24 2026-10-05；Gazeta Prawna 2026-10-05；Money.pl 2026-10-05；Bankier 2026-10-11；Reuters 2025-10-05 稿 "Polish regulator suspects Google abused dominant position in publisher payment talks"）。证据：`analysis/web/b_uokik.html`、`b_uokik2.html`、`poland_uokik.xml`、`pl_uokik.xml`。

---

## 七、土耳其 Türkiye

**14. Rekabet Kurumu 对 Google AI 搜索功能立案 —— 2026-11-02**

- 机构：**Rekabet Kurumu（RK，土耳其竞争管理局）**。
- 程序依据：**Law No. 4054 第 41 条**之调查程序，审查是否违反**第 6 条**（滥用支配地位）。
- 对象行为：Google Search 内的 **"AI Overviews"** 与 **"AI Mode"** 两项生成式功能。
- 审查问题（据 RK 声明）：AI 概览/AI 模式是否改变用户获取信息行为并损害新闻出版者与其他内容生产者的流量、可见度与收入；Google 与新闻出版者关于内容使用的协议条件是否具**不公平合同性质**；两项功能是否对出版者、其他内容生产者及 AI 聊天助手产生**排他效果**；在将出版者内容选为 AI 概览/模式来源或内容许可方面是否存在**差别待遇**。
- 时间线：**预调查决定 2026-08-27**；**2026-10-08 会议决定采取临时措施（interim measures）**；**2026-11-02** 公告正式立案。临时措施目的：防止对新闻出版者的歧视，使条款反映内容使用的经济价值，并允许出版者在不影响其在其他 Google 服务中可见度与索引的前提下自主决定内容使用。
- 金额：尚无。状态：调查中 + 临时措施生效。

置信度：secondary（Daily Sabah 2026-11-02 引述 RK 声明原文级细节；PYMNTS 2026-11-02；Global Competition Review "AI Mode: The Briefing for 2 November 2026"；Haberler 2026-11-02）。证据：`https://www.dailysabah.com/business/tech/turkish-competition-body-probes-google-over-ai-features-in-search`；本地 `analysis/web/a_turkey.html`、`turkey.xml`、`bi_turkey.xml`。

**15. 更早的土耳其罚款（背景，均为 secondary）**

2020-11 罚款 US$25.6m（Hürriyet Daily News）；2024-05 因不遵守整改要求被罚（Reuters）；2025-06-20 就 Google **PMAX** 广告产品启动调查（Reuters）；**2025-07-10 罚款 US$8.9m**（Reuters）。金额均以当时报道为准，未逐项核对官方决定。

---

## 八、加拿大 Canada

**16. Competition Bureau 广告技术滥用支配地位案**

- 2024-11：Competition Bureau 向 **Competition Tribunal** 提起申请，指 Google 在网络广告领域滥用支配地位（CBS 2024-11-28；CBC 2024-12-02）。
- **2026-03-05**：Competition Tribunal **驳回 Google 的宪法性抗辩**，为实体审理扫清道路（The Globe and Mail 2026-03-05 "Tribunal rejects Google's constitutional challenge in online advertising case"；CTV/CityNews 同日；Media in Canada 同日；ICLG 2026-03-06 "Google fails to halt Canada abuse-of-dominance case"）。
- **2026-06-20**：Canadian Lawyer 报道 Competition Bureau 进一步扩大对 Google 广告行为的调查。
- 金额：未定。状态：审理推进中。置信度：secondary。

**17. Online News Act（C-18）与新闻议价**

- 2024 年起 Google 通过年度支付取得豁免；2026 年 1 月 CBC/Global 报道渥太华与 Meta 就恢复新闻谈判；2026 年出现要求**废除** C-18 的公开主张（Policy Options 2026-02-02）；2026-07-29 CBC 报道政府计划终止 "Netflix tax" 并以公共资金替代。
- 2025–2026 年**未发现**针对 Google 的新的 C-18 处罚或仲裁程序。置信度：secondary（背景性）。这一项在本单中应视为**立法/政策变动**，不是执法动作。

---

## 九、巴西 Brazil

**18. CADE 对 Google 使用新闻内容立案 —— 2026-04-23/24**

- 机构：**CADE**（Conselho Administrativo de Defesa Econômica）。
- 时点：**2026-04-23/24**，CADE 批准将针对 Google 使用新闻内容的审查"深化"为行政程序（Reuters 2026-04-24 "Brazil regulator approves deeper probe into Google's news content use"；Tech Policy Press 2026-04-24；The News International 同日；The Canberra Times 同日）。巴西全国报纸协会（ANJ）称该决定"具历史意义"（2026-04-23）。RSF 2026-05-04 称其为"针对 Google 的前所未有程序，为巴西新闻业获得公平报酬开辟道路"。
- 事由：Google 在搜索/AI 产品中使用新闻内容与出版者报酬（与澳、波、土同一条监管脉络）。
- 金额：未定（可罚款，未作出）。状态：行政程序进行中。置信度：secondary。
- 旁注（非 Google）：2026-06-18 Apple 与 CADE 和解后开放 iOS 第三方商店；2026-11-04 巴西对 Meta 的 AI 抓取设 R$1m/日罚款威胁。

---

## 十、意大利 / 西班牙 / 荷兰 / 俄罗斯

**19. 意大利（AGCM）、西班牙（CNMC）、荷兰（ACM）：2025–2026 未发现针对 Google 的实质执法动作**

- 检索覆盖本地语料（`sources/index_all.tsv` 全表关键词命中 0 条 AGCM/CNMC/ACM+Google）与 Google News/Bing News 定向检索（2025-01 至 2026-11）。
- 唯一相关线索：2025-02-25 Eunews 报道"Google 对 Enel 的支配地位滥用——本应确保应用互操作性"，指向 AGCM 的互操作性争议，但**未能核实是否形成决定或罚款**，标记 **unverified（单一来源）**。
- 西班牙：CNMC 2025–2026 的主要数字案件为 Apple/Amazon（€194m，2023）与 Booking.com（€413m，2024），**无 Google 新案**。
- 荷兰：ACM 2025–2026 的公开动作集中于 Roblox、Ticketveiling 等，**无 Google 新案**。
- 结论表述建议：**"在该三辖区未发现 2025–2026 年针对 Google 的新处罚或新立案"**，而不是"不存在"。置信度：基于检索的否定性结论（medium）。

**20. 俄罗斯：复合式民事罚金（compounding penalties）**

- **primary**：Alphabet 10-K（2025-12-31）与 10-Q（2026-09-30）措辞一致："We have ongoing legal matters relating to Russia. For example, some matters concern civil judgments that include compounding penalties imposed upon us in connection with disputes regarding the termination of accounts, including those of sanctioned parties. We do not expect these ongoing legal matters will have a material adverse effect."（`notes/sec_legal_extracts.md` 第 80、366 行）
- 2026 年事实性进展（secondary）：
  - 2026-02-19：俄法院再处"天文数字"罚金（TVP World："million times global GDP"；UNITED24："$1.2 quintillion"——数值荒谬，属累积罚金机制的算术结果）；2026-02-27 Anadolu："Russia fines Google $206M for unpaid penalties"。
  - **2026-10-29：Google 俄罗斯子公司支付约 US$207.7m** 以覆盖对母公司的罚金（Anadolu 2026-10-29；Yeni Şafak 同日）。这是本单中少见的确证"**已支付**"的非美国金额。
- 另：2026-03-10 The Moscow Times 报道俄反垄断局（FAS）确认对 Telegram、Meta 平台与 YouTube 的广告禁令 —— 属俄方广告管制，非针对 Google 的独立处罚。
- 置信度：primary（披露）+ secondary（2026 年金额与支付）。

---

## 十一、隐私与消费者保护：EU / EEA —— €403 million（本单最重要的核验项）

**21. 爱尔兰 DPC 对 Google Ireland Limited 罚款 €403,000,000 —— 2026-09-21（primary，已核实为真）**

母单线索："a reported €403 million fine over location-data privacy violations（reported ~21 Sept 2026 by Fortune）—— which authority, which decision, real or misreported?" 核实结论：**真实，但媒体归属普遍写错。这不是"欧盟委员会"或"EU"的罚款，而是爱尔兰数据保护委员会（DPC）作为 Google 的 lead supervisory authority 依 GDPR 一站式机制作出的决定。**

官方原文要点（`https://www.dataprotection.ie/en/news-media/latest-news/data-protection-commission-fines-google-eu403-million-following-inquiry-googles-processing-location`）：

- 决定日期：**2026 年 9 月 21 日**。机构：**Data Protection Commission (DPC)**，对 **Google Ireland Limited**。
- 程序性质：**own-volition inquiry**，DPC 以 Google 的 **Lead Supervisory Authority** 身份于 **2020 年 2 月**启动，起因是收到包括 **BEUC** 在内的多家欧洲消费者组织投诉。
- 审查范围：三项功能中的位置数据处理——**"Web & App Activity"、"Location History"、"Location Accuracy"**；期间为 **GDPR 适用日（2018-05-25）至 2020-02-04**。
- 认定（决定由三位 Commissioner **Dr Des Hogan、Mr Dale Sunderland、Ms Niamh Sweeney** 作出）：(a) Web & App Activity 与 Location History 中位置数据处理的**合法性（lawfulness）与公平性（fairness）**；(b) 就 Location Accuracy 的处理，违反**问责（accountability）**义务——无法证明其符合合法性、公平性与透明性原则；(c) 三项功能的**透明度**义务；(d) Web & App Activity 与 Location History 中位置数据的**保留（retention）**。
- 制裁：**行政罚款合计 €403 million**；并命令 Google 在 **6 个月内**使处理合规。
- 公布状态：**完整决定将另行发布（"will issue the full decision in due course"）**——截至目前**决定编号与全文未公开**。
- 官方引述：Deputy Commissioner **Graham Doyle** 强调位置数据可推断高度私密信息，用户可能不知其位置被用于"影响其广告或推断其兴趣"，且超期保留加剧了控制权丧失。

媒体侧数字差异：AP、WSJ、Quartz 报 **US$463 million**（按当时汇率折算）；Reuters、The Guardian、BBC、The Irish Times、RTE、POLITICO Europe、IAPP、BleepingComputer 均报 **€403 million**。多家媒体（Le Monde、NDTV、India Today、Channels TV、Kuwait Times 等）标题写作"EU fines Google"，属**归属错误**；PPC Land 2026-10-09 的标题"Ireland's DPC fines Google 2,951 days after demanding an urgent answer"给出从投诉到决定的时长（约 8 年）。

另需注意：这**不是**《Fortune》首发或有独家内容；Fortune 的报道与其他数十家同日（2026-09-21）发布，标题一致。

置信度：**primary**。证据：官方页 + 本地 `analysis/web/dpc_google_403.html`、`dpc_press.html`；语料内 `raw/gn_eu_fine.xml`、`raw/news3/gn3_korea.xml`（Fortune/Le Monde 条目）；检索输出 `analysis/web/pr_403.xml`、`pr_dpc.xml`。

---

## 十二、隐私与消费者保护：美国

（说明：以下不含 DOJ/州反垄断主案；均为隐私或消费者保护性质。）

**22. Texas 主导的 $1.4bn 和解 —— 2025-05-09 宣布，2025-10 完成**

- **primary**：Alphabet 10-K（2025-12-31）："In October 2025, we finalized a **$1.4 billion** settlement of certain privacy matters."（`notes/sec_legal_extracts.md` 第 62 行）
- 事实链：2025-05-09 Texas AG Ken Paxton 宣布 Google 将支付 **$1.4bn** 了结两起隐私诉讼（CNBC、NYT、AP、Bloomberg Law、Texas Tribune 同日）；实际金额多次报为 **$1.375bn**（Texas Scorecard 2025-05-12；The Business Journals 2025-10-31）；2025-10-24 Reuters 报 Google 另向德州外部律师支付 **$190 million** 律师费；2025-11-03 Broadband Breakfast "Texas Finalizes $1.3B Privacy Settlement With Google"。
- 覆盖内容：位置数据追踪与生物识别（据标题口径）。
- 状态：**已完成（finalized）**，属已支付/已计提。置信度：primary（完成事实与 $1.4bn 口径）+ secondary（分项金额与律师费）。

**23. Google Assistant 隐私和解 $68m —— 终审批准 2026-10-13**

- 2026-01-26 宣布和解（Reuters、BBC、CBS 同日）；2026-03-23 初步批准（Daily Journal）；**2026-10-13 终审批准**（Courthouse News；MLex 同日；PPC Land 2026-10-19）。
- 事由：Google Assistant 被指在用户不知情下录制私人对话。金额 **$68 million**。状态：**终审批准**（与母单"~13 Oct 2026"一致）。置信度：secondary。
- 注意：openclassactions 于 2026-04/05 曾误报"已获终审批准"，应以 2026-10-13 为准。

**24. 儿童隐私（Play Store 应用）和解 $8.25m —— 终审批准 2026-10-22/23（对母单"27 Oct"的校正）**

- 2026-01 宣布（The Record 2026-01-15；Malwarebytes 2026-01-20；Top Class Actions 2026-01-21）；**2026-10-22/23 获终审批准**（MLex：`Fri, 23 Oct 2026 23:02:02 GMT` "Google wins final approval of $8.25 million class-action child privacy settlement"）；MediaPost 于 **2026-10-28** 以"Gains Approval 10/29/2026"为题报道；openclassactions 2026-10-24 汇总亦收录。母单记"approved ~27 Oct 2026"，**实际批准日更可能是 10 月 22–23 日**，10 月 27–29 日为报道扩散。金额 **$8.25 million**。置信度：secondary。

**25. Android 数据传输和解 $135m —— 终审批准 2026-08**

- 2026-01-28 宣布（Reuters）；2026-03-06 Courthouse News 报道接近终审；**2026-08-24 Courthouse News "Google settles class action over data transfers for $135 million"**。金额 **$135 million**，涉约 1 亿 Android 用户（The Independent 2026-04-13）。置信度：secondary。

**26. Web & App Activity 陪审团裁决 $425.7m —— 2025-09-03（非和解）**

- 2025-09-03 加州联邦陪审团裁决 Google 赔偿 **$425.7 million**，涉约 **9,800 万人**；Bloomberg Law 称"隐私审判"（2025-09-04），Reuters 2025-09-03 "Google must pay $425 million in class action over privacy, jury rules"；BBC、Axios、CBS（$425.7m）同日。
- 2026-08-27 Courthouse News：法官对律师费请求表示支持（"Judge signals support of attorney fees request in $425 million Google privacy suit"）。
- 性质：**裁决（verdict）**，非和解；可能在上诉中变动。置信度：secondary。

**27. YouTube 儿童隐私和解 $30m —— 终审批准 2026-01-13**

2025-08-19 Reuters 报道和解；**2026-01-13 Courthouse News "Judge approves $30 million settlement in YouTube child privacy case"**。置信度：secondary。

**28. Incognito 模式追踪和解（$5bn 口径）—— 状态未能确认**

- 2023-12-29 各方报道 Google 就"Incognito 模式仍追踪用户"的集体诉讼达成和解（$5bn 口径）；2024-04-01 报道 Google 同意删除数十亿条浏览记录并调整披露。
- **本次检索未能确认终审批准的具体日期与卷宗状态**（本地语料仅有 2023-12 至 2024-04 的报道，无 2025–2026 年批准记录；定向检索亦未命中）。母单如需要"status"，只能写：**已达成和解并进入记录删除/合规实施阶段，终审批准日期未核实**。标记 **unverified**。

**29. 2026 年州检察长动作（针对 Google）**

未检索到 2026 年针对 Google 的**新**州 AG 隐私诉讼或和解。2026 年该领域的大额案件集中在 Meta（New Mexico $25bn，2026-10-21；DC $17.1bn，2026-08-26）与 Amazon（DC $8.25m，2026-10-01）。有历史基线可引用：2022-11 全美 40 州 $391.5m 位置追踪和解（NCDOJ 官方页）。

---

## 十三、英国：Competition Appeal Tribunal（私人集体诉讼，非 CMA 事项）

**30. 开发者集体诉讼和解 £260 million —— 批准 2026-09-15/16，公布 2026-10-09**

- 请求权人/类别代表：**Professor Barry Rodger**（竞争法学者），代表**在英国通过 Google Play 销售应用的开发者**（class：2018-08 至 2026-07 期间在 Play Store 上架应用的英国企业）。
- 指控：Google 滥用支配地位——阻止开发者经其他渠道分发，并收取不公平佣金（通常 30%）；原请求金额**略高于 £1 billion**。
- 和解：**£260 million**（约 **US$353–354 million**），2026-08-27 公布；Google **不承认任何责任或不当行为**（19 页协议载明 Google "believes it has strong defences"）。
- 结构：**£160m** 赔给开发者；**£100m** 用于诉讼与资助成本（即 38% 用于案件本身）。分配方案与申领人数仍待 CAT 批准。
- 程序：CAT 于 **2026-09-15/16** 听证并批准；**2026-10-09 公布批准**（MLex "Approval for £260m Google mass claim settlement published by UK antitrust court"）。报道称这是英国集体诉讼机制下迄今最大和解。
- 置信度：secondary（The Next Web 详讯；Courthouse News 2026-09-15；GCR 2026-09-16；Pocket Gamer.biz 2026-09-16；Law360 2026-09-15；MLex 2026-10-09；Bloomberg 2026-08-28；Reuters 2026-08-27）。

**31. 消费者集体诉讼（Coll）—— 2026-10-06 开审，>£1bn**

- 类别代表：消费者倡导者 **Liz Coll**；代表约 **2,000 万**在 **2015 至 2026 年 7 月**间通过 Google Play 购买应用、应用内购买或订阅的英国消费者。
- 金额：**超过 £1 billion（US$1.33 billion）** —— 属**请求金额**，非判决金额。
- 状态：**2026-10-06 在 CAT 开庭**；Google 抗辩称 Play Store 面临来自 Apple App Store 与其他平台的强竞争约束，收费"属市场最低之列"。Epic 的伦敦诉讼原定与其合并审理，因 2026-03 Google 与 Epic 达成全球和解而未合并。
- 置信度：secondary（Reuters 2026-10-06，经 Yahoo Finance 镜像取得全文）。

**32. BIRA Trading Ltd v Alphabet / Google（CAT 1795/7/7/26）—— 2026-10-16 立案**

- CAT 案件表显示：**1795/7/7/26，BIRA Trading Limited v Alphabet Inc., Google LLC, Google Ireland Limited & Google UK Limited，立案日 2026-10-16**。
- 案由（集体诉讼性质）在案件表层面未披露；BIRA 为英国独立零售商协会，从命名与同期案件群（Visa/Mastercard 交换费类）推断可能为支付/佣金类集体诉讼 —— **此推断不作结论**。金额未披露。
- 置信度：**primary**（CAT 官网案件表）。证据：`https://www.catribunal.org.uk/cases`；本地 `analysis/web/b_cat_cases.html`。

---

## 十四、能源 / 数据中心：有监管机关或法院介入的事项

**33. 密歇根 MPSC 案 U-22058：DTE–Google「Project Cannoli」供电合同**

- 2026-10-01（周四）：**Michigan Public Service Commission（MPSC）** 一致批准 DTE Energy 与 Google 的 **20 年期**供电合同，对应 Wayne County **Van Buren Township**（I-94 与 Haggerty Road 附近）约 **1 GW** 数据中心（"Project Cannoli"）。
- 合同要点：Google 须按合同容量的 **至少 80%** 付费（无论实际用电量）；DTE 为该项目新建 **1,600 MW 可再生能源 + 480 MW 电池储能**；并为 2033 年前服务该中心建模一座 **727 MW 带碳捕集的天然气机组**；Google 提前退出须支付覆盖至少 15 年最低费用的款项，由 **Alphabet 担保**支持（评级下调时转为信用证）；委员会裁定若担保不足，由 DTE 而非用户承担。
- **2026-10-30（周五）**：州检察长 **Dana Nessel** 提交**复审申请（petition for rehearing）**，要求 MPSC 要么强化用户保护、要么撤销合同。其主张：最低计费需求应为 **90%**（而非 80%）；提前终止付款应按 **100%** 最低计费需求计算剩余月份；DTE 的财务分析**未计入输电成本**；应取消 Google 提前退出时提供的**担保上限**；并应持续跟踪成本与收益。DTE 主张 20 年期内对其他用户有 **$1.7 billion** 净收益；委员会主席 **Dan Scripps** 称保护条款可确保其他用户不被补贴。
- 关联案件：Saline Township（Oracle/OpenAI）合同于 2025-12 获批且未走争议听证，Nessel 的复审请求被拒，现已上诉至 **Michigan Court of Appeals**（2026-08-10 提交初审论点）。
- 性质：这是密歇根州**首个走完整争议案件程序（contested case）**的超大规模数据中心供电合同，故 Nessel 具有正式当事人资格。
- 置信度：secondary（Hoodline 2026-10-31 详讯引 WLNS/Planet Detroit；ClickOnDetroit 2026-10-02；Detroit News 2026-10-01；Michigan Advance 系列）。案号 **U-22058** 为单一来源（Hoodline 引 WLNS），标记 **secondary-low**。

**34. 明尼苏达 Hermantown：市议会批准（地方土地使用，非公用事业委员会）**

- 2026-10-05：Hermantown 市议会通过 AUAR 审查；2026-10-20 规划委员会建议批准许可；**2026-10-27 与 10-28 两次因抗议推迟表决**；**2026-10-30/31 市议会以 5–0 一致批准**（MPR News 2026-10-31；Star Tribune 2026-10-31；kare11 2026-10-31；fox21 "55 opposed, 5 in favor" 2026-11-02）。
- 2026-10-15：Google 决定不就该项目申请税收减免（tax abatement），引发对其他州内数据中心的影响讨论（KTTC）。
- 并行：Pine Island 的拟建 Google 数据中心于 2026-10-29 进入新的环境审查（MPR News）。
- 性质：**市议会/规划许可 + 环境审查**，尚无州公用事业委员会或法院裁决。若母单需要"regulator/court actually involved"，此处只有地方政府；2026-11-03 MPR 报道称有"pending lawsuits"的提法（MinneapoliMedia 2026-11-01），但**未核实具体诉讼** → 该点标记 unverified。
- 置信度：secondary。

---

## 十五、劳工 / 就业

**35. 美国 DOJ 诉 Google（USERRA）—— 2026-10-29 起诉**

- 原告：**United States**（由纽约南区联邦检察官办公室民权单元提起，DOJ 民权司支持；报道引 AAG **Harmeet Dhillon**、US Attorney **Jamie McDonald**）。
- 被告：Google。
- 事实主张：**Mark Davisson**（美国陆军预备役军人，2020 年起任 Google key account executive 约两年半，负责 BlackRock、Bridgewater、原 Credit Suisse 美国业务等云服务客户）。2023 年 5 月服兵役归来后，Google 拒绝让其接触任何客户账户，但保留原薪资与职级；2024 年 1 月改派至云解决方案岗位，仍不涉及客户账户管理；其后在又一次兵役假与公司裁员中于 2024 年被解雇（据 NY Post 转述）。
- 法律依据：**Uniformed Services Employment and Reemployment Rights Act of 1994（USERRA）**"escalator principle"（复职应至若无服役则应处的职位，保留资历）。
- 请求：追索欠薪与福利、额外损害赔偿，并要求法院命令 Google 维持非歧视工作环境、改进 USERRA 培训。
- 日期问题：部分聚合稿（Hoodline）指出 DOJ 新闻稿片段标注 "June 29, 2023"，与主流报道的 **2026-10-29（周四）** 不一致；MarketScreener 2026-10-29、India Today 2026-10-29、HCAMag 2026-10-30 均取 10 月 29 日。**采 2026-10-29，标注一处日期矛盾**。
- 性质：**起诉（complaint filed）**，非裁决。置信度：secondary（多家；DOJ 原始新闻稿未取得）。

**36. NLRB / Alphabet Workers Union（联合雇主）**

- **2026-04-08/09**：NLRB 作出裁决/命令，要求 Google 作为**联合雇主**与 **Alphabet Workers Union** 谈判（NLRB Edge 2026-04-09 "Google Ordered to Bargain with Alphabet Workers Union as Joint Employer"；Bloomberg Law 2026-04-08 "Google Can Challenge Joint Employer Status After NLRB Ruling"）。
- **2026-04-23**：Bloomberg Law 报道 Google 就该联合雇主裁决向**第九巡回上诉法院**提出挑战。
- 历史：2025-04 D.C. Circuit 因 Google–Cognizant 合同终止而**撤销**了此前的联合雇主谈判令（Labor Relations Update 2025-04-28；Bloomberg Law 2025-04-22）。
- 性质：行政裁决 + 司法审查。置信度：secondary。

**37. 英国工会准入（2026-11）**

- 2026-11-02：报道称在英国就业权改革后，工会获得接触数千名 Google 员工的权利（"Unions gain access to thousands of Google workers after UK employment rights overhaul"）。
- 2026-11-04：Google UK 的 **Prospect** 工会覆盖达 7,000 名员工，另有两家工会提出异议（FourWeekMBA）。
- 性质：劳资关系/承认程序，非诉讼。置信度：unverified（各为单一来源）。

---

## 十六、Waymo

**38. NHTSA ODI 调查：2026-01-23 Santa Monica 儿童碰撞**

- 事故：2026-01-23，Santa Monica 一所小学附近，Waymo Jaguar I-Pace 以 **17 mph** 行驶，制动降至 **6 mph** 后以**右前灯组附近**撞击一名 **9 岁女童**；女童摔倒后自行走到路边，轻伤，无需送医（NTSB 2026-03 初步报告）。
- 监管：**NHTSA 缺陷调查办公室（ODI）** 于事故后一周宣布调查；**2026-03-23** 向 Waymo 发出 **12 组问题**（含子问题），涉校区限速判定方式、相关投诉、软件文档等；原定 2026-05-08 答复，Waymo 于 2026-05-01 申请延期并请求澄清；NHTSA 批准其中 10 组延期；**2026-08-21 相关答复文件公开（全部以 CBI 为由涂黑）**，Waymo 称已提交完毕。
- 并行：**NTSB** 独立调查（通常在 12 个月后发布最终报告）。
- 置信度：secondary（TechCrunch 2026-08-21 详讯；KQED、LA Times、Al Jazeera、CNBC 2026-01-29/30）。

**39. 召回（recalls）与调查扩展**

- 2025-12：因在校车停车标志前违规通过，Waymo 召回 **3,000 余辆**；NHTSA 于 2025-12-08 扩大调查（CBS、NPR、TechCrunch 2025-12-05/11）。
- 2026-05-12：因驶入积水道路风险，召回约 **3,800 辆**（Reuters 2026-05-12）。
- 2026-06-18：因驶入封闭高速施工区风险，召回近 **3,900 辆**（Reuters 2026-06-18；TechCrunch 同日）。
- 2026-10-14：报道称 NHTSA 就校车安全开启新一轮调查（Startup Fortune）—— **单一来源，标记 unverified**。
- 性质：**召回/OTA 软件更新**（无罚款记录）。置信度：secondary（10 月一项除外）。

---

## 十七、其他非美国辖区（补充，母单未列但属同一图景）

**40. 南非**：竞争委员会（Competition Commission）媒体与数字平台市场调查后，**2025-11 Google 同意向南非媒体机构支付 R688 million（约 US$40.2m）** 并调整内容可见度做法（Moneyweb 2025-11-13；TheCable 2025-11-14；News24 2025-11-17 讨论最终报告）。置信度：secondary。性质：**和解/承诺**。

**41. 尼日利亚**：2026-07-06/07，总统 Tinubu 下令就 Meta、Alphabet/Google、X 对尼日利亚新闻内容的"剥削"展开调查（FCCPC 介入）（Business Insider Africa 2026-07-06；Punch 2026-07-07；The Nation 2026-07-06）。置信度：secondary。状态：调查启动。

**42. 印尼**：见第 6 项（KPPU Rp 203 bn，最高法院 2026-03 终局）。

---

## 十八、未核实或被证伪的线索（供母单直接引用）

1. **"€403 million fine by the EU"** —— 归属错误。作出机关是**爱尔兰 DPC**（GDPR 一站式机制下的 lead supervisory authority），2026-09-21。金额、日期、事由均属实。多家媒体标题写 "EU fines Google"，不可照抄。**未被证伪，但被纠正。**
2. **韩国"KCC/KFTC"二选一** —— 两者都不是。作出机关是 **KMCC（Korea Media and Communications Commission）**，KCC 的继任机构；法律是修订后的 **Telecommunications Business Act**，不是《公平交易法》。KFTC 另有一条 2026-07-01 的独立程序（Project Hug）。
3. **韩国金额** —— 韩元 **63.71 bn** 一致；美元折算在 **$45m 与 $47.6m** 之间摇摆（汇率口径），引用时须成对给出。Google/Apple 分项为 **42.9 bn / 20.81 bn**，母单只给合计数属信息不足。
4. **印度"hearings 3–4 Nov"** —— 仅 **11 月 3 日** 有庭期，下次 **12 月 1 日**；11 月 4–5 日为报道。案号未取得。
5. **英国"£260 million mass-claim settlement approved/published by CAT (~9 Oct 2026)"** —— 拆分：(a) 这是**开发者**集体诉讼（class representative **Prof. Barry Rodger**），不是消费者集体诉讼；(b) **批准在 2026-09-15/16**，**公布在 2026-10-09**；(c) 与之并行的**消费者**集体诉讼（**Liz Coll**，>£1bn，约 2,000 万人）**仍在审理**，2026-10-06 开审。若母单把两者混为一案会出错。
6. **"$8.25 million children's-privacy settlement approved ~27 Oct 2026"** —— 终审批准更像 **10 月 22–23 日**（MLex 2026-10-23），10 月 27–29 日为报道扩散。金额无误。
7. **Incognito 和解状态** —— 只能确认 2023-12 和解与 2024-04 记录删除承诺；**终审批准与分配状态未能核实**（unverified）。不要写成"已获终审批准"。
8. **意大利 / 西班牙 / 荷兰** —— 未发现 2025–2026 年针对 Google 的新处罚或新立案。仅有一条 2025-02 Eunews 关于 AGCM/Enel 互操作性的**单一来源**线索，未能核实是否形成决定（unverified）。否定性结论应表述为"未发现"。
9. **澳大利亚 A$55m** —— SEC 10-K 只确认"2025-08 和解 + 2025-12 法院批准 + 2025 Q2 计提"，**未披露金额**；A$55m/US$36m 来自 Reuters 与 ICLG。若母单要求"primary for numbers"，此项须降级为 secondary。
10. **日本 2026 年"跟进"** —— 只有 2026-08-26 行业组织调查与致 JFTC 的执法请求、以及 JFTC 计划中的下一轮合规评估。**2026 年没有新的 JFTC 正式处分**。母单不应写成"JFTC 2026 年再次处罚"。
11. **DOJ USERRA 案的日期** —— 一处聚合稿称 DOJ 文稿标注 2023-06-29，与 2026-10-29 的媒体报道冲突；采 2026-10-29。
12. **Waymo "2026-10 NHTSA 新校车调查"** —— 单一来源（Startup Fortune），unverified。
13. **密歇根 U-22058 案号** —— 单一来源（Hoodline 引 WLNS），MPSC 官网未直接核验。
14. **明尼苏达 "pending lawsuits"** —— 单一来源提法，未核实具体诉讼。

---

## 十九、本地证据索引

| 本地路径 | 内容 | 用途 |
|---|---|---|
| `sources/index_all.tsv` | 4,704 条新闻索引（含 745 条法律子集） | 全辖区线索溯源；韩国 28–29 Oct、波兰 5–6 Oct、印度 CCI 全序列 |
| `raw/news3/gn3_korea.xml` | 韩国 RSS 原始条目（含 Reuters/Korea Herald/UPI 标题与链接） | 第 7、8 项；€403m 的 Fortune 条目亦混入此文件 |
| `raw/news3/gn3_japan.xml`、`gn3_india.xml`、`gn3_canada.xml`、`gn3_brazil.xml`、`gn3_australia.xml`、`gn3_waymo.xml`、`gn3_labor.xml` | 各辖区 RSS 原始条目 | 第 1–2、9–13、16、35–39 项 |
| `raw/gn_eu_fine.xml` | Le Monde "Ireland fines Google €403 million" 条目 | 第 21 项的语料侧证据 |
| `notes/sec_legal_extracts.md` | 10-K/10-Q 法律段落摘录（按申报期对比） | ACCC、JFTC、Texas $1.4bn、Russia 的 primary 依据 |
| `txt/10-K_2025-12-31_000165204426000018.txt` | Alphabet 2025 年报全文 | 同上（第 32、34、62、80 行对应处） |
| `txt/10-Q_2026-09-30_000165204426000084.txt` | 2026 Q3 季报 | Android €4.1bn 于 2026-07 现金支付 $5.2bn；DMA 计提 $1.0bn；PriceRunner $2.1bn 已计提（属欧盟私诉，非本单） |
| `analysis/web/dpc_google_403.html` | 爱尔兰 DPC 官方新闻稿原文 | 第 21 项 primary |
| `analysis/web/kh_10918101.html`、`kh_10918092.html`、`kh_10918750.html` | Korea Herald 三篇全文 | 第 7 项 |
| `analysis/web/a_turkey.html` | Daily Sabah 全文（引 RK 声明） | 第 14 项 |
| `analysis/web/a_india_sc.html` | MediaNama 全文 | 第 2 项 |
| `analysis/web/b_uokik.html`、`b_uokik2.html` | media2.pl、RMF24 全文 | 第 10 项（波兰） |
| `analysis/web/a_userra.html` | Hoodline 全文（含日期矛盾说明） | 第 35 项 |
| `analysis/web/a_nessel.html`、`a_dte.html` | 密歇根复审申请与 10-01 批准 | 第 33 项 |
| `analysis/web/c_reuters_cat.html` | Reuters 2026-10-06（Coll 案开审 + £260m 提及） | 第 30–31 项 |
| `analysis/web/c_tnw.html` | The Next Web £260m 结构拆解 | 第 30 项 |
| `analysis/web/b_cat_cases.html` | CAT 官方案件表（含 1795/7/7/26） | 第 32 项 primary |
| `analysis/web/d_jp.html` | Tech Times 日本 MSCA 调查报道 | 第 10 项 |
| `analysis/web/c_waymo.html` | TechCrunch NHTSA 调查文件报道 | 第 38 项 |
| `analysis/web/pr_403.xml`、`pr_dpc.xml`、`pr_tx14.xml`、`pr_68.xml`、`pr_825.xml`、`uk_cat260.xml`、`userra.xml`、`mi_dte.xml`、`mn_hermantown.xml`、`waymo_nhtsa.xml`、`ru2.xml`、`za.xml`、`id_kppu.xml`、`ca2026.xml`、`brazil_cade.xml` | Google News RSS 检索输出（保留标题+日期+发布者） | 各条目交叉印证的检索快照 |

---

## 二十、给母单的三条口径建议

第一，凡引用"欧盟/欧盟委员会罚款"时，本单涉及的唯一大额隐私罚单（€403m）实为**爱尔兰 DPC** 依 GDPR 一站式机制作出，写在欧盟委员会名下会被专业读者立刻识别为错误；而真正的欧委会罚款（Android €4.1bn、AdTech €3.0bn（SEC 口径；BBC 等媒体作 €2.95bn）、DMA €890m = €430m Play + €460m Search）属母单 EU 章节。

第二，本单中"已支付"的确证只有两处：Alphabet 2026-07 就 Android 罚款现金支付 **$5.2bn**（含利息，SEC 10-Q），以及 **2026-10-29 俄罗斯子公司支付约 $207.7m**。其余非美国金额均为**已作出但缴纳状态未披露**（韩国 63.71 bn 韩元、印度 ₹216.69 crore、爱尔兰 €403m、英国 £260m 待分配、南非 R688m）。

第三，非美国监管在 2026 年出现明显的"**出版者报酬 + AI 摘要**"合流：波兰（UOKiK，2026-10-05）、土耳其（RK，2026-11-02，含临时措施）、巴西（CADE，2026-04）、加拿大（竞争局 2024 起的广告案）、南非（2025-11 和解）、澳大利亚（2026-08 立法）分别从竞争法、邻接权与立法三个入口处理同一组事实。若母单需要叙事线，这是本单最值得上升的趋势判断，且每一环都有独立的一手或两家以上二手来源。