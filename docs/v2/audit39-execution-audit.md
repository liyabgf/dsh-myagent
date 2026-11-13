# Audit39 执行审核

## 0. 审核范围与授权

本轮审核对象：Audit39 校正修复工程 R0–R5 的执行过程、代码/测试差异、supervision 操作账本、闸门证据、变异/真机验收边界与最终结论。当前仓库 `/Users/liyang/Documents/SA/myagent`，远端 GitHub main。审核只读，不修改业务源码、测试、构建产物、运行态、公开副本，不重载插件，不运行发布操作。工作区已有 `lib/index.js` 与 `lib/index.d.ts` 修改，归属在审核前已存在，审核不还原、不暂存。

## 1. 审核纪律

1. **先登记后检查**：除创建报告所需的前置只读身份核验外，每个审核批次先在 §4 操作账本追加计划，再检查并追加命令、退出码与证据路径；不能声称本报告早于实际发生的前置核验。
2. **历史不冒充当前**：supervision日志中的测试/闸门数字必须与提交、原始输出和当前文件对应；旧基线、子代理报告、对话文字不能单独证明当前树。
3. **代码差异优先**：审核以 `git show`、当前源码和测试实际断言为准；提交消息不能替代diff检查。
4. **成功/缺口分开**：测试通过只证明测试命题；变异未执行、真机未执行、官方向量缺失、P1未覆盖均保持未决。
5. **证据可复现**：命令记录真实退出码；原始日志保留；不得为了审核重跑会写产物或触碰运行态的命令。
6. **只读保护**：不得使用reset、checkout、rebase、force push、build、release、plugin reload；不改变已有lib修改。

## 2. 审核判据

- D1 纪律：每个R0–R5代码批次是否有修改前基线、允许/禁止文件、修改后hash、测试/闸门结果和提交记录。
- D2 覆盖：Audit38 P1/P2发现是否映射到R0–R5；未修、撤回、仅静态风险是否如实标记。
- D3 修复正确性：修复是否实现计划契约；是否引入新的状态、模式、接口或安全风险。
- D4 测试质量：正向、负向、变异、真实Store/Runtime/桥接边界是否覆盖；是否存在弱桩、条件降级或探针被错误计入产品测试。
- D5 证据真实性：supervision里的退出码/测试数/产物hash是否对应命令和提交；生成物是否与源码树一致；真实宿主/桥/官方WeCom向量是否执行。
- D6 发布边界：提交/推送是否符合R5授权合同；是否触碰原有lib修改、日常state或公开副本。

## 3. 审核输出

本报告最终必须给出：

- 通过项及证据
- 违反纪律项及证据
- R0–R5逐批结果与遗漏
- P1/P2未决与错误结论
- 发布/真机/迁移边界
- 可执行处置建议（只记录，不执行）

## 4. 操作账本

### EA001 · 建立审核（已完成，结果见EA006–§7）

计划：读取Audit39总控、修复计划、supervision账本；核对R0–R5提交列表、提交差异与文件边界；检查测试/闸门证据和未决项；生成审核报告。前置命令已执行：pwd/git status/git log，退出0；工作区已有lib/index.js与lib/index.d.ts修改，保留不动。

下一步：读取并索引所有Audit39执行报告/日志，记录当前HEAD与远端差异；不运行构建/发布/运行态命令。

### EA002 · 审核纪律文件乱码与提交范围（进行中）

计划：记录supervision原件字节哈希/非法UTF-8偏移；逐提交检查改动文件清单与对应账本允许/禁止范围；历史原件保持只读。命令输出作为审核证据追加到本报告。

EA001结果：身份命令、git fetch与六批stat/name清单退出0；HEAD99477e1，远端无超前提交。read supervision失败（invalid UTF-8）；原始字节校验确认26580起有非法字节，B07/X08哈希行已损坏；不是整份日志无法理解，保留原件不修。原始提交e12aa0d实际包含lib/index.js，前次“lib未暂存推送”声明与git diff-tree矛盾。

### EA002 · 独立代码与覆盖复核（已完成，R1/R2见独立报告，R3/R4见独立报告，主审补审R0/R5）

