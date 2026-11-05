# 02b 真宿主验收（V2 增量）——补遗与更正

针对 `docs/v2/02-live-acceptance-v2.md`（重建稿）。作者：执行该轮验收的子代理。
本轮验收跑的产物是 `lib/index.js` sha256 `f6b29adc453f87aa3de9de6e6ab48ceba79c0ded9644f7731247778cce52ad8a`。

**证据分级**（每条都标注）：

- **【残件】** = 写在 `/tmp/myagent-acceptance-v2/` 或隔离库里的文件，可复核。
- **【转录】** = 只出现在我当时的工具输出里、**没有落盘**。我能逐字引用，但你无法独立复核。
- **【记忆】** = 既无残件也无逐字记录，只是我记得。**不应作为结论依据。**

**一个必须先说的时效问题**：你在来信里指出 `src/` 在我这轮之后已经变了（`events` 路由、受理时归类 Work、
worker 提示词分层上下文、sync 闩、`signatureOf` 修复）。所以本文里**一切线上结论只适用于 `f6b29adc` 这个产物**，
不适用于当前 `src/`。特别是 §5 里那批 404 探测：其中 `GET /api/tickets/:id/events` 当时返回 404，
而你说现在已经有 `events` 路由了——那条探测已经过期，不要引用。

---

## 1. `assignment_stale`：不是"证据丢失"，是**从未尝试**

重建稿 §6 写"证据已丢失"。这个措辞不准确，会让人以为我驱动过它然后丢了记录。

**事实**：我从未制造出"被取代的尝试迟到汇报"这个情形，所以从未观测到 `assignment_stale` 被抛出。

- **【残件】** `grep -rl assignment_stale /tmp/myagent-acceptance-v2/` 只命中 `lib-fresh/index.js` 与
  `lib-fresh/index.d.ts`（打包进去的字符串），**没有任何响应、Ticket JSON 或会话日志里出现过它**。
- **【转录】** 任务书第 6 项要求的是：驱动一个 `waiting` 报告 → `POST retry` → 确认第二个 Assignment 出现并运行
  → 检查是否有工具错误到达 worker。这四步里没有任何一步会产生"旧尝试的迟到报告"。
  `retryTicket` 先结束旧尝试再开新尝试，而新尝试是**顺序**恢复同一个 Session：
  `item6-worker.jsonl` 的 turn 号是 `[1, 2]`，从不并发，所以旧 turn 没有机会在新尝试运行期间汇报。

**我确实得证的（正面一半）**：**【残件】** `item6-ticket.json` 里两个尝试各自保有自己的报告——
`0b1956c4…` `state:ended, report:"waiting"`，`b307a501…` `state:ended, report:"ready"`。
报告没有串到别的尝试上。这是"身份被保留"，**不是**"迟到报告被拒"。

**建议措辞**：`assignment_stale` 被抛出这一面 —— **本轮未驱动，仅有离线覆盖**（S11 的两条，经变异检验）。

---

## 2. 三条负面规则路径的 Decision：残件里有全文

重建稿 §9 说"三条各自的 Decision 详情与拒绝措辞证据已丢失"。**没有丢失**，全在 `item9-negatives.json` 里。
以下逐字引自该文件（**【残件】**），三条的 `disposition.state` 都是 `ignored`：

| 场景 | Trigger | Trigger `at` | Decision id | Decision `at` | `outcome` | `reason` | `detail` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `allowSystemActors=false` | `8874b016a8a1de9e29c01ead0788d616` | `2026-11-03T18:58:06.097Z` | `49911f9bcb65687c69a0d22f14537551` | `2026-11-03T18:58:06.125Z` | `ignore` | `system_actor` | `Actor digest-done is a system actor and the rule Source may not originate work` |
| 规则 id 不在 `allowedSenders` | `ee302cc11bc113a8775ef87c1379bd61` | `2026-11-03T18:58:33.326Z` | `e8d494619f48249ab7565b5a7304aa92` | `2026-11-03T18:58:33.353Z` | `ignore` | `sender_not_allowed` | `digest-done is not on the allowed list` |
| `sources.rule.deny=true` | `88bc7d69ecad2f7b293bd48f4abb0c07` | `2026-11-03T18:58:56.497Z` | `2b482c489ceedaa72c9a3299218bafe4` | `2026-11-03T18:58:56.520Z` | `ignore` | `source_disabled` | `The rule Source is denied` |

要点：

- 你要求的"denied 的规则来源，其拒绝措辞必须点名 rule 而不是 session"——**得证**：`The rule Source is denied`。
  三条 detail 里都没有出现 `session`。
- 三条的 `actor` 都是 `{"id":"digest-done","kind":"system"}`，`decision.triggerId` 与 Trigger id 一一对应。
- 三条上游 Ticket（`4b7f6bb0…`、`973de3d0…`、`611d3966…`）都以 `done` 结束、`result` 完整，即**上游没有被消耗**。
- **【残件】** 三条都在 20ms 轮询里抓到了效果队列：`{"notify":1,"trigger":1}`
  （分别在 `02:58:06.113`、`02:58:33.347`、`02:58:56.511`）。这是 `trigger` 效果**确实被入队**的直接证据，
  三条负面路径都有。正面路径那次我用的是 120ms 轮询，**没抓到**（只看到 `{"launch":1}`），
  所以正面的入队证据是间接的：Trigger `at` 18:52:25.567 与 Decision/mandate `at` 18:52:25.592 相差 25ms。

