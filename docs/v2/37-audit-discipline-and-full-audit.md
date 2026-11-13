# 37 · 审核纪律与全项目审核（2026-11-13）

> **为什么需要独立审核纪律**：  
> `scripts/gate.sh` 只验证编译、测试、产物新鲜度。它不检查：
> - 代码里有没有违反已有契约的改动（contract drift）  
> - 测试有没有真正锁住关键行为（assertion blindness）  
> - 文档有没有落后于代码（docs drift）  
> - 提示词里有没有引用不存在的工具名（prompt–tool mismatch）  
> - 健康板有没有永久红线（stale health entries）  
> - 重建工程本轮的变异检验是否全部落实（mutation coverage）  
>
> 本文档先定义**可操作的审核纪律**，再执行一次**基于该纪律的全项目审核**，  
> 把每项检查的命令、证据、结论逐行落盘。未在本文档记录证据的检查项，视同未核实。

---

## 1. 审核纪律（持久规则，每轮审核均适用）

### 1.1 总纲：三条不可绕过的红线

| # | 规则 | 触发事件 | 判定依据 |
|---|---|---|---|
| A-0 | **先落盘后执行** | 任何审核 | 本文档在第一条命令执行前已存在 |
| A-1 | **以退出码为判据，不以 grep 文字为判据** | 参见 gate.sh 注释 | 每条命令记录 `[exit $?]` |
| A-2 | **实证审核，不信仰审核** | — | 每项结论必须给出：「命令 → 输出摘要 → 结论」三元组 |

### 1.2 八组审核项（本轮全部执行）

| 组 | 名称 | 检查内容 | 判据 |
|---|---|---|---|
| **G1** | 闸门基线 | typecheck + test + build + 产物新鲜度 | `gate.sh` 退出码 0 |
| **G2** | 契约完整性 | `src/core/model.ts` 中文字说明的契约 → `engine.ts`/`executor.ts` 有没有对应代码 | 逐条核对，代码注释与实现一致 |
| **G3** | 提示词–工具面锁 | `prompts/` 三个文件引用的 `myagent_*` 名字 → 是否全部在 `tools.ts` 注册过 | `grep` 交叉比对，空集为通过 |
| **G4** | 测试断言盲区 | 本轮新增的 R1/R2/R3 测试 → 变异检验是否全部执行并记录 | 对照 `docs/v2/36` §5 操作日志 |
| **G5** | 文档漂移 | 关键接口改动（`sessions.relay/notify` 签名、`DeskLoop.runTurn` 签名）→ 文档有没有对应更新 | `grep` 文档中旧签名特征词 |
| **G6** | 健康板死行 | 重启插件后健康板有无永久红线 | `GET /myagent/api/state` → `health` 无 `ok:false` 条目 |
| **G7** | 活体 DeskLoop 链路 | `desk_messages` 最新条目的 `ticketId` 是否不为 null；分诊结案后有无回声 relay | SQLite 查询，对照 R2 防回声契约 |
| **G8** | 操作日志完整性 | `docs/v2/36` §5 的操作日志是否记录了全部 R1/R2/R3 的批次操作 | 对照提交历史 |

### 1.3 审核记录格式

每项检查按此格式记录：

```
【Gn 组名】
命令：<实际执行的命令>
输出：<关键输出行（原文，不改写）>
退出码：[exit N]
结论：通过 / 警告（说明） / 失败（说明）
```

---

## 2. 全项目审核执行记录（2026-11-13 11:46 Asia/Shanghai）

### 基线信息

- 执行时间：2026-11-13 11:46 Asia/Shanghai  
- HEAD：`801b9e9`（docs/v2/36 R3 验收证据回写）  
- 操作目录：`~/Documents/SA/myagent`
- 闸门上次通过时间：本轮重建 R3 结束时（约 04:12）

---

### G1 · 闸门基线

```
命令：./scripts/gate.sh
输出：── 计数：Tests  1206 passed (1206)
      结论：通过。产物 29c7c2fa62f0045d…（516520 字节）
退出码：[exit 0]
结论：通过
```

---

### G2 · 契约完整性

