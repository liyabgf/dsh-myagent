# P8 接口契约：扩展接口与聊天 Source

这份文档是**契约**，不是设计散文。它的用途是：实现者（人或子代理）照它写代码，
不需要再问我接口问题；而我照它验收。按第 2 档纪律（跨模块、有接口依赖 → 先定义契约，再分工实现）。

**当前代码事实**（本轮实测，不是记忆）：

```ts
// src/core/model.ts:4
export type SourceKindName = 'cron' | 'inbox' | 'session' | 'rule'   // 闭合联合

// src/core/model.ts:7-12
export interface Actor {
  /** Stable identifier in its Source's own identity space, such as `operator` or a chat user id. */
  readonly id: string
  /** `person` may originate work; `system` may not, unless the Policy allows it. */
  readonly kind: 'person' | 'system'
}

// src/core/engine.ts:126-131
export interface Delivery {
  report(ticket: Ticket, report: Report): void
  policyChanged?(ticket: Ticket, effect: PolicyEffect): void
}
```

注意 `Actor` 的注释**已经预期了聊天身份**（"a chat user id"），但没有任何代码路径能产生一个。
`Delivery` **没有 `send`**：报告只能去 myagent 自己的前台，回不到请求来的那个平台。

---

## 1. 范围：第一片做什么，不做什么

**做**：一个聊天 Source 的**参考实现**（单实例、可多频道），以及第三方要接入必须实现的那个接口。

**不做**（每一条都要写进 `12-unimplemented.md`）：
- **多实例**。D3 决定是"一个 kind 一个实例"，registry 以 `kind.name` 为键。
  开这个决定是**单独的架构变更**，不在这一片里。第一片：一个 chat Source 实例，内部可以有多个频道。
- 任何具体平台的 SDK 接入。参考实现读一个**本地目录或一个 HTTP 端点**，形状像 inbox 而不是像 Slack。
  理由：接入真实平台会引入凭据、网络与限流，那些是部署问题，会淹没这一片真正要验证的东西（身份映射）。
- 消息编辑、撤回、反应、线程分叉。

---

## 2. 核心问题：平台身份 → 真实 Actor

目标里点名了这一条，而它是**安全问题**，不是接口问题。

**已经知道的反面教材**（`docs/v2/06-security-risk-register.md` §3）：
inbox 的发起者身份来自请求文件**自身**，所以"能写 inbox 目录的人就能以任何被允许的发起者身份提交工作"。
门禁有 `allowedSenders` 名单，但**名单校验的是一个自述的名字**。

**聊天 Source 绝不能重复这个错误。** 契约：

### 2.1 身份必须被映射，不能被推断

设置里有一张显式的映射表：

```jsonc
"sources": {
  "chat": {
    "enabled": true,
    "identities": {
      "U01ABCDEF": { "actor": "alice", "note": "操作者本人" },
      "U09XYZ":    { "actor": "teammate-a", "note": "同事，只允许提交摘要类工作" }
    }
  }
}
```

- 平台 id 是**键**，`actor` 是它在 myagent 身份空间里的名字，也就是门禁 `allowedSenders` 比对的那个字符串。
- **`kind` 不由 Source 决定**：映射表里的每一项都产生 `kind: 'person'`，因为映射本身就是操作者的断言。
  Source 不得因为"这个平台 id 看起来像机器人"就自己判成 `system`——判断权在设置，不在代码。
- **未在映射表里的平台 id，一律不产生 Trigger。** 见 §2.2。

### 2.2 未映射的消息：**留住，不消耗**

这是 S9 / N4 那条教训的直接应用：**门禁拒绝是不可逆的**（Trigger 存成 ignored，
而如果 Trigger id 是消息身份的纯函数，那条消息就**永远不能被重新评估**）。

所以未映射的消息必须走**产出侧**，像 inbox 的 paused/deny 一样：

- 消息**留在原处**（目录里不删，或端点上不 ack）
- **不产生 Trigger，不产生 Decision**
- 健康板上一行：`chat: N message(s) from unmapped identities are waiting`，并列出前几个平台 id
- 操作者把身份加进映射表之后，**下一次扫描就会受理它**——这才是"留住"的意义

**必须有测试**：一条未映射的消息在映射之前不产生 Trigger/Decision、映射之后产生，
且**产生的 Trigger 的 actor 是映射表里的那个名字**（不是平台 id）。

### 2.3 映射改变时，`policyVersion` 必须移动

`identities` 是授权的一部分（它决定谁能发起工作），所以它必须进 `authorizationShape`。

**这一条有前科**：S33 那批 fallthrough 缺陷里，有一条正是"改 rule 的旋钮不改变 `policyVersion`"，
于是收紧授权不会通知任何在跑的 Ticket。`authorizationShape.perSource` 现在从 `sourceKinds(settings)` 派生，
所以**新增一个来源块会自动被包含**——但 `identities` 这个字段本身要确认它进了摘要。

