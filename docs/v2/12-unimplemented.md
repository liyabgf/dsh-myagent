# 12 · 未实现能力清单（合并版）

V2 项目十项交付物的第 8 项。作用只有一个：把散在 `00`、`02`、`02b`、`03`、`05`、`06`、`07`、`11`、`14`、`15`、`16`、`17`
十二份文档里的"这个系统还做不到什么"收成一张表，让下一个人不必读十二份就知道从哪儿接手。

**本文只有一层现状。** 第 1–10 节是现状表，一行一个尚未实现或只做了一半的能力，六格：
能力 / 现在有什么 / 缺什么 / 状态 / 接入它需要什么 / 出处。**已经结案的条目不在正文里**，
它们在**附录 A**（按结案的轮次排列，共 31 条）；曾经被写错、后来被更正的陈述在**附录 B**
（B.1 与 B.2 是旧版那两处最要紧的，B.3 是同一族的另外三条）；本文与其它来源不一致的地方在**附录 C**。
一个人想知道"现在缺什么"，读第 1–10 节就够；想知道"某条去哪儿了"，读附录 A。

本文不做新调查，也不发明条目：每一行都给出处，找不到出处的不写。凡本轮自己动手核过的
（读 `src/`、`tests/`、`panel/`、`scripts/`，只读 `$TMPDIR` 与日常宿主的 stateDir），
出处格里写明"本轮核对"，并遵守 `07` §0.3 立的证据规则：**本文自己的只读复核只用来陈述现状或下调标签，
从不用来把任何标签升成 真宿主验证。** 真宿主验证 只给 `14`（第 33 轮 Watchdog 验收）与 `16`（第 38 轮聊天验收）
里判定为「通过【实测】」的命题，且只给那一句命题本身。

状态只有五个，逐字使用：**真宿主验证 / 离线验证 / 部分实现 / 仅有设计 / 尚未实现**。按 `00` §4.25 的裁定，
"代码完整、零调用者"不加第六态，标 **部分实现** 并把缺的那一半命名为 **未接入**，且必须写明接入它需要什么。
判读规则沿用 `07` §0.1：**"文档点出了缺口"不等于"有设计"**——只说缺什么的标 尚未实现，
给出了机制与接口位置的（如 D1–D11）才标 仅有设计；一个能力有测试但没有调用者，标 离线验证 并写明"没有调用者"。
**标签不许为了让项目看起来更靠前而上调**：`02` 顶部那个更正块与整份 `02b` 是这条规则的由来
（`02` §7 曾把 Watchdog 报成"通过"，而救援在真宿主里是空操作）。反向也不许：
一个已修的缺陷不许被写成仍然存在的性质（`07` §8.2 第 2 条）。

---

## 0. 本轮实测的基线

> **⚠️ 基线已过时（2026-11-11 标注）**：本文正文 §1–§10 的基线是 **2026-11-05**，
> 而那之后落地了两批工程：**0.12–0.14 的五个聊天桥**与 **W1–W39 重构**
> （Thread/Subscription 进气、triage 双层、墙钟预算强制、同 Work 只读、目录级产物登记、总管工具面）。
> 这两批**结案**的条目已按本文自己的规矩收进**附录 A**（末尾"W1–W39"与"0.12–0.14"两组），
> 它们**仍然缺的那一半**收在新增的 **§12**。
> 所以：读正文 §1–§10 时，凡与 §12／附录 A 冲突的，**以 §12 与附录 A 为准**。

编写时刻：2026-11-05 01:5x–02:0x（本地，Asia/Shanghai）。本轮没有构建、没有重启、没有重载、没有起任何宿主，
也没有对任何宿主发过 POST/PUT。

| 项 | 值 | 怎么量的 |
| --- | --- | --- |
| 闸门 | `退出码 0`、**759 条测试全过**（33 个文件） | `/tmp/myagent-gate.log` 末两行：`── 计数：Tests 759 passed (759)`、`结论：通过。产物 768a6adb1cfc136c…（320163 字节）` |
| 产物 | `lib/index.js` sha256 `768a6adb1cfc136cc7d0b0e99578fa047fafc95cb5330e33b2b9943236c7c3e2`、**320163 字节**、mtime 11-05 00:43 | 本轮 `shasum -a 256` + `wc -c` |
| 产物新鲜度 | **无 `src/` 文件比产物新**；`panel/index.html` 比它新 12 秒，而面板**不在 bundle 里**（`00` §4.36 的那条观察），所以不影响产物哈希 | 本轮 `find src tests panel scripts package.json -type f -newer lib/index.js`。**本轮期间有并发写入者**：02:04:00 `lib/index.js` 被重建过一次，而 sha256 与字节数**逐字未变**（`768a6adb…`/320163），02:04:12 `panel/index.html` 被改过（`290eed86…` → `2fdbfcad…`，2128 行）、`tests/panel.spec.ts` 02:03:55 被改过。**本文引用的面板行号是 02:0x 那一版的**（`data-tab` 在 `:133-140`、settings 文本框在 `:292`），下一次改动会让它们漂移——所以每处都同时给了可 grep 的原文 |
| 文档 | `docs/v2/` **19 份**；行数本轮量过两次：01:0x 是 **8951** 行、02:0x 是 **9803** 行 | 本轮 `wc -l docs/v2/*.md`。**差额不是本文造成的**：`00` 在本轮期间从 2775 行长到 2830 行（多出 §4.47），`11` 正被另一个代理合并。引用这两个数都要带时刻 |
| schema | `SCHEMA_VERSION = 5`（`src/app/store.ts:19`）；`lost` 是 disposition 列里的一个 JSON 状态，有界 kv 用既有键，**第 44 轮没有引入迁移** | 本轮核对 + `00` §4.45 |

### 0.1 日常宿主（3080）此刻是"新页面 + 旧 API"，而这件事决定了本文每一个标签怎么读

**`00` §4.47（第 47 轮）实测到的现场**（不是本轮测的——本轮的 HTTP 探针被认证挡住，见下）：

| 探针 | 值 |
| --- | --- |
| `GET /api/lost` | **404** `{"error":"No route for GET /myagent/api/lost"}` |
| 服务的面板 vs 磁盘上的 `panel/index.html` | **逐字节相同**（`290eed863988b49ecbef…`；本轮 01:5x 自己算了磁盘那一半，前 24 位吻合。**02:04 磁盘上的面板又被并发改成了 `2fdbfcad0f4403188171ea3b…`**，所以"逐字节相同"只对 §4.47 那一刻成立，而"新页面 + 旧 API"这个状态本身不变） |
| 面板里的新界面标记（`lost-count` / `chat-waiting` / `丢失的请求`） | **8 处** |
| API 侧 | `state.chat`、`counts.sends`、`counts.lost` **全部不存在**，`sources.chat` 也不在设置里 |
| `mountedAt` | `2026-11-04T04:21:30.904Z`（本地 12:21:30） |
| `policyVersion` / `settingsRevision` | `275ea61ded276e15` / 7 |

**结论（`00` §4.47 的原话）**：日常宿主跑的是**第 31–34 轮的 bundle**，服务的面板是**第 46 轮的**。
`mountedAt` 存在（第 31 轮加的）而 `state.chat` 不存在（第 37 轮加的），把版本夹在中间。

**本轮自己量到的、与它吻合的只读文件证据**：

- `~/.dsh/state/myagent/myagent.lock` = `{"pid":24619,…,"at":"2026-11-04T04:21:30.904Z"}`，`myagent.json` 的 `at`
  是 `04:21:30.905Z`。锁在挂载时写，所以**最后一次挂载是 2026-11-04 12:21:30.904（本地）**，与 §4.47 的 `mountedAt` 逐字相同。
- `lsof` 显示 pid **24619** 仍持有 `myagent.sqlite3`；该进程 11-03 00:30:48 启动，本轮全程未碰。
- 日常库 sha256 `a793caacbbcb2e1d5f96…`、**167936 字节**、mtime **11-04 11:40:37** —— 与 `16`（第 38 轮，18:2x）
  记的"起点=终点、全未变"逐字相同，即**此后 13 小时日常库一个字节都没动过**。
- **【本文写作时的探针结论已被更正**（02:1x，由主 Agent 复测）**】** 本文写作时报告：带围栏头对
  `/`、`/api/state`、`/myagent/api/state` 三条**全部** `401`。**主 Agent 在同一小时内三次复测，结果不同**：

  | 请求 | 主 Agent 实测 |
  | --- | --- |
  | `GET /`（DSH GUI 根） | **401**（`dsh web authentication required`——GUI 需要 token，这条为真） |
  | `GET /myagent/api/state` **带** `x-myagent-request: 1` | **200** |
  | `GET /myagent/api/state` **不带**那个头 | **403**（围栏按设计工作） |
  | `GET /myagent/`（面板 HTML） | **200** |

  三次复测一致，且**带不带围栏头的对照**恰好证明围栏在正常工作。所以 **"只读 GET 一眼"这条路仍然可用，
  `verify-live.sh`（BASE 是 `…/myagent`）不会因此每步失败**——本文原结论作废。
  最初那条"全部 401"的成因未查明（可能把 GUI 根的 401 外推到了全部三条，而 `/api/state`
  不带 `/myagent` 前缀时本来就不是 myagent 的路由），**但本文据它推出的结论已全部撤回**。

  **保留一条真发现**：DSH 自己的 GUI 根路径需要 token，而 myagent 的面板与全部 API **不需要**——
  它们唯一的门是那个本机任意进程都能发的围栏头。这已写进风险清单 **§2.1**。

**这条事实对标签的影响，必须写在最前面**：**第 33–46 轮落地的一切都不在日常宿主上**——N8 的 `escalated`、
整个 P8/chat（来源、面板、`GET lost`）、S38 的 gauge 删除、`notice_lost`、`reply_lost`、`lost` 处置、
`effects`/`delivery` 健康条目的自清语义。所以本文里的 **真宿主验证** 一律指
"**在一次钉住产物的隔离宿主验收里得证**"（`14` 是端口 3180 / stateDir `myagent-acc-watchdog`，
`16` 是 `myagent-acc-chat`），**不是"日常宿主上现在能用"**。这两件事在本文里分开说：
前者进附录 A（已结案），后者是这一节。**有真宿主证据的只有两项，而且都来自隔离宿主**：
N1/N3（第 33 轮）与 chat 闭环（第 38 轮）。

**一个稍纵即逝的机会**（`00` §4.47 记下、操作者已选择利用）：面板的**能力探测降级路径**
（`tests/panel.spec.ts` 里 "a host whose plugin is older than the page" 那组）**只在 jsdom 里验过**，
而此刻日常宿主正处在那个状态里，是唯一不需要人为制造就能在真浏览器里验它的时刻——一旦重载，这个状态就消失。
待看清单在 §4.47：横幅是否恰好一条、聊天一节是否显示"这个宿主答不出来"而不是空白、
「丢失的请求」与页头药丸是否**隐藏**（而不是显示 0）、是否只探测一次不重复弹 toast、整页有没有布局崩坏。
**本文没有看，也没有重载任何东西**；这条机会窗口是否已经被用掉，未核实。

### 0.2 本文与其它文档的口径

`07`（221 项能力总表）数的是"源码树里能点名到某个文件的能力"；本文还要收 `00` 的每一个「未做」段落，
以及 `05`/`06`/`03`/`11`/`17` 里那些不在能力表里的条目（部署层的安全待办、测试卫生、文档漂移、未做的验证动作）。
所以本文的"尚未实现 + 仅有设计"行数**大于** `07` §10 的对应数，这不是本文更悲观，是口径不同。
`11` 在本轮期间被另一个代理合并过（01:26 落盘，章节号与旧版不同：桩保真度从 §5 变成 §6、已知缺口从 §6 变成 §7），
**本文引用它一律用合并后的新号**，并在附录 C 里记下它合并前后的数字。本文自己的权威计数取自 `/tmp/myagent-gate.log`，
不取自任何一份文档。

---

## 1. 来源与扩展接口（P8 的剩余）

**P8 已结案**（第 35–38 轮：契约 → A+B → C1 → C2 → D → E，聊天闭环在真宿主上得证），
结案的四条在**附录 A**。本节只剩 P8 的范围收窄明确排除的东西、以及它落地时暴露出来的四个疣。

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 一个 kind 的多个实例（两个聊天账号）（D3） | `registry.ts` 全部以 `kind.name` 为键（`:46-48`），`sources.chat.channels` 是**一个实例读多个频道**（`policy.ts:182-186` 的注释逐字写着"the standing decision is one instance per kind (D3) while an operator may have more than one channel"） | 按实例 id 而非 kind 名索引。**这是刻意的范围收窄，不是遗漏** | 仅有设计 | 改 `SourceRegistry` 的键为 `kind:instance`、改设置形状、改 `signatureOf`（`registry.ts:12-17`，现在是 `JSON.stringify(settings.sources[kind])`，按 kind 索引而非 ternary 兜底）。`00` §4.31 把它列为"开它是单独的架构变更" | `00` §3 D3、§4.31 范围收窄；本轮核对 `registry.ts`/`policy.ts` |
| 来源种类是**数据声明**而非闭合联合（D1） | 第 35 轮把两处枚举改成了**派生**：`signatureOf` 按 kind 索引、`sourceKinds` 从设置块派生（`policy.ts:335-340` 的注释写着"Derived rather than written out, because the written-out version is how the fourth kind ended up invisible to the policy version"）；第 35 轮还修掉了第四处 `enabled` 缺口（`identities` 与 `enabled` 进 `authorizationShape.perSource`，`policy.ts:282`） | 数据声明机制本身。`SourceKindName` 仍是**五成员闭合联合**（`model.ts:4`：`cron｜inbox｜session｜rule｜chat`），`viaOf` 仍是写全五个键的 `Record`（`policy.ts:325`），`SettingsSchema.sources` 仍是 `.strict()` 的五个具名块（`policy.ts:97-…`：cron `:98`、inbox `:114`、session `:121`、rule `:127`、chat `:168`） | 仅有设计 | 今天加第 6 个 kind 仍要同时改四处：`model.ts:4` 的联合、`policy.ts:325` 的 `viaOf`、设置里一个新块、`src/sources/` 一个新文件 + registry 注册。要变成数据声明，得把 `sources` 改成 `z.record(kindSchema)` 并让 `viaOf` 从设置读 kind 列表；`policy.ts:388` 那条 `unknown_source` 拒绝是对的（未知 kind 必须被拒而不是 fallthrough），要保留 | `00` §3 D1、§4.15、§4.32；本轮核对 `model.ts`/`policy.ts`/`registry.ts` |
| Webhook 来源（D9） | 幂等键的设计已给：`key('webhook', provider, deliveryId)` | 传输层。DSH 的 `WebServer.Config.host` **直接拒绝通配地址**，且 myagent 自己的同源围栏（`http.ts:130-139` 的 `sameOrigin`：回环 Host + 必须精确到端口 + `x-myagent-request: 1` + `origin` 匹配）会挡掉它 | 仅有设计 | 一条活在该前缀之外、自带认证的路由；先决定认证方案（HMAC 签名 or token），否则等于把 §10 的"发起者认证"缺口再开一个 | `00` §3 D9；本轮核对 `http.ts` |
| 文件变化监听来源（D10） | 约 80% 可复用 inbox | "文件变了"不是唯一事件、trigger id 没有自然答案；DSH 没有 watcher 服务 | 仅有设计 | 一个 id 生成规则（路径 + mtime + 内容哈希的组合）与去抖策略，再决定 watcher 由谁提供 | `00` §3 D10 |
| 把一个平台账号标成**系统 actor** | `sources.chat.identities` 的条目只有 `actor`（必填、trim、≤120）与 `note?` 两个字段（`policy.ts:176-181`），`chat.ts:358` 恒写 `actor: { id: mapped.actor, kind: 'person' }`；`policy.ts:161-166` 把这件事写成了裁定（"every entry produces `kind: 'person'` because the mapping is itself the operator's assertion"） | 一个 `kind` 旋钮。后果是具体的：`Actor.kind` 只有 `'person'｜'system'`（`model.ts:7-12`），所以**一个映射进来的机器人账号在门禁眼里是人**，只要它的名字在 `allowedSenders` 上就能发起工作，而 `allowSystemActors` 这道关对它永远不适用 | 尚未实现 | `identities` 条目加可选 `kind`（默认 `person`）+ `chat.ts` 读它 + 一条测试。要一起决定的是它与"映射即断言"那条裁定的关系：加了这个旋钮，`identities` 就从"谁在说话"变成"谁在说话、以及它算不算人"，而后者是授权判断 | 本轮核对 `policy.ts:161-181`、`chat.ts:337-358`、`model.ts:7-12`；`00` §4.31 决定 1；`06` §3.1 |
| `Runtime.sourceStatus()` 不再整体替换 `counts` | `runtime.ts:621-629`：从 `store.triggers.countBySource()` 读计数，命中就用 `{ ...own, counts: counted[name] }` **整体替换**掉 Source 自己的 `counts`；聊天面板靠直接读 `sources.source('chat').status()` 绕过它（第 37 轮 D 的做法） | 合并语义。后果：任何 Source 自己的 gauge，一旦该 kind 存过一个 Trigger，就从 `state.sources.<kind>` 消失。**疣在 `runtime.ts`，会影响下一个有 gauge 的 Source** | 部分实现 | 改成逐键合并（`{ ...own, counts: { ...own.counts, ...counted[name] } }`），或让 `countBySource()` 的结果与 Source 自己的 gauge 用不同的键名。加一条测试：一个有自己 gauge 的 Source 在存过一个 Trigger 之后，两个数都在 | `00` §4.36 (2)、§4.45「仍未做的」；本轮核对 `runtime.ts:621-629` |
| `delivery.sends()` 的两个计数跨重载存活 | `{queued, nowhere}` 已挂在 `GET state` 的 `counts.sends` 上（第 37 轮 D），面板显示并解释 `nowhere` | 持久化。它们是**每次挂载以来**的内存数，重载归零（面板已如实写明 "since this mount"） | 部分实现 | 要持久得动 `delivery.ts` 与 store（一张表或一个 kv 键）；先决定它是"这个部署的事实"还是"这次挂载的事实"——`00` §4.36 (3) 记的是前者更难 | `00` §4.36 (3)；`15` §3.3 |
| `channels` 与 `allowedSenders` 的面板编辑 | 「设置」页是一个整份 JSON 的 `<textarea id="settings">`（`panel/index.html:292`，保存在 `:2091` 用 `JSON.parse`）；**身份映射有专属 UI**（聊天一节的映射表可增删改，映射到不在 `allowedSenders` 上的名字要二次确认） | `channels` 与 `allowedSenders` 的专属控件。面板自己把操作者指向 JSON：频道空状态写的是"「设置」页 `sources.chat.channels` 里加一条"（`panel/index.html:1610`、`:1655`） | 部分实现 | 一个频道表编辑器（id / directory / enabled）+ 一个 `allowedSenders` 列表编辑器，复用排期页与身份映射表已有的形状。注意 `allowedSenders` 是授权面，改它的控件要跟身份映射一样有二次确认 | `00` §4.36 (4)、§4.45「仍未做的」；本轮核对 `panel/index.html` |
| 三个 Source 的 catch-all 分支不再把未点名的处置状态当成"已受理" | `receive` 那一半第 44 轮已修：一个已存的 `lost` 行**不算重复**，所以门禁重跑、`save` 用它挣来的处置替换掉它（`engine.ts:256-266`，注释逐字点名了下面那三处） | **三处 catch-all 仍然存在**，本轮逐个核对：`inbox.ts:239-243`（`else` 分支把任何东西归档进 `accepted/`，注释说的是"Seen before this process started"）、`chat.ts:385-386`（三元链的兜底是 `'accepted'`）、`cron.ts:194-196`（三元链的兜底是 `'ignored'`，并且**推进游标**）。今天对 `lost` **不可达**：只有 `rule.ts:99` 入队 `trigger` 效果，而规则来源从不调 `receive`；且 `receive` 那个修复让它们保持不可达 | 部分实现 | 把三处的兜底改成显式枚举 + 一个"不认识就抱怨"的分支（例如 `default: this.health.problem(\`unknown disposition state …\`)` 并**不**归档/不推进游标），或者让 `Disposition` 的消费者共用一个 `switch` 上的穷尽检查（TS 的 `never` 收窄）。**任何未来的 `Disposition` 成员都会走进这三处**，而它们会把"这个请求丢了"读成"这个请求已受理" | `00` §4.45（它报的边界外事项）、§4.42；`04` §0.10；本轮核对四处代码 |