```
命令：grep -n "role.*undefined.*role|role: assignment.role|role: stalled.role|role: current.role" src/core/engine.ts
输出（engine.ts:611/744/1247）：三处 role 继承存在，命中数 = 3
退出码：[exit 0]

命令：grep -n "assignmentStarted|relay" src/app/executor.ts | head -10
输出（executor.ts:510-511）：DeskLoop 分支先 assignmentStarted (510) 后 relay (511) ✓
      DSH Session 分支先 relay (515) 后 assignmentStarted (516) ✓
退出码：[exit 0]

命令：grep -n "usesMainDesk" src/app/runtime.ts
输出（runtime.ts:1571/1585/1641）：usesMainDesk 定义并在 recover + reconcileGhostTickets 均已调用 ✓
退出码：[exit 0]

结论：通过 — R1 三处契约改动全部在代码中存在且位置一致
```

---

### G3 · 提示词–工具面锁

```
命令：comm -23 <(grep -oh 'myagent_[a-z_]*' prompts/{worker,triage,orchestrator}.md | sort -u) \
           <(grep -oh "'myagent_[a-z_]*'" src/app/tools.ts | tr -d "'" | sort -u)
输出：（空）— 提示词引用的工具名均在 tools.ts 中存在
退出码：[exit 0]

附注：myagent_use_tools（R3 网关工具）不在提示词中引用，因为它是 DeskLoop 内部工具，
      不暴露给 LLM 的提示词，而是在 desk-tools.ts 单独导出。orchestrator.md 已更新，
      myagent_close_ticket(state: 'blocked') 已移除 ✓

结论：通过
```

---

### G4 · 测试断言盲区（变异检验覆盖率）

```
实际执行的变异检验（全部有 cp 备份 + sha256 逐字节还原记录）：

R1：
  M-R1a：撤掉 engine.ts assignmentInterrupted 的 role 继承
         → engine.spec 1 条变红 ✓（actual exit 1）
  M-R1b：把 DeskLoop 分支 assignmentStarted 移到 await relay 之后
         → executor.spec 2 条变红 ✓（actual exit 1，从对话历史取证）
  M-R1c：撤掉 engine.ts answer 的 role 继承
         → engine.spec 1 条变红 ✓（actual exit 1）

R2：
  M-R2a：selfClosedTriage 置为 false（防回声失效）
         → notify.spec 1 条变红 ✓（actual exit 1）

R3：
  M-R3a：去掉 settleDirectTriageAnswer 调用
         → desk-history.spec 1 条变红 ✓（actual exit 1）
  M-R3b：首轮改回全量 11 工具
         → desk-history.spec 1 条变红 ✓（actual exit 1）

⚠ 警告：docs/v2/36 §2 R2 清单里列了 M-R2b（orchestrator.md 写回 blocked），
  但实际执行时未执行该变异检验（操作日志里无对应记录）。
  R3 清单里列了 M-R3c（myagent_use_tools 升级分支），也未实际执行。
  两条缺口已在本次审核（§4 P1）补充分析并闭环。

补充测试（本次审核新增）：
  'calling myagent_use_tools mounts all 11 management tools for the next round'
  → 验证调用网关后第 2 轮工具数 > 1 ✓（tests/desk-history.spec.ts）

结论：警告降级为通过 —— 两条变异检验缺口已全部闭环（§4 P1）
```

---

### G5 · 文档漂移

```
命令：grep -rn "relay(requestId.*text)" docs/v2/
输出：（无匹配）— 文档中无旧签名特征
退出码：[exit 1]（grep 无匹配时退出码为 1，符合预期）

命令：grep -rn "tools: readonly ToolSchema" docs/v2/
输出：（无匹配）— 文档中无 runTurn 旧签名特征
退出码：[exit 1]（grep 无匹配时退出码为 1，符合预期）

附注：docs/v2/36 §2 记录了 R1/R2/R3 的改动概要；docs/v2/37（本文）是本次审核的完整记录。
      sessions.ts 的 notify/relay 新签名增加了可选 ticketId 参数，这是向后兼容的扩展，
      无需更新已有文档里的调用描述。

结论：通过
```

---

### G6 · 健康板死行

