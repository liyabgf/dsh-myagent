# 架构结构与连通性审核报告

**审核时刻**：2026-11-11 16:20（Asia/Shanghai）

---

## 一、架构定位审核

### myagent 与 DSH 的关系

**设计定位**：myagent 是 DSH 的插件，利用 DSH 的 Session 管理、工具注册、持久化能力。myagent 可以脱离 DSH。

**实际状况**：myagent 对 DSH 有**三层硬依赖**，其中两层没有降级路径：

| 依赖层 | 用途 | DSH 不可用时 | 有降级吗 |
|--------|------|-------------|---------|
| **Session 创建/恢复** | worker 和总管都通过 `sessionController.create()` 创建 | 无法建任何票 | ❌ 无 |
| **工具注册** | myagent 的 17 个工具通过 `agent.ctx.tools.register()` 挂到 DSH Agent 上 | worker 没有报告/笔记工具 | ❌ 无 |
| **持久化** | Session 日志通过 `sessionPersistence` 保存和恢复 | Session 重启后丢失上下文 | ❌ 无 |

**问题**：定位说"可以脱离 DSH"，但代码里**没有任何一行不依赖 DSH 的降级路径**。这不是说必须现在就做脱离——而是说**文档不应该承诺一个代码不支持的能力**。

### 主会话（总管）的单一入口问题

**架构事实**：所有 chat 来的 triage 消息都走 `relay()` → `ensureMaster()` → 同一个主会话。这个会话损坏时，**所有 chat 进来的消息全部卡死**，且 myagent 自身没有检测和恢复机制。

**这次故障的完整链路**：
1. 主会话 `session-051e3501` 在 `2026-11-09` 左右出现工具桥故障（PTC 投影失败）
2. 故障导致**所有**工具调用失败（包括 `bash`、`myagent_create_ticket`、`myagent_close_ticket`）
3. 总管能判断（纯文本推理不需要工具），但**不能执行任何动作**
4. 每次 triage 票进来 → 总管判断正确 → 尝试用工具落地 → 失败 → 重试 → 失败
5. 从操作者视角：消息发了，总管"收到"了（面板上有 triage 票），但**没有任何回复、没有执行**
6. DSH 重启没有修复（因为 Session 持久化保留了损坏状态）
7. 删除损坏 Session 后新 Session 也不工作（effects 队列指向旧 ID）

**根本问题**：myagent 把"主会话"当作一个**长期存在的单例**，没有：
- 检测主会话工具桥是否正常的健康检查
- 主会话损坏时的自动重建机制
- relay 失败时的降级路径（比如：工具不可用就不走 triage，直接建 worker 票）

---

## 二、连通性审核

### 进气路径（5 条来路）

| # | 路径 | 状态 | 断点 |
|---|------|------|------|
| 1 | **chat/telegram** | ✅ 桥在跑，消息能收到 | 心跳文件有时不更新（面板误报） |
| 2 | **chat/qq (DM)** | ✅ 私聊能收到 | — |
| 2b | **chat/qq (群@)** | ❌ 从未收到过 | QQ 平台未推送 `GROUP_AT_MESSAGE_CREATE`（权限问题，不是代码问题） |
| 3 | **inbox** | ✅ 能收到 | `settings.sources.inbox.directory` 是空字符串（不影响，代码用 `machine.inboxDir`） |
| 4 | **cron** | ⚠️ 有排期但从未跑完 | 每次都被重载/分诊打断 |
| 5 | **session（面板派活）** | ✅ 能建票 | — |

### 门禁 + triage

| 环节 | 状态 | 说明 |
|------|------|------|
| gate | ✅ | 纯函数，正常工作 |
| triage 路由 | ✅ | chat → triage 票 → relay 给总管 |
| triage 执行 | ❌ | **总管工具桥损坏，无法执行任何工具调用** |
| triage 降级 | ❌ | **没有降级：工具坏了不会回退到"直接建 worker 票"** |

### 执行（worker）

| 状态 | 说明 |
|------|------|
| worker 票创建 | ✅ 正常 |
| worker Session 创建 | ✅ 正常 |
| worker 工具调用 | ⚠️ **部分失败**——5 张 open 票中 4 张 `report: failed` |
| worker 报告回程 | ✅ Telegram/QQ DM 能发文字和文件 |

**worker `report: failed` 的原因待查**——可能是 Session 损坏的级联效应（effects 队列指向旧 ID），也可能是独立的 worker 问题。

### 出口路径

| 路径 | 状态 | 说明 |
|------|------|------|
| Telegram 文字 | ✅ | |
| Telegram 文件 | ✅ | |
| QQ DM 文字 | ✅ | |
| QQ 群 | N/A | 没有入站就没有回复对象 |
| 面板（无 replyTo） | ✅ | 结果进 RESULT.md 和面板 |

