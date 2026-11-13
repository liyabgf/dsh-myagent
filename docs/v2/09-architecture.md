# V2 架构

> **当前结构说明（2026-11-13）**：本文旧行号及旧生命周期描述属于历史记录。当前结构包括五类 Source、Thread/Subscription、DeskLoop 与 DSH Session 两种分诊路由、持久化消费回执，以及真实 drain 后再关闭数据库的停机流程。最新代码/验证状态见 [`44-current-status-and-preview.md`](44-current-status-and-preview.md) 和 [`43-reliability-repair-results.md`](43-reliability-repair-results.md)。

这份文档只描述**代码里已经存在的东西**。每条断言后面跟着 `file:line`；核实不了的地方写「未核实」，并说明核实它需要什么。
行号截至 **2026-11-04 07:22（Asia/Shanghai）** 的工作副本；`pnpm typecheck` 退出码 0。构建产物 `lib/index.js` 是钉住的，本文没有重建它。
**注意**：这棵树正被并行编辑。写作期间 `src/sources/rule.ts` 就被改过一次（07:17），本文的 rule.ts 行号已按改后的版本重新核对；其余源文件在同一窗口内未变动。

> **⚠️ 行号已陈旧（2026-11-11 标注）**：本文 §1–§6 的 `file:line` 引用**全部**早于 W1–W39 重构
> （Thread/Subscription 进气、triage 双层、总管工具面、同 Work 只读、目录级产物登记）。
> 那些行号现在会指向错的位置，**不要**拿它们当索引用；组件职责与不变量的描述仍然成立。
> 重构带来的结构性变化写在下面 **§7**，它是本文当前唯一按现行代码校对过的一节。
> 已修正的事实性错误：§5.2（预算天花板）、§6 的 D4 与 D11 两行。

---

## 0. 一句话

myagent 是一个**只有一个写入者的领域内核**，外面套一层**把所有外部动作都排进持久队列**的运行时。
`src/core/` 是纯计算，`src/app/` 才碰 DSH、文件系统和 SQLite，`src/sources/` 只负责产出 Trigger。
这份架构不是设计出来的美学，是 `docs/v2/00-audit-and-plan.md` 里 D1–D11 那十一个决定和 S1–S37 那批事故逼出来的（§6 是逐条对照）。

## 1. 组件与依赖方向

### 1.1 图

```
DSH 宿主（cordis Context）：agents / sessionController / webServer / subprocess / permissionPresets
      ▲ inject（index.ts:16-19）              ▲ L2 的全部 IO 都经它

┌─ L4 入口 ──────────────────────────────────────────────────────────────
│ src/index.ts:31 apply()      挂载；停机只挂一个 ctx.effect(:40)，不碰 Session
└─► L3
┌─ L3 组合根 ────────────────────────────────────────────────────────────
│ src/app/runtime.ts:211 Runtime    唯一同时认识全部零件的地方（:1-8）
│   造：lock(:246) → Store(:255) → Effects(:271) → Executor(:280) → Sessions(:289)
│       → Delivery(:310) → Engine(:315) → Passes(:325) → Sources(:330)
│       → Watchdog(:331) → HTTP(:332)
│   停：反序，每步有界且被包住（stop()，:667-701）
└─► L2（生产代码里唯一一处 new Engine 也在这一层：runtime.ts:315）
┌─ L2 适配器：碰 DSH / 文件系统 / 网络 / 时钟 ─────────────────────────────
│ sources/registry.ts:19        四个 Source 的生命周期（按设置签名重建）
│ sources/{cron,inbox,session,rule}.ts   产 Trigger
│ app/http.ts:455               面板 API（同源围栏 :121）
│ app/passes.ts:21              泵，2s 一轮（runtime.ts:52）
│ app/effects.ts:49             持久队列：trigger / launch / input / notify
│ app/executor.ts:78            launch、input 两个处理器
│ app/delivery.ts:132           notify 处理器（RESULT.md + 前台 + 桌面）
│ app/sessions.ts:157           worker 与前台两类 Session
│ app/agent-delivery.ts:37      幂等投递
│ app/store.ts:437              SQLite：8 个仓库 + Transaction + effects 表
│ app/watchdog.ts:52            探测（不动状态）  app/health.ts:24 每部件一行
│ app/lock.ts:64 单写者锁   app/prompts.ts   app/files.ts   app/background.ts
│ app/tools.ts:83/:155          worker 3 个工具、前台 7 个工具
└─► L1（只通过 Engine 的公开命令；反向只有端口注入）
┌─ L1 领域：纯计算，不做 IO ───────────────────────────────────────────────
│ core/engine.ts:176 Engine —— 唯一的领域写入者
│ core/policy.ts:285 门禁   core/model.ts 形状   core/timing.ts 排期
│ core/ids.ts:11 key()      core/errors.ts       core/memory.ts:104 Memory
└────────────────────────────────────────────────────────────────────────
```

**每条依赖边的方向**：

- L4 → L3：`new Runtime`（index.ts:34），全仓唯一一处。
- L3 → L2 与 L1：构造与注入。停机顺序是构造的反序（runtime.ts:684-700）。
- L2 → L1：`sources`、`http`、`tools`、`watchdog` 只调 Engine 的公开命令，且各自只拿到一个窄端口——`SourceHost`（kind.ts:29-48）、`HttpHost`（http.ts:37-70）、`ToolsHost`（tools.ts:48-60）、`WatchdogHost`（watchdog.ts:24-50）。
- L1 → L2：**只有四条端口**，全部由 L3 注入（`EngineOptions`，engine.ts:142-151）：`repos`+`tx` → Store（runtime.ts:316）、`executor` → DshExecutor、`delivery` → OutcomeDelivery、`emit` → `Runtime.onEvent`（runtime.ts:319）。而 `executor.start/deliver/stop` 与 `delivery.report` 自己不做 IO，只 `effects.enqueue`（executor.ts:101、:107；delivery.ts:147），所以 L1 触发的外部动作一律先进队列。`emit` 还被包了一层 `afterCommit`（engine.ts:196-197），见 §3.3。
- L2 内部（运行时的那条主链）：`Passes.pass` → `Effects.runDue` → 四个处理器 → `Sessions` → `AgentDelivery` → DSH Agent。
- 唯一的环在**类型层**：`src/sources/*` 以 `import type` 引 `app/effects.ts` 与 `app/health.ts`，而 `app/runtime.ts` 以值引 `src/sources/*`。运行时无环（§4.1 有 grep 证据）。