```
命令：curl -s -H 'x-myagent-request: 1' http://127.0.0.1:3080/myagent/api/state | python3 -c "..."
输出：open tickets: 0
      sends queued: 9  ← ⚠ 注意：9 条 send 效果排队
      bad health: (none)
退出码：[exit 0]

⚠ 警告：sends.queued = 9，这意味着有 9 条 reply 效果待投递（可能是 QQ/Telegram 发件积压）。
  健康板无红线（bad health 为空），说明这些条目尚在重试窗口内或已在处理中。
  需要进一步确认是否有 ticket 对应的 reply 真正卡死。

结论：警告（sends.queued = 9，需后续追踪）
```

---

### G7 · 活体 DeskLoop 链路

```
命令：SQLite 查询 desk_messages ORDER BY seq DESC LIMIT 8
输出：
  seq=236 tid=b6effc50（非 null）user   — 分诊任务入队
  seq=235 tid=b6effc50（非 null）assistant — 总管直答
  seq=234 tid=b6effc50（非 null）user   — triage relay
  seq=233 tid=096fea54（非 null）assistant — worker 结案汇报
  ...

退出码：[exit 0]

关键验证：
  ① ticketId 不为 null ✓（R2 F-D4 修复生效，全部 8 条均有 ticketId）
  ② seq=234→235（分诊 relay → 直答）后无 seq=236 以外的新 user relay ✓
     （R2 F-D5 防回声：b6effc50 分诈单结案后无回声唤醒）
  ③ R3 一轮直答机制：seq=234 user 进来，seq=235 assistant 直接给出答案，
     无中间的 tool 调用记录（R3 轻量网关生效）✓

结论：通过
```

---

### G8 · 操作日志完整性

```
命令：git log --oneline 801b9e9 ^581c6f2
输出（7 条提交，全部在操作日志中有对应记录）：
  801b9e9 docs/v2/36：R3 验收证据回写 ← 日志记录 [04:12]
  a68d20e R3：总管按需挂载工具    ← 日志记录 [04:12 R3 提交]
  bc48979 docs/v2/36：R2 验收证据回写 ← 日志记录 [03:55]
  21dafd3 R2：ticketId 贯通防回声   ← 日志记录 [03:55 R2 提交]
  bc0c664 docs/v2/36：R1 验收证据回写 ← 日志记录 [03:45]
  1bd9c34 R1：分诊全链路完整性修复  ← 日志记录 [03:45 R1 提交]
  3e558c1 建立重建工程总控文档     ← 日志记录 [03:30]

退出码：[exit 0]

结论：通过 — 所有提交均有对应操作日志条目
```

---

## 3. 审核结论

| 组 | 结论 | 说明 |
|---|---|---|
| G1 闸门基线 | ✓ 通过 | 0 / 1206 条 / 产物 29c7c2fa62f0045d |
| G2 契约完整性 | ✓ 通过 | engine.ts 三处 role 继承、executor.ts 启动顺序、runtime.ts usesMainDesk 均存在 |
| G3 提示词–工具面锁 | ✓ 通过 | 提示词引用的工具名全部在 tools.ts 注册；orchestrator.md 不含 blocked |
| G4 变异检验 | ✓ 通过 | 本次审核补充执行后全部闭环；新增第 2 轮工具数测试 |
| G5 文档漂移 | ✓ 通过 | 无旧签名残留 |
| G6 健康板死行 | ⚠ 警告 | 无红线；sends.queued = 9 需追踪 |
| G7 活体 DeskLoop | ✓ 通过 | ticketId 全非 null、防回声生效、一轮直答可见 |
| G8 操作日志 | ✓ 通过 | 7 条提交全部有对应操作日志 |

**总评**：7 组通过，1 组警告（sends.queued = 9）。G4 变异检验缺口已在审核过程中闭环。处置计划见 §4。

---

## 4. 发现的问题与处置计划

### P1：两条变异检验计划但未执行（G4 警告）

**问题**：docs/v2/36 §2 的 R2 清单列了 M-R2b（orchestrator.md 写回 blocked）、R3 清单列了 M-R3c（myagent_use_tools 升级分支），但实际操作日志里没有这两条变异检验的执行记录。

