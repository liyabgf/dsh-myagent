# 安全风险清单

本清单的目的不是声称系统安全，而是**把每一处守卫的强度说准**。操作者的硬要求是
"不得把逻辑守卫描述为强安全边界"——所以这里给每一处守卫标一个类别，并写明**它是怎么失效的**。

三个类别：

- **真边界**：由操作系统、文件系统或 DSH 宿主强制。myagent 的代码写错了也不会失效，模型也无法靠输出绕过。
- **逻辑守卫**：由 myagent 自己的代码强制。它正确时有效，但它与被守卫的东西在**同一个信任域**里——
  漏掉一次调用、加了一条新路由忘了用它、或者代码有 bug，它就没了。
- **提示词约束**：只是告诉模型该怎么做。**不是控制**。

---

## 1. 最重要的一条：worker 没有沙箱

```ts
// src/app/sessions.ts:27
/** The permission preset of an unattended worker: it must be able to work without anyone to ask. */
export const WORKER_PERMISSION = 'danger-full-access'
```

**这是刻意的设计**，理由写在注释里：无人值守的 worker 必须能在没人可问的情况下工作，
所以边界不是"每次调用都要批准"，而是**工具清单 + 它自己的目录 + 它的 Ticket 何时结束**。

后果必须说清：

- **worker 可以用 shell 做运行它的那个用户能做的一切**——读写任意路径、联网、装东西、改 crontab、
  读 `~/.ssh`、写 `~/.dsh/profiles/*/cordis.patch.yml`（即改自己的预设）。
- Ticket 的 **`scope` 是提示词约束，不是控制**。`myagent_report` 的 schema 也不检查文件是否真的在目录内。
- 所以"把请求交给 myagent"在信任上等价于"把那段文字交给一个有你全部权限的 shell 代理"。

**这不是缺陷清单里可以修掉的一行**，而是这个系统的信任模型。要改它，得改的是
"无人值守"这个前提（例如给 worker 一个受限用户、一个容器、或一个只读挂载的工作区），
那是部署层的事，不是 myagent 代码里加个检查能解决的。

**分级的意义**：在这条之下，所有"路径守卫""越界拒绝"都只防**意外**，不防**恶意**。
它们仍然值得有（意外比恶意常见得多），但把它们说成安全边界就是本清单要防的那种谎。

---

## 2. 守卫清单