### 1.2 每个组件一句话

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| `apply` | index.ts:31 | 挂载；起不来就记日志、标不健康、**不打扰宿主** |
| `Runtime` | runtime.ts:211 | 组合根：唯一知道全部零件的地方；也负责事件多路复用与启动恢复 |
| `Engine` | core/engine.ts:176 | 领域命令的唯一入口与唯一写入者，全部同步 |
| `gate` / `settingsPolicy` | core/policy.ts:285/:335 | Trigger + 设置 → allow/observe/deny 的**纯函数** |
| `Store` | app/store.ts:437 | SQLite、8 个仓库、事务边界、effects 表、schema 阶梯（:492） |
| `Memory` | core/memory.ts:104 | `Repositories`+`Transaction` 的第二份实现，给领域测试 |
| `Effects` | app/effects.ts:49 | 持久副作用队列：`(kind,key)` 幂等、退避、`Later` 延后 |
| `Passes` | app/passes.ts:21 | 泵：一轮只跑一个，期间被要求的再补一轮 |
| `DshExecutor` | app/executor.ts:78 | 把 Assignment 变成一个 worker Session；`launch`/`input` 的处理器 |
| `OutcomeDelivery` | app/delivery.ts:132 | 把值得说的 Report 送到 RESULT.md、前台 Session、桌面 |
| `Sessions` | app/sessions.ts:157 | 两类 Session 的创建/恢复/授权/装饰；工具清单与 restrict |
| `AgentDelivery` | app/agent-delivery.ts:37 | 按 `requestId` 派生的 MessageId 至多投递一次 |
| `SourceRegistry` | sources/registry.ts:19 | 按设置的签名重建 Source；一次只 sync 一个 |
| 四个 Source | cron/inbox/session/rule.ts | 产 Trigger。cron 按排期、inbox 按目录、rule 按 `ticket.ended`、session 只有状态 |
| `Watchdog` | app/watchdog.ts:52 | 判断"卡住了没有"；动作全是别人已经会做的 |
| `HealthBoard` | app/health.ts:24 | 每个会坏的部件一行；健康时不占地方 |
| `registerHttp` | app/http.ts:455 | 面板与其 JSON API，挂在宿主的 web server 前缀下 |
| `takeLock` | app/lock.ts:64 | 一个状态目录一个写者（OS 文件锁） |

## 2. 一次请求的端到端路径（inbox）

选 inbox 是因为它是唯一一条线上验证过的路径（`docs/v2/02-live-acceptance-v2.md`）。