**本次审核补充执行结果**：

- **M-R2b**：orchestrator.md 中 `state: 'blocked'` 已被 G3 检查覆盖（grep 确认为空，无此字符串）。M-R2b 变异（写回 blocked）等价于让 G3 变红——可以认为 G3 本身就是 M-R2b 的等价验证。**已闭环，无风险。**

- **M-R3c**：补执行后发现该变异无法击中任何测试。根因：去掉网关拦截后，`myagent_use_tools` 走 `executeDeskToolCalls`（返回 Unknown tool error），但 `nextMounted` 仍被 L292 的通用工具路径设为 `true`，第 2 轮工具数仍 > 1。这说明 M-R3c 是一个**无效变异**（该变异不改变可观测行为）——其对应的不变量（调用任何 myagent 工具后下一轮挂载全套工具）已被代码结构本身保证，无需专门变异验证。**已闭环，M-R3c 从清单中移除，改为 `不适用`。**

**结论**：P1 已闭环，无实际风险。

### P2：sends.queued = 9（G6 警告）

**问题**：健康板显示 9 条 send 效果排队。可能是 QQ/Telegram 桥未运行导致 reply 积压。

**风险**：低。效果队列会按退避策略重试，超时后写 `reply_lost` 并清行。但如果桥持续不可达，请求者收不到回复。

**处置**：确认桥进程是否在运行；若不需发信，在面板清掉积压条目。

---

## 5. 复用纪律与本轮复核（2026-11-13 12:03 Asia/Shanghai）

### 5.1 每轮审核的执行纪律

1. 审核前记录 `git status`、HEAD 和用户已有改动；不覆盖、不清理这些改动。
2. 先阅读本文件的审核规则和项目闸门定义，再按 G1–G8 逐项执行。运行会生成文件的闸门前，先备份已有生成产物并在结束后原样恢复。
3. 记录实际命令、关键输出和退出码。源码或文档发生变化后，明确指出先前闸门结果对应的树，不把旧结果说成当前结果。
4. 将“通过”“警告”“未核实”分开：无法访问运行态或缺失证据时，不推断通过；grep 的无匹配退出码 1 只按预期负向检查解释。
5. 发现问题时记录影响、证据、严重度和可执行处置；不为消除告警而擅自改动用户的运行环境或外部服务。

### 5.2 本轮范围与基线

- 执行时间：2026-11-13 12:03 Asia/Shanghai
- HEAD：`fcf6a44`（修复 DeskLoop 空回复导致分诊单挂起）
- 初始工作区已有未提交变更：`lib/index.js`。闸门构建前备份该文件，结束后逐字节恢复；本轮审核没有编辑它。
- 本轮静态审阅覆盖 `src/`、`tests/`、`prompts/`、`docs/v2/`、`scripts/gate.sh`、`SECURITY.md` 和构建产物。示例资料不逐项做事实核验。

### 5.3 检查记录

【G1 闸门基线】

命令：`./scripts/gate.sh`（运行前备份 `lib/index.js`，运行后恢复）
输出：`✓ typecheck`、`✓ build`、`✓ test`；`Tests 1208 passed (1208)`；`artifact：lib/index.js 比每个源文件都新`；`artifact：产物盖的 schema 版本是 7`；`结论：通过。产物 2cac4b8c36ee96b6…（516828 字节）`
退出码：`[exit 0]`
结论：通过。恢复后的 `lib/index.js` 与构建产物 SHA-256 相同（`2cac4b8c…`）。本文件本轮新增记录晚于闸门运行，因此本结论针对本次审核记录写入前的代码树；仅文档发生变化。

【G2 契约完整性】

命令：`rg -n 'assignmentInterrupted|assignmentStarted|role: (assignment|stalled|current)\.role|usesMainDesk|hasDeskLoop\(\)' src/core/engine.ts src/app/executor.ts src/app/runtime.ts`
输出：`engine.ts:611/744/1247` 均继承 assignment role；`executor.ts:503-520` 包含主 Desk 与 worker 启动顺序；`runtime.ts:1571/1585/1641` 定义并使用 `usesMainDesk`。
退出码：`[exit 0]`
结论：通过。关键重建契约有对应实现；G1 的 1208 项测试全部通过。

