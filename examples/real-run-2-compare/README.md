# Ticket `信息比对`（19dd5c9ca7bce11fb2c9f7a2b04728b0）目录说明

**任务**：搜集现在谷歌系面临的法律事件，综合另一个 Ticket（`搜集信息` / b356ac64）搜集到的信息，综合论述谷歌的处境。
**授权**：operator（session），2026-11-05T04:56:26Z。策略版本 670e0f054cdfaf9a。
**数据截点**：2026-11-05（Asia/Shanghai），采集时间 12:56–14:20。

---

## 阅读顺序（按重要性）

| 顺序 | 文件 | 内容 |
|---|---|---|
| 1 | [analysis/02_谷歌法律处境综合论述.md](analysis/02_谷歌法律处境综合论述.md) | **主结论**。13 节 + §7.5：摘要、活跃战线一览、美国搜索案、美国 adtech 案、欧盟、英国、AI 与内容、私人赔偿、其他辖区、财务口径、与另一 Ticket 的综合、情景分析、方法与局限 |
| 2 | [analysis/01_法律事件年表.md](analysis/01_法律事件年表.md) | **证据底稿**。137 条法律事件，按板块与日期排列，每条含机构/法院、案号、状态、金额、证据（本地路径或 URL）、置信度。机器可读版：[analysis/legal-events-chronology.csv](analysis/legal-events-chronology.csv) |
| 3 | [analysis/05_监管与法律风险自述与敞口量化.md](analysis/05_监管与法律风险自述与敞口量化.md) | Alphabet **自己**写给投资者与债权人的风险语言（10-K/10-Q 原文引用 + 行号）+ 按"已付/已计提/已作出待缴/已批准待分配/请求中/理论上限"六种状态分类的敞口清单与承受能力对照 |
| 4 | [analysis/03_信息比对_两Ticket对照.md](analysis/03_信息比对_两Ticket对照.md) | **本 Ticket 标题所指的比对**：采集面对比、双方独立命中的交集、7 处冲突与口径差异（含裁定）、只有本 Ticket 有的一手证据、只有对方有的业务证据、交叉推断、缺口清单 |

补充：[analysis/04_给搜集信息Ticket的口径修正.md](analysis/04_给搜集信息Ticket的口径修正.md) —— 14 条需要对方 Ticket 修正的口径。原本要用 `myagent_note_ticket` 直接递交，被 Engine 拒绝（`collaboration_refused`：两个 Ticket 都不属于任何 Work），因此落成文件；对方目录全程只读。

子任务核验稿（两个 subagent 产出，本 Ticket 已吸收进上文）：
- [notes/scope_a_jurisdictions_privacy.md](notes/scope_a_jurisdictions_privacy.md) —— 非美国辖区 + 隐私/消费者保护，含「未核实或被证伪的线索」14 条
- [notes/scope_b_ai_ip_securities.md](notes/scope_b_ai_ip_securities.md) —— AI/知识产权/青少年安全/证券诉讼（子任务 B，472 行）。关键增量：C-250/25 总法律顾问意见一手新闻稿（Curia No 155/26）、Chegg/Penske 驳回的法院与法官（D.D.C.，Mehta）及理由原文、Keene 诽谤案（N.D. Ill.，Durkin，请求 ≥$250M）、Play 律师费裁定（N.D. Cal.，Donato，$85M 出自 $630M 消费者基金）、证券集体诉讼（N.D. Cal.，类别期间 2026-05-19 至 07-16，诉因为 Gemini 3.5 Pro 进度）、Rosen 股东代表诉讼（N.D. Ill.，13 名被告）、青少年安全战线的程序细节（YouTube 2026-07-15 加入上诉、第二号 bellwether 已在 Snap 之前和解、九个 bellwether 排期）

---

## 目录结构