1. 操作者把 `foo.md` 丢进 inbox 目录。
2. `InboxSource.pollOnce()`（inbox.ts:150）。扫描闩 `while (this.scanning !== undefined) await this.scanning`（:154）：面板的"立刻看一眼"和定时器扫描不会同时读目录。
3. `InboxSource.scan()`（:185）：`mkdir`（:187）、`readdirSafe`（:190）、跳过非 `.md` 与隐藏文件（:192）、`stat`（:195）。
4. **产出门禁**：`sourcePolicy('inbox', settings)`（:200）。paused 或 deny → `continue`（:201），文件**原地不动**、不产 Trigger（这是 D2；理由写在 :197-199）。
5. 两道前置检查：静置窗口 `now - mtimeMs < SETTLE_MS`（:202，1000ms，:19）把还在写的文件留给下一轮；大小上限 `size > MAX_BYTES`（:203，512KB，:21）直接归档进 `rejected/`。
6. `frontMatter(text, name)`（:211，实现 :40）取 `title/scope/attachments`；格式坏了就当全是正文。
7. 造 Trigger：`id = key('inbox', name, mtimeMs, size)`（:214），`actor = {id:'operator', kind:'person'}`（:217）。
8. `host.engine.receive(trigger)`（:225）→ `Engine.receive`（engine.ts:209）。
9. 幂等短路：`repos.triggers.get(id)` 命中就返回 `duplicate`（engine.ts:210-213），**不建第二张 Ticket**。
10. `tx.atomic(...)`（engine.ts:214）一个事务里：`policy.gate(trigger)`（:217）→ 通过则造 Mandate（:231）、`ticketId = key('ticket', trigger.id)`（:235）、`assignment = key('assignment', ticketId, 1)`（:236）、Work 归类（:240-244）、`executor.prepare()` 填目录名（:245，实现 executor.ts:94-97）、`tickets.save`（:256）、Decision（:257-261）、Trigger+disposition（:262-263）、`record('created')` 写 events 表（:265）、`emit` 两个事件（:264、:273）、`afterCommit(() => executor.start(...))`（:275）。
11. 提交后 `Store.atomic` 跑 deferred（store.ts:540-549）→ `DshExecutor.start`（executor.ts:100）→ `effects.enqueue('launch', key('launch', ticketId, assignmentId), …)`（:101）→ `Store.enqueueEffect` 写 `effects` 表（store.ts:587）。
12. 归档：`take(path, …, 'accepted', 'Ticket <id>', trigger.id)`（inbox.ts:230 → :256）。**先 `unlink` 原件再写副本**（:264-271），归档名 `<triggerId>-<原名>`（`uniqueName`，:79）。然后 `host.requestPass()`（:244）。
13. `Passes.requestPass()`（passes.ts:44）→ `pass()`（:50）→ `Effects.runDue()`（effects.ts:83）→ `Store.claimEffects('launch', 50)`（store.ts:594）把行标 running。
14. `DshExecutor.launch(payload)`（executor.ts:214）按顺序判定：Ticket 已结束或尝试已被替换 → 直接结算（:218-220）；正在 halt / 全局 paused → `Later`（:221-223）；`engine.blockedBy()` 非空 → `Later(5s)`（:227）；`used() >= maxWorkers` → `Later(2s)`（:228）；然后 `starting.set`（:229）占槽。
15. `prepareDirectory`（:262）：`mkdir` + `copyAttachments`（:286）+ 跑一次 `settings.executor.prepare`（:267-274，经 DSH `subprocess`，:300）。prepare 失败**不重试**（:243-252）。
16. `Sessions.ensure(ticket, model)`（executor.ts:235 → sessions.ts:237）：`sessionController.create({sessionId:'worker-<ticketId>', cwd:目录, agentPreset:'myagent-worker'})`（:244）；DSH 可能回答另一个 id，于是 `bindSession`（:247 → runtime.ts:296-299 → `Engine.bindSession`，engine.ts:804）。
17. `authorize`（sessions.ts:291）设 `danger-full-access`（:27、:293）；`decorate`（:313）注入提示词段（:325）、`restrict` 到 `WORKER_TOOLS`（:348）、装"Ticket 已结束就拒绝"的 guard（:332）、注册三个 myagent 工具（:336）。
18. `engine.assignmentStarted`（executor.ts:236 → engine.ts:463）pending→running，写 `launched` 事件。
19. `Sessions.promptWorker(ticket, 'launch:<assignmentId>', taskText(ticket), model)`（executor.ts:237 → sessions.ts:438）→ `AgentDelivery.send(agent, requestId, text, 'queue')`（agent-delivery.ts:94）。`MessageId('myagent:'+requestId)`（:23）保证重试不重复投递。随后 `engine.inputsDelivered`（executor.ts:240 → engine.ts:475）。
20. worker 干活，调 `myagent_report`（tools.ts:86）→ `Engine.report(ticketId, …, host.attempt(ticketId))`（tools.ts:99-102）→ `recordReport`（engine.ts:616）：报告只能落在**它所属的那个正在跑的尝试**上（:627-634），否则 `assignment_stale`；`ready` 结束 Ticket（:642-649）；登记 artifacts（:665-668）；`record('report')`（:663）；`afterCommit` 里 `delivery.report(next, recorded)`（:682-683）。
21. `OutcomeDelivery.report`（delivery.ts:145）：只有 `ready/blocked/failed/dropped` 才告知（`TOLD`，:24、:146）→ `effects.enqueue('notify', key('notify', ticketId, report.at, state), …)`（:147）。
22. 下一轮 pass 里 `OutcomeDelivery.notify`（:162）：结束态写 `RESULT.md` 到 Ticket 目录（:170-173，文本 `resultDocument` :76）；`relayText`（:175，实现 :59）；`blocked` → `Sessions.relay`（:178 → sessions.ts:410）**唤醒前台**，其余 → `Sessions.notify`（:179 → :398）只留痕不唤醒。
23. 两条都先 `ensureMaster(masterDir())`（sessions.ts:402、:414 → :204）：前台 Session 不存在就按需创建，绝不静默放弃（理由写在 :399-401）。最后 `AgentDelivery.send(…, {inject: 前 120 字} 或 'queue')`（:403、:415）。
24. `settings.notify.enabled` 时发桌面通知（delivery.ts:180-189 → `machineNotification` :201），有 `terminal-notifier` 就带 `-open` 面板深链（:217-218）。随后 `notify` effect 结算，`Store.settleEffect` 删行（effects.ts:111 → store.ts:607）。**请求到达操作者的前台。**

## 3. 不变量

### 3.1 一个 Engine，一个写入者

**强制它的代码**：生产代码里 `new Engine` 只有一处（runtime.ts:315；其余五处全在 `tests/`）。领域仓库的写方法——`tickets.save`、`triggers.save`、`decisions.save`、`events.append`、`artifacts.save`、`dependencies.save`、`projects.save`、`works.save`——在 `src/app/**` 与 `src/sources/**` 里的调用点是 **0**（grep 无命中；只有 `src/app/store.ts` 的实现、`src/core/engine.ts` 与 `src/core/memory.ts` 的调用）。

**边界要说准**：KV 不在其中。`store.set(KV.mainSession, …)`（runtime.ts:293）、Source cursor（runtime.ts:455）、`store.saveSettings`（runtime.ts:480）、`prompts.ts:106-107` 都是绕过 Engine 的直接写。它们写的是部署自己的配置与读位置，不是领域聚合。

**违反会怎样**：两个写入者会让同一张 Ticket 的两个并发 Assignment 撞 `key('assignment', ticketId, 序号)`，并让 `report` 的 `assignment_stale` 判定失效（engine.ts:627-634）——一个已经被替换掉的 turn 就能结束一张 Ticket。这是 S11。

### 3.2 `src/core/` 不做 IO

**我实际跑的 grep 与它的结果**（不是断言）：