---

## 2. P6 预算与治理

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 预算**上限**与超限处置（token / 墙钟 / 尝试次数） | 真实 token 计量在：`GET /api/tickets/:id/progress` 的 `usage`（`http.ts:453` → `runtime.ts:113-120`），由 `usageOf`（`runtime.ts:135-155`）对 DSH 的 `assistant/message` 事件求和（`inputTokens`/`outputTokens`/`cacheReadTokens`/`messages`/`totalTokens`），带 `windowed: total > scanned.length`，无数据时返回 `undefined` 而不是一堆 0 | **上限本身，一个都没有。** 本轮核对 `grep -rni "budget｜ceiling｜quota｜maxTokens｜tokenLimit｜costLimit" src/` → 5 处命中，**全是注释或字节上限**（`engine.ts:892` 的 retry budget 注释、`runtime.ts:48`/`:110`/`:468` 的 16MB 与上下文注释、`effects.ts:179` 的重试注释）；`SettingsSchema`（`policy.ts:80-242`，`.strict()`）里没有任何预算块。所以 token / 墙钟 / 尝试次数**三条都没有强制**：一个跑飞的 worker 会一直跑，Watchdog 只处理"卡住"与"静默" | 尚未实现 | 一个 `SettingsSchema.budget` 块 + Watchdog 的第三类探测器读 `usageOf` + 超限时的处置动作（`failTicket` 是现成的、且今天零生产调用者，见 §6 末行）。`06` §5 把它列为"明确不提供"，§6 列为"中" | `06` §2 末行 + §5 + §6"中"；`07` §10.2 / C28；`00` §4.21、§4.23「未做」；本轮核对 grep 与 `SettingsSchema` |
| 按 Work / Project 的累计成本 | 每张 Ticket 自己的用量 | 任何聚合 | 尚未实现 | 一条 `GET /api/works/:id/usage` 聚合路由 + `store` 上的求和查询。前提是先有上限，否则聚合出来的数字无处可用 | `00` §4.21、§4.23「未做」；`11` §7 第 6 条 |
| 面板渲染 token `usage` | API 侧已带 | 页面上的任何一处。**本轮核对 `grep -c` 三个词全是 0**：`panel/index.html` 里 `usage` 0、`token` 0、`Tokens` 0 | 尚未实现 | 在详情「此刻」区块加一行（`totalTokens` 与 `windowed` 都要显示——`windowed: true` 意味着这个数只覆盖最近的窗口，把它当总量就是 `runtime.ts:110` 注释里说的"how a budget number becomes a lie"）+ 一条 `tests/panel.spec.ts` 断言 | `07` C204 / §10.2；`00` §4.21「未做」；本轮核对面板 |
| 等人的 Ticket 的提醒（Watchdog 第三类动作） | Watchdog 有两类探测器：卡在启动（`stuckLaunches`）与静默 worker（`watchdog.ts:96` 的 `interruptSilent`，仅当 `silentMs > 0`） | 第三类。障碍已写明："需要一个新的通知 key，否则幂等会把它吃掉" | 尚未实现 | 一个新的通知 key 形状（`waiting:<ticketId>:<n>`）+ `notify` 侧的幂等键 + 探测器 | `07` C154；`00` §4.13、§4.14「未做」；本轮核对 `watchdog.ts` |
| `Strength='inferred'` 的 `revalidate` 规则 | 类型在 `model.ts`，`policy.ts:445` 的注释写着 "`inferred` strength does not occur in v1 — every Source is something the operator wrote" | 规则本体。`revalidate`（`policy.ts:429-450`）今天只有一条 `sender_not_allowed` | 仅有设计 | 在 `policy.ts` 已标位置补一条规则 + 决定"由谁评估"（见下一行 Assessor）。注意 chat 的映射并没有产生 `inferred`：`identities` 是操作者写的，所以那条注释今天仍然为真 | `07` C25 / C04；`00` §4.14、§4.15「未做」；本轮核对 `policy.ts:429-450` |
| Assessor 接缝 | `policy.ts:6` 的文档注释里写着 "the `Assessor` seam in the Engine is where a judgement layer would attach later" | **那个接缝不存在**：本轮核对 `grep -rni assessor src/` → 只有 `policy.ts:6` 这一处命中，`src/core/engine.ts` 里没有 Assessor 端口。`00` §1 记的是"design（文档谎称已留位）"，**这句注释今天仍然是一句关于代码的假话** | 仅有设计 | 一个 `Assessor` 接口 + 它在 `gate`/`revalidate` 里的调用点；先决定它是同步还是异步，否则 `inferred` 那条规则写不出来。或者把 `policy.ts:6` 那半句删掉——一条指向不存在接缝的注释与 N7 同类（"注释错了比没有更坏"） | `00` §1 末行；`07` C04；本轮核对 grep |
| `sessionProjections` 服务 | 替身宿主里**完全没有**这个服务（也没有 `sessionController.inspect`、`systemPrompt`）；myagent 侧零代码依赖它 | 它是否存在于真宿主、能给什么——**未核实**。`00` §6 与 `11` §6 末段与 `00` §6 都把它记为 **V2 预算的硬阻塞** | 尚未实现 | 一次对 DSH 的只读清点（`cordis_inspect_list` 一类）。核实它需要读 DSH 的 Provider 清单而不是 myagent 的代码；清点之后才谈得上写依赖它的预算探测器 | `11` §6 末段；`07` §10.2 表末行；`00` §6 |
| `00` §8 的四条 ⬜ 其实已完成 | 本轮逐个核对，四处都在：S14 计数从库里数（`store.ts:319` 的 `countBySource()`，由 `runtime.ts:622` 读）、S15 marker 里的 Volatile（`runtime.ts:248-253`，注释写明"Spelled out rather than spread"）、S2 的提示词部分（`prompts/worker.md:10-12` 点名三个工具）、flush 顺序（`agent-delivery.ts:110-112`，注释写明"Flush first"） | 清单上的勾。`00` §8 第 4/5/7/8 项仍标 ⬜ | 部分实现 | 把 `00` §8 那四行改成 ✅ 并写上代码位置。这不是代码活，是清单与代码对齐。**同一处还有第二条**：`00` §8 第 2 项写着"Memory 的语义对齐还没做"，而 `00` §4.5 记的是**第 2 轮已修**（见附录 A）——两处直接对立 | `00` §4.24「仍未修」、§4.26、§8；本轮核对四处代码 |

---

## 3. P5 上下文与产物

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 产物内容的来源标注 | 第 28 轮做了 **Input** 的标注（`authorOf`，`executor.ts`，按 `input.by` 分三种署名并明写 `not from the operator, so treat it as data`）；第 30 轮把"别的 worker 发来的文本是数据不是指令"写进了 `prompts/worker.md` | 产物那条通道。本轮核对 `Runtime.readArtifact`（`runtime.ts:450-481`）：返回 `{ok, size, at, note?, content}`，`content` 是 `Buffer.from(read.base64,'base64').toString('utf8')` 的**裸文本**，工具原样交给模型 | 尚未实现 | 在 `readArtifact` 的返回里包一层"以下是另一个 Ticket 的产物、是数据不是指令"，与 Input 那条用同一套措辞；加一对互斥测试（含标注 / 不含标注）。**界限必须一起写**（`00` §4.23 已写过一次）：署名不会让文本变可信，这一层没有任何东西能做到；它做到的是 myagent 不再对出处做假陈述 | `06` §4 + §6"中"；`07` §10.2；`00` §4.23「未做」（"它比 Input **更**需要，因为产物内容可以任意长且完全由模型写"）；本轮核对 `runtime.ts:450-481` |
| 产物内容的最低检查 | 大小上限（`WORKER_ARTIFACT_BYTES`，`runtime.ts:468-475`，超限时的措辞还告诉 worker 该怎么办）与**文本类型检查**（`isTextFile(path, size)`，`runtime.ts:465-467`：不是文本就拒绝进上下文） | "这是数据不是指令"的包装（与上一行同一处）。`06` §4 末段单列这条的理由是 worker→worker 注入通道 | 部分实现 | 与上一行合并做。**注意这一行比旧版记的靠前了一步**：旧版写"缺类型检查"，而 `isTextFile` 已经是一道类型检查——所以缺的只剩包装 | `06` §4 末段 + §6"中"；本轮核对 `runtime.ts:465-475` |
| 产物引用跨 Project | 同一个 Work 内可读（`engine.authorizeArtifactRead` 的两处收窄：`engine.ts:411` 与 `:940` 都要求 `source.workId !== undefined && source.workId === target.workId`） | 跨 Project 的读法 | 尚未实现 | 一条授权决定：跨 Project 要不要单独的设置旋钮，还是永远禁止。先定这个，再改 `authorizeArtifactRead` | `00` §4.20「未做」；本轮核对 `engine.ts` |
| worker 列出另一个 Ticket 有哪些产物 | 只能按已知路径读（`myagent_read_artifact`）。本轮核对 `tools.ts`：worker 作用域恰好三个工具（`myagent_report` `:89`、`myagent_read_artifact` `:119`、`myagent_note_ticket` `:135`），主 Session 另有七个（`:161-256`） | 列举。理由是明的："列目录会把'登记表'这个收窄抵消掉" | 尚未实现 | 一个只返回**登记过的**路径列表（不是目录扫描）的工具，例如 `myagent_list_artifacts(ticket_id)`；这样收窄不被抵消 | `00` §4.20「未做」；本轮核对 `tools.ts` |
| 上下文的分层压缩 | 第 22 轮做了分层上下文（Project / Work / Ticket 三层） | Project/Work 的说明很长时怎么裁 | 尚未实现 | 一个裁剪策略（按层配额 or 按时间）+ 裁剪必须可见（在被裁的层里留一行"已裁 N 字"），否则又是一处静默 | `00` §4.18「未做（P5 剩余）」 |
| `Work.scope` 作为受理时的默认 scope | `Work.scope` 存在，但只作为上下文进提示词；受理时的 scope 来自 Trigger 的 `meta.scope` 或 `DEFAULT_SCOPE`（`policy.ts:328`） | "新 Ticket 未写 scope 时以 Work 的 scope 作为受理时的 scope" | 仅有设计 | 动 `requestedScope`——`00` §4.18 明说这属于授权路径、得单独评估；评估的产物是一条决定，然后才是代码。**chat 那边已经做过一次同类的决定**（`00` §4.33 裁定 4：chat 消息不honour `scope` 前置字段，因为"让一个非操作者的发送者设定工作的授权范围，等于让请求方自己写自己的授权"），这条决定可以直接引 | `00` §4.18「未做」、§4.33 裁定 4；本轮核对 `policy.ts:328` |
| `Engine.artifactsOf` / `dispositionOf` / `trigger` | 三个方法实现完整（本轮核对：`engine.ts:920`、`:872`、`:820`），`src/` 内**零调用者**、`tests/` 内也零调用者 | **未接入**。而面板读产物走的是 `Runtime.artifacts()`（`runtime.ts:619`）→ `store.artifacts.list()`，**绕过了 Engine** | 部分实现 | 二选一：让 `Runtime.artifacts()` 改调 `engine.artifactsOf()`（则"面板看到的产物来自 Engine"才成真），或删掉这三个同义方法。加一条契约测试钉住选定的那条 | `07` C43 / §8.2 第 3 条；`00` §4.25 的裁定；本轮核对调用者 |
| 规则引用上游的**产物** | 规则只在 `ticket.ended` 上触发（`rule.ts` 订阅），能读上游的 `result`；`when` 支持 `outcome` 与可选 `workId`（`policy.ts:132-136`） | 产物条件（第 25 轮做的是 worker→worker，规则侧没有） | 尚未实现 | `RuleSpec.when` 加产物条件 + 一个在规则评估里读产物的路径；先解决"规则读到的是数据还是指令"（同本节第 1 行） | `07` C182；`00` §4.15、§4.18「未做」；本轮核对 `policy.ts:132-136` |

---

## 3.1 `executor.sandbox`：一个会说自己还不支持的旋钮（0.10.0 登记）

`settings.executor.sandbox: 'local' | 'vm'` 是 0.9.0 为"将来把 worker 放进虚拟机"预留的字段。
**它至今没有第二个取值可用的实现**：`DshExecutor` 恒定构造 `LocalHostSandbox`
（`src/app/executor.ts:126`），`'vm'` 没有任何对应的类。

0.9.0 的问题不是"没实现"，而是**没实现却静默**：把设置改成 `'vm'`，系统行为一个字节都不变、
不报错、不上健康板——一个在撒谎的配置项比没有这个配置项更坏，因为操作者会以为自己的任务被隔离了。

0.10.0 的处置是让它**说真话**而不是删掉它：`Runtime.announceSandbox()` 在启动与每次保存设置时检查，
`'vm'` 就在健康板上写一行"this build has no VM sandbox: every Ticket still runs in a directory on this host"，
改回 `'local'` 时清除（且只在条目已存在时清除，因为 `entry()` 按需创建，无条件调用会给一块
形状被既有断言钉住的健康板凭空加一行）。没有选择删字段，是因为 `SettingsSchema` 是 `.strict()`：
任何**已经存过**这个键的部署会在启动时解析失败，那比一个诚实的旋钮更糟。

**接入 `vm` 还差什么**（`ExecutionSandbox` 现在只抽象了两个动作，其余六处仍是宿主直接 IO，
逐条列在 `src/app/executor.ts` 接口注释里）：附件投递（`executor.ts` 的 `prepareDirectory`）、
`RESULT.md` 与 `REPLY-UNDELIVERED.md`（`delivery.ts`）、任务删除时的目录清理（`runtime.ts`）、
目录列举与度量（`files.ts`）、以及 `prepare` 命令的执行（`executor.ts` 的 `run`，其 cwd 是 workRoot
——一个在 VM 内根本不存在的宿主路径）。在这六处搬进接口之前，`ExecutionSandbox` 只是**给边界上的两个洞
起了名字**，不等于封装了边界；而它会"看起来能跑"，错误只在真上 VM 那天暴露。

## 4. P3 协作

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 协作通道 `noteFromWorker` 在真宿主上跑一次 | 工具已注册在 worker 作用域（`tools.ts:135`）；`POST /api/tickets/:id/note` 在 `http.ts:427`；面板有工作 tab 与备注框（`panel/index.html:857` 的 `d-note` 文本框）；离线有覆盖（`engine.ts:411`/`:940` 的 Work 边界各一条） | 一次真宿主观测。第 33 轮与第 38 轮两次验收都**没有**驱动它（本轮核对 `14`、`16`：`note_ticket`/`noteFromWorker` 零命中）。`02b` §7.4 当时说"线上不可达（`attachWork` 零调用者）"，**这个前提已过期**（`POST /api/tickets/:id/work` 在 `http.ts:396`） | 离线验证 | 安排两张同属一个 Work 的 Ticket 同时在跑，让其中一个调 `myagent_note_ticket`，然后在另一个的事件日志里看到那条 `input` 事件（`engine.ts:418` 记 `{kind:'agent', id:sourceTicketId}`）。`07` §9 第 10 条把这条从"不可能验"改成"可以验、只是没验" | `02` §12；`02b` §7.4；`07` §9 第 10 条；本轮核对 `14`/`16`/`http.ts` |
| `assignment_stale` 真的被抛出 | 离线有覆盖（S11 的两条，经变异检验）；正面那一半已得证：两个尝试各保有自己的报告（`item6-ticket.json`） | 一次驱动。`retryTicket` 先结束旧尝试再开新尝试，新尝试**顺序**恢复同一个 Session（`item6-worker.jsonl` 的 turn 号是 `[1,2]`），所以造不出"被取代的尝试迟到汇报" | 离线验证 | 需要一个能让旧尝试在新尝试运行期间汇报的场景——离线靠桩的 `delayMs`，线上要靠一个真的并发尝试。`02b` §1 的建议措辞就是"本轮未驱动，仅有离线覆盖" | `02b` §1；`02` §6 与 §12 |
| worker 请求**新**工作 | `myagent_create_ticket` 只在主 Session 上（本轮核对 `tools.ts:161`；worker 作用域只有三个工具） | worker 侧的同名工具。硬阻塞是 D7 的 `system_actor` 那道拒绝：worker 的 actor 是系统 actor，而 `allowSystemActors` 默认关 | 仅有设计 | 先把"谁可以授权工作"变成策略决定（即 §2 的 Assessor / `inferred` 那条），否则加工具只会撞墙 | `07` C129；`00` §4.11「未做」、§3 D7；本轮核对 `tools.ts` |
| 协作的第二种形态：请求对方做一件事 | 只有"交一条事实"（`noteFromWorker`） | 需要对方 Mandate 同意的那种请求 | 尚未实现 | 属于 P3 第二块：一个新的 Input 类型 + Mandate 侧的同意语义 + 面板上的同意入口。`00` §4 的排期里它是"唯一一个非加法的改动" | `00` §4.11「未做」、§4 P3 |

