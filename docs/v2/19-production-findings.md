# 第一次生产运行暴露的问题：判断、改进与修法

**来源**：2026-11-05 操作者在日常宿主（3080）上派了两张 Ticket（「搜集信息」`b356ac64`、「信息比对」`19dd5c9c`），
两张都跑到 `done`。这是 myagent **第一次被当作日常工具真实使用**（此前所有真宿主验证都在隔离宿主上、
由验收脚本驱动，请求内容是"写一个小文件然后报告"这种探针）。

**本文的性质**：不是验收报告，是**判断书**。每条给出【事实】（带时间戳与出处）、【判断】（严重度与为什么）、
【修法】（具体到文件与机制）、【优先级】。**凡是我没查证的，标 未核实 并写明查证需要什么。**

**一条前置更正**：我在追踪时说过"第二个 worker 撞到 429 后**自己恢复了**"。**这是错的**——
操作者是**手动让它重建并继续**的。我错的方式值得单独记：
**我从 `ended.outcome = "done"` 推断出"恢复"，而没有问这个 done 是系统挣来的还是人救回来的。**
这与"从一次绿色的闸门推断系统没问题"是同一类错误——**一个终态字段不能证明过程正常**。

---

## 时间线（全部取自 `GET /api/tickets/19dd5c9c…/events` 与 `/api/state`，UTC）

| 时刻 | 事件 | detail |
| --- | --- | --- |
| 04:56:26.932 | `created` | `{triggerId: 664a1550…, via: "session", title: "信息比对"}` |
| 04:56:26.992 | `launched` | `{assignmentId: f50cad90…}`（**60 毫秒**后） |
| 06:23:23.745 | `report` | `{state: "progress"}` |
| **06:47:44.097** | **健康行 `sessions` 转为 not ok** | `LlmError: 429: Rate limit: 60 requests per minute per account. Retry after 28 seconds.` |
| 06:47:44.106 | `turn_ended` | **`{assignmentId}` —— 没有任何原因**（与健康行同一瞬间，差 9 毫秒） |
| 06:57:44.733 | `report` | `{state: "progress"}`（**恰好 10 分钟后**；操作者说这期间他手动让它重建并继续） |
| 06:58:13.238 | `turn_ended` | `{assignmentId, said: "已完成本轮全部可独立推进的工作，正在等子任务 B（AI/知识产权/证券核验）交付后合并…"}` |
| 07:29:13.536 | `report` | `{state: "ready"}` → Ticket `ended`，`outcome: done`，`endedReason: "The worker reported ready"` |

**15:52 时（Ticket 成功结束 2 小时 23 分之后）**，`health.sessions` **仍然是 `ok: false`**，
`at` 仍是 `06:47:44.097Z`，detail 仍是那条 429。

---

## F1【P0】人工救援在 myagent 的记录里完全不留痕，而 Ticket 被记成一次干净的成功

**【事实】** 事件日志的完整序列是 `created → launched → report(progress) → turn_ended → report(progress)
→ turn_ended → report(ready)`。`assignments` 只有一条（`f50cad90…`，state `ended`），`launched` 只发生过一次，
`ended.by = "agent"`、`endedReason = "The worker reported ready"`。
**而实际发生的是**：worker 在 06:47 因上游 429 失败，**操作者在 DSH 里手动让它重建并继续**，
之后它才在 07:29 报 ready。

**【判断】严重。** 这不是"少记了一条日志"，而是**记录与事实相反**：
任何读这张 Ticket 的人（包括三个月后的操作者本人）都会得出"worker 自己跑完了"的结论。
而 429 这个**唯一能解释中间那两次 `turn_ended` 的东西**，只存在于一条**按设计是"此刻"信号、
且现在已经过期近三小时**的健康行里。

本项目对"审计记录里的一句假话"已经处理过五次（S33 的拒绝理由、S37 的两处、`reply_unroutable` 的措辞、
§4.26 的声称）。**这一条比那五条都严重**，因为那五条是措辞错了，这一条是**过程被抹平了**：
一次需要人救援的失败，在记录里与一次顺利的成功**不可区分**。

**【修法】** 分三层，按代价从小到大：