---

## 3. 停止后是否仍有写入：T0+60s 那次采样**没做**；另有一次更晚的真采样

** plainly 说**：我没有做 T0+60s 的第二次采样。我在 03:15:58 记下 T0 基线（`poststop.txt`），
之后转去查文档体例，然后这一轮就结束了。重建稿 §11 写"未得证"是对的。

我**没有**去伪造或倒填那次采样。但我刚才（写本文时）取了一次真实采样，它的时间窗**严格长于**你要的 60 秒，
所以附上，并明确标注它不是 T0+60s：

**【残件】** 采样时刻 `2026-11-04 04:42:17`（≈T0+86 分钟）：

```
~/.dsh/state/myagent-acceptance/myagent.sqlite3|size=311296|mtime=1793733304 (2026-11-04 03:15:04)
3325f896c29070003f8efa7ca0b33e66cac95ccf48ea9f76b7a951488ca6fd3b
T0（03:15:58）：size=311296  mtime=1793733304  sha=3325f896c29070003f8efa7ca0b33e66cac95ccf48ea9f76b7a951488ca6fd3b
-wal / -shm / lock：none
```

size、mtime、sha256 三项与 T0 **完全相同**，且没有 `-wal`/`-shm`/`lock` 重新出现。
所以在 `03:15:58 → 04:42:17` 这个窗口里，**没有任何写入到达该数据库文件**。

这条能支持与不能支持的：

- 支持："停止后无写入"在这个 86 分钟窗口内成立。
- **不**支持 S32 已结案。S32 是测试拆解期定时器在 Store 关闭后触发；我这次只证明**产物文件没被写**，
  没有证明那个定时器没有触发过（它可能触发了但因 Store 已关而抛错，一个字节都没写）。两者是不同的命题。

**停止过程本身的证据**：**【转录】** SIGTERM 发给 pid 11915（`03:15:04`），进程 1 秒内消失；
`lsof -nP -iTCP:3180 -sTCP:LISTEN` 为空；`myagent.lock` 不存在（即 `runtime.stop()` 跑过了）；
`-wal`（停止前 3,848,112 字节）与 `-shm` 都被 checkpoint 进主库并删除（主库 86,016 → 311,296 字节）。
`pgrep -fl 'sleep 90'` 与 `pgrep -fl myagent-test` 均为空，无残留进程。
**注意**：主库文件在整个运行期间的 sha 一直是 `c1056a0d…`（与启动前相同），所有写入都在 `-wal` 里——
所以"运行中主库没变"不是"没写"，是 WAL 的正常行为。

---

## 4. 我验过但**没有残件**的东西（你最想要的部分）

以下都是 **【转录】**：我能逐字引用，但没落盘，你无法独立复核。按价值排序。

### 4.1 陈旧产物这个阻塞项的完整测量（最重要）

任务书的前提"`lib/index.js` 是从当前源码构建的"是**假的**。我测到的：

- 陈旧 `lib/index.js`：202,389 B，sha256 `08de8f1e34780e88536b10ddac63569f69d6fd3e5ec12ddbd6a7805de9411e2e`，
  mtime `2026-11-03 18:20:21`；`find src -name '*.ts' -newer lib/index.js` 命中 **20 个文件**，
  最新的是 `src/sources/rule.ts` @ `2026-11-04 01:49:19`（比产物晚约 7.5 小时）。
- `grep -c` 在陈旧产物里对下列 token **全部为 0**：`allowSystemActors`、`RuleSource`、`maxDepth`、`rescued`、
  `launchStuckMs`、`silentMs`、`stuckLaunches`、`artifacts`、`workId`、`workSeq`、`ticket_deps`、`projects`、
  `dependOn`、`collaboration_refused`、`noteFromWorker`、`sourcePolicy`、`watchdog`。
  （对照组：`works` 4、`events` 14、`myagent_note_ticket` 1 —— 证明 grep 本身是有效的。）
- 陈旧产物建的表：`schema_version, triggers, tickets, decisions, effects, **settings**, kv`
  —— **仍在建那张该被删的死表 `settings`**，且没有 `artifacts/projects/works/events/ticket_deps`。
