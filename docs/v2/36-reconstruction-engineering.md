# 36 · 重建工程（v0.17.1 → v0.18.0）

> **工程背景**：本轮重建由一次操作事故引发。
> 2026-11-13 02:01（Asia/Shanghai），执行者在未确认目录身份的情况下对工作仓库执行了
> `rm -rf myagent` 并立即用远端克隆覆盖，导致约 10 亿 token 对话所积累的代码、测试、文档全部丢失。
> 丢失内容包括：D1–D3 三批改动（约 8 个源文件数百行）、1247→1259 条测试的增量、
> `docs/v2/35`（工程备案）、3 个 git 提交（`4b387e4`、`2f3af10`、`6183b07`）及完整变异检验历史。
>
> **本文档的作用**：作为重建工程的**唯一物理总控文档**，
> 记录基线、迭代清单、执行纪律、操作日志、验收证据。
> 未在本文档记录的操作，视同未发生。

---

## 0. 核心教训（永久置顶）

| # | 教训 | 触发事件 | 防护规则 |
|---|---|---|---|
| L-1 | **破坏性命令必须先确认目标** | `rm -rf myagent` 删错目录 | 凡涉及 `rm -rf`、`git rebase`、`git push --force` 的操作，执行前必须：① `pwd` 确认工作目录；② `git remote -v` 确认远端；③ `git log --oneline -3` 确认历史；④ 明确询问用户并等待确认 |
| L-2 | **「远端有更新」≠「本地落后」** | 拉取失败时误判本地为旧版 | 遇到推送被拒时，先 `git log origin/main..HEAD` 查本地超前的提交，再 `git log HEAD..origin/main` 查远端超前的提交，不得在未读懂差异前执行任何破坏性操作 |
| L-3 | **临时工作目录必须定期推送** | D1–D3 在未推送的临时目录里丢失 | 每个批次完成闸门验证后，立即推送到远端分支，不得积压 |
| L-4 | **凡操作必记录** | 中间步骤无法追溯 | 本文档 §5 操作日志每一步都要写：时间、命令摘要、结果摘要 |

---

## 1. 基线（已用真实命令核实，非抄写）

| 项目 | 值 | 核实命令 |
|---|---|---|
| 重建起点提交 | `581c6f2`（修复 QQ 桥 const 赋值错误） | `git log --oneline -1` |
| 版本号 | `0.17.1` | `cat package.json \| python3 -c "import sys,json;p=json.load(sys.stdin);print(p['version'])"` |
| 闸门退出码 | `0` | `./scripts/gate.sh` → `/tmp/baseline-gate2.log` |
| 测试数 | `1198 passed (1198)` | 同上 |
| 产物 sha256 前 16 位 | `3207eff730830e11` | 同上 |
| 产物字节数 | `510584` | 同上 |
| docs/v2 文档数 | `33 份` | `ls docs/v2/*.md \| wc -l` |
| docs/v2 总行数 | `19457 行` | `wc -l docs/v2/*.md \| tail -1` |
| 基线时间 | `2026-11-13 03:15（Asia/Shanghai）` | 对话时间戳 |

---

## 2. 待重建迭代清单

从对话历史中提取的有效工程内容，按批次排列。
每批次完成后在「状态」列打勾并填写提交 hash。

### 批次 R1 · 分诊全链路完整性（对应原 D1）

**根因**：`DeskLoop.relay()` 等整轮 LLM 执行完才 resolve，而 `executor.launch` 原在 `await relay` 之后才调 `assignmentStarted`，导致总管 turn 内调 `myagent_close_ticket` 或超时 `engine.report(dropped)` 时 Assignment 仍是 `pending`，真实 Engine 抛 `assignment_stale`（活体 seq=83, seq=152, 3675fa3b）。同时 `engine.ts` 三处漏拷前序 `role: 'triage'`，插件重载后分诊单蜕变为 worker（活体 `5bd251b9`）。

