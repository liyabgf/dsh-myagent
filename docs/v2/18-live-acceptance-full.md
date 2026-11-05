# 18 · P9 全量真宿主验收（第 48 轮）

日期：2026-11-05（本地 Asia/Shanghai）。执行人：P9 验收代理。
范围：自 `f6b29adc…` 那次 FULL 验收以来的全部变化 —— P5 后半、P6、P7 面板重写、P8 全部、约 25 处修复。
不重复第 33 轮（Watchdog，`14-live-acceptance-watchdog.md`）与第 38 轮（chat，`16-live-acceptance-chat.md`）已证明的内容，例外处注明。
脚本：`docs/v2/08-acceptance-recipe.md`（命令以它为准，优先级以任务书为准）。

标注约定：**【实测】**=本轮在真宿主上观测到；**【推断】**=由代码/文档/离线测试推出，未在本轮观测。

## 0. 冻结版本核对（开始前）

【实测】2026-11-05 03:14 本地：

| 项 | 期望 | 实测 | 判定 |
|---|---|---|---|
| `lib/index.js` sha256 | `768a6adb1cfc136cc7d0b0e99578fa047fafc95cb5330e33b2b9943236c7c3e2` | 同 | 一致 |
| `lib/index.js` 大小 | 320163 B | 320163 B，mtime Nov 5 03:10:56 | 一致 |
| 源文件不比产物新 | 无 | `find src panel scripts package.json -newer lib/index.js` 为空 | 一致 |
| `panel/index.html` sha256 前缀 | `2fdbfcad0f440318` | `2fdbfcad0f440318` | 一致 |
| `panel/index.html` 大小 | 128775 B | 128775 B | 一致 |
| 日常库 sha256（前） | `a793caacbbcb2e1d5f96608305878340c52f5c31d7f031e05a4c4df628a987f5`，167936 B | 同 | 一致 |

未运行 `pnpm build` / `pnpm check` / `scripts/gate.sh`（任务书禁止；03:10:53 的 gate 结果 exit 0 / 760 tests 由操作者提供，本轮不复核）。

## 1. 隔离宿主启动

【实测】启动命令（工作目录 `~/deepseek-harness`）：

```bash
node --import tsx/esm apps/cli/src/bin.ts \
  --profile myagent-test --patch /tmp/myagent-acc-full/overlay.patch.yml \
  --port 3180 --no-open
```

- 日志 `/tmp/myagent-acc-full/host.log` 出现 `dsh web: http://127.0.0.1:3180/?token=…`（token 略）。
- 覆盖层：stateDir `~/.dsh/state/myagent-acc-full`，主 Session `myagent-full-main`。
- 启动前 3180 无监听；日常宿主 3080 pid **24619**（收尾时对照）。
- `GET /api/state` → 200：`sources` 含 cron / inbox / session / rule（另有 chat），`policyVersion` 为 16 位十六进制 `2092926da72d2083`，health 各项 `ok:true`。判定：**通过**。

**与配方的一处偏差（记录）**：全新 stateDir 的默认 `acceptMode` 是 `observe`（`src/core/policy.ts:83-85`：新部署从 observe 起步）。配方 §2 写作时其隔离目录已是 `auto`。本轮先 `PUT /api/settings {"acceptMode":"auto","allowedSenders":["operator"]}` 再投料；该 PUT 同时作为 §4.4 policyVersion 变化的一个数据点。

## 2. P1 · 闭环一（配方 §2）：一个文件变成一件做完的工作 —— **通过**

【实测】先 `PUT /api/settings {"acceptMode":"auto","allowedSenders":["operator"]}`（200；`policyVersion 2092926da72d2083 → ca0575e85c402fef`，`settingsRevision 1`，runtime detail 变为 `0 open Ticket(s), accept mode auto`），再按配方投 `demo-1.md`（mtime 回拨 10s，03:18:39 落盘）。

10 秒内出现 Ticket `579e98ff040e01ec27d99150039d052d`（running），约 40 秒后 `stage=done`。逐项证据：