---

## 5. P2 依赖图

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 依赖图与级联取消在真宿主上被驱动过 | 四条路由存在（本轮核对 `http.ts`：`GET`/`POST tickets/:id/dependencies` `:408`/`:414`、`POST …/drop` `:421`），面板有依赖区块；离线有 5 条部署级 + 5 条级联测试；级联的语义已写清（`engine.ts:1062-1085`：只级联 `on:'done'` 的边，`failed` 与 `dropped` 的区别一路带下去，`stop` 刻意不级联） | 一次真宿主驱动。第 33 轮与第 38 轮两次验收都没有建过一条边（本轮核对 `14`、`16`：`dependencies` 这个路由零命中，`16` 末尾那份清单里出现的是库表名 `ticket_deps`/`projects`/`works`，不是路由） | 离线验证 | 在隔离宿主上建一条 A→B 的边（`on:'done'`）、让 A `failed`、观察 B 是否被级联结束并留下 `failed`/`ended` 事件（`engine.ts:1078` 记 `{cascaded:true, upstream, outcome}`）。`02b` §5 末段记的"全库 `type='ended'` 的事件 0 条"正说明这条路径线上一次都没走过 | `02` §5 与其【已过期】指针；`07` §9 第 9 条；`02b` §5 末段；本轮核对 `14`/`16` |
| Project / Work / 依赖的 HTTP 入口被真宿主驱动过 | 入口存在（本轮核对 `http.ts`：`POST projects` `:383`、`POST works` `:390`、`POST tickets/:id/work` `:396`），面板有「工作」tab（`panel/index.html:134`） | 任何一次真实的创建。日常库那些 Ticket 本来就不属于任何 Work，所以 `workId`/`workSeq` 不出现是正确行为，不是 bundle 旧 | 离线验证 | 一次 `POST projects` + `POST works` + `POST tickets/:id/work`，然后确认列表页显示出工作名与"第 N 位" | `02` §3 与【已过期】指针；`07` §9 第 8、9 条；本轮核对路由表 |
| Project / Work 的**改名与删除** | `POST projects`、`POST works`、`POST tickets/:id/work` | `PUT` 与 `DELETE`。本轮核对 `src/app/http.ts`：`PUT` **恰好 2 条**（`:580` settings、`:593` prompts），`DELETE` **0 条**；`BodySchemas` 里没有更新形状 | 尚未实现 | 两条路由（`PUT works/:id`、`DELETE works/:id`）+ `BodySchemas` 的更新形状 + 面板工作页的两个按钮 + 删除时的归属处置决定（Ticket 变成"未归入"还是拒绝删除） | `07` C136 / §10.2；`05` §5；`00` §4.19「其余未做」；本轮核对路由表 |
| 按 Work 的依赖 | 只有 Ticket 之间的边（`ticket_deps`，PK `(upstream, downstream)`） | Work 级的边 | 尚未实现 | 先决定语义：Work 等 Work 是"全部 Ticket 结束"还是"最后一张结束"；然后决定它是否与级联取消共用一条路径（`cascadeFrom` 是递归的，Work 级会需要一个不同的终止条件） | `00` §4.8「未做」；本轮核对 `engine.ts:1069-1085` |
| 被级联结束的 Ticket 进 attention 列表 | 级联能自动结束一串 Ticket，并且**理由是可见的**：`ended.reason` 写着"这张在等 Ticket xxx，所以它无法进行"（`engine.ts:1076`），事件里带 `cascaded:true`，`ticketStage` 会显示 `failed`/`dropped` | 它们不进 attention。本轮核对：`ended()`（`engine.ts:215`）只写 `ended`、从不写 `attention`，而 `waitsForPerson`（`model.ts:377-382`）对任何 `ended !== undefined` 的 Ticket 直接返回 `false`。所以"结束方式不可见"（B2）在级联之下被**放大**成"一串 Ticket 消失了，除非你去翻列表" | 尚未实现 | `attention` 的查询条件加一类"被系统结束的"，面板上给一个可筛的标记。**不要把 `waitsForPerson` 改成对 ended 返回 true**——它的注释明写"An ended Ticket waits for nobody"，那是另一条语义 | `00` §4.8「未做」末句；本轮核对 `engine.ts:215`、`model.ts:377-382` |
| 依赖对端候选超过 200 张 | `GET tickets?state=all&limit=200` 提供候选（`05` §1 表），超出的可以手填 id | 一个能选到第 201 张的选取器 | 尚未实现 | 一个带搜索的对端选取（服务端加 `?q=` 或提高分页），否则大库上手填 id 是唯一路径 | `05` §5；`00` §4.19「其余未做」；`07` C205 |

---

## 6. P4 Watchdog 与主动任务

**本节必须与 `02b` §5（N1–N7）和 `14`（第 33 轮真宿主验收）一起读。** 那批缺陷里，N3、N1 的升级那半、
"停止后无写入"三条**已在真宿主上得证**，S38、N8 已修——四条都在**附录 A**，不在下表。
下表里剩下的每一条，缺的都是同一类东西：**一次真宿主驱动**，或**一个还没写的机制**。

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 救援**重新启动一个真的死掉的 launch**（N1 剩下的那一半） | `rescueStuckLaunch`（`executor.ts:181-183`）现在只 `effects.enqueue('launch', …)`、**不再** `starting.delete`，所以这张 Ticket 一直看得见、`actionsTaken` 能累加到 `maxActions`；离线有回归测试（`tests/executor.spec.ts:503`，靠桩的 `delayMs: 1500` 造出"一个仍在飞的 launch"）。真宿主已证的是**另外三条**：2 条 `rescued`、升级可达、槽位不少计（`14` 场景 1、3） | 一次"launch 真的死了、`starting` 里还留着它"的驱动——**离线和线上都还没有**。`14` 场景 1 的旁证恰恰量到了相反的一面：全程只有**一个** `sleep 90` 进程（pid 38023），两次救援各自 `enqueue` 的行**都被在飞的那次吸收**（`launch()` 在 `used() >= maxWorkers` 时抛 `Later`），停机时 `effects` 表 0 行。而离线那个 `delayMs` 造的也是"在飞"，不是"死了" | 部分实现 | 一个能表达"prepare 进程没了、`starting` 还在"的场景：离线要么给桩一个"启动后进程消失但 launch 不返回"的旋钮，要么直接调 `rescueStuckLaunch` 并断言新的一次 `spawn` 真的发生；线上要一个真的会死的 prepare（例如 `sleep 90 & kill $!`）。**在此之前，"救援能救活一个死掉的启动"这句话没有证据** | `02b` §5 N1、§6.1、§6.2；`14` 场景 1 与场景 3、§7 第 4 条；`00` §4.29；本轮核对 `executor.ts:176-183`（它的文档注释自己写着重新入队修的是哪一种：**"a row lost with the process that claimed it"**，即那一行随进程一起丢了——而不是"进程还活着但卡住了"）、`tests/executor.spec.ts:503` |
| 改 `watchdog.everyMs` 会当场重新上膛（N2） | **二次修复已落地**：`saveSettings` 直接调 `watchdog.settingsChanged()`（本轮核对 `runtime.ts:578`），`armedEveryMs` 与新值不同就 `arm()`（`watchdog.ts:165`）；一条测试钉住两面（`tests/watchdog.spec.ts:142`：`takes effect without a restart, and does not push the next look further away`），**经变异检验**（从 `saveSettings` 里去掉那行调用，测试变红） | 一次真宿主复验。**第一次修复曾被真宿主证伪**（`14` 场景 2 判定「证伪【实测】」：检测时延 34.729s，`rescued#1` 命中 `mountedAt + 7×60s` 网格、残差 **+23ms**，偏离 PUT+10s 网格 **2849.7ms**，而 PUT 后 20s 那次"必须 rescue"的 look 根本没发生），机制的三条腿都被实测（`14` §2.1、§2.2 的 B-1/B-2） | 离线验证 | 一次隔离宿主验收：以 `everyMs=60000` 挂载、让一个 launch 卡住、PUT 改成 `10000`，然后断言下一次 look 落在 PUT+10s 网格上（**要看网格，不能只看时延**——`14` §2 的教训是时延 34.7s 既不到"≥50s 就是没修好"那条线、也不在 10–25s 举证带内，单看它定不了案）。顺带读一眼 `armedInterval`（见下面第 9 行） | `02b` §5 N2；`14` 场景 2、§2.1、§2.2；`00` §4.29（N2 的第二次修复）；本轮核对 `runtime.ts:578`、`watchdog.ts:165` |
| 静默 worker 探测器（`silentMs`） | 第 16 轮落地，动作是 `interrupt`（`haltBackground` + `assignmentInterrupted`），走的是**不**被效果泵阻塞的那条路；离线有 3 条（`tests/watchdog.spec.ts:93`、`:105`、`:118`，含"已经动过两次就不再动并说需要人"与"打断失败要报出来"） | 任何一次驱动。默认 `silentMs: 0`（关闭，`policy.ts:234`）。`02b` §7.5 明说："机制上**可能**没被 N1 影响，但我没有证据。别把它标成'应该没问题'"——**这句怀疑今天仍未核实**，而 N1 的机制已修，所以它现在是一个纯粹的"没驱动过" | 离线验证 | 一个真 Session 长时间不产事件 + `silentMs` 设为小值；先确认它不受效果泵串行化影响（`interrupt` 不经队列，所以理论上不受，但这正是要证的那件事），再验 `interrupt` 到达、`escalated` 事件落地 | `02` §7 末段、§12；`02b` §7.5；本轮核对 `policy.ts:234`、`watchdog.ts:96/134-136`、`tests/watchdog.spec.ts` |
| 规则来源的 deny / pause 是**无损**的（N4） | 第 24 轮修（本轮核对 `rule.ts:60-66`：`if (!source.enabled) return`，然后 `const own = sourcePolicy('rule', …)`、`if (own.paused \|\| own.deny) return`，注释逐字写着"Going through the gate instead is lossy in a way that cannot be undone here"）+ 两条测试：deny 期间不产出**且**结束没被记成任何东西；pause 解除后**下一次**结束正常请求 | 一次真宿主复验。**曾被证伪为有损**：deny 走门禁 → Trigger 存成 `ignored` → 而规则 Trigger id 是那次结束的纯函数，**永远不能被重新评估**（`02b` §5 N4 的对照证据：inbox 同一个 `deny` 旋钮是无损的，文件原地不动、解除后受理并归档） | 离线验证 | 隔离宿主上给一条规则设 `deny`、让上游结束、再解除 deny，确认没有留下 `ignored` 的 Decision，且**下一次**结束能正常起链 | `02b` §5 N4；`00` S35 表、第 24 轮；`07` C178；本轮核对 `rule.ts:60-66` |
| 被深度截断的链留下痕迹（N5） | 第 24 轮修：`Engine.ruleChainStopped` 把 `{rule, depth, maxDepth}` 写进**上游** Ticket 的日志（新事件类型 `rule_stopped`，本轮核对 `engine.ts:1049` 的 `record(…, 'rule_stopped', {kind:'system', id:'rule'}, detail)`），经变异检验 | 一次真宿主复验。**曾实测**：深度守卫线上真的触发过（`reached depth 2 of at most 1`），随后那行告警被下一次无关的结束**擦掉**，而它是唯一的记录（`02b` §5 N5、§6.5） | 离线验证 | 隔离宿主上设 `maxDepth=1` 让链条在第二代被截住，然后 `GET /api/tickets/<上游>/events` 确认 `rule_stopped` 在，且再跑一张无关 Ticket 之后它**仍在** | `02b` §5 N5、§6.5；`00` 第 24 轮；`07` C47 / C74；本轮核对 `engine.ts:1049` |
| 健康板不再是一格共用的槽位（N9） | N8 修好之后，升级是 Ticket 日志里的一条 `escalated` 事件（`engine.ts:960`，`by={system,watchdog}`），**两条升级各自在自己的 Ticket 下、互不覆盖**，所以 N9 从"事实丢失"降为**显示层瑕疵** | `health.watchdog` 仍然是所有 Ticket 共用的一格：A 的 `ok:false`"需要人"会被**无关的** B 的一次救援静默覆盖成 `ok:true`"1 stuck launch(es) rescued"，中间没有任何确认（`14` §7 第 2 条实测：`04:34:25.830Z` 的那条一直保持到 `04:49:25.986Z` 才被覆盖） | 部分实现 | 要么给升级一个自己的健康条目（`health.entry('watchdog:escalated')` 一类），要么在覆盖前判断"当前挂着的是不是一条未确认的问题"。**不要只加时间戳**——`00` §4.30 的判词是"只修症状会一直有新症状，根因是把持久事实放在了易失的地方"，而持久那一半已经修好了 | `00` §4.29 N9、§4.30 的重新定性；`14` §7 第 2 条；本轮核对 `engine.ts:960` |
| 健康板上的升级条目不会一边过期一边看起来是当前的（N10） | 同上：事件的 `at` 是它发生的时刻，不会冻结，所以持久那一半已经对 | 健康条目本身仍会冻结：`14` §7 第 3 条实测 `health.watchdog.at` 停在 `04:34:55.835Z` 约 **14.5 分钟**，而同期 `look()` 每 10s 照跑（`04:49:25.986Z`、`04:49:35.990Z`）——因为 A 的 launch 完成后离开了 `starting`，`rescueStuck` 再也看不到它，于是没人再刷新那一格。**面板读到的是 15 分钟前的话，却带着"当前健康状态"的身份** | 部分实现 | 与 S38 同一个选择摆在面前：要么让 `look()` 每轮对这一格说一句"此刻没有卡住的启动"（那需要 `00` §4.43 那套 `complained` + "仍然 pending 就不清"的语义，否则会造出假的"一切正常"），要么照 S38 的先例**把这个数字删掉**——决定性的一条证据是它有没有读者 | `00` §4.29 N10、§4.30、§4.38（S38 的修法与它的判据）、§4.43（"清除的条件是否与被清除的事实同寿"）；`14` §7 第 3 条 |
| 升级的**撤回**：一次只是慢的启动后来成功了（N11） | 日志现在是 `created → rescued → rescued → escalated → launched → report`，**读者可以自己看出那次升级是虚惊**（`launched` 在 `escalated` 之后、Ticket 最终 `done`）；`escalated` 刻意**不计入** `actionsTaken`（`00` §4.30：升级不是"采取的行动"，而是"行动失败了"这个结论） | 系统主动对账。`14` §7 第 4 条实测：两张 Ticket 最后都 `outcome:"done"`（A 在 `sleep 90` 自己跑完后于 `04:35:01.199Z` 启动），而那次"需要人"**没有任何东西把它撤回**——所以它可能是一个永远不会被纠正的假警报 | 尚未实现 | 一个"升级已失效"的事件（例如 `launched` 时若该 Ticket 有过 `escalated`，就补一条 `de_escalated` 并在 `detail` 里指向那条 `escalated`），面板上把两条一起显示。**先决定它是不是一个事件**：撤回也是一件发生过的事，按本项目的规矩它该进日志而不是只改健康板 | `00` §4.29 N11、§4.30 末段；`14` §7 第 4 条 |
| `armedInterval` 这个诊断有线上出口 | 第 33 轮加的只读诊断：`Watchdog.armedInterval()`（`watchdog.ts:75`）与 `Runtime.watchdogArmedInterval()`（`runtime.ts:447`），离线有 3 处断言（`tests/executor.spec.ts:631`、`:636`、`:641`）。加它的理由写在 `00` §4.29："没有它，'我的改动生效了吗'只能靠推断，而这次验收正是靠 23ms 的网格吻合才推断出来的" | **未接入**：本轮核对 `grep -n "armedInterval" src/app/http.ts panel/index.html` → **零命中**，所以真宿主上仍然只能靠推断 | 部分实现 | 把它挂进 `GET state`（例如 `state.watchdog = {armedEveryMs}`）+ 面板健康区一行。这是 N2 复验那条（本节第 2 行）的**前置**：没有它，复验仍然要靠算网格残差 | `00` §4.29；本轮核对 `http.ts`、`panel/index.html`、`tests/executor.spec.ts` |
| 规则能对"卡住了"或"某个产物出现了"设条件 | 规则只 `subscribe` `ticket.ended`；`when` 只有 `outcome` 与可选 `workId`（`policy.ts:132-136`） | 其它触发条件 | 尚未实现 | 一个事件订阅面的扩展（`ticket.stuck`、`artifact.registered`）。`ticket.stuck` 需要 Watchdog 先能把"卡住"发成事件——第 34 轮的 `escalated` 已经示范了这条路径（`WatchdogHost.escalate` → `Engine.watchdogEscalated`），所以它比旧版记的近了一步 | `07` C181；`00` §4.15「未做」、§4.30；本轮核对 `policy.ts:132-136` |
| 面板上的规则编辑界面 | `panel/index.html` 里 `rule` 只作为来源名出现；排期页编辑的是 `sources.cron.schedules`；聊天一节显示按来源策略（`policy` 用门禁自己的 `sourcePolicy`），但那是**只读的 chips** | 规则的增删改。本轮核对：面板里 `allowSystemActors` **0 命中**、`deny` 只 3 处命中且都在聊天一节的说明文字里，即**按来源策略的编辑控件一个都没有** | 尚未实现 | 设置页里一个规则列表 + 表单（`when` / `then.prompt` / `then.workId` / `maxDepth` / `allowSystemActors`），复用排期页已有的形状。注意 `then.workId` 的写入路径**已经通了**（第 22 轮，见附录 A），所以表单可以直接带这个字段 | `07` C183；`00` §4.12、§4.14、§4.15「未做」、§4.17；本轮核对面板 |
| `Schedule` 绑定 Work | 按来源策略已就位（第 14 轮）；**规则那一半已经通了**（`RuleSpec.then.workId` → `Trigger.meta.work` → 受理时归类，`rule.ts:96`、`engine.ts:292-299`） | `ScheduleSpec` 里没有 `workId`（本轮核对 `policy.ts:20-51`：`id`/`name`/`enabled`/`prompt`/`scope`/`timing`，无 `workId`），所以排期产出的 Ticket 不能归类 | 尚未实现 | `ScheduleSpec` 加 `workId` + `cron.ts` 把它写进 `meta.work`（引擎那一半已经在，`engine.ts:292` 的注释逐字写着"a rule's `then.workId`, or a schedule bound to one later"）+ 一条测试。**这是纯加法，且引擎侧已经预留** | `00` §4.6、§4.16「未做」；本轮核对 `policy.ts:20-51`、`engine.ts:292-299` |
| `failTicket` 有一个生产调用者 | 实现完整、语义明确（`engine.ts:834`），`tests/engine.spec.ts` 里 4 处调用（本轮核对：`:705`、`:724`、`:763`、`:774`） | **未接入**：零生产调用者（本轮核对 `grep -rn failTicket src/` → 只有 `:834` 那一处定义）。`00` §4.9 预定的那个（P4 的 Watchdog：超时 / Session 消失 / 预算耗尽）**没有用它**——Watchdog 用的是 `rescueStuckLaunch`、`assignmentInterrupted` 与第 34 轮的 `escalate` | 离线验证 | 让 §2 的预算探测器在超限时调它（那是它被设计出来的用途），或明确判定它是死代码并删掉。`07` §9 第 11 条："预定的那个阶段已经过去了"。**标签依据**：`07` §0.1 明写"一个能力有测试但没有调用者，就是 **离线验证**，并且要写出'没有调用者'这件事" | `07` §10.2 / §9 第 11 条 / §0.1；`00` §4.9；本轮核对调用者 |