1. **`turn_ended` 的 detail 必须带原因**（`src/app/sessions.ts` 写这条事件的地方）。
   DSH 的 `turn/end` 事件带 `reason`；现在 detail 只有 `{assignmentId}`，
   而 seq=6 那次却带了 `said`——**说明有原因的场合是能取到的，只是没有一致地取**。
   把 `reason`（以及 429 这类上游错误的原文）写进 detail。这是最小、最直接的修复。
2. **给"人干预过"一个事实**。操作者的救援发生在 DSH 会话里，myagent 看不见——
   所以不能靠自动检测。可行的两条：
   - 面板与 API 上给 Ticket 一个**人工标注**入口（"这张被人救过"），写进事件日志（新类型如 `human_assisted`）
   - 或者让 `turn_ended` 之后的**恢复**本身成为一个事实：如果一个 assignment 在 `turn_ended` 之后
     又产生了 report，就在日志里记一条 `resumed`，把"中间断过"显式化
   **我倾向两条都做**：前者记"人做了什么"，后者记"系统观察到什么"。
3. **`endedReason` 不该在有过中断时说 "The worker reported ready"**。
   它可以仍然是 ready，但 Ticket 的收尾应当能看出路上出过事——
   最省的办法是 `ended` 事件的 detail 里带上"本 assignment 有过 N 次 `turn_ended`"。

> **【第 50 轮更正：上面第 3 条修法没有落点】** `ended` 事件**只在级联路径上写**（`engine.ts:1124`）；
> 一张因 worker 报 ready 而结束的 Ticket **只记 `report{state:'ready'}`，根本没有 `ended` 事件**，
> 所以"在 `ended` 的 detail 里带中断次数"无处可写。**而这条的目的已由另外两处达成**：
> `turn_ended` 的 detail 现在带 `reason` 与 `error`，加上新的 `resumed` 事件，
> 本次生产运行的序列现在读作 `created → launched → report → turn_ended{reason:error, error:LlmError: 429…}
> → resumed → report → turn_ended{said:…} → resumed → report(ready)`——**中断可见两次**。
> 要给 ready/dropped 路径也补一个 `ended` 事件是**更大的改动**（会移动套件里每一条事件序列断言），**本轮未做**。

**【优先级】P0**。理由：审计真相是这个系统存在的理由之一（"所有副作用有执行与失败记录"是硬规则），
而这条恰好是**失败记录被成功记录覆盖**。

---

## F2【P0】`sessions` 健康条目粘住了——一张已成功结束的 Ticket 在板上"正在失败"近三小时

**【事实】** `health.sessions` 在 06:47:44.097Z 转为 not ok（429），
到 **15:52 仍然 not ok、`at` 未变**。期间：该 Ticket 在 07:29:13 成功结束、
`counts.open` 归 0、`workerSlots.used` 归 0、`effects` 条目每轮都被重写成 `no effect failed in this pass`
（第 43 轮那套语义**在 `effects` 上确实生效了**，实测 `at: 05:48:09Z`）。

**【判断】严重，而且它是第 43 轮那次修复的漏网之鱼。** 第 43 轮把 `effects` 与 `delivery` 两个条目
改成了"此刻"语义（安静的 pass 会自清），**但 `sessions` 不在那次范围内**。
后果比 `effects` 那次更刺眼：**面板顶部会一直挂着一条"某 Ticket 429 限流"，
而那个 Ticket 两个半小时前就成功做完了。** 操作者会去查一个不存在的问题——
而这正是"永久的假警报"（S38 那一类）。

**顺带证实了一件好事**：第 43 轮的语义在生产上是对的（`effects` 自清、`delivery` 显示
"the last delivery went through" 且时刻比 `ended` 晚 158 毫秒）。**修好的那部分确实работает。**

**【修法】** 与第 43 轮同一套模式，扩到 `sessions`：
在 `src/app/runtime.ts` / `src/app/sessions.ts` 里给这个条目加 pass 级的 `complained` 标志，
安静的 pass 写一句"此刻"的摘要（例如 `N session(s) tracked, none failing`）。
**注意 `sessions` 与 `effects` 的一个区别**：它的问题是按 Ticket 报的，
所以"自清"要能区分"那张 Ticket 的事过去了"与"另一张 Ticket 出事了"——
最省的做法是**把问题按 Ticket 记账**（一个 Map），摘要由 Map 生成，
Map 在 Ticket 结束时移除该项。**不要用一个共享槽位**，
那正是 N9（Watchdog 的升级被无关 Ticket 覆盖）的成因。