- 陈旧产物盖的版本号是 **1**：`lib/index.js:3808` 是 `.run(1)`；而 `src/app/store.ts:19` 是 `SCHEMA_VERSION = 5`。
- 我独立把当前源码构建到 `/tmp`（`tsdown --out-dir`，构建前后 `lib/index.js` 的 sha 逐字相同，证明没碰它）：
  251,469 B，11 张表、无 `settings`、`.run(5)`，上述 token 全部出现
  （`watchdog` 20、`artifacts` 15、`workId` 21、`allowSystemActors` 5、`RuleSource` 2）。
  **【残件】** 这份产物还在：`/tmp/myagent-acceptance-v2/lib-fresh/index.js`，
  sha256 `6273800deeabe8fd835236b2f8b6d683ed820d64f8c78e8183f337efff0f38d0` ——
  与你在 02:27 那次重建**逐字节相同**（我的是 02:10 建的）。两次独立构建同源码得到同哈希，这是个有用的交叉验证。

### 4.2 修复前后 `policyVersion` 的对照测量

**【残件】** 脚本在 `/tmp/myagent-acceptance-v2/policyver.mjs`（直接 import `src/core/policy.ts`）。
**【转录】** 输出没落盘：

- **修复前**（Defect A 仍在）：rule 的五个旋钮 `plain / allowSystemActors=true / deny=true / acceptMode=observe /
  allowedSenders=[nobody]` 全部得到 **同一个** `29663dc7df4b8496`；对照组 inbox 的 `deny=true` → `1bb30471aec2198d`、
  `allowSystemActors=true` → `bd16d7fcb2cf3a47`（都变）。
- **修复前**（Defect B 仍在）：`gate()` 对 rule Trigger，`rule.enabled=true, session.enabled=FALSE` →
  `allow:false, reason:"source_disabled", detail:"The rule Source is not enabled"`；
  而 `rule.enabled=FALSE, session.enabled=true` → `allow:true`（门禁不拒）。
- **修复后**（`f6b29adc`）：五个旋钮 → `1dc8374ca79f6321 / 881b1d56185b2cff / 1a2e394412e8be4e /
  6777bd817880e1c2 / af7c761e03d3d1be`（全不同）；`session.enabled=FALSE` → `allow:true`；
  `rule.enabled=FALSE` → `detail:"The rule Source is not enabled"`（点名正确）。

> 这些是**离线**测量（直接跑 `src/`），不是线上。线上的那五个值见 `item9-policyversions.json`【残件】。

### 4.3 items 3/5 的 404 路由探测（**已部分过期，见开头**）

**【转录】** 对 `f6b29adc` 逐个 GET，全部 404，响应体形如 `{"error":"No route for GET /myagent/api/projects"}`：
`/api/projects`、`/api/works`、`/api/tickets/<id>/dependencies`、`/api/tickets/<id>/events`、
`/api/tickets/<id>/artifacts`、`/api/artifacts`、`/api/dependencies`、`/api/events`。
（`probe.json` 只留住了最后一次，48 字节。）
其中 `/api/tickets/:id/events` 这一条**现在已过期**，你后来加了 `events` 路由。
其余的我无法替你确认现状。

**注意**：`artifacts` 虽然没有独立路由，但它**内嵌在** `GET /api/tickets/:id` 里（`http.ts` 的该路由返回
`{...ticketView(...), artifacts: host.artifacts(id)}`），这条我线上得证了（见 §2 产物登记）。

### 4.4 `verify-migration.sh` 的 WAL 缺陷根因证明

**【残件】** `wal-repro/`、`wal-repro2/` 目录与三份输出（`verify-migration.txt`、`-literal.txt`、`-fixed.txt`）都在。
**【转录】** 根因证明没落盘：文件头第 18–19 字节 `xxd -s 18 -l 2` = `0202`（WAL）；
`sqlite3 "file:…?mode=ro"` → `Parse error … unable to open database file (14)`，退出 1；
`sqlite3 "file:…?mode=ro&immutable=1"` → 正常返回 `version=1`，退出 0；
普通打开（无 URI）→ 退出 0 **并顺手造出 `-shm`/`-wal`**。
干净的 A/B：同一份 `cp` 出来的副本，无兄弟文件时退出 1；一次普通打开造出 `-shm` 后退出 0。
`sqlite3 --version` = `3.54.0 2026-04-09 12:25:13 8fa8248e303219400c646a885e36dfc52eae33d83f4412e3f369b2be5373aapl (64-bit)`。
**副作用披露**：我那次"普通打开"的诊断在**隔离** stateDir 里造出了 `-wal`/`-shm`（该目录允许我写）；
主库文件 sha 前后都是 `c1056a0d…`，未变。

### 4.5 挂载时 cron 补触发（一个没人要求但值得记的线上事实）

**【转录】** 宿主 02:40:19 启动后，`GET /api/state` 立刻显示 `counts.open:1`、`triggers:6`、`decisions:6`
（库里原本 5/5），`sources.cron.lastTriggerAt = "2026-11-03T15:45:00.000Z"`。
即上一轮留下的 `accept-cron`（daily 23:45 Asia/Shanghai）在挂载时**补触发了一个迟到约 3 小时的槽位**，
造出 Ticket `7d81aadc33c8e67ec5a9fb2d12f3808f` 并跑到 `done`（`ended.at = 2026-11-03T18:40:57.103Z`），
然后重新武装到 `next = 1793807100000`（= 11-04 23:45 本地）。
**【残件】** 这张 Ticket 的完整视图在 `cron-ticket.json`。
这张票顺带成了产物登记的**第二个线上样本**：worker 报 `files:["cron-result.txt"]`（相对路径），
`artifacts` 恰好一条 `path:"cron-result.txt"`，`notes:[]`。