---

## 7. 面板与 HTTP 出口

**一条贯穿本节的事实**：面板的 **185 条断言全部跑在 jsdom**（`tests/panel.spec.ts` 首行 `// @vitest-environment jsdom`，
`vitest.config.ts` 的默认环境是 `node`；185 这个数字取自 `/tmp/myagent-gate.log` 第 45 行，即 **00:43 那次闸门**——
`tests/panel.spec.ts` 在 02:03 又被并发改过，所以下一次闸门会给出一个新数）。
`panel.spec.ts` 自己的文件头把这条限制写得很准："jsdom runs no script that reaches it through `innerHTML`,
so the page's own IIFE is evaluated by hand"。**没有任何一条面板断言经过真浏览器。**

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 面板在**真浏览器**里的行为 | 185 条 jsdom 断言；第 23 轮额外用 jsdom + 真 fetch 代理到 3080 打过一次线上宿主（`05` §4：横幅出现、整段会话对 V2 路由只发 1 次请求、toast 0 条） | 一个真浏览器 harness。`scrollTop` 还原（`panel/index.html` 里 `scrollTop` 2 处命中，全是代码、无浏览器证据）、横幅的 flex 排版、Blob 下载、剪贴板（`panel.spec.ts:843` 的注释自己写着"jsdom has no clipboard"）、以及"jsdom 不执行经 `innerHTML` 到达的脚本"这个前提带来的全部差异 | 部分实现 | 一个 Playwright 一类的驱动跑**同一批**断言。未验证的那一半是 **尚未实现**：连验证手段都没有 | `07` C196 / §10.2；`05` §5 末条；`11` §7 第 1 条；本轮核对 `vitest.config.ts`、`panel.spec.ts`、gate.log |
| `#work=<id>` 深链 | 只有 `#ticket=<id>`；工作页的开合状态跨 5 秒刷新保留，但不进地址栏。本轮核对 `grep -c 'work=' panel/index.html` → **0** | 深链 | 尚未实现 | 在现有的 hash 解析里加一个 `work=` 分支 + 一条测试 | `07` C205；`05` §5；`00` §4.19「其余未做」；本轮核对面板 |
| 事件类型的筛选与中文对照 | 历史区块按原词显示 `type`（与 `stage` 一致）；本轮核对面板里没有任何事件类型筛选控件 | 筛选与对照。**联合已经长到 21 个成员**（第 50 轮新增 `resumed`）（`model.ts:130-133`：`created`/`launched`/`delivered`/`delivery_failed`/`report`/`turn_ended`/`input`/`retried`/`interrupted`/`stopped`/`failed`/`ended`/`classified`/`session_bound`/`dependency`/`rescued`/`rule_stopped`/`escalated`/`reply_lost`/`notice_lost`），旧版记的是 17 个 | 尚未实现 | 一张 `type` → 中文的对照表 + 一个筛选控件。**对照表必须是 20 条**：第 24 轮加了 `rule_stopped`、第 34 轮 `escalated`、第 36 轮 `reply_lost`、第 40 轮 `notice_lost`，而其中三个（`delivered`/`delivery_failed`/`session_bound`）**永远不会有数据**（见 §8）——对照表要能说出这件事，否则操作者会以为筛选坏了 | `07` C205；`05` §5；本轮核对 `model.ts:130-133` 与面板 |
| `GET triggers` 有页面使用它 | 路由存在（`http.ts:519`），离线有测试（`tests/http.spec.ts:147-149`）；**`GET lost` 有页面**（第 46 轮：`#lost-count` 页头药丸 + 「丢失的请求」区块，面板里 `lost` 64 处命中） | `GET triggers` 仍然没有任何页面。本轮核对：`panel/index.html` 里 `triggers` 只有 **1 处**命中，而它是「丢失的请求」区块里的一句说明文字（`:1380`"所以它们不在 triggers 表里…"），不是请求 | 部分实现 | 一个"来源活动"页签列出 Trigger 与其 disposition（现在 disposition 有五个状态，含 `lost`）；然后把契约测试里那条排除删掉——`05` §3 记的是"契约测试仍然要求'问到的路由集合 == 路由表减去 `GET triggers`'"，它是这个缺口唯一的管理手段。**注意 `GET lost` 落地之后这条排除的措辞要重写**：现在被排除的是一条仍然没人用的路由，而它的邻居已经有页面了 | `07` C135；`05` §3、§5；`00` §4.19「其余未做」；本轮核对面板与 `http.ts` |
| 面板与 API 版本不一致被覆盖成"部署事实" | 面板有能力探测（时机是启动 / 刷新按钮 / 设置保存后 / 横幅上的重试，**定时器不探**）；聊天一节另有自己的探测（用 `state.chat.policy` 是否存在，不发额外请求、不弹 toast、插件重载后自愈，横幅与 V2 那条互斥）；线上旧插件宿主实测过一次 | 持续验证。那一次是 jsdom + 真 fetch，不是浏览器，也不会再跑。**而且本轮起这条更难了**：日常宿主的 HTTP 面现在要认证（§0.1），所以连"手工再看一眼"都要先拿到那条 URL | 部分实现 | 把那次实测固化成一条可重复的检查（`verify-live.sh` 加一步：探测路由 + 比对 `mountedAt`），而不是靠一次手工观测。`verify-live.sh` 本身也要先能过认证（它今天用 `curl` 直连，本轮那条 401 会让它每一步都失败） | `11` §7 第 3 条；`05` §4；`00` §4.36；本轮实测 401 |
| 一张在跑的 Ticket 的轮询成本 | 详情每 3 秒发 5 个读请求（ticket/progress/files/dependencies/events），已结束的 Ticket 不轮询 | 收窄。`00` §4.19 给了最省的杠杆："只在 pending/queued 时轮询依赖" | 部分实现 | 按 stage 分频：依赖只在 pending/queued 时读。这是一个决定加几行代码，不是新功能 | `00` §4.19「其余未做」的成本提示 |
| README 的三处漂移 | README 的表清单**已经对了**（本轮核对 `README.md:218`："11 张表 —— schema_version / triggers / tickets / decisions / effects / kv / artifacts / projects / works / events / ticket_deps"，第 33 轮修的） | 三处仍然错：① `README.md:249` 的面板行列 7 个页签（Ticket / 派活 / 门禁记录 / 来源 / 排期 / 设置 / 提示词），**实际 8 个**（`panel/index.html:133-140`：多一个「工作」`data-tab="works"`）；② `README.md:237` 的 `src/sources/` 行列了 kind/cron/inbox/session/rule/registry，**漏了 `chat.ts`**；③ `README.md:241` 说"`docs/v2/` 十五份文档（约 6100 行）"，**实际 19 份 8951 行**（本轮 `wc -l`），且漏了 `14`–`17` 四份 | 尚未实现 | 改 README 那三处。②③ 是第 35–46 轮长出来的新漂移，①是第 21 轮就欠的 | `00` §4.19「其余未做」末句、§4.26、§4.28；本轮核对 `README.md:218/237/241/249`、`panel/index.html:133-140`、`wc -l docs/v2/*.md` |
| 构建时间与产物哈希可见 | `/api/state` 带 `policyVersion`（`http.ts:285` 附近）与 `mountedAt`（`http.ts:285`，实现 `runtime.ts`） | 构建时间与产物哈希。`00` §4.26 说明了为什么没做：面板每 5 秒轮询一次，不该每次都算一次 SHA。**本轮起这件事的价值变高了**：HTTP 面要认证之后，"线上跑的是哪一版"连手工 GET 都问不到了（§0.1），而 `mountedAt` 只能回答"什么时候挂的" | 尚未实现 | 要么缓存 SHA、要么单开一条 `GET /api/build`；`00` §4.26 把这两个选项都写好了 | `00` §4.26；本文 §0.1 的实测 |
| 一条丢失的请求能被**重新投一次** | 记录已经在了：`lost` 行把 payload 原文存进 `triggers.record`（`store.ts:349-353` 的 `insertLost`，`LostTrigger.raw` 的注释写着"The payload exactly as it arrived"），退化路径的原文在有界 kv 里；`GET lost` 把两条路径分开返回（`http.ts:542-578`）；面板明写"**系统不会自动重放它们**"，并且**没有给一个不可能成功的按钮**；`receive` 不再把 `lost` 行当重复，所以同一个请求再来一次门禁会重跑 | 任何重放入口。而且 `GET lost` 对 row 路径只返回 `id/source/kind/at/title?/error/effectKey` **六个字段，不返回 `raw`**——所以连"照着原文手抄一遍再投一次"都做不到（退化路径的 `payloads` 反而逐字返回原文，两条路径在这一点上不对称） | 尚未实现 | 先决定要不要重放（"系统不会自动重放"是刻意的诚实陈述，不是缺陷）。若要：一条 `POST lost/:id/replay`，服务端自己从 `triggers.record` 读原文重新入队为 `trigger` 效果——**不要**把 `raw` 加进 `GET lost` 的返回，那会把一段不可信文本送到面板上（§10 第 3 行）。幂等性是安全的：Trigger id 是那次请求的纯函数，所以重放不会产生第二张 Ticket | `00` §4.42、§4.45、§4.46；本轮核对 `store.ts:349-353`、`http.ts:542-578`、`engine.ts:33-47`、`:256-266` |

---

## 8. 数据与迁移

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| 降级路径：真的装回旧构建跑一遍 | 副本演练证明"改版本号之后旧构建需要的数据都在"（迁移前后四张数据表摘要逐字节相同 `dacb42ed007e2b26`，回滚演练也过了）；`SchemaTooNew` 两个方向都有测试（`tests/store.spec.ts:297-309` 把版本号写成 99 确认拒绝打开、`:312+` 用一个真的 version-1 库确认迁移路径） | 一次真实的降级。**S37 之后这一条从纸面推演变成了真实风险**：日常库现在是 5，任何旧构建挂上来都会 `SchemaTooNew` 拒绝打开，而这条路径一次都没被观测过 | 尚未实现 | 一个保留了 v1 构建的分支或标签。本轮核对：项目目录**不是 git 仓库**（`git log` → "致命错误：不是 git 仓库（或者任何父目录）：.git"），所以这件事目前**没有载体**——先 `git init` 或把旧产物存档，才谈得上演练。`store.spec.ts:303-308` 那条还差半句：它断言了抛出与错误文本，**没有单独断言"没有写入"**（构造函数抛出使它在结构上成立，但结构成立与被证明是两件事） | `03` §6；`07` C212 / §10.2；本轮核对 git 与 `store.spec.ts` |
| `triggers.list()` 的排序在两个实现里一致 | `Store` 是 `ORDER BY at`（`store.ts:356`），`Memory` 是插入序（`memory.ts:15` 的 `[...this.records.values()]`）；`transaction.spec.ts:28-33` 的注释把这条**明确排除在事务契约之外**，并说清了两个实现"两条记录 `at` 相同时顺序不同" | 一致。`00` §4.5 自己就把它记为"顺带发现一个真实分歧（不属于事务契约）" | 部分实现 | 给 `Memory` 加同一个排序键（`at` 之后用 id 打破平局），或让契约测试钉住"顺序未定义"。**它现在有一个真实读者**：`GET lost` 用 `triggers.list()` 枚举全部行然后 `reverse()`（`http.ts:551-566`，注释写着"`list()` reads oldest first"），所以 `Memory` 上跑的那批 http 测试与 `Store` 上的生产读到的是**两个不同的顺序**——今天恰好不出错，因为 `lost` 行的 `at` 各不相同 | `07` C53；`00` §4.5；本轮核对 `store.ts:356`、`memory.ts:15`、`http.ts:551-566` |
| `delivered` / `delivery_failed` / `session_bound` 三个事件类型有写入点 | 三个都在 `TicketEventType` 里声明（`model.ts:131-132`） | 写入点。本轮核对：这三个词在 `src/` 里**只出现在 `model.ts` 那两行**，`engine.ts` 的 22 处 `this.record(...)` 里没有一处写它们（`inputsDelivered`、`deliveryFailed`、`bindSession` 三个方法都只 `mutate` 行、不 `record`） | 仅有设计 | 三处各加一行 `this.record(...)`。后果是具体的：今天"输入到了没有""投递失败过没有""DSH 回的是不是另一个 Session id"这三个问题**事件日志回答不了**，而日志存在的理由正是"行里只有每样东西的最新版本"（`model.ts:138-141` 的注释）。**注意 `00` §4.7 那份清单已经就地更正过了**（第 31 轮：`dismissed` 根本没被声明、`delivered` 被漏掉），所以照着原文去补会补错一个、漏一个 | `07` C06 / §10.2；`00` §4.7【第 31 轮核实】；本轮核对 `model.ts` 与 `engine.ts` 的 record 调用点 |
| `DomainEvent` 与审计日志的类型统一（D5 的终局） | 两套并存：内存事件用于触发 pass，日志用于审计 | 统一。D5 的终局是让 `emit` 成为日志的投影 | 仅有设计 | 一次类型层面的合并：让 `record` 的形状与 `DomainEvent` 同源。这是 P1 里"最伤筋动骨的一步"，所以要先决定它值不值得做。**联合已经长到 21 个成员**（第 50 轮新增 `resumed`）（见 §7 第 3 行），每加一个都同时动两处，这件事的成本随轮次上升 | `00` §3 D5、§4.7「未做」；本轮核对 `model.ts:130-133` |

---