**【优先级】P0**（与 F1 并列）。它是操作者每次打开面板都会看到的一条假话。

---

## F3【P1】如果操作者当时没有手动干预，系统**永远不会发现**那个 worker 死了

**【事实】** 三个机制同时是关的或够不着：
- `settings.watchdog.silentMs = **0**` → **静默 worker 探测器整个是关的**（第 24 轮的设计：0 表示不启用）
- `watchdog.launchStuckMs = 600000` 只管**启动卡住**；这个 worker 启动成功了（60 毫秒），所以 Watchdog 对它无事可做
- **预算上限不存在**（P6 的已知缺口：用量可见、不可拦）。两张 Ticket 各烧了
  **12,486,267** 与 **10,432,355** token、各跑了 **87 / 93 分钟**，没有任何机制对此说话

**而 `turn_ended` 没有让 Ticket 进入 attention**：全程 `attention: 0`、`waitsForPerson: false`。

**【判断】我原先写的是"严重，且一处未核实：`turn_ended` 之后不落 attention 可能是缺口，若是则升 P0"。
查证之后，这个判断错了一半，而真的问题在别处。以下全部有 `file:line`。**

**`src/app/runtime.ts:838-850` 有两个分支，两个都会把人叫来**：
1. **"a Session DSH will not run"**（blocked 且没到达模型）→ 健康行 +
   `engine.report(ticketId, {state:'failed', summary: UNRUNNABLE_SESSION})`，
   而注释明写这么做是为了 **"puts it in front of a person"**，而不是记成 `waiting`
   （因为 `waiting` 看起来像"活还在进行"，会诱发一次不可能成功的重试）。
2. **其余"回合结束但没有报告"** → `engine.turnEnded(...)`，注释明写
   **"is recorded as waiting, with the worker's last word as its summary"**——
   **而 `waiting` 是会升 attention 的**。

**所以"worker 猝死不可发现"这个说法是错的**：本次运行里 06:47:44.106 那次 `turn_ended`
应当已把 Ticket 置为 `waiting`；15:52 看到 `attention: 0`，是因为 06:57:44 那次
`report(progress)`（操作者手动救回来之后）把它清掉了，最后 07:29 的 `ready` 让它 `done`。
**这条链是通的，我原先的严重度判断过高。**

**但真的问题在这里，而且它比我原先说的更具体**：
那条 429 的健康行来自 **`agent/error` 监听器**（`runtime.ts:853-857`），
它的 detail 是 `${ticketId}: ${reason(error)}`——与分支 1 那句固定文案不同，所以能认出来。
而那个监听器**只做两件事：记一行健康问题、打一条 warn 日志。它完全不碰 Ticket。**

**后果**：上游 LLM 错误（429、以及任何 `agent/error`）**在 Ticket 的记录里没有任何痕迹**。
Ticket 确实进了 `waiting`，但它带的是"worker 的最后一句话"作为摘要，
**而不是"因为上游限流而停下"**。操作者在面板上看到一张 `waiting` 的 Ticket，
要想知道为什么，必须去健康板翻那条 429——**而那条 429 正被 F2 那个粘住的条目拖着，
会在三小时后仍然挂在那里、也可能被别的事覆盖**。

**所以 F3 的正确表述是**：不是"发现不了"，而是**"发现了，但原因没有跟着 Ticket 走"**。

> **【第 50 轮更正：F3 里我写错了一个前提】** 我说 `runtime.ts:849`"只在回合结束而没有报告时才调
> `turnEnded`"。**实际是每一个非 blocked 的回合结束都会调**，而且 `turn_ended` 记在 `stale` 检查**之前**
> （那个检查决定要不要写一份合成的 `waiting` 报告）——**所以 worker 报过告的回合也会写 `turn_ended`**。
> 生产数据就是证据：seq=6 的 `turn_ended{said:…}`（06:58:13）紧跟在 06:57:44 那次 report 之后。
> **"report 出现在 turn_ended 之后"这个信号仍然精确，但理由不同**：报告只能在一个回合内部产生，
> 所以同一 assignment 上"回合结束之后的报告"意味着**会话被再次唤醒**。
这与 F1 是同一件事的两面：**原因只活在健康板上，而健康板是"此刻"信号。**