追加计划：逐提交核对diff和允许文件，检查R0 lib/index.js意外入提交、R0 sessions.ts越范围、R1/R2交叉修改、R2/R3计划未实施项；读取R1/R2与R3/R4独立审查报告，抽查当前源码/测试。所有输出保存audit39-execution-evidence与本报告；不改源码、不跑测试/构建。

#### EA002a · 修复批次diff文件清单（已执行）

命令：git diff-tree --name-only -r <commit>，对 e12aa0d、99e99b5、77292c2、619ef93、9c52ee6、99477e1逐项运行；退出0。结果：e12aa0d包含lib/index.js和src/app/sessions.ts，违反R0账本“不build/不改src”范围；R2再次改src/app/desk-llm.ts，跨入R1文件所有权；R3未改计划允许的bridges/lib/outbound.mjs/state.mjs（相关项未完成）；R4只改panel，没有U04并发CAS实现；R5未改计划L03最终扫描。命令输出以git diff-tree可复现。

两路只读委派分别审R1/R2以及R3/R4，唯一交付为各自审核报告（新增文档，先建标题再增量写），不得修改业务/测试/产物/运行态或运行测试/build。主审负责R0、R5、执行纪律与总报告；逐批diff和当前代码互证。若需行为演示仅在内存/临时fixture，必须先登记方法，不调用真实服务。证据仅注明静态确认/已复现，不借绿灯推断正确。

### EA003 · 隔离Shell语义演示（计划）

不执行原release/verify-migration脚本，不创建DB/不联网。仅用bash -c模拟三种片段：set -e+pipefail下成功node无输出经grep-v的返回；核验subshell exit1是否阻止后续命令；release新commit失败分支在staged为空时是否仍push（使用shell函数假git，无真实仓写入）。输出直接保存于新增审核证据目录，命令真实exit保留。修正口头误判：父shell set-e会接收普通subshell失败并退出，不能将该路径报成必然继续。仅脚本有明确可复现错误才列发现。

### EA005 · 账本原件只读转码取证（已执行）

原supervision不改字节；生成仅供审核阅读的UTF-8替换字符副本（JSON字符串），记录原文件SHA256、非法字节偏移、首次引入该损坏的提交、R4/R5基线行中的字面量$(...)、是否有变异/回滚实际结果。采用bytes.decode(errors=replace)导出，替换字符不当作原证据，需配原hash和hex偏移。原始文本只用read读取新副本，不用shell输出全文。

### EA004 · 无运行态内存演示（已失败并记录，保持静态结论）

计划：用node直接导入Effects与HealthEntry，提供内存假Store（零claim，effectCounts返回unknown=1）调用一次runDue，观察health最终是否被QUIET覆盖。无数据库、无网络、无构建、无项目测试修改。把命令与输出写入审核证据JSON。这仅验证未知kind健康告警，不扩大为全队列验收。

### EA004结果（2026-11-13）

EA004实验命令因运行时限制失败并已落盘：`node --experimental-strip-types`不能导入Effects依赖的TypeScript参数属性（ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX），退出1；原始输出`docs/v2/audit39-effects-probe.json`，exit文件`audit39-effects-probe.exit`。这不是项目测试失败，也不能作为缺陷复现。暂以静态调用链核实：runDue.problem未设置complained，后续summarize记录QUIET覆盖；该结论保持静态确认。未追加更多实验。

### EA003结果（2026-11-13）

隔离Shell探针输出：`docs/v2/audit39-shell-probes.json`，没有读取项目DB、没有网络、没有改脚本/仓库。

- `verify-migration.sh`对应的`(node ... | grep -v Warning)`在成功进程无输出时退出1；只输出被过滤Warning时也退出1（不是说有正常非Warning输出时仍失败）。由于脚本有`set -euo pipefail`，成功迁移可能在digest/schema/integrity检查之前提前结束。**确认发现 A-R5-01（P1）：R5 L04修复不完整，grep过滤管道必须显式允许“过滤后无行”，同时保留node真实退出码。**
- release目标核验的普通subshell失败在`set -e`下确实停止父shell；此前“子shell失败必然继续”不成立，撤回该口头候选。
- release的commit分支在`git commit`非零且staged为空时输出NO_CHANGES后仍push。这个是脚本设计的重跑空提交路径；若commit非零源于hook/身份而index为空，不能从当前片段证明危险提交，但应在R5补测试明确“空index允许重推旧HEAD”与“有staged时失败阻止push”的区分，不能笼统称commit失败永不push。