| 守卫 | 位置 | 类别 | 它挡住什么 | 它怎么失效 |
| --- | --- | --- | --- | --- |
| **worker 工具清单** | `sessions.ts` 的 `WORKER_TOOLS` | **真边界**（DSH 不注册就不存在） | worker 无法调用面向人的工具、无法改 profile、无法排期、无法直接触及别的 Session | 只在清单被正确维护时成立：往清单里加一个工具就等于授权它。清单里没有"读别的 Ticket 的任意文件"，只有 `myagent_read_artifact`（见下） |
| **单写者锁** | `myagent.lock` | **真边界**（OS 文件锁） | 第二个 myagent 实例挂到同一个 stateDir | 挡不住任意其它进程直接写 sqlite 或状态目录 |
| **`SchemaTooNew` 拒绝打开** | `store.ts` | **逻辑守卫** | 旧构建写入它不认识的 schema | 只保护 myagent 自己；`sqlite3` 命令行不认识它 |
| **同源围栏**（`x-myagent-request` 头 + 回环） | `http.ts` | **逻辑守卫** | 浏览器里的其它站点跨源调用面板 API；误触 | **本机任意进程都能发这个头**。它防的是浏览器与意外，不是本地攻击者 |
| **路径越界守卫** `resolveInside` | `files.ts:53`（15 条测试） | **逻辑守卫** | `../` 与绝对路径逃出 Ticket 目录 | 任何**忘记调用它**的新路由。它是被调用的函数，不是文件系统权限 |
| **产物引用的两处收窄** | `engine.authorizeArtifactRead` | **逻辑守卫** | 跨 Work 读取；读未登记的文件 | 依赖 Work 归属正确。而 Work 归属是**人设的**，设错了就授权错了 |
| **协作通道的 Work 边界** | `engine.noteFromWorker` | **逻辑守卫** | 一个 worker 往任意 Ticket 塞话 | 同上：边界是 Work，而 Work 由人划分 |
| **工具守卫（Ticket 结束后拒绝）** | `tools.ts` 的 guard | **逻辑守卫** | 已结束 Ticket 的 worker 继续改状态 | 它拦的是 myagent 自己的工具。worker 的 shell 不受它管（见 §1） |
| **门禁：`allowedSenders`** | `policy.gate` | **逻辑守卫** | 不在名单上的发起者 | 见 §3：inbox 的发起者身份来自请求文件本身 |
| **门禁：系统 actor 两道关** | `policy.gate` | **逻辑守卫** | 没人写的工作被自动授权 | 两道关都是设置项。设置是操作者可编辑的 JSON，改它就改了授权 |
| **按来源 deny/pause 在产出侧** | `cron.ts` / `inbox.ts` / `rule.ts` | **逻辑守卫** | 暂停/拒绝期间请求被永久丢弃 | 已经出过三次事故（S9、N4）：新增来源若忘了这一条，就会静默丢数据 |
| **深度守卫 `maxDepth`** | `rule.ts` | **逻辑守卫** | 规则自指形成 fork bomb | 依赖 `origin.depth` 一路传递。任何绕过 `receive` 造 Ticket 的路径都不带深度 |
| **环检测** | `engine.createsCycle` | **逻辑守卫** | 依赖图成环导致永久等待 | 与写边在同一个事务里（这点是对的）；但它读的是全图，图很大时是 O(E) 每次 |
| **`maxWorkers` 槽位计数** | `executor.used()` | **逻辑守卫** | 同时跑太多 worker | **已知会少计**（N3：救援曾把在跑的进程从计数里删掉；已修，但计数本身是内存态，重启后从 Session 状态重建） |
| **预算上限** | `meta.runtimeBudgetMs`（排期自带）/ `watchdog.maxRuntimeMs`（全局） | **墙钟：存在且强制**（W6）；**token：不存在** | 到点发收尾提醒 → 宽限 10 分钟 → `assignmentInterrupted(...,'budget')` 停下 → 决断队列停一条 | **墙钟那半已补上**（2026-11-11 真宿主验证：排期票 `233e7679` 01:00 启动、02:00 提醒、02:10 系统停下）。**token 那半仍没有**：用量可见（真实数字，来自 DSH）但不可拦。另注：全局 `maxRuntimeMs` 活体仍为 0，所以今天真正生效的只有排期自带的那一份 |
| **Ticket 的 `scope`** | Mandate | **提示词约束** | — | 它只是写给模型看的一句话 |
| **`escapeText`（面板）** | `panel/index.html` | **逻辑守卫** | 设置文档里的标记注入面板 | 同源、且只能自己伤自己（设置是操作者写的）。曾经它**根本不转义**（S36，已修） |

---

## 2.1 面板与 API **不在宿主的身份验证之后**（第 47 轮实测）

同一台宿主、同一时刻的实测：

| 请求 | 结果 |
| --- | --- |
| `GET /`（DSH Web GUI 根） | **401** `dsh web authentication required; reopen the URL printed by dsh web` |
| `GET /myagent/`（面板 HTML） | **200** |
| `GET /myagent/api/state` + `x-myagent-request: 1` | **200** |
| `GET /myagent/api/state` **不带**那个头 | **403** |

**所以：DSH 自己的 GUI 需要 token，而 myagent 的面板与全部 API 不需要。**
它们唯一的门是那个同源围栏头，而 §2 已经写明：**本机任意进程都能发这个头**。

**后果必须说清**：本机上任何进程都可以驱动 myagent——建 Ticket、改设置（包括 `allowedSenders`
与 `sources.*.deny`）、停掉在跑的工作、读取 Ticket 目录里的产物。**这不是一个假设**：
`curl` 一行就能做到，而本轮验收代理与我自己都在反复这么做。

**分级**：这与 §1 的"worker 没有沙箱"是**同一个信任模型的两面**——
myagent 假定"本机 = 操作者"。在那个假定下这不是缺陷；**一旦那个假定不成立（多用户机器、
被入侵的进程、一个不该有权限的本地程序），面板与 API 就是一个无认证的完整控制面。**

**这条为什么现在才写**：它一直成立，但只有在把"GUI 要 token"与"myagent 不要"并排测出来时才显眼。
**一个控制面的认证强度，应当与它所在宿主的其它控制面相比较着看，而不是孤立地看。**

**可选的缓解（都未实现、未评估）**：把面板路由挂到宿主的认证之后（需要 DSH 提供这个能力，**未核实它是否提供**）；
或者给 myagent 自己一个 token（设置里存、面板首次访问时要求输入）——但那只是把"本机能读设置文件"
变成"本机能读设置文件里的 token"，**在同一个信任模型下并不增加强度**，所以要诚实地说它值不值得做。