**必须有测试**：改一个身份映射 → `policyVersion` 变化。

---

## 3. `Delivery.send`：报告回到请求来的地方

### 3.1 端口

```ts
export interface Delivery {
  report(ticket: Ticket, report: Report): void
  policyChanged?(ticket: Ticket, effect: PolicyEffect): void
  /**
   * Send a message back to wherever this Ticket's request came from.
   * Optional: a deployment with no two-way Source (cron, inbox) has nothing to send to.
   */
  send?(ticket: Ticket, text: string): void
}
```

**为什么是可选的**：cron 与 inbox 没有"回去的路"，强制实现会让它们写空方法，
而空方法是"已实现"的假象。

### 3.2 它必须走效果队列，不能被内联调用

`send` 的**实现**（在 Runtime 里）必须 `effects.enqueue('send', key('send', ticketId, …), …)`，
理由与规则来源入队 Trigger 完全相同：跨崩溃存活、按 key 去重、有重试与退避。
**内联发送意味着一次网络抖动就永久丢掉那句话**，而"所有副作用有执行与失败记录"是项目的硬规则。

**必须有测试**：`send` 处理器抛错 → 效果行还在、`failures` 递增、健康板有一行；
以及**彻底放弃之后**（超过重试上限）留下什么痕迹——这一条要特别设计，
因为验收已经查出 `notify` 与 `trigger` 两类效果彻底放弃后**除健康板一行之外没有持久痕迹**
（`12-unimplemented.md` / `09-architecture.md` §3.4 标为未核实）。**新的 `send` 不要继承这个缺陷。**

### 3.3 谁知道往哪儿发

Ticket 上已经有 `origin.triggerId`，而 Trigger 上有 `kind` 与 `actor`。
**但 Trigger 不保存"回复地址"**。契约：

- Trigger 增加一个可选字段 `replyTo?: { kind: SourceKindName; channel: string; thread?: string }`
- 它由产生 Trigger 的 Source 填写；**只有填了它的 Source 才收得到 `send`**
- `send` 的分发按 `replyTo.kind` 找到那个 Source 实例，调它的 `deliver(replyTo, text)`
- **没有 `replyTo` 时，`send` 什么都不做，并且不报错**——但要能被观测到（计数或日志），
  因为"我以为它发出去了"比"它明确没发"更坏

---

## 4. 扩展接口：第三方要实现什么

```ts
// src/sources/kind.ts 现有的 Source 协议保持不变，聊天 Source 实现它，外加：
export interface TwoWaySource extends Source {
  /** Deliver a message back to the platform. Called by the effects queue, so it may be retried. */
  deliver(replyTo: ReplyTo, text: string): Promise<void>
}
```

**myagent 向 Source 保证的**（这些是接口的一半，必须写进文档，否则第三方无法依赖）：
1. `start()` / `stop()` 各调用一次，`stop()` 之后不再有回调
2. `summarize()` 会被周期性调用；**它返回的摘要不得擦掉自己刚记录的问题**
   （这个 bug 在 cron 与 rule 各出现过一次，见 S19 / N5）
3. 一次 `settings` 变更之后 `signatureOf(kind, settings)` 必须变化，否则 registry 不会重启它
   （**第三处 fallthrough 前科**：`rule` 曾经读的是 session 块）
4. **deny / paused 必须在产出侧生效**，不能交给门禁（S9 / N4）
5. Source 内部抛出的异常不得影响其它 Source（registry 逐个隔离）

**Source 必须自己保证的**：
1. 身份不经映射不得成为 Actor（§2）
2. Trigger 的 id 必须是**它所标识之物的纯函数**（消息 id，不是时间戳；见 S31）
3. 副作用一律入队，不内联（§3.2）
4. 重复投递同一条消息必须幂等

---

## 5. 设置块的形状

```ts
sources: {
  chat: z.object({
    enabled: z.boolean().default(false),
    acceptMode: …, paused: …, allowedSenders: …, deny: …,   // 与其它来源同一组 SourcePolicyFields
    identities: z.record(z.string(), z.object({
      actor: z.string().trim().min(1),
      note: z.string().optional(),
    }).strict()).prefault({}),
    channels: z.array(…).prefault([]),
  }).strict().prefault({}),
}
```

**两条硬性要求，都有前科**：
- **每个新字段都必须有默认值，且块本身要 `.prefault({})`**。
  否则一份**已经存盘的**设置文档解析失败 → Runtime 构造函数抛错 → `apply` 记一行日志就返回 →
  **插件静默什么都不做**。这是本项目发生过的最坏的失效模式（看起来一切正常，其实整个插件没启动）。
