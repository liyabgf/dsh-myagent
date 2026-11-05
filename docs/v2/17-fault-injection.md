# 故障注入：桩里的旋钮、`notify` 欠账的还清、以及 `trigger` 放弃后到底剩下什么

这份文档是**测量记录**，不是设计。`trigger` 那一半该怎么做，§4.35 已经裁定过了（`triggers` 表上一个 `lost`
处置状态，**不写 Decision**），本轮**不实现**——理由同 §4.38：半做完的重构比没做更坏，而加一个联合类型成员
是"改联合类型 + 枚举每一个消费者"的活。这里记下的是**当前状态的实测数字**，好让下一轮照着测量实现，
而不是照着假设实现。

代码事实全部带 `文件:行号`；观测值全部来自本轮实跑（标 **【实测】**），命令在 §7。

---

## 1. 旋钮：`StubOptions.notify`（`tests/helpers/host.ts`）

### 1.1 它注入在哪，以及为什么是那里

```
notify 效果 → delivery.notify (delivery.ts:367)
            → sessions.notify / sessions.relay (sessions.ts:398 / :410)
            → AgentDelivery.send (agent-delivery.ts:96)
            → agent.inject(message)  ← 通知        (agent-delivery.ts:107)
              agent.followup(message) ← 叫醒前台    (agent-delivery.ts:108)
```

`grep -rn "\.inject(\|\.followup(" src` → **全仓库只有这两处调用**，都在 `agent-delivery.ts:107-108`。
所以"让桩的 agent 调用抛"就是让通知路径在**它自己真实的那一步**失败：DSH 接管一个 Session 的消息时抛错，
效果处理器因此失败，队列的 5 次预算、15s/30s/60s 退避、`onPermanentFailure` **一行都没改**地跑完。
生产代码里没有加任何东西：`grep -rn MUTATION src tests` → 0，`src/` 的 sha256 与开工前逐字节相同（§6）。

- `inject` **只**由 `sessions.notify` 走到（mode 是 `{inject}`），即只有通知路径 → 落在任何 Session 上都算。
- `followup` 与 worker 的 launch 提示**共用**，而且两者的 `source.form` 都是 `'relay'`
  （`agent-delivery.ts:103-105`），**按消息形状分不开** → 只在前台上拒绝。
- 前台的身份**不是抄默认 id**，是从被测系统自己的行为学来的：myagent 建 worker Session 一定带
  `agentPreset: WORKER_PRESET`（`sessions.ts:244`），建主 Session 一定不带（`sessions.ts:211`）。
  抄一份 `'myagent-main'` 进桩，就是第 25 轮那种病的形状：旋钮哪天对不上了，它**什么都不拒绝**，
  而所有"放弃"测试照样绿。
- **【实测】旋钮不影响 launch**：`notify: { fails: Infinity }` 下 worker 仍然拿到了它的提示
  （`host.agents.get('worker-<id>').followups` 长度 1）。这条断言写在测试里
  （`fault-injection.spec.ts` 第一条），不是写在文档里就算。

### 1.2 为什么按 Session、不按 Ticket

因为**真实故障就是这个形状**：DSH 拒绝一次 inject，是因为那个 Session 不在了／正在拆／不收消息，
**与这段文字碰巧属于哪张 Ticket 无关**。一个按 Ticket 的旋钮会造出一个生产中不可能发生的故障，
于是"系统能扛住按 Ticket 的通知失败"被证明了，而"前台整个不可达"——无人值守部署真正会遇到的那个——
仍然没被测过。

还有一条机械理由：按 Ticket 就得让桩认得 myagent 自己的 key 格式，而 `key()` 返回的是**光秃秃的 32 位十六进制**
（`core/ids.ts:12-14`），消息 id 是 `myagent:<digest>`，**里面没有任何东西说明它属于哪张 Ticket**。
桩要按 Ticket 拒绝，就得 import `key` 并复制参数顺序——把生产代码的内部格式抄进桩，正是这套桩
在别处刻意不做的事（`KNOWN_GLOBAL_TOOLS` 取自 DSH 自己的报错原文，而不是抄一份 DSH 的清单）。