### 效果队列（effects）

| 状态 | 说明 |
|------|------|
| launch effects | ❌ **4/5 失败** | `SessionPersistenceNotFoundError`——指向已删除的旧 Session |
| notify effects | ✅ | 最后一次投递成功 |
| send effects | ✅ | 回信正常 |

---

## 三、断点清单（按严重程度）

### 🔴 P0：总管工具桥损坏（阻塞所有 chat 消息执行）

**现象**：`tool "myagent_create_ticket" parameters must be lossless JSON before schema projection`

**影响**：所有经 triage 的 chat 消息（Telegram DM、QQ DM）进到总管后无法执行任何工具。总管能判断（纯文本推理），但不能落地（不能 `close_ticket`、`create_ticket`、`answer_ticket`）。

**根因**：主会话的 PTC 框架在初始化时绑定全部工具 schema，某次绑定失败后整个工具层永久损坏。DSH 重启不修复（持久化保留了损坏状态）。删除并重建 Session 后，新 Session 也不工作——effects 队列指向旧 ID。

**需要的修法**：
1. **短期**：找到 PTC 投影失败的真正原因（`projectToolSchema(definition, false)` 在哪个工具上抛错）
2. **中期**：加 triage 降级——工具桥不可用时，不走 triage 直接建 worker 票
3. **长期**：主会话健康检查——工具桥故障时自动销毁并重建 Session

### 🔴 P1：worker `report: failed`（4/5 张票失败）

**现象**：4 张 worker 票报告 `failed`，不是 `ready`/`blocked`/`dropped`。

**影响**：worker 执行失败，任务没有完成。

**根因待查**：可能是 effects 队列指向旧 Session 的级联效应，也可能是 worker 自身的问题。

### 🟡 P2：QQ 群消息从未收到

**现象**：QQ 桥日志零条 `GROUP_AT_MESSAGE_CREATE`。

**根因**：QQ 开放平台后台的群聊权限未开启（代码、intents 都正确）。

**修法**：在 QQ 开放平台后台开启群聊能力。

### 🟡 P3：Telegram 长轮询静默停止

**现象**：Telegram 桥进程在跑、心跳在打，但 2+ 小时不收新消息。重启后恢复。

**根因**：长轮询可能在网络抖动后进入不推进状态，外表健康但实际停摆。

**修法**：加"连续 N 次空轮询 + 距上次收消息 > M 分钟 → 自动重启轮询"机制。

### 🟡 P4：cron 排期从未成功跑完

**现象**：排期每次启动后被打断（重载或分诊卡死）。

**根因**：排期被写进了 `TRIAGED_SOURCES`（已修为 `triage.sources` 默认只 chat），但历史的卡死票仍存在。

### 🟢 P5：心跳文件有时不更新（面板误报）

**现象**：桥在跑但心跳文件 mtime 停在前一天。

**修法**：桥的心跳写入逻辑需要检查（可能是写入异常被吞掉了）。

### 🟢 P6：settings.sources.inbox.directory 是空字符串

**现象**：配置里的值是空字符串。

**影响**：无（代码用 `machine.inboxDir`，不读这个字段）。

---

## 四、架构定位的核心问题

**myagent 说"可以脱离 DSH"，但代码没有一行支持这个承诺。**

这次故障的级联链路证明：

1. **主会话是单点**：一个 Session 损坏 → 所有 chat 消息卡死 → 无降级
2. **effects 队列绑定 Session ID**：Session 被删 → effects 找不到目标 → launch 失败
3. **worker 也依赖 Session**：worker 的 `report: failed` 可能是 effects 指向旧 Session 的级联

如果 myagent 真的"可以脱离 DSH"，那么：
- 主会话损坏时应该能降级到"不走 triage，直接建 worker 票"
- effects 队列失败时应该能自动重定向到新 Session
- worker 失败时应该能独立于总管重试

**这些降级路径都不存在。** 定位说"可以脱离"，代码说"离不开"。

---

## 五、建议的优先修复顺序

1. **P0 工具桥**：找到 PTC 投影失败的工具定义，修掉它（或给 triage 加降级：工具坏了不走 triage）
2. **P1 worker failed**：查清 4 张票 `failed` 的根因，修掉 effects 指向旧 Session 的问题
3. **P3 Telegram 轮询**：加自动重启机制
4. **P2 QQ 群**：操作者去 QQ 开放平台后台开权限
5. **架构**：给 triage 加降级路径——主会话/工具桥不可用时回退到直接建 worker 票