- **`sourcePolicy(kind, settings)` 必须读 `settings.sources[kind]`，不能有 ternary 兜底**；
  `sourceKinds(settings)` 与 `signatureOf(kind, settings)` 必须从 `settings.sources` **派生**。
  S33 那批缺陷是三处 fallthrough，症状包括"停用 session 会静默停用 rule"和
  "拒绝理由说 rule 未启用，而它其实启用了"（**审计记录里的一句假话**）。

---

## 6. 测试义务（每条状态转换都要有测试）

| 转换 | 必须断言 |
| --- | --- |
| 已映射身份的消息 → Trigger | `actor.id` 是映射表里的名字、`kind` 是 `person`、Trigger id 是消息 id 的纯函数 |
| 未映射的消息 | **不产生 Trigger、不产生 Decision**；消息**仍在原处**；健康板有等待行 |
| 未映射 → 映射之后 | 同一条消息**被受理**，且只受理一次 |
| 改 `identities` | `policyVersion` **变化** |
| `paused` / `deny` | 产出侧不产生任何东西、**消息留在原处**；解除后**被留住的那条与下一条都被受理**。⚠ 本文原先写的是"不复活已过去的那条，与 rule 同理"——**那是为瞬时事件写的，对文件型来源不成立**：rule 读的是事件，事件过去了就没了；chat 读的是文件，文件不会过期。**"留住"与"丢弃"的区别正是这一条**，第 36 轮由 C1 的实现者指出并更正 |
| `send` 成功 | 效果行被消耗、Source 的 `deliver` 收到正确的 `replyTo` 与文本 |
| `send` 失败 | 效果行仍在、`failures` 递增、健康板有一行 |
| `send` 彻底放弃 | **留下持久痕迹**（不得只有健康板一行） |
| 无 `replyTo` 的 Ticket | `send` 不做任何事、不抛错，但**可观测** |
| 设置块缺失 | 一份**不含 `sources.chat`** 的旧设置文档仍能解析（`.prefault({})` 的作用） |

**每条新测试都要做变异检验**：把修复撤掉，测试必须变红。
本项目已经有多条"看起来在测、其实测不到"的前科（`expect(true).toBe(true)`、
`it.skipIf` 让守卫在产物缺失时静默跳过、以及第 23 轮那条"测了自己写的方法、没测谁会调它"）。

---

## 7. 验收标准（我按这个验收，不按"代码写完了"）

1. `./scripts/gate.sh` **退出码 0**，测试数不减
2. §6 表里每一行都有一条对应的测试，且**至少三条经变异检验**
3. **一次隔离宿主的真宿主验收**：一条消息从聊天目录进来 → 成为 Ticket → worker 报告 →
   `send` 把报告**送回那个目录**（参考实现的两端都是文件系统，所以闭环可以在真宿主里看见）
4. 未映射身份的那条路径**在真宿主里也走一遍**——它是这一片的安全核心，只有离线覆盖不够
5. `12-unimplemented.md` 更新：这一片做完的移出，§1 里"不做"的每一条移入
6. `06-security-risk-register.md` §3 更新：聊天来源的身份映射是**真边界还是逻辑守卫**要重新判定
   （我的预判：映射表是操作者写的设置，所以它是**逻辑守卫**；真边界仍然是"谁能把消息送进那个目录/端点"）

---

## 8. 分工建议（按 0.7：小任务、明确边界、先落盘）

| 任务 | 文件边界 | 依赖 |
| --- | --- | --- |
| A. 契约落地：`model.ts` 加 `chat` 与 `replyTo`、`Delivery.send?`、`TwoWaySource`、错误码 | `src/core/model.ts`、`src/core/engine.ts`、`src/core/errors.ts`、`src/sources/kind.ts` | 无（纯加法） |
| B. 设置块与门禁：`sources.chat`、`identities` 进 `authorizationShape` | `src/core/policy.ts` | A |
| C. 参考实现：ChatSource + 效果 `send` 处理器 + Runtime 接线 | `src/sources/chat.ts`（新）、`src/app/runtime.ts`、`src/app/effects.ts` | A、B |
| D. 面板：聊天来源的状态、未映射消息的等待队列、身份映射的编辑 | `panel/index.html`、`tests/panel.spec.ts` | C |
| E. 真宿主验收 | `docs/v2/16-*.md`（新）、`/tmp/…` | C |

**A 必须先完成并合并**，因为 B/C/D 都依赖它的类型。A 与 B 可以由同一个人做（都是 core）。
**C 与 D 不得同时改 `runtime.ts`**——D 只碰面板。
E 在 C 之后，且**开跑前钉住产物哈希**（上一轮验收这么做了，所以没有一条结论需要标"待复验"）。
