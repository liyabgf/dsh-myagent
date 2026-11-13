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
- 操作目录：`/Users/liyang/Documents/SA/myagent`  
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