1. **stage=done、标题「验收-闭环一」** ✓；`ended = {outcome:"done", by:"agent", reason:"The worker reported ready", at:"2026-11-04T19:19:23.998Z"}`
2. **报告与产物** ✓：
   - `reports[-1] = {state:"ready", files:["evidence.txt"], summary:"已在本 Ticket 目录写入 evidence.txt，共 98 字节…"}`（summary 是 worker 自己写的话，含 wc -c 复核说明）
   - 登记 `artifacts[0].path = "evidence.txt"`；`execution.directory = ~/.dsh/state/myagent-acc-full/work/验收-闭环一-579e98ff`
   - 磁盘核实：该目录下 `evidence.txt` 真实存在，98 B，内容两行 `2026-11-05T03:18:50+0800` / 上述 pwd。登记表与磁盘一致，登记没有撒谎。
   - `GET …/files` 列出 evidence.txt + RESULT.md；`GET …/file?path=evidence.txt` 返回 base64，解码与磁盘一致（面板下载走的是这条路）
   - 形状说明：HTTP 视图里 `assignments[-1].report` 是字符串 `"ready"`，配方写的 `report.state` 对应 `reports[-1].state`（对象在 `reports` 数组里）。语义不缺，字段路径与配方文字有一字之差。
3. **事件日志** ✓：`GET …/events` → `count:3`，按 seq 排序为 `1 created（by {kind:"person",id:"operator"}，detail 带 triggerId/via:"inbox"）→ 2 launched（by {kind:"system"}，assignmentId cc43b606…）→ 3 report（by {kind:"agent"}，state:"ready"）`。seq 从 1 连续。路由返回是**新→旧**（`[...clipped].reverse()`，http.ts:406），按 seq 排序即配方顺序。
4. **归档是事件身份的纯函数** ✓：`inbox/demo-1.md` 不在了；`inbox/accepted/26e220fc080af3a0fb625094ee044e77-demo-1.md`（`<triggerId>-原名`，无时间戳），首行 `<!-- myagent: Ticket 579e98ff040e01ec27d99150039d052d -->`。
5. **主 Session 被通知按需创建** ✓：投料前 `mainSession.exists:false`，闭环后 `{exists:true, running:true, id:"myagent-full-main"}`。`counts.sends` 变为 `{queued:0, nowhere:1}` —— inbox Ticket 没有 replyTo 频道，通知归入 nowhere，与面板文档「nowhere 对 cron/inbox 是正常的」一致。

另核实 `mandate` 记录了当时的 `policyVersion ca0575e85c402fef`（授权指纹随票走）。

## 2b. P2 · 新表面（全新宿主上的第一轮）—— **通过**

【实测】`GET /api/state` 200，全部要求字段在位：

- `mountedAt: "2026-11-04T19:15:05.437Z"`；`policyVersion: "2092926da72d2083"`（16 位十六进制）
- `counts.sends: {queued:0, nowhere:0}`；`counts.lost: {rows:0, payloads:0}`
- `chat: {policy:{enabled:false, paused:false, deny:false, acceptMode:"observe", allowedSenders:["operator"]}, waiting:{count:0, ids:[]}}`
- `sources`：cron / inbox / session / rule / chat 五个都在

【实测】`GET /api/lost` → 200 `{"total":0,"shown":0,"rows":[],"payloads":[],"bounds":{"keep":20,"chars":1000}}`。全新宿主 `total:0` 即正确答案。

【实测】`GET /api/projects` → 200 `{"projects":[]}`；`GET /api/works` → 200 `{"works":[]}`；`GET /api/tickets/:id/events` → 200（上节）；`GET /api/tickets/:id/dependencies` → 200 `{"waitsFor":[],"waitedOnBy":[]}`。

**`GET /api/tickets/:id/artifacts` → 404，且这是实现如此，不是坏了**：路由表（http.ts:334-609）里没有 `tickets/:id/artifacts`；产物内嵌在 `GET /api/tickets/:id` 响应的 `artifacts` 数组（http.ts:348），文件内容经 `tickets/:id/files` / `tickets/:id/file` 取。任务书把它列为"应当应答"的路由——**按字面判：未得证；按数据可达判：产物表面在 ticket 详情里已实测在位**。面板消费的是详情内嵌数组，故不构成缺陷证据，但任务书/配方与路由表有一处出入，记录在案。

【实测】健康语义（round 39 / 43）第一轮观测：`health` 里**没有 `executor` 键**（round 39 删除仪表盘后，无事时不应有该条目——成立）；**没有 `delivery` 键**（无任何发送失败时无条目）；`effects` 的 detail 原文：`"no effect failed in this pass"`，`at` 随每个 pass 前进。quiet pass 会重写 effects 条目这一点在 §4b 用时间序列补证。

## 3. P1 · 闭环二（配方 §3）：排期自己触发 —— **通过**（配方文字有一处过时）