- `src/core/*.ts` 的**全部**外部 import 只有两条：`node:crypto`（ids.ts:2）与 `zod`（policy.ts:8），其余都是 `./` 同层。没有 `node:fs`/`net`/`http`/`child_process`/`path`/`os`，也没有任何 `@deepseek-ai/*`。
- 搜 `readFile|writeFile|mkdir|readdir|unlink|statSync|fetch(|spawn|process.env|setTimeout|setInterval|console.|@deepseek-ai`：`src/core/` 里**零命中**。`createHash` 是 CPU 计算，不是 IO。
- 时钟是唯一的不纯点，而且被显式注入：`this.now = options.now ?? (() => new Date().toISOString())`（engine.ts:190）。`core/` 里另外 7 处 `new Date` 全在 `timing.ts`（排期算术）与 `memory.ts:176`（deferred 失败的时间戳）。
- 边界在代码里被明说了：`authorizeArtifactRead` 只授权与定位，"Core does no IO, so the caller resolves the path … and does the reading itself"（engine.ts:876-877）；真正读文件在 runtime.ts:364-398。

**违反会怎样**：领域测试就测不到领域了。`tests/engine.spec.ts` 的 `harness`（:37）用 `Memory`（:38）加假 Executor（:6）与假 Delivery（:28）跑完整的门禁、报告、级联、策略变更，靠的就是 core 不碰外部世界。core 里一旦出现 fs，这批断言要么变成慢的集成测试，要么开始依赖临时目录的状态——而 S5/S7 那一类"Memory 与 Store 语义不一致、套件却全绿"的缺陷正是从这种缝隙里长出来的。

### 3.3 领域事件在事务提交之后发布

**强制它的代码**：一处，在构造函数里包裹 `emit` —— `this.emit = event => this.tx.afterCommit(() => publish(event))`（engine.ts:196-197）。所以十二个 `emit` 调用点不需要各自记住这件事（这是 S8 的修法）。
`Store.atomic` 在最外层 `COMMIT` 之后、`depth` 已回到 0 时才跑 deferred（store.ts:540-549）；`afterCommit` 在 depth 0 时内联执行（:579-582），所以本来就在 `afterCommit` 里 `emit` 的三处（engine.ts:406-409、:682-690、:790-793）不会被二次延后。回滚时 `this.queue.length = mark`（store.ts:530）丢掉这一层登记的 deferred，`Memory` 结构同构（memory.ts:149）。

**注意事件与日志是两件事**：`record()`（engine.ts:824-829）在**事务内**往 `events` 表 append，这是 D5 要的"日志里不可能出现被回滚状态的事件"；`emit` 只是提交后的投影。

**违反会怎样**：监听器会在事务内跑。生产监听器 `Runtime.onEvent`（runtime.ts:803）会 `requestPass()`，pass 会 `claimEffects`（在一个 savepoint 里把行标 running，store.ts:601）并跑处理器——于是"为尚未提交的状态建目录、拷附件"，回滚之后这些动作留在盘上。这正是 S8。

**文档漂移（本次读代码发现，一处已在写作期间被别人修掉）**：`runtime.ts:804-806` 的注释仍说"八种事件里有六种是在发出它的那个事务内到达的，所以一个抛异常的监听器会回滚一次提交"——这与 engine.ts:196-197 直接矛盾，且未在缺陷目录里登记。同一句谎话原本也出现在 `sources/rule.ts` 的 `onEnded` docstring 里（N7，00-audit-and-plan.md:1071，标"已修"但当时只修了文件头）；写作期间 rule.ts 被改过，那句已修正为"Runs after the ending's transaction has committed, not inside it"（rule.ts:49-55）。**`runtime.ts:804-806` 仍然是错的。**

### 3.4 每个副作用都走持久队列，并且有执行与失败记录

**强制它的代码**：`Effects`（effects.ts:49），行存在 SQLite 的 `effects` 表（store.ts:64-73），身份是 `(kind, key)`，重复入队替换 pending 行（store.ts:587-590）。四种 kind、四个处理器：`trigger`（runtime.ts:324）、`launch` 与 `input`（executor.ts:87-88）、`notify`（delivery.ts:140）。泵是 `Passes`（passes.ts:21），2s 一轮（runtime.ts:52、:326），一轮只跑一个（:51），期间被要求的记在 `asked` 里、跑完补一轮（:44-48）。崩溃恢复：启动时 `Store.releaseRunning()` 把上一个进程标 running 的行放回来（store.ts:622-626，调用点 runtime.ts:779）。退避 15s→30s→60s…上限 15min（effects.ts:45-47、:61），`tries=5`（:62）。

**"有执行与失败记录"要说准，它不是均匀的**：

- 成功的行被**删除**（effects.ts:111 → store.ts:607-609），队列里没有"执行过"的历史。执行的历史在领域侧：`launched`/`report`/`interrupted`/`rescued` 等 events 行（engine.ts:824）。
- 彻底放弃时行也被删除（effects.ts:124），只留健康板一条问题（:125）加 `onPermanentFailure`（:126）。而 `onPermanentFailure` **只对 `launch` 与 `input`** 转成 Ticket 上的失败报告（runtime.ts:277 → executor.ts:117-127 → `engine.reportGaveUp`）。`notify` 与 `trigger` 放弃后只剩健康板一行，而下一次成功会把它擦掉（health.ts:17）。**未核实**：这两类放弃是否有别的持久痕迹——核实它需要一次故障注入（让 `notify` 处理器连抛 5 次）然后读库，本轮不允许跑构建与验收脚本。
- 三类副作用**刻意不走队列**：inbox 归档 `take()`（inbox.ts:256-275，Trigger 已入库，重排只会造成第二份副本，这是 S31）；停机 `halt()`（executor.ts:420-433，撤销授权排队重试等于让工作在授权消失后继续跑）；启动恢复 `recover()` 与 `writeMarker`（runtime.ts:769、:249，进程自己的状态而非领域事实）。

**违反会怎样**：不走队列 → 崩溃在"Ticket 已受理"与"worker 听到"之间就是一次**丢请求**（executor.ts 文件头 :4-7 就是这么写的）；没有 `(kind,key)` 幂等 → 一次重试就重复启动同一个 worker。

### 3.5 等待用 `Later` 表达，绝不用失败表达