**改动文件**：
- `src/core/engine.ts`：`answer`、`retryTicket`、`assignmentInterrupted` 三处新建接替 Assignment 时保留 `role`
- `src/app/executor.ts`：`DeskLoop` 接管时先 `assignmentStarted` 再 `await relay(..., ticketId)`；`deliverInputs` 对 `toMain` 分诊单走 `sessions.relay`
- `src/app/runtime.ts`：新增 `usesMainDesk()`；`reconcileGhostTickets` 跳过 main-desk 分诊单；`recover` 对 DeskLoop 下中断的分诊单正确重入队
- `src/app/sessions.ts`：`notify/relay` 签名增加可选 `ticketId`

**测试**：engine.spec（role 继承）、executor.spec（真实 Engine 无 stale）、recovery.spec（重启后 role 保持）、session-decoration.spec（follow-up 路由）

**变异检验**：
- M-R1a：撤掉 `assignmentInterrupted` 的 `role` 继承 → engine.spec + recovery.spec 变红
- M-R1b：把 DeskLoop 分支的 `assignmentStarted` 移到 `await relay` 之后 → executor.spec 变红

**状态**：⬜ 待实现 | 提交：—

---

### 批次 R2 · ticketId 贯通与防回声（对应原 D2）

**根因**：`delivery.ts` 调 `sessions.notify/relay` 时未传 `ticketId`，活体 `desk_messages` 184 行全为 `null`；纯分诊单 `ready/dropped` 结案后 `delivery` 仍走 `relay` 反向唤醒总管白烧 ~100s（活体 seq=166→171）；`orchestrator.md` 第 28 行残留非法 `myagent_close_ticket(state: 'blocked')`。

**改动文件**：
- `src/app/delivery.ts`：policy/escalation/report 透传 `ticketId`；纯分诊单结案走静默 `notify`
- `src/app/runtime.ts`：`askDesk` 透传 `ticketId`；`saveSettings` 动态挂载/卸载 DeskLoop；`prompts.onChange` 热同步
- `src/app/sessions.ts`：`setDeskLoop` 支持传入 `undefined`
- `prompts/orchestrator.md`：修正分诊提问指引（`myagent_reply`/`myagent_raise_decision`，禁 `blocked`）
- `scripts/audit.mjs` + `tests/tool-surface-docs.spec.ts`：`orchestrator.md` 纳入 co-change 双向锁

**测试**：notify.spec（防回声 + 热同步）、delivery.spec（ticketId 路由）、tool-surface-docs.spec（orchestrator 锁）、session-decoration.spec（DeskLoop 切换）

**变异检验**：
- M-R2a：把 `selfClosedTriage` 置为 false → notify.spec + delivery.spec 变红
- M-R2b：往 `orchestrator.md` 写回 `state: 'blocked'` → tool-surface-docs.spec 变红

**状态**：⬜ 待实现 | 提交：—

---

### 批次 R3 · 总管按需工具挂载（对应原 D3）

**根因**：上一版 `edd8612` 传 `tools: []`，模型无工具声明无法返回 toolCalls，被误判为直接回答完成，分诈单悬空。正确方案：首轮挂载 1 个轻量网关工具 `myagent_use_tools`，让 LLM 自主判断是否需要升级工具集。

**改动文件**：
- `src/app/desk-tools.ts`：新增 `DESK_GATE_TOOL_NAME`、`deskGateToolSchema()`
- `src/app/desk-loop.ts`：`processEntry` 首轮传 `toolsMounted=false`；`runTurn` 签名改为 `toolsMounted: boolean`；拦截 `myagent_use_tools` 升级为全套工具；`settleDirectTriageAnswer` 直答自动结案
- `src/app/executor.ts`：更新 `TRIAGE_BRIEF` 文案
- `prompts/orchestrator.md`：补充轻量首轮/直答/按需挂载指引

**测试**：desk-loop.spec（直答 1 轮 + 按需升级 11 工具）、desk-tools.spec（网关 schema）、executor.spec（端到端聊天桥直答写 `out/`、`myagent_reply` 追问保持分诊单打开）、tool-surface-docs.spec（orchestrator 识别网关工具名）