## 2.2 已堵：一个 id 形状就能拿到管理面（第 50 轮发现并修复）

**发现**（由实现 F1/F2 的那一轮报出，我核实了代码路径）：
`ticketOfSession(sessionId)` 是**纯形状解析**——`sessionId.startsWith('worker-') ? slice(7) : undefined`，
而它自己的注释写着"for a Session that was never recorded"。
`decorateAgent` 拿到这个 ticketId 之后调 `this.host.ticket(ticketId)`；
**如果那张 Ticket 不存在，返回 `undefined`**，而 `decorate` 用 **`ticket === undefined` 来判定 role**：

```ts
const role: PromptRole = ticket === undefined ? 'orchestrator' : 'worker'
```

**所以"这是主 Session"与"我找不到那张 Ticket"被同一个 `undefined` 表达，而兜底方向是 orchestrator**——
也就是前台的**管理工具**：`myagent_create_ticket`（**建一张 Ticket，而它会以完全访问运行**）、
`myagent_stop_ticket`、`myagent_retry_ticket`、`myagent_answer_ticket`。

**后果**：**任何能创建一个 id 以 `worker-` 开头的 DSH 会话的东西，就拿到了 myagent 的完整管理面。**
这与 §2.1（面板与 API 不在宿主认证之后）叠在一起时更糟：本机上任何进程都能建会话。

**这是 §0.10 那个 fallthrough 族的第五次出现，也是第一次兜底方向是"给权限"**——
前四次是分类错、计数错、签名错、拒绝理由说假话；这一次是**提权**。

**已修**（`src/app/sessions.ts` 的 `decorateAgent`）：Ticket 不存在时**完全不装扮**——
不给 myagent 工具、不给 myagent 提示词段，并记一条 warn（**不是静默**：
一条没人看得见的拒绝正是 S33 那句假审计记录的成因）。
完整闸门退出码 0、771 条测试、产物 `3f772ddc7f64ba9f…`。

**仍未做（欠账，写到可照做的程度）**：
1. **这条修复仍然没有回归测试，而且第一次尝试写失败了——失败的方式值得记。**
   我按 `host.guardOf(id)` 写了断言（"冒充者没有 guard、真 worker 有 guard"），测试**通过**了；
   **但把修复退回去做变异检验时，它仍然通过**。也就是说**那条断言根本抓不住这个缺陷**。

   **原因是探针选错了，不是修复有问题**：`guardOf` 读的是**工具守卫**（`agent.ctx.tools.guard(...)`），
   而**orchestrator 那条路根本不注册 guard——只有 worker 会被 restrict**。
   所以"没有 guard"这件事，对"被正确拒绝的冒充者"与"被装扮成前台的冒充者"**同时成立**。
   **一条不可能失败的断言，比没有断言更坏**：它读起来像覆盖（这正是纪律 0.8 警告的形状）。
   已把它撤下，并在 `tests/flow.spec.ts` 里留下为什么撤、以及正确的探针需要什么。

   **正确写法需要先给桩加一个读取口**：myagent 在一个 Session 上**注册了什么**——
   `agent.ctx.tools.register(...)` 的工具，和/或 `agent.ctx.systemPrompt.section(...)` 的提示词段。
   `AgentRecord` 里这两个面都有（`tests/helpers/host.ts`），**但只对外暴露了 `guardOf`**。
   有了它之后，断言对是：
   ```ts
   expect(host.toolsOf(impostorId)).toEqual([])                            // 一个 myagent 工具都没有
   expect(host.toolsOf(workerId(ticket.id))).toContain('myagent_report')    // 真 worker 仍然有
   ```
   **第二条才是让第一条能够失败的东西。**