**强制它的代码**：`Later`（effects.ts:12-17）。抛出或返回它都只调 `deferEffect`（effects.ts:107-109、:118-121 → store.ts:617-620），**只改 `dueAt`，不加 `failures`**。七个抛出点：正在 halt（executor.ts:221）、全局 paused（:223）、依赖未释放（:227）、worker 槽满（:228）、正在关闭（:234）、Ticket 等人时的非人类 Input（:395）、paused 时的 Input 投递（:397）。依赖等待的语义写在 `Engine.dependOn` 的注释里：等待在**决定启动的地方**强制，绝不靠结束任何东西（engine.ts:831-837）。释放靠 `releaseDependants` 重新入队同一个 key，把 `dueAt` 拉回现在（executor.ts:136-145，调用点 runtime.ts:818）。

**违反会怎样**：等待若走失败路径，`failures` 会 +1，5 次后永久放弃（effects.ts:123-128），对 `launch` 就是 `reportGaveUp` —— 一张**只是早到**的 Ticket 上出现一份没人要的 `failed` 报告，五次重试预算被烧光。effects.ts:114-117 的注释记了这次事故的原话：把延后算成失败"杀掉了只是在等待的 Ticket"。

### 3.6 身份键是它所标识事实的纯函数

**强制它的代码**：`key(...parts)` = sha256(JSON(parts)) 的前 32 位十六进制（ids.ts:11-13）。全部用法：

| 键 | 由什么算出来 | 位置 |
| --- | --- | --- |
| Trigger(inbox) | 文件名 + mtimeMs + size | inbox.ts:214 |
| Trigger(cron) | schedule.id + 那个槽的 ISO 时刻 | cron.ts:181 |
| Trigger(rule) | rule.id + ticket.id + ended.at | rule.ts:87 |
| Trigger(session) | 正文 + 标题 + at + 发起人 + 附件列表 | engine.ts:294 |
| Ticket / Decision | trigger.id | engine.ts:235 / :218 |
| Assignment | ticketId + 尝试序号 | engine.ts:236、:327、:440、:713 |
| `launch` / `input` effect | ticketId + assignmentId | executor.ts:101 / :107 |
| `notify` effect | ticketId + report.at + state | delivery.ts:147 |
| `trigger` effect | trigger.id | rule.ts:99 |
| 投递消息 | `myagent:<requestId>` | agent-delivery.ts:23 |
| inbox 归档名 | `<triggerId>-<原名>` | inbox.ts:79-81 |

**为什么**：幂等就是"同一个事实被看见两次只产生一份工作"。重启后 inbox 再扫到同一个文件（mtime 与 size 没变）→ 同一个 Trigger id → `receive` 的重复短路（engine.ts:210-213）。归档名用事件身份而不是时间戳，是 S31 的修法，理由写在 inbox.ts:71-78。

**例外要说准**：Assignment 的键**不是**纯函数，它带 `assignments.length + 1` 这个序号；`rule.ts:85-86` 的注释正是拿它当反例。这不是缺陷——它标识的事实里就包含"这是第几次尝试"。但它意味着两个并发 Assignment 会撞键（00-audit-and-plan.md:403-405），所以 P3 的顺序是先给 `report` 加 `assignmentId`。

**违反会怎样**：键里混进"何时被看见"→ 每次重启、每次扫描都重放（D10 说文件监听的最大陷阱就是这个：`key('watch', path, mtime, size)` 会每次 touch 都重放，包括 worker 自己往被监视的树里写文件，形成自激循环，00-audit:387-388）。键里少算事实 → 两个不同的请求折叠成一张 Ticket；`engine.ts:292-294` 把附件算进 session Trigger 的 id 就是为了防这个。

## 4. 分层规则与两个让它可测的端口

### 4.1 规则

四层（§1.1 的图），依赖只能向下。实测的边（grep 全部相对 import）：

- `src/core/*.ts` → 只有 `node:crypto`、`zod` 与自己同层。**0 条**指向 `../app` 或 `../sources`。
- `src/sources/*.ts` → `../core/*` 是**值**导入（cron.ts:8-9、inbox.ts:12-13、rule.ts:17-19）；`../app/*` **全部是 `import type`**（kind.ts:8-9、cron.ts:11、inbox.ts:15、rule.ts:20、session.ts:8），运行时不依赖 app。
- `src/app/runtime.ts` → `../sources/*` 是值导入（:20-27、:36）。这是唯一一条 app→sources 的运行时边，而它只出现在组合根里。

所以 app 与 sources 之间在**类型层**有一个环，在**运行时**没有。切断它的是端口而不是纪律：Source 拿到的不是 `Runtime`，是只有八个成员的 `SourceHost`（kind.ts:29-48）。`WatchdogHost`（watchdog.ts:24-50）同样窄，理由写在它的文件头：一个无人值守系统的恢复路径本身也无人值守，所以它的每一步都必须是"人已经见过它能工作的动作"——判断是它自己的，动作是别人的（:2-11，注入点 runtime.ts:401-431）。`ExecutorHost`（executor.ts:55-69）与 `HttpHost`（http.ts:37-70）宽，因为它们本来就是运行时的一部分。

**小漂移**：`HttpHost` 把 `sourceStatus()` 声明了两次，返回类型不同（http.ts:45 是 `Record<string, SourceStatus>`，:57 是 `Record<string, {lastTriggerAt?: string}>`）。`pnpm typecheck` 退出码 0；我用一个内存中的最小复现单独编译验证过，TS 对同一 interface 内同名方法签名类型不同**不产生诊断**（0 条）。实现返回宽的那个（runtime.ts:525-533），所以 :57 是死声明。

### 4.2 `Repositories`：Store 与 Memory 两份实现