【实测】03:23:05 `PUT /api/settings`（cron `demo`，`* * * * *` Asia/Shanghai；watchdog everyMs 15000 / launchStuckMs 60000 / maxActions 2）→ 200，`policyVersion c1e54e737a813a25`（rev 2，与 §2 的 `ca0575e8…` 不同）。

- **preview 给三个不同的将来时刻**：`POST /api/schedules/preview`（注意：是 **POST** 带 schedule body；配方写的 `GET …/schedules/preview` 在路由表里不存在，http.ts:490）→ `next: ["2026-11-04T19:24:00.000Z","19:25:00.000Z","19:26:00.000Z"]`，三个不同时刻 ✓。`GET /api/schedules` 的 `next` 同为 19:24:00Z。
- **自己触发**：03:24:21 查 `tickets`，多出 `2e925174f68fa141996521d44ac622ce`，`via:"schedule"`，标题「验收用」。Trigger `778d8d872927bd47c5dc5059d1025e41` 的 `at` 是 **19:24:00.000Z —— 正好压在整分钟边界上**，disposition accepted 指向该 Ticket。
- **做完**：`stage=done`，`ended={outcome:"done",by:"agent",at:19:24:26.522Z}`（触发后 26.5s），`reports[0].state="ready"`，登记 artifacts `["scheduled.txt"]`；磁盘 `work/验收用-2e925174/scheduled.txt` 内容一行「这是排期触发的。」✓。事件 `1 created(person/operator) → 2 launched(system) → 3 report(agent)` ✓。
- **改 expression 立刻生效（游标带 spec 指纹）**：03:24:53 把 expression 改为 `0 4 * * *` 再 PUT，`GET /api/schedules` **立刻**显示 `next: 2026-11-04T20:00:00.000Z`；且 03:25:00 **没有**再出新 Ticket（03:26:10 查，仍只有两张）——来源没有守着旧槽位 ✓。

**配方过时一处（记录，非缺陷）**：配方期望 `sender: "demo"`（排期 id）；实测 Trigger 与 Ticket 的 actor/sender 都是 `{id:"operator", kind:"person"}`，排期身份在 `title:"验收用"` 与 trigger kind 上。这是 `src/sources/cron.ts:183-184` 的**成文设计**（"The operator wrote this schedule, so the operator is who asks for the work"），配方文字停留在旧形状。判定按代码语义：**通过**。

## 4. P1 · 闭环三（配方 §4）：规则来源产生主动工作 —— **通过**（正路径 + 三条负面路径全过）

【实测】`PUT` 规则来源（`allowSystemActors:true`，rule `demo-rule`：when outcome done → 写 followed-up.txt，maxDepth 2）→ `pv a1b7b988dd5addbc`（rev 4）。投 `demo-2.md`（验收-闭环三-上游）。

**正路径**：上游 `64c078eb` done 后**自动**出现第二张 `7d5c4dc9`，其后又自动出现第三张 `35ef29e9`，链条到 depth 2 为止（maxDepth 2 被尊重，没有第四张）：

- 两张 follow-up 的 `mandate.via == "rule"`、`mandate.sender == {id:"demo-rule", kind:"system"}` ✓
- `origin.depth` 分别为 **1** 和 **2**；depth 2 那张的事件日志多出第 4 条 `rule_stopped`（by `{kind:"system", id:"rule"}`）——链条为什么停在哪儿，日志里可读 ✓
- 事件日志第一条都是 `created`，`by = {kind:"system", id:"demo-rule"}` —— **规则 id 就是 actor**，"谁发起了这张"可查 ✓
- 两张的 `reports[0] = ready / files:["followed-up.txt"]`，各自目录里 `followed-up.txt` 真实在盘 ✓

**负面路径 A（allowSystemActors:false）**：PUT 后 `pv d665a83d366aadcf`（rev 5）。投 `demo-3.md` → 上游 `172382eb` 照常 done，**没有**新 Ticket；`GET /api/decisions` 出现 `outcome:"ignore", reason:"system_actor"`，detail 原文：**`Actor demo-rule is a system actor and the rule Source may not originate work`**（点名 demo-rule）✓。triggers/decisions 各 +2（follow-up 的 Trigger **被产出后在门禁被拒**——与 C 对照）。

**负面路径 B（allowedSenders 去掉 demo-rule）**：PUT 后 `pv 32e78244ca055338`（rev 6）。投 `demo-4.md` → 上游 `0bcdc90d` done，无新 Ticket；decision `outcome:"ignore", reason:"sender_not_allowed"`，detail 原文：**`demo-rule is not on the allowed list`** ✓。