### 4.6 主 Session 是"按需恢复"而不是"挂载时偷建"

**【残件】** `state-mount.json`（02:40）：`mainSession = {exists:false, running:false, busy:false, id:"myagent-acc-main"}`；
`state-final.json`（03:14）：`{exists:true, running:true, …}`。
**【转录】** 但 `~/.dsh/sessions/--Users-alice-.dsh-state-myagent-acceptance-work--/myagent-acc-main/` 的目录 mtime 是
`11月 3 18:04`，即**上一轮**建的。所以准确说法是：本轮挂载时没建、也没加载；运行中按需**恢复**了它。
`kv` 里始终没有 `main-session:id`（键只有 `prompts:config`、`prompts:revision`、`settings:document`、
`settings:revision`、`source:cron:cursor`），所以 id 来自配置而非库。
`verify-live.sh` 第 3 步因此通过（挂载期没偷建 Session）。

### 4.7 上一轮 B4 的原始现场（对照用）

**【转录】** `/tmp/myagent-acceptance/worker3.jsonl` 里 `tool/result` seq 27 与 seq 32 都是
`isError:true`，文本 `Error: tool "myagent_report" returned invalid output: value is not lossless JSON`；
同文件里 `ToolOutputError` 出现 2 次、`lossless` 4 次、`INVALID_TOOL_OUTPUT` 2 次（这三个计数**【残件】**可复核，
文件是上一轮留下的）。而本轮 `item6-worker.jsonl` 里 seq 27 是那个 `waiting` 报告的**成功**结果
（`{"ticket_id":"4ac8bdb8…","state":"waiting","stage":"waiting","ended":false…}`，`isError:false`）——
**同一个位置、同一个 seq 号，从报错变成了干净返回**。这是 B4/S25 修复最直接的对照。

---

## 5. 你记录里缺的缺陷

你记了 S32、S33、S34、产物陈旧。我这边还有 **7 条你没记的（N1–N7）**，其中 N1 我认为最严重。
全部针对 `f6b29adc`；`src/` 已变，请先核对是否仍然存在。

> **写本文时的现状核对（只读，未起宿主）**：`lib/index.js` 又变了 —— 现在是 256,585 B、
> sha256 `cdad7f8c803e8702a9e33f0968535848636b25e2e6a61d27600293e4cf2bea74`、mtime `2026-11-04 04:42`，
> **不是**本文所pin的 `f6b29adc`。就当前 `src/` 只读检查：**N1 的机制仍在**
> （`effects.ts:84` 仍是 `if (this.disposed || this.running !== undefined) return`；
> `executor.ts:152-155` 的 `rescueStuckLaunch` 仍是 `starting.delete` + 同 key 重新入队）；
> **N2 的机制仍在**（`saveSettings` 里 `watchdog` 出现 0 次，`watchdog.start()` 仍只在挂载时调一次，`runtime.ts:525`）。
> 这是**读代码**得出的，不是线上验证 —— 我没有起宿主，也不该起。

### N1（**高**）Watchdog 的救援在真宿主里**是空操作**，`maxActions`/"需要人"这条路径**不可达**

这不是"没跑到"，是**跑不到**。证据链（Ticket `ce1a9d7603b04d220f57dbaedfcefd0e`，
`prepare='sleep 90'`、`launchStuckMs=15000`、`everyMs=10000`、`maxActions=2`）：

- **【残件】** `item7-evidence.json`：`rescued` 只有一条（seq 2 @ `2026-11-03T19:08:21.474Z`，
  `by={kind:system,id:watchdog}`，`why="its worker never came up within 15s"`），**`needs_person: null`**，
  健康板从头到尾 `ok:true`（先是 `{ok:true}`，后是 `{ok:true, detail:"1 stuck launch(es) rescued"}`）。
- **【残件】** 全库只有一条 `rescued` 事件（`select … from events where type='rescued'`）。
- **【残件】** `item7-worker.jsonl`：**只有一个 turn（`turns=[1]`）、只有 1 个 `tool/result`**。
  如果救援真的重新启动了 worker，同一个 Session 会收到第二份任务文本、出现第二个 turn。没有。
- **【残件】** 该 Ticket 唯一的尝试 `ac3460a1…`：`createdAt 19:07:28.350Z`、`startedAt 19:08:58.432Z`
  —— 相差 **90.08 秒**，正是那条 `sleep 90` 自己睡完的时刻。事件序列 `created(19:07:28.351) →
  rescued(19:08:21.474) → launched(19:08:58.432) → report(19:09:12.431)`。
  **所以让它启动的是原来那次 launch 自己睡醒了，不是救援。**