## 9. 验证、测试与工具链

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| `verify-live.sh` 第 4 步区分"插件坏了"与"上游 429" | 脚本 9 步都在，只读（不建 Ticket、不建 Session、不改设置） | 区分。本轮核对 `scripts/verify-live.sh:47` 仍是 `sys.exit(1 if bad else 0)`——对**任何** `ok:false` 都退出 1。**本轮起它还多了一个前置问题**：日常宿主的 HTTP 面要认证（§0.1），脚本用裸 `curl`，所以它今天在 3080 上会每一步都拿到 401 | 尚未实现 | 两件事：① 把上游 429 / 操作者自己刚造出来的问题 / 真故障分成三类退出码（`00` §8 第 9 项就是这一条）；② 让它能带着认证跑（读那条 token URL，或明确写"本脚本只适用于未开启 web 认证的宿主"） | `07` C209；`03` §6 末条；`02` §10；`00` §8 第 9 项；本轮核对 `verify-live.sh:47` 与实测 401 |
| 变异检验覆盖第 25–28 轮与面板 | 第 32 轮之后每一轮都记了自己的变异检验（`00` §4.32 六条、§4.33 三条、§4.34 八条、§4.36 五条、§4.38/§4.39/§4.43/§4.45 各若干），`11` §4.1 列了第 32 轮及以前的 11 处 | 第 25–28 轮那 7 条（624→631）只写了"测试 N 条"；面板 V2 UI 那 35 条（109→146）也未记。**`11` 的第 40 轮增补已经明说"总数本文不再声称"**，所以今天没有一个可引用的总数 | 部分实现 | 对每条修复撤掉一行、确认测试变红。`11` §4 末段说清了为什么这不是形式主义："没有它的测试仍可能因为桩的形状、断言写得太宽、或修复与测试同时被改而**通过却不管事**"。更强的形式是 `00` §4.40/§4.43/§4.45 三次执行的那个动作：**变异红了之后还要问"删掉哪些断言会让它变绿"** | `11` §4.1–§4.3；`00` §4.32–§4.45；`04` §0.8 |
| 临时目录清理 | — | 数百棵树。**本轮实测，比旧版记的严重两个数量级**：`$TMPDIR`（`/var/folders/cb/…/T/`）下有 **53,609 个 `myagent-*` 目录**、其中 **48,488 个 `.sqlite3` 文件、合计 2,940,026,880 字节（2.74 GB）**；33 个 spec 文件里只有 **4 个** import 了 `rmSync`（`notify.spec.ts`、`store.spec.ts`、`notify-machine.spec.ts`、`transaction.spec.ts`）。`11` §7 第 12 条从另一个单位量了同一笔债：**48 处 `mkdtempSync`（分布在 15 个文件）对 9 处 `rmSync`/`rm`** | 尚未实现 | `afterEach`/`afterAll` 里删掉测试自己建的 stateDir（`tests/helpers/deployment.ts:26` 的 `mkdtempSync(join(tmpdir(),'myagent-test-'))` 是最多的那个源头）。`00` §8 第 10 项就是这一条。**先清一次现有的 2.74 GB**，那是操作者的决定，本文没有删任何东西 | `11` §7 第 12 条；`00` §8 第 10 项；本轮 `find "$TMPDIR" -maxdepth 1 -name "myagent*" -type d \| wc -l` 与 `stat -f %z` 求和 |
| 套件的时间与环境隔离 | 只有 3 个文件用假定时器（本轮核对 `grep -rln useFakeTimers tests/*.spec.ts` → `panel.spec.ts`、`sources.spec.ts`、`watchdog.spec.ts`）；第 44 轮修掉了三处墙钟竞态（`sources.spec.ts` 里 `clockBefore` 6 处命中，把读时钟移到测试体开头） | 本轮核对仍在的：**7 个文件用真 `setTimeout`**（`background`/`chat`/`dependencies`/`effects`/`http`/`panel`/`sources`）配 2 秒泵间隔与 15 秒退避；`tests/background.spec.ts:25` 是一个真实的 10ms 界对一个 500ms 定时器；`tests/files.spec.ts:62` 依赖 60 秒墙钟窗口与文件系统 mtime 精度（`toBeGreaterThan(Date.now() - 60_000)`）；`tests/deployment.spec.ts:31-53` 与 `tests/notify-machine.spec.ts:144` 改全局 `process.env` | 部分实现 | 逐个换成假定时器 / 显式时钟注入，`process.env` 改成作用域内的替身。这些是 flaky 的来源，会侵蚀"退出码 0"这个信号的可信度——`00` §4.45 的判词值得抄在这里："**一条会随机变红的测试，会让人学会忽略红色**，那正是 0.1 要防的事" | `11` §7 第 12 条；`00` §4.45（三处 `toBeGreaterThan(Date.now())`）；本轮核对四个文件 |
| Windows 上的通知路径 | `notify-machine.spec.ts` 仅 POSIX（它改 `process.env.PATH` 来放一个假的通知程序） | Windows 上会静默找不到通知程序且无测试 | 部分实现 | 要么声明不支持 Windows 并让它显式失败，要么补一条 Windows 分支的测试 | `11` §7 第 12 条；本轮核对 `notify-machine.spec.ts:144` |
| 幂等键：`POST /api/tickets` | — | 任何幂等键。面板双击就是两张 Ticket | 尚未实现 | 一个客户端生成的请求 id + 服务端按它去重。相关的那条测试（`tools.spec.ts` 的 `opens one Ticket when the same request arrives twice…`）**只因为 harness 把时钟钉成了常量**（本轮核对 `tests/tools.spec.ts:61` 的 `now: () => '2026-11-03T02:00:00.000Z'`）才成立——生产里 Trigger id 含 `at = now()`，相隔一毫秒就是两张 Ticket | `11` §6 末段；`07` C221；`00` §6；本轮核对 `tools.spec.ts:61` |
| 桩的保真度：五条未修的分歧 | `tests/helpers/host.ts`（本轮 **509 行**，旧版记 429）与 `deployment.ts`（38 行）都是桩；第 41 轮给它加了 `notify = {fails, error?}` 旋钮与 `host.refusals`（`host.ts:270`、`:321-326`），**注入点正是 `src/` 里仅有的两个调用点**，所以队列真实的 5 次重试 / 退避 / 放弃路径原样跑过 | 五条分歧逐条本轮核对仍在：① `inject` 立刻进 `agent.notices` 与 `log`，而真 DSH 放进 `inbox.nextStep` 由 driver 领取——桩**声明了 `nextStep`（`host.ts:72`、`:125`）却从不往里推**，所以"跨重启至多一次"在 inject 路径上是假的；② `followup` 把消息永远留在 `inbox.nextTurn`（`host.ts:131`）且不产生事件，与真 DSH 正好相反；③ `agent/status` 从不由桩发出（本轮核对：`src/app/runtime.ts:831` 订阅它，`host.ts` 里零处产生），所以"DSH 先发 idle 后让 turn/end 可见"这个顺序无法表达；④ `tools.get()` 永远返回 `{}`（`host.ts:160`），于是 `WORKER_TOOLS` 的预过滤在每个测试里都是死代码；⑤ 事件日志条目是 `{seq, type, data}`，**没有 `time`**，所以任何"多久没事件"的停滞探测在离线不可测——**而 `silentMs` 正是这样一个探测**（§6 第 3 行） | 部分实现 | 逐条让桩照真 DSH 的契约回答。`11` §6 开头的判词是对的："这个仓库反复遇到的失败模式不是测试不够多，而是**桩与真实契约分歧，于是套件绿着、生产错着**"——N1 就是这么活过 561 条测试的。**⑤ 是⑤条里最该先做的**，因为它挡住的是 §6 那条静默探测器 | `11` §6；`00` §6、§4.40；本轮核对 `host.ts` 五处 |
| `sessionProjections` / `sessionController.inspect` 在替身宿主里 | 桩现在有 `systemPrompt`（`host.ts:64`、`:142`，一个 no-op 的 `section()`）与 `sessionController` 的 `create`/`resolveAgent`/`rename`/`selectModel`（`host.ts:358`） | `sessionProjections` **在桩与 `src/` 里都是零命中**（本轮核对 `grep -rn projection tests/helpers/host.ts src/`），`sessionController.inspect` 也不在桩里。所以旧版那句"替身宿主里完全没有这个服务（也没有 `sessionController.inspect`、`systemPrompt`）"**有一处已过期**：`systemPrompt` 有了（虽然是 no-op） | 尚未实现 | 一次对 DSH 的只读清点，确认这两个服务是否存在、能给什么（与 §2 的 `sessionProjections` 行是同一件事，那里记的是它对预算的意义） | `11` §6 末段；`00` §6；本轮核对 `host.ts` |
| `WORKER_TOOLS` 是 20 个名字而线上观测到 19 个 | 本轮核对 `src/app/sessions.ts:34-38`：确实是 **20** 个名字（`read write edit read_image glob grep bash pwsh job_output job_list job_kill web_search web_fetch skill todo_write subagent list_subagent_models send_message list_agents interrupt_agent`） | 差额的解释。`01` §8 数出 19 个但**没有逐个列出**，所以最可能是 `pwsh`（macOS 上没有，`restrict` 会滤掉）这一点是 **未核实** | 部分实现 | 一次真宿主上把 worker 的工具清单逐个列出来与这 20 个名字对照。核实它需要跑一个 worker；本轮的 401 让"只读看一眼"也不可得 | `07` C107 / §9 第 14 条；`01` §8；本轮核对源码 |
| DSH 宿主本身被审计过 | `06` §2 把"worker 工具清单"与"单写者锁"归为**仅有的两处真边界**，而第一处的强度**完全依赖 DSH 的行为** | 一次审计。`06` §7 末段：「我**没有审计过 DSH 本身**，这是本清单最大的未验证假设」。**本轮没有任何进展**，而它现在压着更多东西：`06` §3.1 把 chat 的真边界定为"频道目录的写入权限"，那也是一个关于 DSH 与文件系统的前提 | 尚未实现 | 一次对 DSH 的只读审计：它如何强制工具清单、权限预设、Session 隔离。相关的一条：`00` §6 说"**没有任何东西验证 `myagent-worker` 预设真的存在**"——本轮核对 `cordis.patch.yml` 里确实声明了 `myagent-worker-preset`（`id: myagent-worker`），而**验证它在某个 profile 里真的被装上**仍然是零。如果这个前提有问题，`06` §2 的"真边界"分类要跟着改，即风险清单里最强的那两行是未经检验的 | `06` §7；`07` §10.2；`11` §7 第 9 条；本轮核对 `cordis.patch.yml` |
| 纪律里三条能被机器检查 | 0.1/0.2（产物新鲜度）已由 `tests/build.spec.ts` 与 `gate.sh` 强制；`gate.sh` 现在把计数行与结论都 `tee -a` 进日志（本轮核对末两段，与 `/tmp/myagent-gate.log` 的末两行吻合） | 0.3 证据先于修复、0.4 修一类先枚举、第 4 档的冻结与快照——**至今只能靠自觉** | 尚未实现 | 它们约束的是**动作顺序**而不是产物状态，所以难以变成断言。可行的形态是提交时的检查（例如要求修复的提交里同时含测试），但那需要一个版本控制载体——而项目目录还不是 git 仓库（§8 第 1 行） | `11` §7 第 13 条；`04` §0.1–0.4、§0.10、:265-268；本轮核对 `gate.sh` |
| S21：一次未能复现的偶发失败 | 已记录（`00` §7 S21 标题自己写着"未解决，已记录"）。**第 44 轮抓到的三处 flaky 已修**（`sources.spec.ts` 的三处墙钟竞态，`00` §4.45），所以 S21 是不是同一族**未核实** | 根因与修法，两者都没有。它从未被复现 | 尚未实现 | 复现它。核实需要什么：一个能稳定触发的种子，或在 CI 上反复跑同一套件直到它再次出现——在此之前无法判断该修什么。**第 44 轮那条给了一个可试的假设**：那次 flaky 的症状也是"跨越一个时间边界时才红"，而 S21 从未被复现过，正符合"要等一个稀有的时钟位置" | `00` §7 S21、§4.45 |
| 孤立的文档注释 | — | **本轮枚举出 26 处**，旧版记的是 3 处。判据是可复现的：一个文档注释块的结束行紧跟着另一个文档注释块的开始行（`a.endswith('*/') and b.startswith('/**')`），范围 `src/**/*.ts` + `tests/helpers/*.ts`——前一个注释描述的东西已经不在那个位置了 | 尚未实现 | 26 处删除（或移回它描述的那个声明上）。三处样本，本轮逐个读过：`registry.ts:69`"Stop every Source; their read positions stay stored." 挂在 `nudge()` 上；`runtime.ts:44`"How often the pump runs what is due" 挂在产物字节上限常量上；`engine.ts:574-577`"Record a worker's Report…" 挂在 `createProject` 上。**其余 23 处的行号见本轮脚本输出**（`delivery.ts:193`、`executor.ts:32`、`http.ts:81`、`runtime.ts:617`/`:742`、`sessions.ts:52`/`:104`/`:429`、`store.ts:154`、`engine.ts:876`/`:1121`、`model.ts:141`/`:234`/`:293`/`:317`/`:372`/`:409`、`policy.ts:334`/`:452`、`timing.ts:95`、`inbox.ts:70`、`host.ts:10`、`deployment.ts:22`）。`07` §9 第 16 条的理由值得抄在这里："它们会误导下一个维护者"，与 N7 同类（"注释错了比没有更坏"）。**按 `04` §0.10，这是一类债，不是三处** | `00` §4.26「仍未修」；`07` §9 第 16 条；`04` §0.4、§0.10；本轮脚本枚举 |
| `GET lost` 的"列出全部而不是最新窗口"这个性质由**承重**的断言守着 | 性质本身在，而且写法是对的：`http.ts:544-550` 的注释解释了为什么用 `list()` 而不是 `since()`（"`since` is a NEWEST window, so a producer broken on every firing pushes an older loss out of it while `countBySource` still counts it"）；测试 `tests/http.spec.ts:794-819` 造的正是那个场景（1 条最旧的 `lost` + 60 条更新的 `ignored`） | **测试强度**。第 46 轮的代理按 `04` §0.8 的强形式做了删检，发现删掉某条断言后**缺陷全活时测试仍绿**，正要去加强那条测试时死了（`00` §4.46 末段：「那条加强没有做」）。本轮核对那条测试仍在原样（4 条断言：`total`、`shown`、`rows` 的 id 列表、`counts.lost.rows`），**加强没有落地** | 部分实现 | 重做那次删检并落地加强：逐条删掉 4 条断言中的一条、把路由改成 `since('', limit)`、确认**至少有一条删除会让它变绿**，然后给那条性质补一个不能被环境帮上的守卫。`00` §4.45 的 M1 是范本："只有那两条是承重的守卫" | `00` §4.46 末段；`04` §0.8；本轮核对 `http.ts:542-578`、`tests/http.spec.ts:794-819` |
| 一个被丢掉的 **policy** 通知仍带着本来要说的话（有测试） | 缺陷已修：`runtime.ts:299-306` 把 `??`/`===` 的优先级写成了显式条件，并在注释里写明"`??` binds LOOSER than `===`"；**report 通知那一路经变异检验**（`17` §5.1、`00` §4.40 的 M2） | 一条测试。本轮核对 `tests/fault-injection.spec.ts:519-524` 的注释逐字记着为什么没有："reproducing a LOST POLICY notice in a deployment test needs one more fact I did not establish — **how `saveSettings`' policy effects reach `delivery.policyChanged` under the stub**, since `exhaust(runtime,'notify')` after a `allowedSenders` change produced no `notice_lost` event at all"。**这不是旋钮的问题**：`StubOptions.notify` 第 41 轮就有了（`17` §1；它不在 §9 第 7 行那五条分歧里，是那一轮新加的能力），缺的是"让一个 policy 通知被产生出来"这条路在桩里走不通 | 尚未实现 | 先查清 `saveSettings` → `policyEffects` → `engine.policyChanged` → `delivery.policyChanged` → `enqueue('notify', key('notify', id,'policy',…))`（`delivery.ts:396`）这条链在桩环境下断在哪一环，再写那条测试。**注意 §6 第 2 行是同一条链的另一半**：`watchdog`/`executor` 的改动不产生 policy effect（`14` §2.2 B-1 实测 `policyVersion` 一字未动），而 `allowedSenders` 是**在** `authorizationShape` 里的，所以它应当产生 effect——两者的差别正好是查这条链的线索 | `00` §4.40（缺陷与撤下测试的决定）、§4.39（更早那条已还清的欠账）；`17` §5.1；本轮核对 `fault-injection.spec.ts:519-524`、`delivery.ts:396` |
| `input_missing` 有一个抛出点 | 声明在 `src/core/errors.ts:12`（`'No such input on this Ticket'`） | 零抛出点、零测试。本轮核对 `grep -rn input_missing src/ tests/` → **只有 `errors.ts:12` 那一处命中** | 尚未实现 | 要么在 `answer`/`note` 的路径上真的用它（当请求点名的 input 不存在时），要么从 `errors.ts` 删掉。第 31 轮已经用它做过一次对照：同一轮修的 `decision_missing`（`errors.ts:23`）有抛出点（`engine.ts` 的 `dismiss`），而 `input_missing` 没有 | `00` §4.26、§4.28「仍未做的文档更正」；本轮核对 grep |

---

## 10. 安全

`06` 把每一处守卫分成三类：**真边界**（OS / 文件系统 / DSH 强制）、**逻辑守卫**（myagent 自己的代码，
与被守卫的东西在同一个信任域里）、**提示词约束**（只是告诉模型该怎么做，**不是控制**）。
分类的结果是**只有两处是真边界**：worker 的工具清单与单写者锁——而这两处的强度都依赖 DSH 的行为，
DSH 从未被审计（§9 第 10 行）。本节列的是明确不提供的东西与 `06` §6 的待办。
**一条跨节引用**：产物通道的最低检查在 **§3 第 2 行**（它是 P5 的活，但它的理由是安全的：
`06` §6 把"产物内容的最低检查"单列为一条"中"，因为那是 worker→worker 的注入通道）。

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| worker 的沙箱（一个**真的**边界） | `WORKER_PERMISSION = 'danger-full-access'`（本轮核对 `src/app/sessions.ts:27`），这是刻意的设计（注释：无人值守的 worker 必须能在没人可问时工作）。Ticket 的 `scope` 是**提示词约束，不是控制**；`myagent_report` 的 schema 也不检查文件是否真的在目录内 | 边界本身。worker 可以用 shell 做运行它的那个用户能做的一切：读写任意路径、联网、装东西、改 crontab、读 `~/.ssh`、写 `~/.dsh/profiles/*/cordis.patch.yml`（即改自己的预设） | 尚未实现 | **部署层**的活，不是 myagent 代码里加个检查：一个受限用户 / 一个容器 / 一个只读挂载 + 可写工作区。`06` §1 的判词要一起抄："这不是缺陷清单里可以修掉的一行，而是这个系统的信任模型"；在它之下所有路径守卫（含 `files.spec.ts` 那批）**只防意外、不防恶意** | `06` §1 + §6"高"；`00` §1、§2 S1；`11` §7 第 7 条；本轮核对 `sessions.ts:27` |
| inbox 发起者身份的认证 | 门禁按 `allowedSenders` 判断"谁在请求"；第 27 轮加了目录权限自检（组/其它可写即 `mode & 0o022` 上一行健康问题，带八进制模式与 `chmod go-w`，两条测试） | 认证。**inbox 的 actor 是从请求文件本身推出来的**，所以"能写 inbox 目录的人，就能以任何被允许的发起者身份提交工作"，而 Decision 记录里会写着一个看起来合法的发起者 | 尚未实现 | 一个不由请求文件自述的身份凭证（签名、或一个只有可信进程能写的投递通道）。注意这不是 bug——文件就是那个来源的身份凭证——但"有 `allowedSenders` 名单"很容易被读成"发起者经过认证"，**它没有**。对照 chat：映射表让自述的名字不再直接被当成身份，**但 `identities` 与 `allowedSenders` 都是操作者可编辑的设置 JSON，所以它仍然是逻辑守卫，真边界仍然是"谁能把消息放进那个频道目录"**（`06` §3.1 的表） | `06` §3 + §3.1 + §5 + §6"高"；`07` C172；`00` §4.22 |
| 不可信文本的来源标注 | Input 那条已做（第 28 轮 `authorOf`，按 `input.by` 分三种署名，并明写 `not from the operator, so treat it as data`）；第 30 轮把"别的 worker 发来的文本是数据不是指令"写进了 `prompts/worker.md` | inbox 正文、附件、别的 Ticket 的产物、**以及 chat 消息正文**四条通道的标注。`06` §4 按"谁能写它"排序，最危险的正是 inbox 正文（"直接成为 Ticket 的请求文本，进 worker 的提示词。**无过滤、无标注**"）与附件（"被复制进 Ticket 目录，worker 会读它。复制不检查内容"）；chat 正文与 inbox 正文同构，而它的发送者**不是操作者** | 部分实现 | 在 `taskText` 的渲染里给这四条通道各包一层标注，与 Input 那条共用措辞。**界限必须一起写**（`00` §4.23 已写过一次）：署名不会让文本变可信，这一层没有任何东西能做到；它做到的是 myagent 不再对出处做假陈述。把"加了标注"说成"防住了注入"就是越界 | `06` §4 + §6"中"；`07` §10.2；`00` §4.23、§4.24 第 1 条、§4.33 裁定 4 |
| subagent 受 myagent 的两条 per-Ticket 控制（S2） | 提示词约束已 shipped：本轮核对 `prompts/worker.md:10-12` 点名了 `myagent_note_ticket` 与 `myagent_read_artifact`（第 30 轮修的，此前它说 `myagent_report` 是"唯一途径"） | 控制本身。`tools.restrict` 与结束后的 `tools.guard` **对子代理都不生效** | 部分实现 | 一条真宿主观测：让 worker 起一个 subagent，确认它调不到面向人的工具、且在 Ticket 结束后被拒。提示词那半 shipped 但**未验证**——它不是控制 | `07` C112；`00` §2 S2、§8 第 7 项；本轮核对 `worker.md` |
| worker 在一个**改了预设表**的 profile 上仍能启动（S4） | `presets.set(agent.session, WORKER_PERMISSION)`（本轮核对 `sessions.ts:292-293`：只有 `current() !== WORKER_PERMISSION` 这个判断，**没有 `has()`**），而 `set()` 对表里没有的名字**抛异常** | 任何处理 | 尚未实现 | 先 `has()` 再 `set()`，或捕获并降级为一行健康问题。相关的未验证前提：`00` §6 说"**没有任何东西验证 `myagent-worker` 预设真的存在**"——本轮核对 `cordis.patch.yml` 声明了它，而声明与"在跑的 profile 里装上了"是两件事 | `07` C111；`00` §2 S4；本轮核对 `sessions.ts:292-293` |
| `promptMaxChars` 真的被强制（S16） | 保存时确实有一个上限（本轮核对 `src/app/prompts.ts:19` 的 `PROMPT_MAX_CHARS = 100_000` 与 `:96-97` 的拒绝） | 对**设置里**那个 `promptMaxChars` 的强制。它是 `src/deployment.ts:34` 的一个旋钮（`min(1_000).max(1_000_000).default(100_000)`），本轮核对它在 `src/` 里只有三处出现：`runtime.ts:253`（写进 marker 文件）、`http.ts:321` 与 `:586`（返回给面板显示）。**即：把它设成 5,000 不会让任何东西在 5,000 处截断** | 部分实现 | 二选一：让 `prompts.ts` 读那个旋钮而不是读常量，或从设置里删掉它。`00` §8 第 6 项给的就是这两个选项 | `07` C156；`00` §2 S16、§8 第 6 项；本轮核对四处出现 |
| 审计日志的防篡改 | 事件日志与 Decision 记录都在同一个 sqlite 里 | 哈希链或只追加的签名 | 尚未实现 | `06` §6 把它排在"低"，理由要一起写："威胁模型里'能改 sqlite 的人'本来就已经赢了（§1），所以这条只防误改与事后抵赖"。即：**先做本节第 1 行，这条才有意义** | `06` §5 + §6"低" |
| 网络出口控制 | — | 任何控制。worker 能不能联网取决于宿主与机器，不取决于 myagent；DSH 的 `tool-web` 没有 allowlist，`bash` 不受限 | 尚未实现 | 部署层（出口代理 / 防火墙规则）。`06` §5 明说它属于"明确不提供的东西" | `06` §5；`00` §1 表 |
| 多租户隔离 | Project / Work 限制的是产物读取与协作通道的**可达性**（`engine.ts:411`、`:940` 两处 Work 边界） | 隔离。`06` §5 的原话："一个部署 = 一个操作者 = 一套授权。Project/Work 是**分组**，不是隔离边界（它们限制的是产物读取与协作通道的可达性，不限制 shell）" | 尚未实现 | 这不是一个待办而是一个范围声明：要多租户就得要多个部署（多个 stateDir + 多个锁）。把它写在这里是为了防止有人假设 Project 是隔离边界 | `06` §5；`00` §4.22；本轮核对 `engine.ts` |
| 对 worker 输出的内容检查 | `myagent_report` 校验 schema 与路径形状 | 内容真假 | 尚未实现 | 同上，这是一条范围声明而不是待办：`06` §5 明说"不校验内容真假" | `06` §5 |
| 外部业务副作用的幂等 | — | 任何机制。worker 发出去的邮件 / 提交的 PR / 调用的 API 在重试时会重复。**chat 的回复是这一类里唯一有幂等键的**：`sendKey` 是 `(ticketId, replyTo.kind, channel, thread, text)` 的纯函数、**无时间戳**（`delivery.ts:100`），所以同一句话不会被发两次 | 尚未实现 | 一个副作用登记表 + 幂等键；`00` §3.5 是它的设计出处。`sendKey` 是现成的范本，而它之所以能是纯函数，是因为回复的内容与地址都在 Ticket 上——外部副作用通常没有这个性质 | `00` §1 表（`外部业务副作用幂等`＝`absent`）、§3.5；本轮核对 `delivery.ts:100` |