**负面路径 C（sources.rule.deny:true）**：PUT 后 `pv c092c15372f5be8f`（rev 7）。投 `demo-5.md` → 上游 `eed155a4` done，无新 Ticket；triggers **9→10**、decisions **9→10**（都只 +1，即上游自己那份），**没有任何 follow-up 的 Trigger 或 Decision** —— deny 在产出侧生效（`rule.ts:66` 的 `if (own.paused || own.deny) return`），与 A/B 的"产出后被门禁拒"确实不同 ✓。

**§4.4 policyVersion 随每个旋钮变化**（Defect A / S33 的活体复核）：`2092926d…`(默认) → `ca0575e8…`(acceptMode) → `c1e54e73…`(+cron/watchdog) → `a1b7b988…`(+rule) → `d665a83d…`(allowSystemActors 翻转) → `32e78244…`(allowedSenders 收紧) → `c092c153…`(deny)。七次设置七个不同指纹，settingsRevision 0→7 单调 ✓。

**顺手观察（不在验收范围）**：`deny:true` 时 `health["source:rule"]` 的 detail 仍是 `1 rule(s) watching how Tickets end`（rule.ts:106-113 的 summarize 只对 `!enabled` 换文案，不区分 paused/deny）。行为正确（确实什么都不产出），但健康板文案在 deny 下略有误导。

## 4b. P2 · 新健康语义（round 39 / round 43）—— **通过**（一个失败注入点只有离线覆盖，如实标注）

【实测】三段时间轴采样（全新宿主 state-00、闭环运行中、全部闭环结束后），`health` 的键集合与 detail 原文：

- **全新宿主（无任何工作）**：键为 `effects / passes / watchdog / runtime / source:cron / source:session / source:rule / source:chat / source:inbox`，**没有 `executor`，也没有 `delivery`**。detail 原文：`effects = "no effect failed in this pass"`，`runtime = "0 open Ticket(s), accept mode observe"`，`source:cron = "no schedule"`，`source:session = "the main Session takes requests"`，`source:rule = "no rules"`，`source:chat = "disabled"`。
- **round 39（删执行器仪表盘）**：三段采样里 `"executor" in health` 均为 **False** —— 无事时根本没有该条目 ✓。
- **round 43（quiet pass 自我清理）**：`effects.at` 逐 pass 前进而 detail 保持 QUIET 原文（实测三个样本：`19:39:12.278Z → 19:39:16.279Z → 19:39:22.284Z`，每个 pass 末尾 `summarize()` 调 `record(QUIET)`，effects.ts:163；而 `record` 是唯一的清理操作——health.ts:17-18 "the problem stays until this part records success again"）。清理有**双向诚实守卫**（effects.ts:150-163）：本 pass 有抱怨、或此前抱怨过的行仍在队列里（backoff 中），则不清——"a give-up settles its row, so the pass after it clears the board by itself and no permanent alarm survives"。被修掉的旧病在 effects.ts:126-131 注释里点名：`notify failed 2 of 5 times` 曾终身挂在板上（失败串的形状是 `${kind} failed ${next} of ${this.tries} times: ${error}`，effects.ts:193）。**判定：一条陈旧的 `notify failed N of 5 times` 在其行 settle 之后的第一个 quiet pass 就会被 `no effect failed in this pass` 覆盖，结构上无法存活**——清理写入每 pass 都发生【实测】；"失败→被清"的转变本身【推断，离线覆盖】：真宿主无故障开关造出 notify 失败（见 §9），`tests/notify.spec.ts` 钉住了该转变。
- **`health.delivery` 的实际语义（与任务书措辞有一处需要说清的差别）**：delivery **没有自己的 pass**，quiet pass 对它**刻意不作声**（delivery.ts:256-266：从一次什么都没投递的 pass 去总结，会把 "RESULT.md could not be written" 这类真问题无证据地抹掉；`tests/notify.spec.ts` 钉住它在后续 pass 里**留存**）。它的清理时机是**下一次干净完成的投递**：`summarize() → record('the last delivery went through')`（delivery.ts:268-271；round 43 之前没有任何代码调它，give-up 终身挂板）。【实测】本宿主上：全新时**无 delivery 键**（什么都没投递，什么都不声称）；第一次 notify 投递后出现 `{ok:true, detail:"the last delivery went through"}`，其 `at=19:37:15.806Z` 与最后一张完成 Ticket 的回报时刻吻合——每次成功投递都重写该行。**结论：`effects` 按任务书字面（quiet pass 自清）成立；`delivery` 按实现语义（下次成功投递即清、quiet pass 不作声）成立，且实现语义有成文理由与离线测试钉住。二者都不存在"陈旧告警终身挂板"的旧病。**