```
信息比对-19dd5c9c/
├── README.md                       本文件
├── analysis/                       交付物（01–05 + 年表 CSV）
│   ├── 01_法律事件年表.md
│   ├── 02_谷歌法律处境综合论述.md
│   ├── 03_信息比对_两Ticket对照.md
│   ├── 04_给搜集信息Ticket的口径修正.md
│   ├── 05_监管与法律风险自述与敞口量化.md
│   ├── legal-events-chronology.csv 116 行，机器可读年表
│   ├── legal-exposure-register.csv 50 行，按"已付/已计提/已作出待缴/已判决/已批准待分配/请求中/理论上限"分类的敞口登记
│   ├── bing_real_urls.txt           从 Bing News RSS 解出的 692 条真实文章 URL（子任务 B 产出，可复用）
│   ├── web/                        子任务 A/B 抓取的网页快照（核验证据）
│   └── scratch/                    子任务工作文件（非交付物）
├── notes/                          工作底稿
│   ├── sec_legal_extracts.md       五期 SEC 披露的 Legal Matters 并列对比（Epic 时间线矛盾由此发现）
│   ├── legal_candidates.tsv        748 条法律相关去重条目（日期/评分/语料来源/媒体/标题/链接/命中词）
│   ├── legal_top.md                同上，按月份可读版
│   ├── index_all.tsv → sources/    见下
│   ├── scope_a_*.md, scope_b_*.md  子任务核验稿
│   └── fetch_stage1/2/3.log        三阶段抓取日志
├── raw/                            一手与聚合原始文件（152 个文件，25 MB）
│   ├── sec/                        Alphabet SEC 申报原件（HTML）
│   ├── doj/                        DOJ 案卷 12 份 PDF（终审判决、95 页备忘录意见、上诉书状 2 份、合规报告 2 份、命令、许可模板建议等）
│   ├── eu/                         欧盟委员会 presscorner JSON 原文（12 份）
│   ├── uk/                         英国 gov.uk/CMA 页面（9 份）
│   ├── news3/                      31 组补充法律新闻查询（RSS）
│   ├── articles/                   个别关键报道全文
│   └── *.xml / *.json / *.html     第一阶段 76 个源的产物（60 个返回 200）
├── txt/                            HTML/PDF 抽取的纯文本（49 个文件，2.7 MB）
│   ├── 10-K_*.txt, 10-Q_*.txt      Alphabet 申报文本
│   ├── doj/                        DOJ 案卷文本 12 份，合计约 93 万字符（终审判决 6.5 万、备忘录意见 29.6 万、上诉书状 2 份共 31 万）
│   ├── eu/, uk/, articles/
├── sources/                        清单与索引（溯源用）
│   ├── manifest_stage1.csv         76 个源（60 成功）：URL、HTTP 码、字节数、落地路径、时间、错误
│   ├── manifest_stage2_sec.csv     SEC 申报清单（8 项，全部 200）
│   ├── manifest_stage3.csv         第三阶段（英国/欧盟/DOJ/补充新闻；78 项，72 成功）
│   └── index_all.tsv               两套语料统一索引 4,755 行（本 Ticket 1,649 + 对方 3,106）
├── scripts/                        可复现脚本
│   ├── fetch_legal.py              阶段一：76 源抓取（curl，因本机 python urllib TLS 校验失败）
│   ├── fetch_sec.py                阶段二：SEC 申报抓取 + HTML→文本 + Legal Matters 切片
│   ├── fetch_stage3.py             阶段三：CMA/presscorner/DOJ PDF/补充新闻
│   ├── html2txt.py                 HTML→可读文本
│   ├── parse_index.py              RSS/Atom/JSON → 统一索引
│   ├── filter_legal.py             法律关键词打分 + 去重
│   ├── build_chronology.py         年表唯一事实源 → CSV + MD
│   └── build_exposure_register.py  敞口登记 CSV
└── vendor/                         pypdf（仅安装在本目录内，用于 DOJ PDF 抽取）
```

---

## 证据分级与置信度

- `PRIMARY`：官方一手文件。本 Ticket 取得 **Alphabet 7 份 SEC 申报 + 1 份附件**、**DOJ 案卷 12 份 PDF**、**欧盟委员会 12 份决定/新闻稿原文**、**英国 CMA 9 份公告原文**。
- `SECONDARY`：主流媒体与法律垂类媒体（Reuters、MLex、Law.com、Bloomberg Law、Courthouse News、AdExchanger、Korea Herald、MediaNama、Daily Sabah 等）。
- `confidence`：`high`（一手文件，或 ≥3 家独立媒体一致）／`medium`（1–2 家媒体，未见原始文件）／`low`（单一来源）。
- 年表中 137 条：`high` 75 条、`medium` 57 条、`low` 5 条；`source_type` 为 PRIMARY 66 条、SECONDARY 67 条、两者兼有 4 条。
- 法律相关条目 748 条中：仅本 Ticket 命中 546 条、仅对方 Ticket 命中 160 条、双方均命中 42 条——这一分布本身就是本 Ticket 的价值证明（详见 [analysis/03_信息比对_两Ticket对照.md](analysis/03_信息比对_两Ticket对照.md) 第 1 节）。
- 所有金额均标注币种与期间，并区分**已作出（imposed）／已支付（paid）／已计提（accrued）／仅请求（claimed）**四种状态。核验到的**已实际支付**的非美国款项只有两笔：2026-07 Android 的 **$5.2B**（罚款+利息）与 2026-10-29 俄罗斯子公司的约 **$207.7M**。

## 已知局限

**所有案件的案号均未取得**（CourtListener API 401、其 HTML 403，Justia 403，supremecourt.gov/orders 302，law.com 与 reuters.com 正文封锁）——补齐需要 PACER 访问权或更换出口 IP。未取得原件因而置信度受限的文件：E.D. Va. adtech 的 106 页救济判决与终判；纽约联邦法院 2026-09-30 的 88 页意见与案号；C-250/25 总法律顾问意见原文；欧盟法院 C-604/22 P（Android）判决原文；印度/韩国/日本/波兰/土耳其的原始决定；Alphabet 证券集体诉讼与股东代表诉讼起诉书。
本主机的抓取限制：CourtListener API 401、其 HTML 403；Justia 403；AP News 403；Courthouse News feed 403；FTC/加州总检察长/纽约总检察长/CCI 站点 404；ACCC 403；python `urllib` 全站 TLS 校验失败（已改用 `curl`）；SEC 需要形如 `Name name@example.com` 的 User-Agent，否则 403。

## 复现

```bash
cd ~/.dsh/state/myagent/work/信息比对-19dd5c9c
python3 scripts/fetch_legal.py      # 阶段一：76 源
python3 scripts/fetch_sec.py        # 阶段二：SEC 申报 + Legal Matters 切片
python3 scripts/fetch_stage3.py     # 阶段三：CMA / presscorner / DOJ PDF / 补充新闻
python3 scripts/parse_index.py      # 统一索引（含对方 Ticket 语料，只读）
python3 scripts/filter_legal.py     # 法律条目筛选
python3 scripts/build_chronology.py # 年表 CSV + MD
python3 scripts/build_exposure_register.py # 法律敞口登记 CSV
```