2. ~~**它只进了日志，没进健康板**~~ **【工程第 2 轮已完成，W2】**
   `SessionsHost` 上加了窄端口成员 **`impostorRefused(sessionId, claimedTicketId)`**（两个 id，别无其它——
   `Sessions` 没有拿到 Engine，也没有拿到健康板），在 `decorateAgent` 的拒绝分支里、保留的 `logger.warn` 之后调用。
   `session-health.ts` 加了 **`impostorSubject(sessionId)` → `impostor-session:<sid>`** 与
   `impostorDetail(...)` → `Session <sid> claims Ticket <tid>, which does not exist, and was given no myagent tool`。

   **subject 键的选择是这条的全部难点，三个候选都被否掉了**：
   - **不是 ticketId**——没有那张 Ticket，而**那个"没有"正是要报告的事实**
   - **不是 `MAIN_SESSION`**——`createMainSession` 成功时会清 `MAIN_SESSION`，
     **于是前台的好消息会抹掉一条活着的安全拒绝**（那就是 N9）
   - **也不是一个共享的 `IMPOSTOR_SESSION` 常量**——两个冒充者是两个 subject；
     **共享键会让第二个覆盖第一个，并且 dispose 其中一个会退休另一个的行**

   **退休规则**：会话离开注册表（`runtime.ts` 既有的 `agent/disposed` 监听器现在调
   `sessionHealth.clear(impostorSubject(agent.id))`）。**刻意不选"一个非错误的回合结束"**：
   对 429 来说，一个完成的回合证明会话又能到达模型了；而这里的事实是
   **"这个会话没有授权、什么都没拿到"，一个成功的回合并不改变它**。

   **已如实记下的两个残留**：报告由 DSH 的 `agent/created` 触发，所以**一次不重新宣告遗留会话的重启不会重报它**；
   以及**一张后来真的用了那个 id 的 Ticket 不会退休这条行**（要在那里退休需要**第二个**端口成员来做 clear，
   而 W2 的原则是一个成员对应一个事实）。

   **变异检验五处，每处都做 0.8 强形式，结果是本项目最好的一次**：
   **没有任何一处变异在删掉断言之后变绿——每处都被 ≥2 条独立断言抓住。**

   | | 变异 | 红在哪 | 强形式（删断言后） |
   | --- | --- | --- | --- |
   | M1 | 共享 impostor 键 | `expected 'Session worker-1111…' to contain 'worker-0000…'`（**N9 复现**） | **仍红，且更糟**：dispose 第二个会清掉共享槽，于是第一个冒充者还活着而板上读作 ok:true |
   | M2 | 路由到 `MAIN_SESSION` | **两条测试同时红**（前台的 ECONNREFUSED 行覆盖了拒绝） | **仍红**在恢复那步：`createMainSession()` 成功而板上变 ok:true，冒充者仍在注册表里——**正是这个路由要防的假"一切正常"** |
   | M3 | 删掉 `agent/disposed` 的 clear | 被 dispose 的会话那行留在板上（**永久假警报**，S38/S41/F2 家族） | **仍红**在 `expect(onBoard(runtime)).toBe(false)`：两个会话都消失后 `health.problems()` 仍列着 `sessions` |
   | M4 | detail 丢掉 ticketId | 剥掉 id 的那条断言 | **仍红**在 `toContain('does not exist')`，所以"点名两个 id"由两条独立断言守着 |
   | M5 | **退回 S44 修复本身**（= W1 的 M1） | **两个 spec 的全部 5 条测试都红**；W1 那条消息与 §4.62 的记录逐字相同 | **仍红**在 `expect(onBoard(runtime)).toBe(true)` |

   **M4 里有一条值得单独留下的认识**（代理自己发现的）：
   `toContain(ticketId)` 在一个含 `worker-<ticketId>` 的 detail 上**会被 Session id 自己满足，因而不可能失败**——
   **所以它改成在 `detail.replace(sessionId, '')` 之后找 ticketId**。
   同理，测试 3 里**先让前台自己的 `agent/error` 活着**再断言，因为
   **"一个找不到东西的 clear 是空操作"，所以只在成功创建之后断言是不可能失败的**。

   **W1 的测试文件逐字未动**（`cde48ef721744ed2`，mtime 仍是 21:30），且**在新代码下仍然通过**。
   **我（主 Agent）独立复核过**：`decorateAgent` 的提前返回仍在、S44 标记命中 1、
   M1 让 W1 的测试变红（`expected [ 'myagent_create_ticket', …(6) ] to deeply equal []`）并同时让 W2 的三条变红、
   完整闸门**退出码 0 / 776 条**（= 772 + 4，与代理的预测一致）。

   **所以 §2.2 的两条欠账现在都关闭了。**

## 3. 一个必须点名的弱点：inbox 的发起者身份

门禁按 `allowedSenders` 判断"谁在请求"，而 **inbox 来源的 actor 是从请求文件本身推出来的**。
这意味着：

> **能写 inbox 目录的人，就能以任何被允许的发起者身份提交工作。**

所以 inbox 的信任边界是**目录的文件系统权限**，不是那个 sender 名字。
把 inbox 目录设成世界可写、或者让任何不可信进程能往里放文件，等于把门禁整个绕过——
而门禁的记录里会写着一个看起来合法的发起者。