## 5. P3 · 迁移演练与全新安装 —— **通过**

【实测】`./scripts/verify-migration.sh`（默认目标：日常库的 `VACUUM INTO` 快照，线上文件全程只读）→ **退出码 0**，末行 `── 通过：可以升级线上库`。输出全文存 `/tmp/myagent-acc-full/migration.log`，关键行原文：

```
── 快照取自 ~/.dsh/state/myagent/myagent.sqlite3（只读）
   迁移前：triggers=11 tickets=9 decisions=11 kv=4 version=5  摘要=d11834d57cb5222e
── 迁移后：triggers=11 tickets=9 decisions=11 kv=4 version=5  摘要=d11834d57cb5222e
── 回滚演练：版本号改回 1 之后数据仍逐字节相同（摘要 d11834d57cb5222e）
   ✓ integrity_check ok   ✓ foreign_key_check 干净
```

迁移前后与回滚后摘要三次相同（`d11834d57cb5222e`）✓。注意日常库已在 version 5，本次演练证明的是阶梯在 v5 库上**幂等且数据零扰动**。

【实测】**全新安装**（本验收的隔离 stateDir，由当前产物从零建库）：`select version from schema_version` → **5**；`sqlite_master` 里恰好 **11 张表**：`artifacts, decisions, effects, events, kv, projects, schema_version, ticket_deps, tickets, triggers, works` ✓（对运行中的库以 `mode=ro` 只读查询，未扰动宿主）。

## 6. P4 · 闭环四（配方 §5）：Watchdog 救一个卡住的启动 —— **通过**（含 round 34 的 `escalated` 首次真宿主核验；另有两条顺手观察）

【实测】`PUT` 设置 `executor:{maxWorkers:1, prepare:"sleep 90"}`、`watchdog:{enabled:true, everyMs:10000, launchStuckMs:15000, maxActions:2}`，03:44:56 投 `demo-6.md`（验收-闭环四）。Ticket `a54c0b9c42c5cd5aba50c13828fac344`，时间轴（每 10s 采样 `/api/state`）：

| 时刻(UTC) | watchdog health | workerSlots.used |
|---|---|---|
| 19:45:06 | `{ok:true}`（无 detail） | **1** |
| 19:45:16.938 | `{ok:true, detail:"1 stuck launch(es) rescued"}` | **1** |
| 19:45:26.941 | 同上（第二次救援） | **1** |
| 19:45:36.944 | `{ok:false, detail:"Ticket a54c0b9c has not started after 2 attempts to rescue it; it needs a person"}` | **1** |
| 19:46:26.955 | 同上（最后一次看见 stuck 的 tick） | **1** |

事件日志全文（`GET …/events`，11 条，seq 连续）：

```
1  created   {kind:"person",id:"operator"}
2  rescued   {kind:"system",id:"watchdog"}  why="its worker never came up within 15s"   @19:45:16.938
3  rescued   {kind:"system",id:"watchdog"}  同上                                        @19:45:26.941
4-9 escalated {kind:"system",id:"watchdog"} why="has not started after 2 attempts to rescue it; it needs a person"（每 tick 一条，×6）
10 launched  {kind:"system"}               @19:46:31.542
11 report    {kind:"agent"} state=ready    @19:46:48.241
```

- 配方三项：health 出现 watchdog 条目且 detail 含 `stuck launch(es) rescued` ✓；事件日志有 `type:"rescued"`、`by:{kind:"system",id:"watchdog"}`、`detail.why` 说明原因 ✓；**`rescued` 在 `launched` 之前** ✓。
- **P4 追加项：升级到"需要人" + 耐久的 `escalated` 事件（round 34，此前从未真宿主核验）——【实测】成立**。健康板原文与事件 `why` 逐字相同（watchdog.ts:112-114 有意让"板与日志不可能漂移"）；`escalated` 事件写在 Ticket 自己的日志里（engine.ts:956-961），事件在 `launched` 之后依然在库，不会像健康板那样被覆盖。
- **round 33 的 N1/N3 复核点**：救援之后该 Ticket **仍然**被探测为 stuck（第二次救援与升级都发生在它身上——旧病是救援后从探测里消失、永远到不了 maxActions）；`workerSlots.used` 全程**恒为 1**（N3：不少计）；结束后回到 0。
- 诚实注记：`launched.startedAt = createdAt + 90.08s`，即 prepare 的 `sleep 90` 自己跑完的时刻——与 round 33 观察到的签名相同。这是本配方用 `prepare:"sleep 90"` 构造卡死的**预期形状**：救援的语义是"forget them and queue them again"（watchdog.ts:101），它不杀 prepare 进程；round 33 的错判是把这一刻当成"救援的成果"，本轮的判定依据是事件序列与升级路径，它们独立于这个时刻成立。