机制（读 `f6b29adc` 对应的 `src/` 得出，**【转录】**）：
`Effects.runDue()` 开头是 `if (this.disposed || this.running !== undefined) return` —— 一次只允许一个 pass；
而**正在飞的那个 pass 就是这次 launch**，它卡在 `await prepareDirectory(...)`（prepare 上限 `PREPARE_LIMIT_MS = 10 分钟`）。
`rescueStuckLaunch` 做的是 `this.starting.delete(ticketId)` + 用**同一个 key** 重新入队；
入队 SQL 确实会把 `running` 重置为 0（`enqueueEffect` 的 `ON CONFLICT … DO UPDATE SET … running = 0`），
但**这一行要等被阻塞的那个 pass 结束才可能被 claim**。与此同时 `starting.delete` 把它从
`stuckLaunches()` 的视野里移走了 —— 于是**第二次救援永远不会被检测到**，`actionsTaken` 停在 1，
`maxActions=2` 永远达不到，"需要人"那行健康问题永远不会出现。而健康板写的是 `ok:true, "1 stuck launch(es) rescued"`，
即**在 Ticket 仍然卡着的时候报告自己健康**。

为什么离线测试看不见：§4.13 的 4 条与 §4.16 的 4 条 Watchdog 测试都是直接调 `Watchdog.look()`
配假执行器（`watchdog.ts` 的注释自己写了"directly by a test that does not want to wait for one"），
既没有真的在飞的 prepare，也没有被串行化的效果泵。**这正是"离线绿灯证明不了"的那一类。**

### N2（中）改 `watchdog.everyMs` **不会重新武装**已在跑的定时器

- **【转录】** Watchdog 在挂载时（`18:40:21`）用 `everyMs=60000` 武装。我在 `19:07:27` 把它改成 `10000`。
  救援发生在 **`19:08:21.474`** —— 正好落在**改动前**那条 60 秒网格上（`18:41:21 + n×60s`）。
  从 Ticket 创建（`19:07:28.351`）到被救（`19:08:21.474`）是 **53.1 秒**，而阈值是 15 秒。
- 机制：`saveSettings`（`runtime.ts:384-395`）只调 `sources.sync()` 与 `passes.requestPass()`，**从不碰 watchdog**；
  `Watchdog.arm()` 只在**重新武装时**读设置（`watchdog.ts:133-145`）；`watchdog.start()` 只在挂载时调一次（`runtime.ts:525`）。
- 后果：把 `everyMs` 调**小**在旧定时器到期前完全无效。默认 60s 还好；若操作者从一个大值（上限 3,600,000ms = 1 小时）
  调到 10s，最坏要等一小时。反向（调大）也要等当前这个短的到期。
- 重建稿 §7 只写了"`launchStuckMs` 设为 15s"和 `t+55.8s`，没解释这 53 秒 —— 读者会以为探测器无理由地慢。

### N3（中）救援后 `workerSlots.used` **少算**，槽位在真有活的时候报成空闲

- **【残件】** `item7-evidence.json` 的 `procs` 只记变化点：`[[1.5, 1], [92.0, 0]]` ——
  即从 t+1.5s 到 t+92.0s **一直有一个 `sleep 90` 进程在跑**。
- **【转录】** 同一时间窗内（t+55.8s 到 t+89.4s 的每一个采样点）`GET /api/state` 报的是
  `workerSlots: {"used": 0, "max": 1}`，而 Ticket 仍是 `pending`。
- 机制：`rescueStuckLaunch` 删了 `starting` 里的条目，但原来那次 `launch()` 仍在 `await` prepare；
  `used()` 数的是"运行中的 Session + `starting.keys()`"，于是这份**真在跑的活变得不可见**。
- 后果：此时另一张 Ticket 可以被启动，`maxWorkers` 在真实资源意义上被突破；面板也会说"有空槽"而其实没有。
  我**没有**专门复现"第二张票因此并发启动"，所以这半句是机制推论，不是观测。

### N4（中）**规则来源的 deny/pause 是有损的**，与 cron/inbox 不同——重建稿把它当成了优点

重建稿 §9 写"来源照跑、门禁拒绝，而不是什么都没了——请求没有丢失"。前半句对，**结论错**：

- `RuleSource.onEnded` 只检查 `enabled`（`src/sources/rule.ts:51`），**从不检查 `deny` 或 `paused`**；
  而 cron（`src/sources/cron.ts:163`）与 inbox（`src/sources/inbox.ts:172`）都是 `if (own.paused || own.deny) return/continue`
  —— 即那两个来源在**产出侧**拦住，什么都不产出。
- 所以规则来源的 deny 走的是**门禁拒绝**路径：Trigger 被产出、被拒、存成 `ignored`
  （**【残件】** §2 表里那条 `88bc7d69…` / `source_disabled` / `The rule Source is denied` 就是）。
- 而规则 Trigger 的 id 是 `key('rule', 规则id, ticketId, ended.at)` —— **那次结束的纯函数**。
  存成 `ignored` 之后永远不会被重新评估，而那次结束也不可能再来一次。
  **所以解除 deny 不会让这条链复活**：deny 期间本该开始的链是**永久丢失**的，只留一条 `ignored` Decision。