### 1.3 `fails` 是预算，不是开关；而且它是必填

```ts
readonly notify?: { readonly fails: number; readonly error?: string }
```

- 拒绝**恰好 `fails` 次**，然后接受一次：`fails: 2` = 前台回来了（**必须不留 `notice_lost`**，
  否则一次瞬时故障读起来像丢了一条消息）；`fails: Infinity` = 前台再也没回来（**这才是走到
  `onPermanentFailure` 的那个**）。
- `fails` 必填，是为了让"漏写一个字段"**不可能**悄悄变成"永远失败"。
- 默认错误文本 `'the front desk is not reachable'`，沿用 `engine.spec.ts:918` 已有的措辞。

### 1.4 `host.refusals`：旋钮自己的凭证

每一次拒绝都记 `{session, mode}`。**存在的理由**：一个什么都没拒绝的旋钮会让"放弃"测试因为
自己编出来的理由变绿。§6 的 M3 证明这条断言是**承重的**，不是保险带。

### 1.5 什么变得可测了（此前不可测）

§4.39 记的欠账原话是"`onPermanentFailure → noticeLost` 这段接线本身没有测试"，因为桩里没有让 notify
失败的旋钮。**现在可测的是**：一条被队列彻底放弃的通知，以及放弃之后**必须活下来的东西**
（Ticket 上的事件、事件里的原文、跨重启）。顺带可测的还有别的：任何"效果处理器连续失败到放弃"的场景，
包括 `trigger`（§3）——它此前在离线里根本造不出来。

**它不覆盖的**：桌面横幅。`machineNotification` 自己 try/catch 并吞掉错误（`delivery.ts:424-431`），
所以 `spawn.throws` **不可能**让一个 notify 失败——这也是为什么必须新加旋钮，而不是复用 `spawn`。

---

## 2. `notify` 一半：欠账已还（3 条测试）

`tests/fault-injection.spec.ts`，全部走真实队列（`tries` 用的是 Runtime 自己的 5，不是测试设的）：

| 测试 | 关键断言 |
| --- | --- |
| `records notice_lost on the Ticket with the words that were owed, and the event outlives the health board` | 5 次拒绝都落在 `myagent-main`/`notice`；效果行没了；事件 `by={system,delivery}`、`detail={notice:'report',state:'ready',text:'写好了 digest.md'}`、`error` 含原文；前台 `notices` 为**空**（丢是真的丢）；**清掉健康板后事件仍可读**（这条才是重点） |
| `keeps notice_lost across a restart, which the health line does not` | 重启后：健康板 `[]`，事件**还在**，`text` 还在 |
| `delivers the notice and records no loss when the front desk comes back after two refusals` | 恰好 2 次拒绝；前台**恰好 1 条**通知且含原文（不是 3 条：`AgentDelivery` 只在 agent 真收下后才把 request id 记为已见）；`notice_lost` 为**空**；健康行里没有 `gave up` |

**【实测】放弃那一刻的两处痕迹**：

```
健康行： notify 1cbfc46a9f627faf8fe5c0d3b966ae65 gave up: Error: the front desk is not reachable   (runtime.ts:275)
事件：   {type:'notice_lost', by:{kind:'system',id:'delivery'}, seq:4,
          detail:{notice:'report', state:'ready', error:'Error: the front desk is not reachable',
                  text:'写好了 digest.md'}}                                                        (engine.ts:947-950)
效果行： effectCounts() == {}                                                                       (effects.ts:124)
```

---

## 3. `trigger` 一半：四个问题的实测答案

### 3.0 先说清楚为什么只能用"载荷"这个通道（证据，不是取舍）