**顺手观察一（不在验收范围）**：`escalated` 事件每 tick 追加一条（10s 一条，本例 6 条），`watchdogEscalated` 无去重。文字相同、语义是"仍然需要人"的心跳，不算撒谎，但长卡死会让日志膨胀。

**顺手观察二（建议跟进）**：Ticket 于 19:46:48 done 之后，watchdog 的 `ok:false` 行**仍挂在健康板上**（03:48 复查原文未变，`at` 冻结在 19:46:26.955）。`Watchdog.look()` 只在"救援成功"时 `record`，无事可做的 tick 什么都不写——于是"需要人"这行在它描述的事态已经自行解决后依然红着，直到下一次不相关的成功救援才被覆盖。这正是 round 43 在 effects/delivery 上消灭的"陈旧告警"模式在 watchdog 条目上的同类残留【实测】。影响：面板会显示一条已经过时的红色告警；数据与事件日志无影响。

## 7. P4 · 闭环五（配方 §6）：按来源暂停是无损的 —— **通过**

【实测】与配方的一处**顺序偏差**（记录）：配方先投文件再暂停；但 `touch -t -10s` 之后文件立刻过了静置窗口，而扫描周期约 1s——照字面顺序执行会和扫描赛跑，可能文件先被受理、暂停没验到。本轮**先 `PUT paused:true`，再投 `demo-pause.md`**，验的是同一个性质（暂停期间产不出任何东西）。

- 暂停中（8 秒，≥4 个扫描周期）：`demo-pause.md` **还在 inbox**（334 B，mtime 03:50:08 即投料时刻，**一字节没动**）；`rejected/` **不存在**；triggers **11→11**、decisions **11→11**（零增长）✓
- `policyVersion` 在暂停 PUT 后为 `ca0575e85c402fef` —— **与本轮最早那次 acceptMode:auto 的值逐字符相同**。暂停不是授权内容，不动指纹；且同一授权状态在相隔 35 分钟的两次 PUT 后得到同一指纹——policyVersion 是授权内容的纯函数，这本身就是一条有价值的实测。
- 解除暂停（03:50:35）后 8 秒内：Ticket `aa72a6bff98d16fc64f9f05dbd5b97fc`（验收-暂停期间）出现并 running；triggers/decisions 各 +1（12/12）；归档为 `accepted/f2e2c0feadc11e582d2ff7f0dc7e7c05-demo-pause.md`（`<triggerId>-原名`，纯函数、无时间戳），首行 `<!-- myagent: Ticket aa72a6bff98d16fc64f9f05dbd5b97fc -->` ✓
- 该 Ticket 随后 `done`（ended 19:51:00.740Z，outcome done），`paused.txt` 在盘、登记 artifacts `["paused.txt"]`；`accepted/` 里含 pause 的归档**恰好 1 份**（无重复受理）✓
- 对照 S9 的旧病（暂停=永久丢弃：文件进 rejected/、Trigger 存成 ignored、重投撞重复短路）：**未出现任何一项**。暂停期间被留住的就是被留住的，解除后照常受理且只受理一次。
- 附带确认：本次 PUT（无 executor 段）已把 `executor.prepare:"sleep 90"` 复位——解除暂停的 Ticket 从创建到 done 只用了 ~25s，而不是 90s+。

## 8. P5 · 闭环 6b（chat）抽检 —— **通过**（按任务书只做抽检；完整闭环属第 38 轮，不重跑）

【实测】任务书三项抽检全过，另顺手看到第 38 轮的形状仍在（因为那张 Ticket 本来就要跑完）：

