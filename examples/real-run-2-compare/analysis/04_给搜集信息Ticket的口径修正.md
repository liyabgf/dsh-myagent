# 给「搜集信息」Ticket（b356ac64）的口径修正清单

**为什么以文件形式给出**：本 Ticket 尝试用 `myagent_note_ticket` 把下列事实直接交给 b356ac649bc46a144c38f9b4b6619175，Engine 拒绝并返回
`{"error":"Only Tickets in the same Work can hand something to each other","code":"collaboration_refused"}`。
两个 Ticket 在 `myagent.sqlite3` 中都没有 `workId`（不属于任何 Work），因此跨 Ticket 事实传递通道不可用。本文件即为该次传递的内容副本；[SIB] 目录全程只读，未被修改。

按影响排序：

1. **€403M 罚款的作出机关不是欧盟**
   2026-09-21，**爱尔兰数据保护委员会（DPC）** 作为 Google Ireland Limited 的主导监管机构，依 GDPR 一站式机制作出决定：涉 Web & App Activity、Location History、Location Accuracy 三项功能的位置数据处理（审查期间 2018-05-25 至 2020-02-04），认定违反合法性与公平性、问责、透明度与保留义务，罚款合计 **€403M**（媒体折算约 US$463M），并命令 **6 个月内**整改；完整决定与编号尚未公布；调查系 DPC 于 2020-02 自行启动（起因含 BEUC 等消费者组织投诉）。多家媒体标题写「EU fines Google」，属归属错误。一手来源：dataprotection.ie 官方新闻稿（本地副本 `analysis/web/dpc_google_403.html`）。

2. **韩国罚款的机关、法条与分项**
   2026-10-28，作出机关是 **KMCC（Korea Media and Communications Commission，KCC 的继任机构）**，不是 KCC 也不是 KFTC；法律依据是 2021 年修订的**《电信业务法》**（应用内支付条款），这是该法首次执法。分项：**Google KRW 42.9bn + Apple KRW 20.81bn = KRW 63.71bn**；美元折算媒体不一致（US$45m 与 US$47.6m 并存，汇率口径差异），引用须成对给出。附纠正令（外部支付链接、修订第三方费率、谷歌修改第三方 UX 指引、Apple 取消单独提交规则），1 个月内提交合规计划、3 个月内落实，**未移送刑事**；书面决定预计 2026-11 公布；两家均表异议、均未确认起诉。KFTC 另有一条独立案件：2026-07-01 就「Project Hug」游戏开发者独家安排立案（媒体估算潜在上限 KRW 850bn，**属估算而非决定**）。

3. **Epic v. Google 和解时间线：Alphabet 自身两期披露矛盾，最终结果是执行原禁令**
   - FY2025 10-K（2026-02-05 申报）：「In October 2025, we reached a settlement with Epic…contingent on the court approving a proposed modified injunction…filed a joint motion to modify the injunction in November 2025.」
   - Q1 2026 10-Q（2026-04-30）起：「In March 2026, we reached a settlement with Epic…withdrew our petition to the US Supreme Court in March 2026…joint motion to modify the injunction in April 2026.」
   - Q3 2026 10-Q：「In July 2026, Epic and Google jointly withdrew the motion to modify the injunction, and **Google is complying with the October 2024 remedies decision**.」
   结论：2025-10 的方案未落地，2026-03 重新达成和解，最终**按 2024-10 原禁令执行**，而非修改后的禁令。只读 10-K 会得出相反结论。并列证据见 [notes/sec_legal_extracts.md](../notes/sec_legal_extracts.md)。

4. **Gemini 用户口径**
   以 EX-99.1（2026-10-28，Alphabet Q3 2026 业绩公告）Pichai 引述为准：「the Gemini app has reached **one billion users**」。[SIB] 语料中 2026-10-26「Google's Gemini has 400m monthly active users」为旧口径或不同定义，不应与 10 亿并列使用。

5. **Cloud 收入 backlog**
   以 10-Q Q3 2026 为准：剩余履约义务 **$567.7B**，其中 Google Cloud **$560.8B**；含与 Crux AI（Blackstone 合资、关联方）的 **$16.8B**；预计 24 个月内确认略高于 55%。报道中的 $514B 应为上季度口径或转引。

6. **欧盟 DMA €890M 的构成与计提**
   IP/26/1670（2026-07-23）：Search 自我优待 **€460M** + Google Play 反引导 **€430M** = **€890M**，并责令终止不合规行为。Alphabet 在 **Q3 2026 计提 $1.0B**，2026-10 就两项决定上诉（普通法院）。谷歌另于 2026-09-29/30 就 2026-07-16 的**有约束力规格化措施**（Android AI 互操作 + 搜索数据 FRAND 共享）提起上诉——这是**两条不同的上诉**，不要合并表述。

7. **欧盟 adtech 罚款金额口径**
   委员会决定原文（IP/25/1992，2025-09-05）为 **€2.95 billion**；Alphabet 披露写「€3.0 billion fine」并「Q3 2025 计提 $3.5B」，Q4 2025 以银行担保替代现金缴纳，2025-11 上诉。引用时建议写成「€2.95B（决定原文）/ $3.5B（计提）」。