**变异检验**：
- M-R3a：首轮改回全量 11 工具 → desk-loop.spec 断言 `tools.length === 1` 变红
- M-R3b：去掉 `settleDirectTriageAnswer` → executor.spec 端到端直答测试变红
- M-R3c：去掉 `myagent_use_tools` 升级分支 → 复杂分诊派单测试变红

**状态**：⬜ 待实现 | 提交：—

---

## 3. 执行纪律（本重建工程专属，不可绕过）

### 3.1 操作记录规则

**凡操作必记录**：每一步实际执行的命令、时间、结果摘要，记录在 §5 操作日志。
格式：
```
[时间] 操作：<命令或动作摘要>
       结果：<退出码 / 关键输出 / 产物 hash>
       下一步：<依据结果决定的下一步>
```

无记录的操作 = 未发生。后续任何人（包括执行者自己）不得依赖未记录的操作产生的假设。

### 3.2 破坏性操作前置核验（L-1 教训）

在执行以下任意命令前，**必须先执行并记录三条核验命令**，不得跳过：

```bash
pwd                        # 核验当前目录
git remote -v              # 核验远端
git log --oneline -3       # 核验历史
```

破坏性命令清单（不限于）：
- `rm -rf <任何含 .git 的目录>`
- `git rebase`、`git reset --hard`
- `git push --force` 或 `git push -f`
- 任何覆盖未提交改动的操作

### 3.3 推送纪律（L-3 教训）

- 每个批次完成闸门验证（退出码 0）后，立即推送到 `origin/main`，不得积压
- 推送前确认 `git log origin/main..HEAD` 列出的提交数与预期一致
- 推送后立即记录提交 hash 到本文档的批次「状态」行

### 3.4 闸门纪律

- 每个批次在提交前必须跑 `./scripts/gate.sh`，退出码必须为 `0`
- 同时跑 `node scripts/audit.mjs`，11 组全绿
- 闸门结果（退出码 / 测试数 / 产物 hash）记录到本文档 §4 验收证据

### 3.5 变异检验纪律

- 每个批次至少执行本批次清单中的全部变异检验
- 执行方式：`cp <文件> /tmp/<备份>`，改动，跑指定测试，确认变红，`cp /tmp/<备份> <文件>` 还原，`shasum -a 256` 核对逐字节还原
- 结果记录在 §4 验收证据

---

## 4. 验收证据（每批次完成后填写）

| 批次 | 提交 | 闸门 | 测试数 | 产物 hash | 变异检验 | 活体验证 |
|---|---|---|---|---|---|---|
| 基线 | `581c6f2` | ✓ 0 | 1198 | `3207eff730830e11` | — | — |
| R1 | `1bd9c34` | ✓ 0 | 1201 | `6a2fe76481b00185` | M-R1a/b/c ✓ | — |
| R2 | — | — | — | — | — | — |
| R3 | — | — | — | — | — | — |

---

## 5. 操作日志（逐步追加，不得修改已有条目）

```
[2026-11-13 03:15 Asia/Shanghai] 操作：pnpm install（克隆后首次安装依赖）
       结果：退出码 0，Done in 1s
       下一步：跑基线闸门

[2026-11-13 03:20 Asia/Shanghai] 操作：./scripts/gate.sh（基线核实）
       结果：退出码 0 / 1198 passed / 产物 3207eff730830e11（510584 字节）
       下一步：建立重建工程文档 docs/v2/36，开始 R1

[2026-11-13 03:30 Asia/Shanghai] 操作：写入 docs/v2/36-reconstruction-engineering.md
       结果：文件创建成功，包含基线、三批次清单、执行纪律、验收表格、操作日志模板
       下一步：用户确认工程设计后开始实施 R1
```

```
[2026-11-13 03:45 Asia/Shanghai] 操作：R1 提交并推送（git push origin HEAD:main）
       结果：1bd9c34 / 1201 条 / 产物 6a2fe76481b00185（512296 字节）
             变异检验 M-R1a/b/c 均变红并逐字节还原
       下一步：开始 R2（ticketId 贯通与防回声）
```