`Repositories`（engine.ts:95-104）是八个仓库：triggers / tickets / decisions / artifacts / projects / works / events / dependencies。`Transaction`（engine.ts:107-111）是 `atomic` + `afterCommit`。Engine 只认这两个接口（:143-144）。

- 生产：`Store`（store.ts:437）。`node:sqlite` 的 `DatabaseSync`，WAL + `busy_timeout=5000`（:477-481），八个仓库类（:445-452），`atomic` 最外层 `BEGIN IMMEDIATE`、嵌套 `SAVEPOINT sN`（:515-551），schema 阶梯与"版本更高就拒绝打开"（:492-513）。
- 测试：`Memory`（core/memory.ts:104）。八个 Map 包装类（:11-101），`atomic` **每层都快照**、回滚时逐个 restore（:133-172），deferred 在 try 外逐个隔离执行（:168-170）。

`Memory` 住在 `core/` 而不是 `tests/`，因为它是**端口的第二份实现**、本身是被测对象，不是测试替身。

### 4.3 契约测试：同一批断言跑两遍

`tests/transaction.spec.ts`。它的文件头（:1-10）记了为什么必须有这个文件：两份实现曾经在**四处**不一致——快照深度、抛异常的 deferred 动作对已提交数据的影响、之后 `depth` 的值、嵌套回滚是否真的撤销——而**套件一直是绿的**，因为从来没有人要求两者回答同一个问题。V2 的级联取消依赖嵌套回滚，所以从那时起两者被钉在一个契约上：任何一边破坏约定会**失败两次**，每份实现一次。

- 被测面是 `Subject` 接口（transaction.spec.ts:19-25）：`atomic`、`afterCommit`、`triggers.save/list`、`artifacts`、`deferredFailures`。
- 两份实现在 `implementations` 数组里用同样的方式打开与销毁（:47-60），外面套一个 `for` 循环把它们各生成一份 `describe`（:62-63），所以 **7 个 case 跑成 14 条**，一个 case 对两边读起来完全一样。
- 另一层保真在 `tests/engine.spec.ts`：假 Executor 会**真的回调** `engine.assignmentStarted`（:23），理由写在 :47-48——真 Executor 就是这么做的（executor.ts:236）。不回调的假件会让所有报告测试都在一个生产从不进入的状态里断言。

## 5. 刻意不在架构里的东西

### 5.1 worker 没有沙箱

`WORKER_PERMISSION = 'danger-full-access'`（sessions.ts:27），在 `authorize()` 里设下去（:291-295）。这是刻意的，理由写在 :286-290：无人值守的 worker 必须能在没人可问的情况下工作，所以边界不是"每次调用都批准"，而是**工具清单**（`WORKER_TOOLS`，:34-38，由 `restrict` 强制，:348-379）**+ 它自己的目录 + 它的 Ticket 何时结束**（:332-334）。

后果见 `docs/v2/06-security-risk-register.md` §1：worker 的 shell 能做运行它的那个用户能做的一切；Ticket 的 `scope` 是提示词约束，不是控制。所以 §1.1 图里那些守卫——`resolveInside`（files.ts:53）、`artifactPath`（engine.ts:1001）、同源围栏（http.ts:121）——**只防意外，不防恶意**。把它们画成安全边界正是这份架构拒绝做的事。

DSH 的 `approval:'ask'` 不是替代品：配上无人值守 worker，turn 会以 blocked 结束，而现有代码把 blocked 判定成"不可运行的 Session"并记成 `failed`（runtime.ts:741-750），于是每次重试都以同样方式结束（00-audit:350-351 记了这条张力）。要真隔离得改部署层——受限用户、容器、只读挂载——不是在 myagent 代码里加一个检查。

### 5.2 没有**token** 预算天花板（墙钟预算已有）

真实 token 计量**已经有了**：`usageOf`（runtime.ts:134-154）从 DSH 的 `assistant/message.data.usage` 求和，三个桶互斥相加，并用 `windowed` 标明这个和覆盖的是整个 Session 还是最近 `PROGRESS_SCAN=400` 条事件（:157、:152）。这是 D4 的口径要求：只用 token，绝不用"成本"，因为 DSH 里没有任何价格表（00-audit:318-328）。

**token 维度上仍然没有任何上限**——计量只用来显示与报告，不用来强制。现存的数量限制是 `maxWorkers` 槽位（executor.ts:228，计数 :190-195）和几个字节上限（worker 拿到的产物 256KB，runtime.ts:50；请求文件 512KB，inbox.ts:21；面板读文件 16MB）。它们限的是并发与单次读取大小，不是花费。

> **【W6 修正，2026-11-11】墙钟预算现在存在，而且是强制的。** 原文这里写"没有任何上限，也没有任何超限处置"，
> 对 token 仍然成立，对**时间**已不成立：`enforceRuntimeBudgets` 取"排期自带的 `meta.runtimeBudgetMs`，
> 否则 `watchdog.maxRuntimeMs`"，到点先给 worker 发一条收尾提醒（`note`），再过 10 分钟仍未结束就
> `assignmentInterrupted(..., 'budget')` 停下，并在操作者的决断队列里停一条。计的是这张 Ticket 的墙钟，
> 所以子代理与后台作业都在预算内，绕不过去。
>
> 活体证据（2026-11-11）：排期票 `233e7679` 因分诊台工具故障卡死，`01:00` 启动 → `02:00` 收到收尾提醒
> → `02:10` 被系统停下，理由原文「超出时间预算：预算 60 分钟，宽限 10 分钟后仍在运行，已被系统停下」。
> 全局 `maxRuntimeMs` 目前仍是 0（不限），要不要设是操作者的取舍（决断队列里有一条）。

### 5.3 没有多租户