1. **设置块解析**：`PUT` chat 配置（`identities {U01ACC01 → acc-alice}`、channel `room-a` 指向隔离 stateDir、`pollMs 1000`）→ 200，回显完整；`chat.policy = {enabled:true, acceptMode:"auto", allowedSenders:["operator","acc-alice"]}`；`health["source:chat"].detail = "1 channel(s)"`。**`policyVersion` = `ad064036620e3f9f` —— 与第 38 轮验收实测的首个值逐字符相同**：同一授权内容在两次验收、不同 stateDir 里得到同一指纹，policyVersion 的纯函数性再添一条跨轮实测。
2. **映射消息 → Ticket**：投 `from: U01ACC01, id: msg-acc-9, thread: t-acc-9` 的消息 → Ticket `4cf54764332474aafa213b54966af28b`，`mandate.sender = {id:"acc-alice", kind:"person"}`（**映射后的 actor，不是平台 id**），`mandate.via = "chat"`，`replyTo = {kind:"chat", channel:"room-a", thread:"t-acc-9"}` ✓。归档 `accepted/1420e2de4a1317a5502b02bc06a2b26f-acc-mapped.md` 与 origin.triggerId 逐字符一致（纯函数名）。完成后 `chat.txt` 在盘；**回复文件** `out/reply-c804feab….md` 出现，前置字段带回 `thread: t-acc-9`，正文即报告 summary 原文；`counts.sends` 从 `{queued:0,…}` 变 `{queued:1, nowhere:10}` ✓。
3. **未映射：留住而非拒绝**：投 `from: U09NOBODY` 的消息 → triggers/decisions **零增长**（13→13），文件原地未动（119 B，mtime 未变），`chat.waiting = {count:1, ids:["U09NOBODY"]}`，健康行原文与配方逐字符一致：**`1 message(s) from unmapped identities are waiting (U09NOBODY); add each id to sources.chat.identities, or remove the file`** ✓。

（未按配方 §6b.2 第 5–6 步补映射、验证同消息二次受理与 40s 无重复——那是第 38 轮已证明的部份，任务书明确不重跑。）

## 8b. P2 · Project / Work 表面（P6 时代落地，从未真宿主核验）—— **通过**

【实测】API 层的"能建、能看、能归类"：

- `POST /api/projects {name:"验收项目", note:…}` → 200 `{id, name, createdAt, note}`
- `POST /api/works {name:"验收工作", projectId:…}` → 200，归属正确
- `POST /api/tickets/:id/work {workId}` 两张（闭环一、闭环五）→ 200
- `GET /api/works/:id` → work + tickets 列表，`workSeq` 分别为 **1、2**、按其升序 ✓（面板"按 workSeq 排序"的数据来源实测在位）
- `GET /api/projects/:id` → project + works ✓

依赖图两条路由（`dependencies` GET/POST）在闭环一上返回空集合（§2b）；依赖等待与级联取消不在本验收范围（配方 §10 自认未覆盖）。

## 9. 如实记录：本轮**测不了**的东西（不装作测过）

1. **丢失的请求（lost Trigger / `notice_lost` / `reply_lost`）的失败路径**：在真宿主上**造不出来**。每一条都需要某个 effect 连续失败 5 次（effects.ts:88 `tries=5`，退避 15s/30s/60s…）；离线靠故障注入桩（`StubOptions.notify` 让 notify 失败；trigger 那半用不可解析的 payload，见 `docs/v2/17-fault-injection.md`），**真宿主没有对应开关**。本轮实测的是**路由与表面**：`GET /api/lost` 200、形状 `{total:0, shown:0, rows:[], payloads:[], bounds:{keep:20, chars:1000}}`（bounds 来自执行它的那个构建本身，http.ts:575-577 有成文理由）；`counts.lost {rows:0, payloads:0}` 在 state 里全程在位且为零。**失败路径只有离线覆盖**【推断】。
2. **S39（跨构建的 policyVersion 漂移）**：需要**两个不同的构建**——旧 bundle 写的 Mandate 在新 bundle 下指纹不再匹配。本验收的纪律是产物冻结（任务书明令不得重建），单构建内**原理上无法测**。**未测**。要测需要：同一 stateDir/设置分别在两个 policy 哈希不同的构建下起宿主，验证在跑 Ticket 的 Mandate 失配被察觉（policyChanged 路径）且 `settingsRevision` 不动。
3. **面板在真浏览器里的行为**：本代理**没有浏览器**。本轮把面板消费的每个数据源都在 API 层实测过（state / tickets / events / dependencies / projects / works / schedules / lost / health / progress / files / file），**渲染一概不作声称**。前科在案：一个 CSS 特异性 bug（`.hidden` 输给 ID 选择器）活过了 172 条 jsdom 断言，只有人眼看着页面才被发现——面板仍需一次人眼验收。
4. 其余沿用配方 §10 的自认清单：Watchdog 静默 worker 探测器（`silentMs`，默认关）未驱动；`myagent_note_ticket` / `myagent_read_artifact` 协作通道未覆盖（需两个并发 worker）；依赖等待与级联取消未演示（只测了空依赖集合）；预算无上限故无可验。