这条不是 bug（文件就是那个来源的身份凭证），但它必须写在清单里，
因为"有 `allowedSenders` 名单"很容易被读成"发起者经过认证"。**它没有。**

对照：P8 的聊天来源必须把平台身份映射到**真实 actor**，
那时"谁能声称自己是谁"才是一个需要在协议层解决的问题。

### 3.1 P8 的聊天来源：**映射表是逻辑守卫，真边界仍然是"谁能把消息送进来"**

契约（`docs/v2/15-p8-contract.md` §2）要求身份**必须被映射、不能被推断**：
设置里有显式的 `identities` 表（平台 id → actor 名），未映射的消息**在产出侧被留住**
（不产生 Trigger 与 Decision、文件留在原处、健康板报数），操作者补上映射后下一次扫描才受理。
Source **不得自己判断 `kind`**——映射本身就是操作者的断言。

**这比 inbox 好，但没有变成真边界，分类必须说准**：

| | inbox | chat（P8） |
| --- | --- | --- |
| 发起者身份从哪来 | 请求文件**自身** | 消息里的平台 id，**经操作者写的映射表**才成为 actor |
| 未知名身份 | 无所谓（文件就是凭证） | **留住不消耗**，可事后受理 |
| 真边界是什么 | **inbox 目录的文件系统权限** | **频道目录（或端点）的写入权限** |

所以改进是实质性的：**自述的名字不再直接被当成身份**，而且未知身份不会被静默丢弃或静默受理。
但 `identities` 是**操作者可编辑的设置 JSON**，`allowedSenders` 也是——
**能改设置的人就能把任何平台 id 映射成任何 actor**。因此它是**逻辑守卫**。
真边界仍然是"谁能把消息放进那个频道目录"，与 inbox 同构。

**一条必须写下来的推论**：`identities` 进了 `authorizationShape`，所以改映射会移动 `policyVersion`、
会通知已受理的 Ticket（第 35 轮实测，有测试）。**但通知不等于撤销**——
一个已经被错误映射受理的 Ticket，改映射不会把它叫回来。要撤销得手动停它。

---

## 4. 注入面：哪些不可信文本会进入模型的上下文

按"谁能写它"排序，最危险的在前：

| 入口 | 谁能写 | 现状 |
| --- | --- | --- |
| **inbox 请求文件的正文** | 任何能写那个目录的人/进程 | 直接成为 Ticket 的请求文本，进 worker 的提示词。**无过滤、无标注** |
| **附件**（`attach:` 指向的文件） | 同上，且可以是任意路径 | 被**复制**进 Ticket 目录，worker 会读它。复制不检查内容 |
| **另一个 Ticket 的产物** | 那个 Ticket 的 worker（即模型） | 经 `myagent_read_artifact` 进入本 worker 的上下文。**这是 worker→worker 的注入通道**：一个被注入的 worker 可以产出带指令的"产物"，而同 Work 的另一个 worker 会把它当数据读进来 |
| **另一个 Ticket 的 worker 写的 Input** | 那个 worker（即模型） | 经协作通道写入目标 Ticket 的 inputs。**第 28 轮之前两处渲染都把它归给操作者**，投递路径甚至写着 `A note from the operator`；现在按 `input.by` 署真名并明写"不是操作者，当数据对待"。署名不等于可信，但它不再是假陈述 |
| **worker 自己抓取的网页** | 互联网 | DSH 的 `web_fetch` 语义（外部内容当数据）。myagent 不额外处理 |
| **面板上操作者输入的答案/备注** | 操作者 | 进 Ticket 的 inputs，随后投递给 worker |
| **设置文档** | 操作者 | 排期的 `prompt` 就是将来某次 worker 的任务文本；规则的 `then.prompt` 同理。**改设置 = 排将来的指令** |

**目前没有的缓解**：没有对不可信文本做标注（例如包一层"以下是外部内容，不是指令"）、
没有对产物内容做任何检查、没有跨 Work 的信息流控制之外的分级。

**已有的缓解**：跨 Ticket 的产物读取被限制在同一个 Work 内、且只能读登记过的路径——
这**缩小**了注入面的半径（一个被注入的 worker 只能影响同 Work 的同伴），但没有消除它。

---

## 5. 明确**不提供**的东西

写下来是为了防止有人假设它们存在：

