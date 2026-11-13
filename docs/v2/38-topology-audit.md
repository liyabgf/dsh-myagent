# 38 · 全项目拓扑与逐级审核

## 状态与授权范围

本轮请求：建立纪律，形成完整细致的项目拓扑，并从结构级到每个代码文件逐级审核。当前阶段是审核，不自动停止任务、重载插件、修改业务数据、安装依赖或发布版本。发现问题先保存证据与修复建议；必要的审核脚本、测试和文档可以新增。不得用重新克隆、重置或覆盖工作目录解决版本差异。

基线：2026-11-13 Asia/Shanghai；仓库 `/Users/liyang/Documents/SA/myagent`；HEAD `a06e999`；远端 `https://github.com/liyabgf/dsh-myagent.git`。初始工作区已有 `lib/index.js` 修改，归属未核实，保留，不还原。原始用户附件 37 是历史审核证据，须与仓库版分开核对。

## 不可绕过的审核纪律

1. **操作先登记，结果后追加**：每个执行批次先在操作账本中写目的、范围、方法；结束后追加真实结果、退出码、证据路径。工具对话不等于物理记录。失败、无匹配、变异存活同样记录。不能补造时间戳、退出码、测试或活体证据。
2. **覆盖可计数**：生成全部受版本控制文件清单，逐文件登记未审/已读/已审/复核状态与证据。生成物、历史文档、测试、资产分别注明方法；目录存在不等于已审核。每个生产代码文件必须读全文，不用关键词命中代替审核。
3. **拓扑先行**：分别建立静态导入图、运行时装配图、事件/效果/工具调用图、持久化与外部 IO 图。每条关键边带源码位置；动态边人工核实，不能把 import 图当运行拓扑。
4. **逐层判定**：仓库身份与发布边界 → 启动/卸载 → 领域不变量 → 存储事务 → 调度执行 → 工具与提示词 → 进出站桥 → 面板与 HTTP → 测试与发布。检查调用者与被调用者的前置条件、失败/取消/重启/重入行为。
5. **结论需可复现**：发现必须带位置、触发条件、影响、证据、置信度；候选与已确认分开。没有发现不称无风险。测试通过仅证明被测命题。
6. **变异与复现实验隔离**：优先独立临时快照，禁止对正在构建或审查的工作树并发变异。保存原始输出和被测进程真实退出码；测试零命中是未验证。存活变异要分析可观测差异，不能直接宣布等价。
7. **历史不冒充当前**：前次部署证据不可用于当前构建验收；累计入队不等于待发送；user 历史消息不等于 relay；配置路径不证明内存加载版本。所有时间明确 UTC 或 Asia/Shanghai。
8. **保护原件**：本体 myagent、公开副本 myagent-public、运行态 ~/.dsh/state/myagent 各自独立。审核只读运行态；禁止删除仓库、强推、重置、无备份覆盖。提交前审查精确差异，禁止 git add -A 混入未知改动。
9. **独立复核**：审查者给文件范围和物理报告；整合者阅读报告并核实关键发现。覆盖表未完成的条目保持未审，不宣称全项目通过。

## 交付与验收

- 文件清单与覆盖台账；静态拓扑数据及运行时 Mermaid 图。
- 分层逐文件报告、测试映射、已确认发现与待验证问题。
- 原始执行证据（命令、退出码、输出），历史误报更正表。
- 最终闸门与对基线的差异检查。全部发现有处置状态；未完成覆盖显式列出。

## 操作账本（追加）

### A001 · 建立本轮工程（进行中）

计划：核实仓库身份，加载 DSH 审核所需技能，建立纪律文件、计划和覆盖方法。前置只读身份命令已执行：pwd/git status/remote/log，退出码 0；HEAD a06e999，工作区 lib/index.js 已修改。未改动或清理原有文件。

下一批 A002：读取历史纪律及用户附件、生成受控文件清单与导入边；确认具体文件范围后分派两路独立审核，同时主审运行时装配、HTTP 与执行边界。所有报告保存在本轮 audit38 目录。

### A002 · 文件清单与首轮结构审核（已执行）

git ls-files提取387个受控文件，生成inventory.json、coverage.md、imports.json（729条含类型导入边），退出0。用户附件37与仓库04纪律全文已读；package/index/deployment/executor/runtime/desk模块审查范围保存在runtime-review.md。两名子审查者各写独立报告，禁止生产代码/运行态写入。Config Inspect确认myagent挂载packageDir为web/node_modules/myagent，尚未据此断言内存版本。