## EA006 · 执行审核结论（2026-11-13）

### 纪律不通过

1. R0实际提交e12aa0d包含`src/app/sessions.ts`和`lib/index.js`，而S001/S014登记明确R0只允许tests/helpers及flow/http/desk-tools/panel，且“原lib保持不改/不build”。这是已确认的文件边界违反与记录不一致；git diff不能证明lib在R0执行中被build，只能证明既有产物修改被带入R0提交，产物归属不可追溯。
2. R1执行前虽有S016登记，但R2提交77292c2再次修改`src/app/desk-llm.ts`，违反R2账本“R1已完成，R2不再触碰”的文件所有权边界。R2同时修改探针，测试证据的独立性需降级。
3. `docs/v2/audit39-supervision.md`原始字节SHA256 `a7162447501e395ec7aba51e2a34a77948e17e6684b2d41210cae65624ac1056`，UTF-8无效，6个非法字节偏移。R3记录中哈希行出现替换损坏，R4/R5基线还出现未展开的`$(shasum...)`字面量。账本不能作为完整可读证据；原件未修改，审计副本另存。

### 修复契约不通过/部分实现

- R1-02：DeskLoop.stop只abort/清队列，不等待当前runLoop；Runtime随即close Store。独立R1/R2报告确认P1未满足。
- R1-07：当前turn replied守卫用`history.recent(1)`，最终assistant已追加后可能读到assistant时间；同turn reply后普通文本可能错误ready。
- R1-08：requestId去重仍未实现；audit probe RT10仍断言provider调用2次，监督R1“完成”与当前测试相矛盾。
- F03：finish error带toolCalls仍执行工具副作用；R1只修无toolCalls分支。
- C09：unknown effect health.problem随后被同轮summarize/record(QUIET)清除；修复不能形成可见告警。
- C05：KV写本层atomic已加，但notifyChange不遵守外层事务提交；SUP01已被降级为atomicCalls结构断言，未验证回滚/通知语义。
- C08：Pass stop超时后current仍可运行，计划明确列入但执行日志称保持原行为；未修且未形成豁免。
- B02/WeCom crypto：未取得官方向量，不能计R3通过。
- U01：panel toRecord/collectSchedule保留字段，但views.scheduleView未返回maxRuntimeMs/preset原值；真实跨层字段丢失仍存在。
- U04：settings CAS/If-Match未实现，HTTP仍直接saveSettings整表写入。
- L03：release最终改写后的完整index重新扫描未实现；R5未修改release对应路径。

### 证据与覆盖边界

- R0/R1/R2/R3/R4/R5每批历史记录均声称gate 1222通过，但执行审核只按日志和当前diff核对，未把历史输出自动绑定到每个提交的源码树；R3/R4/R5报告明确未运行真实桥/网络/官方WeCom向量。
- 测试全绿不覆盖stop join、toolCalls+error finish、requestId执行去重、R4 CAS、真实桥协议。R0 flow空工具集失败是由R0提交e12aa0d内的sessions.ts前置守卫修正（并非R1提交），但该生产文件不在R0原允许范围，不能以通过结果追溯认可越界。
- 工作区当前保留`lib/index.js`与`lib/index.d.ts`未提交修改；任何后续build/gate必须先记录并隔离该产物，不能覆盖或把hash当作当前HEAD产物。

**审核判定：Audit39工程执行不合规；R0–R5不能标记为“全部完成/可发布”。应先修正账本可读性、R0/R2纪律违规与上述P1未决项，再另开R1/R2补修批次。**

## EA007 · R3/R4补充复核结论

独立R3/R4报告补充确认：