`trigger` 的处理器只有一行：`effects.handle('trigger', payload => this.engine.receive(payload as Trigger))`
（`runtime.ts:358`）。逐个查 `receive`（`engine.ts:223-292`）能碰到的东西：

| 表面 | 能不能抛 | 证据 |
| --- | --- | --- |
| 宿主（DSH）调用 | **不能：一个都没有** | `receive` 全程不调 `ctx.*`。`executor.prepare` 是纯函数（`executor.ts:95-98`，只有字符串与 `join`）；`attachmentsOf` 是纯函数（`engine.ts:1099-1104`） |
| 门禁 | **不能** | `grep -n "throw " src/core/policy.ts` → **零命中**，`gate` 是全函数 |
| 事件 / `executor.start` | **不能** | 都是 `tx.afterCommit`（`engine.ts:211`、`:289`），而 afterCommit 的动作是**被兜住**的：`store.ts:547-549` 逐个 try/catch → `deferredFailed` |
| Store（SQLite） | 能 | 唯一真实的 I/O |
| **行里的载荷** | 能 | 处理器对载荷做的是**未经检查的 cast**（`runtime.ts:358`），而载荷是 JSON 文本、跨进程跨版本存在 `effects` 表里 |

**结论**：桩宿主**没有任何东西**可以让 `trigger` 处理器失败——这不是"没想到"，是这条路径真的不碰宿主。
生产中一个永久失败的 `trigger` 只能来自 (a) 行里的载荷不是这个构建能读的 Trigger（升级后残留的行、
写了半个字段的生产者），或 (b) Store 写失败。**(b) 在离线里造不出来**（要让 SQLite 写失败就得让状态目录
不可写，而那会同时让 `failEffect`/`settleEffect` 失败，量到的就不是 `trigger` 而是整个队列坏了）——
这是本轮测量的**已知边界**，写在这里而不是藏着。

所以 §3.1 用 (a)：通过队列自己的入口 `effects.enqueue('trigger', key, payload)` 投一行，
**与 `rule.ts:99` 用的是同一个调用**。故障的原因不是重点，**放弃之后的状态**才是；
而放弃路径是所有 kind 共用的（`effects.ts:122-128`），所以原因不影响下面四个答案。

**对照组【实测】**（同样的入口，投一个可接收的 rule Trigger）：效果行 `{}`、
`decisions` 一条 `accept`、`tickets` 一张 `把摘要发到群里`、
`triggers.get(id).disposition == {state:'accepted', ticketId, decisionId}`。
**没有这个对照组，"什么都没存下来"就什么都证明不了。**

### 3.1 效果行：**没了**

第 5 次失败后 `settleEffect` 删行（`effects.ts:124`）。**【实测】**
`store.pendingEffects('trigger', key) === false`、`store.effectCounts() === {}`。
⇒ **不会再有任何 pass 看这个请求一眼**：不重试、不延后、重启后也不会被 `releaseRunning` 捡回来。

### 3.2 健康行：**只有一行，而且它不是记录**

**【实测】**原文：

```
trigger 6ce6093778b89681cb9170e23056e52f gave up: TypeError: Provided value cannot be bound to SQLite parameter 1.
```

（载荷为 `null` 时是 `TypeError: Cannot read properties of null (reading 'id')`——**注意这两种都在
`engine.ts:224` 的第一次 store 读上抛，也就是在事务开始之前**。）

- 它挂在 `effects` 这一个条目上，**不指向任何请求**：里面只有 effect key（一个 32 位摘要），
  **没有 Trigger 的 id、没有规则名、没有原文**。想知道"丢的是哪个请求"，得拿这个摘要去撞。
- **一次无关的成功能不能擦掉它？** 按健康板自己的契约能（`health.ts:16-17`，`record()` 就是清问题用的）。
  **【实测】**`health.entry('effects').record('an unrelated pass succeeded')` → `health.problems() == []`。
  （但见 §5.2：**当前没有任何代码路径会去 record 这个条目**，所以它实际上一直粘着——
  这比"太容易被擦掉"更糟，两个方向都不对。）