- 这恰恰是 S9 与 §4.12/§4.14 反复强调 deny 必须避免的性质（cron 保住游标、inbox 保住文件，所以解除后能从原处继续）。
  对比证据：**【残件】** `item8-summary.json` + 隔离 inbox 目录 —— inbox 的 deny/pause 期间文件原地不动、
  零 Trigger 零 Decision，解除后被受理并归档为 `accepted/f1b4289706daf86d60d2bb49f591e8ca-v2-inbox-deny.md`
  （注解 `<!-- myagent: Ticket 4d02911c051e53677ac4d863a5b1dea2 -->`）。同一个 `deny` 旋钮，两种来源，一种无损一种有损。
- `paused` 同理（规则来源也不检查它），全局 `paused` 亦然。

### N5（中）深度守卫的告警会被**下一次无关的 Ticket 结束擦掉**，而它是唯一的记录

- 深度守卫**线上真的触发过**（重建稿完全没提这条正面结果）：
  **【转录】** `source:rule` = `rule digest-done reached depth 2 of at most 1 after Ticket d9493df4; the chain stops here`，
  `at 2026-11-03T18:52:57.017Z`。
- **【残件】** 它被擦掉的过程在 `item9-negatives.json` 里：变体 B 的 `depth_problem_before` **还带着这条告警**，
  而 B 跑完后 `health_source_rule` 变成 `{ok:true, detail:"1 rule(s) watching how Tickets end", at:"2026-11-03T18:58:06.097Z"}`；
  变体 C 的 `depth_problem_before` 已经是 `[]`。
- 机制：`summarize()` → `health.record()` 写 `ok:true`。§4.15 的修复只加了**单次调用内**的 `if (!complained)` 守卫，
  所以**后一次没有抱怨的调用照样会擦掉前一次的告警**。这是同一类 bug 的第三次出现（S19 第五环、§4.15 的 `summarize()`）。
- 为什么严重：一条被深度限制截断的链**不产生 Trigger、不产生 Decision、不产生事件**
  （`continue` 在 enqueue 之前；**【残件】** 全库 `type='ended'` 的事件 0 条、`rescued` 1 条，可交叉核对事件类型分布）。
  所以那行健康问题是**唯一的痕迹**，被擦掉之后"这里曾经有一条自指链被停住"这件事就彻底查不到了。

### N6（低—中）`policyVersion` **没有任何设置级的线上出口**

- `stateView`（`http.ts:173-200`）返回 `settings / settingsRevision / machine / setupProblem / counts / health /
  sources / prompts / paused / mainSession` —— **没有策略版本**；`PUT /api/settings` 只返回 `{settings, settingsRevision}`。
- 唯一出口是每张 Ticket 的 `mandate.policyVersion`。
- 直接影响你的要求："每个 rule 旋钮必须在 `GET /api/state` 里显示不同的 `policyVersion`" —— **按字面做不到**。
  我的替代做法（**【残件】** `item9-policyversions.json` + `item9pv.py`）：每换一个旋钮就 `POST /api/tickets` 造一张探针票、
  读它的 `mandate.policyVersion`、然后立刻 `POST stop`。五个值全不同（`6aac6b1a… / 31d02a8c… / 445e3195… /
  853334da… / 27712f5b…`），其中 `p0 = 6aac6b1a798c3244` 与更早那张规则票 `d9493df4` 的 mandate 版本一致，是个交叉验证。
  **代价**：这 5 张 `pv-probe` 票留在库里了（`stage=stopped`），是 25 张里的一部分。
- 产品含义：操作者收紧某个来源的授权后，**无法在不制造工作的前提下看出任何变化**。

### N7（低）`rule.ts` 里"为什么入队"的理由在 S8 修复之后已经**是假的**

- `src/sources/rule.ts` 文件头："This callback runs inside the transaction that ended the upstream Ticket,
  so calling `receive` here would nest one command inside another's commit"；`onEnded` 的 docstring 重复了同一句
  （"Runs inside the transaction that ended the Ticket"）。
- 但 `src/core/engine.ts:197` 是 `this.emit = event => this.tx.afterCommit(() => publish(event))` ——
  监听器在**提交之后**才跑。所以"会把一个命令嵌进另一个的提交里"这个理由不成立。
- 入队本身仍然是对的（重试/退避/跨崩溃存活），但**注释里那条载重的理由是错的**，会误导下一个维护者。
  这正是文档漂移，不是行为缺陷。

### 另外两条**不是 bug**、但重建稿或读者可能误会

- **没有 `ended` 事件不代表漏记**：`ended` 这个类型只有级联路径写（`engine.ts:881`）。
  以 `ready`/`dropped` 结束的 Ticket 只有 `report` 事件，这与 §4.7 列出的 10 个写入点一致。
  **【残件】** 全库 `type='ended'` 的事件 **0 条**（本轮没有发生级联），符合预期。
- **`stopTicket` 对已结束的 Ticket 返回 400**：我在 item 7 末尾对已经 `done` 的 `ce1a9d76` 调 stop，得到 `http=400`
  （**【转录】**）。这是 S18 记录过的既有语义（`stop_refused`），不是新问题。