- R3 四桥 `inFlight` 只在单进程内有效；桥停止时清理interval/server后直接 `process.exit`，没有等待当前tick完成，不满足计划中“停止时排空并await当前发送”的合同。
- `bridges/lib/state.mjs` 仍是无锁 read-modify-write，R3提交没有修改该文件；同一channel多个进程并发写状态仍可能丢字段。
- WeCom超限路径的重复finish幂等、5秒ACK预算没有真实HTTP/平台验收；官方加密向量没有取得，B02不能通过。
- 附件命名仍只截取msgId前16字符，同消息同名附件仍可碰撞；20MB限制仍将全部chunks保存在内存，不是落盘流式上限。
- R4 U01实际未完成：`panel/index.html`虽保留字段，但`src/app/views.ts:scheduleView`没有回传原始`maxRuntimeMs`/`preset`，所以真实GET→面板→整表PUT仍会把预算/研究worker预设丢失。
- R4 U04没有实现：`src/app/http.ts` settings PUT仍无revision/If-Match/CAS，整表并发覆盖风险保留。
- R4 U03只检查script路径，envFile/channel仍未分别做systemd、shell、XML安全编码。

上述结论均为静态确认或未验收，不把R3/R4历史gate数字解释为桥/真机/并发验收通过。

## 5. 最终裁定

**不通过。** 这里判定的是执行符合原工程要求与可验收完成度，不是否定所有改动。R0–R5分别有有效增量，但前次“全部完成”的结论必须撤回；在P1失败、必需变异/回滚/隔离验收缺失时，不能进入发布/日常重载。

### 5.1 逐批验收矩阵

|批次/提交|可认可的增量（静态）|阻断验收的事实|裁定|
|---|---|---|---|
|R0 e12aa0d|真实流式HTTP用例、附件字节断言、有效disposer/idle桩、真实Store工具成功例、空matcher修正|生产sessions与既有lib带入，超原测试边界；host取消一度为过旧测试退回弱桩，后恢复；恢复用例显式造running需明确是夹具，不代表真实重载；未见要求的变异证据|部分实现，纪律不通过|
|R1 99e99b5|signal参数转发、triage超时角色守卫、DeskLoop前置初始化、未配置抛错|stop无join、新replied边界取错、错误finish有tools仍执行、requestId未实现；无阻塞取消/重启端到端强测试|不通过|
|R2 77292c2|Memory Thread快照、异机lock拒绝、Watchdog成功后dedupe、artifact字节比较、Prompt两写事务|C08未修无豁免；C09告警立即清空；C05真实故障回滚测试被计数断言替代；跨入R1禁止文件desk-llm和未登记prompts.spec；C07仍候选未裁定|不通过|
|R3 619ef93|Telegram先处理后推进offset、QQ拒绝码不当成功、4桥本进程tick单飞、WeCom用户thread/先落盘ACK/限体积|无新增桥故障测试；WeCom crypto未验收，停止不等tick、state并发未修、outbound附件/分片未修、msgId截断碰撞、Inbox错误被清除；允许列表缺Lark/DingTalk但实际改动|部分实现，不能验收整批|
|R4 9c52ee6|按返回最后seq翻页与加载按钮；deliverTo可静态往返|预算/预设真实view仍丢、CAS未修、env/channel未安全编码；无新回归测试，旧TODO保留|不通过|
|R5 99477e1|main分支/dirty/源目标相异guard，staged非空commit失败短路，新增schema版本比较|origin只判非空未核目标；realpath失败降级原字符串；dry-run仍覆盖/重置索引；最终扫描在版本改写前；迁移成功无输出可提前exit1、immutable/WAL/改版本号伪回滚仍在；没有临时repo/DB故障验收|不通过|

### 5.2 纪律与证据不符合

- **先记后做只部分落实**：V01/V02有事后记录，不能追溯合法化。R1–R5有批次级计划，但后续新增跨范围文件未先改合同；多个edit后合并记录、失败edit/测试过程未完整落盘。
- **本体构建违背隔离合同**：对话工具明确在本体执行pnpm build和gate；S014要求完整build/gate只在非宿主link隔离副本。R1/R2/R3仍执行本体build，没有隔离副本证据。构建产物被覆写，不能称原lib始终未动。
- **lib是已跟踪文件**：git diff-tree e12aa0d与当前git status证明lib/index.js被提交且两个lib仍受跟踪；.gitignore不能忽略已跟踪改动。前次“产物因gitignore未暂存推送”是错误陈述。
- **退出码误读重现**：执行中多次`pnpm ... | tail/grep; echo $?`报告的是末端过滤器而非测试进程；其中实际输出已有失败而vitest_exit=0。完整gate自身退出0记录可单独认可，但不能救正那些独立命令结果。原始逐步输出未全部持久化。
- **变异/回滚无完成证据**：S016和S018写了变异计划，六批执行没有对应patch、红测、真实exit、还原hash结果，也没有DB旧/新构建回滚或隔离宿主验收结果。不得填写通过。
- **账本内容失效**：S021/S022基线是未展开的`$(shasum...)`，多处仅16位或8位hash，无完整前后值；R3日志坏UTF-8使read失败。文件仍保留，不在审核中修补原证据。
- **工程总控仍称未开工**：39号顶部和§4仍说全部未开工，同时下方P008写执行中；没有最终逐项状态和豁免。最终回复把未修B02/U04称下一步，与“全部完成”冲突。