### 3.3 Trigger 行 / Decision 行：**一个都没有**

**【实测】**放弃之后：`store.triggers.get(triggerId) === undefined`、
`store.decisions.get(key('decision', triggerId)) === undefined`、`store.decisions.list() == []`、
`store.tickets.list() == []`。

这一条对下一轮是**硬约束**，因为它推翻了"给那一行加一个 `lost` 状态"的字面读法：

1. **没有行可以更新。** §4.35 说"`triggers` 表，用一个新的处置状态（`lost`）把那个 Trigger 存下来"——
   实测是**根本不存在那一行**，所以实现必须**插入**一行，而插入的内容只能来自 payload。
2. **payload 正是故障源的时候，插不出一个 Trigger。** 上面两种载荷都缺 `id`／整个是 `null`，
   而 `triggers` 表的主键就是 Trigger 的 id。⇒ 需要一个兜底：要么存原始 payload 文本，
   要么用 effect key 当身份。**这个决定 §4.35 没有覆盖，下一轮必须先做。**
3. **不能写 Decision，实测支持 §4.35 的裁定，而且是从另一边支持的**：本轮两种载荷都在事务**之前**抛，
   所以门禁连跑都没跑；而**即使门禁跑过并写下了 Decision**，`receive` 整体在 `tx.atomic` 里
   （`engine.ts:228`），任何后续抛出都会回滚（`store.ts:515-551`），**Decision 一样不会留下**。
   ⇒ 放弃之后想从 store 里重建"门禁当时怎么判的"是不可能的；而写一条新的 Decision 去描述它，
   就是 §4.35 说的"伪造一个从未发生的裁决"。

### 3.4 重启之后：**什么都没有**

**【实测】**（`restart(stateDir)`：同状态目录、新 Runtime、新桩宿主）：
`effectCounts() == {}`、`triggers.get(id) === undefined`、`decisions.list() == []`、`tickets.list() == []`、
`health.problems() == []`。

⇒ **一个被规则请求过的工作，在系统里不留任何痕迹**：进程内只有一行随时会被清掉的健康文本，
磁盘上一个字节都没有。这正是 §4.35 开头说的"被丢在地板上的请求"，本轮把它量到了具体形状。

### 3.5 顺带推出的一条实现要求

唯一还能让 `trigger` 永久失败的另一类原因是 **Store 写失败**（§3.0 的 (b)）。所以 `lost` 那一次写入
**必须自己在 try/catch 里**（照 `notify` 的 `runtime.ts:288-301` 与 `send` 的 `delivery.ts:314-321,348-355`），
否则"记录丢失"这一步会把整轮 pass 一起带走——而 store 坏掉的时候，这一步恰恰是最可能失败的。

---

## 4. 顺带量到的另外两个 kind

### 4.1 `launch`：**是一张失败报告，实测确认，不是假设**

用的是**既存**旋钮，不需要新的：`knownTools: []` → DSH 拒绝 restriction → `sessions.ts:375` 宁可让 launch 失败
也不跑一个不受限的 worker。**【实测】**5 次 `Error: DSH accepts no work tool for a worker Session; refusing to run
Ticket <id> unrestricted` 之后：

- 效果行删了；健康行 `launch <key> gave up: …`；
- Ticket：`assignments.at(-1).report == {state:'failed', summary:"Starting this Ticket's worker gave up after repeated attempts: …"}`，
  `attention.question` 是同一句话，**`ended` 仍是 `undefined`**——等人，不是结束，所以可重试；
- 历史 `created → report(failed)`；
- **前台也被告诉了**：`notices.at(-1).text` 含 `Ticket <id> (no-tools — failed)`，因为 `failed ∈ TOLD`
  （`delivery.ts:29`）——放弃这件事不只落在 Ticket 上；`RESULT.md` 也写了。