**仍然成立的那一半**：`silentMs = 0` 意味着**如果一个 worker 在回合中间挂住**（不是回合结束、
而是一直不结束），**没有任何机制会注意到**——`turn_ended` 那两个分支都要求回合**已经结束**。
预算上限也确实不存在（12.5M / 10.4M token、87 / 93 分钟，无机制说话）。

**【修法】**（按更正后的判断重排）
1. **把 `agent/error` 的原因写到 Ticket 上**（`runtime.ts:853-857`）：在记健康行之外，
   给 Ticket 记一条事件（新类型如 `worker_error`，或复用 `turn_ended` 并在 detail 里带 `error`）。
   **`Engine.turnEnded` 的签名现在只有 `(ticketId, assignmentId, said?)`**（`engine.ts:558`），
   detail 是 `{assignmentId, said}`——**它根本不接受原因**，所以要连签名一起改。
   这一条同时是 F1 的修法第 1 项，**两条应当合并成一个改动**。
2. **给 `silentMs` 一个非零默认值**（例如 900000 = 15 分钟），并且**必须比正常工作的静默间隔长**：
   本次运行里最长的正常静默是 10 分钟（06:47→06:57，而那段其实是失败期），
   两次 report 之间最长间隔是 87 分钟（04:56→06:23，worker 一直在用 bash 干活）。
   **所以阈值不能只看"多久没报告"，要看 `progress.lastEventAt`**——第 24 轮的实现正是这么做的
   （`progress().lastEventAt ?? startedAt ?? createdAt`），这一点是对的。
   ⚠️ **但 `silentMs` 这条路从未在真宿主上验证过**（记录在案），
   而且它的动作是**打断 worker**，所以启用前必须先在隔离宿主上验一次。
3. **预算上限**：这是 P6 的实质缺口。最小可用版本是"软上限"——
   超过 N token 或 M 分钟时**记一条事件 + 上一行健康问题 + 让 Ticket 进入 attention**，
   而不是杀掉它。**杀掉的权力应当留给人**，因为本次运行证明了长任务是正常的（90 分钟、1200 万 token 做出了 78 个产物）。

**【优先级】P1**，其中第 1 步（查证）应当立刻做，因为它可能把这条变成 P0。

---

## F4【P2】`sends.nowhere` 对 session 通道会单调增长，而这个数将不说明任何事

**【事实】** 两张 Ticket 结束后 `counts.sends = {queued: 0, nowhere: 2}`。
两者都来自 `via: "session"`，而 **session 通道从不设置 `replyTo`**（只有 chat 通道设）。
契约 §3.3 的要求是"没有 `replyTo` 时 `send` 什么都不做，但要可观测"——**这一条实现得对**，
第 48 轮的验收也在隔离宿主上量到过 `nowhere` 从 0 变 1。

**【判断】中。实现符合契约，但契约本身有个没想到的后果。**
`nowhere` 现在混了两种完全不同的情形：
- **"这个通道天生是单向的"**（session、cron、inbox）——**每张 Ticket 都会 +1，永远如此**
- **"本该有地址却没有"**——真正值得看的那一种

**所以这个计数会随使用单调增长，而它增长的原因与"出了问题"无关。** 一个只会涨、且涨的原因是正常的数字，
比没有数字更坏：它会训练人忽略它。

**【修法】** 两个方向，我倾向第二个：
1. 让 session 通道也带 `replyTo`（指回主 Session），于是回复真的能送回去。
   **但这与"主 Session 已经会收到通知"重复**——`delivery` 条目显示通知确实送到了
   （"the last delivery went through"，比 `ended` 晚 158 毫秒），所以再发一次是噪音。
2. **把 `nowhere` 拆成两个数**：`nowhereByDesign`（Trigger 的 kind 属于单向通道）与 `nowhereUnexpected`
   （kind 是双向的、却没有地址）。**只有后者值得显示在面板上**，前者可以只在详情里给。

**【优先级】P2**。它不影响正确性，影响的是"这个数字能不能被信任"。

---

## F5【P2】S28 的活体实例：一条上游 429 会让 `verify-live.sh` 报红