一个部署 = 一个状态目录 = 一个写者。`takeLock(stateDir)`（runtime.ts:246 → lock.ts:64）是 OS 文件锁，第二个实例挂同一个 stateDir 会得到 `LockHeld` 并被拒绝启动（runtime.ts:839）。`Settings` 是**单份全局文档**（store.ts:641-659），没有租户维度；"按来源分设 Observe/Allow/Deny/Pause"（00-audit §4.12）是按**来源**，不是按人。

所以架构里没有租户 id、没有租户级配额、没有跨租户可见性规则。加多租户要改的是 Store 的键空间与 Settings 的形状，不是加一层中间件。

### 5.4 Project / Work 是分组，不是隔离边界

`createProject`（engine.ts:522）、`createWork`（:537）、`attachWork`（:563）是给操作者看的分组。它们进 worker 提示词的方式被刻意标成"上下文，不是授权"：`taskText` 印出 Work 的 scope 之后紧跟一句"你的授权是上面那个 scope，它不因为这个 Work 说了更宽的话而变宽"（executor.ts:343-361）。理由写在 :343-346：如果 Work 的 scope 能放宽 Ticket，那么编辑一个 Work 就会**静默重新授权**它下面所有已受理的 Ticket，绕过 `policyVersion`（policy.ts:218）与 `revalidate`（policy.ts:332）。`attachWork` 也因此在门禁**之后**发生、绝不作为门禁的输入（engine.ts:556-562），门禁保持是 Trigger + 设置的纯函数。

但 Work **确实**承重了两条机器可检的边界，这一点不能说漏：跨 Ticket 的协作通道 `noteFromWorker`（engine.ts:351-366）与跨 Ticket 的产物读取 `authorizeArtifactRead`（:879-890），都要求两张 Ticket 属于**同一个 Work**，否则 `collaboration_refused`。它们是可达性边界，不是权限沙箱：Work 归属是人设的，设错了就授权错了（06-security-risk-register §2 那两行原文如此）。

Project 完全不承重：它只是 Work 的一个可选归属（engine.ts:541-548），没有任何检查读它。

## 6. D1–D11 在架构里的落点

| 决定 | 落点 | 现状 |
| --- | --- | --- |
| D1 来源种类是数据声明 | `Settings.sources` 按 kind 声明；`sourcePolicy(kind, settings)`（policy.ts:269）在**产出侧**被三个来源调用（cron.ts:162、inbox.ts:200、rule.ts:65） | 落地（00-audit §4.12） |
| D2 pause 不是门禁裁决 | paused/deny → 什么都不产（cron.ts:163、inbox.ts:201、rule.ts:66）；全局 paused → `Later` 挂住启动（executor.ts:223） | 落地 |
| D3 一个 kind 只能有一个实例 | `SourceRegistry` 仍以 `kind.name` 为键（registry.ts:45-48，两个 Map 都是） | **未落地**。四个来源恰好 `id === kind.name`（cron.ts:32、inbox.ts:84、session.ts:12、rule.ts:24），所以还没出事 |
| D4 预算只用真实 token | `usageOf` + `windowed`（runtime.ts:134-154） | token 计量落地、**token 强制仍不存在**；但**墙钟强制已落地**（W6，见 §5.2 修正框：到点提醒 → 宽限 10 分钟 → 系统停下 → 停一条决断） |
| D5 日志在事务内写，emit 降级为投影 | `record()` 事务内 append（engine.ts:824）；`emit` 包 afterCommit（engine.ts:196-197） | 落地（00-audit §4.7） |
| D6 四种权限的分离点 | `prepare` 是事务内同步端口（engine.ts:245 → executor.ts:94-97，纯算目录名）；`start` 是 afterCommit 的持久 effect（engine.ts:275） | 分离点存在；discover/prepare/execute/affect 四级阶梯**未落地**（现状是 acceptMode 两级 + 按来源 deny/pause） |
| D7 任务完成事件当 Trigger | `SourceHost.subscribe`（kind.ts:47）+ `Runtime.subscribe` 多路复用（runtime.ts:439-442）；rule **入队**而非内联 receive（rule.ts:99 → runtime.ts:324）；深度守卫（rule.ts:71-80 + engine.ts:250-252）；system actor 变成设置决定（policy.ts:299-300） | 落地（00-audit §4.14/§4.15） |
| D8 血缘图 + 依赖边建表 | `ticket_deps`（store.ts:91）+ `DependencyRepository`（engine.ts:42-51）+ `origin.triggerId` | 落地 |
| D9 Webhook | 无代码 | 未落地。障碍是 DSH 的 web server 拒绑通配地址，加上 myagent 自己的同源围栏（http.ts:121） |
| D10 文件变化监听 | 无代码 | 未落地。两个真问题：trigger id 没有自然答案（会自激）、DSH 没有 watcher 服务 |
| D11 聊天 Source 回不了话 | `Delivery.send` + `effects.enqueue('send', …)`（delivery.ts），由聊天 Source 落地执行 | **已落地**（0.12–0.14：Telegram/飞书/QQ/钉钉/企业微信五桥）。回程地址只从 Trigger 的 `replyTo` 读，绝不从 actor 推（contract §3.3）；没有地址的报告计入 `sends.nowhere` 而不是静默丢弃 |

---

## 7. W1–W39 重构后的进气与协作架构（2026-11-11，本节按现行代码校对）

§1–§6 描述的是重构前的形状。本节是**增量**，只讲新出现的结构，不重述上面仍然成立的部分。

### 7.1 进气从一层变两层：门禁 + 分诊台

重构前：`Source → gate（纯函数） → Decision → Ticket → worker`。gate 只判"这个人能不能在这里发起工作"，
判不了"这句话是不是一件活"。后果是活体上一天 12 张票里出现了一张为字面消息「1」建的票。

重构后多了一层**判断者**：