- 重启后：`attention` 与失败报告**都在**（它们在 store 里），健康行不在。

测试：`leaves a failed report on the Ticket, and the front desk hears about it`。
既存覆盖只到"第一次失败"（`flow.spec.ts:526-535` 断言 assignment 还 pending + 有健康问题），
以及**直接调 hook**（`executor.spec.ts:301`）——**从队列一路走到放弃**的这条，此前没有测试。

### 4.2 `send`：**两处痕迹都活下来了——引既存测试，不重复**

`chat-send.spec.ts:272-319` 已经把重试拉到放弃，并断言 `reply_lost` 事件与 `REPLY-UNDELIVERED.md`
**都在健康板被清掉之后仍可读**（文件逐字节相同、事件仍 1 条）。本轮**没有**复制它。
它与 `notify` 的差别正是 §4.35 说的那条：`send` 的两处痕迹都挂在一张已存在的 Ticket 上，
而 `notify` 只有事件——`noticeLost` 只写日志，不碰文件系统（`engine.ts:947-951` → `record`）。
**【实测】**通知被放弃之后，Ticket 目录里的 **`RESULT.md` 照样存在、照样含着那句摘要**
（它在通知被尝试**之前**就写了，`delivery.ts:375-379`），所以丢掉的是**"去告诉某人"这一步**，不是那份记录：
目录读起来像"活干完了"，而没有人被告知过。`notice_lost` 的 `text` 截到 400 字（`runtime.ts:296`）就是全部原文。
是否需要一份文件级的逐字副本（照 `REPLY-UNDELIVERED.md`），是一个**尚未裁定的问题**，本轮不做决定。

---

## 5. 量到的两个 `src/` 缺陷（**报告，未修**：文件边界排除 `src/`）

### 5.1 `notice_lost` 对 `policy` 通知**不带原文**——运算符优先级

```ts
// src/app/runtime.ts:295-297
...(notice.summary ?? notice.detail === undefined
  ? { text: String(notice.summary ?? notice.detail ?? '').slice(0, 400) }
  : {}),
```

`??` 比 `===` 松，所以条件是 `notice.summary ?? (notice.detail === undefined)`，**不是**
`(notice.summary ?? notice.detail) === undefined`。三种载荷的实际结果**【实测，node 直接求值】**：

| payload | 得到的 detail | 意图 |
| --- | --- | --- |
| `{summary:'s'}`（报告类通知） | `{text:'s'}` ✓ | ✓ |
| `{detail:'d'}`（**policy 类通知**） | **`{}`——没有 `text`** | `{text:'d'}` |
| `{}` | **`{text:''}`**——一个空字段 | `{}` |

**端到端实测**：让一个 policy 通知失败到放弃，事件是
`{notice:'policy', error:'Error: the front desk is not reachable'}` —— **本来要说的那句话没了**，
与 §4.39 的承诺（"detail 带上…**本来要说的那句话**（截到 400 字）"）直接冲突。
修法是一副括号；**本轮不改**，因为 `src/` 在边界外，而这条缺陷需要它自己的测试（一个 policy 通知的放弃）。

### 5.2 `effects` 与 `delivery` 两个健康条目**永远回不到 ok**

`HealthEntry.record()` 是**唯一**能清掉问题的东西（`health.ts:16-19`）。全仓库的 `record()` 调用点
**【实测 grep】**：`passes`（`passes.ts:59`）、`runtime`（`runtime.ts:684,862`）、`sessions`（`:702`）、
`watchdog`（`watchdog.ts:121`）、以及各 Source（`chat.ts:190,226,279`、`cron.ts:72,107`、`inbox.ts:161,247`、
`rule.ts:112`、`session.ts:23`）。**`effects` 与 `delivery` 一次都没有**——`Effects` 只调 `.problem`
（`effects.ts:125,127,131`）。于是：