**【事实】** `health.sessions` 现在是 not ok（那条 429）。`scripts/verify-live.sh` 第 4 步
**对任何健康问题都 exit 1**，不区分"上游限流"与"myagent 真的坏了"。
**所以现在跑那个脚本会报红，而系统其实是好的。**

**【判断】中，而且 F2 修好之后这条会自动缓解**（粘住的假警报消失，脚本就不会被过期条目绊倒）。
但**区分本身仍然要做**：429 是上游的事实，不是 myagent 的故障，
把它当成故障会让人去查 myagent——**而"以为系统坏了"的代价是去查系统**（与配方里写错命令同一类）。

**【修法】** `verify-live.sh` 第 4 步改成**分类**：把健康问题按 detail 分成
"上游/外部"（429、rate limit、network、ECONNREFUSED 之类）与"内部"，
只对内部问题 exit 1，外部问题**打印但放行**（并且要求它们的 `at` 在最近 N 分钟内，否则也算问题——
一条三小时前的 429 说明的不是限流，而是 F2 那个粘住）。

**【优先级】P2**，但**排在 F2 之后**：先修粘住，再修分类，否则分类逻辑要处理"过期条目"这个本不该存在的情形。

---

## F6【P2】晚到的跨 Ticket 修正没有回路

**【事实】** 「信息比对」产出了 `analysis/04_给搜集信息Ticket的口径修正.md`，
**写给「搜集信息」那张 Ticket**——而那张在 **71 分钟前就已经 `done`**（06:18 vs 07:29）。
`ended` 是终态，所以这份修正**没有送达任何人**。
另外两张的 `notes` 与 `inputs` 都是 **0**：**`myagent_note_ticket` 一次都没被用**，
协作是靠 `myagent_read_artifact` 读对方产物完成的。

**【判断】中，而且这是第一次在生产上看到 P3/P5 的真实用法。**
好消息：**跨 Ticket 的产物引用真的被用到了**（summary 明写"与另一 Ticket（搜集信息 / b356ac64）的业务信息合并"），
这是 P5 第一次在真实工作里被行使，此前只有离线测试与隔离验收。
坏消息：**协作是单向且无回路的**——B 读到了 A 的产物，B 对 A 的修正意见却无处可去。

**【修法】** 三个层次，按代价：
1. **最省**：面板在 Ticket 详情里显示"有别的 Ticket 的产物提到了你"
   （扫 `artifacts` 的 note 里的 Ticket id / 标题）。**本次就能work**，因为 note 里明写了 `b356ac64`。
2. **中等**：允许对一张**已结束**的 Ticket 追加 input（`myagent_note_ticket` 现在要求 Ticket 在跑），
   并让面板显示"这张结束后收到过 N 条留言"。**不重启它**——结束是终态这条不变量要保住。
3. **完整**：规则来源（`rule` Source）本来就能"由一次结束发起下一件工作"，
   所以"把修正意见变成一张新 Ticket"是已有能力的组合，缺的只是**让 worker 能触发它**
   （现在 rule 只由设置里的规则触发，worker 无法主动请求"为那张 Ticket 开一张后续"）。

**我倾向先做 1**（一天的活、立刻有用），把 2/3 记进交付物 8。

**【优先级】P2**。

---

## F7【P2】`myagent-worker` preset 可以被操作者选中，而选中之后得到的是一个 myagent 不追踪的会话

**【事实】** 操作者本次的使用就是从这里开始的：在 DSH 里开了个新会话、选了"myagent 模式"，
任务跑起来了，而**面板上什么都没有**。原因是 `cordis.patch.yml` 注册的 preset
（`id: myagent-worker`、name "myagent worker"）带的是 **worker 提示词与三个 worker 工具**
（`myagent_report` / `myagent_read_artifact` / `myagent_note_ticket`），
而**工作进入 myagent 必须经过五个来源之一产生 Trigger**；
`src/sources/session.ts` 的注释写得很清楚：**没有轮询，是主 Session 的工具调用 `Engine.createTicket`**。

**【判断】中，是易用性缺陷而不是功能缺陷**，但它的代价很具体：**操作者以为派了活，而系统里什么都没发生。**
更糟的是那个会话里的模型会按 worker 提示词去调 `myagent_report`，而背后没有 Ticket，
于是得到一次 `refusal`——**看起来像 myagent 坏了**。