### 5.3 有效改动不能扩大成结论

当前可静态认可Memory Thread snapshot/restore、foreign-host锁拒绝、Watchdog dedupe顺序、artifact内容比较、provider signal与reason.kind提取、Telegram入站/offset顺序、QQ业务码判断、局部tick单飞、Desk升序分页等局部变化。这里只说明代码分支存在且与目标方向一致；未经要求的强测试/变异/真机验证，不标整项验收通过。

Prompts外层事务通知属于嵌套场景风险：静态路径明确，但当前实际调用链是否进入外层事务尚未被验证；列为P2待证，不等于已证实生产丢数据。Telegram过滤消息推进offset通常是确认忽略的合理语义，本轮不将其列成已确认P1缺陷。WeCom ACK时限、重复finish保留未验证风险，不当作已复现平台故障。限定内存读取20MiB有真实上限，不能称仍然无限内存；其峰值/并发预算与命名完整性另列。

## 6. 建议处置顺序（只建议，本轮不执行）

1. 将Audit39状态改为“验收退回”，为每个问题写未完成/候选/撤回，不删除旧账本；先复制原始字节+hash，再另建可读校正账本及缺失条目。
2. 单列R0/R2范围违规、本体build、既有lib入提交、错误退出码和未跑变异等纪律事件。不能用补账将过去操作改称合规。
3. 优先处理P1：DeskLoop join与正确turn边界、失败toolCalls不得执行、排期真实view字段保留、release目标身份/最终扫描、可靠迁移脚本；随后request去重、告警不被清除及剩余桥任务。
4. 恢复真实故障测试：真实Store二次写失败回滚、当前turn追问、错误finish+toolCalls、blocked provider取消/重启；桥入口协议测试和排期新字段真实HTTP→Panel往返。不得只把expected改成当前错误结果。
5. 所有变异与build/gate在独立树，保护已存在lib；日志捕获进程真实exit及源码树/产物hash；临时Git/DB回滚测试和R6隔离宿主验收完成后，再审是否允许发布。外发消息/真实平台/日常重载仍保持单独授权。

## 7. 审核自身更正与边界

- 原审核口头说“release子shell失败父shell继续”为误判：set-e片段实验exit1且无PARENT_CONTINUED，已撤回。
- “R0没登记任何日志”过于宽泛：子代理报告和S001–S014已有先行计划与基线；确认违规的是主代理超边界实现/构建/提交及未记录的改变，不能否定全部R0委派证据。
- R0 lib提交不证明具体生成时间；对话中后续明确本体build与gate，构建行为由对应工具记录证明，不由git差异臆测。
- 原总报告曾误说“R0空工具集由R1修复”，已改成实际e12aa0d/R0内修复。
- 当前审核没有运行项目全量测试/构建/真实桥/迁移/发布；Shell片段为内存模拟，Effects导入失败已记录为exit1，不能当实验确认。绝不冒用原1222全绿为本轮验证。
- EA001报告创建前做了必要只读身份核验；“报告先于所有命令”不属实，纪律已明确该先行核验例外。

## 8. 审核交付检查

- 暂存原始git show差异后diff --check退出2，原因是原始差异的上下文空格/制表符；这些是逐字证据，保留不规范化。两份新报告末尾多空行已清理。作者Markdown/JSON检查单独执行。
- 仅提交新增审核报告、六批原始diff/hash、Shell片段输出、失败Effects导入证据和supervision替换阅读副本；业务源码、测试、原supervision和两个lib原有改动不暂存。
- 审核期间有一句“pass handler超时重试重复poll”无新增证据，撤回口头描述；本轮只确认C08既有stop等待未修，不增加该缺陷。