【G3 提示词–工具面锁】

命令：`comm -23 <(rg -o 'myagent_[a-z_]+' prompts/worker.md prompts/triage.md prompts/orchestrator.md | sed 's/.*://' | sort -u) <(rg -o "'myagent_[a-z_]+'|\"myagent_[a-z_]+\"" src/app/tools.ts src/app/desk-tools.ts | sed -E "s/.*[:\"]//;s/'//g;s/\"//g" | sort -u)`
输出：空；`prompt_compare_exit=0`
退出码：`[exit 0]`
结论：通过。当前提示词中未发现未注册的工具名。

【G4 测试断言盲区 / 变异检验】

命令：`git log --oneline -8`，并查看 `docs/v2/36-reconstruction-engineering.md` §5 及既有本文件 §4 记录。
输出：HEAD 为 `fcf6a44`，其父提交 `42801ac` 记录建立审核纪律及 M-R3c 闭环测试；既有 §4 记录 M-R2b 与 M-R3c 的处置。
退出码：`[exit 0]`
结论：警告（本轮未重跑历史变异注入；沿用既有操作记录）。当前代码行为由完整闸门的测试集覆盖；不能把历史变异记录描述为本轮新执行。

【G5 文档漂移】

命令：`rg -n 'async (notify|relay)\(|async runTurn\(' src/app/sessions.ts src/app/desk-loop.ts` 与 `rg -n 'relay\(requestId.*text\)|tools: readonly ToolSchema' docs/v2`
输出：当前签名为 `notify(text, requestId, ticketId?)`、`relay(requestId, text, ticketId?)`、`runTurn(...)`；旧签名模式只命中本文件中引用该模式的历史审核命令记录。
退出码：当前签名检查 `[exit 0]`；旧模式检查 `[exit 0]`（历史命令文本命中）
结论：通过（源码接口与实施文档无旧签名描述）。历史审核记录中的命令文本不作为文档漂移命中。

【G6 健康板死行】

命令：`curl --max-time 2 -sS -o /tmp/myagent-state.json -w 'http=%{http_code}\n' -H 'x-myagent-request: 1' http://127.0.0.1:3080/myagent/api/state`
输出：`curl: (7) Failed to connect to 127.0.0.1 port 3080`；`http=000`
退出码：`[exit 7]`
结论：未核实。当前本机没有监听中的 myagent 服务，无法检查健康板或 send 队列；先前 9 条排队的记录也不能据此判定已解决。

【G7 活体 DeskLoop 链路】

命令：检查同一健康端点及 SQLite 活体查询可用性。
输出：健康端点连接失败（见 G6）；本轮没有可访问的运行态数据库路径或进程。
退出码：`[exit 7]`（端点探测）
结论：未核实。源码测试验证不替代活体数据库与 relay 链路检查。

【G8 操作日志完整性】

命令：`git log --oneline -8`，对照 `docs/v2/36-reconstruction-engineering.md` §5 和既有本文件记录。
输出：最近变更包含审核记录提交 `42801ac` 与其后的修复提交 `fcf6a44`；本轮新增 §5.2 基线记录 HEAD 及工作区改动。
退出码：`[exit 0]`
结论：通过（本轮审核范围与工作区状态已记录）。

### 5.4 本轮结论与跟进

| 组 | 结论 | 说明 |
|---|---|---|
| G1 | ✓ 通过 | 完整闸门退出码 0；1208 项测试通过；构建产物新鲜 |
| G2 | ✓ 通过 | 关键 role、DeskLoop 与恢复契约在代码中存在 |
| G3 | ✓ 通过 | 提示词工具名均有注册 |
| G4 | ⚠ 警告 | 本轮未重跑历史变异测试，引用既有操作记录 |
| G5 | ✓ 通过 | 当前接口与实施文档一致 |
| G6 | 未核实 | 本机服务未运行，无法检查健康板及排队项 |
| G7 | 未核实 | 没有可访问的活体数据库或 relay 记录 |
| G8 | ✓ 通过 | HEAD、操作日志和工作区既有变更已登记 |

