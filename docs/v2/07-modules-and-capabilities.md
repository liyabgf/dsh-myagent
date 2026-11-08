# 模块清单与能力状态（第一部分）

本文是十项交付物里的**模块实现清单**。它做两件事：给每个源文件一行（责任、公开面、依赖、行数），
并给它实现的每一项能力标一个状态与一条证据。

**本文是当前快照，不是"旧清单 + 增补"。** 上一版成文于 2026-11-04 07:31（第 32 轮之前），
其后挂过两段增补（§12 更正两处被代码否证的陈述、§13 记录 P8 在第 35–38 轮落地）；
两段都已**折进正文**，本文的每一处行数、每一处 grep 结果、每一个状态标签都是本轮（第 46 轮之后）重新量的。
被折进来的更正**没有删掉**：它们连同"当时是对的、现在不对了"这个信息一起搬进了 **附录 A**。

**本文只覆盖第一部分（模块清单）。** 第二部分（未实现能力清单）是 `docs/v2/12-unimplemented.md`；
本文 §10 只留清点模块时**已经逐个核实过**的条目，每条都带代码位置，方便那份清单直接引用而不必重查。

> 本文的写作纪律与 `docs/v2/04-execution-discipline.md` 一致：
> **凡是不能核实的地方写"未核实"并说明核实它需要什么，绝不用一个看起来合理的猜测填空。**
> 凡是从既有文档抄来的结论，都重新核对过；核对结果与文档不一致的地方，写在 §9。

---

## 0. 读法

### 0.1 五种状态（操作者定义，标签逐字使用）

| 状态 | 含义 | 证据要求 |
| --- | --- | --- |
| **真宿主验证** | 经真实 DSH 宿主驱动过并观测到 | 引用 `docs/v2/01-live-acceptance-current-build.md`、`docs/v2/02-live-acceptance-v2.md`、`docs/v2/02b-live-acceptance-v2-addendum.md`、**`docs/v2/14-live-acceptance-watchdog.md`（第 33 轮）** 或 **`docs/v2/16-live-acceptance-chat.md`（第 38 轮）** 的小节或测量，或一个仍存在的残件路径（`/tmp/myagent-acceptance-v2/`、**`/tmp/myagent-acc-watchdog/`**、**`/tmp/myagent-acc-chat/`**） |
| **离线验证** | 有跑在 `src/` 上的测试，但从未被宿主驱动过 | 测试文件名 + `it(...)` 的名字（逐字） |
| **部分实现** | 一部分存在且工作，另一部分不 | 必须说清是哪一半；未验证/未建的那一半单独给它自己的状态标签 |
| **仅有设计** | 写在文档里，没有代码 | 文档的小节 |
| **尚未实现** | 连设计都没有 | — |

**本文把证据清单扩到了 `14` 与 `16` 两份验收报告，理由要写明**（否则这个扩充本身就是一次未授权的升级）：
它们与 `01`/`02`/`02b` 是同一类产物，而且更严——**隔离宿主**（独立 profile / 端口 / stateDir）、
**产物哈希在起点、中途、终点各核对一次且一致**（`14`：`04d171f8…` 三次一致，所以"没有任何结论需要标'待复验'"；
`16`：`b955704fcc677aff…` 起点=终点）、残件仍在（本轮复核 `/tmp/myagent-acc-watchdog/` **33 份**、
`/tmp/myagent-acc-chat/` **53 份**、`/tmp/myagent-acceptance-v2/` **43 份**，三个目录都在）、
每条结论都带【实测】/【推断】标注。它们也**晚于** `02b`，所以不会引用被 `02b` 推翻的陈述。
**`02` 顶部那个更正块的三条仍然有效，本文逐条遵守**：§7 的标题"Watchdog —— 通过"是错的、应为
"**部分：探测得证，救援被证伪**"；§4 里"`rescued` 发生在 `launched` 之前，正是'救援 → 才启动'的语义"是**错的因果**；
§9 里"自动产生了新 Ticket 并跑到 `stage: done`"**只有一张成立**（`d9493df4` 是 `done`，`2cfc2761` 是
`stage:"running"`、`ended:null`，它证明的是另一件事）。另有三处：`assignment_stale` 不是"证据丢失"而是**从未尝试**；
§8 的 `archived_after_lift: false` 是代理自己的假阴性、**不要引用该字段**；
`INVALID_TOOL_OUTPUT` 这个拼法在原始现场里**没有**见到。

两条判读规则，因为它们决定了边界情形怎么标：

1. **"文档点出了缺口"不等于"有设计"。** `docs/v2/05-panel-v2-ui.md` §5 那类"还缺什么"清单说的是缺什么，
   没有说怎么建 —— 标 **尚未实现**。反之 `docs/v2/00-audit-and-plan.md` §3 的 D1–D11 给出了机制与接口位置
   （例如 D11 说 `Delivery` 端口要加 `send`），标 **仅有设计**。
2. **"已实现但零调用者、零测试"标 部分实现，缺失的那一半命名为「未接入」。**
   这是 `00` §4.25 的裁定，本文上一版提出的那个词表缺口已被它采纳：**不新增第六个状态**
   （操作者定的是五态，词表扩到六个会让十项交付物之间对不上），而是标 **部分实现** 并明说未接入，
   例如「部分实现（引擎层完整，**未接入**：`src/` 内零调用者、零测试）」。
   理由是这个词表要回答的问题不是「代码写了多少」，而是「**操作者能不能用到它**」——
   第 21 轮那批 Engine 命令就是活例子：11 条测试全绿、而零调用者，所以从操作者的角度看它等于不存在。
   **裁定还附带一条硬性要求**：任何标为「未接入」的条目都必须写明**接入它需要什么**
   （一条路由？一个面板区块？一个来源？），否则下一轮仍然不知道该从哪儿接。本文逐条照做。
   **第 36 轮给这条裁定补了一个客观判据**（`00:2012-2014`、`:2071-2074`）：
   **一个新模块落地后产物哈希不变 ⇒ 它没进 bundle ⇒ 未接入**；接线之后哈希与体积一起动
   （`4a6bb032…`/276275 → `8ca08244…`/298499，**+22224 字节**），且 bundle 里能 grep 到它的标记字符串。
   判据可以长期引用，**实例必须带时间戳**（纪律 §0.9）。

**不许为了让项目看起来更远而升级标签。** 具体地：一个能力有测试但没有调用者，就是 **离线验证**，
并且要写出"没有调用者"这件事；一个缺陷在真宿主上被观测到过、而修复只有离线测试，
就是 **部分实现**，并且要写出"修复从未在真宿主复验"。

### 0.2 被清点的产物身份

本文清点的是**源码树**，同时核对了发布产物的身份（只读，**没有构建**）。
**本轮期间这棵树被主代理动过两次**（一次面板 CSS 修复 + 一条测试，一次完整闸门重跑），
所以本文的每个数字都带**测量时刻**——纪律 §0.9：**判据可以长期引用，实例必须带时间戳**。

| | |
| --- | --- |
| `lib/index.js` | sha256 **`768a6adb1cfc136cc7d0b0e99578fa047fafc95cb5330e33b2b9943236c7c3e2`**，**320163 字节**，mtime **`2026-11-05 02:40:13`**。**这个哈希在本轮被独立量到四次都相同**（00:5x、01:1x、02:3x、02:4x），而 mtime 动过三次（00:43:54 → 02:04:00 → 02:40:13）——即**重建过两次、内容一次都没变**。按纪律 §0.2b，"哈希不变"本身就是"内容未变、且构建是确定的"的证据 |
| 陈旧检查 | `find src tests -name '*.ts' -newer lib/index.js` → **0 个**（本文自己跑的，不是从闸门读的） |
| 产物盖的 schema 版本 | `grep -c '\.run(5)' lib/index.js` → **1**（源码 `src/app/store.ts:19` 是 `SCHEMA_VERSION = 5`） |
| 死表 `settings` 的 DDL | 产物里 **0 次** |
| 闸门 | **退出码 0**，四步全过（`── typecheck` / `── build` / `── test` / `── artifact`），起于 **2026-11-05 02:40:09**。计数行 **`Tests  760 passed (760)`**、**`Test Files  33 passed (33)`**；结论行 `结论：通过。产物 768a6adb1cfc136c…（320163 字节）` |
| 闸门退出码这次可以从日志本身读出来 | `scripts/gate.sh:84` 与 `:88` 都是 `echo … \| tee -a "$log"`，而 `:88` 那行只在 `[ "${#failures[@]}" -eq 0 ]` 分支里执行、紧接着就是 `exit 0`。**本文上一版说"结论行只 echo 到 stdout、不进 `$log`"——那条陈述已被当前脚本否证** |
| **日志现在自报它验了什么**（本轮新增，`scripts/gate.sh:22-25`） | 首行是 `── 本次运行：scripts/gate.sh （2026-11-05 02:40:09）`。它存在的原因是本文本轮**亲手撞到的一个真危险**：02:21:51 那次运行是 `--quick`（跳过 build 与两项产物核对），而它与完整闸门**写同一个日志文件**，于是日志里最后一次"结论：通过"可能只做了两步、却被下一个读者当成四步全绿的证据。脚本自己的注释逐字写着：**"判定权在退出码，但退出码不留痕；留痕的那份东西必须自己说明它验了什么、没验什么。"** 本文 00:5x 量到的那次完整闸门（**759 条**、00:43:54）与 02:40:09 这次（**760 条**）之间，`--quick` 那次是唯一的 760 证据——所以本文两个数都记 |
| 未处理错误 | 日志里 `Errors` / `Unhandled` **零命中**；计数行也没有 `/ Errors N error` 那一段。另有 **6 条** `MaxListenersExceededWarning`（`exit listeners` >10），不影响退出码 |
| 本文亲自跑过的命令 | `pnpm typecheck` → 退出码 **0**；`pnpm vitest run tests/transaction.spec.ts` → **14 passed**；`pnpm vitest run tests/panel.spec.ts` → **186 passed**（02:36:38）；以及对 `127.0.0.1:3080` 的只读 `GET`（带 `x-myagent-request: 1`，见 §0.3）。**跑完复算 `shasum -a 256 lib/index.js` 仍是 `768a6adb1cfc136c…`，未变** |
| 产物里的标记字符串（证明第 33–46 轮的改动**确实进了 bundle**） | `notice_lost` 2 次、`reply_lost` 2 次、`REPLY-UNDELIVERED` 2 次、`reply_unreceivable` 2 次、`triggers:lost` 2 次、`unmapped identities` 2 次、`chat-reply` 1 次、`escalated` 10 次、`rule_stopped` 3 次、`decision_missing` 2 次、`mountedAt` 5 次、`no effect failed in this pass` 1 次、`the last delivery went through` 1 次；**`worker slots in use` 0 次**（S38 那句 gauge 确实被删掉了，不是被更新了） |

源码与测试规模（`wc -l`，本轮重量；括注是上一版的值）：

| | 本文（02:4x） | 上一版（第 32 轮之前） |
| --- | --- | --- |
| `src/` | **9305 行 / 34 个 `.ts`** | 7733 行 / 33 个 |
| `tests/` | **14188 行 / 35 个 `.ts`**（33 个 spec + 2 个 helper） | 10728 行 / 31 个 |
| `panel/index.html` | **2128 行 / 128775 字节**，sha256 **`2fdbfcad0f440318…`**（02:04:12 的一次 CSS 修复之后；本文 00:5x 量到的是 2121 行 / 127974 字节 / `290eed86…`） | 1528 行 / 86325 字节 |
| `scripts/` | **275 行 / 3 个**（`gate.sh` 87 → **93**） | 269 行 / 3 个 |
| `prompts/` | **123 行 / 2 个** | 116 行 / 2 个 |
| `examples/` | **104 行 / 3 个** | 104 行 / 3 个 |
| `locale/` | **12 行 / 2 个**（`en.json`、`zh.json`，各 6 行，只有 `meta.title` 与 `meta.description`）—— **上一版没有清点这一层** | — |

**一条本文查出、而闸门的检查覆盖不到的缺口**：陈旧检查是 `find src tests -name '*.ts' -newer lib/index.js`，
**只 glob `*.ts`**。所以 `panel/index.html` 现在比产物新（02:04:12 对 02:40:13 是产物新，但 00:43:54 那次闸门时面板就已经比它新了），
而闸门**不会因此变红**——这是对的（面板不进 bundle、走磁盘），但它意味着**一次只改面板的回归无法让闸门变红**，
面板的唯一防线是 `tests/panel.spec.ts` 那 **186 条 jsdom 断言**（C196：**真浏览器从未验证过任何面板行为**）。

### 0.3 一条贯穿全文的时效限定：3080 在**本轮期间被重载了**，现在跑的是当前产物

**这一节本轮被重写了一次，因为事实在本文写作期间变了。**
本文 00:5x 第一次只读复核时，日常宿主跑的是一个**第 31–34 轮之间**的旧 bundle；
**01:40:15 它被重载了**，02:4x 本文重新量了一遍，下面是那一次的读数。
上一版这一节讲的是 S37（2026-11-04 05:33:53 的一次热重载）；那件事已被本次重载盖掉。

| 日常宿主 3080 的现状（本文只读复核，**2026-11-05 02:4x**） | |
| --- | --- |
| `state.mountedAt` | **`2026-11-04T17:40:15.610Z`** = 本地 **2026-11-05 01:40:15**。状态锁 `myagent.lock` 的 `at` 是**同一时刻**、`token` 换成了 `15499f6b-…`、**pid 仍是 24619**（即宿主进程没换，插件被重挂载了）；marker `myagent.json` 的 mtime 也是 `01:40` —— 三条独立读数吻合 |
| `GET /api/lost` | **200**，`{"total":0,"shown":0,"rows":[],"payloads":[],"bounds":{"keep":20,"chars":1000}}` |
| `state.chat` | **存在**：`{"policy":{"enabled":false,"paused":false,"deny":false,"acceptMode":"auto","allowedSenders":["operator"]},"waiting":{"count":0,"ids":[]}}` |
| `state.counts` | `{open:0, ended:9, attention:0, triggers:11, decisions:11, effects:{}, workerSlots:{used:0,max:2}, `**`sends:{queued:0,nowhere:0}`**`, `**`lost:{rows:0,payloads:0}`**`}` |
| `state.settings.sources` | **五个块**：`cron` `inbox` `session` `rule` **`chat`**，其中 `chat` = `{"enabled":false,"identities":{},"channels":[],"pollMs":5000}`——**`.prefault({})` 的默认值被materialize 出来了**，这正是 C225 那条"版本中性"规矩在线上可读的样子 |
| `state.health` 条目名 | `effects` `passes` `watchdog` `runtime` `source:cron` `source:session` `source:rule` **`source:chat`** `source:inbox` —— **没有 `executor`**，也**没有** 00:5x 那次读到的 `sessions` |
| `health.effects.detail` | **逐字 `"no effect failed in this pass"`** —— 那是 `src/app/effects.ts:56` 的 `QUIET` 常量，即**第 43 轮那个"健康条目自己会清"的行为此刻正在线上跑着** |
| `health['source:chat']` | `{ok:true, detail:"disabled"}`；`sources.chat.counts` = `{accepted:0, ignored:0, observed:0, duplicate:0, waiting:0}` |
| `policyVersion` / `settingsRevision` | **`3bb5598e3044fc96`** / **7** —— `settingsRevision` 与 00:5x 那次**逐字相同**（7），而 `policyVersion` **变了**（00:5x 是 `275ea61ded276e15`）。见下面那条单独的记录 |
| `state.mainSession` | `{exists:true, running:true, busy:false, id:"session-<uuid-sha256:1f68dd909302>"}` |
| `GET /api/projects` / `works` / `effects` | `{"projects":[]}` / `{"works":[]}` / `{"counts":{}}` —— 仍是空集合 |
| 服务端面板字节 | 与磁盘 `panel/index.html` **逐字节相同**（sha256 `2fdbfcad0f440318…`，128775 字节）—— 预期如此，面板每次请求都从磁盘读 |
| 日常库 | sha256 **`a793caacbbcb2e1d…`**、**167936 字节**、mtime **`Nov  4 11:40:37`** —— **重载没有写它**（`-wal` 仍是 0 字节），与 `docs/v2/16-live-acceptance-chat.md` §5 记录的"起点=终点"仍逐字相同 |
| 已加载 bundle 的 sha256 | **未核实**：没有任何路由暴露它。核实它需要重载插件（操作者的决定）或在宿主进程内读 bundle 身份 |

**已加载 bundle 现在可以被夹得很紧，而且三个边界都指向同一个哈希。**

- **下界 ≥ 第 45–46 轮**：`GET /api/lost` 返回 **200** 且带 `bounds:{keep:20,chars:1000}`——那两个数正是
  `LOST_TRIGGER_KEEP` / `LOST_TRIGGER_CHARS`（`src/app/store.ts:137-138`），第 44 轮才有；
  而"把 `bounds` 一起答出来、好让页面从**强制它的那个构建**读出上界，而不是从一份会漂移的副本里读"
  是第 45–46 轮的设计（`http.ts` 的 `bounds` 字段注释）。`counts.lost` 与 `counts.sends` 同时存在，把下界压到第 37 轮之后。
- **≥ 第 43 轮**：`health.effects.detail` 逐字是 `no effect failed in this pass`（第 43 轮的 `QUIET`）。
- **≥ 第 39 轮**：健康板上**没有 `executor` 条目**，而系统此刻是健康的——那正是 S38 之后才成立的形状
  （C231：那个条目惰性创建，唯一创建它的那句 gauge 被删了）。**00:5x 那次也读不到 `executor`，但当时这个观测没有意义**（旧 bundle 里那句 gauge 只在 `launch()` 里写，没有 launch 就没有条目）；**现在它是有意义的**。
- **≥ 第 36 轮**：`source:chat` 健康条目存在，`detail` 是 `"disabled"`。
- **时间窗**：`mountedAt` = 本地 01:40:15，晚于 `768a6adb…` 的第一次构建（00:43:54），
  早于其后两次重建（02:04:00、02:40:13）——**而那三次的哈希逐字相同**。
  ⇒ **已加载的 bundle 就是本轮被钉住的那份 `768a6adb1cfc136c…`**。这仍然是**推断**（没有路由直接报哈希），
  但与 00:5x 那次只能夹到"第 31–34 轮之间"相比，这一次三条独立证据都落在同一个哈希上。

**这条时效限定对标签的约束（本轮改过，因为它的前提变了）**：

1. **第 33–46 轮的一切改动现在在日常宿主上可达了。** 本文 00:5x 写下的"不可达"这一句**已经作废**，
   正文里凡出现"日常宿主上**此前**不可达、本轮 01:40:15 重载后**可达但未被驱动**（§0.3 第 1、2 条）"的地方，一律读作**"此前不可达；本轮 01:40 重载后可达，但仍然没有被验收驱动过"**。
2. **可达不等于被驱动，所以标签一条都没有因此升级。** 本文确实在 3080 上看到那些新面**在答**
   （`GET /api/lost` 200、`state.chat` 存在、`counts.sends`/`counts.lost` 存在、`health.effects` 说着 `QUIET`、
   健康板上没有 `executor`），**但它们答的全是空值或默认值**：`lost.rows` 0、`chat.waiting` 0、
   `sends` `{0,0}`、`chat.enabled` **false**、`channels` **[]**、`projects`/`works` **[]**。
   **没有一项是被一件真工作驱动出来的。** 一次对空集合的 GET 不是一次验收——这正是本文上一版对
   `projects`/`works` 用过的同一条判据，本轮对它自己的新面也照用。
3. **§0.3 这张表是本文新取的只读复核，它不在操作者规定的证据清单里**
   （`01`/`02`/`02b`/`14`/`16` 或那三个 `/tmp/` 残件目录）。所以本文只用它来**降级**标签或说明现状，
   **从不用它把任何标签升成 真宿主验证**。**这条规则本轮的理由变了、但结论没变**：
   上一版的理由是"它观测的是旧产物"，现在它观测的是当前产物，所以理由换成——
   **升级一个标签需要一次按第 4 档纪律做的验收**（隔离宿主、钉住哈希、事先写明"什么才算证明"与"什么会证伪它"），
   而不是一次顺手读到的 GET。要把 §0.3 里那些"可达但未被驱动"的能力升上去，
   需要的是**一次针对第 33–46 轮的隔离验收运行**，其场景要覆盖：一次真投递走到彻底放弃（`notice_lost`/`reply_lost`/`lost` 三种痕迹）、
   一次 `everyMs` 变更后的 `rescued` 落点（C100 的第二次修复）、一次升级后的对账（N11）、
   以及一个 chat 频道被启用后 `waiting` 从非零归零。
4. **本文在 00:5x 量到的那个状态本身值得留着**，因为它把"新页面 + 旧 API"从推测变成了实测：
   当时 3080 送出的面板（`290eed86…`，127974 字节）**含** `#lost-count`、`#chat-waiting`、`丢失的请求`，
   而它的 API 对 `GET lost` 返回 **404**、`state` 里没有 `chat`。**那个状态在 01:40:15 之后结束了**，
   但它曾经真实存在了至少 50 分钟，而面板对它的处理（能力探测 + 那句"这不代表「没有丢失的请求」，它代表「读不到」"）
   **只有 jsdom 证据**（C200）。

**一条本轮新查到、且只有重载才能看见的事实：`policyVersion` 会随构建移动，而 `settingsRevision` 不会。**
同一份存盘的设置文档（`settingsRevision` 一直是 **7**），在旧 bundle 下算出 `275ea61ded276e15`、
在新 bundle 下算出 **`3bb5598e3044fc96`**。机制在源码里看得见：
`policyVersion = key('policy', authorizationShape(settings)).slice(0, 16)`（`src/core/policy.ts:295`），
而 `authorizationShape` 在第 35 轮**长了两块**——派生的 `perSource.enabled` 与 `identities`（C226），
外加整个 `chat` 块。所以**同一个文档在新构建下必然哈希到另一个版本**。

- **已经确认的后果**：所有由旧 bundle 写下的 `Mandate.policyVersion` **不再等于**当前的 `policyVersion(settings)`。
- **此刻没有可观测的影响**：`policyChanged(before, after)` 只在一次设置保存时被调（比较**同一个构建下**的两份文档），
  所以单纯换 bundle 不会发出策略效果；而且 `counts.open` 是 **0**，没有在跑的 Ticket 会被波及。
- **未核实的那一半**：下一次设置保存时，一张在旧 bundle 下受理的 Ticket 会怎样——它的 Mandate 带着旧版本号，
  而 `revalidate` 拿新版本的设置去比。核实它需要**一张在重载之前受理、仍活着的 Ticket**，加上**重载之后的一次授权旋钮变更**，
  然后读它收到的那条 `policyChanged` 通知的措辞。**本文没有造这个场景**（那需要写操作，本轮只读）。
- **这一条与 `00` §4.26 的一个决定直接相关**：那一轮**刻意没有**把构建时间与产物哈希暴露到 `/api/state`
  （理由是面板每 5 秒轮询一次、不该每次都算一次 SHA）。**如果那两个字段在，"版本号为什么变了"就是一个可读的事实；
  现在它只能靠两次 GET 之间的一次重载来推断。**


## 1. 两条分层规则的机器核对

操作者要求"核对而不是断言"。两条都用 grep 核对，命令与结果原样留在下面，可复现。
**本节的两条命令本轮都重跑过**（因为 `src/core/engine.ts` 从 1047 行长到 1219 行、`src/sources/` 多了一个文件），
结果与上一版**同向**，但对照面的数字变了。

### 1.1 `src/core/` 不做 IO —— **成立，但有一处需要说清**

```
$ grep -rn "node:fs\|node:path\|node:child_process\|node:os\|node:net\|node:http" src/core/
（无输出，退出码 1）

$ grep -rn "from 'node:" src/core/
src/core/ids.ts:2:import { createHash } from 'node:crypto'

$ grep -rn "^import .*from" src/core/ | grep -v "from '\./"
src/core/ids.ts:2:import { createHash } from 'node:crypto'
src/core/policy.ts:8:import { z } from 'zod'

$ grep -rn "@deepseek-ai" src/core/
（无输出，退出码 1）
```

结论分三句，因为它们不是一件事：

1. **没有文件系统、进程、网络、路径 IO**：`node:fs`、`node:path`、`node:child_process`、`node:os`、
   `node:net`、`node:http` 在 `src/core/` 里**零命中**。这一条成立。
2. **没有任何 DSH 导入**：`@deepseek-ai/*` 在 `src/core/` 里**零命中**。这一条成立。
   **对照面的数字要更正**：上一版写"`src/app/` 有 9 个文件导入它"，本轮 `grep -rl "@deepseek-ai" src/` 得到 **9 个文件**，
   其中 **7 个在 `src/app/`**（`agent-delivery.ts` `background.ts` `delivery.ts` `executor.ts` `http.ts` `runtime.ts` `sessions.ts`），
   另两个是 `src/deployment.ts` 与 `src/index.ts`。**9 是 `src/` 的总数，不是 `src/app/` 的**。
3. **但 core 不是"零 Node 依赖"**：`src/core/ids.ts:2` 导入 `node:crypto` 的 `createHash`，
   `src/core/policy.ts:8` 导入 `zod`。`createHash` 是纯计算（sha256 摘要），不是 IO，
   所以它不违反"不做 IO"这条规则 —— 但它意味着 core **不能在 non-Node 运行时里原样跑**，
   而"core 是纯领域层"这个说法如果被人读成"可以搬到浏览器里"，就会错。
   `src/core/` 内部的其余导入全部是相对的（`./ids.ts`、`./model.ts`、`./policy.ts`、`./timing.ts`、`./errors.ts`、
   `./engine.ts`），**没有一个向上依赖 `src/app/` 或 `src/sources/`**。
   **P8 的契约层没有破坏这一条**：`ReplyTo` 定义在 `src/core/model.ts`、由 `src/sources/kind.ts:127` **再导出**，
   而不是反过来——`00:1951-1953` 记了这个决定被批准的理由（定义在 `kind.ts` 会让
   `core/model → sources/kind → core/index` 成环，而 `kind.ts` 本来就以同样方式再导出 `Trigger`/`key`）。

对照面（谁在用 Node 内置模块，`grep -rl "from 'node:" src/`）：**12 个文件** ——
`src/app/` 8 个（`delivery.ts` `executor.ts` `files.ts` `http.ts` `lock.ts` `prompts.ts` `runtime.ts` `store.ts`）、
`src/core/ids.ts`、`src/deployment.ts`、`src/sources/chat.ts`（**第 36 轮新增**）、`src/sources/inbox.ts`。
IO 确实被挡在 core 之外（core 里只有 `ids.ts` 那一个纯计算的 `node:crypto`）。
**上一版记的是"`src/app/` 12 个文件"，本轮实测 `src/app/` 是 8 个、全树 12 个。**

### 1.2 Engine 是领域状态的唯一写者 —— **成立**

`Repositories` 端口（`src/core/engine.ts:127-136`）有 8 个仓库，写方法一共三种：`save`、`append`、`delete`。
全仓扫描（**本轮重跑**，`src/core/engine.ts` 已从 1047 行长到 1219 行、公开方法从上一版记的 38 个变成实测 **44 个**）：

```
$ grep -rn "repos\.\(triggers\|tickets\|decisions\|artifacts\|projects\|works\|events\|dependencies\)\.\(save\|append\|delete\)" src/
→ 22 处命中，**全部在 src/core/engine.ts**：
  281 282 311 316 318 385 435 459 487 500 513 588 608 725 738 798 846 904 914 1077 1115
  与 882 的 events.append
  （上一版记的也是 22 处，但行号是 226…985；**命中数没变、位置全变了**，因为 engine.ts 长了 172 行）

$ grep -rn "repos\.\(...\)\.\(save\|append\|delete\)" src/ | grep -v '^src/core/engine.ts'
（无输出）

$ grep -rn "Repositories\|repos:" src/ --include=*.ts | grep -v "^src/core/engine.ts"
src/core/memory.ts:8,103,104    ← Memory **实现**这个端口（它就是一个仓库）
src/app/runtime.ts:381          ← repos: this.store, tx: this.store（把 Store 交给 Engine；上一版记的是 :316）
```

所以：**没有任何模块绕过 Engine 写领域状态**。持有 `Repositories` 的只有两方 —— 实现它的
（`Store`、`Memory`）与调用它的（`Engine`）；`Runtime` 只是把它递过去。
**第 33–46 轮加了 6 个新的 Engine 写方法**（`watchdogEscalated` `replyLost` `noticeLost` `triggerLost`
以及既有的 `watchdogActed` `ruleChainStopped`），它们**全部落在上面那 22 处命中里**，没有开辟新的写入面。
其中两个刻意走**窄端口**而不是把 Engine 交出去：`WatchdogHost.escalate`（`src/app/watchdog.ts:56`，
接线在 `src/app/runtime.ts:516`）与 `DeliveryHost.replyLost`（接线在 `src/app/runtime.ts:377`，
调用点 `src/app/delivery.ts:350`）——理由写在 `00:2079-2081`：**一个持有 Engine 的组件可以写任何领域状态，
而窄端口只允许它写这一件事**。`noticeLost` 那一半**刻意不走窄端口**（`runtime.ts:293` 直接调 Engine），
理由也写了（`00:2339-2341`）：Runtime 就是组合根，本来就持有 Engine，
**把同一条规则机械地套到不同层上只会多出没有作用的间接**。

四条必须一起说的限定，否则这条保证会被读得比它实际的强：

1. **`http.ts:595` 的 `host.prompts.save(request)` 不是领域写入。** 它写的是 `kv` 里的提示词覆写与修订号。
   `Store` 上另有一组非领域的写者，各自有单一写者，`src/app/store.ts:1-8` 的文件头注释把它们列全了：
   Source 写自己的游标（`kv`）、Settings/Prompts 写自己的修订号、Effects 写自己的行。
   本文核对了 `kv` 的写点：`Store.set`/`Store.delete`（`store.ts:716,721`）的调用者是
   `Prompts`（`prompts.ts:106-107`）、`Runtime` 的 `bindMainSession`（`runtime.ts:350`）、
   `Store.pushLostPayload`（`store.ts:748`，**第 44 轮新增**）、以及各 Source 的游标（`cron.ts:104,216` 等）
   —— 都不碰 8 张领域表。
2. **读路径有一处绕过 Engine。** `Runtime.artifacts()`（`src/app/runtime.ts:619`）直接
   `return this.store.artifacts.list(ticketId)`，而 Engine 上有一个同义的 `artifactsOf()`
   （`src/core/engine.ts:1116`）**零调用者、零测试**。写者唯一这条保证没有被破，
   但"面板读到的产物来自 Engine"这个说法是假的。
3. **`Engine.cascadeFrom` 是 `private`**（`src/core/engine.ts:1069`），有**三个**内部调用点
   （`:714` 的 `dropped`、`:842` 的 `failed`、`:1082` 的递归自身）。上一版记的是两个调用点、漏了递归那一个。
   级联因此不可能被外部触发，这是对的。
4. **`Delivery` 端口多了一个可选的 `send?`**（`src/core/engine.ts`，第 35 轮 A+B）。
   它是**可选**的，理由写在端口自己的注释里：一个来源全是单向（cron、inbox）的部署无处可发，
   而强制实现会被答以空方法——**"空方法是'已实现'的假象"**。注释还硬性要求
   **实现必须把发送排进效果队列而不是内联**，因为"内联意味着一次网络抖动就永久丢掉那句话，
   而'所有副作用有执行与失败记录'是本项目的一条硬规则"。`OutcomeDelivery` 照做了
   （`src/app/delivery.ts:305` 入队 `send`、`:243` 注册处理器、`:100` 的 `sendKey` 是内容的纯函数）。

---

## 2. `src/core/` —— 领域层（8 个文件，**2642 行**）

| 文件 | 行数 | 责任（一句话） | 公开面（别的模块用的） | 依赖 |
| --- | --- | --- | --- | --- |
| `src/core/model.ts` | **430** | 领域类型与"从 Ticket 自己的事实读出它状态"的谓词 | `SourceKindName`（**5 个成员**：cron/inbox/session/rule/**chat**）`Actor` **`ReplyTo`（第 35 轮新增）** `Trigger` `Disposition`（**5 个成员**，新增 `lost`）`Strength` `Project` `Work` `Dependency` `released` `TicketEventType`（**20 个成员**）`TicketEvent` `Artifact` `MandateVia`（**5 个成员**，含 `chat`）`Mandate` `ReportState` `Report` `AssignmentState` `Assignment` `Attachment` `Execution` `TicketOutcome` `TicketEnded` `Attention` `TicketResult` `TicketNote` `Ticket` `InputBy` `TicketInput` `DecisionOutcome` `Decision` `liveTicket` `latestAssignment` `runningAssignment` `latestReport` `undelivered` `waitsForPerson` `TicketStage` `ticketStage` `canRetry` | 无（零导入） |
| `src/core/ids.ts` | 23 | 确定性标识符：相同输入给相同 id，这是 intake 幂等的全部机制 | `key` `slug` | `node:crypto` |
| `src/core/errors.ts` | **53** | 固定拒绝措辞：一个人或一个代理能造成的拒绝，在哪儿冒出来都是同一句话 | `USER_ERRORS`（**19 个码**）`UserErrorCode` `UserError` | 无 |
| `src/core/timing.ts` | 233 | cron 来源的计时：五段 Vixie cron、daily、weekly、固定间隔，以及各自的下一次触发 | `Timing` `CronSpec` `ZoneParts` `localZone` `zoneParts` `localToUtc` `knownTimeZone` `parseTime` `parseCron` `nextRun` `nextCron` `describeTiming` | 无 |
| `src/core/policy.ts` | **482** | 策略：哪些设置关乎授权、确定性的门禁、以及每个 Mandate 记下的版本 | `ScheduleSchema` `SettingsSchema` `Settings` `Schedule` `parseSettings` `policyVersion` `GATE_REASONS`（8 个理由）`GateReason` `GateVerdict` `sourcePolicy` `gate` `Policy` `settingsPolicy` `PolicyEffect` `policyEffects` | `zod`、`./ids`、`./model`、`./timing` |
| `src/core/engine.ts` | **1219** | 领域入口，也是 Triggers/Decisions/Tickets/Assignments 的唯一写者 | 8 个仓库接口 + `Repositories` `Transaction` `Executor` `Delivery`（**含可选的 `send?`**）`DomainEvent` `EngineOptions` `ReceiveResult` **`LostTrigger`（第 44 轮新增）** `Engine`（**44 个公开方法**，实测）`artifactPath` `attachmentsOf` `ticketIdOf` **`payloadText`** **`lostTriggerOf`** | `./ids`、`./errors`、`./model`、`./policy` |
| `src/core/memory.ts` | 194 | Engine 的仓库与事务的内存实现，给领域测试用 | `Memory` | `./model`、`./engine` |
| `src/core/index.ts` | 8 | core 的出口 | 转出上面 6 个（`Memory` 单独点名转出） | — |

**这一层的形状**：`model.ts` 与 `errors.ts` 零导入，`timing.ts` 零导入，`ids.ts` 只导入 `node:crypto`。
依赖是单向的：`policy → {ids, model, timing}`，`engine → {ids, errors, model, policy}`，`memory → {model, engine}`。
没有环，也没有一个向上指向 `src/app/`——**P8 的契约层没有破坏它**（`ReplyTo` 定义在 `model.ts`、由 `kind.ts` 再导出，见 §1.1）。

**`Engine` 的公开方法：实测 44 个**（`grep` + 逐个排除 6 个 `private`：`addInput` `recordReport` `record`
`cascadeFrom` `createsCycle` `mutate`）。**上一版记的是"38 个公开方法、其中 33 个有生产调用者"，两个数都与代码不符**：
上一版自己列出的 (a) 组是 36 个、(b)+(c) 是 4 个，合计 40。本轮按当前树重新数，见 §2.6。

### 2.1 `src/core/model.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C01 | Ticket 的状态谓词与 `stage` 词表（`ticketStage`/`liveTicket`/`canRetry`/`waitsForPerson`/`latestReport`/`undelivered`/`runningAssignment`） | **真宿主验证** | `02b` §6.4：`item9-rule-ticket.json` 是 `stage: done`，`item9e-rule-ticket.json` 是 `stage: "running"`、`ended: null`（残件均在）。`02` §6：`item6-ticket.json` `stage: done`、`assignments: 2`。`01` §8 行「Ticket/Assignment/Report 生命周期」：5 张 Ticket 覆盖 `ready`×3、`waiting`×1、`failed`×2、`stopped`×1、`retried`×1，`pending/running/ended` 三种 Assignment 状态都见过。离线另有 `tests/views.spec.ts` 的 `names the stage a person reads, for every state a Ticket can be in` |
| C02 | `released(edge, upstream)`：`done` 与 `ended` 两种释放语义（上游 dropped/stopped/failed 而下游等 `done` 时，下游继续等） | **离线验证** | `tests/dependencies.spec.ts` 的 `releases on any ending when asked to, and only on success when asked for that`。**有生产调用者**（`src/core/engine.ts:929` 的 `blockedBy`、`src/core/engine.ts:941` 的级联），但**从未在真宿主上驱动过**：`02b` §6.3 复核全库 `type='ended'` 的事件 **0 条**，即那轮验收里没有发生过一次级联 |
| C03 | "部分成功"的释放策略（上游一半成功时下游怎么办） | **尚未实现** | `released()` 是导出的纯函数，`docs/v2/00-audit-and-plan.md` §4.8 的「未做」只说"将来只改这一处"，没有给出语义。没有任何设计 |
| C04 | `Strength = 'inferred'`（一个由推断而非明写产生的授权） | **仅有设计** | 类型在 `src/core/model.ts:79-80`，注释写着"`inferred` waits for the assessment layer"；`src/core/policy.ts:445-446` 标好了它的规则该放哪儿（"It arrives with a chat Source, and this is where its rule goes"）。**没有代码**：`gate()` 的三条返回全部写 `strength: 'explicit'`（`policy.ts:385,403,404`）。设计在 `docs/v2/00-audit-and-plan.md` §3 D7 第 4 步与 §4.14/§4.15 的「未做」。**⚠ 那条注释现在是过期的，而且过期得很要紧**：聊天来源已经在第 36 轮落地，而 P8 的第一条裁定恰恰是**身份必须被映射、不能被推断**（`src/sources/chat.ts:30` 的小节标题逐字是 "## Identity is mapped, never inferred (contract §2 — the reason P8 exists)"）。所以 `inferred` **不会**随聊天来源到来——见 §9 第 18 条 |
| C05 | `TicketEventType`：**21 种**里有 **18 种**有写入点（第 50 轮新增 `resumed`，有写入点；`turn_ended` 的 detail 现在带 `reason` 与 `error`）（`created` `launched` `report` `turn_ended` `input` `retried` `interrupted` `stopped` `failed` `ended` `classified` `dependency` `rescued` `rule_stopped` **`escalated`** **`reply_lost`** **`notice_lost`**） | **真宿主验证** | `02` §4 的三条真实序列（`created→launched→report`、`created→rescued→launched→report`、`created→launched→report→retried→launched→report`）；`02b` §6.3 复核 71 条事件覆盖 20 张 Ticket，且 `group by ticketId having min(seq)!=1` 返回 **0 行**。`ended` 只有级联路径写（`src/core/engine.ts:1078`），线上 0 条（`02b` §6.3）—— 这一种的证据是离线的：`tests/engine.spec.ts:719` `it('ends what waited on a Ticket that failed, and says which one it waited on')`。**本轮核对**（`grep -rn "this\.record(" src/` → 22 处命中，覆盖 17 个类型）：上一版记的是"17 种里 14 种有写入点"，第 34/36/40 轮各加了一种（`escalated` `reply_lost` `notice_lost`），而 `rule_stopped` 在上一版成文时**已经**有写入点（第 24 轮 N5），所以 14 这个数当时就少算了一种 |
| C06 | `TicketEventType` 里剩下的 **3 种**：`delivered`、`delivery_failed`、`session_bound` | **仅有设计** | 三个类型在 `src/core/model.ts:130-133` 声明了，**全仓零写入点**（本轮复核 `grep -rn "this\.record(" src/` 的 17 个类型里没有它们）。核对：`inputsDelivered`（`engine.ts:532`）、`deliveryFailed`（`:546`）、`bindSession`（`:861`）三个方法都只 `mutate` Ticket 行、都不 `record(...)`。所以"输入到了"、"投递失败了"、"DSH 回了另一个 Session id"这三件事**不在日志里**，只在被 `mutate` 反复重写的行里。**上一版 §13 增补说的"仍然从不写入的是这三个"本轮复核成立** |
| C222 | **`ReplyTo`：一个 Trigger 携带的回路地址**（第 35 轮 A+B，P8 契约 §3.1） | **真宿主验证** | 类型在 `src/core/model.ts:21-33`：`kind`（能投递到这里的 Source 种类）+ `channel`（那个 Source 自己词汇里的位置——频道 id、会话 id、目录名）+ 可选 `thread`。**core 只存不解释**，注释写明了为什么："`channel` and `thread` belong to the Source's own vocabulary, exactly as `Trigger.meta` does. What the core does fix is that a reply is routed by `kind`"。真宿主证据：`docs/v2/16-live-acceptance-chat.md` 场景 1【实测】`replyTo={chat, room-a, t-acc-1}` 活过了受理，回复文件出现在 `room-a/out/`；场景 3【实测】那张**无 `replyTo`** 的 inbox Ticket 的响应里 `replyTo` 出现 **0 次**（键不存在，不是 null），而 chat Ticket `has("replyTo")=true`。离线：`tests/chat-contract.spec.ts:260` `it('survives intake, so the Ticket a chat request made can still be answered')`、`:272` `it('leaves the address off a Trigger whose Source has no way back, rather than inferring one from the actor')` |
| C223 | **`Disposition` 的第五个成员 `lost`：一个被队列放弃的请求**（第 44 轮） | **离线验证** | 类型在 `src/core/model.ts:60-77`，带一段很长的注释说明它为什么**不带 `decisionId`**（"the absence is the fact rather than an omission — a Decision is a gate verdict, and writing one here would put a verdict that never happened into the audit record"）以及为什么**不算重复**（"`receive` runs the gate again on a Trigger whose row says `lost`, because 'already handled' is the opposite of what the row says"）。写入点 `Engine.triggerLost`（`src/core/engine.ts:1012`），消费者 `runtime.ts:325`。**没有 schema 迁移**：`lost` 是 TEXT 的 `disposition` 列里的一个 JSON 状态（`00:2673-2674`，`SCHEMA_VERSION` 仍是 5）。离线：`tests/fault-injection.spec.ts:241` `it('stores a given-up trigger as a lost row with the error and the effect key, and no Decision, which a restart keeps and the next quiet pass does not touch')`、`:402` `it('receives a lost Trigger again instead of answering that it was already handled')`、`tests/engine.spec.ts:96`、`:117`。**日常宿主上此前不可达、本轮重载后可达但未被驱动**（§0.3：已加载 bundle 早于第 44 轮） |

### 2.2 `src/core/ids.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C07 | `key()`：确定性 id，使 intake 幂等（重启后观测到同一个事件不会造出第二张 Ticket） | **真宿主验证** | `02` §8：deny/pause 期间"再投一个字节相同的文件会撞上重复短路、被再次归档为拒绝并带着旧理由"——这是线上观测到的去重。`02b` §4.5：挂载时补触发一个**迟到约 3 小时**的 cron 槽位，只造出**一张** Ticket（`7d81aadc33c8e67ec5a9fb2d12f3808f`，残件 `cron-ticket.json`）。`02b` §2：三条负面路径的 Trigger id 与 Decision 的 `triggerId` 一一对应 |
| C08 | `slug()`：Ticket 目录名的可读前缀 | **真宿主验证** | `01` §8 行「worker 启动 + 每 Ticket 一个目录」：5 个 `<slug>-<id[:8]>` 目录。`00` §1 同一行记的是 8 个 |

### 2.3 `src/core/errors.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C09 | `UserError` → HTTP 400（`*_missing` → 404），且**服务端原文直达面板 toast** | **真宿主验证** | `01` §8 行「同源围栏 + 路径穿越防护」：六种 `file` 路由坏输入当场得到 400/400/400/404/400/404。`02b` §5 末条【转录】：对已 `done` 的 Ticket 调 stop 得到 `http=400`（`stop_refused`）。面板侧：`tests/panel.spec.ts` 的 `surfaces the cycle refusal in the server's own words` |
| C10 | `assignment_stale` 被**真的抛出**（一个活过自己尝试的迟到 turn 被拒） | **离线验证** | `tests/engine.spec.ts` 的 `refuses a late report from a replaced attempt while another attempt is running`（`00` §4.10 记它经变异检验）。**真宿主上从未驱动过**，`02b` §1 说得比 `02` §6 准：不是"证据已丢失"，是**从未尝试** —— `retryTicket` 先结束旧尝试再开新尝试，新尝试顺序恢复同一个 Session（`item6-worker.jsonl` 的 turn 号是 `[1, 2]`，从不并发），所以旧 turn 没有机会在新尝试运行期间汇报 |
| C11 | `artifact_missing` 与 `artifact_unreachable` 分开（两个原因、两种补救） | **离线验证** | `src/core/errors.ts:18-22`（含解释为什么要分开的注释）。测试：`tests/executor.spec.ts` 的 `hands back the registered file's text, and refuses one nobody claimed`。**第 25 轮的产物，不在 3080 已加载的 bundle 里**（§0.3），所以连旧代码的线上证据都不可能有 |
| C12 | 错误码表覆盖全部拒绝路径 | **部分实现** | 本轮实测 **19 个码**（`grep -cE "^  [a-z_]+: '" src/core/errors.ts` → 19），其中 **18 个有抛出点**（逐个 `grep -rn "'<码>'" src/` 核过）。缺的那一个仍然是 `input_missing`：`src/core/errors.ts:12` 声明了，**全仓零抛出点**、测试里也零命中（第 32 轮与本轮各复核过一次，**未修**）。**上一版记的那处"用错了码"已修**：`dismiss` 现在抛第 31 轮新增的 `decision_missing`（`src/core/errors.ts:23`，抛出点 `src/core/engine.ts:512`）。**一处对不上的数字**：上一版记"20 个码里 19 个有抛出点"，而第 31 轮**加了**一个（`00` §4.26），码数应当只增不减，现在却是 19 —— **差额（少了哪两个）未核实**：核实它需要读第 31 轮之前的 `errors.ts`，而本项目目录**不是 git 仓库**（`git log` → "不是 git 仓库"，`.git` 不存在），没有历史可查 |
| C224 | **`reply_unroutable` 与 `reply_unreceivable` 两个码分开**（第 36 轮裁定 2 与 §4.34 (iv)） | **离线验证** | 两个码各**一个**抛出点、各一句准确的话：`reply_unroutable`（`errors.ts:32`，抛在 `src/sources/chat.ts:450`）说的是**地址写下来过、而那个频道已消失或被停用**；`reply_unreceivable`（`errors.ts:36`，抛在 `src/app/delivery.ts:323`）说的是**地址没问题、而没有那个种类的 Source 在运行**。`errors.ts:24-35` 的注释逐字记了这次改词的理由：**"An error message that misdescribes its own cause sends whoever reads it looking in the wrong place"**，并承认原文（"No Source of that kind is running to take a reply back"）描述的是**另一种**情形。离线：`tests/chat-send.spec.ts:502` `it('says "nothing can carry this" and "the channel is gone" in two different codes')`、`tests/chat.spec.ts:361` `it('refuses a reply whose channel is gone or switched off, with the code that names exactly that')`。**改词本身没有变异检验**（措辞无法被断言钉住，见 `docs/v2/11-test-report.md` §4.3）；两个码都已在当前 bundle 里（`reply_unreceivable` 在产物中出现 2 次，§0.2），**日常宿主上此前不可达、本轮 01:40:15 重载后可达但未被驱动**（§0.3 第 1、2 条） |

### 2.4 `src/core/timing.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C13 | cron 解析与 `nextRun`（含改时刻后重算 next） | **真宿主验证** | `01` §6 与 §8：step2 `next 1793718660000 → 1793720700000`，Source 与 preview 一致；step3 是反例（只改名不重算）。`01` §8 因此把这一行从 `offline` **升为 `live`**。`02b` §4.5：跑完之后重新武装到 `next = 1793807100000`（= 本地 11-04 23:45） |
| C14 | cron 规则指纹持久化（游标里的 `spec` 字段） | **真宿主验证** | `01` §6：游标 `spec` 三次读值，随时刻改变、不随名字改变。`02b` §4.6：隔离库 `kv` 的键里有 `source:cron:cursor` |
| C15 | 时区规则：不存在的本地时刻（春季前跳）跳过；重复的本地时刻（秋季回退）只触发一次、取较早的那个 | **离线验证** | `tests/timing.spec.ts` 的 `skips a local time that does not exist in the zone` 与 `fires once, at the earlier instant, when a local time occurs twice`。注释写明这是**对齐 DSH 自己的排期器**的语义。线上从未驱动过（要造这两件事需要宿主跨过一次夏令时切换） |
| C16 | 超出 400 天地平线的排期不再每分钟造一张 Ticket（S19） | **离线验证** | `tests/sources.spec.ts` 的 `fires the real slot once and then stops, instead of minting a Ticket a minute`。`01` §10 明说 cron 到点触发本身在那轮**没验**（排期定在 23:11/23:45，验收窗口 18:00–18:55，宿主已停） |
| C17 | `describeTiming`：每种计时一行话 | **离线验证** | `tests/timing.spec.ts` 的 `words each kind in one line`。它经 `GET /api/schedules` 的 `describe` 字段上面板，`01` §8 行「操作者动词」里 `PUT settings` 与排期预览都命中过，但 `describe` 的具体措辞没有逐字核对 —— 那部分**未核实**，核实它需要在线上读一次 `GET /api/schedules` 并与四种 timing 逐个对照 |

### 2.5 `src/core/policy.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C18 | 门禁 `gate()`：`(Trigger, Settings)` 的纯函数，8 个固定理由 | **真宿主验证** | `02b` §2 的表：三条负面路径的 Decision 全文都在残件 `item9-negatives.json` 里，`outcome` 全是 `ignore`，`reason` 分别是 `system_actor` / `sender_not_allowed` / `source_disabled`，`detail` 逐字给出。`02` §8：deny/pause 两个场景零 Trigger、零 Decision、文件原地不动。离线另有 `tests/policy.spec.ts` 的 `is a pure function: the same input gives the same verdict, and the Trigger is not changed` 与 `reaches every one of its fixed reasons, so a refusal always has a wording` |
| C19 | 按来源策略 `sourcePolicy(kind, settings)`：来源自己设了用自己的，没设回落全局 | **真宿主验证** | `02` §8 表（A：`sources.inbox.deny`，B：`sources.inbox.paused`，各自零 Trigger 零 Decision、解除后被受理）；`02b` §6.6 复核归档文件确实在 `accepted/` 里。离线：`tests/policy.spec.ts` 的 `observes what its own mode names, independently of every other Source`、`honours its own sender list, and falls back to the global one when it has none` |
| C20 | `deny` 与 `enabled: false` 是两件事（前者照读不产出，后者停止读取） | **真宿主验证** | `02b` §2 第三条：`sources.rule.deny=true` 时 detail 是 `The rule Source is denied`（**点名 rule**）。`02` §9 与 `02b` §6.4：`sources.session.enabled=false` 时规则 Trigger 仍被**受理**（Decision `outcome:accept, reason:accepted`），即 Defect B 的修复线上得证。离线：`tests/policy.spec.ts` 的 `refuses at the gate and says it was denied, which is a different fact from being switched off`、`reads the rule Source's own enabled flag rather than the session one` |
| C21 | `deny` 不推迟**已受理**的工作（这是它与 `paused` 的区别） | **真宿主验证** | `02` §8 C：残件 `item8c-second.json` + summary 里的 `deny_at=03:05:32.058`、`second_startedAt=19:06:04.530Z`、`second_stage=done`。离线：`tests/executor.spec.ts` 的 `does not hold back an accepted Ticket, which is what separates a denial from a pause` |
| C22 | `allowSystemActors` 的两道关（开关 + 名单点名），缺一不可 | **真宿主验证** | `02b` §2 的第一、二行：`allowSystemActors=false` → `system_actor`；规则 id 不在 `allowedSenders` → `sender_not_allowed`（detail `digest-done is not on the allowed list`）。离线：`tests/policy.spec.ts` 的 `admits a system actor only for a Source that was told it may originate work nobody wrote` |
| C23 | `policyVersion` / `authorizationShape`：每个授权旋钮都推动版本，`paused` 不推动 | **真宿主验证** | `02` §9 与残件 `item9-policyversions.json`：五个 rule 旋钮产生五个**不同**的版本（`6aac6b1a798c3244` / `31d02a8c4bdc2d70` / `445e3195efe98a29` / `853334daaa1494d5` / `27712f5bc29a5463`），修复前五个全是 `29663dc7df4b8496`（`02b` §4.2）。离线：`tests/policy.spec.ts` 的 `moves the policy version for a Source's mode, and never for its pause`、`moves the policy version for every rule knob, exactly as it does for the other Sources`。**第 35 轮补上了它此前的一个洞：停用 `rule`/`chat` 曾经不移动版本（见 C226）** |
| C24 | `policyVersion` 的**设置级出口**（N6 的修复：`stateView` 带这个字段） | **离线验证** | `tests/http.spec.ts:479` 的 `is exposed, and moves when a Source's authorization changes`。`src/app/http.ts:284` 有它，注释说明了为什么（否则只能靠造探针 Ticket）。**为什么不标真宿主验证**：这是第 24 轮的修复，**它在 3080 已加载的 bundle 里**（§0.3 的下界是第 31 轮），而 §0.3 的只读复核确实在 3080 上读到了 `policyVersion: 275ea61ded276e15` —— 但那次复核不在操作者规定的证据清单里，按 §0.3 第 3 条规则**不能用来升级标签** |
| C25 | `revalidate` 对 `inferred` 强度的规则 | **仅有设计** | `src/core/policy.ts:441-449`：`revalidate` 只有一条 `sender_not_allowed` 规则，随后是注释 "`inferred` strength does not occur in v1 … It arrives with a chat Source, and this is where its rule goes"。设计在 `docs/v2/00-audit-and-plan.md` §3 D7 第 4 步，§4.14 与 §4.15 的「未做」都重复了它。**⚠ 这条注释现在过期了，而且过期得很要紧**：聊天来源已在第 36 轮落地，而 P8 的第一条裁定恰恰是**身份必须被映射、不能被推断**（`src/sources/chat.ts:30` 的小节标题逐字是 "## Identity is mapped, never inferred"），所以 `inferred` **并没有**随它到来 —— 见 §9 第 18 条 |
| C225 | **`sources.chat` 设置块**（第 35 轮 A+B，P8 契约 §3.2）：`enabled` 默认 **false**、共享 `SourcePolicyFields`、`identities`（平台 id → `{actor 必填/trim/≤120, note? ≤500}`，`.prefault({})`）、`channels`（`id` 小写连字符 ≤40 = `replyTo.channel` 携带的值**也是**游标键；`directory` **必填** ≤4096；`enabled` 默认 true；最多 20 个、`.prefault([])`、重复 id 被拒）、`pollMs` 1000..600000 默认 5000，整块 `.strict().prefault({})` | **真宿主验证** | 实现在 `src/core/policy.ts:168-215`。真宿主证据：`docs/v2/16-live-acceptance-chat.md` 场景 1【实测】一份含 `sources.chat`（1 个频道 `room-a`、1 条映射）的设置文档被宿主解析、`PUT` 成功、Source 起来并产出了 Trigger；场景 2【实测】那次只改 `identities` 一个字段的 PUT 也成功（残件 `settings-01…04.json`、`put-settings-01…04.json`）。离线：`tests/chat-contract.spec.ts:195` `it('parses with no sources.chat key at all, and gets a chat block that is off with nothing mapped')`、`:205` `it('parses an empty document, which is how a deployment with no settings at all starts')`、`:209` `it('refuses a chat field nobody reads, so a typo cannot pass for a configuration')`、`:217` `it('refuses a channel with no place to read, and two channels that share an id')`、`:231` `it('accepts a channel id that can be a cursor key and a reply address')`。**版本中性这条规矩的理由**写在 `00:1928-1929`：一个新必填字段会让一份已存盘的设置文档解析失败 → Runtime 构造抛错 → `apply` 记一行就返回 → **插件静默什么都不做**。**`directory` 为什么必填而不是默认**也写在 schema 注释里（`policy.ts:196-199`）：空值会对每个频道都解析成部署默认目录，于是**几个频道静默读同一个地方**——"一个看起来配好了、却永远收不到东西的频道" |
| C226 | **`identities` 与派生的 `enabled` 进 `authorizationShape`**（第 35 轮，修的是**第四处** `enabled` 缺口） | **离线验证** | `src/core/policy.ts:186-217`：`perSource` 是**从 `sourceKinds(settings)` 派生**的，每个条目带 `acceptMode` / `deny` / `allowSystemActors` / **`enabled`（`settings.sources[kind].enabled`）** / `allowedSenders` / **`identities`（`identityShape(kind, settings)`）**。代码里的注释逐字记了它修的是什么：**"cron/inbox/session each hard-coded their own `enabled` handling, and the kinds added later appeared only here — so disabling the rule Source (and then chat) never moved `policyVersion`, while the comment below claimed every disabled Source was covered."** 以及那句规律：**"a list of kinds is a list of things to forget"**（= 纪律 §0.10）。`identities` 进版本哈希的理由也在注释里：**"Who this Source asserts its events came from is part of who may originate work"**——收紧一张映射表必须能到达它已受理的 Ticket，正如收窄一份 sender 名单。离线：`tests/chat-contract.spec.ts:122` `it('moves the policy version when a platform id starts speaking as another actor')`、`:134` `it('does not move the policy version for a note, which documents the map and authorizes nothing')`、`:139` `it('does not care what order the identities were written in')`、`:413` `it.each(['rule','chat','session','inbox','cron'])('moves policyVersion when %s is toggled')`。**经变异检验**：移除那行 `enabled` → **五条全红**（`00:1978`；`docs/v2/11-test-report.md` §4.2 第 15 条，并记了第一版测试为什么写错——对每个 kind 硬设 `false`，而 `chat` 默认就是 `false`，于是"停用 chat"是空操作、断言以"修复无效"的样子失败）。**真宿主侧只有一半**：`docs/v2/16-…` 场景 2【实测】改 `identities` 使 `policyVersion` 由 `ad064036…` → `0bafb839…`；**停用 rule/chat 移动版本那一半从未在真宿主驱动过**，所以整条标 离线验证 而不是 真宿主验证 |
| C26 | `policyEffects`：一次设置变更波及哪些在跑的 Ticket，用门禁自己的措辞告知 | **离线验证** | `tests/policy.spec.ts` 的 `holds while the sender is still allowed, and says why once they are not`、`keeps a Mandate holding while processing is paused, because a pause holds execution rather than withdrawing it`、`bears only on Tickets that are still open`、`says nothing when the version did not move…`；`tests/notify.spec.ts` 的 `tells the front desk in the gate's own words`。生产调用者是 `src/app/runtime.ts:483`。线上从未驱动过（要在真宿主上改一个授权旋钮并观测到一张在跑的 Ticket 被告知） |
| C27 | 设置文档的**版本中性**：`.strict()` + 每个新块 `prefault({})`，所以旧文档照常解析 | **真宿主验证** | `02` §9 与 `02b` §4.2：五个 rule 旋钮在线上各自生效，前提是含 `sources.rule` 块的设置文档能被宿主解析；`02b` §4.6 列出线上 `kv` 里 `settings:document` 一直在。这条规矩的理由写在 `docs/v2/00-audit-and-plan.md` §4.12（一个新必填字段会让插件**静默什么都不做**）。离线：`tests/policy.spec.ts` 的 `accepts an empty document, which is how a fresh deployment starts`、`refuses an unknown field rather than keeping a setting nobody reads` |
| C28 | 预算旋钮（token / 墙钟 / 尝试次数的上限与超限处置） | **尚未实现** | `grep -rni "budget\|ceiling\|quota\|maxTokens\|tokenLimit\|costLimit" src/` 只有 5 处命中，**全部是注释或字节上限**（`engine.ts:835` 说重试预算、`runtime.ts:47,109,382` 说字节上限、`effects.ts:117` 说重试预算）。`SettingsSchema`（`src/core/policy.ts:80-176`）里没有任何预算块。`docs/v2/06-security-risk-register.md` §2 的表里这一行写的是「**不存在**」 |

### 2.6 `src/core/engine.ts` 的能力

`Engine` 有 **44 个公开方法**（实测：`grep` 出所有 `^  <name>(` 再排除 6 个 `private`——
`addInput` `recordReport` `record` `cascadeFrom` `createsCycle` `mutate`）。
本文逐个核对了它们在 `src/` 里的生产调用者
（`grep -rlE "engine\.<方法>\(" src/ | grep -v '^src/core/engine.ts'`），结果分三组。

**（a）有生产调用者的 40 个**（调用者在括号里）：
`receive`（runtime/inbox/**chat**/cron）、`createTicket`（http/tools）、`note`（http/tools）、`answer`（http/tools）、
`noteFromWorker`（tools）、`stopTicket`（http/tools）、`retryTicket`（http/tools）、`dismiss`（http）、
`assignmentStarted`（executor）、`inputsDelivered`（executor）、`deliveryFailed`（executor）、`turnEnded`（runtime）、
`createProject`（http）、`createWork`（http）、`attachWork`（http）、`projects`（http）、`works`（http）、
`project`（executor/http）、`work`（executor/http）、`ticketsOfWork`（http）、`report`（runtime/tools）、
`reportGaveUp`（executor）、`assignmentInterrupted`（runtime）、`policyChanged`（runtime）、`require`（http/tools）、
`bindSession`（runtime）、`decisionOf`（http/tools/inbox/**chat**）、`dependOn`（http）、`dropDependency`（http）、
`authorizeArtifactRead`（runtime）、`ticket`（executor）、`watchdogActed`（runtime）、`ruleChainStopped`（rule）、
`dependantsOf`（executor/http）、`blockedBy`（executor/http）、`history`（http/runtime），
以及第 34/36/40/44 轮新增的四个：`watchdogEscalated`（runtime:516）、`replyLost`（runtime:377 → delivery:350）、
`noticeLost`（runtime:293）、`triggerLost`（runtime:325）。

**（b）零生产调用者、但有测试的 1 个**：`failTicket`（`src/core/engine.ts:834`）—— 只有 `tests/engine.spec.ts` 的 4 处。

**（c）零生产调用者、零测试的 3 个**：`trigger`（`:820`）、`dispositionOf`（`:872`）、`artifactsOf`（`:1116`）。
本轮复核 `grep -rn "\.artifactsOf(\|\.dispositionOf(\|engine\.trigger(" src/ tests/` → **0 命中**，与上一版一致。
按 §0.1 规则 2 与 `00` §4.25 的裁定，这三条标 **部分实现（未接入）**。

> **上一版这一段的两处更正，本轮仍然成立，而且更要紧。**
> 其一，`docs/v2/02-live-acceptance-v2.md` §3 与 §5 说 `createProject`、`createWork`、`attachWork`、`dependOn`、
> `blockedBy`、级联取消在 `src/` 里**零调用者**、"线上不可达"。那对产物 `f6b29adc` 是对的，**对当前源码是错的**：
> 第 21 轮（`00` §4.16）已经补上了 HTTP 入口。准确的现状是**有调用者、但从未在真宿主上被驱动过**——
> 这两件事差得很远：前者是"操作者碰不到"，后者是"操作者碰得到、但没人碰过"。
> **本轮把后半句也量到了**：§0.3 的只读复核里 3080 的 `projects`/`works` 都是空集合、`counts.ended` 是 9，
> 即那 9 张已结束的 Ticket **没有一张属于任何 Work**；第 33 轮与第 38 轮两次隔离验收也都没有驱动它们。
> 其二，上一版说"`Engine` 有 38 个公开方法、其中 33 个有生产调用者"——**两个数都与代码不符**：
> 它自己列出的 (a) 组是 36 个、(b)+(c) 是 4 个，合计 40；本轮实测 44 个公开方法、40 个有调用者。

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C29 | 受理：Trigger → 门禁 → Mandate → Ticket + 第一个 Assignment，全在一个事务里 | **真宿主验证** | `01` §1 与 §8（5 张完整 Ticket）；`02` §2（残件 `item2-ticket.json`，Ticket `714e759a423ea81e8ae051faf61289e6`）；`02` §9（规则来源产出的 `d9493df4` 跑到 `stage: done`，`via="rule"`、`sender="digest-done"`） |
| C30 | 重复 Trigger 幂等（同一个 Trigger 来两次只有一张 Ticket） | **真宿主验证** | `02` §8：字节相同的文件撞上重复短路。`02b` §2：三条负面路径的 `decision.triggerId` 与 Trigger id 一一对应。离线：`tests/engine.spec.ts` 的 `creates one Ticket when the same Trigger arrives twice`、`derives the same Ticket id from the same Trigger id, so a restart cannot fork the work`。**注意 `00` §6 那条反直觉的记录**：`tests/tools.spec.ts` 的"同一请求来两次只开一张 Ticket"只因为 harness 把时钟钉成常量，生产里 Trigger id 含 `at = now()` |
| C31 | 受理时按 `trigger.meta.work` 当场归类（第 22 轮） | **离线验证** | `tests/engine.spec.ts` 的 `classifies the Ticket as it is created, taking the next place in that Work` 与 `records a Work that does not exist instead of quietly filing the Ticket nowhere`（`missing: true` 那半）。生产调用者在 `receive` 内部（`src/core/engine.ts:241-244`）。从未在真宿主驱动过 —— §0.3 的只读复核里 3080 的 `projects`/`works` 都是空集合，即这条链在线上**一次都没走过** |
| C32 | Project / Work 命令（`createProject` `createWork` `attachWork` `projects` `works` `project` `work` `ticketsOfWork`） | **离线验证** | `tests/engine.spec.ts` 的 `numbers Tickets by the order they joined the Work, not by the order they were created`、`attaching the same Work twice is not a second place in line`、`refuses a Work or a Project that does not exist, rather than classifying into nothing`、`classifies an ended Ticket too, because putting past work where it belongs is bookkeeping`、`groups Works under a Project, and can ask for the ones in no Project`、`leaves no Project, Work or classification behind when the transaction rolls back`；路由层 `tests/http.spec.ts` 的 `creates, lists and reads them back, with a Project's Works and a Work's Tickets`。**有调用者**（`http.ts:244,245,249,252,256,260`；`executor.ts:347,348`），**从未在真宿主驱动过** |
| C33 | 依赖边与环检测（`dependOn` `dropDependency` `blockedBy` `dependantsOf`，环检测与写边在同一个事务里、沿"等待"方向走） | **离线验证** | `tests/dependencies.spec.ts` 5 条（`does not launch until the one it waits for has finished, and the wait costs it nothing`、`releases on any ending when asked to…`、`refuses an edge that would make a Ticket wait for itself, and writes nothing`、`leaves no edge behind when the transaction that wrote it rolls back`、`records the wait in the Ticket's history…`）+ `tests/engine.spec.ts` 的环检测 + `tests/http.spec.ts` 的 `records an edge, shows what is still unsatisfied, and undoes it`、`answers 404 for a Project nobody made, and 400 for an edge that would be a cycle`。**有调用者**（`http.ts:270,278,285`；`executor.ts:137,227`），**从未在真宿主驱动过** |
| C34 | 级联取消（`private cascadeFrom`：上游 `failed`/`dropped` 时把等它成功的下游一并结束，递归走完链；停止不级联） | **离线验证** | `tests/engine.spec.ts` 的 `ends what waited on a Ticket that failed, and says which one it waited on`、`keeps the difference between "it failed" and "there was nothing to do"`、`does not cascade a stop: what follows a person's decision is that person's decision`、`walks the whole chain, because a broken link breaks everything after it`、`lets a dependant that only needed the upstream to finish run anyway`（`00` §4.8 记它经变异检验）。**线上从未发生过一次**：`02b` §6.3 复核全库 `type='ended'` 的事件 **0 条** |
| C35 | 报告：`ready` / `dropped` / `waiting` / `failed` 四种 state | **真宿主验证** | `01` §8 行「Ticket/Assignment/Report 生命周期」：`ready`×3、`waiting`×1、`failed`×2（gave-up + blocked-turn）、`stopped`×1、`retried`×1。`02` §6：残件 `item6-ticket.json` 里两个尝试各自保有自己的报告（`0b1956c4…` `report:"waiting"`、`b307a501…` `report:"ready"`） |
| C36 | 报告：`progress` state，以及 worker **主动**调 `myagent_report(state=blocked)` 触发 relay（唤醒前台） | **离线验证** | `tests/tools.spec.ts` 的 `records progress without changing what the Ticket is`、`keeps a Ticket open on blocked, with the question a person has to answer`；`tests/flow.spec.ts` 的 `brings a blocked question to the front desk, and an answer back to the same worker`。**两轮验收都没能驱动它**：`01` §10 说 `blocked` Report 与 relay 需要 worker 自己调那个工具，而当时 B4 会让这条路径必然回一个工具错误（"先修 B4 再验这一条"）；B4 在 `02` §6 得证已修，但**修完之后没有人回去验这一条**。`01` §8 明说 5 条主 Session 消息全是 `form=notice`，**没有一条 `relay`，也没有一次 `turn/start`** |
| C37 | 按尝试的报告身份：身份在 **launch 时**记下，`report(ticketId, report, assignmentId?)` 只落在那一个尝试上 | **部分实现** | **得证的一半（真宿主验证）**：`02b` §1【残件】`item6-ticket.json` 里两个尝试各自保有自己的报告，"报告没有串到别的尝试上"。**未得证的一半（离线验证）**："迟到报告被拒"即 `assignment_stale` 被抛出，见 C10 —— `02b` §1 的措辞是**本轮未驱动**，不是证据丢失 |
| C38 | 产物登记：worker 自报路径归一化后入表，越界路径不静默丢弃而是写进 Ticket 的 notes | **真宿主验证** | `02` §2：残件 `item2-ticket.json`，worker 报了 `report.md`、`./report.md`、`../escape`；登记表里**只有一条** `report.md`，越界那条不在表里但在 notes 里、带着确切拒绝措辞。`02b` §6.9 复核：全库 **11 条产物覆盖 11 张 Ticket**。`02b` §4.5 给了第二个线上样本（`cron-result.txt`）。离线：`tests/engine.spec.ts` 的 `registers the files a report claims, under one spelling per file`、`refuses a path outside the Ticket directory, and says so on the Ticket instead of dropping it silently`、`registers files from a progress report too…` |
| C39 | 事件日志：`seq` 是每张 Ticket 自己的、从 1 起；`by` 给决定者署名；写入点在造成该事实的那个事务内 | **真宿主验证** | `02` §4 的三条序列（含 `by.id = digest-done`，即"规则 id 就是 actor"）；`02b` §6.3：71 条事件覆盖 20 张 Ticket，`min(seq)!=1` 全库返回 **0 行**（即"每张 Ticket 的 seq 都从 1 开始"**全库成立**，不只是三条样本）；`02` §7 的 `rescued` 行带 `by={kind:system,id:watchdog}`。离线：`tests/engine.spec.ts` 的 `holds every transition in the order it happened, with who caused it`、`records nothing for a command whose transaction rolled back` |
| C40 | 协作通道 `noteFromWorker`：门禁是共享谓词 `canCollaborate`（同一 Work，**或两张都未归入任何 Work**），交接是目标 Ticket 上的一条 Input，两侧都进日志 | **离线验证** | `tests/engine.spec.ts` 的 `arrives as an Input that says which Ticket's worker wrote it, and is logged on both sides`、`refuses across distinct Works and self-notes, while allowing two unclassified Tickets to collaborate symmetrically (F2)`（**旧名 `refuses across Works, and refuses Tickets that belong to no Work at all` 已在 F2 改名，本行是那次改名留下的悬空引用的修正**）、`refuses a Ticket that has ended, because there is nobody left to read it`、`hands the fact to the other worker when it is running, and holds it for the next launch when it is not`；工具层 `tests/tools.spec.ts`。**门禁放宽是刻意的**：两张都未归组的任务可互通，为的是让后一个任务复用前一个的成果而不必让人当搬运工；代价是"未归组"不是隔离而是开放，要隔离就归入一个 Work（`SECURITY.md` §4 有对使用者说的话）。**有调用者**（`src/app/tools.ts:143`，注册在 worker 作用域）。**必须更正 `02b` §7.4 的理由**：它说这条"线上根本没法驱动，因为 `attachWork` 零调用者"—— `attachWork` 现在有路由了（`http.ts:260`），所以准确的现状是**线上可达、但从未驱动过**（需要两张同属一个 Work 的 Ticket 同时在跑） |
| C41 | 产物引用的**授权**半边：`authorizeArtifactRead`（门禁同 C40 的 `canCollaborate` + 只读**已登记**的路径）。**它是纯的：不写任何东西**，所以预检可以自由调用；血缘由 `recordArtifactRead` 在**真的读到之后**写两侧各一条 `artifact_read`（按 (source,target,path) 去重） | **离线验证** | `tests/engine.spec.ts` 的 `authorizes a registered artifact of a Ticket in the same Work, and says where it is`、`refuses across Works, which is the only boundary a worker cannot argue with`、`refuses a file that was never registered, even inside the same Work and the same directory`（那条 `secrets.env` 反例）、`refuses to read its own artifacts through this door, because it can already read its own directory`。**第 25 轮的产物，不在 3080 已加载的 bundle 里**（§0.3） |
| C42 | `failTicket`：由系统结束一张 Ticket（目录不可信时用） | **部分实现（未接入）** | 实现完整（`src/core/engine.ts:834`）、语义明确。**已接入前的一半（离线验证）**：`tests/engine.spec.ts` 的 4 处调用（其中两处是级联测试用它制造一个 failed 结束）。**未接入的那一半**：`src/` 里**零生产调用者**（本轮复核 `grep -rlE "engine\.failTicket\(" src/` → 0 命中）。`00` §4.9 明说它当时没有生产调用者，并预测“它的生产调用者是 P4 的 Watchdog（超时、Session 消失、预算耗尽）”。**那个预测没有成真**：Watchdog 在第 15/16 轮落地，用的是 `rescueStuckLaunch` 与 `assignmentInterrupted`；第 34 轮给它加了第三个动作 `escalate`（C227），**仍然不是** `failTicket`。`00` §4.27 把“给‘已实现但零调用者’收尾”列为下一轮候选第 3 项，并写明“**它预定的调用者（P4 的预算/超时）已经过去 14 轮没有用它**”。**接入它需要什么**：一个会决定“由系统结束一张 Ticket”的调用者——候选是预算探测器（P6 剩余，尚未实现）或 Watchdog 的第四类动作（C154，尚未实现）；两者都不存在，所以它至今没有接入路径 |
| C43 | `trigger()` / `dispositionOf()` / `artifactsOf()` 三个读方法 | **部分实现（未接入）** | 三个都有完整实现（`src/core/engine.ts:820,872,1116`），但**零生产调用者、零测试**（`grep -rn "\.artifactsOf(\|\.dispositionOf(\|engine\.trigger(" src/ tests/` → **0 命中**）。所以未验证的那一半**连“离线验证”都不成立**（没有测试）。按 `00` §4.25 的裁定标 **部分实现**、缺失的一半命名为 **未接入**。**接入它需要什么**（裁定要求逐条写明）：`artifactsOf` 的接入点是 `Runtime.artifacts()`（`src/app/runtime.ts:619`）——它现在直接 `return this.store.artifacts.list(ticketId)`，改成经 Engine 就接上了，而这是**三个里唯一有一个现成调用点在旁边的**；`trigger()` 的接入点是 `src/app/http.ts:357`（那里为了取 `replyTo` 直接 `host.store.triggers.get(ticket.origin.triggerId)`）；`dispositionOf()` **没有任何现成的接入点**——面板读处置走的是 `GET triggers` 的 `record.disposition`，不经过 Engine。写者唯一（§1.2）没有被破，但“面板看到的产物来自 Engine”这个说法是假的 |
| C44 | `dismiss`：把一条 Decision 标成已看 | **部分实现** | **得证的一半（真宿主验证）**：`01` §8 行「操作者动词」里 `dismiss` 命中过。**已修的一半**：上一版记的“用错错误码”（对不存在的 Decision 抛 `trigger_missing`）在**第 31 轮修掉了**——现在抛 `decision_missing`（`src/core/engine.ts:512`，码在 `src/core/errors.ts:23`，措辞 “No decision has that id”）。**仍未做的一半（尚未实现）**：它**不幂等** —— `src/core/engine.ts:513` 无条件追加 `\n[dismissed]`，调两次得到 `"[dismissed]\n[dismissed]"`。这是 `01` §9 的 **B6**、`00` §2 S18 与 §7 表里的 **S29**，两处都标“待修”，**没有代码**。离线有 `tests/http.spec.ts:132` 的 `dismisses a Decision, so the list stays a list of things to look at`（只调一次） |
| C45 | `policyChanged`：授权变更送到在跑的 Ticket | **离线验证** | `tests/engine.spec.ts` 的 `tells a live Ticket that its sender may no longer start work`、`leaves Tickets alone when nothing that bears on authorization changed`、`revalidates a Mandate against the settings that are current now`；`tests/notify.spec.ts` 的 `tells the front desk in the gate's own words`。生产调用者 `src/app/runtime.ts:483`。线上未驱动（同 C26） |
| C46 | `watchdogActed`：Watchdog 动过几次手，用 Ticket 自己的日志数（不是 Watchdog 的字段） | **部分实现** | **得证的一半（真宿主验证）**：`02` §7 与残件 `item7-evidence.json` —— `rescued` 事件带 `by={kind:system,id:watchdog}`、`why="its worker never came up within 15s"`，全库只有一条 `rescued`。**未得证的一半（离线验证）**：达到 `maxActions` 后停手并说"需要人"，见 C62 |
| C47 | `ruleChainStopped`：被深度限制截断的链在**上游那张 Ticket** 的日志里留下一条持久记录（N5 的修复） | **离线验证** | `tests/sources.spec.ts:792` 的 `leaves a durable record on the Ticket whose ending stopped it`（`00` §4.18 记它经变异检验：去掉那行写入立刻变红）。实现在 `src/core/engine.ts:1049`（`by={kind:'system',id:'rule'}`），调用者 `src/sources/rule.ts:80`。**第 24 轮的修复，从未在真宿主复验**；而缺陷本身在真宿主上被观测到过（`02b` §6.5：告警真的触发过、随后被擦掉）。**日常宿主上此前不可达、本轮重载后可达但未被驱动**（§0.3：已加载的 bundle 早于它） |
| C48 | 事务与 `afterCommit`：回滚的命令既不留状态也不发布事件 | **真宿主验证** | `02b` §6.3 与 `02` §4 的事件序列本身就是证据（每张 Ticket 的 seq 连续、没有假事实）。离线：`tests/engine.spec.ts` 的 `publishes nothing for a command whose transaction rolled back`、`holds a nested command's events until the outer transaction commits`、`records nothing for a command whose transaction rolled back`；`tests/transaction.spec.ts` 的 `undoes everything and runs nothing deferred when the transaction itself fails` |
| C49 | 附件归一化（`attachmentsOf` / `attachmentName`） | **真宿主验证** | `01` §2a 正例：两个同名文件被改名成 `-2`、复制比 `turn/start` 早 56 ms、任务文本列出副本；§2b 反例：路径不存在 → `failed` + 点名路径 + 零 worker。`01` §8 因此把「附件全链路」从 `offline` **升为 `live`**。离线：`tests/attachments.spec.ts` 11 条 |
| C50 | `artifactPath`：worker 自报路径的归一化（同一文件的多种写法收敛成一条） | **真宿主验证** | `02` §2：`report.md` 与 `./report.md` 只登记一条。离线：`tests/engine.spec.ts` 的 `registers the files a report claims, under one spelling per file` |
| C227 | **`watchdogEscalated`：升级成一条持久记录**（第 34 轮，N8 的修复；新事件类型 `escalated`） | **离线验证** | 实现在 `src/core/engine.ts:960`（`by={kind:'system',id:'watchdog'}`），窄端口 `WatchdogHost.escalate`（`src/app/watchdog.ts:56`，接线 `src/app/runtime.ts:516`），**两处升级点都写**（`watchdog.ts:113` 卡住的启动、`:140` 静默的 worker），因为它们对操作者是同一个事实：“myagent 在这里放弃了，需要人”。**一个刻意的设计细节**（`00:1846-1855`）：同一句话同时去日志与健康板，**在源码里就是一个字符串变量**（`watchdog.ts:112` 的 `const escalated = …`，随后 `:113` 交给 `escalate`、`:114` 拼进 `health.problem`），所以两个去处**不可能漂移**；而且健康板的措辞**逐字保持不变**——`docs/v2/14-…` 引用过它，改一个字就会让那份报告里的证据对不上。**`escalated` 不计入 `actionsTaken`**（`00:1857-1858`：升级不是一次“采取的行动”，而是“行动失败了”这个结论；计进去会让 `maxActions` 的自我参照变得诡异）。离线：`tests/watchdog.spec.ts:179` `it('reaches the host as a durable record, with the same words the board shows')`、`:203` `it('records the silent-worker escalation too, which is the other way in')`（两条都断言 `acted` 仍是 `false`）。**经变异检验**：移除那两处调用，测试立刻变红（`00:1861`）。**它修的缺陷是真宿主【实测】发现的**：`docs/v2/14-…` §7 第 1 条——Ticket `a688c9df` 的事件日志是 `created → rescued → rescued → launched → report`，**没有任何一条对应那次 `health.problem("… it needs a person")`**，停机后查 DB，`events` 表里找不到它、`kv` 里也没有。**修复本身从未在真宿主复验**，日常宿主上**此前**不可达、本轮 01:40:15 重载后**可达但未被驱动**（§0.3 第 1、2 条） |
| C228 | **`replyLost`：一句话彻底发不出去时的两处痕迹**（第 36 轮 C2） | **离线验证** | 事件在 `src/core/engine.ts:976`（`by={kind:'system',id:'delivery'}`），文件是 `<ticket dir>/REPLY-UNDELIVERED.md`，**欠的那句话逐字保留**（`RESULT.md` 的先例、同一层、同步写）。写入者 `Delivery.sendGaveUp`（`src/app/delivery.ts:350`），经由 `DeliveryHost.replyLost` 这个**窄端口**调用（接线 `runtime.ts:377`），理由与 C227 同构：**一个持有 Engine 的 Delivery 可以写任何领域状态，而窄端口只允许它写这一件事**。**两者各自在自己的 try/catch 里**，所以一个没有日志或没有目录的 Ticket 仍然留下另一样；`00:2084-2085` 写明这不是冗余：**文件让人能照着手动发出去，事件是面板会渲染、且健康板被清空后仍可读的那一份**。**这一条标 离线验证，因为它的命题就是“彻底发不出去时留下什么”，而那从未在真宿主上发生过**：两次隔离验收里 `effects` 表停机时都是 **0 行**，没有任何一次投递走到放弃。**“发出去了”那一半是 真宿主验证，但它是 C237 的命题**：`docs/v2/16-…` 场景 1【实测】回复文件 `room-a/out/reply-40f114496924e6c7a442ba5998bfb28e.md`（253B）**正文即报告摘要原文**、front matter 带回 `thread`、hash 本地复算一致，`counts.sends` 由 `{0,0}` → `{1,0}`。**“彻底放弃”那一半只有离线证据**：`tests/chat-send.spec.ts:277` `it('records a give-up in the Ticket's log and its directory, and both outlive the health board')`，**经变异检验 8 条**（M1–M8，`00:2087-2099`），其中 M2 把 `send` 改成内联 → **4 条变红 + 3 个未处理错误，而 happy-path 测试仍然是绿的**——`00:2090-2091` 由此得出那句规律：**“顺利路径的测试无法区分‘持久’与‘内联’**——内联发送在不出错时行为完全一样，只有失败、去重、彻底放弃这三类测试能抓住它”。日常宿主上**此前**不可达、本轮 01:40:15 重载后**可达但未被驱动**（§0.3 第 1、2 条） |
| C229 | **`noticeLost`：一条永远不会到达的通知留下本来要说的话**（第 40 轮，(v) 的 `notify` 一半） | **离线验证** | 实现在 `src/core/engine.ts:995`（`by={kind:'system',id:'delivery'}`），调用者 `src/app/runtime.ts:293`（`onPermanentFailure` 里 `kind === 'notify'` 那一支）。detail 带通知种类、状态、错误原文，以及**本来要说的那句话截到 400 字**——理由与 `REPLY-UNDELIVERED.md` 相同：**一条丢掉的消息只有在内容活下来时才是可行动的**。写日志那一步包在 try/catch 里（Ticket 可能已经不在了，而丢掉“丢通知”的痕迹不该连这一轮 pass 一起丢掉）。**一个刻意的分层选择**：这一半**从 Runtime 直接调 Engine**、不走 Delivery 的窄端口，理由写在 `00:2339-2341`（Runtime 就是组合根，本来就持有 Engine；把同一条规则机械地套到不同层上只会多出没有作用的间接）。离线：`tests/engine.spec.ts:947` `it('is recorded on the Ticket, with what was going to be said')`、`:961` `it('refuses to invent a Ticket that does not exist')`；`tests/fault-injection.spec.ts:93`、`:147`（真跑队列到彻底放弃）。**经变异检验**：去掉那行 `record` → 变红（`00:2344`）。**一处必须一起读的欠账**：第 41 轮查出这一支里有一个 `??` 优先级 bug（`??` 比 `===` 松，于是 `summary ?? (detail === undefined)` 把一条 **policy** 通知本来要说的话丢掉了），已修为显式条件（`runtime.ts:302-306`，注释逐字写了 “`??` binds LOOSER than `===`”）；**report 通知那一半有变异检验**（`17` §6 的 M2：删掉 `text:` 那一段 → 2 红），**policy 通知那一半连测试都没有**（`tests/fault-injection.spec.ts:519-524` 的注释记了这笔欠账，以及那条测试为什么被撤下而不是留成红的或伪造的）。日常宿主上**此前**不可达、本轮 01:40:15 重载后**可达但未被驱动**（§0.3 第 1、2 条） |
| C230 | **`triggerLost`：一个被队列放弃的请求变成 `triggers` 表里的一行 `lost`**（第 44 轮，(v) 的 `trigger` 一半） | **离线验证** | 实现在 `src/core/engine.ts:1012`，调用者 `src/app/runtime.ts:325`；退化路径（载荷读不出）走 `Store.pushLostPayload`（`src/app/store.ts:740-748`）写进一个**有界**的 `kv` 条目（`LOST_TRIGGER_KEEP=20`、`LOST_TRIGGER_CHARS=1000`，`store.ts:137-138`）。**两条路径分开是裁定过的**（`00` §4.42）：读不出的载荷**不进 `triggers` 表**，因为那张表的 `source`/`kind` 两列都是 NOT NULL、而 `countBySource` 会按 `source` 分组当作**进气计数**显示在面板上——插一行 `source:'lost'` 会让面板出现一个**叫 “lost” 的来源**，“**那是一句关于来源的假话，而它出现在一个专门用来回答‘工作从哪来’的地方**”。同一条原则的另一次应用是**不写 Decision**（`00` §4.35：那等于伪造一个从未发生的裁决；而且 `receive` 是一个 `tx.atomic`，后续抛出会把 Decision 一起回滚，裁决无法事后从库里重建）。离线：`tests/fault-injection.spec.ts:241`、`:321` `it('keeps a payload it cannot read as bounded text, and puts no invented Source in the triggers table')`、`:363` `it('writes one lost row when the same failing effect is given up on twice')`、`:402` `it('receives a lost Trigger again instead of answering that it was already handled')`、`:437` `it('keeps the pass when writing the lost record fails, which is what a failing Store does to it')`；`tests/engine.spec.ts:96`、`:117`。**经变异检验**（`00:2700-2704` 的 M1，是纪律 0.8 强形式的又一次执行：在缺陷完全活着时删掉“行存在”与“进气计数”两条断言，测试就变绿了——**只有那两条是承重的守卫**）。**它自己枚举消费者时抓到一个真错并已修**：`receive` 的重复短路曾把一个已存的 `lost` 行当作 `{stored:'duplicate'}` 返回——**与事实完全相反**（`00:2685-2691`）。**没有引入 schema 迁移**（`SCHEMA_VERSION` 仍是 5）。日常宿主上**此前**不可达、本轮重载后可达但未被驱动（§0.3：`GET /api/lost` 在 3080 上返回 404） |

### 2.7 `src/core/memory.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C51 | `Memory` 与 `Store` 的事务契约**同构**（S7 的修复）：每层都快照、回调在 try 外逐个隔离、失败记入 `deferredFailures` | **离线验证** | `tests/transaction.spec.ts`：**同一组 7 条契约断言对两个实现各跑一遍 = 14 条测试**（`gate.log` 里这个文件是 `14 tests`，而源码里只有 7 个 `it`，因为 `:62` 的 `for (const implementation of implementations)` 跑两遍）。`00` §4.5 记它经变异检验：把 `Memory` 改回"只在 depth 0 快照"，嵌套回滚那条立刻变红而 Store 那组仍绿 |
| C52 | 领域命令的回滚不留痕迹（8 张表都在快照里） | **离线验证** | `tests/engine.spec.ts` 的 `leaves no Project, Work or classification behind when the transaction rolls back`、`leaves no edge behind when the transaction that wrote it rolls back`；`tests/transaction.spec.ts` 的 `undoes a registered artifact when the transaction that registered it rolls back` |
| C53 | `Memory` 与 `Store` 的一处已知分歧：`triggers.list()` 的排序 | **部分实现** | `00` §4.5 记录了它：`Store.triggers.list()` 是 `ORDER BY at`，`Memory` 是插入序；两条记录 `at` 相同时顺序不同。这**不属于事务契约**，写在测试注释里。它是已知的、被记录的分歧，**没有修**，也没有测试钉住它 —— 那一半标 **仅有设计**（`00` §4.5 是它唯一的记录） |

---

## 3. `src/app/` —— 执行与 IO 层（17 个文件，**5162 行**）

| 文件 | 行数 | 责任（一句话） | 公开面（别的模块用的） | 依赖 |
| --- | --- | --- | --- | --- |
| `src/app/runtime.ts` | **946** | 一次部署的装配：唯一知道所有部件的文件，也是唯一决定它们被创建的顺序与停止的顺序（反序）的文件 | `WorkerProgress` `usageOf` `Recipe` `Runtime`（实现 `HttpHost`）`createRuntime`；转出 `PromptRole` 类型 | `node:fs` `node:path`、cordis、dsh-agent、dsh-session、dsh-subprocess、`../core`、`../deployment`、`../sources/*`（**含第 36 轮的 `chat.ts`**）、以及本层 9 个文件 |
| `src/app/store.ts` | **760** | 一个 SQLite 库：领域仓库、设置与提示词修订、以及每个命令写在里面的那个事务边界 | `SCHEMA_VERSION`(=**5**) `KV`（**含第 44 轮的 `lostTriggers`**）`LOST_TRIGGER_KEEP`(=20) `LOST_TRIGGER_CHARS`(=1000) `LostPayload` `SchemaTooNew` `EffectRow` `Store`（实现 `Transaction`） | `node:sqlite` `node:fs` `node:path`、`../core/model`、`../core/engine`（只取类型）、`../core/policy` |
| `src/app/http.ts` | **676** | 面板的 HTTP 面：一个盖在同一个 Engine 上的 JSON API，加上面板页面本身 | `BASE_PATH` `REQUEST_HEADER` `HttpHost` `sameOrigin` `registerHttp` | `node:http` `node:fs/promises`、`zod`、cordis、dsh-host-webserver、`../core`、`../deployment`、本层 8 个文件、`../sources/{registry,kind}` |
| `src/app/delivery.ts` | **475** | 一份值得告诉某人的报告 goes 到哪儿去；**第 36 轮起也负责把话回到原会话** | `DeliveryHost`（**含窄端口成员 `replyLost`**）`SendPayload` `UNDELIVERED_FILE`(=`REPLY-UNDELIVERED.md`) `sendKey` `replyText` `NotifyPayload` `headline` `relayText` `resultDocument` `findNotifier` `OutcomeDelivery`（实现 `Delivery`，**含 `send` / `sends()` / `sendGaveUp`**） | `node:fs` `node:fs/promises` `node:os` `node:path`、cordis、dsh-subprocess、`../core`、本层 4 个文件 |
| `src/app/executor.ts` | **451** | 执行器：一个 Assignment 怎么变成一个真的在做活的 worker Session | `PrepareFailed` `ExecutorHost` `LaunchPayload` `InputPayload` `DshExecutor`（实现 `Executor`） | `node:fs/promises` `node:path`、cordis、dsh-session、dsh-subprocess、`../core`、本层 4 个文件 |
| `src/app/sessions.ts` | 452 | 两种 DSH Session 的生命周期，以及各自被告知什么、被允许什么 | `WORKER_PRESET` `WORKER_PERMISSION` `WORKER_TOOLS`(**20 个**) `MainState` `SessionsHost` `workerSessionId` `workerSessionOf` `ticketOfSession` `knownToolsOf` `refusedNamesOf` `Sessions` | cordis、dsh-agent、dsh-session、dsh-scope、5 个只取类型的 dsh 包、`../core/model`、本层 3 个文件 |
| `src/app/tools.ts` | **271** | 这个系统注册在它两种 Session 上的工具 | `Tool` `tool` `definitionOf` `ToolsHost` `ArtifactRead` `workerTools`(**3 个**) `mainTools`(**7 个**) | `zod`、`../core`、本层 2 个文件 |
| `src/app/effects.ts` | **200** | 效果队列：每一个必须活过重启、且不得发生两次的副作用 | `Later` `EffectHandler` `EffectOutcome` `EffectsOptions` `backoff` `Effects` | `./health` `./store`（都是类型） |
| `src/app/watchdog.ts` | **185** | 那个注意到工作不再前进的部件：只看、只判断，然后用**别人已有的动作**去救 | `WatchdogAction` `WatchdogHost`（**含第 34 轮的 `escalate`**）`Watchdog`（**含第 33 轮的只读诊断 `armedInterval()`**） | 只 `./health`（类型） |
| `src/app/agent-delivery.ts` | 115 | 对 DSH agent 的幂等消息投递 | `messageId` `AgentDelivery` | cordis、dsh-agent、dsh-llm、dsh-session、dsh-session-persistence |
| `src/app/prompts.ts` | 118 | 每个角色的内置文本、操作者的覆写、以及一个 Session 实际跑在哪一版下 | `PromptRole` `PROMPT_ROLES` `PROMPT_MAX_CHARS` `packageFile` `promptFile` `PromptConfig` `PromptConflict` `PromptVersion` `Prompts` | `node:fs` `node:path`、`./store` |
| `src/app/views.ts` | 112 | 领域的 JSON 形状，给工具的回答与面板的列表用 | `updatedAt` `TicketSummary` `ticketSummary` `ticketView` `scheduleView` `decisionView` | `../core/model`、`../core/policy`、`../core/timing` |
| `src/app/lock.ts` | 96 | 状态锁：一个状态目录一个写者 | `LockRecord` `LockHeld` `StateLock` `takeLock` `writeMarker` | `node:fs` `node:os` `node:path` `node:crypto` |
| `src/app/files.ts` | 96 | 读一个 Ticket 的目录，给面板用 | `MAX_FILE_BYTES`(16MB) `FileEntry` `FileListing` `isTextFile` `resolveInside` `listFiles` `readForPanel` | `node:fs/promises` `node:path` |
| `src/app/background.ts` | 90 | 一个 worker 在 DSH 里的后台工作：它的 Session 拥有的 shell 作业，与它派生的子代理 | `until` `killJobs` `stopSubagents` `stopBackground` | cordis、dsh-agent、dsh-session |
| `src/app/passes.ts` | 78 | 泵：跑该跑的东西，一次一轮 | `PassesOptions` `Passes` | `./effects` `./health`（类型） |
| `src/app/health.ts` | 41 | 健康板：一个会出问题的部件一行，所以面板在问题发生的地方说出它 | `HealthState` `HealthEntry` `HealthBoard` | 无（零导入） |

**这一层的形状**：`health.ts` 零导入，是整棵树里被依赖最多而不依赖任何人的文件
（`effects` `passes` `watchdog` `delivery` `executor` `runtime` `sources/*` 都只取它的类型）。
`runtime.ts` 是唯一一个“知道所有部件”的文件（它自己的文件头就这么写），也是唯一 import `../sources/*` 具体实现的文件
（`src/app/runtime.ts:20` 现在也 import 了 `chatKind`，`:395` 把它注册进 `SourceRegistry`）。
`views.ts` 与 `files.ts` 只向下依赖 core 或 Node，不碰 Store 也不碰 Session —— `views.ts:5` 的注释明说了这一点。
**第 33–46 轮没有新增 `src/app/` 文件**：P8 的生产者落在 `src/sources/chat.ts`（§4.5），
分发与放弃痕迹落在既有的 `delivery.ts`（228 → **475** 行，翻了一倍多），接线落在 `runtime.ts`（844 → **946** 行）。

### 3.1 `src/app/store.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C54 | 迁移阶梯 1 → 5（`MIGRATIONS` 按目标版本索引、每步幂等、`BEGIN IMMEDIATE`、`defer_foreign_keys`） | **真宿主验证** | `02` §1：隔离库现在是 **version 5**，`tickets=25`、`events=71`、`artifacts=11`；上一轮留下的 5 张 Ticket 仍在。`02b` §6.3 补了两条更精确的：副本演练跑的是 **`src/app/store.ts`（脚本直接 import 源码），不是 `lib/index.js`**，而线上那半是宿主挂载时真迁移的，**两边都得证了**；且上一轮那 5 张 Ticket 是逐张 `GET` 验的（全部 200，stage 分别 `done/done/failed/done/stopped`）。日常库现在也是 5（S37 / §0.3） |
| C55 | 迁移演练与回滚（改版本号）在**真实数据的副本**上跑通 | **真宿主验证** | `02` §1 的残件 `verify-migration-fixed.txt`：`迁移前 version=1 摘要=dacb42ed007e2b26 / 迁移后 version=5 摘要=dacb42ed007e2b26`（四张数据表逐字节未变）/ `回滚演练：版本号改回 1 之后摘要仍为 dacb42ed007e2b26` / `── 通过：可以升级线上库`。`docs/v2/03-deployment-and-rollback.md` §2.2 另有一次对线上库副本的实跑（摘要 `bcf92225a76e43e7`，10/8/10/4）。**限定**：`03` §6 明说**没有真的装回旧构建跑一遍**（旧构建的代码已不在树里） |
| C56 | `SchemaTooNew`：拒绝打开一个更新的库 | **离线验证** | `tests/store.spec.ts` 的 `refuses to open a database whose schema it does not know`。`01` §10 明说线上没验（"要验得改 `SCHEMA_VERSION` 或造一个未来版本的库文件，前者动 `src/`（禁止），后者会把隔离库置于一个不可回退的状态"）。**S37 之后这条路径已经变成真实可达的**（日常库是 5，任何旧构建挂上来都会被拒），但**仍然没有被观测过一次** |
| C57 | "更旧的版本"路径（version 比当前小 → 走阶梯，而不是重新盖章） | **离线验证** | `tests/store.spec.ts` 的 `brings a version-1 file to the current schema without touching what it holds`、`leaves the version at 1 and the data untouched when a step throws`、`creates the registry on a fresh install too, and upserts by (ticket, path)`；以及 v2 形状的库 → v3 的两条（`adds the Project and Work tables and the generated columns without touching the row it found`、`runs the same step twice without failing, which is what a fresh install does`）。`00` §1 曾把这一行标成"只测了更新的版本，更旧的路径完全没有测试"—— 那条已经过期 |
| C58 | 迁移失败时关掉已打开的句柄再抛（不再把"这个目录不可用"变成"这个目录被锁住"） | **离线验证** | `00` §4.5 记录了这次修法。测试是 `tests/store.spec.ts` 的 `leaves the version at 1 and the data untouched when a step throws`（它用一个同名视图让 `CREATE TABLE IF NOT EXISTS` 真的失败）。**句柄被关闭这件事本身没有独立断言** —— 那部分**未核实**，核实它需要一条"步骤抛错之后同一目录还能被重新打开"的测试 |
| C59 | 效果队列的行（`enqueueEffect` 的 `ON CONFLICT … running = 0`、`claimEffects`、`settleEffect`、`failEffect`、`deferEffect`、`releaseRunning`） | **真宿主验证** | `01` §4 与 §8：放弃路径**从 `offline` 升为 `live`**（1/5 → 4/5 → gave up，退避 15/30/60/120 s 与公式吻合）。`01` §8 行「效果队列排空」：每次结束后 `counts.effects={}`，只读查库 `effects` 0 行。`02b` §2【残件】：三条负面路径都在 20ms 轮询里抓到了 `{"notify":1,"trigger":1}`。`02b` §3：停止时 `-wal`（3,848,112 字节）与 `-shm` 被 checkpoint 进主库并删除 |
| C60 | `kv`：来源游标、设置文档与修订号、提示词覆写与修订号、主 Session 的真实 id | **真宿主验证** | `02b` §4.6【转录】列出隔离库 `kv` 的键：`prompts:config`、`prompts:revision`、`settings:document`、`settings:revision`、`source:cron:cursor`（并据此得出"主 Session 的 id 来自配置而不是库"）。`01` §8 行「主 Session 按需创建 + 记录真实 id」：`kv` 的 `main-session:id`，重挂载后 `state.mainSession.id` 返回它 |
| C61 | `tickets` 的 `workId`/`workSeq` **GENERATED VIRTUAL** 列（选生成列而不是提升列，为了免疫"列与 blob 静默分叉"） | **部分实现** | **得证的一半（真宿主验证）**：列在线上库里存在 —— `02` §1 说隔离库是 version 5、11 张表齐全，S37 说日常库也是；`03` §3 的版本表把这一步记为纯加法。**未得证的一半（离线验证）**：这两列**从来没有被写过一个非空值** —— `tests/store.spec.ts` 的 `adds the Project and Work tables and the generated columns without touching the row it found` 是唯一钉住它的测试，而 §0.3 的只读复核里 3080 的 `works` 是空集合、`GET /api/tickets` 的摘要里**没有 `workId`/`workSeq` 键**（`views.ts:54` 无条件写这两个键，值为 `undefined` 时 JSON 会省略它） |
| C62 | `Triggers.countBySource()`：来源计数从库里数，不是每实例内存值（S14 的修复） | **离线验证** | `tests/http.spec.ts:338` 的 `counts from the record, so they survive a settings save and a restart`。实现在 `src/app/store.ts:319`（上一版记的是 `:287`），调用点 `src/app/runtime.ts:625`（带一条注释说明为什么读失败不能拖垮面板）与 `src/app/http.ts:264`（第 45–46 轮新加的 `lostCount`，它**跨所有来源求和**而不是只算注册过的那些，理由写在 `http.ts:255-258`：一条 `lost` 行记的是它自己的 payload 带来的来源，而一次设置编辑可能已经把那个来源删掉了，**“一个不再被计数的丢失是一个看起来被修好了的丢失”**）。**`docs/v2/00-audit-and-plan.md` §8 第 4 项仍把它标成 ⬜（未做）—— 那条已经过期**，见附录 A 第 1 条 |

### 3.2 `src/app/lock.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C63 | 单写者锁（OS 文件锁 + 锁文件记 pid/host/token） | **真宿主验证** | `01` §8 行「单写者锁」：隔离锁 `pid 72808`（token `2d1c1fff…`）与日常锁 `pid 24619`（token `fb8b230f…`）同时存在且互不干扰；停宿主后隔离锁文件消失。`02b` §3【转录】：SIGTERM 之后 `myagent.lock` 不存在（即 `runtime.stop()` 跑过了）。`docs/v2/06-security-risk-register.md` §2 把它列为**两处真边界之一**。本文只读复核：日常宿主的 `myagent.lock` 存在，109 字节 |
| C64 | `LockHeld`：拒绝第二个活着的写者；偷走一个持有者已消失的锁 | **离线验证** | `tests/delivery.spec.ts` 的 `lets one writer hold a state directory`、`refuses a second live deployment over the same directory`、`steals the lock of a holder that is gone`、`does not steal the lock of another live process`、`leaves a lock it stole nothing of, and removes only its own`；`tests/mount.spec.ts` 的 `refuses a second deployment over the same state directory, and says so plainly`；`tests/recovery.spec.ts` 的 `refuses a second deployment over the same state, so two processes cannot work one queue`。`01` §10 明说**主动放弃**线上验（"唯一干净的做法是在同一个隔离状态目录上再起一个宿主 …… 对日常宿主有非零风险"），`00` §1 记的那次尝试死于 `EADDRINUSE` 而不是 `LockHeld` |
| C65 | `writeMarker` 不把 Volatile 序列化进诊断文件（S15/B7 的修复） | **部分实现** | **得证的一半（本文只读复核，不满足证据规则，故不升级）**：日常宿主的 `~/.dsh/state/myagent/myagent.json` 逐字段是 `pid 24619` / `stateDir` / `workRoot` / `inboxDir` / `mainSessionId: "myagent-main"` / **`promptMaxChars: 100000`（一个数字，不是 `{}`）** / `at: 2026-11-04T04:21:30.905Z`；`src/app/runtime.ts:248-253` 有一条注释说明为什么必须逐字段拼而不能展开（上一版记的是 `:247-252`）。**未得证的一半（尚未实现）**：`grep -rn "writeMarker\|myagent.json" tests/` 只命中 `tests/files.spec.ts` 的一个穿越路径字面量 —— **没有任何测试断言 marker 的内容**。所以这个修复**既没有测试也没有 01/02/02b/14/16 的证据**。`00` §7 的 S30/B7 标“已修”，§8 第 5 项却仍标 ⬜（附录 A 第 2 条）。**一个附带的新事实**：marker 的 `at` 与 `myagent.lock` 的 `at` 与 `state.mountedAt` **三者逐字相同**（`2026-11-04T04:21:30.90xZ`），所以这三条独立读数互相印证了挂载时刻——这是 §0.3 那个 bundle 夹逼的下界证据 |

### 3.3 `src/app/effects.ts` 与 `src/app/passes.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C66 | `Later`：**抛出**与**返回**都算推迟，都不计入失败预算（S24/B3 的修复） | **离线验证** | `tests/effects.spec.ts` 的 `defers without spending the retry budget, and still settles when the work becomes runnable`、`honours the wait the thrown Later asked for`、`defers an effect that is not runnable yet, without counting it as a failure`。`01` §9 B3 是这条的原始现场（给一张等人的 Ticket 加一条备注会在约 4 分钟后把它判死）；修复标"已修 + 2 条测试"，但 `01`/`02`/`02b` **都没有它修复后的线上复验** |
| C67 | 一次只跑一个 pass（`runDue` 开头的 `if (this.disposed \|\| this.running !== undefined) return`） | **离线验证** | `tests/effects.spec.ts` 的 `runs one pass at a time, so two callers cannot work the same row`、`takes a retry that became due during a pass in the same pass`。**这一条正是 N1 的机制**：`02b` §5 N1 指出，正在飞的那个 pass 就是卡在 prepare 里的这次 launch，所以重新入队的行会被它自己结算掉。**这条性质在真宿主上被观测到的方式是它的后果（N1），不是它本身** |
| C68 | 退避与放弃（`backoff` 指数增长到上限；5 次耗尽后交给能显示它的人） | **真宿主验证** | `01` §4 与 §8：1/5 → 4/5 → gave up，退避 15/30/60/120 s 与公式吻合，Ticket 上落了一条 `failed` Report，且 retry 成功跑到 `done`。离线：`tests/effects.spec.ts` 的 `grows exponentially and stops at the cap`、`never answers zero or a negative wait, however it is called`、`gives up after its budget and hands the failure to whoever can show it`、`survives a permanent-failure hook that throws, and records that instead` |
| C69 | 四种效果（`launch` `input` `notify` `trigger`）与其处理器注册 | **真宿主验证** | 注册点：`executor.ts:87,88`（launch/input）、`delivery.ts:140`（notify）、`runtime.ts:324`（trigger）；入队点 7 处。`launch`/`input`/`notify` 的线上证据见 `01` §1/§8；`trigger` 的线上证据是 `02b` §2【残件】那三条 `{"notify":1,"trigger":1}` |
| C70 | `pending(kind, key)`：一个请求已经在队列里就不再排一次 | **离线验证** | `tests/effects.spec.ts` 的 `replaces a pending effect of the same identity instead of queueing the work twice`；`tests/store.spec.ts` 的 `replaces a pending effect of the same identity instead of queueing a second one`。它是"同一结束投递两次只问一次"（C100）的底层机制 |
| C71 | 处置后队列里不留行；`dispose()` 之后已排队的行留给下一次启动 | **真宿主验证** | `01` §8：每次结束后 `counts.effects={}`，只读查库 `effects` 0 行。离线：`tests/effects.spec.ts` 的 `keeps queued rows for the next start once it is disposed`、`runs a handler registered after the effect was queued`、`reports what is pending, which is what the panel shows as a backlog` |
| C72 | 泵：一轮跑该跑的效果然后跑额外登记的活；跑着的时候被请求的那一轮被记住、之后再跑一次 | **离线验证** | `tests/effects.spec.ts` 的 `runs one pass at a time…`；`tests/executor.spec.ts` 的 `takes a request the moment a pass is asked for, rather than at the next poll`。`00` §4.9 记了一条与之相关的语义：`nudge()` 里的 `requestPass()` **不被 await**，所以"推动一轮"之后效果可能还没跑完 |
| C235 | **`effects` 健康条目回到“此刻”语义**（第 43 轮，缺陷 (2)） | **离线验证** | `src/app/effects.ts:56` 的 `const QUIET = 'no effect failed in this pass'`——**本轮在 3080 上逐字读到了这一句**（§0.3：`health.effects.detail` 就是它，而那一刻队列是空的、系统健康），`:74` 的 pass 级 `complained` 标志、`:112` 每轮开头重置、`:131` 每轮结尾 `summarize()`、`:156-163` 的守卫（**抱怨过的任何一行仍然 pending 时也提前返回**）。**修的是什么**：`record()` 是唯一能清掉健康问题的东西（`health.ts:16-19`），而它此前**从不在 `effects` 与 `delivery` 上被调用**，于是一次 notify 失败两次、第三次成功之后，板子上**永远**挂着 `notify failed 2 of 5 times`，`refresh()` 在进程的余生里都报 “1 problem(s)” —— **一个永久的假警报**（`00` §4.41、`docs/v2/17-fault-injection.md` §5.2【实测】）。**措辞为什么是这一句**：`Effects` 拿到的是 Store 的一个刻意收窄的切片，**没有 `effectCounts`**，而 `pendingEffects(kind,key)` 是存在性检查、返回 boolean，所以摘要**不能说“还有 N 个在等”**；`00:2479-2480` 的裁定是“**不要为一句摘要去加宽端口**——端口表达的是‘队列可以碰什么’”，正确的措辞是一句不需要计数、且严格为真的话。离线：`tests/fault-injection.spec.ts:93`（名字已改成 `…the event outlives the health line the next pass clears`）、`:147`（`…while the health line is erased by the next quiet pass and by the restart itself`）、`:184`。**经变异检验**（`00:2580` 的 M1：去掉那个 pending 守卫 → **5 条既存测试变红**；M2：让 pass 从不做摘要；M3 是纪律 0.8 强形式的又一次执行，见 `docs/v2/11-test-report.md` §5 第 5 条）。**四条测试全部改为断言“系统自己清除了”，没有一条被删或弱化**（`00:2626-2631`）。日常宿主上**此前**不可达、本轮 01:40:15 重载后**可达但未被驱动**（§0.3 第 1、2 条） |

### 3.4 `src/app/health.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C73 | 健康板：一个部件一行，健康的部件不占空间 | **真宿主验证** | `02` §7 的两次采样（`{ok:true}` → `{ok:true, detail:"1 stuck launch(es) rescued"}`）；`02b` §2 的 `health_source_rule` 逐字值；`02b` §5 N5 里 `depth_problem_before` 的逐字告警文本；`docs/v2/14-…` 场景 3【实测】`04:34:25.830Z` 转 not ok、detail 逐字 `Ticket a688c9df has not started after 2 attempts to rescue it; it needs a person`。本文只读复核（**02:4x，重载之后**）：3080 的 `health` 有 `effects`/`passes`/`watchdog`/`runtime`/`source:cron`/`source:session`/`source:rule`/**`source:chat`**/`source:inbox` **九个**条目，**没有 `executor`**——而系统此刻是健康的（`counts.open` 0、`effects` `{}`），所以这个缺席**正是 S38 之后该有的形状**（C231：那个条目惰性创建，唯一创建它的那句 gauge 被删了）。**本文 00:5x 那次也读不到 `executor`，但当时这个观测没有意义**（旧 bundle 里那句 gauge 只在 `launch()` 里写，没有 launch 就没有条目），**现在它是有意义的**。同一份读数里还有一条更硬的：`health.effects.detail` 逐字是 **`"no effect failed in this pass"`**，即 `src/app/effects.ts:56` 的 `QUIET` 常量——**第 43 轮那个“健康条目自己会清”的行为此刻正在线上跑着**（C235）。**“健康的部件不占空间”这句话在第 39 轮之后才对 `executor` 字面成立**：那个条目是惰性创建的，而唯一创建它的那句 gauge 被删掉了（C231），所以健康跑的时候它根本不出现。**这两条线上观测都不升级标签**：它们是一次只读的、对着空数据的 GET（`lost.rows` 0、`chat.waiting` 0、`sends` `{0,0}`、`chat.enabled` false、`channels` `[]`），按 §0.3 第 2、3 条它们只说明现状——**一次对空集合的 GET 不是一次验收** |
| C74 | 一次处理里刚记下的告警不被自己的摘要擦掉（`if (!complained)` 守卫；S19 第五环 / `00` §4.15 / N5 是同一个 bug 的三次出现） | **部分实现** | **得证的一半（离线验证）**：`tests/sources.spec.ts:451` 的 `keeps the alarm it raised, instead of clearing it with its own summary line`。**未得证的一半**：`00` §4.18 自己说清了 —— 这个模式**在单次调用内有效、跨调用无效**，所以真正的修法是 N5 的 `ruleChainStopped`（C47，**离线验证**）。**缺陷本身在真宿主上被观测到过**（`02b` §5 N5：告警真的触发过、随后被下一次无关的结束擦掉，而被深度截断的链不产生 Trigger/Decision/事件，那行健康问题是唯一的痕迹），而**修复从未在真宿主复验**。**第 43 轮把这个模式做对了两次**（C235、C236）：`effects` 与 `delivery` 现在的 `complained` 标志有**明确的边界**（一轮 pass / 一次投递），所以跨边界也成立；而 §4.38 的第一次尝试（“每轮一个标志”）被既存测试证伪，因为它只是把覆盖推迟了一轮。**同一个模式在第 43 轮还被补了一个我没规格出来的守卫**：`summarize()` 在它抱怨过的任何一行**仍然 pending** 时也提前返回（`src/app/effects.ts:156-163`），否则一次失败把行推迟到 15s 退避之后、下一轮 pass 什么都 claim 不到，于是**把一个永久的假警报换成一个假的“一切正常”** |

### 3.5 `src/app/executor.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C75 | `prepare`：每张 Ticket 一个自己的目录（在首次 launch 之前），所以 worker 写的东西不会落到别人的活里 | **真宿主验证** | `01` §8 行「worker 启动 + 每 Ticket 一个目录」：5 个 `<slug>-<id[:8]>` 目录，retry 复用同一目录，每个 worker 的 runtime context 里 cwd 是自己的目录。`00` §1 同一行记的是 8 个。离线：`tests/executor.spec.ts` 的 `runs once per Ticket directory, in the parent of that directory`；`tests/flow.spec.ts` 的 `creates the worker Session in the Ticket directory, which is the whole isolation claim` |
| C76 | `executor.prepare` 设置项：在新目录的父目录里跑一条 shell 命令；空值只建目录 | **真宿主验证** | `02` §7 与 `02b` §5 N1 的证据链就是靠 `prepare='sleep 90'` 造出来的（Ticket `ce1a9d7603b04d220f57dbaedfcefd0e`，`startedAt = createdAt + 90.08s`，正是那条 `sleep 90` 自己睡完的时刻）。离线：`tests/flow.spec.ts` 的 `runs a prepare command once per Ticket directory, and fails the Ticket when it fails` |
| C77 | prepare 失败 → 记一张 `failed` **报告**（可重试、进 attention、有前台通知），而不是结束 Ticket（B2 的修复） | **真宿主验证** | `01` §4 与 §8：两条 `failed` 报告（gave-up + blocked-turn）；`01` §9 B2 是原始现场（prepare 失败的 Ticket `reports: []`、`waitsForPerson=false`、`attention=0`、没有任何通知）。离线：`tests/executor.spec.ts` 的 `reports a prepare failure and leaves the Ticket retryable, because the directory may be half-made`、`says plainly when a prepare command was stopped before it finished`、`tells the Ticket when the queue gives up, so it does not wait forever with no reason on it` |
| C78 | 工作槽：只跑设置允许的那么多 worker，其余排队 | **真宿主验证** | `01` §8 与 §10：那轮**全程 `maxWorkers=1`**，所以得证的是"1 个槽 + 排队"；`00` §0 另有一次旧代码的并发证据（11:56–12:13 两张 Ticket 时间重叠）。离线：`tests/executor.spec.ts` 的 `runs only as many workers as the settings allow, and queues the rest`、`starts the queued worker once a slot is free, in the directory it was promised`、`runs two workers when the settings allow two` |
| C79 | `used()`：救援之后仍把在飞的 launch 计入槽位（N3 的修复） | **真宿主验证** | **本轮升级，依据是 `docs/v2/14-live-acceptance-watchdog.md` 场景 1【实测】**：`sleep 90`（pid 38023）活着的 **22/22** 个采样点上 `workerSlots.used` 都是 **1**、**违规 0 次**；而且全程**只有一个** sleep 进程，尽管两次救援都重新入队了。产物哈希在起点、中途、终点三次核对一致（`04d171f8…`），所以**没有结论需要标“待复验”**。缺陷本身此前也已在真宿主上被观测到（`02b` §5 N3【残件】`procs` 只记变化点 `[[1.5,1],[92.0,0]]`，即一个 `sleep 90` 从 t+1.5s 连续跑到 t+92.0s，而同期 `GET /api/state` 一直报 `workerSlots: {"used":0,"max":1}`）。离线：`tests/executor.spec.ts:503` 的 `keeps counting the launch as starting, so it stays visible and still holds its slot`（靠桩的 `delayMs`）；`00` §4.19 记它经变异检验（把 `starting.delete` 加回 `rescueStuckLaunch` 立刻变红）。实现在 `src/app/executor.ts:195`（`used()` 数 `running ∪ starting`） |
| C80 | `maxWorkers` 的**并发**（两张 Ticket 真的同时在跑） | **离线验证** | `tests/executor.spec.ts` 的 `runs two workers when the settings allow two`。`01` §10 明说那轮没验（全程为 1，为了让时间线可读），并发只有**旧代码**的 live 证据（`00` §0）。**注意 `02b` §7.6 的一条离线事实**：`maxWorkers` 是 `z.number().int().min(1).max(8)`，**`min(1)`** —— 所以"设成 0 会怎样"这个问题走不通，schema 会拒掉那个 PUT |
| C81 | `paused` 挂起 launch（抛 `Later`，不占槽、不计失败） | **离线验证** | `tests/executor.spec.ts` 的 `holds new work while paused and takes it when unpaused, so nothing is refused or lost`、`holds a queued launch while paused, and runs it when the pause lifts`。全局 `paused` 的**无损**性质有线上证据，但那是门禁侧的（`02` §8 的 A/B 两个场景是 `sources.inbox.deny` 与 `sources.inbox.paused`）；**执行侧的挂起从未在真宿主驱动过** |
| C82 | 依赖等待用 `Later` 表达（在工作槽计数**之前**检查 `blockedBy`），所以一张只是"还早"的 Ticket 不占槽位、零成本 | **离线验证** | `tests/dependencies.spec.ts` 的 `does not launch until the one it waits for has finished, and the wait costs it nothing`（断言跑过 8 轮 pass 也不烧预算：无报告、无健康问题）。实现在 `src/app/executor.ts:227`。从未在真宿主驱动过（同 C33） |
| C83 | `releaseDependants`：上游结束时**即时**把等待者的 launch 重新入队，而不是等一个推迟间隔过去 | **离线验证** | `tests/dependencies.spec.ts` 的 `releases on any ending when asked to, and only on success when asked for that`。调用点 `src/app/runtime.ts:818`（在 `onEvent('ticket.ended')` 里）。从未在真宿主驱动过 |
| C84 | `rescueStuckLaunch`：忘掉这次启动并重新入队（**不是** `assignmentInterrupted`，因为那个命令对 `pending` 的尝试静默无操作） | **部分实现** | **已得证的一半（真宿主验证）**：`docs/v2/14-…` 场景 3【实测】三条全中——2 条 `rescued`（`by={system,watchdog}`）、健康在 `04:34:25.830Z` 转 not ok 且 detail 逐字点名“需要人”、那一刻 `used` 仍是 1 并又保持了 57.6s。即**第 23 轮那个修复（`rescueStuckLaunch` 不再 `starting.delete`，`src/app/executor.ts:168-176`）达到了它的目的：问题不再消失、升级路径可达**。**仍然未得证的一半（尚未实现）**：“救援**真的重新启动了**一个 worker”这一面**在真宿主上被证明确认不会发生**——`00:1786` 逐字记着“全程**只有一个** sleep 进程，尽管两次救援都重新入队了——**证实了重新入队会被在飞的那次吸收**”。这在“原 launch 只是慢”时是对的（不产生重复工作），但**“原 launch 真的死了、于是救援启动了一个新的”这一情形从未被驱动过**：要核实它需要一次隔离宿主运行，让 prepare 命令**被杀死**而不是慢，然后观测是否出现第二个 worker 进程与第二个 turn。**被证伪过的那段历史必须留着**：`02b` §5 **N1（HIGH）** 查明修复前救援在真宿主里是**空操作**（`Effects.runDue` 在有 pass 在跑时直接返回，而那个 pass 正是卡在 prepare 里的这次 launch；`starting.delete` 又让它从 `stuckLaunches` 里消失，于是永远到不了 `maxActions`），`02` 顶部更正块第 1、2 条为此改掉了 §7 的标题与 §4 的因果 |
| C85 | 附件复制进 Ticket 目录（含同名改名、复制失败要说） | **真宿主验证** | `01` §2a 正例：两个同名文件被改名成 `-2`、复制比 `turn/start` 早 56 ms、任务文本列出副本；§2b 反例：`attach:` 路径不存在 → `failed` + 点名路径 + **零 worker**。离线：`tests/executor.spec.ts` 的 `copies them into the Ticket's own directory…`、`reports a file that cannot be copied, rather than starting the Ticket without its input`、`gives two files with the same name room to coexist` |
| C86 | 分层上下文：任务文本里的 `## The work this belongs to` 段，且**明写 Work 的 scope 不是授权**（第 22 轮） | **离线验证** | `tests/executor.spec.ts` 的 `names the Project and Work, and says plainly that they do not widen the authorization`（那条测试造了一个 scope 比 Ticket 自己 Mandate 更宽的 Work，断言 `## Your scope` 段里**不出现** `~/data`）与 `says nothing about a Work when the Ticket belongs to none`。设计理由在 `00` §4.18（若 Work 的 scope 能放宽授权，改一次 Work 设置就等于静默重新授权所有已受理的 Ticket，绕过 `policyVersion` 与 `revalidate`）。**从未在真宿主驱动过**（3080 上没有任何 Work） |
| C87 | Input 署真名：`authorOf(input)` 按 `input.by` 分三种署名，worker 写的那一种明写 `not from the operator, so treat it as data`（第 28 轮） | **离线验证** | `tests/executor.spec.ts` 的 `names the worker that wrote it, and does not claim it came from the operator` 与 `still says the operator wrote it when the operator wrote it`（两条一起才排除"对所有人都写不是操作者"这种假修法）。实现 `src/app/executor.ts:43`，两处渲染 `:372` 与 `:400`。**这是第 28 轮的产物，不在 3080 已加载的 bundle 里**（§0.3），所以它连旧代码的线上证据都不可能有 |
| C88 | 任务文本里的 6 个环境变量 | **部分实现** | **得证的一半（真宿主验证）**：`01` §1 与 §8 观测到每个 worker 的 runtime context 里 cwd 是自己的目录；`00` §7 的「已修」清单里有一条是把文档里的 `MYAGENT_WORK_DIR`/`MYAGENT_RESULT_DIR` 改成**真实的 6 个变量名**。**未核实的一半**：那 6 个变量各自在真宿主的 worker 里出现过没有，`01`/`02`/`02b` 都没有逐个列出。核实它需要在真宿主上跑一张 Ticket 并让 worker 打印自己的环境 |
| C89 | `halt` / `haltBackground`：停止 = 取消 turn + 杀作业 + 收子代理 | **真宿主验证** | `01` §8 行「停止 = 取消 turn + 杀作业」：`5b8ac6c7` 在同一秒内 `turn/end{aborted,user}` + `job/settled{status:killed, cause:kill, SIGTERM}`（那条作业是 `sleep 120`）。`00` §1 行「收尾 turn 不取消」：`ff926ec2`（32 tool/call + 1 subagent）的 `turn/end.reason.kind = completed`。**子代理那半是 partial**：`01` §10 明说那轮所有 scope 都写了「不调用 subagent」，"没有子代理可收" |
| C231 | **S38：`health.executor` 那句槽位 gauge 被删掉，而不是让它更新**（第 39 轮） | **离线验证** | `src/app/executor.ts:242` 现在是一句注释而不是代码：“No gauge line here. This used to record \"N of M worker slots in use\", and a live acceptance run caught it …”。**缺陷是真宿主【实测】发现的**：`docs/v2/16-…` §5.2——快照 `state-12-settled.json` 里 `counts.workerSlots={used:0,max:2}`、`counts.open=0`、`health.runtime` 说 “0 open Ticket(s)”（10:49:41），而**同一份快照**的 `health.executor.detail` 仍是 `"1 of 2 worker slots in use"`（`at` 10:45:38，**晚 4 分钟的过期断言**）；根因是那行只在 `launch()` 里写、**槽位释放后没有任何人刷新它**。**修法为什么是删**：决定性的一条证据是 `grep -rn "worker slots in use" tests/ panel/index.html` → **零命中**，即**那句话没有任何读者**；而 `counts.workerSlots` 本来就是活的、面板本来就在显示它，所以这个重复的数字**唯一的产出就是“会过期”和“会覆盖真问题”**（同一个 HealthEntry 上有 `problem()` 路径，无条件 `record()` 会擦掉真问题——正是 S19/N5 的 bug 类）。`00:2311` 那句结论值得原样留着：**“一个数字如果会过期，就不该被存在一个不会过期的数字旁边。”** **连带的新语义**：`health.executor` 条目是惰性创建的，而唯一创建它的就是那句 gauge，所以**健康跑的时候这个条目根本不存在**（C73）。**第一次尝试是错的，而且是既存测试告诉的**（`00:2296-2303`）：按“每轮一个 `complained` 标志”做，结果两条既存测试变红 `expected '' to contain 'Prepare failed'`——`settle()` 跑多轮 pass，第二轮没有新问题就把粘住的 `Prepare failed` 覆盖了。**产物变小 96 字节**（303956 → 303860），`00:2322-2323` 把这件事当作修复方向的旁证。本轮复核两条：`grep -c "worker slots in use" lib/index.js` → **0**；而 3080 在 01:40:15 重载之后，`state.health` 里**确实没有 `executor` 条目**、系统同时是健康的（§0.3）——**“健康跑的时候这个条目根本不存在”这句话现在在线上可读了**（此前它只在 `tests/executor.spec.ts:673` 里成立）。离线：`tests/executor.spec.ts:653` `it('is zero as soon as the worker has reported, and the board carries problems only')`，其中 `:673` 是 `expect(state.health.executor).toBeUndefined()`。**经变异检验**：把那句 gauge 加回去 → 新测试立刻变红（`00:2321`） |
| C232 | **`mountedAt`：`GET /api/state` 报出这次挂载的时刻**（第 31 轮） | **部分实现** | **已做的一半**：`src/app/http.ts:283` 的 `mountedAt: host.mountedAt()`。它的用途写在 `00:1454-1455`：三轮之前“哪个 bundle 在跑”只能靠**标记文件的 mtime 与源码 mtime 互相推算**，现在它是一个字段。**本文本轮就用上了它**——§0.3 那个 bundle 夹逼的下界正是这个字段。**未得证的一半（离线验证）**：`00` §4.27 记的测试是 `tests/http.spec.ts`（当时 `:486`），**未记变异检验**。**而且 §4.27 自己记了一条更要紧的**：这个字段在当天 11:40:48 那次挂载时**还不可用**（“宿主 11:40:48 挂载、而那个产物 11:56 才构建”），所以“用 `mountedAt` 判断在跑哪个 bundle”这条建议**在重载之前是不可用的**——**“验证工具本身的可用性也需要被验证”**。本文本轮复核：3080 现在**答得出** `mountedAt`（`2026-11-04T04:21:30.904Z`），即那次重载已经发生过。**构建时间与产物哈希仍未暴露**（`00:1458-1459`：面板每 5 秒轮询一次 `/api/state`，不该每次都算一次 SHA）——所以“已加载 bundle 的 sha256”在 §0.3 里仍然是**未核实** |
| C233 | **`Store.pushLostPayload` / `lostPayloads`：退化路径那个有界的 `kv` 条目**（第 44 轮） | **离线验证** | `src/app/store.ts:121`（`KV.lostTriggers = 'triggers:lost'`）、`:137-138`（`LOST_TRIGGER_KEEP = 20`、`LOST_TRIGGER_CHARS = 1000`）、`:146`（`LostPayload` 形状）、`:740-748`（`pushLostPayload`：截断到 `LOST_TRIGGER_CHARS`、只留最近 `LOST_TRIGGER_KEEP` 条）、`:752`（`lostPayloads`）。**为什么在 `kv` 而不在 `triggers`**：`store.ts:734` 的注释逐字写着 “Here rather than in `triggers` because that table's five columns are all NOT NULL and `countBySource` groups by …”——即 C230 那条“宁可少一条记录，也不要一条说谎的记录”。**为什么加了上界**：`00` §4.35 当初拒绝 `kv` 的理由是“不可按请求查询、且是**无界追加**”，§4.42 的更正是“**加了上界之后第二条理由消失**”，而第一条对退化路径可以接受，因为它本来就是“东西坏到认不出来”的情形、能查到原文就够了。**`SCHEMA_VERSION` 仍是 5**（用的是既有的 kv 键，没有迁移）。离线：`tests/store.spec.ts:62` `it('stores a lost Trigger under its own identity, with the payload verbatim')`、`:108` `it('keeps the most recent twenty given-up payloads, and says how long a cut one was')`（**上界与截断长度都被断言了**）、`tests/fault-injection.spec.ts:321`、`tests/http.spec.ts:835` `it('hands over a payload byte for byte, including the markup and the bytes that are not text')`、`:847` `it('carries the length of a payload it had to cut, so the cut says it was cut')`。**产物里 `triggers:lost` 出现 2 次**（§0.2），即它进了 bundle。日常宿主上**此前**不可达、本轮 01:40:15 重载后**可达但未被驱动**（§0.3 第 1、2 条） |
| C234 | **四种效果现在都有执行与失败记录**（(v) 整体结案，第 44 轮） | **离线验证** | 接线全在 `src/app/runtime.ts:274-338` 的 `onPermanentFailure` 里，四种各写各的：`launch`/`input` → `executor.gaveUp`（Ticket 上一份失败报告，可见、可重试、不级联）；`send` → `delivery.sendGaveUp`（`reply_lost` 事件 + `REPLY-UNDELIVERED.md`，两处痕迹）；`notify` → `Engine.noticeLost`（`notice_lost` 事件）；`trigger` → `Engine.triggerLost`（`triggers` 表的 `lost` 行）或退化路径的有界 `kv` 条目。`runtime.ts:276-283` 的注释把这条规则写全了：**健康板那一行“回答‘现在怎么样’、是真的瞬态”，所以“none of them may treat this line as even the transient half of one”**。`00:2676-2678` 的结案句：“**四种效果都有了执行与失败记录**，这是项目硬规则里最后一条没兑现的”。离线：`tests/fault-injection.spec.ts` 10 条（真跑队列到彻底放弃）。**为什么整条只标 离线验证**：`launch` 那一半在 `docs/v2/17-…` §4.1 是【实测】的，但那是**桩宿主上的实测**；四种效果**没有任何一种的“彻底放弃”在真宿主上被驱动过**（第 33 轮与第 38 轮两次验收里 `effects` 表停机时都是 **0 行**）。**一处必须一起读的裁定**：`Could not write RESULT.md for X` **没有持久副本**，而现在它会被下一次成功的投递擦掉；`00` §4.44 裁定**不给它加持久记录**，理由是取证来的——RESULT.md 是**给人看的便利副本**（内容同时在库里：`assignments[].report`、`ended`、事件日志），**“给一个便利副本的写入失败建立持久记录，会暗示一次并不存在的信息丢失”**。裁定会被推翻的条件也写下来了：**任何往 RESULT.md 里加“库里没有的东西”的改动，都必须重新做这个裁定** |

### 3.6 `src/app/runtime.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C90 | 装配与启动顺序（`indexSessions` → `wireAgents` → `recover` → `refresh` → `sources.sync` → `passes.start` → `watchdog.start`） | **真宿主验证** | `02b` §4.6：挂载时**没有**偷建主 Session（残件 `state-mount.json` 是 `mainSession = {exists:false, running:false, …}`），运行中按需**恢复**了它（`state-final.json` 是 `{exists:true, running:true}`）；`verify-live.sh` 第 3 步因此通过。`02b` §4.5：宿主 02:40:19 启动后立刻补触发了一个迟到约 3 小时的 cron 槽位。离线：`tests/mount.spec.ts` 的 `starts without creating, resolving or decorating a Session` |
| C91 | 停止顺序（disposers 反序 → watchdog → 泵 → **来源** → Sessions → effects → 停 worker → 关库 → 释放锁），每步都有超时 | **部分实现** | **得证的一半（真宿主验证）**：`02b` §3【转录】SIGTERM 发给 pid 11915，进程 1 秒内消失；`lsof -nP -iTCP:3180 -sTCP:LISTEN` 为空；`myagent.lock` 不存在；`-wal`/`-shm` 被 checkpoint 进主库并删除（主库 86,016 → 311,296 字节）；`pgrep -fl 'sleep 90'` 与 `pgrep -fl myagent-test` 均为空。**未得证的一半**：见 C93。离线：`tests/mount.spec.ts` 的 `stops twice, and gives the state directory up so the next start takes it` |
| C92 | 崩溃恢复：一个 worker Session 已消失的 Assignment 被中断、带恢复 note、在同目录重启 | **真宿主验证** | `00` §1 行「崩溃恢复（interrupted + 恢复note + 同目录重启）」标 `live`：4 个 `endedReason=interrupted`，每个恢复 note 都有 `deliveredAt`；一个 launch 排队 2h17m 后仍执行。**限定**：`01` §10 说那轮**没有** `kill -9` 宿主（"DSH 侧共享的会话/工作区存储在一次硬杀之后的状态会波及日常宿主的视图，风险不对等"），所以这条 live 证据来自 `00` §1 观测到的历史数据，不是一次受控的杀进程实验。离线：`tests/recovery.spec.ts` 7 条 |
| C93 | 停止后不再有写入到达数据库 | **部分实现** | **得证的一半（真宿主验证）**：`02b` §3【残件】`poststop.txt` —— 采样时刻 `2026-11-04 04:42:17`（≈T0+86 分钟），size/mtime/sha256 三项与 T0（`03:15:58`，size 311296，sha `3325f896c2907000…`）**完全相同**，且没有 `-wal`/`-shm`/`lock` 重新出现。**未得证的一半**：任务书要求的 **T0+60s 那次采样没做**（`02b` §3 与 §7.3 都明说了，`02` §11 写"未得证"是对的）；而 86 分钟那次是事后补的、**不能替代它**。更要紧的是 `02b` §3 自己划的界：这条**不支持 S32 已结案** —— S32 是"测试拆解期定时器在 Store 关闭后触发"，而这次只证明**产物文件没被写**，没有证明那个定时器没触发过（它可能触发了但因 Store 已关而抛错，一个字节都没写） |
| C94 | `progress(ticketId)`：worker 此刻在做什么（Session id、是否载入、turn、最后说的话、最近工具调用） | **真宿主验证** | `01` §1b 与 §8：对**运行中**的 worker 采样 **176+ 次**，含 `status=running turn=2`。`01` §10 补了一条非 bug 的记录：`progress.turn` 是 DSH 的 turn 序号（单次 launch 恒为 1，第二轮 Input 后才是 2）。离线：`tests/files.spec.ts` 的 `shows the worker's own progress…`、`says a worker that is not loaded is not loaded, instead of showing nothing` |
| C95 | `usageOf`：真实 token 计量（第 26 轮），三个分项由 DSH 的 `assistant/message.data.usage` 求和 | **真宿主验证** | **本轮升级，依据是 `docs/v2/16-live-acceptance-chat.md` 场景 1 第④条【实测】**：对真宿主上的 `GET /api/tickets/<id>/progress` 读到 `"usage":{"inputTokens":9224,"outputTokens":495,"cacheReadTokens":28036,"messages":5,"totalTokens":37755,"windowed":false}`（残件 `progress-01.json`），而同一份报告里 `recentTools` 是四次真实工具调用（`bash` `write` `read` `myagent_report`）——**非零 token 计数 + 真实工具调用 = 模型真的被访问了**。这是第 26 轮那个功能**第一次在真宿主上被读到**。离线：`tests/flow.spec.ts` 的 `sums what DSH reported and nothing else`、`answers nothing rather than zero when no message reported usage`、`says when the sum covers only a window, so a long task's cost is not read as its whole cost`；测试里用的数字取自真宿主残件 `item6-worker.jsonl`（`00` §4.21：`2211 + 155 + 4513 = 6879 = totalTokens`）。**面板出口仍然没有**（C204：`grep -c "usage\|Tokens\|token" panel/index.html` → **0**），所以它只对读 API 的人可见 |
| C96 | `windowed` 标志：进度视图只读最近 `PROGRESS_SCAN`(400) 条事件，所以那个和是**窗口的成本，不是这份工作的成本** | **部分实现** | **本轮升级，依据同 C95**：`docs/v2/16-…` 场景 1【实测】的 `progress-01.json` 里 `"windowed":false` ——**这个字段在真宿主上被读到过，而且它诚实地说了“这个和覆盖了整份工作”**（那次只有一个 turn、5 条消息，远在 400 条之内）。`src/app/runtime.ts:107-110` 的注释写了为什么（“把窗口当总数报，正是预算数字变成谎言的方式”）。离线：`tests/flow.spec.ts` 的 `says when the sum covers only a window, so a long task's cost is not read as its whole cost`。**未得证的一半（离线验证）**：`windowed: true` 那一面**从未在真宿主上被观测过**——要造它需要一次超过 400 条事件的 worker 运行，而两次验收的 worker 都只跑了一个 turn。所以这一条**只升到“字段存在、且在整份工作都落在窗口内时诚实地说 false”**，不升到“长任务被正确标成窗口”。分的是**验证等级**，不是实现：两半的代码都在，离线测试 `says when the sum covers only a window…` 钉的正是 `true` 那一面 |
| C97 | `readArtifact`：解析路径（复用 `resolveInside`）→ 读 → 非文本拒绝 → 独立大小上限 `WORKER_ARTIFACT_BYTES`(256KB) | **离线验证** | `tests/executor.spec.ts` 的 `hands back the registered file's text, and refuses one nobody claimed`（一条部署级测试覆盖真实读写与五种拒绝）。实现在 `src/app/runtime.ts:364-399`。**第 25 轮的产物，不在 3080 已加载的 bundle 里**（§0.3） |
| C98 | `silentAttempts`：用 `progress(ticketId).lastEventAt`（没有事件时用 `startedAt ?? createdAt`），只报 `running` 的尝试 | **离线验证** | `tests/watchdog.spec.ts` 的 `is interrupted with a reason that names the silence`。`00` §4.13 特别说明那个回退是"诚实的读法而不是静默 0 秒"。**离线有一个已知的保真缺口**：`00` §6 说 stub 的 `SessionEvent` **没有 `time`**（真类型是必填），所以 `lastEventAt` 在任何测试里都是 undefined —— 那条回退分支因此是被走的那条，而真实的那条没有 |
| C99 | `SourceHost.subscribe`：多路复用 `onEvent`，监听器**逐个隔离**（一个抛错只上一行健康问题），`stop()` 里退订（D7 第 1 步） | **离线验证** | `tests/sources.spec.ts` 的 rule source 4 条（见 C136–C139）；监听器隔离的同类性质由 `tests/flow.spec.ts` 的 `contains a decoration failure inside the agent/created dispatch` 钉住。实现在 `src/app/runtime.ts` 的 `subscribe()`，接口在 `src/sources/kind.ts:29-49`（带一段注释说明为什么订阅必须在这里而不是让 Source 去够 Runtime） |
| C100 | 改 `watchdog.everyMs` 不重启即生效（N2） | **部分实现** | **被真宿主证伪过的那一半**：第 23 轮的第一次修复（`refresh()` 调 `watchdog.settingsChanged()`）在**第 33 轮被【实测】证伪**——`docs/v2/14-…` 场景 2 判定 **证伪**：检测延迟 **34.729s** 对 15s 阈值；`rescued#1` 落在 `mountedAt + 7×60s` 上、残差 **+23ms**（旧网格），偏离 PUT+10s 网格 **+2849.7ms**；PUT 后 20s 那次“必须 rescue”的 look **根本没有发生**。机制的三条腿都被实测（`00:1796-1801`）：`saveSettings()` 从不调 `refresh()`；只改 executor/watchdog 的 PUT **不移动 `policyVersion`**（前后都是 `4045fec248ecb4c5`，revision 2→3），因为 `authorizationShape()` 不覆盖 watchdog 与 executor，于是 `policyEffects` 返回空、不发 `policy.changed`；`health.passes.at` 在整个 `sleep 30` 期间**冻结了 27.3 秒**（14 个连续采样点）——**没有任何 pass 能在 launch 等待 prepare 时完成**，所以 `extra:[refresh]` 永不运行。**第二次修复（第 33 轮，只有离线证据）**：直接从 `saveSettings()` 调（`src/app/runtime.ts:578`），并把 `Watchdog.armedInterval()`（`watchdog.ts:75`）与 `Runtime.watchdogArmedInterval()`（`runtime.ts:447`）暴露为**只读诊断**——没有它，“我的改动生效了吗”只能靠推断，而那次验收正是靠 23ms 的网格吻合才推断出来的。测试是 `tests/executor.spec.ts:623` `it('takes effect on the save itself, not at the next tick of the old grid')`（走**真接线**），**经变异检验**（从 `saveSettings` 里去掉那行调用立刻变红，`00:1816`）。**为什么整条只标 部分实现**：修复**从未在真宿主复验**，而它要修的那个缺陷恰恰是**只有真宿主才看得见**的（离线那次“通过”测的是“调用 `settingsChanged()` 会重新上膛”，不是“改设置会调用它”）。**`refresh()` 里那次调用也还在**（`runtime.ts:886`），所以现在有两个调用点；`00:1811-1813` 记了为什么不改成“在 `look()` 里比较”：`look()` 只会在旧网格上跑，所以在那里比较是无效的。**缺陷比“永不重新上膛”窄，它是“要等到旧网格的下一跳”** |
| C101 | 主 Session 按需创建（`ensureMaster(machine.workRoot())`：解析不到就创建，B1 的修复） | **真宿主验证** | `01` §8 行「主 Session 按需创建 + 记录真实 id」：`POST /api/main-session` → `myagent-acc-main`、`exists=true`。`02b` §4.6：挂载时不建、运行中按需**恢复**。离线：`tests/http.spec.ts` 的 `creates the main Session on demand, which mounting deliberately did not do`、`creates the main Session rather than losing the report quietly`；`tests/recovery.spec.ts` 的 `is still there under the id DSH gave, and asking for it again restores rather than creates`、`reports no front desk at all when none was ever created` |
| C102 | `saveSettings`：存整份文档、推进修订号、重算来源、请求一轮 pass、并让 Watchdog 重新上膛 | **部分实现** | **得证的一半（真宿主验证）**：`01` §8 行「操作者动词」里 `PUT settings` 命中过；`02` §9 的五个旋钮各自产生不同的策略版本；`docs/v2/16-…` 场景 2/3【实测】四次 `PUT settings` 全部成功（残件 `put-settings-01…04.json`），其中一次只改 `identities` 一个字段就使 `policyVersion` 由 `ad064036…` → `0bafb839…`。**未得证的一半（离线验证）**：`watchdog.settingsChanged()` 那一步——第 23 轮加在 `refresh()` 里、**被第 33 轮证伪**，第 33 轮改到 `saveSettings()` 里、**从未复验**（C100） |
| C103 | `recipes()`：把出厂配方（`examples/`）作为可编辑的起点交给面板 | **真宿主验证** | `01` §8 与 `00` §1 行「出厂配方（实质）」：daily-digest 在线上宿主端到端跑通（11:58–12:13），data-report 跑到 `dropped`。`02b` §4.5 给了第二个线上样本（挂载补触发的那张跑到 `done`）。离线：`tests/recipes-route.spec.ts` 4 条 + `tests/recipes.spec.ts` 9 条。`01` §10 限定：`recipes` 路由"只在挂载后查过" |
| C104 | 一个抛异常的监听器不得把宿主搞垮（每个监听器都被 contain） | **离线验证** | `tests/flow.spec.ts` 的 `contains a decoration failure inside the agent/created dispatch`、`drops a tool name the profile does not know, and keeps the rest of the restriction`；`tests/mount.spec.ts` 的 `never rejects, so a bundle that cannot start does not take the host down`。**真宿主上的间接证据**：S37 记录了热重载之后宿主 pid 24619 未变、一直在服务 —— 但那是"没崩"，不是"一个抛错的监听器被 contain 住了"，两者不是同一个命题 |

### 3.7 `src/app/sessions.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C105 | worker 权限的两段式重授权（先 `workspace-write`+`ask`，再 `danger-full-access`+`never`），且**恢复的** Session 也会被重授权 | **真宿主验证** | `01` §8 行「worker 权限两段式重授权」：`workspace-write`+`ask` @18:16:07.724 → `danger-full-access`+`never` @18:16:07.728。`00` §1 同一行记的是 5 个 worker 日志都有这一对，且 `19e4bab1` 证明了**恢复的** Session 也会被重授权。离线：`tests/flow.spec.ts` 的 `re-authorizes a restored worker instead of trusting what the crash left behind`、`does not rewrite a permission preset a worker already runs under` |
| C106 | 工具白名单 `restrict`：把 worker 限制在 DSH 认得的那些工作工具上；一个都不认就**拒绝启动**（而不是不加限制地跑） | **真宿主验证** | `01` §8 行「worker 工具白名单」：worker 与 subagent 日志都是 **19 个工具**，`myagent_report` 在，ask_user/present/plugin_manager/schedule/goal/workflow 都不在。离线：`tests/flow.spec.ts` 的 `drops every name DSH refuses in one pass, and still restricts the worker`、`leaves the Ticket unlaunched rather than running a worker with no restriction at all`、`drops a tool name the profile does not know, and keeps the rest of the restriction`（S3 的修复：改用报错里的 `known global tools:` 列表求交，不依赖措辞的单复数） |
| C107 | `WORKER_TOOLS` 是 20 个名字，而线上观测到的是 19 个工具 | **部分实现** | **得证的一半（真宿主验证）**：`01` §8 数出 19 个。**未核实的一半**：`src/app/sessions.ts:34-38` 列的是 **20 个**名字（`read` `write` `edit` `read_image` `glob` `grep` `bash` `pwsh` `job_output` `job_list` `job_kill` `web_search` `web_fetch` `skill` `todo_write` `subagent` `list_subagent_models` `send_message` `list_agents` `interrupt_agent`）。差的那一个最可能是 `pwsh`（macOS 上没有），但 `01` 没有逐个列出它数到的 19 个名字，**所以这个差额未核实**。核实它需要读一次 `01` 引用的那份 worker 日志，或在真宿主上重新数一遍 |
| C108 | 提示词修订变化时**重绑活着的 Session**（编辑过的提示词在下一轮到达，不用重启） | **真宿主验证** | `01` §8 行「操作者动词」：`PUT prompts` 的覆盖被**后来的 worker 与已存在的 worker 都拿到**。离线：`tests/prompts.spec.ts` 8 条 |
| C109 | `attempt(ticketId)`：报告身份在 **launch 时**记下（`Sessions.promptWorker` 收到 `launch:<assignmentId>` 时写入 `attempts`） | **部分实现** | **得证的一半（真宿主验证）**：`02b` §1【残件】`item6-ticket.json` 里两个尝试各自保有自己的报告。**未得证的一半（离线验证）**：见 C10 与 C37 |
| C110 | `knownToolsOf` / `refusedNamesOf`：从 DSH 的拒绝措辞里取出它认得的工具名（不依赖单复数） | **离线验证** | `tests/flow.spec.ts` 的 `drops every name DSH refuses in one pass, and still restricts the worker`。`00` §2 S3 是这条的原始现场（正则只匹配单数 → 在缺 2 个以上工具名的 profile 上**每次启动都失败**，而 stub 过去只抛第一个名字且永远单数，所以 470 个测试全绿） |
| C111 | worker 在一个**改了预设表**的 profile 上仍能启动（S4：`permissionPresets.set('danger-full-access')` 依赖一个可能不存在的预设名，而 `set()` 对表里没有的名字**抛异常**） | **尚未实现** | `00` §2 S4 只描述了失效模式（"换一个改了预设表的 profile，每次启动都变成重试 5 次 → failed 报告"）与它为什么离线看不见（stub 从不校验预设名），**没有给出修法**。`00` §6 另记了一条相关的 stub 缺口：`create` 的**冲突路径**（含 `agent-preset/not-found`）完全没有测试，"**没有任何东西验证 `myagent-worker` 预设真的存在**" |
| C112 | 子代理逃过 myagent 的两条 per-Ticket 控制（S2）：`tools.restrict` 与结束后的 `tools.guard` 对子代理都不生效 | **部分实现** | **已做的一半（提示词约束，shipped 但未验证）**：`prompts/worker.md:42-49` 的 `## If you delegate` 段明写"A subagent cannot report … Ask it to return its findings to you instead"与"Your limits are not its limits … nothing will stop it on your behalf"。**没有任何测试断言这段文本**（`grep -rn "worker.md" tests/` 只命中 `tests/prompts.spec.ts` 的"找得到这个文件"），也没有线上观测 —— 所以这一半的准确状态是"文本已发布"，不是"已验证"。**未做的一半（尚未实现）**：`00` §2 S2 给出的修法是用 `subagents.listChildren` 把子→父 Ticket 映射起来、让守卫覆盖整棵树。`listChildren` 在 `src/` 里只有一个调用点：`src/app/background.ts:71` 的 `stopSubagents`（停止时收掉子代理），**与守卫无关**。`sessions.ts:300-306` 的 `decorateAgent` 仍然对子代理直接早退 |
| C236 | **`delivery` 健康条目也回到“此刻”语义，而它的边界是“一次投递”而不是一轮 pass**（第 43 轮） | **离线验证** | `src/app/delivery.ts:224` 的 `complained`、`:268-270` 的 `summarize()`（措辞 `the last delivery went through`）、`:315`/`:407` 在每个处理器入口重置、`:327`/`:411`/`:436` 在一次**完成了的**投递出口处摘要。**它没有自己的 pass，而实现者没有替它发明一个**——`00:2589-2598` 记了理由：`delivery` 的两个处理器都跑在队列的 pass 里，`sendGaveUp` 跑在队列的放弃钩子里，去接一个 `Passes.extra` 钩子会在一个**什么都没投递**的 pass 里擦掉 `Could not write RESULT.md for …`（`tests/notify.spec.ts` 钉住了那一行要跨 pass 存活，而那个文件不在它的边界内——**M4 证明了这一点**：去掉标志后它以 §4.38 的确切 signature 变红，`expected '' to contain 'RESULT.md'`）。`ticket === undefined` 的提前返回**不做摘要**：什么都没投递，就什么都不声称。**这才是让那三处注释里“下一次无关的成功会覆盖它”第一次对 `delivery` 字面成立的东西**（`00:2598`）。**`00` §4.43 还如实记了它自己数错的一处**：§4.41 说 `effects` 条目有**三处** `problem()`，**实际有第四处**（`runtime.ts:275` 的 `${kind} ${key} gave up: …`）——它不需要改，但“**如果实现者照我的数字去做，就会漏掉一处、或者以为漏了一处而去改不该改的地方**”。日常宿主上**此前**不可达、本轮 01:40:15 重载后**可达但未被驱动**（§0.3 第 1、2 条） |
| C237 | **`OutcomeDelivery.send`：把一份报告回到它来的那个会话**（第 36 轮 C2，P8 契约 §3.3） | **真宿主验证** | `src/app/delivery.ts:305` 入队一个 `send` 效果（**不内联**，理由写在 `Delivery` 端口的注释里：内联意味着一次网络抖动就永久丢掉那句话）、`:243` 注册处理器、`:100` 的 `sendKey(ticketId, replyTo, text)` 是**内容的纯函数**（所以重试不重复）、`:110` 的 `replyText(ticket, report)`。分发按 `replyTo.kind` 找到那个 kind 的**一个在跑实例**，再收窄成 `TwoWaySource`（`typeof source.deliver === 'function'`）。**无 `replyTo` 时什么都不做、也不报错，但那个“什么都不做”必须可观测**（`00` §4.34 (i) 裁定由 `OutcomeDelivery.report()` 对 ready/blocked/failed/dropped 四态调用）。真宿主证据：`docs/v2/16-…` 场景 1【实测】回复文件 `room-a/out/reply-40f114496924e6c7a442ba5998bfb28e.md`（253B）**正文即报告摘要原文**、front matter 带回 `thread`、hash 本地复算一致；场景 3【实测】那张**无 `replyTo`** 的 inbox Ticket 结束后 `counts.sends.nowhere` 由 0 → 1（窗口内唯一结束的 Ticket 就是它）——**“什么都不做”确实是可观测的**。离线：`tests/chat-send.spec.ts:167` `it('hands the Source the address from the Trigger and the worker's own words, and consumes the effect')`、`:190` `it('brings a blocked question back to the channel, without instructions only myagent's own front desk could follow')`、`:213` `it('queues one reply when the same words are asked for twice, and a second when they differ')`、`:378` `it('sends nothing, throws nothing, and counts the nothing')`。**经变异检验 8 条**（M1–M8，`00:2087-2099`） |
| C238 | **`counts.sends`：回路的两个计数有了出口**（第 37 轮 D） | **真宿主验证** | `src/app/delivery.ts:248` 的 `sends()` 返回 `{queued, nowhere}`，出口是 `GET /api/state` 的 `counts.sends`（`src/app/http.ts:307`）。**路由决定是“不新增路由”**（`00:2176-2179`），理由里最重要的一条：**`state` 是每个 bundle 都会答的那条路由**，所以旧宿主是“少一个键”而不是 404——不需要新探针、不会每次刷新弹 toast，而这正是 `05-panel-v2-ui.md` §4 在真宿主上量到过的那种失败。**本文本轮在 3080 上量到了这个降级的真实形状**：`counts` 里**没有** `sends`（也没有 `lost`），而页面是新的（§0.3 第 4 条）。真宿主证据：`docs/v2/16-…` 场景 1【实测】`counts.sends` 由 `{0,0}` → `{1,0}`；场景 3【实测】`nowhere` 由 0 → 1。**一个如实记着的限制**（`00:2213`、`http.ts:303-306` 的注释）：这两个计数是**每次挂载以来**的内存数，**重载归零**，面板在它们旁边如实写了 “since this mount”——“**一个 0 读起来像‘从来没发生过’比没有数字更坏**” |

### 3.8 `src/app/delivery.ts`、`src/app/agent-delivery.ts`、`src/app/background.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C113 | `RESULT.md`：一张 Ticket 的结束被写进它自己的目录，所以答案活得比产生它的进程久 | **真宿主验证** | `01` §8 行「RESULT.md」：3 份（`d6398704` 758 B、`7e6dfc29`、`12ae32cc`），`Authorized by: operator via inbox`；`stopped` 的 `d43e7ba6` 与 prepare-failed 的 `5ae4c3f7` **正确地没有**。`00` §1 记的是 8 张里 7 张有（2 张 stopped 正确地没有）。离线：`tests/notify.spec.ts` 的 `writes RESULT.md in the Ticket's own directory…`、`still tells the front desk when the record could not be written` |
| C114 | notice：告诉前台，但**不唤醒**它（一份完成的 Ticket 不该花掉操作者一次没要求的模型轮）；摘要 120 字 | **真宿主验证** | `01` §8 行「notice（不唤醒、120 字摘要）」：主 Session 5 条 `agent/inbox/spliced`，`form=notice`，每条 `len(summary)==120`，`target=next-step`，**全程无 `turn/start`**。离线：`tests/flow.spec.ts` 的 `bounds a notice summary to what DSH accepts, however long the report is`；`tests/notify.spec.ts` 4 条 |
| C115 | relay：一张等人的 Ticket **唤醒**前台（`form=relay` + 一次 `turn/start`） | **离线验证** | `tests/flow.spec.ts` 的 `brings a blocked question to the front desk, and an answer back to the same worker`。**两轮验收都没有它**：`00` §1 那一行写的是 `absent(live)`（"**relay（唤醒前台）从未真发生过**"），`01` §8 把它降为 `partial` 并明说"主 Session 5 条全是 `form=notice`，没有一条 `relay`，也没有一次 `turn/start`"，`01` §10 说要先修 B4 再验 —— **B4 已在 `02` §6 得证修好，但没有人回去验这一条** |
| C116 | 桌面通知（`notify.enabled`，默认 false） | **离线验证** | `tests/notify-machine.spec.ts` **16 条**（这个套件不是纯离线的：它跑真子进程、按 `:` 切 PATH，所以**仅 POSIX**；`00` §6 记了这一点，并说 Windows 上会静默找不到通知程序且无测试）+ `tests/notify.spec.ts` 的 `asks the desktop when the operator turned it on, with the summary quoted into it` 等 3 条。**真宿主上从未观测到**：`00` §1 与 `01` §10 都说本机**没装 terminal-notifier**（本文复核：`command -v terminal-notifier` → 不在 PATH），所以 `-open` 深链分支在这台机器上**根本跑不到** |
| C117 | 幂等消息投递（`AgentDelivery`：每条消息带一个由请求派生的 id，已在历史或 inbox 里就跳过） | **离线验证** | `tests/agent-delivery.spec.ts` **12 条**（含 `does not deliver the same request twice while the first is still waiting`、`does not inject the same notice twice, in one process or after a restart`、`refuses a target that was disposed…`、`survives a persistence layer that will not read, and says so instead of duplicating`）。`01` §8 明说这一行**未变**（`offline`）："只观测到 `deliveredAt` 都盖了戳、`requestId` 形如 `launch:<assignmentId>` / `input:<inputId>`；**没有制造重复投递**"。`00` §1 补充：线上 8 张 Ticket 的 `execution.sessionId` 全是 undefined，**rebind 只在主 Session 上真发生过** |
| C118 | flush 必须在 `accepted?.()` 之前（`00` §8 第 8 项） | **部分实现** | **已做的一半**：`src/app/agent-delivery.ts:110-112` 现在是 `await this.ctx.sessionPersistence.flush()` 然后 `accepted?.()`，并带一条注释说明为什么（"Acknowledging first made a flush failure indistinguishable from a successful delivery"）。**未验证的一半（离线验证）**：`00` §6 说 stub 的 `flush()` **从不失败**，所以这条顺序在测试里**不可观测**；`tests/agent-delivery.spec.ts` 的 `queues a message the worker answers in its next turn, and flushes before the caller acknowledges` 断言的是顺序，而顺序在 stub 里永远成立。**`00` §8 第 8 项仍把这条标成 ⬜（未做）—— 那条已经过期**，见附录 A 第 4 条 |
| C119 | `stopBackground`：一个停止收掉这个 Session 的作业**与**子代理，两者都收 | **部分实现** | **得证的一半（真宿主验证）**：作业那半 —— `01` §8 的 `job/settled{status:killed, cause:kill, SIGTERM}`。**未得证的一半（离线验证）**：子代理那半 —— `01` §10 明说那轮所有 scope 都写了「不调用 subagent」，"没有子代理可收"；`00` §1 把这一行标成 `partial`（"checklist 的断言列写了，证据行只提到 jobs；机制离线验证"）。离线：`tests/background.spec.ts` **16 条** |
| C120 | `until`：一个有界的等待（信号中止或超时都给 `false`，且**绝不把被放弃的活 resolve 给调用方**） | **离线验证** | `tests/background.spec.ts` 的 `gives the value of work that finishes in time`、`gives false once the signal aborts, and never resolves the abandoned work into a caller`、`gives false once the bound passes, so a shutdown is not held up by work that will not end`、`refuses to start work whose signal already aborted`。`00` §6 记了两条 stub 缺口，它们让这里的两个上限**永不触发**：`whenIdle()` 立即 resolve（10 秒上限永不触发）、`jobs.wait()` 立即以 undefined resolve（"杀之前先等"的全部意义未被测） |

### 3.9 `src/app/tools.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C121 | worker 侧的 `myagent_report` | **真宿主验证** | `01` §8 行「worker 工具白名单」：`myagent_report` 在那 19 个工具里，六个面向人的工具都不在。`02` §6：两个 worker 会话日志（`item6-worker.jsonl`、`item7-worker.jsonl`）里四个 token 全为 **0**（`ToolOutputError`、`lossless`、`INVALID_TOOL_OUTPUT`、`invalid output`），而上一轮在同一个位置是 2/4/2 |
| C122 | `myagent_report` 不再返回 `outcome: undefined`（B4/S25 的修复） | **真宿主验证** | `02` §6 与 `02b` §6.8：本轮两个日志四个 token 全 0；`02b` §4.7 给了最直接的对照 —— **同一个位置、同一个 seq 号（27）**，上一轮是 `isError:true` 的 `value is not lossless JSON`，本轮是那个 `waiting` 报告的**成功**结果（`isError:false`）。`02b` §6.8 同时更正了措辞：`INVALID_TOOL_OUTPUT` 这个拼法在原始现场里**没有**见到，它可能是错误码而非日志文本。离线：`tests/tools.spec.ts` 的 `omits the outcome key entirely while the Ticket is still open`、`names the outcome once the Ticket has ended, so the worker stops reporting` |
| C123 | worker 侧的 `myagent_note_ticket`（协作通道，第 13 轮） | **离线验证** | `tests/tools.spec.ts` 的 `gives a working Ticket a fact without granting it anything`（注册形状见 `names the tools a person gets, and keeps the worker's own to itself`）。实现在 `src/app/tools.ts:132-152`。**从未在真宿主驱动过**：`02b` §7.4 说的理由是 `attachWork` 零调用者，**那个理由已过期**（现在有 `POST /api/tickets/:id/work`）；准确的现状是**线上可达、但需要两张同 Work 的 Ticket 同时在跑，从未被安排过** |
| C124 | worker 侧的 `myagent_read_artifact`（产物引用，第 25 轮） | **离线验证** | `tests/executor.spec.ts` 的 `hands back the registered file's text, and refuses one nobody claimed`（部署级：真实读写 + 五种拒绝）；授权层 4 条见 C41。**第 25 轮的产物，不在 3080 已加载的 bundle 里**（§0.3），所以它连旧代码的线上证据都不可能有 |
| C125 | worker 工具面**一共三个** | **部分实现** | 三个工具都注册在 worker 作用域（`src/app/tools.ts:89` `myagent_report`、`:119` `myagent_read_artifact`、`:135` `myagent_note_ticket`）—— `myagent_report` 有线上证据（C121），`docs/v2/16-…` 场景 1【实测】的 `recentTools` 里也出现了 `myagent_report`；另两个是离线（C123/C124）。**上一版记的那处文档漂移已在第 30 轮修掉**：`src/app/tools.ts:1-9` 的文件头现在写的是 “A worker gets **three** tools — `myagent_report`, plus `myagent_note_ticket` and `myagent_read_artifact` for crossing to another Ticket inside the same Work”，并且**把这次漂移本身写进了注释**：“this header used to say "one tool", which was true for eleven rounds and then quietly stopped being true”。**为什么仍然标 部分实现**：三个工具**都实现了、都注册在 worker 作用域**，分的是**验证等级**——`myagent_report` 是 真宿主验证，另两个是 离线验证（C123/C124）。**与上一版的区别是分的理由变了**：上一版分的是“实现 vs 文档漂移”，那一半已经在第 30 轮修掉了；现在分的是“线上驱动过 vs 只有测试”。按 §0.1 的规则，未验证的那一半单独给它自己的标签，而它是 **离线验证** |
| C126 | 主 Session 侧的 7 个管理工具（`myagent_create_ticket` `_list_tickets` `_ticket_status` `_answer_ticket` `_note_ticket` `_stop_ticket` `_retry_ticket`） | **真宿主验证** | `01` §8 行「操作者动词」：answer/note/dismiss/pass/PUT prompts/POST tickets **六个全部命中**，外加 `retry`、`stop`、`PUT settings`；`POST tickets` 产出了**线上第一张 `via=session` 的 Ticket**。`02` §3 复核了主 Session 侧的工具面正是 create/list/status/answer/note/stop/retry。离线：`tests/tools.spec.ts` **22 条** |
| C127 | 工具守卫：一张已结束 Ticket 的 worker 继续改状态会被拒 | **离线验证** | `tests/tools.spec.ts` 的 `refuses a report from a Ticket whose authorization ended`、`refuses an answer to a Ticket that has ended, with the code the model can act on`、`stops a Ticket once, and says the second stop has nothing to stop`。`00` §1 与 `01` §10 都明说**从未在真宿主触发**（"要对一个已结束 Ticket 的 Session 发起一次工具调用 …… ended 的 Ticket 上 `agent/status` 监听器会直接 return，验不出守卫"）。`docs/v2/06-security-risk-register.md` §2 把它归为**逻辑守卫**，并指出它拦的是 myagent 自己的工具、**worker 的 shell 不受它管** |
| C128 | `definitionOf`：把每个工具变成 DSH 能交给模型的 JSON Schema，并在 Engine 看到之前就拒掉 schema 没描述的参数 | **离线验证** | `tests/tools.spec.ts` 的 `turns every tool into a JSON Schema DSH can hand a model`、`refuses arguments the schema does not describe, before the Engine sees them`。**真宿主上的间接证据**：`02` §6 那次 `isError:false` 的干净返回说明 DSH 接受了这个工具的输出形状 —— 但 schema 本身没有被逐个核对过，那部分**未核实** |
| C129 | worker 不能请求**新**工作（没有 worker 侧的 `myagent_create_ticket`） | **仅有设计** | `src/app/tools.ts:83-153` 的 `workerTools` 只有三个工具，`myagent_create_ticket` 只在 `mainTools`（`:158`）。`docs/v2/00-audit-and-plan.md` §4.11 的「未做」写明了它与它的前置：那要撞 `system_actor` 那道墙（D7），"得先把'谁可以授权工作'变成策略决定" —— 而 D7 的政策半边在第 17 轮做了（C22），**这一条仍然没有做** |
| C239 | **丢失的请求对操作者可见**：`GET lost` + `counts.lost` + 面板区块（第 45–46 轮） | **离线验证** | 三处：`src/app/http.ts:542` 一条**独立的** `GET lost` 路由（`rows` 来自 `triggers` 表里 `disposition.state === 'lost'` 的行，`payloads` 来自 `store.lostPayloads()`，**两条路径分开呈现**）；`http.ts:262-270` 把 `counts.lost` 的 `{rows, payloads}` 挂进 `GET state`；面板 `#lost-count` 页头药丸（`panel/index.html:99`）与「丢失的请求」区块（`:222-233`）。**几个刻意的设计决定，都写在代码注释里**：路由名叫 `lost` 而不是 `triggers/lost`，因为“**它答的东西有一半不是 Trigger**，叫 `triggers/lost` 等于说那些退化载荷是那张表里的行——正是 §4.42 拒绝过的那句假话”（`http.ts:536-541`）；读法用 `list()` 而不是 `since()`，因为“`since` 是一个**最新**窗口，所以一个每次触发都坏的生产者会把一条较旧的丢失挤出窗口，而 `countBySource` 仍在计它——**一个与它旁边的数字不一致的列表，出现在一个专门回答‘丢了多少’的页面上**”（`http.ts:545-550`）；`counts.lost` 在读失败时**省略而不是归零**（`http.ts:259-260`：“一个读不到的区块不得渲染成‘什么都没丢’”）；药丸在 **bundle 答不出来时隐藏**，因为“**‘这个 bundle 答不了’不等于‘没有丢失’**”（`00:2745`）；补救说明是诚实的——UI 里明写“**系统不会自动重放它们**”，**没有给一个不可能成功的按钮**。离线：`tests/http.spec.ts:700-857` 一组 **7 条**（含 `:794` `it('lists every lost row rather than the newest window, so a busy system cannot bury one')`、`:821` `it('says how many there are when it shows fewer, newest first')`）+ `tests/panel.spec.ts:3056` 起一组 + `:3274` 起一组。**经变异检验（2 处，已还原）**，但 `00:2772-2775` 记了一条**明确的测试强度欠账**：M1 的删检发现**删掉某条断言后缺陷全活时测试仍绿**，代理正要去加强那条测试时死了，**加强没有做**——所以“列出全部而不是窗口”这个性质**目前可能只由一条可以被删掉的断言守着**。**具体是哪条断言本文未核实**：核实它要重跑一次删检，而那需要改测试文件。**线上形状本轮变过一次**：00:5x 时 `GET /api/lost` 在 3080 上返回 **404**、而送出的面板**含**这个区块（"新页面 + 旧 API"当时就是线上状态）；01:40:15 重载之后它返回 **200**，`{"total":0,"shown":0,"rows":[],"payloads":[],"bounds":{"keep":20,"chars":1000}}`，`counts.lost` 是 `{rows:0,payloads:0}`（§0.3）。**那仍然是一次对着空数据的只读 GET，不是验收**：`bounds` 那两个数证明了在跑的是第 44 轮之后的代码，而 `rows:[]` 什么也没证明 |

### 3.10 `src/app/http.ts` 的能力

路由表（`src/app/http.ts:334-609`）一共 **35 条**：**19 GET / 14 POST / 2 PUT / 0 DELETE**
（本轮逐条数过，`grep -oE "route\('(GET|POST|PUT|DELETE)', '[^']+'" src/app/http.ts \| sort \| uniq -c`）。
上一版记的是 34 条 / 18 GET；第 45–46 轮加了第 19 条 GET，即 **`GET lost`**（C239）。
**`DELETE` 仍然是 0 条**（C136）。

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C130 | 同源围栏（`x-myagent-request` 头 + 回环 Host + Origin 匹配） | **真宿主验证** | `01` §8 行「同源围栏 + 路径穿越防护」：403/403/200 **当场复验**。离线：`tests/http.spec.ts` 的 `serves the panel page to anybody who can reach the port`、`refuses the API without the marker header the panel sets`、`refuses a request addressed to something that is not this machine`、`answers 404 for a path it does not serve, rather than the panel page`。`docs/v2/06-security-risk-register.md` §2 把它归为**逻辑守卫**并说明它怎么失效：**本机任意进程都能发这个头**，它防的是浏览器跨源与误触，不是本地攻击者 |
| C131 | 面板页面由路由**原样从磁盘送出**（所以页面改动即时生效，而 API 改动要等插件重载） | **真宿主验证** | `docs/v2/05-panel-v2-ui.md` §0 与 §4（"本轮实测：`GET /myagent/` 的字节与磁盘 sha256 相同"）。本文只读复核同一事实：3080 送出的 86325 字节与磁盘逐字节相同（sha256 `eb268f8b…`）。`05` §4 记录了这件事的代价：存了文件、没重载 bundle，就会得到"新页面 + 旧 API" |
| C132 | V1 就有的那批 GET 路由 | **真宿主验证** | `01` §8 行「全部 12 个 GET 路由」：**当场全部 200**（对历史数据）。`02b` §4.3 对产物 `f6b29adc` 逐个 GET 复核了一批路由的存在性 |
| C133 | V2 新增的 6 组路由（`projects` ×3、`works` ×3、`tickets/:id/work`、`tickets/:id/events`、`tickets/:id/dependencies` ×3） | **离线验证** | `tests/http.spec.ts:402` 的 `creates, lists and reads them back, with a Project’s Works and a Work’s Tickets`、`:424` 的 `records an edge, shows what is still unsatisfied, and undoes it`、`:442` 的 `answers 404 for a Project nobody made, and 400 for an edge that would be a cycle`、`:459` 的 `comes back newest first, with the count of the whole history`；`tests/panel.spec.ts` 的契约测试 `asks only for routes the server has, so nothing it does can fail as a 404 nobody explains`（它要求“问到的路由集合 == 路由表减去 `GET triggers`”）。**有生产调用者，但从未被验收驱动过**：`02b` §4.3【转录】对产物 `f6b29adc` 逐个 GET 得到的全是 404；本文的只读复核（§0.3）确认它们在日常宿主上返回 **200**，但**那只是对空集合的 GET，不是一次验收**（`projects`/`works` 都是 `[]`），按 §0.3 第 3 条规则不升级标签。**第 33 轮与第 38 轮两次隔离验收也都没有驱动它们**（`docs/v2/14-…` 的四个场景是 Watchdog 与停机，`docs/v2/16-…` 的四个场景是聊天闭环与停机）——所以这一条跨了 14 轮仍然是 离线验证 |
| C134 | `stateView`：一次调用给出面板头部的全部信息 | **真宿主验证** | `01` §8 行「全部 12 个 GET 路由」与 §0 的当场复验；本文只读复核（§0.3）在 3080 上读到了它的全部键。离线：`tests/http.spec.ts:85` 的 `answers with the whole state in one call, so the header takes one round trip`。字段清单（`src/app/http.ts:273-330`，本轮重新数）：`settings` `settingsRevision` `policyVersion` **`mountedAt`（第 31 轮）** `machine` `setupProblem` `counts`（内含 `open`/`ended`/`attention`/`triggers`/`decisions`/`effects`/`workerSlots`/**`sends`（第 37 轮）**/**`lost`（第 45–46 轮，读失败时省略而不是归零**）`health` `sources` **`chat`（第 37 轮）** `prompts` `paused` `mainSession`。**`state` 之所以成了新键的默认去处**，理由写在 `http.ts:296-302`：它是**每个 bundle 都会答的那条路由**，所以旧宿主是“少一个键”而不是 404，不需要新探针、不会每次刷新弹 toast——**这正是 `05` §4 在真宿主上量到过的那种失败**，而本文 §0.3 第 4 条正好又量到了一次 |
| C135 | `GET triggers` | **部分实现（未接入）** | **路由那一半（离线验证）**：`tests/http.spec.ts:144` 的 `lists Triggers with what became of them`；实现在 `src/app/http.ts:519`，本文只读复核 3080 上返回 **200**、`count: 11`。**页面那一半（未接入）**：`grep -c "api('triggers" panel/index.html` → **0**。`docs/v2/05-panel-v2-ui.md` §5 与 `00` §4.19 都记着这一条，而面板的契约测试**把它排除在外** —— 即这个排除是被断言的，不是漏掉的。**接入它需要什么**：面板上一个 Trigger 列表区块（或把它折进「门禁记录」页，那里已经在读 `GET decisions`）。**对照**：第 45–46 轮给 `GET lost` 做了 exactly 这件事（C238），所以“有路由没页面”不是不可修的，只是没人排它 |
| C136 | Project / Work 的**改名与删除** | **尚未实现** | 路由表里 `PUT` 只有 2 条（`settings`、`prompts`），`DELETE` **0 条**（本轮重数，仍是 0）；`BodySchemas` 里没有更新形状。`docs/v2/05-panel-v2-ui.md` §5 与 `00` §4.19 的「其余未做」都点了这一条（“API 只有 `POST`，没有 `PUT`/`DELETE`，面板也就没有”），但**都只说了缺什么、没有给设计**，所以按 §0.1 规则 1 标 **尚未实现**。后果：一个写错名字的 Work 只能被放着，或者去改库。**第 33–46 轮没有动它** |
| C137 | 请求体的校验（`BodySchemas`，`zod` `.strict()`），以及"不是 JSON"与"太大"都要拒 | **真宿主验证** | `01` §8 行「操作者动词」里 `POST tickets` 与 `PUT settings` 都命中过。离线：`tests/http.spec.ts` 的 `refuses a request the panel did not fill in, naming the field`、`refuses a body that is not JSON, and one that is too large`、`saves settings, and refuses a document with a key nobody reads` |
| C138 | 排期编辑器：列表带下一次触发（在**宿主的时区**里算）、预览、以及不可用的排期要被点名拒绝 | **真宿主验证** | `01` §6 与 §8（`next 1793718660000 → 1793720700000`，Source 与 preview 一致）；`01` §8 行「操作者动词」里 `PUT settings` 命中。离线：`tests/http.spec.ts` 的 `lists schedules with the next run of each, computed in the host's zone`、`previews a schedule a person is writing, with its next few runs`、`refuses a schedule that cannot be used, naming the field`、`says when a timing can never match, instead of showing an empty next run` |
| C139 | `POST /api/pass`：面板说"现在就把该跑的跑了" | **真宿主验证** | `01` §8 行「操作者动词」里 `pass` 命中过。离线：`tests/http.spec.ts` 的 `asks for a pass, which is how the panel says "run what is due now"`。**`00` §4.9 记了一条必须记住的语义**：`nudge()` 里的 `requestPass()` **不被 await**，所以"我按了一下 pass，现在应该都跑完了"这个假设是错的 |
| C140 | 文件路由的越界防护（`../`、绝对路径、百分号编码、缺失文件、无 path、未知 Ticket） | **真宿主验证** | `01` §8：六种坏输入当场得到 400/400/400/404/400/404。`00` §1 同一行记的是 `../`、绝对路径、缺失文件、无 path、未知 Ticket → 400/400/404/400/404。离线：`tests/files.spec.ts` 15 条（见 C145） |

### 3.11 `src/app/files.ts` 与 `src/app/views.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C141 | `resolveInside`：路径越界守卫（`../` 与绝对路径逃不出 Ticket 目录） | **真宿主验证** | `01` §8 行「同源围栏 + 路径穿越防护」当场复验。离线：`tests/files.spec.ts` 的 `accepts a path inside the directory and refuses every way out of it`（`:90` 用一个循环覆盖 `../secret.txt`、`charts/../../secret.txt`、`/etc/passwd`、`..`）与 `refuses to be talked out of the Ticket's directory`（`:158` 覆盖 `../myagent.json`、`%2e%2e%2fmyagent.json`、`/etc/passwd`）。`docs/v2/06-security-risk-register.md` §2 记它是 **15 条测试**、归为**逻辑守卫**，失效方式是"任何**忘记调用它**的新路由 —— 它是被调用的函数，不是文件系统权限" |
| C142 | 目录列举的边界（`MAX_ENTRIES` 500、`MAX_DEPTH` 6、`SKIP` 8 个噪声目录），且停下时**说出来** | **真宿主验证** | `01` §8 行「files/progress/recipes 对运行中的 worker」：`files`/`file` 对已结束的 Ticket 查过，**200 + 正确的目录树与穿越防护**。离线：`tests/files.spec.ts` 的 `walks what a run produced and leaves out the noise`、`stops at a bound and says it stopped, rather than serving an unbounded tree`、`lists an empty directory as empty`、`lists a directory that is gone as empty, rather than throwing at the panel` |
| C143 | `files`/`file` 对**运行中**的 worker | **离线验证** | `01` §10 明说："`progress` 对运行中的 worker 采样了 176+ 次，但 `files`/`file` 我是在 Ticket 都结束之后才查的"。所以"运行中"这个条件只对 `progress` 成立（C94 是 真宿主验证，这一条不是） |
| C144 | 文本判定与 base64 下载（`isTextFile` / `readForPanel`，`MAX_FILE_BYTES` 16MB） | **真宿主验证** | `01` §8 行「files/progress/recipes」：`file` 路由 200 且行为正确。离线：`tests/files.spec.ts` 的 `tells a text file from a binary one by name and size`、`hands over bytes as base64, which is what a download link is built from`、`tests/notify.spec.ts` 的 `shows the result and the files, so the operator does not have to open the directory` |
| C145 | `resolveInside` 的 15 条测试 | **离线验证** | `tests/files.spec.ts` 在 `gate.log` 里是 **15 tests**，与 `docs/v2/06-security-risk-register.md` §2 记的数字一致 |
| C146 | 视图层：一种记录一个 JSON 形状，所以面板与工具的回答不可能对同一张 Ticket 说法不一 | **离线验证** | `tests/views.spec.ts` **13 条**（`updatedAt` 1、`ticketSummary` 3、`ticketView` 4、`decisionView` 2、`scheduleView` 3；本轮复核闸门仍报 13）。`src/app/views.ts:5` 的注释明说 “Nothing here reads the Store or touches a Session” —— 本文核对：它只导入 `../core/model`、`../core/policy`、`../core/timing`，成立。**`views.ts:54` 无条件写 `workId`/`workSeq` 两个键**，值为 `undefined` 时 JSON 会省略它——这是 §9 第 8 条那个“`workId` 缺失”的真正原因，**它不是版本问题**。**第 37 轮给 `GET tickets/:id` 加的 `replyTo` 不走 `views.ts`**，而是直接在 `src/app/http.ts:357` 从 Trigger 上读（`host.store.triggers.get(ticket.origin.triggerId)?.trigger.replyTo`）——**这是 §1.2 第 2 条那类“读路径绕过 Engine”的又一处**，而 Engine 上那个同义的 `trigger()` 仍然零调用者（C43） |

### 3.12 `src/app/watchdog.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C147 | 探测器：卡在启动（`stuckLaunches` 只报**仍是 pending** 的尝试）+ 署名的 `rescued` 日志 + 健康行说出它做了什么 | **真宿主验证** | `02` §7 与残件 `item7-evidence.json`（Ticket `ce1a9d7603b04d220f57dbaedfcefd0e`，`launchStuckMs=15s`）：健康板 `t+1.5s {ok:true}` → `t+55.8s {ok:true, detail:"1 stuck launch(es) rescued"}`；事件行 `seq=2 type=rescued by={kind:system,id:watchdog} detail={why:"its worker never came up within 15s"}`。**第 33 轮又得证了一次，而且更强**：`docs/v2/14-…` 场景 3(a)【实测】**2 条** `rescued`、均 `by={system,watchdog}`（残件在 `/tmp/myagent-acc-watchdog/`）。**注意 `02` 顶部更正块第 1 条**：§7 的标题“通过”是错的，应为“**部分：探测得证，救援被证伪**”——探测这一面两轮都得证了，被证伪的是“救援真的重新启动了 worker”（C84/C148） |
| C148 | 救援动作**真的重新启动了 worker** | **部分实现** | **被证伪、且第 33 轮确认了证伪的一半**：`02b` §5 **N1（HIGH）** 查明救援在真宿主里是**空操作**；第 33 轮的隔离验收**再次实测到同一个机制**，`00:1786` 逐字记着“全程**只有一个** sleep 进程，尽管两次救援都重新入队了——**证实了重新入队会被在飞的那次吸收**”。**已修好并真宿主得证的一半**：第 23 轮的修复（不再 `starting.delete`）让**问题不消失、升级可达**——`docs/v2/14-…` 场景 3 三条全中（见 C84）。**仍未得证的一半（尚未实现）**：“原 launch 真的死了、于是救援启动了一个新的 worker”这一情形**从未被驱动过**（两次验收用的都是**慢**的 prepare，不是**被杀死**的 prepare）。核实它需要一次隔离宿主运行：让 prepare 命令中途被杀，然后观测是否出现第二个 worker 进程与同一个 Session 的第二个 turn。`02b` §5 N1 还解释了**为什么 561 条离线测试看不见它**：部署桩的 `spawn` 当时只有 `exitCode/stdout/stderr/throws`、**没有挂起能力**，所以“一个仍在飞的 launch”在离线里根本造不出来（第 23 轮给桩加了 `delayMs`） |
| C149 | 达到 `maxActions` 后停手并上一行“需要人”的健康问题 | **真宿主验证** | **本轮升级，依据是 `docs/v2/14-…` 场景 3(b)【实测】**：健康在 `04:34:25.830Z` 转 not ok，detail **逐字**是 `Ticket a688c9df has not started after 2 attempts to rescue it; it needs a person`，约 55s 内到达；场景 3(c) 同刻 `used` 仍是 1。**这条路径曾经是“线上不可达”的**（`02b` §6.1 明确要求把 `02` §12 的这一行改成“线上不可达，不是离线”）：修 N1 之前 `starting.delete` 让那张 Ticket 从 `stuckLaunches` 里消失，`actionsTaken` 停在 1，`maxActions=2` 永远达不到——**那不是“没跑到”，是“跑不到”**。第 23 轮修好之后它在机制上重新可达，第 33 轮**真的走到了**。离线：`tests/watchdog.spec.ts:55` 的 `stops rescuing a Ticket it has already tried twice, and says a person is needed`、`:105` 的 `stops interrupting one it has already acted on, and says a person is needed`。**升级本身现在也是一条持久记录**（C227，第 34 轮） |
| C150 | 探测器：静默的 worker（`silentMs`，默认 **0 = 关闭**；动作是 `haltBackground` + `assignmentInterrupted`） | **离线验证** | `tests/watchdog.spec.ts:93` 的 `is interrupted with a reason that names the silence`、`:118` 的 `reports an interruption that failed rather than leaving the attempt running and the board clean`、`:124` 的 `looks for nothing at all when the whole Watchdog is off`、`:67` 的 `looks at nothing when the detector is off, so a deployment that does not want it pays nothing`。`02` §12 把这一行标成“仅有离线覆盖（默认关闭，未驱动）”；`02b` §7.5 更进一步：它对**线上有效性持怀疑态度**（它的动作走的不是被效果泵阻塞的那条路，所以机制上**可能**没被 N1 影响，“**但我没有证据。别把它标成‘应该没问题’**”）。**第 33 轮与第 38 轮两次验收都没有驱动它**（`silentMs` 全程为 0）。**离线还有一个已知的保真缺口**：`00` §6 说桩的 `SessionEvent` **没有 `time`**（真类型是必填），所以 `lastEventAt` 在任何测试里都是 undefined——那条回退分支因此是被走的那条，而真实的那条没有（本轮复核 `grep -n "SessionEvent\|time:" tests/helpers/host.ts` → 0 命中，**仍在**）。它的升级路径（`escalated`）也只有离线证据（C227、`tests/watchdog.spec.ts:203`） |
| C151 | 它救过几次，用 Ticket 自己的事件日志数（不是 Watchdog 自己的字段），所以重启不会让它忘记、从而无限救援 | **真宿主验证** | `02` §7：全库只有一条 `rescued` 事件，`by={kind:system,id:watchdog}`。**第 33 轮把它推进了一大步**：`docs/v2/14-…` 场景 3(a)【实测】**2 条** `rescued`，而正是这个计数达到 `maxActions=2` 才让升级触发（场景 3(b)）——**所以“用日志数、而不是用自己的字段”这个设计第一次被观测到承住了重量**。`02b` §5 N1【残件】此前复核的是相反的一面：`actionsTaken` 停在 1、升级不可达。实现在 `src/app/watchdog.ts`（`host.actionsTaken(ticketId)` → `Engine.watchdogActed`/`history` 数 `rescued`+`interrupted`）；**`escalated` 刻意不计入**（C227） |
| C152 | 救援/中断失败也要说（上一行健康问题并命名原因，而不是让 Ticket 卡着、健康板干净） | **离线验证** | `tests/watchdog.spec.ts:80` 的 `reports a rescue that failed instead of leaving the Ticket stuck and the board clean`、`:118` 的 `reports an interruption that failed rather than leaving the attempt running and the board clean`。真宿主上这条路径没被走到过：`02` §7 的健康板从头到尾 `ok:true`；`docs/v2/14-…` 场景 3 里健康转 not ok 的原因是**升级**（“需要人”），不是**动作失败** |
| C153 | Watchdog **不自己写状态**：它的动作是 `Engine.watchdogActed` 与 `Engine.watchdogEscalated`，唯一写者这条保证没有被绕过 | **离线验证** | `src/app/watchdog.ts` 只导入 `./health` 的类型（本轮复核仍成立）；`00` §4.13 明说这一点。本文核对 §1.2 的 grep：`watchdogActed` 的写入落在 `src/core/engine.ts:1077` 的 `repos.tickets.save`、`watchdogEscalated` 落在 `:1034` 附近的 `record(...)`（最终也是 `repos.tickets.save` + `repos.events.append`），即**仍然在 Engine 里**。第 34 轮新增的那条走的是**窄端口** `WatchdogHost.escalate`（`watchdog.ts:56`，接线 `runtime.ts:516`），理由与 `DeliveryHost.replyLost` 同构。真宿主上的间接证据是 `02` §7 与 `docs/v2/14-…` 场景 3 那些署名的 `rescued` 事件（它们只能由 Engine 写） |
| C154 | 等人的 Ticket 的提醒（Watchdog 的第三类动作） | **尚未实现** | `00` §4.13 与 §4.14 的「仍未做」都列了它，并说明障碍：“需要一个新的通知 key，否则幂等会把它吃掉”。**只有这一句，没有设计** —— 按 §0.1 规则 1 标 尚未实现。**第 34 轮之后 Watchdog 有了三类动作**（`rescue` / `interrupt` / `escalate`），**提醒仍然不在其中**；而 `escalate` 的存在让这条缺口的性质变了：现在“需要人”已经能落进日志，缺的只是**主动去敲前台**那一步 |

### 3.13 `src/app/prompts.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C155 | 出厂提示词的定位（两种布局都要找得到）+ 覆写 + 修订号 + 清空覆写回到出厂文本 | **真宿主验证** | `01` §8 行「操作者动词」：`PUT prompts` 的覆盖被**后来的 worker 与已存在的 worker 都拿到**。离线：`tests/prompts.spec.ts` 8 条（`finds both role prompts, whichever layout this module runs from`、`finds the panel page and the bundle patch`、`says plainly what is missing rather than serving nothing`、`runs the shipped text until an override is stored`、`takes an override, moves the revision, and keeps the shipped text for the other role`、`returns a role to its shipped text when the override is emptied`、`refuses an override that is not text, is too long, or names no role`、`flags an override that only repeats the shipped text, which pins the role to it`） |
| C156 | `promptMaxChars` 这个设置项**真的被强制**（S16） | **部分实现** | **已做的一半**：保存时确实有一个上限 —— `src/app/prompts.ts:96-97` 拒绝超过 `PROMPT_MAX_CHARS` 的覆写。**未做的一半（尚未实现）**：那个上限是**硬编码的 `100_000`**（`src/app/prompts.ts:19`），而设置项 `machine.promptMaxChars`（`src/deployment.ts:34`，可配 1,000–1,000,000）只被**显示**（`src/app/http.ts:321` 与 `:586` 的 `maxChars`），从不参与强制。所以操作者把它设成 200000，面板会说 200000，而保存 150000 字仍然被拒。`00` §2 S16 与 §8 第 6 项都记着这一条，**本轮复核未修**（上一版记的行号是 `prompts.ts:19`、`deployment.ts:34`、`http.ts:195`/`:398`；前三处未变，`http.ts` 的两处已漂移到 `:321`/`:586`） |

---

## 4. `src/sources/` —— 触发层（**7 个文件，1334 行**）

| 文件 | 行数 | 责任（一句话） | 公开面 | 依赖 |
| --- | --- | --- | --- | --- |
| `src/sources/kind.ts` | **127** | Source 协议：一个 Trigger 生产者必须是什么，以及它**可以**用的那个窄宿主 | `SourceStatus` `Cursor` `SourceHost` `Source` `SourceKind` **`TwoWaySource`（第 35 轮）**；转出 `key` 与 **`ReplyTo`** `Trigger` 类型 | `../core`（类型）、`../app/effects`（类型）、`../app/health`（类型） |
| `src/sources/registry.ts` | 89 | Source 注册表：每个 kind 一个在跑的实例，它读的设置变了就重建 | `SourceRegistry` | `../core/policy`、`../core/model`、`./kind`（都是类型） |
| `src/sources/chat.ts` | **469（第 36 轮新增）** | 那个**双向**的来源：读一个频道目录里的消息、把已映射身份的消息变成 Trigger、把一份报告写回频道的 `out/` | `ChatSource`（实现 **`TwoWaySource`**）`chatKind` | `node:fs` `node:fs/promises` `node:path`、`../core`、`../core/policy`、`../core/model`、`../app/health`、`./kind` |
| `src/sources/cron.ts` | 220 | cron 来源：操作者写的排期到点变成 Trigger | `CronSource` `cronKind` | `../core`、`../core/policy`、`../core/model`、`../app/health`、`./kind` |
| `src/sources/inbox.ts` | 279 | inbox 来源：投进一个目录的 Markdown 文件就是一个请求 | `FrontMatter` `frontMatter` `InboxSource` `inboxKind(defaultDirectory)` | `node:fs` `node:fs/promises` `node:path`、`../core`、`../core/policy`、`../core/model`、`../app/health`、`./kind` |
| `src/sources/rule.ts` | **116** | 那个**请求没人写的工作**的来源：一条关于 Ticket 怎么结束的规则 | `RuleSource` `ruleKind` | `../core`、`../core/model`、`../core/policy`、`../app/health`、`./kind` |
| `src/sources/session.ts` | 34 | session 来源：操作者在跟主 Session 说话 | `SessionSource` `sessionKind` | `../app/health`、`./kind`（都是类型） |

**这一层的形状**：五个来源都只通过 `SourceHost`（`kind.ts:29-49`）够到系统，
它给的是 `engine` / `effects` / `health` / `lifetime` / `settings()` / `requestPass()` / `cursor(id)` / `subscribe(listener)`。
`kind.ts:41-47` 的注释把这条规则的理由写明了：“everything a Source can touch comes through this interface,
which is what keeps ‘一个 Source 不能做另一个能做的事’ 成为代码里的事实而不是纪律上的约定”。
做文件 IO 的现在有**两个**：`inbox.ts` 与 `chat.ts`（它们本来就是“读一个目录”的来源）。

**`kind.ts` 在第 35 轮从 74 行长到 127 行，长的部分全是契约文本，而这份文本值得单独点名**（C240）：
`Source` 接口上方现在逐条写着**myagent 向实现者保证的五件事**（`start()`/`stop()` 各调一次且 `stop()` 返回后不再有回调；
`status()` 被周期性读取，而**它返回的摘要不得擦掉这个 Source 刚记下的问题**——注释直接点名 cron 与 rule 都曾犯过这一条，即 S19/N5；
一次设置变更移动 `signatureOf(kind, settings)`，**不移动它的旋钮就是一个在跑的 Source 永远看不见的旋钮**——点名了 `rule` 曾读 session 块；
`deny` 与 `paused` 在**产出侧**生效，因为**门禁拒绝是不可逆的**——点名了 S9/N4；
Source 内部抛出的异常是它自己的，注册表逐个创建与轮询、把失败记成一行健康问题）
与**实现者向 myagent 保证的四件事**（身份不被映射就不是 `Actor`；Trigger id 是它所标识事物的**纯函数**、不含读取时刻；
每个副作用都入队、绝不内联；同一个事件投递两次是幂等的）。
**这四条正是 P8 契约的浓缩，而它们被写在了第三方唯一会读的那个文件里。**


### 4.1 `src/sources/cron.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C157 | 槽位精确触发（Trigger 的 `at` 正好落在槽位上） | **真宿主验证** | `00` §1 行「cron 正常触发（槽位精确）」：Trigger `at` 正好落在槽位，Decision 比槽位晚 **1ms**。**限定**：`01` §10 说那一轮**没验**到点触发（排期定在 23:11/23:45，验收窗口 18:00–18:55，宿主已停），所以这条 live 证据来自 `00` §1 的更早观测 |
| C158 | 宕机错过槽位**折成一条**（不是每个错过的槽位一张 Ticket） | **真宿主验证** | `00` §1：09:00 槽位（`01:00:00.000Z`）在 11:31:56 只触发一次，cursor `missed:0`。`02b` §4.5 给了第二个、更强的线上样本：宿主 02:40:19 启动后**补触发了一个迟到约 3 小时的槽位**，造出**一张** Ticket（`7d81aadc33c8e67ec5a9fb2d12f3808f`）并跑到 `done`，然后重新武装到 `next = 1793807100000`。离线：`tests/sources.spec.ts` 的 `fires one Trigger for a slot that passed while the host was down, folding the ones behind it`、`catches up the slots a short downtime skipped, and a restart repeats none of them` |
| C159 | 暂停 / 停用在**产出侧**：不合成 Trigger、**不推进 `entry.next`**、停用不擦游标 | **离线验证** | `tests/sources.spec.ts` 的 `consumes no slot while paused, and fires the remembered slot when the pause lifts`、`keeps its read positions while disabled, so turning it back on owes nothing`、`does nothing while the source is switched off`、`forgets a schedule the operator removed`。**为什么不是真宿主验证**：`02` §8 那张表的 A/B 两个场景是 **inbox** 的（`sources.inbox.deny` / `sources.inbox.paused`），cron 的 pause/deny **从未在真宿主上驱动过** |
| C160 | 排期带的 `scope` 传到 Mandate | **真宿主验证** | `00` §1 与 `01` §8：`RESULT.md` 里的 `Authorized by: operator via inbox` 与 Mandate 的 scope 都被读过。离线：`tests/sources.spec.ts` 的 `honours the scope a schedule carries` |
| C161 | 一个来源坏了不拖垮其余（S23 的修复：`sync` 不在第一个失败处中止） | **离线验证** | `tests/sources.spec.ts` 的 `starts the Sources after the one that failed, and names the failure`、`retries a Source whose start failed, instead of remembering it as running`。实现是 `src/sources/registry.ts:53-62` 的逐个 try/catch |
| C162 | 超出地平线的排期：真的槽位触发一次然后停（S19） | **离线验证** | 见 C16；`tests/sources.spec.ts` 的 `fires the real slot once and then stops, instead of minting a Ticket a minute` |

### 4.2 `src/sources/inbox.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C163 | 扫描 → 静置窗口(`SETTLE_MS` 1s) → 大小上限(512KB) → 只读 `*.md`、不读隐藏文件 | **真宿主验证** | `00` §1 行「inbox 扫描 / accepted / observed」：`accepted/` 6 个文件、`observed/` 1 个，都带 `<!-- myagent: … -->`。`01` §1/§2 与 §8：5 个文件进 `accepted/`。离线：`tests/sources.spec.ts` 的 `takes a settled request file into one Ticket and moves it out of the inbox`、`leaves a file that is still being written for a later poll`、`reads only Markdown files, and no hidden ones`、`refuses a request larger than it reads, instead of loading it` |
| C164 | 归档名 = `<triggerId>-<原名>`（S31 的修复：身份必须是它所指事物的纯函数） | **真宿主验证** | `02b` §6.6【残件】：`inbox/accepted/f1b4289706daf86d60d2bb49f591e8ca-v2-inbox-deny.md`（220 B）与 `accepted/1150d5be8c0b0938206b9108846873e1-v2-inbox-paused.md`（224 B）都在，注解是 `<!-- myagent: Ticket 4d02911c051e53677ac4d863a5b1dea2 -->`；"归档名 = `<triggerId>-<原名>`，即 S31 的修复形状"。离线：`tests/sources.spec.ts` 的 `is the Trigger id, so taking the same request twice cannot make two copies` |
| C165 | 并发取件只归档一份（先认领后归档 + 身份化文件名） | **离线验证** | `tests/sources.spec.ts` 的 `takes one request once, however many polls ask for it at the same time`。`00` §7 S31 记录了结案证据（修前约每 3–6 次失败一次，修后 **15/15 通过**）。真宿主上从未制造过并发取件 |
| C166 | `accepted/` 路径 | **真宿主验证** | 同 C164 的残件；`02` §8 表格的"文件留在原处 ✓ / 进了 rejected/ ✗ / 解除后被受理 ✓" |
| C167 | `observed/` 路径（observe 模式下记录而不执行） | **部分实现** | **旧代码的一半（真宿主验证）**：`00` §1 行「inbox 扫描 / accepted / observed」记线上有 `observed/` 1 个文件；`00` §1 行「门禁 + observe 模式」记 2 条 `observed`、8 条 `accepted`，且 observe→auto 的切换发生过（revision 7）。**当前构建的一半（离线验证）**：`01` §8 把这两行都**降级为 `partial`**，明说"`observed` 本次没跑（全程 `acceptMode=auto`），仍只有旧代码证据"；`01` §10 解释了为什么（隔离状态目录一开始就必须是 `auto` 才能跑 §1，之后没再切回去）。离线：`tests/sources.spec.ts` 的 `records a request in observe mode and executes nothing` |
| C168 | `rejected/` 路径（门禁拒绝时把文件移开、把原因写进文件头） | **离线验证** | `tests/sources.spec.ts` 的 `moves a refused request aside with the reason it was refused`。**三轮验收都没有它**：`00` §1 行「inbox `rejected/` 路径」标 `offline`（"线上从未产生过 `rejected/` 目录"）；`01` §10 说那轮 5 个请求全部 `accept`；`02b` §6.6【残件】复核 `inbox/rejected/` **从未被创建**。**注意 `02` §8 那句"门禁拒绝会把文件移进 `rejected/`"是在描述旧行为作对比，不是本轮的观测** |
| C169 | deny / pause 在产出侧、**无损**（文件原地不动、零 Trigger 零 Decision、解除后作为同一个请求被受理） | **真宿主验证** | `02` §8 的表（A：`sources.inbox.deny`，B：`sources.inbox.paused`，两行都是"文件留在原处 ✓ / 进了 rejected/ ✗ / 新增 Trigger 0 / 新增 Decision 0 / 解除后被受理 ✓"）+ 残件 `item8-summary.json`。`02` §8 明说这是"暂停/拒绝在产出侧而不在门禁"的证据，并给出了对照：门禁拒绝会**消耗**请求，而且再投一个字节相同的文件会撞上重复短路。离线：`tests/sources.spec.ts` 的 `leaves an inbox file where the operator put it while its own pause is on` |
| C170 | front matter：`title` / `scope` / `attach`(或 `attachments`，逗号分隔) 三个字段；畸形的一律当正文 | **真宿主验证** | `attach` 全链路：`01` §2a/§2b 与 §8（从 `offline` **升为 `live`**）。`title`/`scope`：`01` §8 与 `00` §1。离线：`tests/sources.spec.ts` 的 `reads a title and a scope, and leaves the rest as the request`、`takes a file with no front matter as it is, titled by its name`、`quotes and case in the keys do not matter`、`treats a file whose front matter never closes as one request, rather than refusing it`、`falls back to the whole text when the front matter leaves no body`；`tests/attachments.spec.ts` 的 `reads attach: from the front matter, comma separated`、`accepts the plural key and a single file, and trims what a person typed` |
| C171 | 目录权限自检：组/其它可写（`mode & 0o022`）就上一行健康问题，带八进制模式与 `chmod go-w`（第 27 轮） | **离线验证** | `tests/sources.spec.ts` 的 `is reported on the health board, with the mode and what to do about it`（0o777）与 `says nothing when the directory is only the operator's`（0o700）。实现在 `src/sources/inbox.ts:104-131`（`start()` 里查一次，不是每次扫描都查，注释说明了为什么：每次扫描都上问题会与扫描自己的健康摘要争同一个条目）。**第 27 轮的产物，不在 3080 已加载的 bundle 里**（§0.3） |
| C172 | inbox 的**发起者身份**经过认证 | **尚未实现** | `docs/v2/06-security-risk-register.md` §3 把这条点名了：inbox 来源的 actor 是从**请求文件本身**推出来的，所以"**能写 inbox 目录的人，就能以任何被允许的发起者身份提交工作**"，而门禁的记录里会写着一个看起来合法的发起者。清单明说"这不是 bug（文件就是那个来源的身份凭证）"，但**它没有设计**：§3 末句只说 P8 的聊天来源"必须把平台身份映射到真实 actor，那时'谁能声称自己是谁'才是一个需要在协议层解决的问题" |

### 4.3 `src/sources/rule.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C173 | 规则来源：上游 Ticket 以某个 outcome 结束时**自动请求新工作**，actor 是 `{kind:'system', id:<规则 id>}` | **真宿主验证** | `02` §9 与残件 `item9-rule-ticket.json`：`d9493df4` 的 `stage: done`、`result.files:["digest.txt"]`、`artifacts` 一条、`origin:{triggerId:"2b179988…", depth:1}`、`mandate.via:"rule"`、`sender:{id:"digest-done",kind:"system"}`。`02` §9 说这是"**第一次有真宿主证据表明系统能自己发起工作**"。**但必须带上 `02b` §6.4 的更正**：`02` §9 引的第二张 `item9e-rule-ticket.json`（`2cfc2761`）是 `stage: "running"`、`ended: null`，**不能说它跑到了 done**；它证明的是另一件事（`sources.session.enabled=false` 时规则 Trigger 仍被受理，即 Defect B 的修复）。所以正面路径**只有一张**跑到 `done` |
| C174 | 深度守卫 `maxDepth`（默认 3）：一条自指规则不等于 fork bomb；撞到上限时**说出来** | **真宿主验证** | `02b` §6.5【转录】：线上真的触发过 —— `source:rule` = `rule digest-done reached depth 2 of at most 1 after Ticket d9493df4; the chain stops here`，`at 2026-11-03T18:52:57.017Z`。`02b` §6.5 明说这是 `00` §4.15 那个"fork bomb 守卫"的线上得证，而**重建稿完全没提这条正面结果**。离线：`tests/sources.spec.ts` 的 `stops a chain at the depth the rule allows, and says so instead of going quiet` |
| C175 | 同一次结束被投递两次只问一次（Trigger id 是 `key('rule', 规则id, ticketId, ended.at)`） | **离线验证** | `tests/sources.spec.ts` 的 `asks once however many times the same ending is delivered`（`00` §4.15 记：两次 enqueue 的 key 与 id 相同）。真宿主上没有制造过重复投递 |
| C176 | 只匹配规则点名的 `outcome` 与 `workId` | **离线验证** | `tests/sources.spec.ts` 的 `matches only the outcome and the Work the rule names` |
| C177 | 规则的 deny / pause 在产出侧（N4 的修复） | **离线验证** | `tests/sources.spec.ts` 的 `produces nothing while denied, and nothing is stored against the ending`、`produces nothing while paused either, and asks once the pause lifts`。**被证伪的原始行为在真宿主上观测到过**：`02b` §5 **N4（MED）** —— `RuleSource.onEnded` 当时只检查 `enabled`（`src/sources/rule.ts:51`），从不检查 `deny`/`paused`，所以规则的 deny 走门禁 → Trigger 存成 `ignored` → 而 Trigger id 是那次结束的纯函数，**永远不能被重新评估**，解除 deny 也救不回那条链。**`02b` N4 同时更正了 `02` §9 的结论**：重建稿把"来源照跑、门禁拒绝"写成了优点（"请求没有丢失"），而它对规则来源是**有损的** |
| C178 | 解除 pause 之后**那一次已经过去的结束不会复活** | **部分实现** | **已做且已测的一半（离线验证）**：`00` §4.18 说第二条测试里写明了这个语义 —— 解除的作用是"不再吞掉**下一次**"。**这不是缺陷而是设计**，理由也写清了：规则来源读的是**事件**而不是可读位置的状态，所以它与 cron/inbox 不同（那两个的读位置还在，槽位与文件能保住）。**未做的一半（尚未实现）**：没有任何机制让操作者知道"deny 期间有 N 次结束被吞掉了" —— `00` §4.18 只说了"假装能重来就等于重放历史"，没有给出替代方案 |
| C179 | 规则的 `then.workId` → Trigger 的 `meta.work` → 受理时归类（这条链闭合） | **离线验证** | `00` §4.17 明说"两半各有测试（规则侧断言 `meta.work`，引擎侧断言 `workSeq` 递增与 `ticketsOfWork` 的顺序），而不是只测其中一半然后声称整条通"。规则侧：`tests/sources.spec.ts`；引擎侧：`tests/engine.spec.ts` 的 `classifies the Ticket as it is created, taking the next place in that Work`。**整条链从未在真宿主上走过一次**（§0.3：3080 的 `works` 是空集合） |
| C180 | 文件头那条**承重的理由**是真的（N7 的修复） | **部分实现** | **已修的一半**：`src/sources/rule.ts:1-16` 现在写的是"Events are published after their transaction commits, so nesting a command inside another's commit is **not** the reason —— the reason is that a queued request survives a crash between the ending and the asking, is deduplicated by key, and gets the retry and backoff the queue already provides"。本文核对：`src/core/engine.ts:197` 确实是 `this.emit = event => this.tx.afterCommit(() => publish(event))`，即监听器在提交之后才跑，所以修正是对的。**未验证的一半（离线验证）**：这是一处注释修正，没有测试能钉住它；`00` §4.18 的 N7 行也只写"已修（并把'注释错了比没有更坏'写进去了）" |
| C181 | 规则能对"某张 Ticket 卡住了"或"某个产物出现了"设条件 | **尚未实现** | `00` §4.15 的「未做」列了它（"规则只在 `ticket.ended` 上触发"），**只列了缺口、没有设计**。核对：`src/sources/rule.ts` 只 `subscribe` 了 `ticket.ended`（`onEnded`），`SourceHost.subscribe` 传的是全部 `DomainEvent`，所以协议够用、缺的是匹配器 |
| C182 | 规则能引用上游的**产物** | **尚未实现** | `00` §4.15 与 §4.18 的「未做」都列了它（"规则还不能引用上游的产物（P5 的产物引用）"）。第 25 轮做了 worker→worker 的产物读取（C41/C97），但**规则侧仍然没有** |
| C183 | 面板上有规则的编辑界面 | **尚未实现** | `00` §4.15 的「未做」："面板上没有规则的编辑界面（P7，目前只能改设置 JSON）"。本文核对：`panel/index.html` 里 `rule` 只作为来源名出现，排期页编辑的是 `sources.cron.schedules`，没有 `sources.rule.rules` 的编辑器 |

### 4.4 `src/sources/session.ts` 与 `src/sources/registry.ts`、`src/sources/kind.ts` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C184 | 主 Session 作为来源：面板能看见这个通道、设置能关掉它，而门禁对它的 Trigger 一视同仁 | **真宿主验证** | `01` §8 行「操作者动词」：`POST tickets` 产出了**线上第一张 `via=session` 的 Ticket**（`00` §1 之前记的是"线上没有一张 Ticket 是 `via=session`"）。`02` §9 与 `02b` §6.4：`sources.session.enabled=false` 时规则 Trigger 仍被**受理**（Decision `outcome:accept, reason:accepted`），即 Defect B/S33 的修复线上得证。离线：`tests/engine.spec.ts` 的 `runs a person's request through the same gate`、`refuses a request from a sender nobody allowed, exactly as a Source would`、`records nothing in observe mode either`；`tests/flow.spec.ts` 的 `refuses a Ticket from the main Session while the session Source is switched off` |
| C185 | 注册表按**签名**重建（`signatureOf` 从设置派生，不是枚举 kind） | **离线验证** | `tests/policy.spec.ts` 的 `moves the policy version for every rule knob…` 与 `tests/sources.spec.ts` 的 `reads the rule Source's own enabled flag rather than the session one`。`00` §4.15 S33 记了这条的原始缺陷：`signatureOf` 也是 `cron ? … : inbox ? … : session` 的 fallthrough，于是 `rule` 的签名读的是 **session 块** —— 两个来源共用一个签名，改任一个都会把两个一起重建（churn 翻倍），而**改规则反而什么都不重建** |
| C186 | `sync()` 的重入闩（S32 的修复：两次重叠的 sync 不再孤儿化一个已启动的 Source） | **离线验证** | `tests/sources.spec.ts` 的 `orphans nothing: every Source it started is one it can stop`（`00` §4.15 S32 记它经变异检验：撤掉重入闩立刻变红；并说明测试**必须用一个真实的 kind**，因为 `sources` 是 `.strict()` 的，自造 kind 在那里没有块、签名恒为 undefined、测试就成了空的）。**这条修复的线上对应物是 S32 那 40 个未处理错误**，`02` §13 说它**未结案**；`02b` §3 明说 86 分钟无写入那次采样**不支持** S32 已结案 |
| C187 | 一个 kind 的**多个实例**（两个 inbox 目录、两个聊天账号）—— D3 | **仅有设计** | `src/sources/registry.ts:1` 的文件头写的仍是 “one running instance per kind”，全部以 `kind.name` 为键。设计在 `00` §3 **D3**：改用 `source.id` 作键、kind 变成“对配置实例的工厂”；并指出 `Mandate` 只带 `via` 不带 `source`，所以 per-**实例**策略无法只从 Mandate 复核。**P8 明确把它排除在范围外**（`00:1917-1918`：“第一片**不做多实例**……开它是单独的架构变更”），而 `sources.chat` 的 schema 注释（`policy.ts:191-194`）把这件事写成了权衡：“Several, because the standing decision is one instance per kind (D3) while an operator may have more than one channel; multi-instance is a separate architecture change” —— **即一个 Source 实例可以有多个频道，但仍然只有一个实例** |
| C188 | `SourceKindName` 是**数据声明**而不是闭合联合 —— D1 | **仅有设计** | `src/core/model.ts:4` 仍是闭合联合，但**它有五个成员了**：`'cron' \| 'inbox' \| 'session' \| 'rule' \| 'chat'`（第 35 轮 A+B 加的）。设计在 `00` §3 **D1**：设置文档**声明**每个来源，门禁只在“已声明且未 deny”时接受，`MandateVia` 变成已声明的 kind。D1 同时指出为什么不能简单放宽成 `string`：**拒绝未声明的来源是一条安全性质**。**加第五个成员的实际代价本轮又量到了一次**：`00` §4.15 记加第四个成员时“审计警告过的四文件协同改动，实际动了六处”；第 35 轮加 `chat` 时，实现者**必须**同时给 `MandateVia` 加 `'chat'`（因为 `viaOf` 是一个**全函数** `Record<Trigger['kind'], MandateVia>`，不加就 typecheck 不过），主代理批准了这个越界改动，理由是“**把 chat 映射成 `'session'` 会给每一个 chat Mandate 盖上一个假的来源**——那正是 §5 惩罚的‘审计记录里的一句假话’那一类”（`00:1947-1950`）。**这仍然不是 D1 的数据声明机制，是手工加第五个成员**；纪律 §0.10 把这一族记为“会到期偿还的债”，本轮又添了第四处（三个 Source 的 catch-all，见 §10.2） |
| C189 | `Delivery.send`：一个聊天来源能把话**回**到原会话 —— D11 | **真宿主验证** | **上一版标 仅有设计，本轮改为已实现并给出证据**：`src/core/engine.ts:158-177` 的 `Delivery` 端口现在有 `report`、`policyChanged?` 与 **`send?`**（第 35 轮 A+B）。它是**可选**的，端口自己的注释写了为什么：一个来源全是单向（cron、inbox）的部署无处可发，而强制实现会被答以空方法——**“an empty method is the appearance of a capability without the capability”**。注释还硬性要求**实现必须把发送排进效果队列而不是内联**（“inline means one hiccup loses the words permanently with no record that they were ever owed — while ‘every side effect has a record of its execution and its failure’ is a hard rule of this project”）。实现者是 `OutcomeDelivery.send`（`src/app/delivery.ts:305`），能力条目见 **C237（真宿主验证）**；`src/sources/kind.ts:4-5` 与 `README.md` 当初承诺的那个接缝（“加一个 kind 再加一个 `Delivery.send` 就行”）**现在真的切开了** |

---

### 4.5 `src/sources/chat.ts` 的能力（第 36 轮新增的文件）

这一节是本文上一版**完全没有**的：那时 `src/sources/` 下只有四个来源加两个协议文件，
P8 被记为“**完全没有动过**”（上一版 §10.1 的原话）。第 35–38 轮把它从零做到了真宿主验收通过。

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C240 | **`TwoWaySource`：一个能回话的 Source**（第 35 轮 A+B，P8 契约 §4） | **真宿主验证** | `src/sources/kind.ts:115-119`：`interface TwoWaySource extends Source { deliver(replyTo: ReplyTo, text: string): Promise<void> }`。它上方的注释逐条写了实现者必须知道的三件事：`deliver` **从效果队列调、绝不在事务内内联**，所以失败后会被重试、同一句回复可能到达它**不止一次**——**投递必须幂等**；`deliver` **只会**被拿着这个 Source 自己写在 Trigger 上的 `ReplyTo` 调用（按 `kind` 分发）；`deliver` 抛出的错会被记在那条效果上、按退避重试、并上健康板。`ChatSource` 实现它（`src/sources/chat.ts:128` `class ChatSource implements TwoWaySource`），`chatKind.create` 的返回类型就写成 `TwoWaySource`（`:466-469`），所以 C237 那个 `typeof source.deliver === 'function'` 的收窄能通过。真宿主证据：`docs/v2/16-…` 场景 1【实测】闭环跑通、回复文件出现在 `room-a/out/`。离线：`tests/chat-contract.spec.ts:358` `it('registers, starts and reports status like any other Source, and is still two-way afterwards')`、`:283` `it('accepts a Delivery that has no send, and completes a whole report cycle through it')`、`:296` `it('admits a Delivery that does have somewhere to send, and the core never decides to use it')` |
| C241 | **聊天来源的生产者本体**：扫描频道目录 → 静置窗口(`SETTLE_MS` 1s) → 大小上限(512KB) → 解析出 `from`/`id` → 查映射 → 过门禁 → 归档 | **真宿主验证** | `src/sources/chat.ts:66-75`（`SETTLE_MS=1000`、`MAX_BYTES=512*1024`、`OUT_DIR='out'`、`LIST_LIMIT=5`）、`:151` 的 `poll()`、`:324-325` 的静置与大小判定。真宿主证据：`docs/v2/16-…` 场景 1【实测】投料 → Trigger `40dbe2b2…` **与投料前本地复算的 `key('chat','room-a','msg-acc-001')` 逐字符相同** → Ticket → 真 worker（`usage` total 37755）→ 回复文件；原文件消失并归档为 `room-a/accepted/40dbe2b2…-acc-001.md`（**纯函数名、无时间戳**），文件落盘到 `created` 仅 **0.77s**。离线：`tests/chat.spec.ts` 14 条、`tests/chat-send.spec.ts:115` `it('turns a mapped message file into a Ticket whose Mandate says where it came from')` |
| C242 | **身份必须被映射，不能被推断；未映射的消息留住、不消耗** | **真宿主验证** | 这是 P8 的核心，`src/sources/chat.ts:30` 的小节标题逐字是 “## Identity is mapped, never inferred (contract §2 — the reason P8 exists)”。映射表在设置里（C225），`kind` **不由 Source 决定**——映射本身就是操作者的断言（`00:1898-1902`：**“判断权在设置，不在代码”**），理由是风险清单 §3 那个反面教材：inbox 的发起者来自请求文件**自身**，所以门禁的 `allowedSenders` 校验的是一个**自述的名字**，聊天来源绝不能重复这个错误。**未映射的消息走产出侧**（像 inbox 的 paused/deny）：留在原处、不产生 Trigger 与 Decision、健康板上一行“N 条来自未映射身份的消息在等待”，补上映射之后**下一次扫描就会受理它**。真宿主证据：`docs/v2/16-…` 场景 2【实测】留住 8s（8 个扫描周期）——六项计数与起点**逐位相同**、文件 **308B 且 mtime 未变（一字节没动）**、`chat.waiting={count:1,ids:["U09UNMAPPED"]}`、健康行逐字取到；**加映射后同一条被受理恰好一次**（Trigger `bf0cad26…` = 预算值、**`at` 仍是文件 mtime `10:36:50Z` 而不是受理时刻**、归档一份、waiting 归 0），再等 43s（≈43 个周期）**无第二份归档**；场景 1【实测】`sender={id:"acc-alice", kind:"person"}`——**不是**平台 id `U01ACC01`。离线：`tests/chat.spec.ts:144` `it('produces nothing, stays where it is, and the board says how many are waiting')`、`:178` `it('is accepted once the operator maps the identity — the same message, exactly once')`、`:208` `it('does not even look at a disabled channel, so nothing in it counts as waiting')`、`tests/chat-send.spec.ts:136` `it('holds a message from an unmapped identity, and admits the same file once the map names it')`。**第 36 轮裁定 1 更正了契约里的一行**（`00:2023-2026`）：原文写“解除后不复活已过去的那条，与 rule 同理”——**那是为瞬时事件写的**；rule 读的是事件、事件过去了就没了，而 chat 读的是**文件**、文件不会过期，所以被留住的那条**应当**在解除后被受理。**“留住”与“丢弃”的区别正是这一条** |
| C243 | **chat 消息不 honour `scope` 前置字段**（一个信任决定，不是遗漏） | **离线验证** | 第 36 轮裁定 4（`00:2035-2038`）：inbox 的 `scope` 是**操作者写的**，而 chat 的发送者是“已映射但不是操作者”——**“让一个非操作者的发送者设定工作的授权范围，等于让请求方自己写自己的授权”**。映射表回答“你是谁”，不回答“你可以做什么”；后者仍然只来自设置与排期。离线：`tests/chat-contract.spec.ts` 的门禁组（`:52` `it('routes a chat Trigger through the gate as its own origin, not as one of the four kinds before it')`、`:79` `it('refuses a chat Trigger on the chat block's own pause and deny, and not on another Source's')`）。**没有一条测试的名字直接钉“chat 不读 scope”**，所以这一半的准确状态是**裁定 + 间接覆盖**；核实它需要一条断言“一份带 `scope` 前置字段的 chat 消息产生的 Mandate 的 scope 来自设置而不是消息”的测试——**本文未核实这样的测试是否存在**（`grep -n "scope" tests/chat.spec.ts tests/chat-send.spec.ts` 里没有这样一条名字） |
| C244 | **`deliver`：把一句话写成频道 `out/` 里的一个文件，文件名是内容的纯函数** | **真宿主验证** | `src/sources/chat.ts:446`（`async deliver(replyTo, text)`）、`:73` 的 `OUT_DIR='out'`。文件名 = `reply-<hash>.md`，`hash` 是内容的纯函数，**所以重试不产生第二份**。真宿主证据：`docs/v2/16-…` 场景 1【实测】`room-a/out/reply-40f114496924e6c7a442ba5998bfb28e.md`（253B），**正文即报告摘要原文**、front matter 带回 `thread`、hash 本地复算一致。离线：`tests/chat.spec.ts:327` `it('writes the reply as a file whose name is a pure function of what it carries, so a retry does not duplicate')`、`:361` `it('refuses a reply whose channel is gone or switched off, with the code that names exactly that')`、`tests/chat-send.spec.ts:213` `it('queues one reply when the same words are asked for twice, and a second when they differ')`。**经变异检验**（C1 的第三条：“把 `Date.now()` 混进回复文件名的 key”，最初是绿的、加强到两次投递间隔 5ms 之后变红——纪律 §0.8 的原始事故，见 `docs/v2/11-test-report.md` §5 第 2 条） |
| C245 | **`waiting()`：结构化的等待队列读法**（第 37 轮，修的是“改一句英文就能静默清空面板”） | **离线验证** | `src/sources/chat.ts:173` 返回 `{count, ids, more}`，**与健康句在同一处、由同一组值组成**（`:257-271`：`shown` 取前 `LIST_LIMIT=5` 个、`more` 是剩下的个数，同一组值既拼进健康句也存进 `waitingNow`），所以两者**不可能漂移**。`src/app/http.ts:204-232` 的 `chatView` **优先**用它，正则退为“Source 不提供 `waiting()` 时”的路径。**修的是什么**（`00:2199-2206`）：平台 id 此前只存在于**那句英文健康文本里**，`http.ts` 用正则解析它、锚在 `; add each id` 上——**“这是一个我在第 36 轮亲手放大的风险”**：裁定 2 里改过 `reply_unroutable` 的措辞，而**改一句话就能静默清空面板上的等待队列，消息却还在磁盘上**。那是最坏的失效形状：**看起来像问题自己消失了**。`:264` 的注释逐字记着这件事（“`reply_unroutable` was reworded once already, in round 36”）。离线：`tests/http.spec.ts:567`、`:589`（后者钉的正是“健康行没点名的还有几个”）。**经变异检验**：让 `waiting()` 永远返回空 → **2 条测试变红**（`00:2207`：“所以这条路径是承重的、且已被覆盖，不是死方法”） |
| C246 | **频道目录的权限自检**（与 inbox 那条同族，但**每轮 pass 都查**） | **离线验证** | `src/sources/chat.ts:301-306`：`(mode & 0o022) !== 0` 就上一行健康问题，措辞点名后果与补救——“**so anyone who can write there can submit work as any mapped identity; tighten it with chmod go-w**”。代码注释写了为什么是每轮而不是 `start()` 里查一次（`:301`：“a directory this Source just created, or a chmod while it runs, is seen”）——**这一点与 inbox 那条刻意不同**（C171：inbox 在 `start()` 里查一次，因为每次扫描都上问题会与扫描自己的健康摘要争同一个条目）。离线：`tests/chat.spec.ts:386` `it('is reported with the mode and the remedy, and survives a pass that also takes a message')`、`:407` `it('says nothing when the directory is only the operator's')`。**日常宿主上此前不可达、本轮重载后可达但未被驱动**（§0.3）——而且此刻连“可达”都只是形式上的：3080 的 `settings.sources.chat` 是 `{enabled:false, identities:{}, channels:[]}`（§0.3），**一个频道都没有配**，所以这条自检在线上没有任何目录可查 |
| C247 | **chat 的 Trigger id 是消息身份的纯函数**：`key('chat', channelId, messageId)` | **真宿主验证** | `src/sources/chat.ts:42` 的注释逐字写着 “The Trigger id is `key('chat', channelId, messageId)` — the message's identity only, never a timestamp and never …”。这是 S31 那条教训（“身份必须是它所指事物的纯函数”）在新来源上的应用，也是 C242“补映射后恰好受理一次”能够成立的**全部机制**。真宿主证据：`docs/v2/16-…` 场景 1【实测】Trigger id 与**投料前本地复算**的 `key('chat','room-a','msg-acc-001')` **逐字符相同**；场景 2【实测】补映射后 Trigger `bf0cad26…` 等于预算值、且 **`at` 仍是文件 mtime 而不是受理时刻**、再等 43s **无第二份归档**。离线：`tests/chat.spec.ts:270` `it('is one Trigger with one id, however many scans or re-deliveries see it')` |


## 5. 入口与配置（2 个文件，**167 行**）

| 文件 | 行数 | 责任（一句话） | 公开面 | 依赖 |
| --- | --- | --- | --- | --- |
| `src/index.ts` | **71** | 插件主入口：挂载 Runtime，并在这个插件被处置或重挂载时停掉它 | `name` `inject`(9 个服务) `Config` `apply` `packageFile` `promptFile`；转出 `DeploymentConfig` `Machine`、`./core/index.ts` 的全部，**以及第 35 轮补上的 `./sources/kind.ts` 的全部**（C248） | cordis（类型）、`./app/runtime`、`./deployment` |
| `src/deployment.ts` | 96 | 插件配置：这次部署把它的状态、工作与收件目录放在哪儿 | `expandPath` `dshHome` `Config` `DeploymentConfig` `Machine` `SetupError` `machineOf` `machineView` | `node:fs` `node:os` `node:path`、cordis（`Volatile` 类型）、schemastery |


| C190 | `apply` 永不 reject：一个起不来的 bundle 就是什么都不做的 bundle，它记日志、标自己不健康、**不动宿主** | **离线验证** | `tests/mount.spec.ts` 的 `never rejects, so a bundle that cannot start does not take the host down`、`mounts on a usable host and leaves it running`、`reports a main Session it cannot create instead of throwing it at the host`。**真宿主上的间接证据（S37）**：热重载之后宿主 pid 24619 未变、一直在服务、库被正常迁移 —— 但那是"没崩"，不是"一个起不来的 bundle 被优雅降级"，两者不是同一个命题 |
| C191 | 挂载期**不**创建、不解析、不装饰任何 Session | **真宿主验证** | `02b` §4.6【残件】`state-mount.json`（02:40）：`mainSession = {exists:false, running:false, busy:false, id:"myagent-acc-main"}`；`kv` 里始终没有 `main-session:id`，所以 id 来自配置而不是库；`verify-live.sh` 第 3 步因此通过（挂载期没偷建 Session）。离线：`tests/mount.spec.ts` 的 `starts without creating, resolving or decorating a Session`、`creates the main Session only when somebody asks for it` |
| C192 | 路径解析：每个路径都有 DSH 自己家下面的默认值，所以 bundle 装上就能用；`stateDir` 变更会重挂载插件 | **真宿主验证** | 本文只读复核：日常宿主的 marker `~/.dsh/state/myagent/myagent.json` 逐字段是 `pid 24619` / `stateDir` / `workRoot` / `inboxDir` / `mainSessionId: "myagent-main"` / `promptMaxChars: 100000` / `at`，即默认解析在真宿主上生效。`02b` §4.6 也列了隔离部署的同一组路径。离线：`tests/deployment.spec.ts` **10 条**（`expands a home directory, keeps an absolute path, and resolves a relative one against the cwd`、`puts everything under DSH's own home`、`makes the directories it resolved, so the first Ticket does not fail on a missing one`、`takes the paths a profile wrote`、`treats an empty setting as no setting…`、`names the setting that cannot be used, one at a time`、`refuses a main Session id that could not be a Session id`、`refuses configuration keys it does not use…`、`bounds the prompt override…`） |
| C193 | `inject` 的 9 个服务在这个 profile 上真的都在（`agents` `sessionController` `sessionPersistence` `workspaceRegistry` `permissionPresets` `tools` `systemPrompt` `webServer` `subprocess`） | **部分实现** | **得证的一半（真宿主验证）**：`01` §1/§8 —— worker 起来了、工具白名单生效了、`webServer` 送出了面板与 34 条路由、`subprocess` 跑了 prepare 与通知，所以这些服务在**本机这个 profile** 上确实存在。**未验证的一半（尚未实现）**：`00` §6 明说 stub **完全没有** `sessionProjections` 服务（"这是 V2 预算的硬阻塞：离线 `ctx.sessionProjections` 是 undefined，任何预算代码都会 TypeError"）、没有 `sessionController.inspect`、没有 `systemPrompt` 服务，而且"**没有任何东西验证 `myagent-worker` 预设真的存在**"。换一个 profile 会怎样，没有测试、也没有验收 |
| C194 | 默认 `mainSessionId: 'myagent-main'` 在共享 `DSH_HOME` 的多个部署之间不撞名（B1/S26） | **部分实现** | **已修的一半（真宿主验证）**：修法是 `notify()`/`relay()` 在解析不到主 Session 时 `ensureMaster(machine.workRoot())` —— 解析不到就创建，见 C101；`01` §8 的 `POST /api/main-session` → `myagent-acc-main` 得证了按需创建这半。**未验证的一半**：**撞名本身**（DSH 回 `RemoteError: session belongs to <另一个目录>`）从未被复现或修复 —— `00` §7 的 S26/B1 行标的是"第 11 轮已修"，而修的是"静默丢掉全部前台回报"那一半（`01` §9 B1 明说"正确修法是 `ensureMaster`"），**不是"默认 id 会撞名"那一半**。隔离验收用的是 `myagent-acc-main`（配置里改过的），所以撞名路径一次都没走过 |
| C248 | **发布的类型里有 Source 协议**：`src/index.ts` 转出 `./sources/kind.ts`（第 35 轮修的一个契约缺口） | **部分实现（未接入）** | **已做的一半**：`00:1955-1961` 记了这个缺口——`src/index.ts` 导出 `./core/index.ts` 但**不导出 `./sources/kind.ts`**，所以 `Source`/`SourceKind`/`SourceHost`/`TwoWaySource` **不在 `lib/index.d.ts` 里**（当时 grep 计数 0），`import type { TwoWaySource } from 'myagent'` **无法解析**；而 P8 契约 §4 写的正是“第三方要实现什么”——**接口存在于源码树、却不存在于发布的类型里**，这与“Engine 命令零调用者”是同一个缺口的另一层。已加一行导出。**本轮复核**：`lib/index.d.ts` **86454 字节**，`grep -c "TwoWaySource" lib/index.d.ts` → **2**（`00:1958` 记的当时值是 **0**），即接口现在**确实在发布的类型里**（本文只读复算，未重建）。**未接入的那一半**：**没有任何第三方实现存在**，所以这条导出至今只有一个消费者（`src/app/runtime.ts:20` 的 `chatKind`，而那是本仓库自己的代码）。**接入它需要什么**：一个仓库外的 Source 实现——即 P8 契约真正的验收对象；`00:1919-1920` 明确把“接任何真实平台 SDK”排除在第一片之外（理由是接入真实平台会引入凭据、网络与限流，**那些是部署问题，会淹没这一片真正要验证的东西（身份映射）**），所以这一半是**刻意留着**的，不是漏掉的 |

---

## 6. `panel/`、`scripts/`、`prompts/`、`examples/`、`locale/`

| 文件 | 行数 | 责任（一句话） | 公开面 | 依赖 |
| --- | --- | --- | --- | --- |
| `panel/index.html` | **2128**（128775 字节，sha256 `2fdbfcad0f440318…`；本文 00:5x 量到的是 2121 行 / 127974 字节 / `290eed86…`，主代理在 02:04:12 加了一条 CSS 修复） | 操作者的整个界面：单文件、8 个标签、无外部依赖、无 CDN、无构建步骤，由路由原样从磁盘送出 | 8 个标签（`tickets` `works` `new` `decisions` `sources` `schedules` `settings` `prompts`）；聊天一节与「丢失的请求」区块都在**「来源」页**里；它调用的 API 见下表 | 无（`grep -cE "https?://\|cdn\|<script src\|import " panel/index.html` → **0**） |
| `scripts/gate.sh` | **93** | 验证闸门：一条命令给出唯一结论，并且**自己决定退出码** | 退出码；日志写 `/tmp/myagent-gate.log`，**计数行与结论行现在也落盘**（`:80`、`:84` 的 `tee -a`） | `pnpm typecheck` / `pnpm build` / `pnpm test`、`find`、`node`、`shasum` |
| `scripts/verify-live.sh` | 90 | 对已经装了 myagent 的宿主做**只读**验证：不创建 Ticket、不创建 Session、不改设置 | 退出码 0 = 全部通过；9 个步骤 | `curl`、`python3` |
| `scripts/verify-migration.sh` | 92 | 迁移演练：在一个**副本**上跑当前构建的迁移，证明既有数据一个字节都没变，并演练回滚 | 退出码 0 = 数据未变且回滚安全；末行 `── 通过：可以升级线上库` | `sqlite3`（`VACUUM INTO`、`mode=ro&immutable=1`）、`shasum`、`node` |
| `prompts/worker.md` | **61** | 一个 Ticket 的 worker 被告知的全部：它在哪、怎么报告、怎么工作、委派时要注意什么、它不是什么 | 出厂文本，可被面板覆写并存进库 | — |
| `prompts/orchestrator.md` | 62 | 主 Session（操作者的前台）被告知的全部：什么时候开 Ticket、附件怎么传、怎么回答、不许编造状态 | 同上 | — |
| `examples/daily-digest.json` | 32 | 一份**完整的设置文档**：每天 09:00（Asia/Shanghai）的竞品摘要，出厂是 `observe` 模式 | 面板「设置」页可直接粘贴 | — |
| `examples/data-report.md` | 20 | 一个**请求文件**：复制到收件目录就变成一张 Ticket，带 `title`/`scope` front matter | 面板「派活」页的配方之一 | — |
| `examples/README.md` | 52 | 两份配方的说明书与“写配方的三条规矩” | — | — |
| `locale/en.json`、`locale/zh.json` | **各 6（上一版没有清点这一层）** | 插件在宿主界面里的名字与一句话描述 | `meta.title`、`meta.description` | — |

`panel/index.html` 实际调用的路由（`grep -oE "api\(..."` 与模板字面量，本轮重跑）：
`state`、`tickets?state=…&limit=80`、`tickets?state=all&limit=200`、`tickets/:id`、`tickets/:id/progress`、
`tickets/:id/files`、`tickets/:id/file?path=`、`tickets/:id/events?limit=`、`tickets/:id/dependencies`、
`projects`、`projects/:id`、`works`、`works?project=`、`works/:id`、`decisions?limit=80`、`effects`、`recipes`、
`schedules`、`prompts`、**`lost?limit=`（第 45–46 轮新增）**；写侧是 `POST`（含 `tickets/:id/work`、`dependencies`、
`dependencies/drop`）与 `PUT`（`settings`、`prompts`）。
**`triggers` 仍然零命中**（C135）——即 `GET lost` 有了页面而 `GET triggers` 依然没有。


### 6.1 `panel/index.html` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C195 | 8 个标签、单文件、零外部依赖、无构建步骤 | **离线验证** | `tests/panel.spec.ts` **186 条**（闸门 02:40:09；上一版记 146，本文 00:5x 量到 185）。8 个 tab 仍是 `tickets` `works` `new` `decisions` `sources` `schedules` `settings` `prompts`（`panel/index.html:126-133`，`tests/panel.spec.ts:592` 起的 `describe('the tabs')` 钉住了那个顺序数组——**第 37 轮的聊天区块因此是「来源」页里的一张卡而不是新 tab**，`00:2181-2182` 记了理由：加 tab 就得改既存断言）。`grep -cE "https?://\|cdn\|<script src\|import " panel/index.html` → **0**（本轮重跑同一命令，同一结果）。`tests/http.spec.ts:36` 的 `serves the panel page to anybody who can reach the port` 与它对面板标记的断言 |
| C196 | 面板在**真浏览器**里的行为（布局、`scrollTop` 还原、横幅的 flex 排版、Blob 下载、剪贴板） | **部分实现** | **得证的一半（离线验证）**：**186 条** jsdom 断言，含 `keeps a file open across a refresh, because closing it is losing the operator's place`、`hands a file over as a download under its own name, and gives the address back afterwards`、`copies the Session id when the browser lets it`、`says plainly that it could not copy…`。**未得证的一半（尚未实现）**：**连验证手段都没有** —— `05` §5 与 `01` §10 都明说“没有真浏览器可用”。`tests/panel.spec.ts:1` 是 `// @vitest-environment jsdom`，而 `vitest.config.ts` 的全局 environment 是 `node`，所以只有这一个文件在 jsdom 里；`:395` 与 `:418` 的注释点名了 jsdom 缺什么。`05` §5 列了具体后果：“`scrollTop` 恢复、横幅的 flex 排版这类只有真浏览器能证”。**第 37 轮的聊天卡与第 45–46 轮的「丢失的请求」区块都落在这个范围里**——它们一共 39 条新断言，全部是 jsdom。**本轮 02:04 新加的第 186 条把这个缺口说得最清楚**：它钉的是 `.hidden { display: none !important }`（`panel/index.html:85`），而 `:83` 的注释逐字写着 “Found only by a person looking at the page. Every other `.hidden` user is class-styled, so this also protects the …”——即**这条规则此前只能靠人看着页面发现**；现在有一条 jsdom 断言钉住它，而 **jsdom 的 CSS 层叠与真浏览器不是一回事**，`!important` 的优先级恰恰是层叠的一部分 |
| C197 | 工作页：Project/Work 列表与创建、Work 详情按 `workSeq` 排序、点 Ticket 跳转；空状态写成"下一步做什么" | **离线验证** | `tests/panel.spec.ts` 的 `the 工作 page` 一组 9 条（`lists the Projects and Works the server has, and reads both on the way in`、`says what to do when there is no Project and no Work, rather than a bare 无`、`creates a Project from the name and note the operator wrote, and empties the form`、`creates a Work carrying the Project, scope and note, and puts what it made on screen`、`opens a Project to its Works, and steps back out with a second click`、`opens a Work and shows its scope, its note, and its Tickets in the order they joined`、`says what an empty Work is missing, in a sentence`、`takes the operator from a Work to one of its Tickets`、`keeps the form the operator is filling when the five-second refresh lands`） |
| C198 | 详情页的四个 V2 区块：归属（含对已结束 Ticket 也可"归入工作"）、产物、依赖（两个方向分开且各自标注）、历史（最新在前、`人/代理/系统 · id`） | **离线验证** | `tests/panel.spec.ts` 的四组：归属 4 条（`shows on the row and in the detail which Work a Ticket is in, and its place in it`、`says a Ticket is not in a Work yet, and refuses to file it into nothing`、`files a Ticket into the Work the operator picked`、`offers to file a Ticket that has already ended, because filing is bookkeeping, not new work`）、产物 4 条、依赖 6 条、历史 3 条（`lists the facts newest first, with who caused each and what they said`、`reads more history when the operator asks, rather than cutting it off silently`、`keeps the whole history the operator has read when a refresh lands`） |
| C199 | `escapeText` **真的转义**（S36 的修复），且分类正确：进 `innerHTML` 的 3 处转义、进 `el()`/文本节点的 6 处不转义 | **离线验证** | `tests/panel.spec.ts:2586` 的 `shows a state directory as text rather than as an element`（把 `machine.stateDir` 设成 `/state/<img src=x onerror="document.title='pwned'">`，断言头部**不产生 `img` 元素**、`document.title` 没被改、而那段文本**按字面显示**）与 `:2602` 的 `leaves an ampersand alone where the text node already does the escaping`（`A & B < C` 按字面出现且页面里**不含 `&amp;`**）。`00` §4.19 记它经变异检验（把 `escapeText` 改回 `String(text ?? '')`，第一条立刻变红）。**这一族在第 37 轮与第 45–46 轮各扩了一组**：`tests/panel.spec.ts:3007` 起的 `describe('markup in a value a chat platform wrote')` 与 `:3274` 起的 `describe('markup in a payload the page could not parse')`——**即“平台写的值”与“读不出的载荷原文”这两类完全不可信的文本也走同一套转义**，这是 P8 与丢失可见性各自带来的一类新注入面 |
| C200 | 宿主插件旧于页面时的行为：探测一次再决定；一条横幅；新区块停止请求；404 toast 全被抑制；其它失败**不下结论** | **离线验证** | `tests/panel.spec.ts:2315` 起的 `describe('a host whose plugin is older than the page')` 一组 **8 条**（`says once, at the top, that the plugin has to be reloaded`、`asks nothing further of the routes it now knows are missing`、`keeps every section in place with one line…`、`keeps the rest of the panel working, and refreshing, because only the new routes are missing`、`does not toast about a missing route on every refresh`、`reads the new routes again when the operator says the plugin has been reloaded`、`concludes nothing from a failure that is not about routes, and keeps working as before`、`shows no banner and polls the new sections when the host does have the routes`），**加上第 37 轮新的一组** `:2954` `describe('a host whose plugin has no chat view yet')`。`05` §4 记了一次 **jsdom + 真 fetch 代理到 `127.0.0.1:3080`** 的实测（横幅出现、整段会话对 V2 路由只发了 **1 次**请求、**toast 0 条**）—— 但 `05` §5 自己划了界：“**那仍然不是浏览器**”，所以这一条仍是离线。**本文 §0.3 第 4 条量到了这个状态的真实形状，而且量到了它的结束**：00:5x 时 3080 送出的面板**含** `#lost-count`、`#chat-waiting`、`丢失的请求`，而它的 API **答不出** `GET lost`（404）、`state` 里**没有** `chat` 与 `counts.lost`/`counts.sends`——**“新页面 + 旧 API”当时就是线上状态，持续了至少 50 分钟**；01:40:15 插件被重载之后，`GET /api/lost` 返回 **200**、`state.chat` 存在、面板与磁盘逐字节相同（`2fdbfcad0f440318…`），**两者版本一致了**。**但一致只是这一节所有断言的前提，不是其中任何一条的证明**：那 8 + 3 条降级断言仍然全部跑在 jsdom 里，而真宿主上被读到的只有“探测之后没有横幅、路由都答得出”这一个正常态。`panel/index.html:1307-1308` 的措辞是诚实的：**“这不代表「没有丢失的请求」，它代表「读不到」。页面每次请求都从磁盘读，插件不是”** |
| C201 | 不丢操作者的位置：草稿、展开状态、打开的文件、二次确认、已放宽的历史条数、页面与历史的滚动位置，都跨 5 秒/3 秒刷新保留 | **离线验证** | `tests/panel.spec.ts` 的 `keeps what the operator is typing when a refresh lands in the middle of it`、`keeps a file open across a refresh…`、`keeps the whole report history open across a refresh`、`keeps a stop reason the operator has not sent yet when a refresh lands`、`keeps a half-drawn edge when the three-second refresh lands`、`keeps the whole history the operator has read when a refresh lands`、`does not refresh over a settings document the operator is editing`。**滚动位置那两条只在 jsdom 里成立**（见 C196） |
| C202 | 不开任何原生对话框：每个问题都在页面上问 | **离线验证** | `tests/panel.spec.ts` 的 `opens no native dialog: every question it asks is on the page`、`asks for a reason on the page, because a native dialog is the one thing this page never opens`；`:298` 用一个循环把 `alert`/`confirm`/`prompt` 三个都钉住 |
| C203 | 输入不被硬截断（报告与输入共用一个"展开全部 N 条"按钮） | **离线验证** | `tests/panel.spec.ts` 的 `keeps the newest six reports on screen and lets the operator ask for the rest` 与 `keeps the newest six inputs and lets the operator ask for the rest, like reports`。`05` §1 记了这是一处**回归的修复**：报告超过 6 条有"展开全部"而输入没有，"第 7 句回答就这么消失了" |
| C204 | 面板渲染 token `usage` | **尚未实现** | `grep -c "usage\|Tokens\|token" panel/index.html` → **0**（本轮重跑，仍是零命中；`panel/index.html` 已从 1528 行长到 2121 行，中间加的是聊天卡与丢失区块，**没有一处渲染 usage**）。API 侧已经带上了，而且**第 38 轮在真宿主上读到过它**（C95：`docs/v2/16-…` 场景 1【实测】`GET /api/tickets/<id>/progress` 返回 `usage:{inputTokens:9224, outputTokens:495, cacheReadTokens:28036, messages:5, totalTokens:37755, windowed:false}`）。`00` §4.21 与 §4.23 的「未做（P6 剩余）」都记着“面板还没渲染 `usage`”。所以现状是：**用量被诚实计量、被真宿主读到过、而操作者在任何界面上都看不到它** |
| C205 | `#work=<id>` 深链、事件类型的筛选与中文对照、依赖对端候选超过 200 张时的选取 | **尚未实现** | `05` §5 与 `00` §4.19 的「其余未做」逐条点了这三个缺口，**都只说了缺什么、没有设计**。本文核对：`panel/index.html` 只有 `#ticket=`（`:547` 写、`:1940` 读），**没有 `#work=`**；依赖的对端候选来自 `GET tickets?state=all&limit=200`（超出这 200 张的旧 Ticket 只能手填 id）；历史没有过滤，`type` 按原词显示。**第 45–46 轮加了一个新的深链需求而没有加它**：`#lost-count` 药丸跳到「来源」页的区块，但没有 `#lost=` 这类可直接引用的地址 |
| C249 | **面板的聊天一节**（第 37 轮 D）：未映射等待队列、身份映射的增删改、页头 `#chat-waiting` 药丸 | **离线验证** | 位置是**「来源」页里的一张卡**而不是新 tab（`00:2181-2182`：`panel.spec.ts` 钉住了 8 个 tab 的确切顺序数组，加 tab 就得改既存断言）。页头药丸在 `panel/index.html:93`（0 时隐藏），它的 `title` 逐字写着为什么必须有它：**“聊天来源留住了几条来自未映射身份的消息：它们没有变成 Trigger，也没有被拒绝，文件还在频道目录里。把身份加进映射表，下一次扫描就会受理。”** —— 而 `00:2188-2189` 把理由说得更硬：**留住的消息不产生 Decision、不产生 Ticket、不弹 toast，若没有这个药丸它就是隐形的**，所以“被留住的消息在每一页都看得见”。**等待队列有 7 种状态，其中前 5 种刻意不许读起来像“空”**（没在跑 / 已停用 / 已暂停 / deny / 没有频道）——因为“Source 关着”与“没有消息在等”是两个不同的事实，而把它们都显示成空正是这个面板反复被抓到的那种安静的错。`(no from)` 的身份**不给「映射它」按钮**而只说“去改那个文件”：**一个不可能成功的控件比没有控件更坏**。身份映射到一个不在 `allowedSenders` 上的名字要**单独二次确认**，因为那次门禁拒绝是**不可逆的**、它会烧掉操作者正想放行的那条消息。离线：`tests/panel.spec.ts:2614` 起的 `describe('the chat Source')` 一组（本轮数：186 条里 chat 相关 **26 条**，与 `00:2174` 记的增量 panel +26 吻合）+ `:2954` 起的降级组 + `:3007` 起的转义组。**经变异检验 5 条**（`00:2191-2195`）。**全部跑在 jsdom**（C196）；日常宿主上**此前**不可达、本轮重载后可达但未被驱动（§0.3：`state` 里没有 `chat` 键） |
| C250 | **面板的「丢失的请求」区块与 `#lost-count` 药丸**（第 45–46 轮） | **离线验证** | `panel/index.html:222-233`（区块）、`:99`（药丸）、`:457`（读数）、`:1307-1325`（降级与空态）。**两条路径分开呈现**（`rows` = 被认出过、后来被丢的请求；`payloads` = 根本读不出的原文），因为把它们合并会**藏掉发生的是哪一种**，而第二种是“唯一还能读的就是那段文本”的那一种。**药丸在 bundle 答不出来时隐藏**，理由写在 `00:2745`：**“‘这个 bundle 答不了’不等于‘没有丢失’”**；`:1307-1308` 的页面文本逐字是 “宿主的插件比这个页面旧：GET state 里没有 counts.lost，这一节读不到丢失的请求。这不代表「没有丢失的请求」，它代表「读不到」”。**补救说明是诚实的**：UI 里明写“**系统不会自动重放它们**”，以及 `lost` 行**不算重复**（所以同一个请求再来一次门禁会重跑）——**没有给一个不可能成功的按钮**。离线：`tests/panel.spec.ts:3056` 起的 `describe('the requests the queue gave up on')` 一组 **11 条** + `:3274` 起的 `describe('markup in a payload the page could not parse')` **3 条**，共 **14 条**；`00:2751` 记的增量是 http +7、panel **+13**——**本文数到的 14 比它多 1，多出的那一条是新增还是既存组的扩写，本文未核实**（核实它需要第 44 轮之前的 `panel.spec.ts`，而本项目不是 git 仓库、没有历史可查）。**全部跑在 jsdom**。**这一条的线上形状在本轮期间变过一次，两个状态都值得记**：本文 00:5x 复核时，3080 送出的面板**含**这个区块而它的 API 对 `GET lost` 返回 **404**——**“新页面 + 旧 API”当时就是线上状态，正是这一节被写来应付的那个**；01:40:15 重载之后 `GET /api/lost` 返回 **200**、`counts.lost` 是 `{rows:0,payloads:0}`、`bounds:{keep:20,chars:1000}`（§0.3），即**降级路径与正常路径在同一个晚上都被读到过，而两条都只有只读的、对着空数据的观测** |

### 6.2 `scripts/` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C206 | `gate.sh`：把“绿灯”定义成**退出码**而不是输出里的一句话（纪律 0.1）；**并且让日志自报它验了什么**（本轮新增） | **部分实现** | **上一版那一半“未核实”已经被脚本自己解决了一半**：`scripts/gate.sh:80` 与 `:84` 都是 `echo … \| tee -a "$log"`，而 `:84` 只在 `[ "${#failures[@]}" -eq 0 ]` 分支里执行、紧接着就是 `exit 0`。`/tmp/myagent-gate.log` 的首行与末三行逐字是 `── 本次运行：scripts/gate.sh （2026-11-05 02:40:09）` / `── artifact` / `── 计数：Tests  760 passed (760)` / `结论：通过。产物 768a6adb1cfc136c…（320163 字节）` ——**所以“结论：通过”出现在日志里等价于 `failures` 为空、脚本走到了 `exit 0`**。**本轮又给它补了一条，而且是本文亲手撞出来的**：`--quick` 与完整闸门**写同一个日志文件**，所以 02:21:51 那次只跑了 typecheck+test 的运行，在日志里留下的也是一行“结论：通过”——**下一个读者会把它当成四步全绿的证据**。本文在 02:3x 读到的正是这样一份日志（只有 `── typecheck` 与 `── test` 两节），并据此发现 `scripts/gate.sh:22-25` 现在把运行方式写成了日志的**首行**：`── 本次运行：scripts/gate.sh （2026-11-05 02:40:09）`。脚本自己的注释逐字写着理由：**“判定权在退出码，但退出码不留痕；留痕的那份东西必须自己说明它验了什么、没验什么。”**这与纪律 0.1 是同一条规律的第二层：0.1 管的是“别拿一句话当结论”，这一条管的是“**别拿一份不说明自己范围的记录当结论**”。**未得证的一半**：本文**没有直接观测到退出码**——重跑闸门会重建产物、改变本轮被钉住的身份，所以“退出码 0”是**从日志末行 + `gate.sh:82-85` 的分支逻辑推出的**，不是本轮的量测。上一版把这一半标成“未核实”的理由（“结论行只 echo 到 stdout、不进 `$log`”）**已被当前脚本否证**，于是这一半从“无从核实”收窄成“可以推出、但没有直接观测”。本文只读复现的其余检查：`find src tests -name '*.ts' -newer lib/index.js` → **0 个**；`grep -c '\.run(5)' lib/index.js` → **1**；死表 `settings` 的 DDL 在产物里 **0 次**；`shasum -a 256 lib/index.js` → `768a6adb1cfc136c…`、320163 字节、mtime `Nov  5 00:43:54 2026`。**脚本本身从 87 行长到 89 行**，长的两行正是那两处 `tee -a` 与它们的注释（“计数行也要落盘：它是判断的一部分，而只打到 stdout 意味着事后无法从日志复核”） |
| C207 | `tests/build.spec.ts`：机器强制“发布的产物就是这份源码构建出来的”（4 条） | **离线验证** | 4 条是：`exists, because the host loads this file and nothing else`（`:32`，**无条件**）、以及 `it.skipIf(!existsSync(bundle))` 的三条（`:37` `is newer than every source file, so what ships is what this source says`、`:45` `stamps the schema version this source declares`、`:51` `no longer creates what this source has dropped`）。**上一版说“4 条都是 `it.skipIf`”，与代码不符**——第一条是无条件的。这个差别有实际后果：产物若不存在，闸门会报 **756** 而不是变红，**三条静默跳过**。`00` §4.15 S32 记了它的有效性证明：“它第一次运行就抓到了当时仍未重建的产物 —— 即它对自己被写来防的那件事是有效的”（那份陈旧产物：20 个 src 文件比它新、`.run(1)`、死表 DDL 仍在）。**第 45–46 轮它又挣回一次成本**：`00:2758-2759` 记“我测到的唯一红是 `build.spec` 的新鲜度断言（`http.ts` 与 `tests/http.spec.ts` 比产物新），**重建之后立刻全绿**”——即那个死掉的子代理留下的树**只**被这一条断言标了出来 |
| C208 | `verify-live.sh`：9 条只读断言 | **真宿主验证** | `02` §10：残件 `verify-live-3180-v2.txt` 末行 **通过 9 条，失败 0 条**（上一轮是 8 通过 1 失败，失败的那条是健康板带着故意造出来的问题；这次健康板干净）。`01` §7 是对隔离宿主的那次实跑 |
| C209 | `verify-live.sh` 第 4 步区分"插件坏了"与"上游 429 / 你自己刚造出来的问题"（S28/B5） | **尚未实现** | `scripts/verify-live.sh:39-49` 的第 4 步是 `sys.exit(1 if bad else 0)` —— 对**任何** `ok:false` 的健康条目都退出 1。`01` §9 B5 与 `02` §10 都记着它（"已被日常宿主的 429 实证：此刻它对你的日常宿主就会 exit 1"），`03` §6 与 §2.5 也记着"已知未修"。**记录了缺口但没有设计**，所以标 尚未实现 |
| C210 | `verify-migration.sh`：副本演练（`VACUUM INTO` 取一致性快照、显式列名摘要、新表在/死表不在、`integrity_check`、`foreign_key_check`、回滚演练） | **真宿主验证** | `02` §1 与残件 `verify-migration-fixed.txt`（逐字结果见 C55）；`03` §2.2 记了另一次对线上库副本的实跑（10/8/10/4，摘要 `bcf92225a76e43e7` 前后一致）。**`02b` §6.3 补的两条限定必须一起读**：副本演练跑的是 `src/app/store.ts`（脚本直接 import 源码），**不是 `lib/index.js`** |
| C211 | `verify-migration.sh` 能打开一个**静止的 WAL 库**（S34 的修复：`mode=ro&immutable=1`） | **真宿主验证** | `02` §1 与 `02b` §4.4：根因证明是文件头第 18–19 字节 `xxd -s 18 -l 2` = `0202`（WAL）；干净的 A/B（无 `-wal`/`-shm` 的原始副本 → 退出 1 `unable to open database file (14)`；一次普通打开造出 `-shm` 后 → 退出 0）；`sqlite3 --version` = `3.54.0`。残件 `wal-repro/`、`wal-repro2/` 与三份输出（`verify-migration.txt`、`-literal.txt`、`-fixed.txt`）**都还在**。`02b` §4.4 还披露了一个副作用：那次"普通打开"的诊断在**隔离** stateDir 里造出了 `-wal`/`-shm`，主库文件 sha 前后都是 `c1056a0d…`、未变 |
| C212 | 降级路径：**真的装回旧构建跑一遍** | **尚未实现** | `03` §6 明说"没有真的装回旧构建跑一遍 —— 因为旧构建的代码已经不在树里。要真验证，需要一个保留了 v1 构建的分支或标签"。**S37 之后这一条的性质变了**：日常库现在是 5，所以任何旧构建挂上来都会 `SchemaTooNew` 拒绝打开（C56），而这条路径**一次都没有被观测过**。本文核对：项目目录**不是** git 仓库（`git log` → 退出码 128），所以"保留一个 v1 构建的分支或标签"这件事目前**没有载体** |

### 6.3 `prompts/` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C213 | `worker.md`：worker 的边界、六种报告状态各自的含义、"按影响停而不是按努力停"、"绝不为了不问而绕过限制" | **真宿主验证** | `01` §1/§8：5 张完整 Ticket 的 worker 都在这份提示词下起来并按六种状态里的四种报告过（`ready`/`waiting`/`failed`/`stopped`）。`00` §1 行「RESULT.md」与 `01` §8 的 `Authorized by: operator via inbox` 说明 Mandate 段也被渲染进去了。**限定**：`progress` 与 worker 主动 `blocked` 这两条状态**从未在真宿主上被 worker 自己用过**（C36） |
| C214 | `worker.md` 对 worker 工具面的陈述 | **部分实现** | **上一版记的“错误的一半”已在第 30 轮修掉**：`prompts/worker.md:11-16` 现在写的是 “You have **three** tools, and no others. `myagent_report` is how you tell the system what became of the work — call it before your turn ends, always. `myagent_note_ticket` hands one fact to another Ticket in the same Work. `myagent_read_artifact` reads a file another Ticket in the same Work produced and registered.”，并解释了后两个为什么窄（`:15`：“they cross between Tickets only inside one Work”）。`grep -ni "artifact\|note_ticket\|read_artifact\|same Work" prompts/*.md` 现在**有命中**（上一版是零命中）。`## If you delegate` 段（`:51` 起）仍在：“**A subagent cannot report.** `myagent_report` is registered on your Session only …”。真宿主证据：`01` §1/§8（5 张完整 Ticket 的 worker 都在这份提示词下起来并按六种状态里的四种报告过）、`docs/v2/16-…` 场景 1【实测】worker 的 `RESULT.md` 含 `Authorized by: acc-alice via chat`（即 Mandate 段被渲染进去了，而且**署名是映射后的 actor、不是平台 id**）。**限定**：`progress` 与 worker 主动 `blocked` 这两条状态**从未在真宿主上被 worker 自己用过**（C36）；而**没有任何测试断言这份文本的内容**（`grep -rn "worker.md" tests/` 只命中 `tests/prompts.spec.ts` 的“找得到这个文件”），所以“文本已发布”与“文本被钉住”是两件事。**为什么标 部分实现**：正确的那一半是**本轮逐字核对**出来的（读文件，不是跑宿主），而**没有任何东西防止它再次漂移**——第 13 轮与第 25 轮就是这样漂移了 11 轮才被抓到（`tools.ts:1-9` 的新注释自己写着 “true for eleven rounds and then quietly stopped being true”）。**未验证的那一半标 尚未实现**：一条断言这份文本点名三个工具的测试。**真宿主证据只覆盖“worker 在这份提示词下起来并报告过”**（C213），不覆盖“提示词对工具面的陈述与代码一致”——后者是一个读代码就能判的命题，而它此前错了 11 轮没人读 |
| C215 | `orchestrator.md`：什么时候开 Ticket、附件怎么传、怎么回答、"绝不编造一个 Ticket 的状态" | **真宿主验证** | `01` §8 行「操作者动词」：主 Session 侧的 create/list/status/answer/note/stop/retry 全部命中过；`02` §3 复核了同一组。文中点名的四个工具（`myagent_create_ticket` `:11`、`myagent_answer_ticket` `:44`、`myagent_list_tickets`/`myagent_ticket_status` `:46`）都在 `mainTools` 里（C126） |

### 6.4 `examples/` 的能力

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C216 | `daily-digest.json`：一份真 schema 接受的完整设置文档，端到端跑通 | **真宿主验证** | `00` §1 行「出厂配方（实质）」：daily-digest 在线上宿主端到端跑通（11:58–12:13）。`02b` §4.5【残件 `cron-ticket.json`】给了第二个线上样本：`accept-cron`（daily 23:45 Asia/Shanghai）在挂载时补触发、造出 Ticket `7d81aadc33c8e67ec5a9fb2d12f3808f` 并跑到 `done`（`ended.at = 2026-11-03T18:40:57.103Z`），worker 报 `files:["cron-result.txt"]`、`artifacts` 恰好一条。离线：`tests/recipes.spec.ts` 的 `is a settings document the real schema accepts`、`fires within the next day, and not never`、`ships in observe mode, so the first day records rather than runs`、`tells the worker what done looks like, and what to do when it is not`、`appears in the schedule list with a next run the panel can show` |
| C217 | `data-report.md`：一个请求文件，标题与 scope 来自它的 front matter | **真宿主验证** | `00` §1 行「出厂配方（实质）」：data-report 在线上跑到 `dropped`。`01` §2 用它做了附件全链路的正例（两个同名文件）。离线：`tests/recipes.spec.ts` 的 `becomes a Ticket whose title and scope come from its front matter`、`is refused rather than run while the deployment is still in observe`、`asks for a decision in the shape the system can act on` |
| C218 | 两份配方被真 schema 与真门禁**持续**校验（配方失效时测试会红） | **离线验证** | `tests/recipes.spec.ts` **9 条** + `tests/recipes-route.spec.ts` **4 条**（`offers the shipped request file as something a person can start from`、`offers the shipped settings file as a schedule the panel can prefill`、`lists them in a stable order, so the picker does not move between refreshes`、`is behind the same fence as every other route`）。`00` §2 S20 记了这条闸门挣回成本的一次：`examples/README.md` 曾被当成请求配方发给面板 |
| C219 | `examples/README.md` 的准确性 | **部分实现** | **正确的一半**：两份配方的用法、`acceptMode` 出厂是 `observe`、成品目录为什么是共享的、写配方的三条规矩 —— 都与代码一致。**过期的一半（文档漂移，本轮复核仍未修）**：§2 逐字写着 “开头的 `---` 块是 front matter，**只认两个字段**”，表格只列 `title` 与 `scope`，而 `src/sources/inbox.ts:52-59` 读的是**三个**（还有 `attach`/`attachments`）；且 `:41` 只提了 `accepted/` 与 `rejected/`，**没提 `observed/`**。`00` §7 的「待修」清单里两条都记着，**跨了 15 轮未修**。**本文补一条新的**：这份 README 也**完全没提聊天来源**——`examples/` 里没有一份 chat 的配方，而 `sources.chat` 的 `channels[].directory` 是**必填**的（C225），所以一个想试聊天来源的操作者**没有可抄的起点**，而“烂掉的配方比没有更坏”这句话的反面是“**没有配方意味着只能读 schema**” |

---

## 7. `tests/` —— **33 个 spec 文件 + 2 个 helper，14188 行，760 条测试**

| 文件 | 行数 | 条数（闸门） | 它验的是 |
| --- | --- | --- | --- |
| `tests/helpers/host.ts` | 509 | — | 替身宿主：记录系统做的**每一个**调用，所以一条测试能断言的不仅是发生了什么、还有**什么没被碰**。第 41 轮加了故障注入的旋钮 `StubOptions.notify = {fails, error?}`（`:270`）与它自己的凭证 `host.refusals`（`:184`）；第 23 轮加的 `delayMs` 仍在。上一版记 429 行 |
| `tests/helpers/deployment.ts` | 38 | — | 一整个跑在替身宿主上的部署（真文件系统状态目录 + 真 SQLite + 真锁），flow/http/panel/executor/chat-send/fault-injection 都从它起步 |
| `tests/panel.spec.ts` | 3340 | **186** | 面板（`// @vitest-environment jsdom`，唯一在 jsdom 里跑的文件）；30 个 `describe`，含第 37 轮的聊天卡与第 45–46 轮的「丢失的请求」。**第 186 条是本轮 02:04 加的**：钉住 `.hidden { display: none !important }`（`panel/index.html:85`），而它此前只由类样式表达——**一条只有人看着页面才能发现的规则**（`:83` 的注释逐字写着 “Found only by a person looking at the page”） |
| `tests/engine.spec.ts` | 965 | **72** | 领域：intake、门禁、报告、人的动词、策略变更、重试、产物登记、Project/Work、事件日志、级联、协作通道、产物引用授权、`notice_lost`、`lost` 处置 |
| `tests/sources.spec.ts` | 910 | **42** | 四个来源 + 注册表：front matter、扫描与归档、cron 槽位与游标、按来源 pause/deny、rule、重叠 sync、inbox 权限。**第 44 轮修掉了其中三处 flaky**（`:273`、`:296`、`:312`） |
| `tests/http.spec.ts` | 857 | **45** | 围栏、面板读的、面板写的、活 Ticket 上的命令、排期编辑器、intake 计数、产物、报告无处可去、Project/Work/依赖、事件日志、`policyVersion` 出口、**chat 在 `state` 上的四个事实**、**回复计数**、**`GET lost` 一组 7 条** |
| `tests/executor.spec.ts` | 679 | **26** | 执行器：工作槽、暂停、被取代的 launch、prepare 命令、耗尽、附件、deny 不推迟已受理工作、分层上下文、在飞的救援、产物读取、Input 署名、**改 `everyMs` 在保存那一刻生效**、**S38 之后健康板上没有 executor 条目** |
| `tests/flow.spec.ts` | 585 | **23** | 端到端：inbox → 完成的 Ticket、blocked → 前台 → 回到同一个 worker、observe、prepare、停止、Session 身份、监听器不得拖垮宿主、恢复、profile 不认识若干工具、token 计数 |
| `tests/fault-injection.spec.ts` | 524 | **10** | **第 41 轮起的新套件**：真跑队列把 `notify` 与 `trigger` 一路失败到彻底放弃，然后断言留下的痕迹（`notice_lost`、`lost` 行、有界 kv 载荷、写丢失记录失败时不带走这一轮 pass），外加 `launch` 放弃后的样子 |
| `tests/chat-send.spec.ts` | 519 | **12** | **第 36 轮 C2**：发送路径——出门的回复、不出门的回复、彻底放弃时的两处痕迹、无 `replyTo` 的可观测空操作、从没配过 chat 的部署、两个错误码分开 |
| `tests/chat.spec.ts` | 451 | **14** | **第 36 轮 C1**：聊天 Source 本体——身份映射、未映射留住、纯函数 Trigger id、`deliver` 幂等、频道目录权限、扫描窗口与开关（含 `:235` 一处 `it.each` 两个旋钮） |
| `tests/store.spec.ts` | 450 | **27** | 存储：领域记录往返、效果行、事务、设置与 kv、更新/更旧/版本 2 三种状态目录、**有界的 `pushLostPayload`/`lostPayloads`** |
| `tests/chat-contract.spec.ts` | 422 | **28** | **第 35 轮 A+B**：P8 的契约层——第五个 kind 对每个调用点可见、身份映射即授权、旧设置文档照常解析、`ReplyTo` 活过受理、`Delivery.send` 是端口的一部分而不是对每个实现的要求（含 `:413` 一处 `it.each` 五个 kind） |
| `tests/policy.spec.ts` | 362 | **34** | 策略：排期 schema、设置文档、门禁、策略版本、设置变更的影响、时区、按来源策略、deny 与 allowSystemActors、第四种来源对每个调用点可见 |
| `tests/tools.spec.ts` | 356 | **22** | 工具：注册形状、从 Session 开 Ticket、读状态、跟运行中的 Ticket 说话、worker 的报告、报告工具回答什么 |
| `tests/notify-machine.spec.ts` | 338 | **16** | 桌面通知的机器侧（**跑真子进程，仅 POSIX**） |
| `tests/effects.spec.ts` | 269 | **16** | 效果队列：退避、一个效果一个结局、队列本身、**抛出**的 `Later`、**一轮安静的 pass 会清掉上一轮的抱怨而一个仍在排队的失败不会** |
| `tests/files.spec.ts` | 219 | **15** | 目录列举、可服务的路径、面板的文件路由、进度路由 |
| `tests/notify.spec.ts` | 187 | **9** | 一张完成的 Ticket 留下的记录、政策变更、机器通知、面板的结果区 |
| `tests/recipes.spec.ts` | 168 | **9** | 两份出厂配方（真 schema + 真门禁） |
| `tests/views.spec.ts` | 168 | **13** | 四个视图函数 |
| `tests/attachments.spec.ts` | 162 | **11** | 附件归一化、front matter 的 `attach:`、Ticket 携带它的文件、驱动它的那个工具 |
| `tests/agent-delivery.spec.ts` | 160 | **12** | 幂等投递 |
| `tests/recovery.spec.ts` | 210 | **7** | 重启：接管一个 worker 已死的 Assignment、重放排队未启动的 launch、不复活已结束的、拒绝第二个部署、前台跨重启 |
| `tests/watchdog.spec.ts` | 217 | **11** | Watchdog：卡在启动、静默的 worker、设置变更后的上膛、**升级作为一条持久记录到达宿主（两条路径各一条）** |
| `tests/transaction.spec.ts` | 175 | **14** | 事务契约：**同一组 7 条断言对 `Store` 与 `Memory` 各跑一遍**（`:62` 的 `for` 循环） |
| `tests/background.spec.ts` | 143 | **16** | `until`、杀作业、收子代理、两者都收 |
| `tests/deployment.spec.ts` | 131 | **10** | 配置解析与目录创建 |
| `tests/timing.spec.ts` | 130 | **22** | `parseTime`/`parseCron`/`nextRun`/时区助手/`describeTiming` |
| `tests/dependencies.spec.ts` | 116 | **5** | 依赖（部署级：真 Executor + 效果队列 + 泵） |
| `tests/delivery.spec.ts` | 115 | **10** | 告诉人的措辞 + 状态锁 |
| `tests/mount.spec.ts` | 117 | **7** | 挂载与 `apply` |
| `tests/prompts.spec.ts` | 79 | **8** | 出厂文件的定位 + 覆写与修订 |
| `tests/recipes-route.spec.ts` | 62 | **4** | `GET /api/recipes` |
| `tests/build.spec.ts` | 55 | **4** | 发布产物就是这份源码构建的（**3 条是 `it.skipIf(!existsSync(bundle))`，第 1 条无条件**） |

**760 = 748 个写下来的 `it(` / `it.each(` + 12 条被复制或被展开的**：`tests/transaction.spec.ts:62` 的 `for (const implementation of implementations)` 把 7 条断言对 `Memory` 与 `Store` 各跑一遍（+7）；`tests/chat-contract.spec.ts:413` 的 `it.each` 展开成 5 条（+4）；`tests/chat.spec.ts:235` 的 `it.each` 展开成 2 条（+1）。逐文件的条数与 `/tmp/myagent-gate.log` 的 `✓ tests/<file> (N tests)` 行**逐个相符**，对账全过程见 `docs/v2/11-test-report.md` §3。

**上一版这一节的标题是“31 个文件，10728 行，631 条测试”。** 差的是 4 个新文件（`chat-contract`、`chat`、`chat-send`、`fault-injection`）、3460 行、129 条测试。

**这一节里有两个数，因为它们在本轮期间都动过一次**：`759`（00:43:54 那次**完整**四步闸门）与 **`760`**（02:40:09 那次**完整**四步闸门）。中间还有一次 02:21:51 的 `--quick` 运行也报了 760，而 `--quick` **跳过 build 与两项产物核对**（`scripts/gate.sh:42-44,50-71`）——本文取 **760 / 02:40:09 那次**为权威，因为它是四步全过的最后一次，而它比本文第一次测量晚，多出的那一条是 `tests/panel.spec.ts` 的 CSS 断言。**产物哈希在这三次之间逐字未变**（`768a6adb1cfc136c…`），所以 `src/` 没有动过——**变的是面板与它的测试，两者都不进 bundle**。

### 7.1 关于测试保真度的一条限定（必须与上面每一行一起读）

`docs/v2/00-audit-and-plan.md` §6 用两页记录了替身宿主的三类问题。本文不重复它，只把它对**本文标签**的影响说清：

| # | 能力 | 状态 | 证据 |
| --- | --- | --- | --- |
| C220 | "759 条全绿"意味着"真宿主会过"（上一版这条写的是 631，本轮随套件一起更新） | **部分实现** | **成立的一半**：`00` §6 列了替身**忠实**的地方（`create` 可能返回不同 id、`resolveAgent` 的 `{agent}`/`{error}` 二选一、`exitCode: null` 表示被信号杀死、body 是单块 Buffer 的异步迭代器、同源围栏可测、**真实文件系统的状态目录与锁**——"这是全套里最强的部分"）。**不成立的一半（仅有设计，即只有记录、没有修）**：`00` §6 点名的那些，其中三条直接削弱本文的标签 —— (a) `SessionEvent` **没有 `time`**（真类型是必填），所以 `lastEventAt` 在任何测试里都是 undefined，**没有 `time` 就无法测任何"多久没事件"的停滞探测**（这直接影响 C98/C150；本轮复核 `grep -n "SessionEvent\|time:" tests/helpers/host.ts` → 0 命中，**仍在**）；(b) `tools.get()` 永远返回 `{}`（`tests/helpers/host.ts:160`），所以 `WORKER_TOOLS` 的预过滤在**每个测试里都是死代码**（影响 C106；本轮复核**仍在**）；(c) `res` 没有 `write()`、`status` 从 0 开始，所以**无法构建或测试任何流式/SSE 路由**，且 `webServer.port` 硬编码 3080 而真类型是 `number\|undefined`（影响 C130 的 HTTPS 分支）。**第 41 轮新加的那条边界也属于这一半**：桩**无法让 `trigger` 处理器因 I/O 失败**（`receive` 在 core 里不做任何宿主 I/O；而让 SQLite 失败会同时弄坏 `failEffect`/`settleEffect`，量到的是队列而不是 trigger），所以 `lost` 那半只能用"载荷"这个通道测（`00:2419-2437`、`docs/v2/17-fault-injection.md` §3.0）。完整的桩保真度清单见 `docs/v2/11-test-report.md` §6，那里逐条标了本轮复核结果 |
| C221 | `tests/tools.spec.ts` 的"同一请求来两次只开一张 Ticket"在生产里成立 | **部分实现** | `00` §6 称之为"**最反直觉的一条**"：它**只因为 harness 把时钟钉成了常量**（`tests/tools.spec.ts:61` 的 `now: () => '2026-11-03T02:00:00.000Z'`，本轮复核行号未变）。生产里 Trigger id 含 `at = now()`，所以相隔一毫秒的两次调用是**两张 Ticket、两个目录、两个 worker**；`POST /api/tickets`（`src/app/http.ts:360`，本轮行号）同样没有幂等键，**面板双击就是两张 Ticket**。**P8 之后这条多了一个正面对照**：chat 的 Trigger id **刻意不含时间**（`key('chat', channelId, messageId)`，C247），而它在真宿主上被量到"再等 43 个周期无第二份归档"（`docs/v2/16-…` 场景 2）——**同一个系统里两种 id 哲学并存，一种被量过幂等，另一种被量过不幂等** |

---

## 8. 计数、标签变动登记，与三个最难下的标签

### 8.1 计数

本文一共标了 **250 项能力**（上一版 221 项），每项恰好一个状态。
**新增的 29 项是 C222–C250**，全部来自第 31–46 轮；**C01–C221 的编号一律未动**，
因为 `docs/v2/12-unimplemented.md` 与其他交付物按编号引用它们。

| 状态 | 数量 | 占比 | 上一版 |
| --- | --- | --- | --- |
| **真宿主验证** | **97** | 38.8% | 84（38.0%） |
| **离线验证** | **95** | 38.0% | 83（37.6%） |
| **部分实现**（含 **4** 项标注为「未接入」） | **39** | 15.6% | 34（15.4%） |
| **尚未实现** | **13** | 5.2% | 13（5.9%） |
| **仅有设计** | **6** | 2.4% | 7（3.2%） |
| 合计 | **250** | 100% | 221 |

按层的分布（每格是"真宿主 / 离线 / 部分 / 仅设计 / 尚未"；本轮由脚本逐行读出状态格后汇总，**行内合计与小计逐个相符**）：

| 层 | 真宿主 | 离线 | 部分 | 仅设计 | 尚未 | 小计 |
| --- | --- | --- | --- | --- | --- | --- |
| §2 `src/core/`（C01–C53、C222–C230） | 24 | 26 | 7 | 3 | 2 | **62** |
| §3 `src/app/`（C54–C156、C231–C239） | 47 | 41 | 20 | 1 | 3 | **112** |
| §4 `src/sources/`（C157–C189、C240–C247） | 17 | 15 | 3 | 2 | 4 | **41** |
| §5 入口与配置（C190–C194、C248） | 2 | 1 | 3 | 0 | 0 | **6** |
| §6 panel/scripts/prompts/examples（C195–C219、C249–C250） | 7 | 12 | 4 | 0 | 4 | **27** |
| §7 测试保真度（C220–C221） | 0 | 0 | 2 | 0 | 0 | **2** |
| 合计 | **97** | **95** | **39** | **6** | **13** | **250** |

> **上一版这张表算不平，本文更正它。** 上一版的小计列是 53/103/33/5/25/2 = 221（对），
> 而各行五格相加是 43/103/35/5/35/2 = **223**（不等于 221，也不等于每一层的小计）：
> §2 少 10、§4 多 2、§6 多 10。**总数 221 与顶部那张分布表（84+83+34+13+7=221）是自洽的，
> 错的是这张分层表的格子。** 本文这一版是脚本从每一行的状态格直接汇总出来的，两处合计互相对得上。

**从这张表能读出的一件事**（与上一版同一条，本轮仍然成立、而且更清楚）：
§6 那 27 项里只有 7 项拿到真宿主证据，其中大部分是 `scripts/` 与 `examples/`（它们**本来就是**在真宿主上跑的东西）；
**面板的 13 项里一条真宿主证据都没有**（全是 jsdom，C196）。
第 37 轮的聊天卡与第 45–46 轮的「丢失的请求」区块一共加了 39 条断言，**没有一条离开 jsdom**。

**本轮 §0.3 那次重载给这一层添了一条新的、只读的线上观测**：3080 送出的面板与磁盘**逐字节相同**（`2fdbfcad0f440318…`，128775 字节），
而 `GET /api/lost` 返回 **200**、`state.chat` 存在——即**面板与 API 现在版本一致了**。但**“一致”只是这一节所有断言的前提，不是其中任何一条的证明**：
渲染、层叠、滚动位置、下载、剪贴板仍然只有 jsdom 证据，而**本文 00:5x 还量到过它们不一致的那个状态**（§0.3 第 4 条）。

`部分实现` 的 39 项里，本文给每一行都写明了是哪一半、以及未验证那一半自己的状态。按未验证那一半的状态分：

| 未验证/未建的那一半是什么 | 条数 | 例子 |
| --- | --- | --- |
| 离线验证（缺陷在真宿主上被观测到过，修复只有测试、从未复验） | **8** | C100（N2 第二次修复）、C74（N5）、C180（N7）、C229（`notice_lost`）、C231（S38）、C235/C236（健康板"此刻"语义） |
| 尚未实现 | **9** | C136（Project/Work 无 PUT/DELETE）、C204（面板不渲染 usage）、C154（等人的 Ticket 的提醒）、C209（verify-live 第 4 步）、C214 的"一条钉住提示词文本的测试" |
| 离线验证（有调用者、有测试，但从未被真宿主驱动过） | **8** | C107（19 vs 20 个工具名的差额）、C118（flush 顺序）、C167 的当前构建那半、C228（放弃路径）、C96 的 `windowed:true` 那半 |
| **未接入**（代码完整、`src/` 内零调用者；§4.25 的裁定要求写明接入它需要什么） | **4** | C42（`failTicket`）、C43（`trigger`/`dispositionOf`/`artifactsOf`）、C135（`GET triggers` 无页面）、C248（`kind.ts` 的导出无第三方消费者） |
| 未核实（连离线证据都没有，需要一次真宿主观测才能定） | **5** | C65（marker 内容无测试）、C88（6 个环境变量逐个）、C102（`watchdog.settingsChanged` 那一步）、C194（撞名路径）、C206（本轮没有直接观测退出码） |
| 文档漂移（陈述被代码否证） | **1** | C219（`examples/README.md` "只认两个字段"）—— 上一版这一格有 3 条，另两条（C125、C214）已在第 30 轮修掉 |
| 另有 1 项的两半是"设计 vs 实现"而不是"验证 vs 未验证" | **1** | C53（`Memory` 与 `Store` 的排序分歧） |
| 其余 3 项的两半是"实现 vs 实现"（都做了，分的是别的轴） | **3** | C44（`dismiss` 不幂等）、C156（`promptMaxChars` 不被强制）、C232（`mountedAt` 有字段、无变异检验） |

### 8.2 标签变动登记：本轮改了哪些、往哪个方向改

**这一节是新增的**，因为"不许为了让项目看起来更远而升级标签"这条规则只有在变动可查时才是可核查的。
本轮对 **C01–C221** 改了 **9 个标签**（4 升、3 降、2 换名而状态不变），另新增 29 项。

**升（4 项，每一项都有 `docs/v2/14-…` 或 `docs/v2/16-…` 的【实测】作依据）**：

| # | 旧 → 新 | 依据 |
| --- | --- | --- |
| **C79** | 离线验证 → **真宿主验证** | `14` 场景 1【实测】：`sleep 90` 活着的 **22/22** 个采样点 `used=1`、违规 0（N3） |
| **C95** | 离线验证 → **真宿主验证** | `16` 场景 1【实测】：`GET /api/tickets/<id>/progress` 返回 `usage:{inputTokens:9224,…,totalTokens:37755,windowed:false}`，残件 `progress-01.json` |
| **C149** | 离线验证 → **真宿主验证** | `14` 场景 3(b)【实测】：健康在 `04:34:25.830Z` 转 not ok，detail 逐字 `Ticket a688c9df has not started after 2 attempts to rescue it; it needs a person`。**这条曾经是"线上不可达"**（`02b` §6.1），第 23 轮修好之后重新可达，第 33 轮真的走到了 |
| **C189** | 仅有设计 → **真宿主验证** | `Delivery.send?` 已在第 35 轮落进端口（`src/core/engine.ts:158-177`），实现者在 `16` 场景 1【实测】把回复送到了 `room-a/out/`。**D11 从"P8 的前置、只有设计"变成"已实现并线上得证"** |

**降（3 项）**：

| # | 旧 → 新 | 理由 |
| --- | --- | --- |
| **C100** | 离线验证 → **部分实现** | 第 23 轮的修复被第 33 轮**真宿主证伪**（检测延迟 34.729s；`rescued#1` 命中 `mountedAt+7×60s` 网格、残差 23ms）。第 33 轮的第二次修复只有离线证据（`tests/executor.spec.ts:623`）。**一个曾被证伪、其后修复未复验的能力，不该顶着"离线验证"这个听起来完结了的标签** |
| **C96** | 真宿主验证 → **部分实现** | 线上只观测到 `windowed:false`；`true` 那一面（长任务被正确标成窗口）从未被观测，要造它需要一次超过 400 条事件的 worker 运行 |
| **C42** | 离线验证 → **部分实现（未接入）** | 按 `00` §4.25 的裁定：`failTicket` 零生产调用者，标"离线验证"正是那条裁定要防的升级 |

**换名而状态不变（2 项）**：C43、C135 由 `部分实现` 改标 `部分实现（未接入）`，并按裁定补写了"接入它需要什么"。

**内容有实质变化、标签未动的（挑最要紧的几条）**：

- **C84 / C148**（Watchdog 的救援）：第 33 轮把"修复只有离线证据"推进成"修复线上得证"，
  但**同时确认了另一件事**——重新入队的行**会被在飞的那次吸收**（全程只有一个 `sleep 90` 进程）。
  所以"救援真的重新启动了一个 worker"这一面**仍未被驱动过**，两条都留在 部分实现。
- **C05**（事件类型）：从"17 种里 14 种有写入点"变成"20 种里 17 种有写入点"，**第 50 轮再变成"21 种里 18 种"**（新增 `resumed`）；
  本轮核对还发现上一版那个 14 **当时就少算了一种**（`rule_stopped` 在第 24 轮就有写入点）。
- **C12**（错误码表）：从"20 个码 / 19 个有抛出点"变成"**19 个码 / 18 个有抛出点**"；
  `dismiss` 用错码那一处**已修**（`decision_missing`），`input_missing` **仍零抛出点**。
- **C73 / C74**（健康板）：`effects` 与 `delivery` 两个条目**现在会自己清**（第 43 轮），
  而 `executor` 那个条目**健康时根本不存在**（第 39 轮）——健康面的形状变了。
- **C125 / C214**：上一版记的两处文档漂移（"一个工具"、"the only way"）**已在第 30 轮修掉**，
  两条的理由因此从"实现 vs 陈述"换成"验证等级"与"没有东西防止再次漂移"。
- **C134**（`stateView`）：字段清单多了 `mountedAt`、`chat`、`counts.sends`、`counts.lost`。
- **§3.10 的路由表**：34 条 → **35 条**（19 GET / 14 POST / 2 PUT / 0 DELETE）。

### 8.3 三个最难下的标签，以及为什么

**（1）C148 / C84 —— Watchdog 的救援"真的重新启动了 worker"。标 部分实现。**
难在**四份**证据指向三个方向，而它们都是真的：
`02` §7 的原稿说"通过"；`02` 顶部更正块第 1、2 条说这个标题**是错的**、应为"探测得证，救援被证伪"；
`02b` §5 N1 给出了证伪的证据链；`00` §4.18 说 N1 已在第 23 轮修好并有回归测试；
而 `docs/v2/14-…` 场景 3 说**修好这件事本身也【实测】得证了**（2 条 `rescued`、升级可达、`used` 仍是 1）。
**但同一份验收报告还量到了一件让"救援重启了 worker"这个说法继续不成立的事**：
`00:1786` 逐字记着"全程**只有一个** sleep 进程，尽管两次救援都重新入队了——**证实了重新入队会被在飞的那次吸收**"。
所以这一项同时拥有"真宿主证伪"、"离线修复"、"真宿主确认修复达到了它的目的"、
以及"真宿主确认它没有做到字面上那件事"四份证据，**没有任何一份能单独决定标签**。
本文的处理是：把"探测"（C147，真宿主验证）、"升级可达"（C149，真宿主验证）、
"救援的机制"（C84，部分实现）与"救援重启了一个 worker"（C148，部分实现）**拆成四行**。
如果只写一行、标"真宿主验证"，就会盖住 N1；只标"离线验证"，就会丢掉第 33 轮那次得证。

**（2）C100 —— 改 `watchdog.everyMs` 不重启即生效。标 部分实现，而它是本轮唯一一个被**降**级的。**
难在这一项的两次修复各自都有"通过"的证据，而它们互相矛盾：
第 23 轮那条离线测试**真的通过了**（`tests/watchdog.spec.ts:142`，今天仍在、仍然直接调 `settingsChanged()`），
第 33 轮的真宿主验收**证伪了它**（检测延迟 34.729s）。
矛盾的解在 `00:1806-1809`，本文原样引：**"那条离线测试测的是'调用 `settingsChanged()` 会重新上膛'，
不是'改设置会调用 `settingsChanged()`'。我测了自己写的那个方法，没测它与真实调用路径的接线。
假定时器让 `refresh()` 是否会被调用这件事完全不可见。"**
第二次修复补的正是接线（`src/app/runtime.ts:578` 直调 + `tests/executor.spec.ts:623` 走真接线 + 变异检验）。
**标签跟着"这个能力现在有没有被证明"走，而不跟着"有没有代码"走**：代码在、接线在、离线测试在，
而它要修的那个缺陷**只有真宿主才看得见**，所以第二次修复**从未被复验**这件事必须体现在标签上。
反过来标（沿用"离线验证"）会把一个曾被线上证伪的修复说成已经完结——那是另一种不诚实。

**（3）C43 —— `Engine.artifactsOf` / `dispositionOf` / `trigger` 三个零调用者、零测试的读方法。标 部分实现（未接入）。**
上一版把这一条列为"五态词表的一个缺口"，并建议给这一格一个名字。
**那个建议已被采纳**（`00` §4.25，第 31 轮）：不加第六个状态，标 **部分实现** 并把缺失的那一半命名为 **未接入**，
而且**必须写明接入它需要什么**。本文照做，逐条写了接入点（C43）：
`artifactsOf` 的接入点是 `Runtime.artifacts()`（`src/app/runtime.ts:619`，它现在直接查 Store）；
`trigger()` 的接入点是 `src/app/http.ts:357`（为了取 `replyTo` 直接查 Store）；
`dispositionOf()` **没有现成的接入点**。
**第 35 轮给这条裁定补了一个客观判据**：一个新模块落地后**产物哈希不变** ⇒ 它没进 bundle ⇒ 未接入
（C1 落地时 `chat.ts` 零生产导入者，哈希与基线逐字相同；C2 接线后哈希与体积一起动，+22224 字节）。
**这条裁定现在被用在 4 项上**（C42、C43、C135、C248），而上一版只用在一个三合一的条目上。

---

## 9. 本文核对出的、与既有文档或代码注释不一致的地方（**仍然开着的**）

按操作者的要求：**这些只记录，不在本文里改**（本文只写这一个文件）。
**上一版列了 17 条，其中 10 条已在第 30–31 轮与第 43–46 轮关掉**——它们**没有被删掉**，
而是连同"当时是对的、什么时候关的"一起搬进了 **附录 A**。本节只留仍然开着的 7 条与本文新查出的 6 条。

| | 既有文档/注释怎么说 | 本文核对到什么 | 影响 |
| --- | --- | --- | --- |
| **11** | `00` §4.9："`failTicket` 现在没有生产调用者 …… 这不是遗漏而是分阶段：它的生产调用者是 **P4 的 Watchdog**（超时、Session 消失、预算耗尽都需要'由系统结束一张 Ticket'）" | **那个预测没有成真，而且现在离得更远了。** Watchdog 在第 15/16 轮落地用的是 `rescueStuckLaunch` 与 `assignmentInterrupted`；第 34 轮给它加了**第三个**动作 `escalate`（C227），**仍然不是** `failTicket`。它至今零生产调用者（`grep -rlE "engine\.failTicket\(" src/` → 0），只有 `tests/engine.spec.ts` 的 4 处。`00` §4.27 自己也已经把"给'已实现但零调用者'收尾"列为候选，并写明"**它预定的调用者已经过去 14 轮没有用它**" | "分阶段施工，不是死代码"这个解释在**20 轮**之后需要重新评估：预定的那个阶段过去了，而那个阶段又长出了三个新动作，没有一个用它 |
| **12** | `00` §5 的正文仍写着"线上库现状（只读实测）：`schema_version=1`（恰好 1 行）" | **仍是 version 5。** 而 `00` §4.26 声称"文档里三处不实陈述已更正：两处「线上库仍是 version 1、未被触碰」"——本文本轮逐字读过 §5，**那一处没有被更正，也没有更正指针**。`00` §4.26 自己接着写了一句规律：**"「我已更正」本身也是一个需要核实的断言，而且它比代码更容易被当成已完成"** | 这条是**文档对自身更正记录的否证**，比它更正的那条更要紧。另：§5 记的 `triggers 10` 本轮实测是 **11**、`tickets 8` 是 **9**（`ended`），即那份"只读实测"是一个时点快照，引用时要带时间 |
| **14** | `01` §8 行「worker 工具白名单」：worker 与 subagent 日志都是 **19 个**工具 | `src/app/sessions.ts:34-38` 的 `WORKER_TOOLS` 本轮重数仍是 **20 个**名字 | 差额最可能是 `pwsh`（macOS 上没有，`restrict` 会把它滤掉，见 C106/C110），但 `01` 没有逐个列出它数到的 19 个，所以**未核实**（见 C107）。核实它需要读一次 `01` 引用的那份 worker 日志，或在真宿主上重新数一遍 |
| **15** | `00` §6："`tests/panel.spec.ts` 用假定时器"、"6 个文件用真 `setTimeout`"、"472 处断言"、"470 个测试全绿" | 第一条仍成立（本轮复核 `useFakeTimers` 在 `panel`、`sources`、`watchdog` 三个文件里）。**第二条已过期**：本轮数到 **7 个** spec 文件用真 `setTimeout`（`background`、`chat`、`dependencies`、`effects`、`http`、`panel`、`sources`）。后两个数字对应更早的轮次 | 引用 `00` §6 的具体数字时要带上它是哪一轮的；本文的权威计数是 `/tmp/myagent-gate.log` 的 **759 passed / 33 files** |
| **16** | 三处**孤儿文档注释**（一个注释紧跟着另一个注释，前一个描述的东西已经不在了） | **三处全部仍在**，行号已漂移：`src/sources/inbox.ts:70`（"A name that does not collide in `folder`…"，而下面的 `uniqueName` 早已改成用身份而不是避让冲突）、`src/app/runtime.ts:617-618`（"When each Source last fired…"，而下面插进来的是 `artifacts()`，`sourceStatus()` 在 `:621`）、`tests/helpers/deployment.ts:19-26`（两段 `@param` 连着，中间没有函数） | 都是小卫生问题，但**它们会误导下一个维护者**，与 N7 是同一类（`02b` §5 N7："注释错了比没有更坏"）。跨了 15 轮未修 |
| **18** | `src/core/policy.ts:445-446` 的注释："`inferred` strength does not occur in v1 — every Source is something the operator wrote — so there is no accept-mode rule to apply here. **It arrives with a chat Source, and this is where its rule goes.**"（`src/core/model.ts:79` 的注释同调："`inferred` waits for the assessment layer"） | **这条注释现在是错的，而且是第 35–36 轮亲手把它变错的。** 聊天来源已经落地，而 P8 的**第一条裁定**恰恰是**身份必须被映射、不能被推断**：`src/sources/chat.ts:30` 的小节标题逐字是 "## Identity is mapped, never inferred (contract §2 — the reason P8 exists)"，`00:1898-1902` 写的是"**判断权在设置，不在代码**"。`gate()` 的三条返回全部写 `strength: 'explicit'`（`policy.ts:385,403,404`），**没有任何代码路径能产生 `inferred`** | 这是 **N7 那一族的第五次出现**（"注释错了比没有更坏"），而且比前四次更危险：它**指向一个已经被明确否决的设计**。下一个人读它会以为"`inferred` 是聊天来源该有的、只是还没写"，而正确的读法是"聊天来源**决定不要它**"。C04 与 C25 都因此停在 仅有设计 |
| **19** | `src/core/errors.ts` 上一版记"20 个码里 19 个有抛出点" | 本轮实测 **19 个码 / 18 个有抛出点**（`grep -cE "^  [a-z_]+: '" src/core/errors.ts` → 19）。而第 31 轮**加了** `decision_missing`（`00` §4.26），所以码数应当只增不减 | **少了哪两个未核实**：核实它需要读第 31 轮之前的 `errors.ts`，而本项目目录**不是 git 仓库**（`git log` → "不是 git 仓库"，`.git` 不存在），没有历史可查。**这是一处无法闭合的对账，本文按未核实记账，不猜** |
| **20** | 上一版本文自己写"`Engine` 有 38 个公开方法"、"(a) 有生产调用者的 33 个" | 本轮实测 **44 个公开方法**（排除 6 个 `private`），其中 **40 个有生产调用者**、4 个没有。而上一版**自己列出的** (a) 组是 36 个、(b)+(c) 是 4 个，合计 **40**——**它自己的清单与它自己的总数就对不上** | 本文的错，本文更正。它也说明"数出来的总数"与"列出来的清单"必须互相对账，否则两个都会漂 |
| **21** | 上一版本文自己写"`@deepseek-ai/*` …（对照：`src/app/` 有 9 个文件导入它）"、"（谁在用 Node 内置模块）：`src/app/` 12 个文件" | 本轮 `grep -rl`：**9 个文件导入 `@deepseek-ai`，其中 7 个在 `src/app/`**（另两个是 `src/deployment.ts` 与 `src/index.ts`）；**12 个文件导入 Node 内置模块，其中 8 个在 `src/app/`**（另四个是 `core/ids.ts`、`deployment.ts`、`sources/chat.ts`、`sources/inbox.ts`） | 两个数都把"全树"写成了"`src/app/`"。分层结论不受影响（core 里仍然只有 `ids.ts` 那一个纯计算的 `node:crypto`），但**对照面的数字错了就会让下一个人复算不出同一个结果** |
| **22** | `docs/v2/11-test-report.md` 上一版："`tests/build.spec.ts` 的四条是 `it.skipIf(!existsSync(bundle))`" | **只有三条是**（`:37`、`:45`、`:51`）；`:32` 的 `exists, because the host loads this file and nothing else` 是**无条件**的 | 后果是具体的：产物若不存在，闸门会报 **756** 而不是变红，**三条静默跳过**——而上一版说的"那时闸门报的会是 627"是基于"四条都跳过"算的 |
| **23** | 上一版本文 §0.2："闸门退出码 **未核实**。`scripts/gate.sh:82-87` 只把结论 echo 到 stdout、不进 `$log`" | **已被当前脚本否证**：`scripts/gate.sh:80` 与 `:84` 都是 `echo … \| tee -a "$log"`，而 `:84` 只在 `[ "${#failures[@]}" -eq 0 ]` 分支里执行、紧接着 `exit 0`。本轮日志末行就是 `结论：通过。产物 768a6adb1cfc136c…（320163 字节）` | 这条是**本文自己上一版的陈述被代码否证**，与 §12（已折进附录 A）那两条同类。它把"退出码不可核实"收窄成"退出码可以从日志推出、但本轮没有直接观测"（C206） |
| **24** | 上一版本文 §0.3 的整节前提："日常宿主的插件在 **05:33:53** 被热重载过 …… 即已加载的 bundle ≈ **第 24 轮**" | **本轮它过期了两次。** 00:5x 实测 `mountedAt` = `2026-11-04T04:21:30.904Z`（本地 12:21:30），bundle 被夹在 **[第 31 轮, 第 35 轮)**；**01:40:15 插件又被重载了一次**，02:4x 复测 `mountedAt` = `2026-11-04T17:40:15.610Z`、`GET /api/lost` **200**、`state.chat` 存在、`health.effects.detail` 是第 43 轮的 `QUIET` 串、健康板上没有 `executor`——**已加载的就是本轮被钉住的 `768a6adb1cfc136c…`**（推断，三条独立证据同指一个哈希；pid 仍是 24619，即宿主进程没换、插件被重挂载） | **这一条是本文写作期间事实自己变了的记录，不是文档错**。影响是双面的：一方面第 33–46 轮的能力现在在日常宿主上**可达**了（正文里 12 处"不可达"限定已相应改写）；另一方面**可达不等于被驱动**——§0.3 第 2 条把这一点写死，而它正是上一版对 `projects`/`works` 用过的同一条判据 |
| **25** | 上一版本文 §0.3 的表："日常库 **version 5**，11 张表齐全，**8 张 Ticket**"；`policyVersion: 275ea61ded276e15` | 本轮两次实测：`counts` = `open 0 / ended **9** / attention 0 / triggers **11** / decisions **11** / effects {} / workerSlots {used:0,max:2}`（02:4x 又多了 `sends {0,0}` 与 `lost {rows:0,payloads:0}` 两个键）；日常库 sha256 **`a793caacbbcb2e1d…`**、167936 字节、mtime `Nov  4 11:40:37`、`-wal` **0 字节**——**01:40:15 那次重载没有写它**，与 `docs/v2/16-…` §5 记录的"起点=终点"仍逐字相同。**而 `policyVersion` 变了**：`settingsRevision` 一直是 **7**（没有任何授权旋钮被碰过），`policyVersion` 却由 `275ea61ded276e15` 变成 **`3bb5598e3044fc96`** | 前半条**支持**既有文档（第 38–47 轮期间日常库一个字节都没被写过）。**后半条是本文新查出的一个事实**：`policyVersion` **会随构建移动而 `settingsRevision` 不会**——机制是 `authorizationShape` 在第 35 轮长了派生的 `enabled` 与 `identities` 两块（C226），所以**同一份存盘文档在新构建下必然哈希到另一个版本**。此刻没有可观测影响（`policyChanged` 只在一次设置保存时比较**同一构建下**的两份文档；`counts.open` 是 0）。**未核实的那一半**：一张在旧 bundle 下受理、仍活着的 Ticket，在下一次授权旋钮变更时会收到什么措辞的通知——核实它需要"重载前受理 + 重载后改旋钮"这个顺序，而本文只读、没有造这个场景。见 §0.3 末段与 §10.2 的新行 |
| **26** | `docs/v2/05-panel-v2-ui.md` §0/§3：`tests/panel.spec.ts` 是 **144 条**；§4/§5：`127.0.0.1:3080` 上跑的是旧 bundle，`projects`/`works`/`events`/`dependencies` 全部 404 | 本轮：`panel.spec.ts` 是 **186 条**（02:40:09 那次闸门；本文 00:5x 量到 185）；那四条路由在 3080 上返回 **200**（对空集合）。**§4/§5 那条判断的实质本文量到了两次，一次成立、一次结束**：00:5x 时 3080 送出的面板与磁盘逐字节相同（含 `#lost-count`、`#chat-waiting`、`丢失的请求`）而它的 API 对 `GET lost` 返回 **404**、`state` 里没有 `chat`/`counts.lost`/`counts.sends`——**"新页面 + 旧 API"当时就是线上状态**；01:40:15 重载之后两者版本一致了 | `05` 的计数已过时 42 条（本文的权威数字取自 `/tmp/myagent-gate.log`）。"新页面 + 旧 API"**曾经真实存在了至少 50 分钟**，而面板对它的处理（能力探测、`panel/index.html:1307-1308` 那句"这不代表「没有丢失的请求」，它代表「读不到」"）**只有 jsdom 证据**（C200）——即这个状态**在线上出现过、被页面正确处理过（据推断）、而那份正确处理从未被真浏览器验证过** |

**状态词表的那个缺口已经关掉了**：见 §0.1 规则 2 与 §8.3 第（3）条。
"已实现、零调用者、零测试"这一格由 `00` §4.25 的裁定接管（标 **部分实现**、缺失的一半命名 **未接入**、
并写明接入它需要什么），本文在 4 项上照做（C42、C43、C135、C248）。
**剩下一个更小的词表问题本文不擅自解决，只记下来**：一个能力的两半**都实现了**、
分的只是**验证等级**（一半真宿主、一半离线）时，五态里最贴的词仍然是 `部分实现`——
而 `部分实现` 的定义写的是"一部分存在且工作，另一部分不"。本文遇到 3 项（C125、C96、C214），
一律标 `部分实现` 并在证据格里明写"**分的是验证等级，不是实现**"，以免读者以为有代码缺失。


## 10. Part B（已缩减，仅列出本文已核实的条目）

完整的"未实现能力清单"是 `docs/v2/12-unimplemented.md`。这里只留本文在清点模块时**已经逐个核实过**的条目，
每条都带着本文核对到的代码位置，方便那份清单直接引用而不必重查。
状态标签与 Part A 一致；**这一节不是完整清单**，`00` §4.7–§4.46 的每一个「未做」段落、`05` §5、
`06` §6、`03` §6 与 P0–P9 的逐项对照都**不在**这里。

### 10.1 P8：扩展接口 + 聊天 Source 参考实现 —— **已落地，并在第 38 轮真宿主验收通过**

**上一版这一节的标题是"完全没有动过"，本轮整节重写。** 那句话在当时是对的，而且当时写得很直白：
`src/sources/` 下只有四个来源加两个协议文件、`SourceKindName` 是四成员闭合联合、
`Delivery` 端口没有 `send`、"一个平台身份必须映射到一个真实 Actor"这件事连一行代码都没有。
**这四条现在逐条都不成立了**：

| 上一版的陈述 | 本轮核对到的现状 | 能力条目 |
| --- | --- | --- |
| `SourceKindName` 仍是 `'cron' \| 'inbox' \| 'session' \| 'rule'` 四成员闭合联合，没有 `chat` | **五个成员**，含 `'chat'`（`src/core/model.ts:4`）；`MandateVia` 同步加了 `'chat'`（`:184`），因为 `viaOf` 是一个全函数 `Record<Trigger['kind'], MandateVia>`，不加就 typecheck 不过 | C188 |
| `Delivery` 端口只有 `report` 与 `policyChanged?`，**没有 `send`** | 多了 **`send?`**（`src/core/engine.ts:158-177`）。可选，端口注释写了为什么："a deployment whose Sources are all one-way (cron, inbox) has nowhere to send to, and demanding the method there would be answered with empty ones — **an empty method is the appearance of a capability without the capability**" | C189、C237 |
| `Actor.kind` 只有 `'person' \| 'system'`，且**没有任何代码路径能产生一个聊天身份** | `kind` 仍只有两个成员——**这是对的**：`kind` 不由 Source 推断，映射表就是操作者的断言（`00:1898-1902`）。**但现在有了产生 `person` 身份的真实路径**：`sources.chat.identities` | C225、C242 |
| "一个平台身份必须映射到一个真实 Actor"连一行代码都没有 | `src/sources/chat.ts` **469 行**，`:30` 的小节标题逐字是 "## Identity is mapped, never inferred (contract §2 — the reason P8 exists)" | C240–C247 |

**落地的顺序与分工**（`00` §4.31–§4.37，按第 2 档纪律先出契约再分工）：
第 35 轮先写 `docs/v2/15-p8-contract.md`，然后 **A+B**（core：类型、`Delivery` 端口、设置块、`authorizationShape`，
边界是 `src/core/*` 与 `src/sources/kind.ts`，**明确禁止碰 `src/app/*` 与面板**）→
第 36 轮 **C1**（`src/sources/chat.ts` 本体）与 **C2**（发送路径 + 放弃痕迹）→
第 37 轮 **D**（面板聊天卡 + `state.chat` + `counts.sends` 出口，**不新增路由**）→
第 38 轮 **E**（真宿主验收）。

**第 38 轮验收的四个场景**（`docs/v2/16-live-acceptance-chat.md`，695 行，**边跑边写**，53 份残件在 `/tmp/myagent-acc-chat/`；
产物哈希起点=终点=`b955704fcc677aff…`、303956 字节、一致）：

| 场景 | 判定 | 关键观测（逐字取自报告） |
| --- | --- | --- |
| 1 · 已映射身份的闭环（契约 §7.3） | **通过【实测】** | Trigger `40dbe2b2…` **与投料前本地复算的 `key('chat','room-a','msg-acc-001')` 逐字符相同**；`sender={id:"acc-alice", kind:"person"}`——**不是**平台 id `U01ACC01`；`via:"chat"`；`replyTo={chat, room-a, t-acc-1}`；原文件消失并归档为 `room-a/accepted/40dbe2b2…-acc-001.md`（**纯函数名、无时间戳**）；worker 真跑到模型（`usage` total **37755**）；回复文件 `room-a/out/reply-40f114496924e6c7a442ba5998bfb28e.md`（253B）**正文即报告摘要原文**；`counts.sends` `{0,0}→{1,0}`；事件 `created → launched(+59ms) → report`，**文件落盘到 created 仅 0.77s** |
| 2 · 未映射身份被留住（契约 §2.2，安全核心） | **通过【实测】** | 留住 8s（8 个扫描周期）：六项计数与起点**逐位相同**、文件 **308B 且 mtime 未变（一字节没动）**、`chat.waiting={count:1,ids:["U09UNMAPPED"]}`、健康行逐字取到。**加映射后同一条被受理恰好一次**：Trigger `bf0cad26…`（=预算值）、**`at` 仍是文件 mtime `10:36:50Z` 而不是受理时刻**、归档一份、waiting 归 0；再等 43s（≈43 个周期）**无第二份归档**。**顺带把 §2.3 也证干净了**：那次 PUT 只改 `identities` 一个字段，`policyVersion` 由 `ad064036…` → `0bafb839…` |
| 3 · 面板读的 API 表面 | **3 项通过、1 项证伪** | **被证伪的那一项是验收单自己写错了**：`state.chat` 只有 `{policy, waiting}` 两个键，频道在 `state.settings.sources.chat.channels`、`sends` 在 `counts` 之下——而**源码里这是有意的**（`http.ts:198-203`：`chatView` 故意不复制 settings 文档，因为那份文档已经在 `state.settings` 里了，**复制一遍就有两个可能不一致的来源**）。`00:2253-2255` 由此得出：**"验收单里的每一条'应当看到 X'都必须自己先核过一遍源码，否则验收会变成'按一份错的清单去证伪一个对的实现'"**（这是验收代理第三次查出指令本身有问题）。其余通过项里最要紧的一条：那张**无 `replyTo`** 的 inbox Ticket 结束后 `counts.sends.nowhere` 由 0 → 1，即**"什么都不做"确实是可观测的** |
| 4 · 停机后无人再写 | **通过【实测】** | 作业 `killed`、pid 57025 消失、3180 两次皆空；两个样本相隔 62s（距停机 ~172s）的 `ls/shasum/stat` **diff 为空**，DB `bc1b3f03…`/102400B/mtime 全同，`-wal/-shm/.lock` 两次都无。**停机是优雅的**：`db.close()` 把 WAL checkpoint 进主库（运行中 4096B 主库 + 247232B WAL → 102400B 无 WAL），`process.once('exit')` 删掉锁 |

**安全边界**：日常库 sha256 起点=终点=`a793caac…`、167936B、mtime 11:40:37 **全未变**；
日常宿主（3080，pid 24619）全程在跑、**只收到 GET**、未重启未 toggle。
**本文本轮只读复核了同一份日常库，sha256 仍是 `a793caacbbcb2e1d…`**——即第 38–46 轮期间它一个字节都没被写过。

**P8 明确留在范围外的**（写进契约 §1，也在 `12-unimplemented.md`）：
**不做多实例**（D3：registry 以 `kind.name` 为键，开它是单独的架构变更——**注意一个 Source 实例可以有多个频道，但仍然只有一个实例**，`policy.ts:191-194`）；
**不接任何真实平台 SDK**——参考实现读本地目录，形状像 inbox 而不是像 Slack，
因为接入真实平台会引入凭据、网络与限流，**那些是部署问题，会淹没这一片真正要验证的东西（身份映射）**。
这两条都是 **仅有设计**（C187）与 **刻意留着**（C248 的未接入那一半），不是漏掉的。

**P8 之后仍然开着的三件**（`00:2291`）：§4.35 的 (v) —— **已在第 40/44 轮整体结案**（C229、C230、C234）；
S38 —— **已在第 39 轮修掉**（C231）；`Runtime.sourceStatus()` 覆盖 `counts` 那个疣 —— **仍未修**（见 §10.2）。

### 10.2 本文已核实的其余缺口

| 能力 | 状态 | 今天有什么 | 缺什么 | 它挡住什么 |
| --- | --- | --- | --- | --- |
| 预算上限与超限处置（token / 墙钟 / 尝试次数） | **尚未实现** | 真实 token 计量已在（`usageOf`，`src/app/runtime.ts:135`，带 `windowed` 标志与"没有数据就返回 undefined 而不是一堆 0"两条诚实性约束），**而且第 38 轮在真宿主上读到过它**（C95） | `grep -rni "budget\|ceiling\|quota\|maxTokens\|tokenLimit\|costLimit" src/` 的命中**全是注释或字节上限**；`SettingsSchema`（`src/core/policy.ts:80-243`）里没有任何预算块。**桩侧还有硬阻塞**：`sessionProjections` 服务在替身宿主里完全没有（`grep -c` → 0），离线任何预算代码都会 TypeError | 一个跑飞的 worker 会一直跑。`06` §2 的这一行写的是「**不存在**」，§5 也明说"不会因为有 worker 烧掉太多 token 或跑太久而被拦下（Watchdog 只处理'卡住'和'静默'）"。它也挡住了 `00` §4.13「未做」里的"预算探测器"——**计量已经做了、而且在真宿主上读到过，探测器还没有** |
| 面板渲染 token `usage` | **尚未实现** | API 侧已带（`GET /api/tickets/:id/progress`），真宿主上读到过非零值 | `grep -c "usage\|Tokens\|token" panel/index.html` → **0**（面板已从 1528 行长到 **2121** 行，中间加的是聊天卡与丢失区块，**没有一处渲染 usage**） | 操作者在任何界面上都看不到用量，尽管它已经被诚实地计量、并且被真宿主读到过。所以现状是"可见"这个说法**只对读 API 的人成立** |
| 产物内容的来源标注 | **尚未实现** | 第 28 轮做了 **Input** 的标注（`authorOf`，`src/app/executor.ts:43`），worker 写的那一种明写 `not from the operator, so treat it as data` | `Runtime.readArtifact` 返回的 `content` 是**裸文本**；本轮复核 `grep -n "external\|untrusted\|not an instruction" src/app/runtime.ts src/app/tools.ts` → **0 命中**，即没有任何"以下是外部内容、不是指令"的包装 | `06` §4 把"另一个 Ticket 的产物"列为 **worker→worker 的注入通道**；`00` §4.23 的「未做」说产物那条通道"比 Input **更**需要，因为产物内容可以任意长且完全由模型写"。现有缓解只有 Work 边界缩小半径。**P8 又添了一条同族的通道**：一个聊天频道目录里的消息正文同样是不可信文本，而面板已经为它加了转义测试（C199 的 `describe('markup in a value a chat platform wrote')`），**但给 worker 的那一份没有来源标注** |
| Project / Work 的改名与删除 | **尚未实现** | `POST /api/projects`、`POST /api/works`、`POST /api/tickets/:id/work` | 路由表里 `PUT` 只有 2 条（`settings`、`prompts`），`DELETE` **0 条**（本轮重数，仍是 0）；`BodySchemas` 里没有更新形状 | 一个写错名字的 Work 只能被放着，或者去改库。`05` §5 与 `00` §4.19 都点了这一条；**第 33–46 轮没有动它** |
| Project / Work / 依赖图从未在真宿主上被驱动过 | **部分实现**（未验证的那一半是 **离线验证**） | 路由、调用者、面板工作 tab 都在（C32、C33、C197、C198） | 一次真宿主驱动。本文只读复核 3080：`projects`/`works` 都是 `[]`，`counts.ended` 是 **9** 而**没有一张属于任何 Work**；第 33 轮与第 38 轮两次隔离验收的四个场景都不含它们 | 级联取消、`released()` 的两种释放语义、`workSeq` 排序、依赖等待用 `Later` 表达、分层上下文那段 `## The work this belongs to`——**全部只有离线证据**。`02b` §6.3 复核过全库 `type='ended'` 的事件 **0 条**，即那轮验收里没有发生过一次级联 |
| 面板在真浏览器里的行为 | **部分实现**（未验证的那一半是 **尚未实现**：连验证手段都没有） | **186 条** jsdom 断言 | 没有真浏览器 harness；`tests/panel.spec.ts:395,418` 的注释自己点名了 jsdom 缺什么 | `scrollTop` 还原、横幅的 flex 排版、Blob 下载、剪贴板 —— `05` §5 说"只有真浏览器能证"。**第 37 轮的聊天卡与第 45–46 轮的丢失区块一共 39 条新断言，全部在 jsdom 里** |
| DSH 宿主本身的安全性质（它如何强制工具清单、权限预设、Session 隔离） | **尚未实现**（未审计） | `06` §2 把"worker 工具清单"与"单写者锁"归为**仅有的两处真边界**，而第一处的强度**完全依赖 DSH 的行为** | 一次对 DSH 的审计。`06` §7 末段：「我**没有审计过 DSH 本身**，这是本清单最大的未验证假设」 | 如果那个前提有问题，`06` §2 的"真边界"分类要跟着改 —— **这份风险清单里最强的那两行是未经检验的**。本文能补的一条相关事实：替身宿主**完全没有** `sessionProjections`、`sessionController.inspect`、`systemPrompt` 三个服务，而且"**没有任何东西验证 `myagent-worker` 预设真的存在**"（`00` §6） |
| worker 的真边界（沙箱） | **尚未实现** | `WORKER_PERMISSION = 'danger-full-access'`（`src/app/sessions.ts:27`，本轮复核未变），Ticket 的 `scope` 只是**提示词约束** | `06` §6 六条待办里"高"的那一条：受限用户 / 容器 / 只读挂载 + 可写工作区 | 在这条之下，所有"路径守卫""越界拒绝"（含 `tests/files.spec.ts` 那 15 条）只防**意外**，不防**恶意**。**属于部署层，本套测试无法覆盖** |
| 降级路径：真的装回旧构建跑一遍 | **尚未实现** | 副本演练证明"改版本号之后旧构建需要的数据都在"（C55）；`00:2672` 记第 44 轮又跑过一次 `verify-migration.sh`、退出 0 | 一个保留了 v1 构建的分支或标签。`03` §6 明说旧构建的代码已不在树里。**本文复核：项目目录不是 git 仓库**（`git log` → "不是 git 仓库"，`.git` 不存在），所以"保留一个 v1 标签"这件事目前**没有载体** | **S37 之后这一条从纸面推演变成了真实风险**：日常库是 version 5，任何旧构建挂上来都会 `SchemaTooNew` 拒绝打开（C56），而这条路径**一次都没有被观测过**。**§9 第 19 条那个"无法闭合的对账"就是它的直接后果**：没有历史，就没有"第 31 轮之前的 `errors.ts`" |
| S32：`pnpm check` 的 40 个未处理错误 | **部分实现** | 根因已查明并修（`sync()` 的重入闩，C186）；`/tmp/myagent-gate.log` 里 `Errors`/`Unhandled` **零命中**；命题 B 现在**有了正面证据**——`docs/v2/14-…` 场景 4【实测】SIGTERM 后 60s 内 sha256/size/mtime 三者不变、`-wal`/`-shm`/`.lock` 均未重现、`lsof` 对端口与文件两次都空（**史上第一次被测**） | 一条能区分"定时器没触发"与"定时器触发了但一个字节都没写"的证据。`02b` §3 划的界仍然有效：**"我这次只证明产物文件没被写，没有证明那个定时器没有触发过"** | `00` §4.27 的裁定是"**A 结案，B 仍是欠账**"，而"「S32 结案」这句话把 A 的结论挪用到了 B 上"。第 33 轮把 B 从"从未被测"推进到"测了、但证据的强度止于无写入"——**这是进展，不是结案** |
| `Engine.artifactsOf` / `dispositionOf` / `trigger` | **部分实现（未接入）** | 三个方法都有完整实现（`engine.ts:1116,872,820`） | 调用者与测试都没有。**接入它需要什么**（§4.25 要求写明）：`artifactsOf` ← `Runtime.artifacts()`（`runtime.ts:619`，现在直接查 Store）；`trigger()` ← `http.ts:357`（为了取 `replyTo` 直接查 Store）；`dispositionOf()` **没有现成的接入点** | 见 §8.3 第（3）条。写者唯一（§1.2）没有被破，但"面板看到的产物来自 Engine"是假的。**第 37 轮又添了一处同族的绕过**（`http.ts:357`），所以这个缺口在**变宽** |
| `failTicket` | **部分实现（未接入）** | 实现完整、语义明确、4 处测试 | 一个生产调用者。`00` §4.9 预定的那个（P4 的 Watchdog）**没有用它**，而 Watchdog 此后又长出了第三个动作 `escalate`（C227），**仍然不是它** | 见 §9 第 11 条 |
| `input_missing` 错误码 | **部分实现** | 19 个错误码里 18 个有抛出点 | `input_missing`（`src/core/errors.ts:12`）**零抛出点、零测试**（第 32 轮与本轮各复核过一次）。`grep -rn "input_missing" docs/ README.md` → 没有任何文档记录过它 | 一个死条目。它的存在会让"错误码表覆盖全部拒绝路径"这个说法永远是 部分实现 |
| `delivered` / `delivery_failed` / `session_bound` 三个事件类型 | **仅有设计** | 三个都在 `TicketEventType` 里声明了（`src/core/model.ts:130-133`） | 写入点。`inputsDelivered`（`engine.ts:532`）、`deliveryFailed`（`:546`）、`bindSession`（`:861`）三个方法都只 `mutate` Ticket 行 | 这三件事**不在日志里**，只在被 `mutate` 反复重写的行里。所以"输入到了没有"、"投递失败过没有"、"DSH 回的是不是另一个 Session id"这三个问题，事件日志回答不了 —— 而日志存在的理由正是"行里只有每样东西的最新版本"。**对照**：第 34/36/40/44 轮给"升级""回复丢了""通知丢了""请求丢了"四件事都补上了写入点（C227–C230），**而这三种仍然没有**——即"哪些事实该进日志"这个判断做过四次，都没有落到这三个上 |
| 三处 Source 的 catch-all（S33 那一族的**第四次**出现） | **尚未实现**（未修，规格已写） | `receive` 那个真的错**已修**（`lost` 行不算重复，C230），两层都钉了测试 | `src/sources/inbox.ts:228-234`、`src/sources/chat.ts:385-386`、`src/sources/cron.ts:194-196` 三处**仍然存在**：任何未点名的处置状态都被归档为 accepted/ignored。修法在纪律 §0.10 末段：把隐式的"else → accepted"换成显式的 else，**记一行健康问题、点名那个状态**，并计入一个诚实的计数；归档目录同理，因为"把一个没被受理的请求归档进 `accepted/` 是**目录在说一句假话**，而目录是操作者会去看的" | 今天对 `lost` **不可达**（只有 `rule.ts:99` 入队 `trigger` 效果，而规则来源从不调 `receive`），而且 `receive` 那个修复让它们保持不可达。**但任何未来的 `Disposition` 成员都会走进它们**。纪律 §0.10 把这一族记成"一个会到期偿还的债"，并给出那句规律：**"一份 kind 的清单，就是一份'会被忘掉的东西'的清单"** |
| `Runtime.sourceStatus()` 整体替换 `counts` | **尚未实现**（未修） | D 靠读 `sources.source('chat').status()` 绕过了它（C245） | 疣在 `src/app/runtime.ts:621-629`：任何 Source 自己的 gauge 一旦该 kind 存过一个 Trigger，就从 `state.sources.<kind>` 消失（`counted[name] === undefined ? own : { ...own, counts: counted[name]! }`） | `00:2209-2211` 说清了它的影响面：**会影响下一个有 gauge 的 Source**。而 `chat` 正是第一个有 gauge 的，所以它已经踩到了 |
| `sends()` 的两个计数是"每次挂载以来"的内存数 | **部分实现** | 面板在它们旁边如实写了 "since this mount"（`http.ts:303-306` 的注释：**"一个 0 读起来像'从来没发生过'比没有数字更坏"**） | 持久化要动 `delivery.ts` 与 store | 一次插件重载就把回路的历史归零，而操作者读到的是 0 |
| `channels` 与 `allowedSenders` 仍只能改整份 JSON | **尚未实现** | `PUT settings` 与面板的设置页 | 逐条编辑的界面 | `00:2214` 记为未修。后果是具体的：改一个频道要重贴整份设置文档，而**一次贴错会让整份文档被 `.strict()` 拒掉** |
| 一条丢失的 **policy** 通知仍带着本来要说的话 | **尚未实现**（测试欠账） | `??` 优先级 bug 已修（`runtime.ts:302-306`，注释逐字写了 "`??` binds LOOSER than `===`"）；**report 通知那一半有变异检验**（`17` §6 的 M2） | 一条测试。`tests/fault-injection.spec.ts:519-524` 的注释逐字记了它为什么被撤下而不是留成红的或伪造的：reproducing 一条丢失的 policy 通知"needs one more fact I did not establish — how `saveSettings`' policy effects reach `delivery.policyChanged` under the stub" | **这是本轮清单里唯一一处"缺陷已被端到端量到过、修复只被覆盖了一半"**：那个 bug 在真宿主之外被**实测**到（一个被丢掉的 policy 通知留下 `detail={notice:'policy', error:…}` 而**没有 `text`**），即**违背了 §4.39 自己承诺的那件事**。`00:2398-2400` 由此得出的规律值得留着：**"当一个 bug 只在未被覆盖的分支里显形时，覆盖率不是'够不够'的问题，而是'覆盖的是不是同一个分支'的问题"** |
| N11：升级与后来的成功之间**没有对账** | **尚未实现**（未修） | 第 34 轮把升级写进了日志，所以**读者可以自己看出来**那次升级是虚惊（日志是 `created → rescued → rescued → escalated → launched → report`，`launched` 在 `escalated` 之后、Ticket 最终 `done`） | **系统主动对账**——那需要一个"升级已失效"的事件（`00:1866-1869`） | `docs/v2/14-…` §7 第 4 条【实测】：两张 Ticket 最后都是 `outcome:"done"`，而 Watchdog 报了两次 rescue + 一次"需要人"。**"需要人"可能是一个永远不会被纠正的假警报**。N9（健康板一个槽位被无关 Ticket 覆盖）与 N10（升级条目过期却看起来是当前的）在 N8 修好之后**降级为显示层瑕疵**，因为日志里两条升级各自在自己的 Ticket 下、事件的 `at` 不冻结 |
| `GET lost` 的"列出每一条而不是最新的一个窗口"这个性质 | **部分实现**（性质在，守卫弱） | 性质在源码里且有理由（`http.ts:545-550` 的注释：`since` 是**最新**窗口，所以一个每次触发都坏的生产者会把一条较旧的丢失挤出窗口，而 `countBySource` 仍在计它——**一个与它旁边的数字不一致的列表，出现在一个专门回答"丢了多少"的页面上**）；测试是 `tests/http.spec.ts:794` | 一次删检之后的加强。`00:2772-2775` 逐字记着：代理按纪律 0.8 的强形式做了删检，**发现删掉某条断言后缺陷全活时测试仍绿**，正要去加强时死了，**那条加强没有做** | **这个性质目前可能只由一条可以被删掉的断言守着。** 这是一条明确的、范围很小的**测试强度**欠账，不是功能缺陷。**具体是哪条断言本文未核实**：核实它要重跑一次删检，而那需要改测试文件。`docs/v2/11-test-report.md` §5 把这一条与另外三次同族事件并列 |
| `policyVersion` 跨构建不稳定，而 `settingsRevision` 稳定 | **部分实现**（未验证的那一半是 **尚未实现**：没有任何东西记录“这个版本号是哪个构建算出来的”） | `policyVersion = key('policy', authorizationShape(settings)).slice(0,16)`（`src/core/policy.ts:295`）；Mandate 记下它（C23）；面板读得到它（C24）；第 35 轮给 `authorizationShape` 加了派生的 `enabled` 与 `identities`（C226） | **本文 02:4x 实测**：同一份存盘设置文档（`settingsRevision` 一直是 **7**、没有任何授权旋钮被碰过），在旧 bundle 下算出 `275ea61ded276e15`、在 01:40:15 重载后的新 bundle 下算出 **`3bb5598e3044fc96`**。缺的是**把构建身份与版本号绑在一起**——`00` §4.26 曾刻意不暴露构建时间与产物哈希（理由是面板每 5 秒轮询、不该每次都算一次 SHA），所以“版本号为什么变了”只能靠两次 GET 之间的一次重载来推断 | 所有由旧 bundle 写下的 `Mandate.policyVersion` **不再等于**当前的 `policyVersion(settings)`。此刻没有可观测影响（`policyChanged` 只在一次设置保存时比较**同一构建下**的两份文档；`counts.open` 是 0）。**未核实**：一张在重载之前受理、仍活着的 Ticket，在下一次授权旋钮变更时会收到什么措辞的通知。核实它需要“重载前受理 + 重载后改旋钮”这个顺序 |
| `examples/` 里没有一份 chat 的配方 | **尚未实现** | 两份配方（daily-digest 的设置文档、data-report 的请求文件）都被真 schema 与真门禁持续校验（C218） | 一份聊天来源的配方：一个频道目录、一条身份映射、一条投料样例 | `sources.chat` 的 `channels[].directory` 是**必填**的（C225），所以一个想试聊天来源的操作者**没有可抄的起点**。而 `00` §2 S20 记过这条闸门挣回成本的一次（`examples/README.md` 曾被当成请求配方发给面板）——**配方是被测试钉住的，schema 不是** |
| inbox 的**发起者身份**经过认证 | **尚未实现** | `06` §3 点名了它：inbox 来源的 actor 是从**请求文件本身**推出来的，所以"**能写 inbox 目录的人，就能以任何被允许的发起者身份提交工作**"，而门禁的记录里会写着一个看起来合法的发起者 | 设计。清单明说"这不是 bug（文件就是那个来源的身份凭证）" | **P8 把这条缺口的性质变得更清楚了，而不是修掉了它**：聊天来源**没有**重复这个错误（身份必须被映射、`scope` 不从消息读，C242/C243），所以现在系统里**同时存在**一个自述身份的入口和一个被映射的入口。**第 27 轮给 inbox 加了目录权限自检**（C171），第 36 轮给 chat 加了同一件事而且**每轮 pass 都查**（C246）——两处都是**缓解**，不是认证 |

### 10.3 本文没有覆盖的

为了不让这一节被当成完整清单，明说它**不含**什么：
`00` §4.7–§4.46 里其余的「未做」段落（例如按 Work 的依赖、被级联结束的 Ticket 不进 attention 列表、
上下文的分层压缩、`Work.scope` 作为受理时的默认 scope、按 Work/Project 的累计成本、
`Schedule` 绑定 Work、规则来源的 `then.workId` 写入路径）；
`06` §6 按严重度排序的六条待办里本文没有逐条核对的那几条；
`03` §5 的设置文档回滚硬阻塞；
`00` §6 的替身保真度问题里除 C220/C221 之外的全部条目（那份清单在 `docs/v2/11-test-report.md` §6 里逐条复核过）；
P8 契约 `docs/v2/15-p8-contract.md` §7 里本文没有逐条对照的现场项；
以及 P0–P9 十个阶段的逐项对照。

---

## 附录 A：已经关掉的文档漂移（原 §9 的第 1–10、13、17 条，与上一版 §12/§13 两段增补）

**这些条目本文不再当作"当前不一致"列出，但没有删掉**：它们记的是"当时是对的、什么时候被什么关掉的"，
而这个信息本身有用——它说明哪些漂移是**代码修好的**、哪些是**文档改好的**、哪些是**被更新的测量盖掉的**。
上一版把它们挂在 §12（第 32 轮的更正）与 §13（第 40 轮的增补）两段增补里，本轮**折进正文并搬到这里**。

| 原编号 | 当时的不一致 | 怎么关掉的 | 何时 |
| --- | --- | --- | --- |
| §9 第 1 条 | `00` §8 第 4 项标 ⬜：S14 来源计数改为从库里数 | **代码早已做完**（`Store.countBySource()`，`src/app/store.ts:319`；调用点 `runtime.ts:625`、`http.ts:264`），是清单少算了一笔已完成的活。**`00` §8 那一格至今仍是 ⬜**，本文在 C62 里就地写了"那条已经过期" | 第 24 轮做，本文第 32 轮查出 |
| §9 第 2 条 | `00` §8 第 5 项标 ⬜：S15 marker 里的 Volatile | **代码早已做完**（`runtime.ts:248-253` 逐字段拼而不是展开，带注释）。而 `00` §7 的 S30/B7 行自己标了"已修"——**同一份文档里两处状态互相矛盾** | 同上 |
| §9 第 3 条 | `00` §8 第 7 项标 ⬜：S2 的提示词部分 | **已做**：`prompts/worker.md` 的 `## If you delegate` 段两句都在（本轮复核在 `:51` 起） | 同上 |
| §9 第 4 条 | `00` §8 第 8 项标 ⬜：`agent-delivery.ts` 的 flush 顺序 | **已做**：`src/app/agent-delivery.ts:110-112` 是 `await flush()` 然后 `accepted?.()`，带注释 | 同上 |
| §9 第 5 条 | `00` §4.7 的「未做」列了 `session_bound`、`delivery_failed`、`dismissed` 三种"已声明但没有写入点"的 type | **两处都不对**：`dismissed` 根本不在 `TicketEventType` 里；漏了一个真的（`delivered`）。**第 31 轮已更正 §4.7 那份清单**（`00:1460`）。正确的清单是 `delivered` / `delivery_failed` / `session_bound`，本文在 C06 与 §10.2 里按当前源码重新核过 | 第 31 轮 |
| §9 第 6 条 | `src/app/tools.ts:1-6` 文件头："A worker gets **one** tool" | **已修**：文件头现在写 "A worker gets **three** tools"，并且**把这次漂移本身写进了注释**（"this header used to say "one tool", which was true for eleven rounds and then quietly stopped being true"） | 第 30 轮 |
| §9 第 7 条 | `prompts/worker.md:11`："`myagent_report` is … **the only way**" | **已修**：`:11-16` 现在点名三个工具并说明后两个为什么窄。`grep -ni "artifact\|note_ticket\|read_artifact\|same Work" prompts/*.md` 从**零命中**变成有命中 | 第 30 轮 |
| §9 第 8 条 | `05` §5：`127.0.0.1:3080` 上跑的是旧 bundle，`projects`/`works`/`events`/`dependencies` 全部 404，`GET tickets/:id` 没有 `artifacts`/`workId`/`workSeq` 键 | **S37 已就地更正**；本文上一版补了 `workId` 缺失的**真正原因**（`views.ts:54` 无条件写这两个键，值为 `undefined` 时 JSON 省略它，而那 8 张 Ticket 本来就不属于任何 Work）——**它不是版本问题**。**本轮那四条路由仍返回 200**（§0.3） | S37（第 30 轮）+ 本文 |
| §9 第 9 条 | `02` §3/§5：`createProject`、`createWork`、`attachWork`、`dependOn`、`blockedBy`、级联取消在 `src/` 里**零调用者**、"线上不可达" | **对当前源码是错的**（第 21 轮已补 HTTP 入口）。准确的现状是**有调用者、但从未在真宿主上被驱动过**。`02b` §4.3 只把其中一条标为过期，其余明说"我无法替你确认现状"——**本文确认了，本轮又确认了一次**（§0.3：`projects`/`works` 仍是空集合） | 第 21 轮做，本文第 32 轮查出 |
| §9 第 10 条 | `02b` §7.4：协作通道 `noteFromWorker` 没驱动的理由是"线上不可达——`attachWork` 零调用者" | 前提已过期（`POST /api/tickets/:id/work` 在 `http.ts:396`）。准确的现状是**线上可达、但需要两张同属一个 Work 的 Ticket 同时在跑，从未被安排过** | 同上 |
| §9 第 13 条 | `00` §5 的整段"线上库现状（只读实测）" | 这是一条**支持**既有文档的记录（当时除 version 外其余计数复核后仍然成立）。**本轮重新测过，计数已经前进了**：`triggers 10 → 11`、`tickets 8 → 9`、`decisions 10 → 11`；而**日常库的 sha256 与 `docs/v2/16-…` §5 记录的起点=终点逐字相同**（`a793caacbbcb2e1d…`），即第 38–46 轮期间它没被写过。§5 的 `schema_version=1` 仍然错（**§9 第 12 条，仍开着**） | 本文两轮各测一次 |
| §9 第 17 条 | `05` §0/§3：`tests/panel.spec.ts` 是 **144 条** | 差额当时可解释（S36 的两条是第 23 轮补的，`05` 成文在那之前）。**本轮它已经是 186 条**，所以这条被更大的数字盖掉了；本文的权威数字一律取自 `/tmp/myagent-gate.log` | 第 23 轮 → 第 37/45–46 轮 |
| §12（第 32 轮的更正）第 1 行 | 本文 §9 第 6/7 条那两处陈述 | 已在第 30 轮修掉，见上表第 6、7 行。**本轮复核仍然修着** | 第 30 轮 |
| §12 第 2 行 | 本文 §10.2：`engine.ts:455` 对不存在的 Decision 抛 `trigger_missing` | **已修**：`errors.ts:23` 新增 `decision_missing`，`engine.ts:512` 抛的正是它。本轮复核成立（C44） | 第 31 轮 |
| §12 末段 | 本文提出的"未接入"一词 | **已被采纳为标注规则**（`00` §4.25）：不新增第六个状态，标 **部分实现** 并把缺失的那一半命名为「未接入」，且必须写明接入它需要什么。**本文已折进 §0.1 规则 2，并在 4 项上照做**（C42、C43、C135、C248） | 第 31 轮 |
| §13（第 40 轮的增补）第 1 行 | 本文 §10.1 / §1：**P8 至今零工作量** | **已落地并验收**，本文 §10.1 整节重写 | 第 35–38 轮 |
| §13 第 2 行 | `Delivery` 端口只有 `report` 与 `policyChanged` | 多了 **`send?`**（C189、C237） | 第 35 轮 |
| §13 第 3 行 | `Actor.kind` 只有 `person \| system`，且无代码路径能产生聊天身份 | `kind` 仍只有两个成员（**这是对的**），但**现在有了产生 `person` 身份的真实路径**：`sources.chat.identities`（C242） | 第 35–36 轮 |
| 本轮新增 | `/tmp/myagent-gate.log` 里“结论：通过”这一行**不说明它验了什么**：`--quick`（跳过 build 与两项产物核对）与完整闸门写同一个文件，于是日志里最后一次“通过”可能只做了两步 | **已修**：`scripts/gate.sh:22-25` 现在把运行方式写成日志的**首行**（`── 本次运行：scripts/gate.sh （…）`）。**这条是本文本轮亲手撞出来的**——02:3x 读到的那份日志只有 `── typecheck` 与 `── test` 两节，而它的结论行与四步全过的那次**逐字相同** | 第 47 轮 |
| §13 末段 | 本文记的 **631** 条测试；上一版增补记的 **723** 条 | **当前 760 条**（33 个文件，02:40:09 那次四步全过的闸门；本文 00:5x 量到的是 759），产物 `768a6adb1cfc136c…`（320163 字节，哈希在本轮被独立量到四次都相同）。逐文件清单与对账见 §7 与 `docs/v2/11-test-report.md` §2–§3 | 第 45–46 轮 |
| §13 末段 | 新增的事件类型 `rule_stopped`、`escalated`、`reply_lost`、`notice_lost`——四个都有写入点；仍然从不写入的是 `delivered`/`delivery_failed`/`session_bound` | **本轮逐条核过，成立**（C05、C06）。另外**第 44 轮又加了一种事实**：`Disposition` 多了第五个成员 `lost`（C223），它不是事件类型，但同属"以前无处可放的事实现在有了地方" | 第 34/36/40/44 轮 |

**附录 A 里唯一一条"关掉方式值得单独说一句"的**：§9 第 6/7 条（`tools.ts` 的文件头与 `worker.md` 的"唯一途径"）。
它们不是被"改正"了，而是被**改成把漂移本身写进注释**了——
`tools.ts:1-9` 现在逐字写着那句 "true for eleven rounds and then quietly stopped being true"。
**一条注释如果只说"现在有三个工具"，它会在下一次加工具时再错一次；说清它曾经错了 11 轮，才有人会在加第四个之前先来改它。**
这与 §9 第 18 条（`policy.ts:445-446` 那条指向已被否决设计的注释，**仍开着**）正好是一正一反。