## 10. 收尾（配方 §8）与总判定

【实测】收尾序列（03:56–03:57）：

- `SIGTERM` 停宿主（pid 84285）→ 3 秒内退出。**3180 无监听**（lsof 0 行）；`myagent.lock` 不存在；`-wal` / `-shm` 均不在（WAL 已 checkpoint 并删除）；隔离库 `schema_version = 5`（immutable 只读查询）。
- **停止后无写入（S32 生产版，配方 §8.2 的历史欠账，本轮做完）**：T0（03:56:13）`sha256 = 4c26f61e1d57729b10294cd2cc6c7aa88845ade1820098bb65dbf6efad5767b5`，188416 B，mtime 03:56:10；**T0+62s 三项逐一相同**；`wal|shm|lock` 无重现。**判定：通过**——"停止后是否还有写入"自此有实测答案：没有。
- **日常宿主全程未受影响**：日常库 sha256 前后同为 `a793caacbbcb2e1d5f96608305878340c52f5c31d7f031e05a4c4df628a987f5`、167936 B；3080 监听 pid 前后同为 **24619**；全程只对 3080 做过零次写请求（本轮实际连只读请求都未发）。日常库 `schema_version` 为 **5**——配方 §8.3 写的"仍是 1"是陈旧文字，顺手修正记录。
- **冻结产物前后一致**：`lib/index.js` sha256 `768a6adb…c7c3e2`、320163 B；`panel/index.html` `2fdbfcad0f440318`、128775 B；`find -newer` 为空。开始与结束两次采样逐字符相同。
- 宿主退出状态：以 SIGTERM 干净退出（nohup 脱离进程，**数字退出码未被捕获**——如实记录；干净退出的四个可观测标志全在：锁释放、WAL checkpoint、端口释放、日志零错误）。`host.log` 全程仅 1 行（ready 行），error/fatal/exception 计数 **0**。

### 总判定表

| 优先级 | 场景 | 判定 |
|---|---|---|
| P1 | 闭环一：inbox → done（产物、事件、归档、主 Session） | **通过** |
| P1 | 闭环二：排期自己触发（含游标指纹） | **通过**（配方 sender 文字过时） |
| P1 | 闭环三：规则来源 + 三条负面路径 + policyVersion | **通过** |
| P2 | state/lost/projects/works/events/dependencies 新表面 | **通过**（`tickets/:id/artifacts` 按字面 404：该路由不存在，产物内嵌于详情——记录在 §2b） |
| P2 | 健康语义（round 39/43） | **通过**（delivery 的"quiet pass"实为"下次成功投递"，有成文理由与离线钉住；失败注入转变仅离线覆盖） |
| P3 | 迁移演练 + 全新安装 v5/11 表 | **通过** |
| P4 | 闭环四：Watchdog 救援 + **首次实测 `escalated` 耐久事件** | **通过**（两条顺手观察见 §6） |
| P4 | 闭环五：暂停无损 | **通过**（顺序偏差已记录） |
| P5 | chat 抽检三项 | **通过**（不重跑全环，按任务书） |
| P6 | 收尾：停止后 60s 无写入 | **通过**（配方 §8.2 欠账清掉） |
| — | lost 失败路径 / S39 / 真浏览器面板 | **未得证**（原理上测不了，见 §9） |

**结论：在冻结产物 `768a6adb…` 上，六个闭环全部真宿主复验通过；自上次 FULL 验收以来的新表面（state 字段、lost 路由、Project/Work、新健康语义）实测在位；无证伪项。** 遗留跟进（非阻塞）：①watchdog 健康行在事态自行解决后不自清（§6 观察二）；②`escalated` 每 tick 追加一条（§6 观察一）；③rule 来源 deny 时健康文案不区分（§4）；④配方三处陈旧文字（§3 sender、§3 preview 的 GET、§8.3 日常库版本号）；⑤面板欠一次人眼浏览器验收。