---

## 6. 对重建稿的逐条更正

按严重度排序。**§12 状态表里有 3 行我认为站不住。**

### 6.1 §7 标题"Watchdog —— 通过"：**错**，应为**部分通过，且救援这一面是失败的**

重建稿把 `maxActions` 那条写成"没有跑到 / 只有离线覆盖"。实际是**线上不可达**（N1）。
标题的"通过"会让读者以为救援是好的。建议改成：

> ## 7. Watchdog —— **部分**：探测器与署名日志得证；**救援是空操作，上限路径线上不可达**（N1）

### 6.2 §4 第二行"`rescued` 发生在 `launched` 之前——正是'启动卡住 → 救援 → 才启动'的语义"：**错**

那个 `launched`（`19:08:58.432`）**不是救援的结果**，是原来那次 launch 的 `sleep 90` 自己睡完了
（`createdAt 19:07:28.350` + 90.08s）。救援发生在 37 秒之前且**没有导致任何启动**
（worker 日志只有一个 turn）。顺序对，**因果错**。这条如果留着，正好会把 N1 藏起来。

### 6.3 §12 表里三行需要改

| 重建稿的行 | 应改为 |
| --- | --- |
| `Watchdog：卡在启动的探测与救援` → **真宿主验证**（达到上限后转"需要人"：离线） | **探测：真宿主验证；救援：真宿主证伪**（救援没有重新启动 worker，N1）；上限后转"需要人"：**线上不可达**，不是"离线" |
| `停止后无写入` → **未得证** | **部分得证**：T0+60s 采样确实没做；但 `03:15:58 → 04:42:17`（86 分钟）窗口内 size/mtime/sha256 三项与 T0 完全相同、无 `-wal`/`-shm`/`lock` 重现（本文 §3）。仍**不**等于 S32 结案 |
| `规则来源的三条负面路径` → **部分**（Decision 措辞证据丢失） | **真宿主验证**：三条 Decision 的 outcome/reason/detail 全文都在 `item9-negatives.json`（本文 §2）。但需补一条限定：**deny 对规则来源是有损的**（N4） |

另外两行建议补限定，不算错但会误导：

- `schema 迁移 1 → 5（含回滚演练）` → **真宿主验证**：成立。补一句更准确 —— 副本演练跑的是 `src/app/store.ts`
  （脚本直接 import 源码），**不是** `lib/index.js`；线上那半是宿主挂载时真迁移的，两边都得证了。
  还有一点重建稿没写：**上一轮那 5 张 Ticket 我是逐张 `GET /api/tickets/<id>` 验的**，
  全部 200，stage 分别是 `done/done/failed/done/stopped`，`createdAt` 与上一轮记录一致
  （`10:05:49.215Z / 10:16:07.706Z / 10:19:36.181Z / 10:25:30.214Z / 10:40:10.195Z`）。**【转录】**
- `事件日志` → **真宿主验证**：成立，且比你写的更强。**【残件】** 我刚复核：71 条事件覆盖 20 张 Ticket；
  `select … group by ticketId having min(seq)!=1` 返回 **0 行**，即"每张 Ticket 的 seq 都从 1 开始"是**全库成立**，
  不只是那三条样本。你引的第三条序列我复核过，逐字正确：`4ac8bdb8` = `created, launched, report, retried, launched, report`。

### 6.4 §9"自动产生了新 Ticket 并跑到 `stage: done`"（同时引用两个残件）：**一半错**

- `item9-rule-ticket.json`（`d9493df4`）：`stage: done` ✓，`result.files:["digest.txt"]`，
  `artifacts` 一条 `digest.txt`，`origin:{triggerId:"2b179988…", depth:1}`，`mandate.via:"rule"`，
  `sender:{id:"digest-done",kind:"system"}`。
- `item9e-rule-ticket.json`（`2cfc2761`）：**【残件】** 我刚复核，`stage: "running"`、`ended: null`。
  我保存它的那一刻它还在跑，之后没有再采一次样。**不能说它跑到了 done。**
  它证明的是另一件事：`sources.session.enabled=false` 时规则 Trigger 仍被**受理**
  （Decision `outcome:accept, reason:accepted`）——即 Defect B 的修复线上得证。
- 建议改成：正面路径**一张**跑到 `done`（`d9493df4`）；第二张（`2cfc2761`）只证到"被受理并启动"。

### 6.5 §9 漏了深度守卫这条**正面**结果

`maxDepth=1` 时链条在第二代被截住并**说出了原因**（`reached depth 2 of at most 1 after Ticket d9493df4;
the chain stops here`）。这是 §4.15 那个"fork bomb 守卫"的线上得证，重建稿完全没提。
但必须与 N5 一起写：这行告警随后被擦掉了，而它是唯一的记录。

### 6.6 §8 表格里的 `archived_after_lift` 一列：**我残件里那个值是假的**