- **`runtime.ts:277`、`delivery.ts:299-303` 与 `engine.ts:942-943` 的注释对这两个条目是不成立的**（三处都写着
  "会被下一次无关的成功擦掉"）：
  "那一行会被下一次无关的成功擦掉"——**没有任何成功会去擦它**。
- **【实测】**一个 notify 失败 2 次、第 3 次成功送达之后，健康板**仍然**说
  `notify failed 2 of 5 times: Error: the front desk is not reachable`，并且 `refresh()`（`runtime.ts:862`）
  从此一直报 "1 problem(s)"，直到进程重启。
- 所以那条健康线的真实毛病**不是**"太容易被擦掉"，而是**既粘住又只活在进程里**：
  它既不回答"此刻如何"（一个已经恢复的故障还挂着），也不回答"曾经如何"（重启即消失）。
  **§4.35 要求持久痕迹的结论不变，而且更强了**；变的是理由，理由写错了下一个人就会照着错的理由改。
- 连带：`chat-send.spec.ts:313-314` 与本轮的新测试都是**手工 `record()` 来模拟那次清除**的。
  这是当前唯一能让这两个条目变绿的办法，测试里已经写明这一点，没有假装是系统自己清的。

---

## 6. 变异检验（3 个，全部已还原）

`src/app/runtime.ts` 的 sha256 在开工前、全部变异还原后都是 `75d13ababd02733cc0780f550e9b6837e9979a83e9448140c5536ef5b5f2f41d`；
`grep -rn MUTATION src tests` → **0 命中**。

| # | 变异 | 结果 |
| --- | --- | --- |
| **M1** | `runtime.ts:285` `kind === 'notify'` → `'MUTATION-M1-notify'`（等于撤掉第 40 轮那段接线） | **2 红**：两条 `notice_lost` 测试，`expected [] to have a length of 1 but got +0`。另外 4 条绿——**这是对的**：瞬时那条断言的是事件**不存在**，撤掉写入者不可能让它变红；它的敏感性对着旋钮，由 M3 检查 |
| **M2** | `runtime.ts:293-297` 删掉 `text:` 那一段 | **2 红**，两处都只红在 `- "text": "写好了 digest.md"`。⇒ "带上本来要说的话"在**两条**测试里都是承重的，不只第一条 |
| **M3** | `host.ts:331` `budget.left <= 0` → `>= 0`（旋钮什么都不拒绝） | **3 红**（三条 notify 测试；重启那条被它自己的 `toContain('gave up')` 前置断言先抓住）。**然后按纪律 0.8 追一层**：保持旋钮失效，再把瞬时那条里的 `expect(host.refusals).toHaveLength(2)` 删掉 → **该测试变绿**。⇒ 这条守卫**是承重的，不是保险带**：那条测试里其余每一个断言（前台恰好 1 条通知、`effectCounts() == {}`、没有 `notice_lost`、健康行里没有 `gave up`）**在"什么都没失败"的一轮里同样成立**。没有这一行，这个测试就会用一次根本没有故障的运行，去证明"失败两次再成功不会留下丢失记录" |

M3 的第二步就是第 36 轮 C1/C2 的那个动作：变异红了之后，还要问"是我的测试强，还是环境碰巧帮我"。
这里的答案是**环境会帮倒忙**——一次什么都没失败的运行能把那条测试的所有其它断言全部满足。

---

## 7. 复现

```bash
npx vitest run tests/fault-injection.spec.ts     # 6 条，全绿
./scripts/gate.sh                                # 读退出码，不要 | head
```

重试是**拉前**而不是等出来的（`retryNow()`：按队列自己的读法 claim 到那些正在退避的行，再 `deferEffect` 到过去，
然后 `effects.runDue()`），所以跑一轮 5 次尝试是毫秒级的；**预算 5 是 Runtime 自己的**（`effects.ts:62`），
不是测试设的，被测的接线就是上线的那一份。