```
Source → gate（确定性，纯函数） ─┬─ ignore / observe：留档，不执行
                                 └─ accept ─→ triage.sources 命中？
                                                ├─ 否：直接建 worker 票（老路径）
                                                └─ 是：建 role='triage' 的分诊票 → 交总管
                                                         总管四选一：自己答 / 开票 / 问人 / 判无需处理
```

- **门禁保持是纯函数**，没有被削弱：它仍然只回答"这个人被允许吗"，理由仍固定为那八种。
- **分诊是模型判断**，由 `settings.triage` 三个旋钮控制：`enabled`、`desk`（`dedicated`｜`main`）、
  `sources`（默认只有 `chat`）。三者都**不进** `authorizationShape`，所以拨动它们不移动 `policyVersion`
  ——路由未来的请求，不撤销已经给出的授权。
- 活体取值：`{enabled: true, desk: 'main', sources: ['chat']}`。选 `main` 是因为总管手里有操作者的
  对话上下文（这是判断"这句话是什么意思"的关键材料），代价是它与操作者共用一个会话。

### 7.2 Thread 与 Subscription：同一对话不再劈成多张票

重构前靠 `findContinuationTarget` 的 **60 秒启发式**猜"这条消息是不是在追问某张票"。活体上它猜错了：
两句话隔 65 秒（策划书 + "给大一做PPT"）被劈成两张互不知情的票，其中一张凭空发明了主题。

重构后是显式的聚合：

- **`Thread`**（`model.ts`）：`{ key, createdAt, lastAt, subscriptions[], contextSubscriptions?[], sourceKind }`，
  存 `threads` 表（**schema 版本升到 6**，`MIGRATIONS[6]` 负责从 v5 建表）。
- **`Trigger.threadKey`**：聊天来源写它，格式 `chat:<频道>:<话题>` 或 `chat:<频道>:dm:<发件人>`；
  cron/inbox/rule 不写（它们不是对话）。
- **`Engine.receive`** 在门禁**之前**做 Thread 的 upsert（只更新 lastAt，不判任何事）。
- **Subscription fan-out**（`chat.ts`）：Thread 已有订阅票且这条消息不是重复 → 直接投给那张票
  （票在等人就 `answer`，否则 `note`），**不建新票、不走门禁**。
- 票结束时自动退订（`runtime.ts` 的 `ticket.ended` 分支遍历 Thread）。

`findContinuationTarget` **没有全删**，收窄成两种情况：显式 `reply-to-ticket`（桥写的 front matter），
以及 DM→群里那张票的首条回答。后者命中时会**顺手把票订阅到这条 DM Thread**，于是第二条起走 fan-out——
这就是 60 秒启发式的替代品。60 秒那段已删。

`triggerExists(triggerId)` 是 fan-out 的前置查重：同一文件被扫两次时，第二次交给 `receive` 去判重复，
而不是被当成新消息再投一遍。

### 7.3 总管（desk）的工具面

重构前 worker 有三个工具；总管有一批管理工具。重构后新增/改变：

| 工具 | 归属 | 作用 |
| --- | --- | --- |
| `myagent_ask_desk` | worker | **非阻塞**提问总管，问完继续跑；总管用 `myagent_note_ticket` 回。替代"什么都 blocked" |
| `myagent_handback` | worker | 超出本票授权范围时交回总管重路由，本票以 `dropped` 结束 |
| `myagent_raise_decision` | worker（**已弃用**） | 描述里明写"改用 ask_desk"。写决断队列的权限收归总管 |
| `myagent_close_ticket` | 总管 | 分诊的落点：`ready`（自己答了）/`dropped`（无需处理）/`blocked`（要问人） |

两级决断规则写在 `prompts/triage.md`：**能自己答的自答**（系统状态、历史检索、能力问题），
**只有操作者能定的才上升**（花钱、不可逆、超出授权、真正的取舍分叉）。队列的写入权只有总管有。

### 7.4 协作边界的两处放宽（都有明确的窄法）

- **同 Work 只读兄弟目录**（`sessions.ts` 的 `guardWorkerCall`）：`read`/`read_image`/`glob`/`grep`
  可以进**同一 Work** 的票目录；`write`/`edit`/`bash` 不行。未归组的票**没有** peer（`peerDirs` 返回空）。
  词法与 realpath 两条检查都对齐了，且 guard 闭包**每次重读** ticket——票可能在 worker 起来之后才被归组。
  与 `SECURITY.md` §4 的关系：那里"未归组是开放不是隔离"只适用于**经引擎的已登记产物**，
  不适用于裸文件系统遍历（目录里还有草稿与凭据）。
- **目录级产物登记**（`engine.ts`）：`report.files` 里以 `/` 结尾的路径登记**整棵树**，
  `authorizeArtifactRead` 让该目录覆盖其下任意路径。标记必须显式——Engine 不做 IO，
  猜"它是目录"会让一个陈旧名字悄悄放大权限。授权返回 `readPath`（真要开的文件）与
  `artifact`（授权它的那条登记）两样，血缘记 `readPath`。
  防前缀混淆：比较的是**带斜杠**的目录名，所以 `out/` 不会覆盖 `output/x`。

### 7.5 这一节没解决的

- **总管出口没有收归**（W21/W25 未完成）：worker 的 `blocked`/`waiting` 仍然同时发给总管**和**请求者，
  没有"总管先看一眼再决定要不要打扰你"。原因见 `00-audit-and-plan.md` §4.166：给消息文本加署名前缀
  会打红 22 个测试文件，正确做法是用独立元数据字段，那要和 W21 的路由改造一起做。
- **总管只读工具面做不到**（W32 有意不做）：`desk: 'main'` 时评估发生在操作者自己的主会话里，
  收窄它的工具就是收窄操作者日常在用的会话；宿主没有"按轮次限定工具面"的机制。
  所以"总管不自己干重活"是**提示词约束**，不是控制。兜住它的是 W6 的墙钟预算——可重不可长。
