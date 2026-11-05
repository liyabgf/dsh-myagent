#!/usr/bin/env python3
"""Emit analysis/legal-exposure-register.csv from the exposure classification in
analysis/05_监管与法律风险自述与敞口量化.md.

Columns: status_group, amount_original, currency, matter, forum, date,
         payment_state, source_type, source, confidence
status_group ∈ {已支付, 已计提, 已作出待缴/待上诉, 已判决待程序, 已批准待分配, 请求中或审理中, 理论上限}
amount fields are left blank when the source does not quantify the item.
"""
import csv
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "analysis", "legal-exposure-register.csv")

R = [
    # status, amount, currency, matter, forum, date, payment_state, source_type, source, confidence
    ("已支付", "3.0B", "USD", "欧盟 Shopping 案 €2.4B 罚款的现金支付", "European Commission", "2024", "paid",
     "PRIMARY", "txt/10-K_2025-12-31_000165204426000018.txt", "high"),
    ("已支付", "5.2B", "USD", "欧盟 Android 案 €4.1B 罚款 + 应计利息（2026-07-02 欧盟法院驳回上诉后支付）",
     "Court of Justice of the EU / European Commission", "2026-07", "paid",
     "PRIMARY", "txt/10-Q_2026-09-30_000165204426000084.txt 第 8011 行", "high"),
    ("已支付", "1.4B", "USD", "Texas 牵头的隐私和解（位置追踪 + 生物识别，两案）；另有 $190M 德州外部律师费",
     "多州（Texas AG 牵头）", "2025-10", "paid/finalized",
     "PRIMARY", "txt/10-K_2025-12-31_000165204426000018.txt（Privacy Matters）", "high"),
    ("已支付", "700M", "USD", "Google Play 州总检察长和解（2024-05 拨付托管，2026-08 法院批准）",
     "N.D. Cal.", "2024-05", "funded to escrow",
     "PRIMARY", "txt/10-Q_2026-09-30_000165204426000084.txt（Note 10）", "high"),
    ("已支付", "207.7M", "USD", "俄罗斯子公司支付，覆盖对美国母公司科处的罚款", "俄罗斯", "2026-10-29", "paid",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十节（Anadolu/Yeni Şafak）", "medium"),

    ("已计提", "3.5B", "USD", "欧盟 adtech 决定 €2.95B（2025-09-05）；Q4 2025 以银行担保替代现金缴纳",
     "European Commission（AT.40699）", "2025-09-05", "accrued / bank guarantee",
     "PRIMARY", "txt/eu/eu_IP_25_1992.txt；10-Q Q3 2026 Note 10", "high"),
    ("已计提", "2.1B", "USD", "PriceRunner（Klarna 子公司）瑞典判决本金（多币种）+ 利息与费用；已上诉",
     "Stockholm Patent and Market Court", "2026-07", "accrued in Q2 2026",
     "PRIMARY", "txt/10-Q_2026-09-30_000165204426000084.txt（Note 10 私人诉讼段）", "high"),
    ("已计提", "1.0B", "USD", "欧盟 DMA 罚款 €890M（Search €460M + Play €430M）；2026-10 上诉",
     "European Commission（DMA）", "2026-07-23", "accrued in Q3 2026",
     "PRIMARY", "txt/eu/eu_IP_26_1670.txt；10-Q Q3 2026 Note 10", "high"),
    ("已计提", "", "AUD", "澳大利亚 ACCC 搜索分发和解（媒体口径 A$55m ≈ US$36m；SEC 未披露金额）",
     "ACCC / Federal Court of Australia", "2025-08", "accrued in Q2 2025",
     "PRIMARY+SECONDARY", "txt/10-K_2025-12-31_000165204426000018.txt；notes/scope_a_jurisdictions_privacy.md 第五节", "medium"),
    ("已计提", "13.807B", "USD", "资产负债表口径：应计罚款与和解（2025-12-31 为 $15.594B）",
     "Alphabet 合并资产负债表", "2026-09-30", "accrued",
     "PRIMARY", "txt/10-Q_2026-09-30_000165204426000084.txt 第 5337–5345、9115 行", "high"),

    ("已作出待缴/待上诉", "403M", "EUR", "位置数据（Web & App Activity / Location History / Location Accuracy）；另命 6 个月内整改；完整决定与编号未公布",
     "爱尔兰数据保护委员会（DPC，GDPR 一站式机制主导监管机构）", "2026-09-21", "imposed",
     "PRIMARY", "notes/scope_a_jurisdictions_privacy.md 第十一节（dataprotection.ie）", "high"),
    ("已作出待缴/待上诉", "42.9bn", "KRW", "应用内支付（Apple 同案 20.81bn，合计 63.71bn）+ 纠正令；书面决定预计 2026-11",
     "韩国 KMCC（依修订《电信业务法》首次执法）", "2026-10-28", "imposed",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第三节（Korea Herald 等）", "high"),
    ("已作出待缴/待上诉", "216.69 crore", "INR", "Google Play 计费（NCLAT 自 ₹936.44 crore 减额），谷歌上诉至最高法院",
     "印度 CCI → NCLAT → Supreme Court", "2025-03-28", "imposed, on appeal",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第二节", "medium"),
    ("已作出待缴/待上诉", "203 billion", "IDR", "Play 计费；最高法院驳回终审上诉",
     "印尼 KPPU / Supreme Court of Indonesia", "2026-03-13", "upheld",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第二节（Kompas/Jakarta Post/MLex）", "medium"),
    ("已作出待缴/待上诉", "688m", "ZAR", "媒体内容承诺（约 US$40.2M）——属承诺/和解而非罚款",
     "南非竞争委员会（Media & Digital Platforms Market Inquiry）", "2025-11", "committed",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十七节", "medium"),

    ("已判决待程序", "425.7M", "USD", "Web & App Activity 集体诉讼陪审团裁决（集体约 9,800 万人）；2026-08-27 进入律师费阶段，可上诉",
     "N.D. Cal.", "2025-09-03", "verdict",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十二节", "medium"),

    ("已批准待分配", "260M", "GBP", "英国 CAT 开发者集体（Rodger）和解：£160M 赔偿 + £100M 费用/融资，不含责任承认",
     "Competition Appeal Tribunal", "2026-09-15", "approved, distribution pending",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十三节（MLex 等）", "medium"),
    ("已批准待分配", "135M", "USD", "Android 数据传输和解（集体约 1 亿人）", "N.D. Cal.", "2026-08",
     "final approval", "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十二节", "medium"),
    ("已批准待分配", "68M", "USD", "Google Assistant 隐私集体和解", "N.D. Cal.", "2026-10-13",
     "final approval", "SECONDARY", "notes/legal_candidates.tsv（Courthouse News/MLex）", "medium"),
    ("已批准待分配", "30M", "USD", "YouTube 儿童隐私和解", "美国联邦法院", "2026-01-13",
     "final approval", "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十二节", "medium"),
    ("已批准待分配", "8.25M", "USD", "儿童隐私（Play 应用）和解", "N.D. Cal.", "2026-10-23",
     "final approval", "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十二节（MLex）", "medium"),

    ("已判决待程序", "6M", "USD", "洛杉矶陪审团认定 Meta（Instagram）与 Google（YouTube）在首批社交媒体成瘾 bellwether 案中承担责任/过失，认定平台被设计成使儿童成瘾；上诉争点为 Section 230 责任豁免",
     "加州洛杉矶县高等法院（JCCP 协调）", "2026-03-25", "verdict",
     "SECONDARY", "notes/legal_candidates.tsv（AP/Reuters/LA Times/CBS/NYT/The Verge/WSJ/Courthouse News/KQED）", "high"),
    ("已批准待分配", "", "USD", "YouTube 就下一批社交媒体对儿童心理伤害的 bellwether 案和解以避免开庭（金额未披露）",
     "加州", "2026-06-23", "settled, amount undisclosed",
     "SECONDARY", "notes/legal_candidates.tsv（BBC/Courthouse News/CNBC）", "medium"),
    ("已批准待分配", "6M", "USD", "YouTube/Google 人脸识别 BIPA 和解获批准",
     "美国联邦法院（伊利诺伊 BIPA）", "2026-02-02", "approved",
     "SECONDARY", "notes/legal_candidates.tsv（Top Class Actions）", "low"),
    ("已判决待程序", "250M", "USD", "Keene v. Google：AI Overview 虚假陈述（称原告杀害三名女性）；N.D. Ill. Durkin 法官 2026-09-14 准许诽谤请求继续（原告请求额，非判赔额）",
     "N.D. Ill.（Thomas Durkin 法官）", "2026-09-14", "claimed, claims proceeding",
     "SECONDARY", "notes/scope_b_ai_ip_securities.md（Mercury News 全文 analysis/scratch/merc_keene.txt；Law.com）", "high"),
    ("请求中或审理中", "", "USD", "Alphabet 证券集体诉讼：§10(b)+§20(a)，类别期间 2026-05-19 至 2026-07-16，诉因为 Gemini 3.5 Pro 交付进度披露；被告含 Pichai 与 CFO Ashkenazi；揭露日 Class A 跌 4.4%（$16.46）至 $354.46",
     "N.D. Cal.（案号未取得）", "2026-10-05", "filed, lead-plaintiff stage",
     "SECONDARY", "notes/scope_b_ai_ip_securities.md（Levi & Korsinsky/Robbins/Business Wire 通稿全文）", "medium"),
    ("请求中或审理中", "", "USD", "Rosen v. Pichai 等股东代表诉讼（79 页）：信义义务/监督失职、版权（Lyria/Lyria 2/Lyria 3/Mulan/MusicLM，MusicLM 以 500 万条片段/28 万小时训练）、BIPA（Gemini Live 语音）、代理声明虚假、虚高回购（2023-04 至 2025-11 回购 11.47 亿股/$169.6B）；请求赔偿归公司、返还薪酬、治理改革；13 名被告含 Pichai/Page/Brin/Hennessy/Ashkenazi/Porat/Walker",
     "N.D. Ill.（案号未取得）", "2026-10-30", "filed, pretrial",
     "SECONDARY", "notes/scope_b_ai_ip_securities.md（Music Business Worldwide 直读起诉状 analysis/scratch/mbw_derivative.txt）", "medium"),
    ("请求中或审理中", "", "USD", "Hachette、Cengage、Elsevier 与作家 Scott Turow 诉 Google（Gemini 图书训练，主张使用数百万册图书与期刊文章）",
     "纽约联邦法院（S.D.N.Y. 为推断；案号未取得）", "2026-07-13", "filed",
     "SECONDARY", "notes/scope_b_ai_ip_securities.md", "medium"),
    ("请求中或审理中", "", "USD", "独立音乐人拟议集体诉讼（Lyria 3 从 YouTube 挖掘音乐）；谷歌 2026-06-09/10 提出驳回动议，抗辩为 YouTube ToS 许可延伸至 Affiliates",
     "N.D. Ill.（案号未取得）", "2026-03-15", "MTD pending",
     "SECONDARY", "notes/scope_b_ai_ip_securities.md", "medium"),
    ("请求中或审理中", "", "USD", "APIG（代表近 300 家法国报纸）投诉：AI Overviews/AI Mode 违反谷歌 2022 年承诺，要求 AI 摘要内容使用与既有出版者许可分开单独谈判",
     "Autorité de la concurrence（法国）", "2026-08-11", "complaint filed",
     "SECONDARY", "notes/scope_b_ai_ip_securities.md（PYMNTS/CPI、The Next Web）", "medium"),
    ("请求中或审理中", "", "USD", "「AI 放缓协议」私人反垄断诉讼：Anthropic、OpenAI、SpaceXAI 与 Google 为被告；原告为 Gemini/Grok/ChatGPT/Claude 付费订阅用户拟议集体（首席律师 Nick Rowley）",
     "N.D. Cal.（案号未取得）", "2026-09-18", "filed, pretrial",
     "SECONDARY", "notes/scope_b_ai_ip_securities.md（Hindustan Times 全文 analysis/scratch/ht_slowdown.txt）", "medium"),
    ("请求中或审理中", "", "USD", "青少年安全：加州 JCCP 九个人身伤害 bellwether（已进行到第四个）与各州/学区/个人的数千起诉讼；YouTube 为共同被告；第二号 bellwether 已由谷歌在 Snap 之前和解，后续排期仍在",
     "加州洛杉矶县高等法院（JCCP）；联邦 MDL 状态未核实", "2026-10-28", "pending bellwethers",
     "SECONDARY", "notes/scope_b_ai_ip_securities.md（Reuters 2026-10-28、Law.com 2026-11-04、NYT 2026-10-30）", "medium"),
    ("理论上限", "", "USD", "C-250/25 若判决采纳总法律顾问意见：AI 摘要在欧盟需许可或付费（跨成员国效力）；训练环节原则上被 TDM 例外允许",
     "Court of Justice of the EU", "", "theoretical",
     "PRIMARY", "analysis/scratch/cp260155en.pdf（Curia 新闻稿 No 155/26）", "high"),
    ("请求中或审理中", "3.2B", "USD", "adtech 私人赔偿放行进入陪审团审理（约 5,000 家出版商集体 $1.72B + USA Today $900M + Daily Mail $600M；另驳回 $479M）；反垄断法下自动三倍",
     "纽约联邦法院（88 页意见）", "2026-09-30", "claimed",
     "SECONDARY", "txt/articles/247wallst_adtech_3_2b.txt", "medium"),
    ("请求中或审理中", "1B", "GBP", "英国 CAT 消费者集体（Coll，约 2,000 万人），请求 >£1bn（≈US$1.33bn）",
     "Competition Appeal Tribunal", "2026-10-06", "claimed, trial opened",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十三节（Reuters）", "medium"),
    ("请求中或审理中", "", "", "E.D. Tex. 州总检察长 adtech 案（德州牵头，反垄断 + 州欺骗性交易法）",
     "E.D. Tex.", "", "pending trial", "PRIMARY",
     "txt/10-Q_2026-09-30_000165204426000084.txt（Note 10）", "high"),
    ("请求中或审理中", "", "", "欧盟 DMA 媒体降权案（站点声誉滥用政策），目标 12 个月内结案",
     "European Commission", "2025-11-13", "investigation", "PRIMARY",
     "txt/eu/eu_IP_25_2675.txt", "high"),
    ("请求中或审理中", "", "", "欧盟反垄断：AI Overviews/AI Mode 使用出版商内容 + YouTube 内容训练 GenAI",
     "European Commission", "2025-12-09", "investigation", "PRIMARY",
     "txt/eu/eu_IP_25_2964.txt", "high"),
    ("请求中或审理中", "", "", "英国 CMA adtech（CA98 异议声明，2024-09）", "CMA", "2024-09",
     "pending decision", "PRIMARY", "txt/10-Q_2026-09-30_000165204426000084.txt（Note 10）", "high"),
    ("请求中或审理中", "", "", "加拿大竞争法庭广告技术滥用案（宪法抗辩 2026-03-05 被驳）",
     "Competition Tribunal (Canada)", "2024-11", "merits proceeding",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第八节", "medium"),
    ("请求中或审理中", "", "", "波兰 UOKiK 出版商报酬谈判滥用指控", "UOKiK", "2026-10-05",
     "charges filed", "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第六节", "medium"),
    ("请求中或审理中", "", "", "土耳其 RK 对 AI Overviews / AI Mode 的调查（含 2026-10-08 临时措施）",
     "Rekabet Kurumu", "2026-11-02", "investigation + interim measures",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第七节", "medium"),
    ("请求中或审理中", "", "", "巴西 CADE 新闻内容/出版商报酬程序", "CADE", "2026-04-24",
     "administrative proceeding", "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第九节", "medium"),
    ("请求中或审理中", "", "", "尼日利亚 FCCPC 新闻内容利用调查（总统令）", "FCCPC", "2026-07-06",
     "investigation", "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十七节", "low"),
    ("请求中或审理中", "", "", "DOJ 依 USERRA 起诉（军役复职）", "S.D.N.Y.", "2026-10-29", "complaint filed",
     "SECONDARY", "notes/scope_a_jurisdictions_privacy.md 第十五节", "medium"),
    ("请求中或审理中", "", "", "印度最高法院审 Google Play「Authorised Provider」条款（下次庭期 2026-12-01）",
     "Supreme Court of India", "2026-11-03", "hearing", "SECONDARY",
     "notes/scope_a_jurisdictions_privacy.md 第二节（MediaNama）", "medium"),

    ("理论上限", "9.6B", "USD", "adtech 私人赔偿三倍后的理论上限（$3.2B × 3）", "美国联邦法院", "",
     "theoretical", "SECONDARY", "txt/articles/247wallst_adtech_3_2b.txt", "medium"),
    ("理论上限", "40.3B", "USD", "DMA / 欧盟反垄断 / 英国 CA98 / 波兰 UOKiK 的 10% 全球营业额上限（按 FY2025 营收 $402.836B）",
     "欧盟 / 英国 / 波兰", "", "theoretical", "PRIMARY",
     "txt/eu/eu_IP_25_2675.txt；txt/10-K_2025-12-31_000165204426000018.txt", "high"),
    ("理论上限", "80.6B", "USD", "DMA 重复违法的 20% 上限（按 FY2025 营收）", "European Commission", "",
     "theoretical", "PRIMARY", "txt/eu/eu_IP_25_2675.txt", "high"),
    ("理论上限", "", "", "DMA「系统性违法」可要求出售业务或禁止相关收购；美国风险因素保留 divestiture 选项",
     "欧盟 / 美国", "", "structural", "PRIMARY",
     "txt/eu/eu_IP_25_2675.txt；txt/10-Q_2026-09-30_000165204426000084.txt 第 9277 行", "high"),
]

HDR = ["status_group", "amount", "currency", "matter", "forum", "date",
       "payment_state", "source_type", "source", "confidence"]


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(HDR)
        w.writerows(R)
    print(f"wrote {OUT} ({len(R)} rows)")


if __name__ == "__main__":
    main()
