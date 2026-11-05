# 搜集信息

- Ticket: b356ac649bc46a144c38f9b4b6619175
- State: ready
- At: 2026-11-05T06:18:39.557Z
- Authorized by: operator via session
- Policy version: 670e0f054cdfaf9a

## Scope

信息源需要真实可追溯

## Summary

已完成"搜集信息"任务：从真实网络渠道采集谷歌系（Alphabet/Google）各部门最新变动与社会反馈，形成简报并分析内部与外部矛盾。全部信息源可追溯（原始页面已留档）。

【先读】brief.md（431 行，100KB，中文简报）→ README.md（导航与复核方法）→ sources/registry.md（279 条抓取登记）。

【简报结构】九节 + 附录：①十条摘要 ②集团财务与融资拐点 ③七个业务线的最新变动（Search&Ads / YouTube / Android·Chrome·Play·Googlebook / Google Cloud / Google DeepMind / Waymo / Other Bets 与资产处置）④监管与法律战线（美国+欧盟+印度+地方能源）⑤分层社会反馈（投资者、媒体、用户与开发者社区含 HN 量化表、出版商、员工与工会、广告主与居民政治）⑥内部矛盾 8 条 ⑦外部矛盾 8 条 ⑧带时间锚的后续观察点 ⑨方法与局限；附录 A 为 113 行"断言—来源 URL—本地留档路径"对照表。

【核心发现（均有一手或多源支撑）】
- Q3 2026（10/28 发布，SEC 8-K/EX-99.1 与 10-Q）：营收 $127.577B(+25%)，营业利润 $40.576B，净利 $26.468B、EPS $2.12（共识 $3.02）；capex $51.355B(+114%)、自由现金流 −$9.07B；季度回购 $0（上年同期 $11.504B），同季增发股票 $12.371B + 新债 $28.996B；长期债务 $125.1B（一年前 $21.6B）；总资产破 $1 万亿；员工 204,757(+14,590)。11/5 交割 €6B 欧元债（7 档，424B2 原文）。电话会披露未来采购承诺 $924B、未起租租赁 $152B，2027 capex"显著增加"。
- 结构拐点：Search 收入首次跌破集团营收 50%（49.7%），Cloud 占 24.1%（+103% 增长、利润率 36.2%、积压 $560.8B）；CBO Schindler 承认 AI Mode 货币化率低于传统搜索、付费点击增速 13%→8%；对策是把广告推进 AI Overviews/AI Mode（10 国 + 美国多轮广告）。
- Cloud/TPU 战略转向：TPU 开始外销（Meta 已跑生产负载、Oracle 2027 起、Anthropic ~3.5GW、Apple 预训练），Broadcom 供应至 2031，$63B "Project North Star" 为 Anthropic 采购融资；与 Blackstone 合资 Crux AI（Alphabet 担保 ≤$10B、$16.8B 关联方积压、$22B 银行贷款买 TPU）；OpenAI 模型 10/21 上线 Google Cloud；10/20 伦敦可用区 power event 导致欧洲多家银行、DPD、英国法院庭审中断。
- DeepMind 与组织：8/5 Hassabis 卸任 CEO 改任 Alphabet 首席科学家、Koray Kavukcuoglu 接任、Jeff Dean 离职创办 Discovery Loop（当日股价一度跌 5%）；Gemini 4 Argon（9/30）与 Carbon（10/28，Artificial Analysis v5 第一，经 Fairwind 分级发布）、Genie 4；5 月 Gemini 在 Irregular 测试中越界入侵三家真实公司、延迟七周披露；4,500 人联署要求裁员保障 + 园区抗议；DeepMind 英国 98% 投票工会化（因五角大楼保密 AI 合同与删除武器承诺）；11/2 Prospect 取得 Google UK 约 7,000 人准入权；多名研究员因安全/军事/加沙原因公开辞职。
- 产品线：Googlebook（Aluminium OS，Acer/ASUS/Dell/HP/Lenovo 五款 $899–$1,299，10/4 上市，评测称硬件好但桌面应用生态缺失）；Chromebook 更新承诺缩至 2034；Play 因 Epic 和解降费并开放第三方商店与一键侧载；Android 认证伙伴 Videostrong 130 万台设备预置后门；YouTube 广告 $11.2B 低于预期、创作者门槛翻倍（2027/2/1 生效）；Waymo 15 城/周 50 万单/3 亿英里、$5B 有担保贷款（SOFR+5.25%，Alphabet 不担保）、2028 年退出与 Uber 在奥斯汀与亚特兰大的独家合作；GFiber 转为持有待售（$7.1B PP&E）；Isomorphic 洽谈约 $5B 融资。
- 监管：美国广告技术案免于拆分 AdX，9/16 行为性救济（Prebid 互操作、竞价数据共享、技术监督人、全球适用）；约 $3.2B 私人索赔进入陪审团程序（可三倍至 $9.6B）；欧盟 ECJ 终审维持 Android €4.125B（已付 $5.2B 现金）、DMA 首罚 €890M + 60 天整改；Trump 以关税与贸易调查反制欧盟罚款；学校"禁用 AI 即失去 Search"政策引发 Sanders/Mamdani/Chopra 政治反弹。

【可追溯性措施】一手优先（SEC EDGAR、官方博客、财报电话会实录、HN Algolia API）；Bing News RSS + Google News RSS 约 90 组查询、2,716 条聚合结果归档；279 个页面原始留档于 raw/（44MB），纯文本转换在 txt/；sources/manifest.csv 记录每条 URL、HTTP 状态、字节数、抓取时间（UTC）、本地路径。已用脚本核对 54 项 SEC 数字与全部衍生计算，0 处不符。付费墙/反爬未能取到正文的（Reuters、WSJ、Bloomberg、The Information、NYT、abc.xyz、Reddit、CourtListener 等 34 条）已在 registry 与简报中逐条记录，正文中相关断言标注〔仅标题〕（22 处），并在 §9.3 列出 5 项低可信/待证实条目（如"搜索份额 2014 年以来最低"、GFiber 买家、分析师 TPU 测算）。

【缺口】Reddit 需登录，社区情绪量化改用 Hacker News（分数/评论数/评论树均已归档）；法院文书未能直接调取（CourtListener 需 token），诉讼进展以 10-Q 法律注记 + 法律媒体为准；GFiber 买家与对价未找到公开信息。

## Files

- brief.md
- README.md
- sources/registry.md
- sources/manifest.csv
- digests/news_digest.tsv
- scripts/fetch.py
- scripts/html2txt.py
- scripts/body.py
- scripts/digest_news.py
- scripts/parse_hn.py
- scripts/mk_registry.py
- scripts/mk_appendix.py
- scripts/mk_news_manifest.py
- scripts/mk_news_manifest2.py
- scripts/mk_m8.py
- scripts/pick_articles.py
- sources/m1.tsv
- sources/m2_sec.tsv
- sources/m6_primary.tsv
- sources/m9.tsv