---

## 11. 统计与最该先做的三件

### 11.1 计数

正文一共 **88 行**，每行恰好一个状态（计数由脚本对本文的表格逐行解析得出，不是估的；
解析要处理 `\|\|` 这种转义竖线，否则会漏掉 §6 的 N4 那一行）：

| 状态 | 行数 | 说明 |
| --- | --- | --- |
| 真宿主验证 | **0** | 这是本文的性质决定的：一份"未实现清单"里不该有已经验完的行。凡是被真宿主验过的能力都在 `07` 的 221 项里或本文**附录 A** 里 |
| 离线验证 | **9** | §4 两条、§5 两条、§6 五条：有测试、机制可达，但从未被真宿主驱动过 |
| 部分实现 | **25** | 其中 **3 行**缺的那一半按 `00` §4.25 命名为 **未接入**（§3 的 `Engine.artifactsOf` 三兄弟、§6 的 `failTicket`、§6 的 `armedInterval`）；**4 行**（§6 的 N1 剩余半、N9、N10，以及 §7 的真浏览器）缺的是"一次真宿主 / 真浏览器驱动"；其余是"一半已做、一半没做" |
| 仅有设计 | **10** | §1 占 4 行（D1/D3/D9/D10）、§2 占 2 行、§3 占 1 行、§4 占 1 行、§8 占 2 行 |
| 尚未实现 | **44** | 最大的一档，占一半。其中 §10 的 4 行是**范围声明**（`06` §5 的"明确不提供"与 `00` §1 的 `absent`），写下来是防止有人假设它们存在，不是等着做的待办 |

按节分布：§1 来源与扩展接口 = **9** 行、§2 P6 = 8、§3 P5 = 8、§4 P3 = 4、§5 P2 = 6、§6 P4 = **13**、
§7 面板与 HTTP 出口 = 9、§8 数据与迁移 = 4、§9 验证与工具链 = **16**、§10 安全 = **11**。

**与旧版（第 32 轮，88 行）的对照**——行数一样，内容变了大半，所以这三个数要一起读：

- 旧版 88 行里 **13 行已结案**，移入附录 A（§1 四行、§5 一行、§6 两行、§8 三行、§9 三行）；
  附录 A 一共 **31 条**，另外 18 条是旧版根本没有行的（P8 的七个阶段、`src/index.ts` 的导出、第四处 `enabled`、
  `reply_unroutable` 的措辞、散文依赖、S38、(v) 的四分之四、健康板自清、RESULT.md 的裁定、故障注入、三处 flaky、丢失请求的可见性）。
- 本版**新增 14 行**（第 33–47 轮暴露或落地后又留下缺口的）：§1 五行、§6 四行、§7 一行、§9 四行。
- 另有两组重复各合并成一行：旧版 §3 与 §4 都写了"请求对方做一件事"；"产物内容的最低检查"在本文草稿里
  曾同时出现在 §3 与 §10（现只在 §3，§10 的开头有一条跨节引用）。
- 所以 **88 = 73（旧版未结案的行，含行号与计数的更新）+ 14（新增）+ 1（从 §10 移到 §3）**。

被更新的计数（本轮逐个量过）：事件类型 17 → **20** 个成员、桩 `host.ts` 429 → **509** 行、
孤立文档注释 3 → **26** 处、临时目录"数百棵" → **53,609** 棵（2.74 GB）、面板测试 146 → **185** 条、
`WORKER_TOOLS` 仍是 **20** 个名字。**行数与旧版相同纯属巧合，不要把它读成"没有进展"。**

### 11.2 最该先做的三件

1. **一次隔离宿主的 Watchdog 复验**（§6 第 1、2、3、9 行）。三件只有真宿主能回答的事挤在同一次运行里：
   N1 剩下的那一半（**救援能不能救活一个真的死掉的 launch**——第 33 轮量到的是相反的一面：重新入队被在飞的那次吸收）、
   N2 的二次修复（第一次修复**曾被真宿主证伪**，而二次修复只有离线证据）、`silentMs` 探测器（从未驱动，
   而桩的事件条目没有 `time`，所以它在离线**根本不可测**，见 §9 第 7 行⑤）。
   **前置是 §6 第 9 行**：先给 `armedInterval` 一个 HTTP 出口，否则复验仍然要靠算网格残差来推断——
   那正是 `14` §2 花了一整节才做到的事。
2. **P6 的预算上限**（§2 第 1 行）。它是 `06` §5 那七条"明确不提供"里唯一一条**会让系统一直跑下去**的。
   三块拼图里两块已经在手上：真实 token 计量（`usageOf`，带 `windowed`）与一个写好却零调用者的 `failTicket`。
   缺的只是一个 `SettingsSchema.budget` 块、一个读 `usageOf` 的探测器、和一条超限处置的决定。
3. ~~**把日常宿主重载到 `768a6adb…`**~~ **【已作废，2026-11-11】**：日常宿主早已远超那个产物（当前挂载的 bundle 是重构后的 `7d49c052…` 一线），§0.1 那个"新页面 + 旧 API"的现场也已消失。下面这段保留只为记录当时的推理：——这是操作者的决定，不是代码活，但它挡着一切"线上核实"：
   第 33–46 轮的一切在线上都看不见，§7 与 §9 里三条"未核实"都只因为拿不到线上读数，
   而 `verify-live.sh` 现在连跑都跑不了（401）。**顺序很重要**：重载之前先看一眼面板（§0.1 末段那个
   稍纵即逝的机会——"新页面 + 旧 API"这个状态是面板降级路径唯一的自然现场，一旦重载就消失）。

## 12. W1–W39 重构留下的缺口（2026-11-11 新增）

本节是正文的**现行**部分，基线是重构之后的代码。格式沿用 §1–§10 的六格。
凡与 §1–§10 冲突的，以本节为准（顶部基线声明已说过一次，这里再说一次是因为它最容易被跳读）。

| 能力 | 现在有什么 | 缺什么 | 状态 | 接入它需要什么 | 出处 |
| --- | --- | --- | --- | --- | --- |
| **token 预算上限** | 真实 token 计量（`usageOf` + `windowed`）；**墙钟**上限已强制（W6：到点提醒 → 宽限 10 分钟 → 系统停下 → 停一条决断） | token 维度的上限与超限处置。计量只用于显示与报告 | **部分实现**（墙钟那半真宿主验证，token 那半尚未实现） | `SettingsSchema.budget` 块 + 一个读 `usageOf` 的探测器 + 一条超限处置的决定（`06` §5 那七条里唯一会让系统一直跑下去的） | §2 第 1 行；`09-architecture.md` §5.2 修正框 |
| **全局墙钟上限的活体取值** | 代码路径完整，对聊天/inbox 来的票也生效 | `watchdog.maxRuntimeMs` 活体仍是 **0（不限）**。设多少会停掉操作者的活（侦察实测 33 分钟、VM spike 更长），这是取舍不是实现 | **部分实现**（未接入：值没设） | 操作者定一个数。建议 120 分钟。决断队列里有一条在等 | 活体 `GET state` 实测；`00-audit-and-plan.md` §4.166 |
| **W21 出口收归总管** | worker 的 `blocked`/`waiting` 同时发给总管**和**请求者 | "总管先看一眼、再决定要不要打扰操作者"。现在是两条腿并行，总管那一腿只是知情 | **尚未实现** | 第一次尝试是给消息文本加署名前缀，**打红 22 个测试文件**后回退。正确做法是用独立元数据字段（不改文本），要与路由改造一起做 | `00-audit-and-plan.md` §4.166/§4.168 |
| **W25 超时署名兜底** | 无 | 总管 N 分钟不响应时，把 worker 原话加署名直发请求者 | **尚未实现** | 同上（与 W21 是同一个改动面，不该分两次做） | 同上 |
| **W32 总管只读工具面** | `prompts/triage.md` 明写"不要自己干重活"；分诊票不占 worker 槽；W6 墙钟预算对分诊票同样生效 | **工具面级的强制**做不到：`desk:'main'` 时评估发生在操作者自己的主会话里，收窄它的工具就是收窄操作者日常在用的会话；宿主没有"按轮次限定工具面"的机制 | **有意不做**（这是裁定，不是遗漏） | 若将来要做，代价是放弃 `desk:'main'` 的记忆优势（改回 `dedicated` 才能给它受限预设）。当前裁定：取记忆，用预算兜"可重不可长" | `00-audit-and-plan.md` §4.166 |
| **`ask_desk` 的端到端活体验证** | 工具已注册、`ToolsHost.askDesk` 已实现（`relay` 进主会话，非阻塞）、单测里桩已补齐 | 活体上跑通一次"worker 问 → 总管答 → worker 收到 note 继续"的完整回路 | **离线验证**（无活体证据） | 一张会主动提问的票。注意它依赖总管的工具桥可用（见下一行） | `src/app/tools.ts`、`src/app/runtime.ts` 的 `askDesk` |
| **总管工具桥在 PTC 模式下的可用性** | DSH 宿主重启后已恢复（活体实测：inbox 票 `e7a48b11` 的 worker 正常调 `myagent_list_tickets` 并 `ready` 收尾） | **根因未定位**。故障期报错逐字为 `tool "myagent_create_ticket" parameters must be lossless JSON before schema projection`；主会话跑 PTC 模式，`run_code` 渲染 SDK 段时对**全部**工具定义做投影，一个定义抛错就让整面工具失效（连原生 `bash` 都用不了） | **部分实现**（现象已消失，根因未明） | 本地**无法复现**：17 个工具的 `parameters` 全部是合法 JSON（5 个键，无 undefined/symbol/环/NaN/-0），`projectToolSchema` 也未从已安装的包里导出。**注意一个假信号**：曾经"复现成功"过一次，实际报的是 import 不是函数——那类假复现必须当场识破 | `00-audit-and-plan.md` §4.167；`tests/tool-schema-json.spec.ts`（扫全部定义的无损 JSON + 钉住工具清单） |
| **W38 退役 `followupTicket → Work` 自动归组** | `findContinuationTarget` 已退役为引导器（只在显式 `reply-to-ticket` 与 DM→群首条时命中） | 引擎里 `meta.followupTicket` → `workNamedOrCreate` 的**自动归组**仍在（`engine.ts` 受理分支内） | **部分实现**（三个替身退役了两个） | 需要先确认 Thread/Subscription 是否完全覆盖了"同一条对话线"的归组语义；自动归组目前仍是有用的兜底 | `00-audit-and-plan.md` §4.168；W38 提交说明 |

---

## 附录 A · 已结案的条目（按结案的轮次）

本文旧版（第 32 轮）里那些行、以及第 33–47 轮新结案的条目，都在这里。**正文里没有它们**：
一个人想知道"现在缺什么"不该被迫读过一遍历史。每条给出结案的轮次、证据落点、以及**残留**（若有，指向正文行）。