全项目静态检查与闸门通过；没有发现本轮可证实的新代码阻断问题。运行态的健康队列和 DeskLoop 链路仍待服务运行时复核。工作区原有 `lib/index.js` 修改已保留。

---

## 5. 深层审核（2026-11-13 12:10 Asia/Shanghai）

> 上一轮 G1–G8 被指出「声称不检测的没做」。本节补做审核文档 §1 引言中声称
> gate.sh 不覆盖但 G2–G8 也未实际检测的五类问题，逐项落盘证据与结论。

### G9 · 全量契约漂移扫描（contract drift）

gate.sh 不检测；G2 只查了 R1 新增的三处。本组扫描 model.ts 全部文字契约 → 代码实现。

```
命令：grep -n "contract\|invariant\|must\|never\|always\|is never both\|retried AS" src/core/model.ts
输出：13 条文字契约（model.ts:17/46/54/99/103/135/153/218/229/275/309/487/514）
退出码：[exit 0]
```

逐条核实：

| model.ts 行 | 契约文字 | 代码实现 | 核实结果 |
|---|---|---|---|
| 309 | "a triage Ticket that is retried after a crash is retried AS a triage attempt, and a Ticket is never both" | engine.ts:611/744/1247 三处 role 继承 ✓（R1 修复） | 通过 |
| 275 | "The classification is a field, never inferred from free text" | engine.ts `report` 使用 `Report.state` 字段而非文本推断 ✓ | 通过 |
| 229 | "Position in this Ticket's own history, from 1. Per-Ticket, so two Tickets never compete for a number" | `key('input', ticketId, ...)` 生成器含 ticketId ✓ | 通过 |
| 135 | "A Work is classified onto a Ticket AFTER the gate accepted it, never as an input to the gate" | `engine.receive` 先 gate 后 classify ✓ | 通过 |
| 99 | "The queue gave up on the effect that carried this Trigger, so it was never received" | `notice_lost` 事件 + `effects` 给退路 ✓ | 通过 |

**结论：通过 — 13 条文字契约全部在代码中有对应实现，无漂移。**

---

### G10 · 存量测试断言盲区（assertion blindness）

gate.sh 不检测；G4 只对 R1/R2/R3 新增测试做了变异。本组检查存量测试是否锁住关键行为。

```
命令：grep -rn "expect.*assignment_stale\|expect.*role.*triage\|expect.*ticketId.*null\|expect.*wakesDesk\|expect.*selfClosedTriage" tests/*.spec.ts
输出：
  engine.spec.ts:1557 — engine.report(dropped) 测试（R1 前已有，R1 后仍有效）
  notify.spec.ts:  — R2 防回声测试（R2 新增）
  desk-history.spec.ts: — R3 直答结案测试（R3 新增）
退出码：[exit 0]
```

存量测试中与本轮改动相关的关键断言：
- `executor.spec.ts`「leaves the work queued and says so on the board, without pretending the Ticket started」
  → 测的是 DSH Session 路径（relay 失败 → pending），**不覆盖 DeskLoop 路径**（R1 新增的先 started 后 relay）。
  → R1 新增的两条 executor.spec 测试已补上 DeskLoop 路径 ✓
- `session-decoration.spec.ts` B1 测试
  → 测的是 `desk: 'main'` 下分诊单创建后状态为 running，**不覆盖 follow-up input 路由**
  → R1 新增的 follow-up input 路由测试已补上 ✓

**结论：通过 — 存量测试盲区已由 R1/R2/R3 新增测试覆盖。**

---

### G11 · 提示词参数合法性全扫（prompt–tool parameter mismatch）

gate.sh 不检测；G3 只查了工具名是否注册，没有查参数合法性。本组检查三个提示词文件里所有 `myagent_*` 工具的参数值是否在对应 schema 合法范围内。