`item8-summary.json` 的 `A.archived_after_lift = false`。这是**我的检查跑得太早**（解除 deny 后 0.0 秒就查了目录），
不是真的没归档。**【残件】** 实际情况：`inbox/accepted/f1b4289706daf86d60d2bb49f591e8ca-v2-inbox-deny.md`（220 B）
与 `accepted/1150d5be8c0b0938206b9108846873e1-v2-inbox-paused.md`（224 B）都在，
注解是 `<!-- myagent: Ticket 4d02911c051e53677ac4d863a5b1dea2 -->`；`inbox/rejected/` **从未被创建**；
inbox 根目录下没有散落文件。归档名 = `<triggerId>-<原名>`，即 S31 的修复形状。
重建稿的表格没引用这一列，所以没被污染 —— 但**别去引用 `item8-summary.json` 的那个字段**。

### 6.7 §11"未干扰日常宿主 —— 通过（我自己核对的）"：结论可以，但有一个方法陷阱要点明

- 我确实**只留了前置快照**（`daily-pre.txt`，02:15），没做后置 diff。你重做是对的。
- **陷阱**：任务书给的那条命令 `find … -exec stat -f '%N|size|mtime|inode' {} \;` 在 BSD stat 下
  会把 `size`、`mtime`、`inode` 当**字面文本**打印（格式符要 `%z`/`%m`/`%i`）。
  `daily-pre.txt` 因此分了三节：**A)** 任务书原样（**对检测变化毫无用处**）、**B)** 修正格式、**C)** shasum。
  **如果你的 diff 是拿 A 节做的，它必然为空，但那不证明任何东西。** 请用 B 节 + C 节。
- 我能提供的正面证据：**【残件】** `grep -rn '3080' /tmp/myagent-acceptance-v2/` 在脚本里**零命中**
  （只有 JSON 数据文件里可能有），`api.py` 把 base 硬编码成 `3180`，`verify-live.sh` 是用 `PORT=3180` 调的。
  即我这边没有任何代码路径指向日常宿主。
- **【转录】** 日常宿主 pid 24619 在 02:0x 时 `ELAPSED = 01-01:44:47`，与你在 03:2x 看到的"未变"一致。

### 6.8 §6 的 token 名：小更正

重建稿写 `INVALID_TOOL_OUTPUT` 与 `not lossless` 的出现次数是 0。**【残件】** 我刚复核两个日志，
四个 token 全为 0：`ToolOutputError`、`lossless`、`INVALID_TOOL_OUTPUT`、`invalid output`；
`item6-worker.jsonl` = turns `[1,2]`、6 个 `tool/result`、0 个 `isError`；
`item7-worker.jsonl` = turns `[1]`、1 个 `tool/result`、0 个 `isError`。
上一轮 `worker3.jsonl` 的对照计数是 `ToolOutputError` 2、`lossless` 4、`INVALID_TOOL_OUTPUT` 2。
**但当时 worker 看到的原文是** `Error: tool "myagent_report" returned invalid output: value is not lossless JSON`
——`INVALID_TOOL_OUTPUT` 这个拼法我在原始现场里**没有**见到，它可能是错误码而非日志文本。结论不变，措辞请对齐原文。

### 6.9 §2"全库累计 11 条产物、覆盖 11 张 Ticket"：**对**

**【残件】** 复核：`11 artifacts over 11 tickets`（一票一条，没有一票多条的情况）。

---

## 7. 我这边没做完的事（不找借口，列清楚）

1. **没写报告**。这是本补遗存在的原因。
2. **没做日常宿主的后置快照与 diff**（约束 2 的后半）。前置快照有，后置没有。你重做了。
3. **没做 T0+60s 的停止后采样**。§3 那次 86 分钟采样是事后补的，不能替代它。
4. **没驱动协作通道 `noteFromWorker`**（需要两个属于同一个 Work 的 Ticket 同时在跑，而 Work 归类**线上不可达**
   ——`attachWork` 零调用者，所以这条线上根本没法驱动，不只是"我没做"）。重建稿 §12 写"本轮未驱动"是对的，
   但理由应该改成**线上不可达**。
5. **没验 `silentMs` 静默探测器**。默认 0（关闭），要驱动它需要一个真 Session 长时间不产事件；
   考虑到 N1（救援路径本身在真宿主里是空操作），我对它线上的有效性**持怀疑态度**——
   它的动作是 `interrupt`（`haltBackground` + `assignmentInterrupted`），走的不是被效果泵阻塞的那条路，
   所以机制上**可能**没被 N1 影响，但我没有证据。别把它标成"应该没问题"。
6. **`maxWorkers=0` 这一问没有线上验**（任务书第 7 项让我"先看看 0 会发生什么"）。
   **【转录】** 离线答案：`policy.ts` 里是 `maxWorkers: z.number().int().min(1).max(8).default(2)`，
   **`min(1)`**，所以 0 会被 schema 拒掉、`PUT /api/settings` 报错，那条路根本走不通 ——
   这也是我改用 prepare-sleep 的原因。我没有真的发那个 PUT 去看错误响应长什么样。