> **【第 50 轮更正：上面这段是我的预测，不是观测，而它是错的】**
> 实现者对操作者那个会话做了取证（`<session:8b279992a38b>-…`，本地 12:18–13:08，
> `agentPreset: "myagent-worker"`，标题「<操作者当时那个会话的任务标题>」）：
> **677 个事件、113 次工具调用、myagent 工具调用 0 次、一个回合、`turn/end` 原因 `completed`**，
> 而它的系统消息**只带 preset 的 persona 前缀，没有 myagent 的提示词段**。
> 原因是 `sessions.ts:336`：**myagent 只在"某张 Ticket 的 worker"上注册那三个 worker 工具**，
> 所以**一个不是它派出去的会话根本看不到 `myagent_report`**——那次拒绝会是
> **DSH 自己的"未知工具"措辞，myagent 无法改写**。
>
> **我犯的是把一个推断写成了发现**：原文用的是"会…去调"（预测语气），却被放在【事实】段里与实测数据并列。
> **这份文档的全部价值在于每条都可核，而一条混进事实段的预测会污染整份文档的可信度。**
>
> **实际修的是 myagent 真会产生的那些拒绝**：(a) `tools.ts` 的 `refusal()` 给两个意为
> "这次调用背后没有在跑的 Ticket"的码（`ticket_missing`、`ticket_ended`）加了一个 `next` 字段，
> **点名三个真实入口**（面板「派活」／主 Session `myagent-main`／inbox 目录）；
> (b) `sessions.ts` 的工具守卫（worker 会话在 Ticket 结束后被拒时说的话）也点名同样三条路。
> **`myagent_report` 仍然抛出而不是返回 refusal**（被 `tools.spec:331` 与 `flow.spec:113` 钉住），未改。

**【修法】**
1. **查 DSH 的 preset 机制能否把 `myagent-worker` 从选择器里隐藏**（只供 myagent 内部创建会话时用）。
   **未核实 DSH 是否提供这个能力**——需要读 `@deepseek-ai/dsh-agent-preset` 的 manifest schema。
2. 如果不能隐藏，**改 preset 的 name 与描述**，让它自己说明"这不是操作者入口"，
   例如 name 改成 `myagent worker (内部：由 myagent 派活时自动使用)`。
3. **`myagent_report` 在没有 Ticket 时的 refusal 措辞要指路**：
   现在它说的是"没有这张 Ticket"之类；应当说
   **"这个会话不是 myagent 派出来的 worker。要派活请用面板的「派活」、或在与主 Session（`myagent-main`）的对话里建 Ticket。"**
   ——**一条拒绝消息是一个教学机会，而这次它教错了方向。**

**【优先级】P2**，但第 3 条（refusal 措辞）**很便宜，可以立刻做**。

---

## F8【P3】`session_bound` 事件从不写入，assignment 上没有 sessionId

**【事实】** `assignments[0]` 的键是 `['at','id','report','state']`——**没有 sessionId**。
而 `GET …/progress` 能给出 `sessionId: "worker-19dd5c9c…"`，因为它是**按命名约定推导**的。
`TicketEventType` 里的 `session_bound` **声明了但从来没有写入点**（§4.7 记过，本轮在生产数据里看到了后果）。

**【判断】低到中。** 现在能靠 `worker-<ticketId>` 的约定反推，所以不影响使用；
但**审计链是断的**：从"某个 DSH 会话"回溯到"哪张 Ticket"只能靠命名约定，
而约定不是记录。**如果哪天 worker 会话的命名方式变了，这条链就静默断掉。**

**【修法】** 在 `promptWorker` 绑定会话时写一条 `session_bound` 事件（detail 带 sessionId），
并把 sessionId 回填到 assignment 上。**事件类型已经存在，缺的只是写入点**——这是一个很小的改动。

**【优先级】P3**。

---

## F9【P3】`progress.turn` 的语义不明（未核实）

**【事实】** 12:57 时两张的 `progress.turn` 都是 `1`；13:47 时都是 `None`。
**【判断】低**，但**我不猜**。查证需要读 `progress()` 的实现，看 `turn` 是"当前回合序号"
还是"距上次事件的回合数"，以及什么条件下它不存在。
**【修法】** 查清后要么补上语义（让它在整个生命周期里都有意义），要么从 API 去掉。
**一个含义不明的字段比没有这个字段更坏**，因为读的人会假设一个含义。