### A003 · 隔离行为复现实验（计划）

新增tests/audit38-repro.spec.ts，仅构造临时Store/Runtime与stub LLM，验证恢复顺序、LLM取消传递、worker误关闭、网关回执语义与replied守卫。所有运行stdout/stderr、真实exit code保存audit38证据目录。不变异当前生产源码；不运行根目录build。运行脚本前记录源码/已有lib哈希，测试后核对。若实验失败，说明发现问题被复现，不计为项目闸门失败；实验断言以当前缺陷的观测为目标，测试名明确说明是审核探针。

A003结果：6条探针及新增第7条（provider error finish携带部分文本被ready）均复现目标观测；repro-exit.txt真实退出0。第一次全量typecheck/test退出均0，1214条（含6探针），原有lib哈希2cac4b8c36ee96b638a0ae2fe7d14a4309e779727f782389eda0ad02d9524def。后加1探针，尚需最终重跑。发现详情runtime-review.md，不能据探针绿色声称功能正常。

### A004 · 完整范围复核与隔离闸门（计划）

Inventory共387个受控文件：src41、tests50、bridges27、examples206（含27个Python历史脚本）、docs38、lib2等。源代码、桥、UI、脚本全文审查已分工；tests剩余全文映射交core-audit继续。历史样例脚本不能因不在运行链而漏审，另记报告；历史长文档和采集原文仅做引用/结构/发布边界审核，不声称逐条事实验证。进一步拓扑将列所有函数/路由/事件/效果与数据存储边。

为保护DSH link的原树构建产物，完整gate在/tmp唯一快照运行：复制受控文件与当前审核探针，复用node_modules链接；记录快照路径、哈希、命令、真实退出。禁止在本体构建、运行发布脚本或操作myagent-public。

A005 · 审核探针与隔离闸门（已执行）

- `pnpm vitest run tests/audit38-repro.spec.ts`：7 tests passed，退出0；原始输出 `audit38/repro-output.log`，退出码 `repro-exit.txt`。探针验证 RT01、RT06–RT11 的目标观测，不把“探针通过”当生产行为通过。
- 隔离快照 `/var/folders/cb/dx90h3g57qsc4fj38007t68c0000gn/T/myagent-audit38-gate-0kzzcl9r`；快照含受控树、审核探针和node_modules符号链接；`./scripts/gate.sh` 退出0，1215 passed，产物 `2cac4b8c36ee96b6`（516828字节）。原本体 `lib/index.js` 未由本次gate写入。
- 同一工作树 typecheck/test此前退出0（1214 passed）；后增加RT11探针后隔离闸门为1215。由于当前工作区仍有用户已有 `lib/index.js` 修改及审核未跟踪文件，不能把快照产物当作提交后发布产物。
- 审核中未运行 release.sh、verify-migration.sh、verify-live.sh、浏览器、桥网络、GitHub发布；未触碰 `myagent-public` 与日常运行态。

A005后续：将全部10条审核探针复制进同一快照重跑完整gate，出现1个既有runtime-budget.spec失败、1217 passed/1218 total，退出1（gate日志 lines 198–219）。失败断言为assignment pending而非running，发生在测试backdate前置步骤；此前不含全部探针的同树全测试曾1214/1214通过。该次失败不能假报全绿，也不能单凭一次判定生产回归。相同快照无代码变化的第二次完整gate为1218/1218、退出0、产物hash一致（final-gate-full.log）；第一次失败仍保留gate-full-failure.log。失败未再次复现，标测试间歇/时序候选，不因重跑通过抹去首次观测。

### A006 · AST拓扑与引用检查（已执行）

已在本体只读源码运行TypeScript AST索引，退出0：978函数/类型符号、548 import声明（标识typeOnly）、233 route/handle/on/emit/enqueue/set调用边。数据保存symbols.json、ast-imports.json、dynamic-edges.json、symbols.md，自动索引不等于逐函数行为证明。Markdown本地链接存在性扫描退出0：检查84条，缺失13条，多为旧验收记录指向已不存在的/tmp临时证据；详见doc-links.json。历史采集事实文本不冒充逐行代码审查。

### A007 · 整合与更正（进行中）