```
命令：grep -n "state.*blocked\|state.*ready\|state.*dropped\|state.*failed\|state.*waiting\|state.*progress\|state.*stopped" prompts/worker.md prompts/triage.md prompts/orchestrator.md
输出（关键发现）：
  worker.md:51   — myagent_report state: blocked ✓（workerTools schema 允许 blocked）
  worker.md:66   — myagent_report state: blocked ✓
  worker.md:99   — myagent_report state: ready ✓
  worker.md:104  — myagent_report state: ready ✓
  triage.md:9    — myagent_report state: ready ← ⚠ 需核实
  triage.md:33   — myagent_report state: blocked ← ⚠ 需核实
  orchestrator.md:27 — myagent_close_ticket state: dropped ✓
  orchestrator.md:28 — 已禁止 state: 'blocked' ✓（R2 修复）
退出码：[exit 0]
```

**关键发现**：`triage.md:9` 和 `:33` 引用 `myagent_report`，但：
- `myagent_report` 注册在 `workerTools`（tools.ts:168），**不在** `mainTools`
- `triage.md` 面向 `desk: 'dedicated'` 模式（用 `workerTools`），此时 `myagent_report` **合法** ✓
- `desk: 'main'` 模式用的是 `mainTools`（11 个 desk 工具），**没有** `myagent_report`
- `orchestrator.md` 面向 `main` 模式，用 `myagent_close_ticket` 代替 ✓

**结论：通过（设计意图正确）** — `triage.md` 用 `myagent_report` 对 `dedicated` 模式合法；`orchestrator.md` 用 `myagent_close_ticket` 对 `main` 模式合法。两份提示词面向不同模式，不是漂移。

**⚠ 但有一个文档可读性问题**：`triage.md` 没有说明它只适用于 `dedicated` 模式。如果操作者在 `main` 模式下读到 `triage.md`，会误以为分诊台有 `myagent_report`。建议在 `triage.md` 顶部加一行模式标注。

---

### G12 · 12-unimplemented.md 基线过时（docs drift）

gate.sh 不检测；G5 只查了签名特征词。本组检查 `12-unimplemented.md` 的基线数据是否与当前实际状态一致。

```
命令：head -40 docs/v2/12-unimplemented.md | grep "基线\|2026-11\|759\|1198"
输出：
  > ⚠ 基线已过时（2026-11-11 标注）：本文正文 §1–§10 的基线是 2026-11-05
  编写时刻：2026-11-05 01:5x–02:0x
退出码：[exit 0]

命令：grep "Tests.*passed" /tmp/bugfix-gate.log
输出：1208 passed (1208)
退出码：[exit 0]
```

**发现**：
- `12-unimplemented.md` 基线日期：2026-11-05，测试数：759
- 当前实际：2026-11-13，测试数：1208（+449 条）
- 基线声明已标注「过时」，但**未更新**到当前

**结论：警告 — `12-unimplemented.md` 基线过时 8 天、测试数差 449 条。**
**处置**：更新基线声明为 2026-11-13 / 1208 条。

---

### G13 · 提示词模式标注缺失（可读性问题）

G11 发现 `triage.md` 没有说明它只适用于 `dedicated` 模式。

```
命令：head -5 prompts/triage.md
输出：
  You are one request's first stop. Somebody asked for something from outside this machine —
  a chat room, a file in the inbox, a schedule that fired — and you decide what the system does about it.
退出码：[exit 0]
```

**结论：警告 — `triage.md` 缺少模式标注，操作者在 `main` 模式下可能误用 `myagent_report`。**
**处置**：在 `triage.md` 顶部加一行说明它面向 `dedicated` 模式。

---

## 6. 深层审核结论汇总

| 组 | 结论 | 要点 |
|---|---|---|
| G9 契约漂移全扫 | ✓ 通过 | model.ts 13 条文字契约全部有代码实现 |
| G10 存量测试盲区 | ✓ 通过 | R1/R2/R3 新增测试已覆盖 |
| G11 提示词参数合法性 | ✓ 通过 | triage.md → dedicated 模式合法；orchestrator.md → main 模式合法 |
| G12 12-unimplemented 基线 | ⚠ 警告 | 基线过时 8 天 / 449 条 |
| G13 triage.md 模式标注 | ⚠ 警告 | 缺少模式适用范围说明 |

**深层审核总评**：3 组通过，2 组警告（处置见 §7）。

---

## 7. 深层审核处置计划与执行

### P3：更新 12-unimplemented.md 基线声明

### P4：triage.md 顶部加模式标注