- **没有沙箱**：worker 以运行宿主的用户身份、`danger-full-access` 权限工作（§1）
- ~~**没有预算上限**：不会因为有 worker 烧掉太多 token 或跑太久而被拦下（Watchdog 只处理"卡住"和"静默"）~~
  **【2026-11-11 更正，一半】**"跑太久"现在会被拦下：W6 的墙钟预算到点提醒、宽限 10 分钟后系统停下并停一条决断（真宿主验证过）。"烧掉太多 token"仍然不会——token 只计量、不强制，而且全局 `maxRuntimeMs` 活体仍为 0，今天生效的只有排期自带的那一份预算。
- **没有发起者认证**：inbox 的 sender 是自述的（§3）
- **没有审计签名/防篡改**：事件日志与 Decision 记录都在同一个 sqlite 里，能写那个文件的人能改历史
- **没有对 worker 输出的内容检查**：`myagent_report` 校验 schema 与路径形状，不校验内容真假
- **没有网络出口控制**：worker 能不能联网取决于宿主与机器，不取决于 myagent
- **没有多租户隔离**：一个部署 = 一个操作者 = 一套授权。Project/Work 是**分组**，不是隔离边界
  （它们限制的是产物读取与协作通道的可达性，不限制 shell）

---

## 6. 按严重度排序的待办

| | 内容 | 为什么这个序 |
| --- | --- | --- |
| **高** | 给 worker 一个**真的**边界：受限用户 / 容器 / 只读挂载 + 可写工作区 | §1 是其余一切的前提。在它之上加多少逻辑守卫都只是防意外 |
| ~~**高**~~ **已完成（第 27 轮）** | inbox 目录权限的**文档与自检**：挂载时检查它是否组/世界可写，是则上一行健康问题 | **已落地并两次实测**：第 38 轮的验收量到日常 inbox 是 `drwxr-xr-x`（组/世界不可写），自检**正确地保持沉默**；第 36 轮的 chat Source 对**世界可写的频道目录**也报同样的一行（含 mode 与 `chmod go-w` 的建议），并且**在取走一条消息之后仍然存在**（不被自己的摘要擦掉）。**但它完成的是「自检」，不是「边界」**：静默失效变成了可见告警，而 §3 的实质风险（谁能往那个目录写文件）一点没变——**所以上面那行「给 worker 一个真的边界」仍然是本清单的第一优先**。 |
| **中** | 预算上限与超限处置（token / 墙钟 / 尝试次数），基于已接入的真实用量 | **墙钟那半已落地**（W6：提醒 → 宽限 → 系统停下 → 停一条决断）。**仍缺**：token 维度的上限与处置（只可见、不可拦），以及把全局 `maxRuntimeMs` 从 0 设成一个真值（活体今天不限时，只有排期票自带预算） |
| **中** | 给进入上下文的不可信文本加**来源标注**（inbox 正文、附件、别的 Ticket 的产物） | §4 的半径现在只靠 Work 边界缩小，标注能让模型至少知道"这段不是操作者说的" |
| **中** | 产物内容的最低检查（大小已有上限；类型、以及"这是数据不是指令"的包装） | worker→worker 注入通道 |
| **低** | 事件日志的防篡改（哈希链或只追加的签名） | 威胁模型里"能改 sqlite 的人"本来就已经赢了（§1），所以这条只防误改与事后抵赖 |

---

## 7. 这份清单的证据基础

- §1 的 `danger-full-access`、工具清单的意图：**源码引用**（`src/app/sessions.ts:27` 与其后的注释）
- `resolveInside` 的 15 条测试、`escapeText` 曾经不转义（S36）、N3 的槽位少计、N4 的有损 deny、
  S9 的有损暂停：**都有对应测试或验收证据**，见 `docs/v2/00-audit-and-plan.md`
- token 用量是真实数字（来自 DSH 的 `assistant/message` 事件，在真宿主日志里核对过），
  但**上限不存在**——所以这一项写的是"可见"而不是"受控"
- 真宿主验收记录：`docs/v2/01-live-acceptance-current-build.md`、`docs/v2/02-live-acceptance-v2.md`
  与其附录 `02b`。**注意其中一部分结论已被更正**（见 02 顶部的更正块），引用时以更正后为准

**这份清单没有覆盖的**：DSH 宿主本身的安全性质（它如何强制工具清单、权限预设、Session 隔离）
被当作给定的前提。如果那个前提有问题，本清单的"真边界"分类也要跟着改——
而我**没有审计过 DSH 本身**，这是本清单最大的未验证假设。