---

## F10【已关闭】`reports` 只有 1 条而 `report` 事件有 3 次——**不是缺陷**

我上一轮把这个标为未核实。**现在查清了**：`assignments[0].report` 是字符串 `"ready"`（最终状态），
顶层 `reports` 是**每个 assignment 的最终报告**，而**三次 report 的完整历史在事件日志里**
（seq=3 progress、seq=5 progress、seq=7 ready）。
**所以"事件日志是完整历史、`reports` 是终态"这个分工是自洽的**，不需要修。
**关闭。**

> 记这一条是为了留个规矩：**"未核实"必须要么被查实、要么被撤回，不能就这么留着。**
> 留着的话下一个读者会以为它还是个问题。

---

## 汇总与建议顺序

| | 问题 | 严重度 | 优先级 | 一句话修法 |
| --- | --- | --- | --- | --- |
| F1 | 人工救援不留痕，Ticket 记成干净成功 | **严重** | **P0** | `turn_ended` 的 detail 带上原因；给"人干预过"一个事实；`ended` 的 detail 带上中断次数 |
| F2 | `sessions` 健康条目粘住近三小时 | **严重** | **P0** | 第 43 轮那套 pass 级自清扩到 `sessions`，且**按 Ticket 记账**（不要共享槽位，那是 N9 的成因） |
| F3 | **上游错误的原因没有跟着 Ticket 走**（原判断"猝死不可发现"经查证**过高**：`runtime.ts:838-850` 两个分支都会叫人） | 中-严重 | **P1** | `agent/error` 除健康行外给 Ticket 记一条事件；`Engine.turnEnded` 签名要加原因；`silentMs` 给非零默认；预算做**软上限**（进 attention，不杀） |
| F4 | `sends.nowhere` 单调增长且无意义 | 中 | P2 | 拆成 `nowhereByDesign` 与 `nowhereUnexpected`，只显示后者 |
| F5 | 429 让 `verify-live.sh` 报红 | 中 | P2（**排在 F2 之后**） | 第 4 步按 detail 分类，外部问题打印但放行，且要求 `at` 在近期 |
| F6 | 晚到的跨 Ticket 修正没有回路 | 中 | P2 | 先在面板显示"有别的 Ticket 提到了你"（note 里已明写 id） |
| F7 | `myagent-worker` preset 可被误选 | 中 | P2（**refusal 措辞可立刻做**） | 查能否隐藏；不能就改 name；**改 refusal 措辞指路** |
| F8 | `session_bound` 从不写入 | 低-中 | P3 | 绑定时写事件并回填 assignment（类型已存在，只缺写入点） |
| F9 | `progress.turn` 语义不明 | 低 | P3 | 查清后补语义或删字段 |
| F10 | `reports` 计数 | — | **已关闭** | 非缺陷：日志是完整历史、`reports` 是终态 |

**建议顺序**：**F2 → F1 → F3 的查证 → F7 的 refusal 措辞 → 其余**。

理由是：F2 是操作者每次打开面板都会看到的假话（最便宜、最刺眼）；
F1 是审计真相（最重要，但要设计"人干预过"这个事实怎么表达）；
F3 的**查证**很便宜而结论可能把严重度抬高，所以要先做；
F7 的 refusal 措辞是一行字符串，而它正好挡住了下一个人的第一次使用。

**一条贯穿全部的事实**：这些问题**没有一个是离线测试能发现的**。
762 条测试全绿、六条闭环在隔离宿主上零证伪、而第一次真实使用就暴露了十条。
**原因不是测试不够多，而是隔离验收的请求内容是探针**（"写一个小文件然后报告"），
它跑的是**顺利路径**；而真实工作是 90 分钟、1200 万 token、撞限流、需要人救、
并且两个 worker 互相读对方的产物。**F1/F2/F3 全都只在"不顺利"时才存在。**

> **所以改进的方向不是"再加测试"，而是让验收包含一次不顺利的运行**：
> 在隔离宿主上用故障注入制造一次 429 式的 worker 失败，
> 然后核对**记录里能不能看出失败过、板上会不会留下假警报、没人干预时会怎样**。
> 第 41 轮的 `StubOptions.notify` 已经证明了这条路可行——**缺的是把它用在 worker 失败上。**