- 两路审查报告及逐文件台账已持续落盘；主审亲读与报告审核范围在runtime-review.md记录。
- About空changes被判“静默失败”的候选被panel.spec:5810–5821反证撤回；SR21“原地修改GET响应导致污染”缺共享对象证据降为候选，不列确认问题。
- Full gate失败原始明细从/tmp/myagent-gate.log复制到gate-full-failure.log。定向runtime-budget重跑4/4通过，退出0，仍将全套负载下时序失败记为待验证。
- 用户请求为审核；本轮不修业务代码、不改变日常运行环境、不推送原有lib产物，不用“全部通过”掩盖发现。

### A010 · 失败定位与最终闸门（计划）

前一次组合gate失败与定向4/4通过均保留。现在同一隔离快照无源码改动重跑一次完整gate，用来判别负载下偶发性，不删除先前失败证据、不改测试放宽断言；新结果另存final-gate-console.log / final-gate-full.log / final-gate-exit.txt。最终报告同时呈现两次结果。之后核实原树lib哈希、git diff，只暂存本轮审计文档和探针，排除原有lib修改。若提交/推送，记录目标分支与commit，使用HEAD:main而非误推本地旧main。




### A008 · 当前审核结论（审核交付完成，发现尚未修复）

本轮新增纪律执行器 `audit38/run-recorded.py`：命令前追加planned记录，命令结束追加真实exit与stdout/stderr SHA-256；A009 smoke记录已写入 `audit38/operations.jsonl`。后续审核命令优先通过该包装器执行。

本轮已经建立仓库级、运行装配级、领域/存储级、执行/桌面级、桥接/面板/发布级、测试级拓扑。受控库存387文件：src41、旧tests47+3 helpers、bridges27、panel1、scripts5、prompts3；examples含27个Python脚本已逐文件审查，历史数据资产仅枚举。docs补读已完成：39/39份目标（含本轮38）全文读取，长篇00按≤500行连续读至9023 EOF；不重验历史新闻事实/真实平台网络。覆盖台账保留174个历史数据仅枚举、2个生成物身份核对、1个锁文件仅结构审查的边界，不宣称所有历史数据逐行审核。

Audit38隔离探针当前10条通过（退出0）是“缺陷观测成立”，不是产品验收通过。最终隔离完整gate 1218/1218、退出0，产物2cac4b8c36ee96b6（516828字节）；前次完整gate曾1217/1218、1个runtime-budget前置状态断言失败，定向4/4和同快照完整重跑都通过。最终一次gate通过不等于项目无缺陷，间歇失败作为未定项保留。

当前确认优先级：
- P1：DeskLoop恢复顺序、worker误drop、LLM取消不传、错误finish误ready、异机锁、WeCom/Telegram/QQ桥可靠性、panel排期字段丢失、release提交失败仍push。
- P2：DeskLoop旧reply守卫、requestId未去重turn、artifact同size判据、Memory Thread回滚、Prompts KV分裂、Chat fanout、Watchdog告警先去重、测试假桩/降级断言、文档与历史状态漂移。

本轮只审核，不修复业务代码，不运行发布脚本，不操作myagent-public，不操作日常运行态。工作区既有lib/index.js修改保留；新增audit38文档、拓扑数据、审核探针是本轮审计产物，提交前需人工确认是否纳入版本。pnpm-lock.yaml仅做结构核查（依赖锁文件本身、tarball/integrity/local引用计数已落盘），未安装/审CVE/联网供应链。

### A011 · 交付提交与远端核实（已执行）

- 精确暂存38总控、audit38目录、audit38探针；原有lib/index.js修改未暂存未提交。
- staged diff --check返回2，原因仅原始.log尾随空格/EOF空行；原始证据保持逐字不修改。排除.log后的作者文档/JSON/脚本/测试检查退出0。
- 审核交付提交 `3d247dc`（42文件，27,847行，主要为机器索引、覆盖表、原始日志与报告）。git fetch origin main退出0，remote-only为空，local-only仅该提交；git push origin HEAD:main退出0，远端a06e999→3d247dc。
- 最终隔离gate退出0，1218 passed；10个新增probe验证缺陷观测，不是修复验收。完整首次失败、定向重跑、最终通过均保存。
- 工作树仍保留原有lib/index.js修改；本轮未更改业务源码、未更改日常任务、未操作公开副本。审核完成不等于全部缺陷修复；修复需另立工程和验收批次。