| 轮次 | 结案的条目 | 证据 / 落点 | 残留 |
| --- | --- | --- | --- |
| 第 2 轮 | **S7：`Memory` 与 `Store` 的事务语义分歧**（回调抛错时 Memory 回滚而 Store 已提交；depth 变负后 Memory 不再快照且 `afterCommit` 内联；嵌套错误被外层吞掉时 Memory 不回滚） | `00` §4.5：`Memory.atomic` 重写为与 `Store.atomic` 结构同构，新增 `tests/transaction.spec.ts`——**同一组契约断言对两个实现各跑一遍**，经变异检验（把 Memory 改回"只在 depth 0 快照"，嵌套回滚那条立刻变红而 Store 那组仍绿）。本轮核对：`memory.ts:133-171` 的两处注释逐字承认了旧行为（"which is what this class used to do"），契约测试今有 **7 条 ×2 = 14 条** | `triggers.list()` 的排序仍不一致（§8 第 2 行）——`transaction.spec.ts:28-33` 把它明确排除在契约外 |
| 第 9–10 轮 | **"部分成功"的释放策略**（旧版记为"语义本身没有给出"） | `released()` 的语义写在 `model.ts:142-147`（`ended` 接受任何结束、`done` 只等成功），`00` §4.8 记了它当时就有测试；第 10 轮的级联取消补上了另一半：`failed`/`dropped` 沿 `on:'done'` 的边级联结束下游（`engine.ts:1069-1085`），`stopped` **刻意不级联**（"停止是一个人的显式动作"）。本轮核对 `tests/dependencies.spec.ts:53` 钉的正是这个分野 | 被级联结束的 Ticket 不进 attention（§5 第 5 行） |
| 第 22 轮 | **规则来源的 `then.workId` 写入路径**（旧版记为"尚未实现"） | `00` §4.17："这条链现在闭合了：规则的 `then.workId` → Trigger 的 `meta.work` → 受理时归类"，两半各有测试。本轮核对三处都在：`policy.ts:141`（schema）、`rule.ts:96`（写进 `meta.work`）、`engine.ts:292-299`（受理时归类，指向不存在的 Work 会记一条 `classified` 带 `missing:true`） | `Schedule` 那一半仍没有（§6 第 12 行） |
| 第 31 轮 | **`00` §4.7 那份"从不写入的事件类型"清单两头都错** | 已就地更正（本轮核对 §4.7 原文带删除线与【第 31 轮核实】标记）：`dismissed` **根本没有被声明**，`delivered` 声明了却从不写入而被漏掉；真实集合是 `delivered`/`delivery_failed`/`session_bound` | 那三个类型的写入点仍然没有（§8 第 3 行） |
| 第 31 轮 | **`dismiss` 用错错误码**（`07` §10.2 记它对不存在的 Decision 抛 `trigger_missing`） | `errors.ts:23` 有 `decision_missing`，`dismiss` 抛的正是它 | `input_missing` 仍零抛出点、零测试（§9 末行） |
| 第 32 轮 | **`gate.sh` 的结论与计数行不落盘**（旧版记为"结论只 echo 到 stdout、不进 `$log`"，并因此把"退出码 0"标为未核实） | 本轮核对 `scripts/gate.sh:80`（计数行）、`:84`（"结论：通过"）、`:87`（"结论：未通过"）**三处都是 `tee -a "$log"`**，而 `:84` 只在 `${#failures[@]} -eq 0` 分支里、紧跟 `exit 0` 之前执行。`00` §4.47 的裁定："**'结论：通过'这一行出现在日志里，就证明退出码是 0**"，并点名"文档里那句'计数行不落盘'的陈述已经过时" | — |
| 第 33 轮 | **N3：救援后 `workerSlots.used` 少计** | **真宿主验证 通过**（`14` 场景 1：`sleep 90` 存活的 **22/22** 个采样点 `used=1`、违规 **0**；而且全程只有一个 sleep 进程，证实重新入队会被在飞的那次吸收） | — |
| 第 33 轮 | **N1 的升级那半：`maxActions` 之后"需要人"可达，且那一刻槽位仍计 1** | **真宿主验证 通过**（`14` 场景 3：(a) 2 条 `rescued` 均 `by={system,watchdog}`；(b) `04:34:25.830Z` 转 not ok，detail 逐字 `Ticket a688c9df has not started after 2 attempts to rescue it; it needs a person`；(c) 同刻 `used=1`，并又保持 57.6s） | "救援重新启动一个真死掉的 launch"这半仍无证据（§6 第 1 行） |
| 第 33 轮 | **命题 B：宿主停止后没有任何东西再写**（旧版记为"部分实现，缺 T0+60s 采样"） | **真宿主验证 通过**（`14` 场景 4：SIGTERM 后 **20.4s** 与 **80.9s** 两次采样，sha256 `494b4a14…`/size `94208`/mtime `1793768020` 三项逐字不变，`-wal`/`-shm`/`.lock` 均未重现，`lsof` 对端口与文件都为空；优雅退出把 WAL checkpoint 进主库 4096→94208 并删掉锁）。第 38 轮又测了一次（`16` 场景 4：两个样本相隔 62s，`ls/shasum/stat` diff 为空） | 口径要一起读：证明的是"**停机后不再写**"。`02b` §3 划的那条界在 S32 的语义上仍成立（"没有证明那个定时器没有触发过"），而 S32 的 40 个未处理错误第 20 轮已归零 |
| 第 33 轮 | **README 的 SQLite 表清单**（写的 6 张里含早在迁移第 2 步就删掉的 `settings`） | 本轮核对 `README.md:218`：已改成 **11 张**并逐个列出；同一轮还补了 `src/app/` 漏的 `watchdog.ts` 与 `docs/v2/` 的入口 | 另外三处漂移（§7 第 7 行）：面板行漏「工作」tab、`src/sources/` 行漏 `chat.ts`、文档计数停在"十五份约 6100 行" |
| 第 34 轮 | **N8：「需要人」这次升级不留任何持久痕迹**（`14` §7 第 1 条实测：事件日志是 `created→rescued→rescued→launched→report`，那条 `health.problem` 既不是事件也不在 kv） | 新事件类型 `escalated` + `WatchdogHost.escalate` + `Engine.watchdogEscalated`（`engine.ts:960`），**两处升级点都写**；同一句话去日志与健康板时**在源码里是一个字符串变量**，所以两个去处不可能漂移，而健康板措辞逐字未变（验收报告引用过它）。2 条测试，经变异检验。`escalated` **刻意不计入** `actionsTaken` | N9/N10 因此从"事实丢失"降为显示层瑕疵（§6 第 6、7 行）；N11 仍是真缺陷（§6 第 8 行） |
| 第 35 轮 | **P8 的契约层（A+B）**：`chat` 进 `SourceKindName` 与 `MandateVia`、`ReplyTo`、`Trigger.replyTo?`、`Delivery.send?`、`TwoWaySource.deliver`、`sources.chat` 设置块、`identities` 与 `enabled` 进 `authorizationShape.perSource`、错误码 `reply_unroutable` | `15` §2–§5、`00` §4.32；634 → 657 条测试，6 条变异检验。按 §4.25 它当时被如实标为 **部分实现（未接入）**，而"未接入"在产物哈希上可见（`chat.ts` 零生产导入者 ⇒ 根本没进 bundle ⇒ 哈希不变） | — |
| 第 35 轮 | **`src/index.ts` 不导出 `./sources/kind.ts`**，所以 `Source`/`SourceKind`/`SourceHost`/`TwoWaySource` 不在 `lib/index.d.ts` 里、`import type { TwoWaySource } from 'myagent'` 无法解析（接口存在于源码树、却不存在于发布的类型里） | 已加导出，并**在产物里核实**（`lib/index.d.ts` 中 `TwoWaySource` 出现 2 次） | — |
| 第 35 轮 | **第四处 `enabled` 缺口**：`cron`/`inbox`/`session` 各自硬编码了 `enabled`，后加入的 kind 只出现在派生的 `perSource` 里而那里不带 `enabled`，于是**停用 `rule`（以及 `chat`）不会移动 `policyVersion`**，而紧挨着的注释声称每个被停用的来源都覆盖了 | 修法是把 `enabled` 放进**派生的** `perSource`（`policy.ts:282`），一次修好两个 kind 并让下一个 kind 天然正确；`it.each` 覆盖五个 kind，经变异检验。注释里留下了那句规律："**一份 kind 的清单，就是一份'会被忘掉的东西'的清单**" | — |
| 第 36 轮 | **P8 的 C1 + C2**：聊天 Source 本体与它的接线 | `00` §4.33–§4.34：`src/sources/chat.ts`（未映射**留住不消耗**、Trigger id 是消息 id 的纯函数、`deliver` 写 `<channel>/out/reply-<hash>.md`）；`chatKind` 进 `runtime.ts` 的 kinds、`OutcomeDelivery.send` 按 `replyTo.kind` 分发并以 `typeof deliver === 'function'` 收窄、`send` 走效果队列且 key 是 `(ticketId, 地址, 文本)` 的纯函数（**无时间戳**）、彻底放弃留**两处**持久痕迹（`reply_lost` 事件 + `REPLY-UNDELIVERED.md`，欠的那句话逐字保留）。+14 与 +12 条测试，8 条经变异检验。产物从 `4a6bb032…`/276275 变成 `8ca08244…`/298499（**+22224 字节**），五个标记都能在 bundle 里 grep 到 | — |
| 第 36 轮 | **`reply_unroutable` 的措辞与实际抛出点不符**（原文说"没有那个种类的 Source 在运行"，而实际是"Source 在运行、频道已消失或被停用"） | 改了措辞，并新增 `reply_unreceivable`（措辞正是原来那句）：**两个码各一个抛出点、各一句准确的话** | — |
| 第 37 轮 | **P8 的 D**：面板聊天区块 + `delivery.sends()` 的 HTTP 出口 | `00` §4.36：`counts.sends` 挂在 `GET state`、`GET tickets/:id` 加 `replyTo`；面板「来源」页新增聊天一节（未映射等待队列 **7 种状态、前 5 种刻意不许读起来像"空"**、每个 id 的「映射它」、频道表、身份映射表可增删改、回复计数并解释 `nowhere`）、页头 `#chat-waiting` 药丸（0 时隐藏）。+32 条测试（http +6、panel +26），5 条变异检验 | `sends()` 的持久化（§1 第 7 行）、`channels`/`allowedSenders` 的编辑（§1 第 8 行）、`sourceStatus()` 覆盖 `counts`（§1 第 6 行） |
| 第 37 轮 | **一处"散文依赖"**：等待队列的平台 id 只存在于那句英文健康文本里，`http.ts` 用正则解析它——**改一句话就能静默清空面板上的等待队列，而消息还在磁盘上**（最坏的失效形状：看起来像问题自己消失了） | `ChatSource.waiting()` 返回 `{count, ids, more}`，**与健康句在同一处、由同一组值组成**（不可能漂移）；`http.ts` 优先用它，正则退为兜底。经变异检验：让 `waiting()` 永远返回空 → 2 条变红 | — |
| 第 38 轮 | **P8 的 E：聊天闭环真宿主验收**——**P8 结案** | **真宿主验证 通过**（`16`，53 份证据在 `/tmp/myagent-acc-chat/`，产物起点=终点=`b955704fcc677aff…`/303956 字节）：Trigger id 与投料前本地复算的 `key('chat','room-a','msg-acc-001')` 逐字符相同；`sender={id:"acc-alice",kind:"person"}` 而**不是**平台 id `U01ACC01`；`via:"chat"`；归档名是纯函数、无时间戳；**worker 真跑到模型**（`state:"ready"`、`usage` total **37755**）；回复文件 `room-a/out/reply-40f114496924e6c7a442ba5998bfb28e.md`（253B）正文即报告摘要原文；`counts.sends` `{0,0}→{1,0}`；文件落盘到 `created` 仅 **0.77s**。未映射路径：留住 8s（六项计数逐位相同、文件 308B 且 **mtime 未变**）、`chat.waiting={count:1,ids:["U09UNMAPPED"]}`；补映射后**恰好受理一次**（`at` 仍是文件 mtime 而不是受理时刻）、再等 43s **无第二份归档** | `counts.sends` 与聊天一节今天都不在日常宿主上（§0.1） |
| 第 38 轮 | **`counts.sends.nowhere` 的可观测性**（契约 §3.3 那条"什么都不做也要可观测"） | 顺带实测：一张**无 `replyTo`** 的 inbox Ticket 结束后 `nowhere` 由 0 → 1；`replyTo` 在 inbox Ticket 的响应里出现 **0 次**（键不存在，不是 null），chat Ticket 则 `has("replyTo")=true` | — |
| 第 39 轮 | **S38：`health.executor` 会说假话**（同一份快照里 `counts.workerSlots={used:0,max:2}` 而 `health.executor.detail` 仍是 4 分钟前的 `"1 of 2 worker slots in use"`） | **修法是删掉那个数字**，不是让它更新。决定性证据：`grep -rn "worker slots in use" tests/ panel/index.html` → **零命中**（只写不读），而 `counts.workerSlots` 本来就是活的、面板本来就在显示它。新语义：健康跑的时候 `health.executor` **这个条目根本不存在**。经变异检验（把 gauge 加回去 → 新测试变红）；产物比修复前**小 96 字节**。留下的那句判词："**一个数字如果会过期，就不该被存在一个不会过期的数字旁边**" | 第一次尝试（"每轮 pass 一个 `complained` 标志"）是错的，被两条既存测试告发（`expected '' to contain 'Prepare failed'`）——那正是 §4.43 那次修复要解决的问题 |
| 第 40 轮 | **(v) 的 `notify` 一半：`notice_lost`** | 新事件类型 + `Engine.noticeLost(ticketId, detail)`，detail 带通知种类、状态、错误原文与**本来要说的那句话（截到 400 字）**；写日志那一步在自己的 try/catch 里（Ticket 可能已经不在了，而丢掉"丢通知"的痕迹不该连这一轮 pass 一起丢掉）。2 条测试，经变异检验 | 那条 policy 通知的测试欠账（§9 第 15 行） |
| 第 40 轮 | **`runtime.ts` 的 `??`/`===` 运算符优先级 bug**（第 40 轮自己写的、而且它通过了闸门）：`...(notice.summary ?? notice.detail === undefined ? {text:…} : {})` 解析成 `summary ?? (detail === undefined)`，于是一个被丢掉的 **policy** 通知没有 `text`——**违背了 §4.39 自己承诺的那件事** | 已修为显式条件，并把"`??` 比 `===` 松"写进注释（本轮核对 `runtime.ts:299-306`）。**为什么没有测试抓住它**：唯一被覆盖的情形（report 通知）里，这个偶然与意图恰好一致。留下的规律："当一个 bug 只在未被覆盖的分支里显形时，覆盖率不是'够不够'的问题，而是'覆盖的是不是同一个分支'的问题" | 同上（§9 第 15 行） |
| 第 41 轮 | **故障注入基础设施（P9 第一块）**：`StubOptions.notify = {fails, error?}` + `host.refusals` | `17` §1：注入点是桩 agent 的 `inject`/`followup`——**`src/` 里仅有的两个调用点**，所以处理器失败的位置与 DSH 会让它失败的位置相同，而队列真实的 5 次重试 / 15s-30s-60s 退避 / 放弃路径原样跑过。`fails` 是**预算**且**必填**（漏写不会被静默当成"永远失败"）。6 条新测试；产物哈希与基线**逐字相同**，这本身就是 `src/` 未变的证明。它顺带把 `launch` **从队列一路到放弃**的那段第一次覆盖上（此前只到第一次失败） | 桩仍然无法让 `trigger` 处理器因 I/O 失败（`receive` 在 core 里不做任何宿主 I/O），这是**已写进文档的桩边界**，不是被绕过 |
| 第 41 轮 | **`00` §4.39 记的那条覆盖欠账**（`onPermanentFailure → noticeLost` 这段接线本身没有测试，因为桩里没有"让 notify 连续失败到彻底放弃"的旋钮） | **已还**：本轮核对 `tests/fault-injection.spec.ts:93`（`records notice_lost on the Ticket with the words that were owed, and the event outlives the health line the next pass clears`）与 `:147`（`keeps notice_lost across a restart…`）两条从队列一路走到 `notice_lost` | **另一条同名的欠账还在**，而且缺的不是旋钮：一个被丢掉的 **policy** 通知（§9 第 15 行） |
| 第 43 轮 | **`effects` 与 `delivery` 两个健康条目永远回不到 ok**（`record()` 是唯一能清掉问题的东西，而它从不在这两个条目上被调；实测一次 notify 失败两次、第三次成功之后板子**仍然**说 `notify failed 2 of 5 times`，`refresh()` 在进程的余生里都报 "1 problem(s)"） | `effects.ts:56` 的 `no effect failed in this pass` + `delivery.ts:270` 的 `the last delivery went through`。补的那个守卫是承重的：`summarize()` 在它抱怨过的任何一行**仍然 pending** 时也提前返回（否则一次失败把行推迟到 15s 退避之后、下一轮 pass 什么都 claim 不到，就会**把一个永久的假警报换成一个假的"一切正常"**）——M1 变异让 **5 条**既存测试变红。`delivery` 没有自己的 pass，实现者**没有替它发明一个**（那会在一个什么都没投递的 pass 里擦掉 `Could not write RESULT.md`），而是把边界定为"一次投递" | `Could not write RESULT.md` 现在会被下一次成功投递擦掉——**第 44 轮裁定这不需要持久记录**（见下一条） |
| 第 44 轮 | **一条裁定：RESULT.md 写入失败不需要持久记录** | `00` §4.44，理由是取证来的：`delivery.ts` 的头注释自己写着 RESULT.md 是"so the answer outlives the process… and a person who never opened the panel can still read it"，而 Ticket 的结束**同时也在库里**（`assignments[].report`、`ended`、事件日志），所以它是**给人看的便利副本**，写入失败不丢失任何信息，丢失的只是读到它的一种方式。**给一个副本的写入失败建立持久记录，会暗示一次并不存在的信息丢失**。**推翻它的条件也写下来了**：如果 RESULT.md 里出现过库里没有的内容，裁定立刻反转 | 一般判据留在 `00` §4.44 末段："一条健康行该不该有持久副本，取决于它所说的内容在别处是否已经有权威记录" |
| 第 44 轮 | **(v) 的 `trigger` 一半——至此四种效果都有了执行与失败记录，这是项目硬规则里最后一条没兑现的** | `launch`/`input` 写 Ticket 上的失败报告、`send` 写 `reply_lost` + `REPLY-UNDELIVERED.md`、`notify` 写 `notice_lost`、**`trigger` 写 `triggers` 表的 `lost` 行**（`store.ts:349-353`，`record` 存 payload 原文）或退化路径的**有界** kv 条目（`pushLostPayload`）。两个决定都有理由：`lost` **不带** `decisionId`（门禁从未运行、没有 Decision 可指，而 `pending` 有不带的先例）；退化路径**不写 `triggers` 表**（`countBySource` 按 `source` 分组并当作进气计数显示，插一行 `source:'lost'` 会让面板出现一个叫 "lost" 的来源——**那是一句关于来源的假话**）。`SCHEMA_VERSION` 仍是 5，**没有引入迁移** | 三处 Source catch-all（§1 第 9 行）；`lost` 行的可见性当时还没有（下一条） |
| 第 44 轮 | **`receive` 把一个已存的 `lost` 行当作 `{stored:'duplicate'}` 返回**——即"这个请求已经处理过了"，**与事实完全相反** | 修法是 **`lost` 行不算重复**：门禁重新跑一次、`save` 用它挣来的处置替换掉它。安全性有依据：`lost` 行只可能出现在 `receive` 于它那**一个** `tx.atomic` 内部抛出之后，什么都没提交，所以不存在重复的风险。两层都钉了测试（engine + 端到端）。本轮核对 `engine.ts:256-266` 的注释逐字点名了那三处 catch-all | 三处 catch-all 本身仍在（§1 第 9 行） |
| 第 44 轮 | **三处 flaky 断言**（既存缺陷，与那一轮工作无关）：`tests/sources.spec.ts` 的三处 `toBeGreaterThan(Date.now())` 依赖墙钟位置，跨分钟边界就红（实测两个值相差 207ms、都落在同一个整分钟边界上） | 三处一起修：把读时钟移到各测试体开头（`clockBefore`，本轮核对 6 处命中），断言改为与它比较；**性质没有削弱**（要钉的是"游标越过了它刚触发的那个槽位"，与"这条断言花了多久才执行到"无关）。`00` §4.45 的判词："**一条会随机变红的测试，会让人学会忽略红色**——那正是 0.1 要防的事" | S21 那次从未复现的偶发失败**是不是同一族，未核实**（§9 第 12 行） |
| 第 45–46 轮 | **丢失请求的可见性**（第 44 轮留下的"记录存在了，但操作者看不见它"） | `00` §4.46，**在代码与 bundle 里都核过**：`http.ts:542` 一条**独立的** `GET lost` 路由（`rows` 来自 `triggers` 里 `disposition.state==='lost'` 的行、`payloads` 来自 `store.lostPayloads()`）；`counts.lost` 的 `{rows,payloads}` 挂进 `GET state`；面板 `#lost-count` 页头药丸（**bundle 答不出来时隐藏**，因为"这个 bundle 答不了"不等于"没有丢失"）+「丢失的请求」区块 + **两条路径分开呈现**；补救说明是诚实的（明写"**系统不会自动重放它们**"、`lost` 行不算重复、**没有给一个不可能成功的按钮**）；`triggers:lost` 在 `lib/index.js` 里出现 2 次。+20 条测试（http +7、panel +13） | ① 那条测试强度欠账（§9 第 14 行）；② 重放入口（§7 第 9 行）；③ 这一整套今天**不在日常宿主上**（§0.1：`GET /api/lost` 实测 404） |