8. **adtech 救济判决的两个日期**
   **2026-09-02**：Brinkema 法官公布简短命令，确认不剥离 AdX，同日提交 106 页完整判决（密封）。**2026-09-15/16**：双方在 14 天窗口内均未提删节，全文公开解封。救济内容：AdX/DFP 与 Prebid 的 API 互操作（「功能等同」）、AdX 向竞争对手出版方广告服务器实时出价、共享竞价（含输赢）数据、公开 DFP 中标机制技术文档、AdWords 不得直接向 DFP 出价或偏袒自家工具（DV360 不受限）、法院指派**技术监督员 6 年**（DOJ 要求 15 年）、义务**全球适用**。DOJ 要求的开源 DFP 拍卖逻辑被驳回。终判尚未录入；双方 2026-10-05 前提交拟议终判。

9. **adtech 私人赔偿的法院与金额**
   2026-09-30，纽约一家联邦法院以 88 页意见驳回谷歌大部分撤案动议，放行约 **$3.2B** 赔偿请求进入陪审团审理：约 $1.72B（约 5,000 家出版商的认证集体）+ 约 $900M（USA Today Co.，原 Gannett）+ 约 $600M（Daily Mail）；另驳回使用其他广告工具的出版商请求与一笔 $479M 请求。反垄断法下自动三倍（理论上限约 $9.6B），尚未排期。**注意：这是私人赔偿诉讼，与 E.D. Va. 的 DOJ 案是两个程序。**

10. **英国 CAT 的三条集体诉讼必须分开**
    (a) **Rodger（开发者集体）**：£260M 和解（£160M 赔偿 + £100M 费用/融资），2026-08-27 宣布、**2026-09-15/16 批准**、2026-10-09 公布，不含责任承认，分配待批；
    (b) **Coll（消费者集体，约 2,000 万人）**：请求 >£1bn（≈US$1.33bn），**2026-10-06 开审**，仍在审理；
    (c) **BIRA Trading Ltd v Alphabet Inc. 等**：2026-10-16 新立案，案号 **1795/7/7/26**。
    把 (a) 与 (b) 混为一案会出错。

11. **美国隐私侧的判决与和解（易被漏掉的两笔）**
    Web & App Activity 案 **$425.7M 陪审团裁决**（2025-09-03，N.D. Cal.，集体约 9,800 万人，2026-08-27 进入律师费阶段）；Android 数据传输和解 **$135M**（2026-08 终审批准）；YouTube 儿童隐私 **$30M**（2026-01-13 终审批准）；Google Assistant **$68M**（2026-10-13 终审批准）；儿童隐私 **$8.25M**（2026-10-22/23 终审批准，非 10-27）；Texas 牵头 **$1.4B**（2025-10 最终确定，10-K 一手确认，另有 $190m 德州外部律师费）。Incognito 和解的终审批准状态**未能核实**，不应写作「已批准」。

12. **2026 年前 9 个月的资本结构变化（业务侧但影响法律承受力）**
    融资活动净流入 **+$115.757B**（去年同期 -$44.416B）：债务 $85.222B、普通股 $42.870B、强制可转换优先股 $19.063B；**股票回购 $0**（去年同期 $39.810B）；9 个月发行 $45.0B 美元票据 + $35.8B 外币票据；现金及等价物 $23.090B → $56.334B；9 个月 capex $63.6B → **$132.0B**（Q3 单季 $51.4B）。这组数字决定了「罚款可承受、结构性救济不可承受」的判断基础。

13. **"五家法国出版商集团向欧盟投诉 AI Overviews"（PPC Land，2026-10-31）为单一来源，未能核实**
   可核实的是另一件事：**APIG（代表近 300 家法国报纸）于 2026-08-11 向法国竞争管理局（Autorité de la concurrence）投诉**，主张谷歌 2026 年 7 月上线的 AI Overviews/AI Mode 违反其 2022 年承诺，要求裁定 AI 摘要对内容的使用**须与既有出版者许可协议分开单独谈判**（PYMNTS/CPI、The Next Web，France 24/Euronews/Search Engine Land/TechRepublic 一致）。若引用 10-31 那条，须标注投诉机构与法律基础均未确认。

14. **2026-03-25 洛杉矶陪审团裁决是本 Ticket 与对方语料的双重命中项，但对方标题多为 Meta 视角**
   裁决同时认定 **Meta（Instagram）与 Google（YouTube）** 过失成立、平台被设计成使儿童成瘾，判赔 $6M；**YouTube 于 2026-07-15 加入 Meta 的上诉**，挑战"设计令未成年人上瘾"的认定；第二号 bellwether（K.D.B.）中谷歌已在 Snap 之前和解（Daily Journal 2026-10-26 称 Snap 是"第 4 家和解的公司"，媒体表述为加入 Alphabet、Meta 与 TikTok），Meta 2026-10-30、Snap 2026-11-02 和解后该场审判取消；NYT 称 K.D.B. 是"九个人身伤害 bellwether 中的第四个"，**后续排期仍在，谷歌未整体退出 JCCP 程序**。