| **0.12–0.14** | **D11：聊天 Source 回不了话**（旧版记为"未落地：`Delivery` 端口没有 `send`"） | `Delivery.send` + `effects.enqueue('send', …)` 已落地，五座桥各一个（Telegram、飞书、QQ、钉钉、企业微信，`bridges/`）。回程地址只从 Trigger 的 `replyTo` 读、**绝不**从 actor 推（contract §3.3）；无地址的报告计入 `counts.sends.nowhere` 而不是静默丢弃 | QQ 只能发文本，发不了文件（W5 已写进 worker 提示词，让它别再干等）；`09-architecture.md` §6 的 D11 行已同步更正 |
| **W6** | **"没有任何上限，也没有任何超限处置"**（旧 §5.2 原文）——**墙钟那一半已结案** | `enforceRuntimeBudgets` 取"排期的 `meta.runtimeBudgetMs`，否则 `watchdog.maxRuntimeMs`"，到点发收尾提醒（`note`），再过 10 分钟仍未结束就 `assignmentInterrupted(...,'budget')` 并在决断队列停一条。计的是这张 Ticket 的墙钟，**子代理与后台作业都在预算内**。活体证据（2026-11-11）：排期票 `233e7679` `01:00` 启动 → `02:00` 提醒 → `02:10` 系统停下，理由原文「超出时间预算：预算 60 分钟，宽限 10 分钟后仍在运行，已被系统停下」 | **token 维度仍无上限**（计量只用于显示，§12 第 1 行）；全局 `maxRuntimeMs` 活体仍为 0（§12 第 2 行） |
| **W1** | **幽灵票：worker Session 被外部停掉后，Ticket 永远停在 running** | 挂在 `agent/disposed` 上：查 `ticketIdOfSession(agent.id)` → 若有 `runningAssignment` 且 `startedAt` 已设 → `assignmentInterrupted(...,'external-stop')`。**没有**放进 `refresh()`：那会让"刚建好、合法地还在 idle"的票被误判，实测打红 29 条 | 需要 `startedAt !== undefined` 这个前置条件，否则测试里的假 agent 会被误伤（这条是踩出来的） |
| **W8–W12** | **同一对话的后续消息各自建票**（活体废品：两句话隔 65 秒劈成两张盲票，其中一张凭空发明主题；字面「1」也建了一张） | Thread 聚合（`threads` 表，**schema 升到 6**）+ Subscription fan-out：Thread 已有订阅票且非重复消息 → 直接投给那张票（等人则 `answer`，否则 `note`），**不建票、不走门禁**；票结束自动退订。60 秒启发式**已删** | `findContinuationTarget` 收窄保留为**引导器**（显式 `reply-to-ticket` + DM→群首条），命中即订阅该 Thread，第二条起走 fan-out。不是 old/new 并存 |
| **W13–W18** | **门禁判不了"这句话是不是一件活"**（只有确定性门禁一层） | 加了第二层**判断者**：`settings.triage`（`enabled`/`desk`/`sources`，默认 `{false, dedicated, ['chat']}`）→ `role='triage'` 的分诊票 → 总管四选一（自己答／开票／问人／判无需处理）。三个旋钮都**不进** `authorizationShape`，拨动它们不移动 `policyVersion` | 活体取值 `{enabled:true, desk:'main', sources:['chat']}`；inbox 与 cron **刻意不判**（那是操作者自己下的指令，再判一次白花一轮、判错丢掉他要的活） |
| **W19/W20/W22/W23** | **worker 只能"要么干完、要么 blocked"**，且它能直接往操作者的决断队列里写 | 新增 `myagent_ask_desk`（**非阻塞**提问总管，问完继续跑，总管用 `note_ticket` 回）与 `myagent_handback`（超范围交回，本票以 `dropped` 结束）；worker 的 `myagent_raise_decision` **标注弃用**、描述里明写改用 ask_desk；两级决断规则写进 `prompts/triage.md`（能自答的自答，只有操作者能定的才上升） | 弃用是**描述级**的，不是工具面级的移除（避免打断已在跑的 worker）；`ask_desk` 的活体端到端**未验证**（§12 第 5 行） |
| **W30** | **跨 Ticket 只能读"已登记产物"**，兄弟目录一律拒 | `guardWorkerCall` 加 `peerDirs`：**同一 Work** 的票目录可被 `read`/`read_image`/`glob`/`grep` 读；`write`/`edit`/`bash` 仍拒；未归组的票**没有 peer**。词法与 realpath 两条检查都对齐，且 guard 闭包**每次重读** ticket（票可能在 worker 起来后才被归组） | 这是**可达性**放宽，不是安全边界（§1 的 OS 级沙箱仍然没有）；`SECURITY.md` §4 已写明这层关系 |
| **W31** | **产物登记只能逐个文件**，worker 忘登记的文件对下游彻底不可见 | `report.files` 里以 `/` 结尾的路径登记**整棵树**；`authorizeArtifactRead` 让目录覆盖其下任意路径，返回 `readPath`（真要开的文件）与 `artifact`（授权它的登记），血缘记 `readPath`。标记必须**显式**（Engine 不做 IO，猜"是目录"会让陈旧名字悄悄放大权限） | 动因是活体废品：一张票产出 27 个技能的 `skills-pack/` 却只登记 13 个索引文件，下游够不着 → 重新下载三个仓库并翻本项目源码，**烧掉 102 万 token** |
| **W33/W34** | **总管自主裁定的事对操作者不可见**；**Thread 归属看不见** | `GET desk-decisions` + 面板「记录」页第三个分区「总管代你决定的」（列结局与总管原话，原话作为**数据**引用、不渲染为 markup）+ 总览摘要卡与顶栏「总管决定 N」胶囊；单票 API 加 `thread` 字段、详情页「线程」行、任务列表行加 💬 标记 | — |
| **（排障）** | **"等你回答"永远显示 1 条、列表里却查不到任何票** | 两处根因都修了：① worker 以 `ready` 收尾时若报告里带了 `question`，`attention` 不会被清（已改为 `ready`/`dropped` **无条件**清）；② `count()` 的 attention 计数没排除**已结束**的票。活体肇因是票 `961d2206`：`ready` 的同一个 `at` 上带着一个 question | 同一族的教训：`tests/watchdog.spec.ts` 用**桩 host**，所以 runtime 自己写健康板那一层它结构上测不到——G-5 那条永久红线就是这么活下来的 |


---

## 附录 B · 曾被写错、后来被更正的陈述

历史值得留，但它不该与现状混在一层。这里记的是**本文自己的旧版写错过的东西**，
以及它们是怎么被发现的——因为发现的方式比错误本身更有用。

### B.1 「P8 至今零工作量」（旧版 §0.1 与 §1 的前提）

**旧版怎么写的**（第 32 轮，2026-11-04 12:0x）：一节标题为「P8 至今零工作量：扩展接口与聊天来源一行代码都没有」，
正文说 `src/sources/` 下没有任何聊天来源的文件、`SourceKindName` 是四成员闭合联合、
`Delivery` 端口只有 `report` 与 `policyChanged?` 而**没有 `send`**、"平台身份 → 真实 Actor 连一行代码都没有"，
并把 P8 拆成 8 行、断言"8 行里没有一行的状态高于 仅有设计"。

**它在被写下那一刻是真的**——`00` §4.31 同一轮也写着"P8 是唯一零工作的阶段"。
**它错在活得太久**：第 35 轮 P8 开工，第 38 轮结案，而旧版没有一处正文被改，
只是被三个日期递增的增补（旧 §12、§13、§14）一层层盖住，每个增补都"取代上一个的那一行"。
于是同一份文档里同时存在"P8 至今零工作量"和"P8 已实现并通过真宿主验收"，
**读者必须读四层历史才知道哪个是真的**。这就是本次重写要解决的问题。

**现在的状态**：P8 结案（附录 A 第 35–38 轮那七条），聊天闭环有**真宿主验证**（`16`）。
正文 §1 剩下的 9 行是 P8 的范围收窄明确排除的东西（D1/D3/D9/D10）与它落地时暴露的疣。
`Delivery.send?` 在 `engine.ts:158-176`，`SourceKindName` 是五成员（`model.ts:4`），
`src/sources/chat.ts` 存在且进了 bundle。

### B.2 「`send` 处理器注册在 `src/app/effects.ts`」（旧版 §12 的一格）

**旧版怎么写的**：第 35 轮的增补把 C2 的接入方式写成"在 `src/app/effects.ts` 注册 `send` 处理器"。

**为什么不可能**（实现者在第 36 轮指出，`00` §4.34 (ii) 记了这条）：**效果队列是通用的、不认识 `SourceRegistry`**。
`effects.ts` 只知道 `(kind, key, payload)` 与"调哪个处理器"，它没有任何途径拿到"某个 kind 的 Source 实例"；
而 `send` 必须按 `replyTo.kind` 找到那个 Source 并调它的 `deliver`。把处理器放在队列里，
就得把 SourceRegistry 交给队列——那是让一个通用组件认识一个具体的领域注册表。

**实际落在哪**：`src/app/delivery.ts` 的构造函数里，与 `notify` 并列。本轮核对：
`delivery.ts:242` 是 `host.effects.handle('notify', …)`、`:243` 是 `host.effects.handle('send', payload => this.sendReply(…))`；
`sendKey` 在 `:100`（`(ticketId, replyTo.kind, channel, thread, text)` 的纯函数，无时间戳）；
入队在 `:305`；由 Runtime 供给 `source(kind)`。**`grep -n SourceRegistry src/app/effects.ts` → 零命中**，
这与"队列是通用的"这句话一致。

**这一条为什么值得留在附录里**：它是**一份文档把一个不可能的架构写成了待办**，
而实现者照它做就会撞上分层。第 36 轮的处理方式是对的——不改实现去迁就文档，而是更正文档，
并把更正的理由（队列通用、不认识注册表）写下来。

### B.3 另外三条同类：引了一句「未做」，而没读同一节里关掉它的那一段

旧版有三行是**在被写下那一刻就已经过期**的，共同原因是：引了 `00` 某一节的「未做」清单，
而没有读同一节（或下一节）里关掉它的那一段。三条都由本轮核对代码发现：

| 旧版的行 | 它引的 | 关掉它的那一段 | 本轮核对 |
| --- | --- | --- | --- |
| §1 末行「规则来源的 `then.workId` 写入路径 —— 尚未实现」 | `00` §4.16「未做」（`:999`） | **`00` §4.17（第 22 轮，`:1016`）**："这条链现在闭合了：规则的 `then.workId` → Trigger 的 `meta.work` → 受理时归类"，就在 17 行之后 | `policy.ts:141`、`rule.ts:96`、`engine.ts:292-299` 三处都在 |
| §5「"部分成功"的释放策略 —— 语义本身没有给出」 | `00` §4.8「未做」（`:605`） | **`00` §4.8 自己的 35 行之内**：`:549` 说 `released()` 是导出的纯函数、`:572` 说"`ended` 与 `done` 两种语义的分野"已有测试、`:576` 是「级联取消（第 10 轮已落地）」 | `model.ts:142-147` 的语义注释 + `tests/dependencies.spec.ts:53` |
| §8「`Memory` 与 `Store` 的语义对齐（S7）—— 三处分歧仍在」 | `00` §2 S7 与 §8 第 2 项（两处都仍写着"还没做"） | **`00` §4.5（第 2 轮，`:422-427`）**："**S7 已修**：`Memory.atomic` 重写为与 `Store.atomic` 结构同构……经变异检验" | `memory.ts:133-171`（两处注释逐字承认旧行为）、`tests/transaction.spec.ts`（7 条契约 ×2 实现） |

**规律**（写下来，因为它会再发生）：`00` 是一份**追加式**的文档，某一节的「未做」清单
只反映**那一轮**的状态，而关掉它的记录在后面的某一节里。所以引 `00` 的「未做」时必须做一件事：
**在同一份文档里搜那个条目的关键词，读到最后一处命中为止。** 本轮就是这么发现这三条的
（搜 `workId`、搜 `released`、搜 `transaction.spec`）。

**同一个规律的第四、第五个实例，此刻仍活在别的文档里**（本文无权改，记在这里）：

- `11` §6(1) 仍用**现在时**写着 S7 的三处分歧，而它自己的 §4.1 第 4 条写着"S7：`Memory` 与 `Store` 的事务语义
  **统一成一份契约**"——**同一份文档里两处对立**，代码站在后者那边（`memory.ts:133-171`、`tests/transaction.spec.ts`）。
- `11` §7 第 4 条（`:439`）仍写着"规则来源的 `then.workId` 还没有写入路径"，而本轮核对 `policy.ts:141`、
  `rule.ts:96`、`engine.ts:292-299` 三处都在——**那半句第 22 轮就过期了**。
- `00` §8 第 2 项仍写着"Memory 的语义对齐还没做"、第 4/5/7/8 项仍标 ⬜ 而代码已完成（§2 末行）。

`11` 在本轮期间被另一个代理合并过（01:26 落盘），**这两处都没有在合并中被关掉**。

---

## 附录 C · 本文与其它来源不一致的地方，以及本文取哪个

| 矛盾 | 两个来源怎么说 | 本文取哪个，凭什么 |
| --- | --- | --- |
| 日常宿主能不能只读 GET | 任务前提与本文旧版：能（带 `x-myagent-request: 1`）；本轮实测：`/`、`/api/state`、`/myagent/api/state` **全部 401**（`dsh web authentication required`） | **两个都对，时间不同。** 本文取本轮实测（401）作为"本轮无法自己核实"的依据，同时取 `00` §4.47 的那张探针表作为线上现状的**权威值**（它拿到了 token，本文没有）。`mountedAt` 那一行本文用锁文件独立核对过，吻合 |
| 日常宿主跑的是第几轮的 bundle | 任务前提："第 31–36 轮"；`00` §4.47："**第 31–34 轮**" | 取 §4.47（它是实测，且本文用锁文件的 `at` 独立核对过下界）。两者的差别不影响任何标签：第 33–46 轮的一切都不在线上 |
| S7 的三处分歧还在不在 | `00` §2 S7 与 §8 第 2 项、`11` §6(1)：在（现在时）；`00` §4.5 与代码：第 2 轮已修 | **取代码**（`memory.ts:133-171` + `tests/transaction.spec.ts`）。见附录 B.3 |
| `then.workId` 有没有写入路径 | `00` §4.16「未做」、`11` §7 第 4 条（`:439`，本轮 01:26 合并后仍在）：没有；`00` §4.17 与代码：第 22 轮已通 | **取代码**（`policy.ts:141`、`rule.ts:96`、`engine.ts:292-299`）。见附录 B.3 |
| `gate.sh` 的结论落不落盘 | 本文旧版 §9 第 1 行：不落盘（并因此把退出码标为未核实）；`00` §4.47 与 `11`（合并后）§0：`gate.sh:80`/`:84` 都是 `tee -a` | **取代码**（本轮核对三处 `tee -a`，且 `:84` 只在 `failures` 为空、紧跟 `exit 0` 之前执行）。旧版那行第 32 轮就已过期，见附录 A。`11` §0 独立否证了它自己的上一版："**那条陈述已被代码否证**" |
| `06` §6 的"高"第 2 条（inbox 目录权限自检） | `06` §6 仍列为待办；`00` §4.22（第 27 轮）：已做（`mode & 0o022` 上一行健康问题，带八进制模式与 `chmod go-w`，两条测试） | 取 `00` §4.22 与代码。**`06` §6 那一行已过期**，而本文无权改它；本文 §10 第 2 行按"已做"记，缺的是认证而不是自检 |
| 面板测试是 144 / 146 / 185 条 | `05` §0/§3：144；`07` §0.2：146；`11`（合并后）§7 第 1 条与本轮 `/tmp/myagent-gate.log:45`：**185** | 取 gate.log（`✓ tests/panel.spec.ts (185 tests)`）。差额可解释：S36 的两条在第 23 轮补上、D 在第 37 轮 +26、第 46 轮 +13。**`05` 与 `07` 都还写着旧数**，引用这类数字必须带轮次 |
| 测试总数 | `11` 合并前正文：631、其第 40 轮增补：723；`11` 合并后 §0/§3 与本轮 gate.log：**759** | 取 gate.log（`Tests 759 passed (759)`）。`00` §4.47 与 `11` §3 各自对过账：书面的 `it(`/`it.each(` 是 **747**，Δ=12 全部有出处（`transaction.spec.ts` +7 因为一份断言跑两个实现、`chat-contract.spec.ts` +4 与 `chat.spec.ts` +1 因为 `it.each`），**没有一条是无主的** |
| 线上库是 version 1 还是 5 | `00` §5 正文曾写 `schema_version=1`；`03` §6 与 `02` 已就地更正为 5 | 取 5（S37 查明：日常库在热重载时被自动迁移）。本轮核对 `SCHEMA_VERSION = 5`（`store.ts:19`），且第 44 轮**没有**引入迁移 |
| 构建后日常宿主会不会热重载 | `00` §4.23（S37）：会（第 29 轮实测，还把日常库迁到了 5）；第 33 轮：一次"构建后没有重载"的观测，于是把机制标为"未证实" | **取 §4.47 的更正**：`mountedAt = 12:21:30` 证明在第 31/32 轮那个窗口里**确实发生过一次重载**，所以机制是真的，只是触发条件不明（`include:hmr` 是候选）。§4.47 自己记下的那条教训值得抄："**我用单次阴性观测去证伪一个机制**，这正是纪律 0.3 所警告的错误的镜像——一次没发生，不等于不会发生"。运维后果是实的：每次跑闸门都可能（但不必然）热重载日常宿主 |

---

## 附录 D · 本文没有覆盖的

为了不让人把这张表当成全集，明说它**不含**什么：

- `07` 的 221 项能力表里那些 真宿主验证 与 离线验证 的项（它们不是缺口）；
- `01` 的逐项验收（上一轮构建的记录）、`02`/`02b` 的验收与更正本身（本文只引它们的判定）；
- `14`、`16` 两份验收报告的**正面结论**（本文只引它们证明过什么、以及它们顺带发现的 N8–N11）；
- `04` 的纪律条目本身（只有 §9 引了它两条无法机器检查的、以及 §0.10 那条 catch-all 规律）；
- `08` 的配方、`09`/`10` 的架构叙述、`13` 的数据模型、`15` 的 P8 契约正文（本文只引它们的决定）；
- `17` 的故障注入操作细节（本文只引它的旋钮形状与它量到的两个缺陷）；
- `00` §6 的替身保真度问题里除 §9 已列五条之外的其余条目；
- **已经结案的一切**——它们在附录 A，不在正文。
