# 14 · Watchdog 现场验收（第 33 轮 · 四场景定界）

> 本报告**边跑边写**：每个场景一落地就落盘，不做最后一次性汇总。
> 标注约定：**【实测】**= 本轮亲自测量，附证据文件名；**【推断】**= 由测量或源码推出的判断。
> 判定用语：**通过** / **证伪** / **未得证**。

## 0. 冻结版本核验（起点）

| 项 | 值 | 标注 |
| --- | --- | --- |
| 被测产物 | `~/Documents/SA/myagent/lib/index.js` | — |
| sha256（起点） | `04d171f85a6bc1f079ab3a1f03f31f2fd2d58ecb300c2e37e02f9ab4dbadd1a1` | 【实测】 |
| 字节数（起点） | `269132` | 【实测】 |
| mtime（起点） | `Nov 4 11:56:06 2026` | 【实测】 |
| 与验收单钉死的值 | **一致** | 【实测】 |

命令：

```bash
shasum -a 256 ~/Documents/SA/myagent/lib/index.js
stat -f '%z %m %Sm' ~/Documents/SA/myagent/lib/index.js
```

本轮**未执行** `pnpm build` / `pnpm check` / `scripts/gate.sh`（执行任一条都会改变被测产物）。

## 0.1 日常宿主数据的起点快照（只读）

```
a793caacbbcb2e1d5f96608305878340c52f5c31d7f031e05a4c4df628a987f5  ~/.dsh/state/myagent/myagent.sqlite3
```

`~/.dsh/state/myagent/` 起点内容：`inbox/`、`myagent.json`、`myagent.lock`、
`myagent.sqlite3`、`myagent.sqlite3-shm`、`myagent.sqlite3-wal`、`work/`。
【实测】日常宿主（端口 3080，pid 24619）在验收开始时正在运行，本轮全程不重启、不写入。

## 0.2 环境与投料

| 步骤 | 命令 / 观察 | 标注 |
| --- | --- | --- |
| 启动宿主 | `cd ~/deepseek-harness && node --import tsx/esm apps/cli/src/bin.ts --profile myagent-test --patch /tmp/myagent-acc-watchdog/overlay.patch.yml --port 3180 --no-open`（后台作业 `bash-7ab03567919b483b`，输出 tee 到 `/tmp/myagent-acc-watchdog/host.log`） | 【实测】 |
| 就绪行 | `dsh web: http://127.0.0.1:3180/?token=<token-sha256:c308d48c6187>` | 【实测】 |
| 监听确认 | `lsof -nP -iTCP:3180 -sTCP:LISTEN` → `node 37395 ... TCP 127.0.0.1:3180 (LISTEN)` | 【实测】 |
| 新 stateDir | `~/.dsh/state/myagent-acc-watchdog/` 由宿主自建（`inbox/ work/ myagent.json myagent.lock myagent.sqlite3{,-shm,-wal}`） | 【实测】 |
| `mountedAt` | `2026-11-04T04:27:05.801Z` | 【实测】 |
| 设置 PUT #1 | `PUT /myagent/api/settings`，header `x-myagent-request: 1`，body 为验收单给定的 JSON → HTTP 200，`settingsRevision: 1` | 【实测】 |
| 设置回读 | `GET /api/state` → `acceptMode:"auto"`、`executor.maxWorkers:1`、`executor.prepare:"sleep 90"`、`watchdog:{enabled:true,everyMs:60000,launchStuckMs:15000,maxActions:2,silentMs:0}`、`counts.workerSlots:{used:0,max:1}` | 【实测】 |
| 投料 | 请求文件先在 `/tmp` 暂存并 `touch -t $(date -v-10S +%Y%m%d%H%M.%S)` 回拨 mtime，再 `mv` 进 `inbox/`（`mv` 保留 mtime，避免"落盘瞬间就被扫描"与"回拨后 Trigger 身份变化"两种竞态） | 【实测】 |
| 投料时刻 T0 | `epoch 1793766808.471` = `2026-11-04T04:33:28.471Z` = `12:33:28+0800` | 【实测】 |
| 文件 | `inbox/watchdog-request.md`，247 字节，mtime `1793766772`（= 12:32:52+0800，比落盘早 36s，settle 窗口 `SETTLE_MS=1000` 早已过） | 【实测】 |
| Ticket | `a688c9df4470d36ac4d49eb4218d1f28`，`created` 事件 `2026-11-04T04:33:31.095Z`，`by {kind:"person",id:"operator"}`，`detail.via:"inbox"`，`triggerId 27e252983edd1d9c40be5901b9231143` | 【实测】 |
| 采样器 | `python3 sampler.py 210 4`：每 ~4s 一次 `GET /api/state` + `ps -o pid,etime,command -ax \| grep '[s]leep 90'` + `GET /api/tickets/<id>/events?limit=500`，边采边追加 JSONL（`raw-state.jsonl` / `raw-ps.jsonl` / `raw-events.jsonl` / `raw-markers.jsonl`） | 【实测】 |

> 采样间隔取 4s 而不是验收单建议的 ~10s：4s 序列是 10s 序列的超集，对"每一个 `sleep 90` 存活的采样点"这类全称命题只会更严。

---

## 场景 1 — N3：prepare 命令在跑的那段时间，槽位必须一直被计上

**命题**：只要 `ps` 看得见 `sleep 90` 活着，`counts.workerSlots.used` 就必须是 1，一次 0 都不行。

**命令**（每 ~4s 一轮，T0+0.3s 到 T0+210s）：

```bash
curl -sS -H 'x-myagent-request: 1' http://127.0.0.1:3180/myagent/api/state \
  | jq '.counts.workerSlots'
ps -o pid,etime,command -ax | grep '[s]leep 90'
```

**观察**【实测】：

- 采样点 28 个，其中 `sleep 90` 存活的 **22 个**；全程只有**一个** `sleep 90` 进程，pid **38023**，`ps` 输出里从来没有第二行。
- 这 22 个存活采样点上 `counts.workerSlots.used` **全部 = 1**，`max = 1`。
- **违规计数（存活 ∧ used==0）= 0**。
- 存活窗口：首次 `12:33:32.860+0800`（`38023 00:01 sleep 90`）→ 末次 `12:34:59.248+0800`（`38023 01:28 sleep 90`），即 T0+4.4s 到 T0+90.8s，覆盖 prepare 的整个 90s。
- 进程起点由两次 `etime` 反推夹逼：假定 `etime` 向下取整得 `04:33:30.860Z..04:33:30.901Z`；该区间比 `created`（`04:33:31.095Z`）还早 ~195ms，而 prepare 不可能早于自己的 Ticket，故 macOS `etime` 实为四舍五入到秒，读作 `04:33:30.360Z..04:33:31.401Z`，包含 `created`。取 **attempt start ≈ 04:33:31.0Z ± 0.3s**。
- `used` 归零发生在 `12:35:23.927+0800`（T0+115.5s），即 `sleep 90` 结束后约 22s——`launch()` 的 `finally { starting.delete }` 要等 `prepareDirectory → sessions.ensure → promptWorker` 全部返回才执行。这段时间 `used` 仍为 1，但已无 `sleep 90`，**不构成违规**（命题只约束"进程存活"的采样点）。
- 关键旁证：期间 Watchdog 已经 rescue 了 2 次（见场景 3），`rescueStuckLaunch` 每次都 `effects.enqueue('launch', ...)` 重排了一行，但 `ps` 里始终只有 pid 38023 一个 `sleep 90`。**重排没有孵化第二个 prepare 进程**——与 N1 的判断一致：重排的那一行被正在跑的那次 attempt 消化掉了（`launch()` 在 `used() >= maxWorkers` 时抛 `Later(SLOT_RETRY_MS)`）。

**判定：通过**【实测】。N3 的修复在现场成立：rescue 之后槽位没有少计，`maxWorkers` 在真实资源意义上没有被越过。

证据：[`item1-state.json`](/tmp/myagent-acc-watchdog/item1-state.json)（28 点完整序列 + 违规列表）、[`item1-ps.txt`](/tmp/myagent-acc-watchdog/item1-ps.txt)（逐点 `ps` 原文）、`raw-state.jsonl`、`raw-ps.jsonl`。

---

## 场景 2 — N2：改 `everyMs` 必须不重启就重新装定时钟

**命题**：PUT `watchdog.everyMs: 60000 → 10000` 之后，正在跑的那个定时器要被重新装定，`rescued` 落在 PUT 之后的 10s 网格上，检测时延进入 10–25s。

**命令**：

```bash
# launch 已经卡住时（T0+4.5s）执行，时刻记录在 put2-time.txt
curl -sS -X PUT -H 'x-myagent-request: 1' -H 'content-type: application/json' \
  -d '{"acceptMode":"auto","allowedSenders":["operator"],
       "executor":{"maxWorkers":1,"prepare":"sleep 90"},
       "watchdog":{"enabled":true,"everyMs":10000,"launchStuckMs":15000,"maxActions":2}}' \
  http://127.0.0.1:3180/myagent/api/settings
curl -sS -H 'x-myagent-request: 1' http://127.0.0.1:3180/myagent/api/tickets/a688c9df4470d36ac4d49eb4218d1f28/events?limit=500
```

**观察**【实测】：

| 事件 | 时刻 (UTC) |
| --- | --- |
| 宿主 mount（Watchdog `start()`→`arm()`，`everyMs=60000`） | `04:27:05.801Z` |
| Ticket `created` / attempt start | `04:33:31.095Z` |
| **PUT `everyMs=10000`**（请求→响应） | `04:33:32.971Z → 04:33:32.974Z`，`settingsRevision 2` |
| `rescued` #1（`by {kind:"system",id:"watchdog"}`） | `04:34:05.824Z` |
| `rescued` #2 | `04:34:15.827Z` |
| health 转 not ok | `04:34:25.830Z` |

**三个网格检验**：

1. **检测时延** = `rescued#1.at − created.at` = `04:34:05.824 − 04:33:31.095` = **34.729s**（±0.3s）。阈值 `launchStuckMs` 15s，PUT 后配置的扫描间隔 10s。**不在 10–25s 举证带内**。（也未到验收单说的"≥50s"那条线，所以单看时延不能定案——下面两条才是决定性的。）
2. **旧 60s 网格（从 mount 起算）**：`mountedAt + 7×60s = 04:27:05.801 + 420s = 04:34:05.801Z`。实测 `rescued#1 = 04:34:05.824Z`，**残差 +23ms**。命中。
3. **新 10s 网格（从 PUT 起算）**：预测 `04:33:42.974 / 04:33:52.974 / 04:34:02.974 / 04:34:12.974`。实测 `04:34:05.824Z` 距最近的一个偏 **+2849.7ms**。**不命中**。
4. **被吞掉的那一次 look（最关键）**：若 PUT 真的重装了时钟，`04:33:52.974Z` 必有一次 look，此刻 attempt 已运行 **22.094s ≥ launchStuckMs 15s**，`stuckLaunches` 必然返回它，**必须**产生一条 `rescued`。事件日志里 `seq` 从 1（created）直接跳到 2（`04:34:05.824Z` 的 rescued），**`04:33:52.974Z` 上什么都没有**。
5. **10s 节奏确实生效了，但不是 PUT 生效的**：`rescued#2 − rescued#1 = 10.003s`，health 转 not ok 又 `+10.003s`，其后 look 时刻为 `04:34:35.832 / 04:34:45.834 / 04:34:55.835`——相位一路锁在 `.82/.83`，即 **mount 那一刻的相位**。10s 间隔是旧定时器在 `04:34:05.824` 那次回调**自己结束时** `arm()` 重新读设置捡起来的（`watchdog.ts:153-158`），不是 PUT 触发的重装。

**判定：证伪**【实测】。改 `everyMs` **没有**重新装定正在跑的定时器；新间隔要等到旧定时器下一次自然触发之后才生效。这与 N2 原报告的失效模式是同一个（原文：53.1s 检测时延对 15s 阈值），本轮实测 34.729s，差别只在 PUT 时刻相对旧网格的相位。
**须同时说清的边界**：`everyMs` 的改动**不需要重启**就能生效（10s 节奏在 `04:34:05.824Z` 之后确凿可见），所以 N2 原报告里"只能靠重启"这一半已经改善；未修的是"改动当场重装时钟"这一半。

### 2.1 为什么 `settingsChanged()` 没被调到（机制）

`watchdog.settingsChanged()`（`src/app/watchdog.ts:142-146`）本身写对了：`armedEveryMs` 与新值不同就 `arm()`。问题是**它唯一的调用点是 `Runtime.refresh()`（`src/app/runtime.ts:802`），而 `refresh()` 在"改 watchdog 设置"这条路上一个都到不了**：

- `saveSettings()`（`src/app/runtime.ts:489-500`）**自己不调 `refresh()`**；它只做 `engine.policyChanged(before,next)`、`sources.sync()`、`passes.requestPass()`。
- `refresh()` 的第二个入口是 `policy.changed` 事件（`src/app/runtime.ts:845-847`）。而 `Engine.policyChanged` 只在 `effects.length > 0` 时才 `emit`（`src/core/engine.ts:750`），`policyEffects` 又在 `policyVersion(before) === policyVersion(after)` 时直接 `return []`（`src/core/policy.ts:373`）。`policyVersion = key('policy', authorizationShape(settings))`，而 `authorizationShape`（`src/core/policy.ts:186-217`）**只含** `acceptMode / allowedSenders / sources.*`，**不含 `watchdog`、也不含 `executor`**。⟹ 只改 `watchdog.everyMs` 时 `policyVersion` 不变 ⟹ `effects=[]` ⟹ 不发 `policy.changed` ⟹ `refresh()` 不被调。【推断】
- `refresh()` 的第三个入口是每个 pass 结束时的 `extra: [async () => this.refresh()]`（`src/app/runtime.ts:325-329`）。**而这正是 N1 已经证过的那件事**：`Effects.runDue` 在"某个 pass 拥有队列"时就返回，此刻在飞的那个 pass **就是**正在 `await sleep 90` 的那次 launch——它 90s 内不会结束，于是 `extra` 里的 `refresh()` 90s 内一次都不会跑。【推断】
- 于是 PUT 之后到 `04:34:05.824Z` 之间，`settingsChanged()` 没有任何机会被调用；旧 60s 定时器按 mount 相位自然触发，`look()` 里读到新设置才产生 rescue，回调结束时 `arm()` 才把 10s 装上。

**旁证（本轮实测到的节拍）**【实测】：队列空闲时 `health.passes.at` 与 `health.runtime.at` **完全相等**且每 ~4s 前进一次（`PASS_INTERVAL_MS = 2000`，`src/app/runtime.ts:52`）——`04:38:18.123 / 04:38:22.125 / 04:38:26.127`。`runtime.at` 由 `refresh()` 末尾的 `health.entry('runtime').record(...)` 写（`src/app/runtime.ts:809-811`），两者同刻同值即"每个 pass 结束都跑一次 `refresh()`"的直接痕迹。

> 机制里"pass 在 launch 期间不结束"这半句是【推断】，下面 §2.2 用一个 30s 的定界复跑把它变成【实测】。

---

### 2.2 机制的现场确证（定界复跑 B，约 70s）

为了把 §2.1 里两条【推断】变成【实测】，在同一个隔离宿主上跑了一次定界复跑（不是第五个场景，是场景 2 的机制取证）。

**B-1：只改 `executor`/`watchdog` 的 PUT 不动 `policyVersion`**

```bash
curl -sS -H 'x-myagent-request: 1' http://127.0.0.1:3180/myagent/api/state | jq '.policyVersion'
# → "4045fec248ecb4c5"   (settingsRevision 2, prepare "sleep 90")
curl -sS -X PUT -H 'x-myagent-request: 1' -H 'content-type: application/json' \
  -d '{"acceptMode":"auto","allowedSenders":["operator"],
       "executor":{"maxWorkers":1,"prepare":"sleep 30"},
       "watchdog":{"enabled":true,"everyMs":10000,"launchStuckMs":15000,"maxActions":2}}' \
  http://127.0.0.1:3180/myagent/api/settings      # 请求 04:48:41.908Z → 响应 04:48:41.945Z
curl -sS -H 'x-myagent-request: 1' http://127.0.0.1:3180/myagent/api/state | jq '.policyVersion,.settingsRevision'
# → "4045fec248ecb4c5", 3
```

**观察**【实测】：`settingsRevision` 2 → 3、`executor.prepare` 确实变了，`policyVersion` **一字未动**。
⟹ `policyEffects` 在 `policy.ts:373` 直接 `return []` ⟹ `engine.ts:750` 的 `if (effects.length > 0)` 不成立 ⟹ **不发 `policy.changed`** ⟹ `runtime.ts:845-847` 那条 `refresh()` 入口在这条路上关闭。

**B-2：launch 在等 prepare 命令时，没有任何 pass 会结束**

投料 B（`inbox/watchdog-request-b.md`，mtime 回拨 10s）后，每 2s 采一次 `health.passes.at`：

| 阶段 | `health.passes.at` | 判定 |
| --- | --- | --- |
| launch 之前（队列空闲） | `04:48:54.426 → 04:48:58.427 → 04:49:00.429 → 04:49:02.428 → 04:49:04.430 → 04:49:06.589` | 每 ~2s 前进（`PASS_INTERVAL_MS=2000`） |
| **`sleep 30` 在跑**（12:49:08.963 → 12:49:36.263，**连续 14 个采样点，27.3s**） | **`04:49:06.589Z` 一动不动** | **冻结** |
| prepare 结束之后 | `04:49:36.747 → 04:49:40.448 → 04:49:42.449 → …` 恢复每 ~2s 前进 | 恢复 |

**观察**【实测】：

- 冻结期间 `sleep 30` 一直存活、`counts.workerSlots.used` 一直 = 1、`counts.open` = 1。
- 冻结期间 **Watchdog 自己仍在 look**：`health.watchdog.at` 在冻结窗内写下 `04:49:25.986Z` 和 `04:49:35.990Z`（Δ 10.004s，10s 节奏）。⟹ 定时器与 pass 无关，它照跑；**跑不到的只有"重装时钟"这个动作**，因为 `settingsChanged()` 只能由 `refresh()` 调到，而 `refresh()` 在冻结窗内一次都没跑。
- 队列空闲时 `health.passes.at` 与 `health.runtime.at` **每一点都完全相等**（`04:48:54.426/04:48:54.426` 等），这正是 `extra: [async () => this.refresh()]` 在每个 pass 末尾跑一次、`refresh()` 末尾又写 `health.runtime` 的指纹（`runtime.ts:327` + `runtime.ts:809-811`）。冻结期两者一起停。

**结论**【实测】：§2.1 的两条【推断】都成立。`watchdog.settingsChanged()` 的三条可达路径——`saveSettings` 直调（不存在）、`policy.changed`（watchdog/executor 改动不产生 policy effect，B-1 实测）、pass 末尾的 `extra`（launch 等 prepare 时 pass 不结束，B-2 实测）——**在"launch 正卡着"这个唯一需要它的窗口里全部关闭**。N2 的修复代码写对了，但装在了一个在该场景下永远走不到的位置上。

证据：[`item2b-mechanism.json`](/tmp/myagent-acc-watchdog/item2b-mechanism.json)、[`runB-before.txt`](/tmp/myagent-acc-watchdog/runB-before.txt)、[`runB-after.txt`](/tmp/myagent-acc-watchdog/runB-after.txt)、[`runB-put-time.txt`](/tmp/myagent-acc-watchdog/runB-put-time.txt)、`rawB.jsonl`、`rawB-markers.jsonl`。

**附带核对（相位漂移，用来排除另一种解释）**【推断】：Run A 中 `rescued#1` 的相位 `.824` 也可能被解释成"某次 `refresh()` 在 `04:33:55.82` 重装了时钟"。该解释要求 PUT 之后 22.85s 内一次 `refresh()` 都没跑、然后恰好在 `.82` 跑一次；而队列空闲时 pass 每 2s 一个，若真能跑，第一次 `refresh()` 会在 PUT 后 ~2s（`04:33:34.97`）就重装，look 应落在 `04:33:54.97`（attempt 龄 23.9s ≥ 15s，必须 rescue）——事件日志里没有。B-2 已实测冻结，故此解释被排除。Run B 中 look 相位从 Run A 的 `.835` 移到 `.986`（+151ms），与 `arm()` 在 `look()` 返回之后才调用（`watchdog.ts:153-158`）导致的每 look ~1.7ms 累积漂移在 87 次 look 上的量级一致（87 × 1.74ms ≈ 151ms），期间没有任何跳变到 PUT 时刻相位的情况。

---

## 场景 3 — N1：rescue 不能把问题变没，升级路径必须可达

**命题**：宿主一直开着跑过 `maxActions`(2) 次 rescue 之后，(a) 出现多于一条 `rescued`，且 `by` 都是 `{kind:"system",id:"watchdog"}`；(b) `health.watchdog` 转 not ok，detail 明说"需要人"；(c) 那一刻 `counts.workerSlots.used` 仍是 1。

**命令**（每 ~4s 一轮，共 28 轮，覆盖 T0+0.3s 到 T0+213.9s）：

```bash
curl -sS -H 'x-myagent-request: 1' http://127.0.0.1:3180/myagent/api/state | jq '.health.watchdog, .counts.workerSlots'
curl -sS -H 'x-myagent-request: 1' \
  http://127.0.0.1:3180/myagent/api/tickets/a688c9df4470d36ac4d49eb4218d1f28/events?limit=500
```

**观察 (a)**【实测】：**2 条** `rescued`，`by` 都是 `{"kind":"system","id":"watchdog"}`，`detail.why` 都是 `"its worker never came up within 15s"`：

| seq | at (UTC) | type | by |
| --- | --- | --- | --- |
| 1 | `2026-11-04T04:33:31.095Z` | `created` | `{kind:"person", id:"operator"}` |
| 2 | `2026-11-04T04:34:05.824Z` | `rescued` | `{kind:"system", id:"watchdog"}` |
| 3 | `2026-11-04T04:34:15.827Z` | `rescued` | `{kind:"system", id:"watchdog"}` |

**观察 (b)**【实测】：`health.watchdog` 在 `2026-11-04T04:34:25.830Z` 转 `ok:false`，detail 逐字为：

```
Ticket a688c9df has not started after 2 attempts to rescue it; it needs a person
```

（对应 `src/app/watchdog.ts:91-92` 的 `health.problem(...)`；`a688c9df` 是 Ticket id 的前 8 位。）
该 not-ok 条目在其后每一次 look 都被重写并保持：`at` 依次为 `04:34:25.830 / 04:34:35.832 / 04:34:45.834 / 04:34:55.835`，间隔 10.002–10.003s，直到采样结束（`04:36:58`）都是 `ok:false` + 同一句 detail。

**观察 (c)**【实测】：`health.watchdog.ok` 第一次为 `false` 的采样点是 `12:34:26.359+0800`（T0+57.9s），该点 `counts.workerSlots = {used: 1, max: 1}`。此后 `used` 一直保持 1 到 `12:35:19.812+0800`（T0+111.3s），`used` 归零要到 `12:35:23.927+0800`（T0+115.5s）——比 (b) 晚 **57.6s**，且那时 `sleep 90` 早已结束（末次存活采样 `12:34:59.248+0800`）。**即：升级发生时，Ticket 确实还被计作 starting。**

**这正是 N1 修复的本体**：`rescueStuckLaunch`（`src/app/executor.ts:180-182`）现在只做 `effects.enqueue('launch', ...)`，**不再** `this.starting.delete(ticketId)`。`starting` 条目留住 ⟹ `stuckLaunches()` 下一次 look 还能看见它 ⟹ `actionsTaken` 累加到 `maxActions` ⟹ `health.problem("... it needs a person")` 可达；同时 `used()`（`src/app/executor.ts:190-195`，`new Set([...running, ...this.starting.keys()]).size`）继续把这个仍在跑的进程计进去。

补充观察【实测】：第 3 次 look 起 `actions.push({...stuck, why:'already acted 2 time(s)', acted:false})`，`acted:false` 意味着 `look()` 末尾的 `if (actions.some(a => a.acted)) this.host.requestPass()` 不再为它请求 pass——升级之后 Watchdog **停止**继续搅动队列，符合"从这儿起是人的事"的注释意图。

**判定：通过（(a)(b)(c) 三部分全部成立）**【实测】。N1 的修复在现场达成了它的目的：rescue 没有让问题消失，"需要人"这条线在约 55s 内（3 次 look：`04:34:05.824 / 04:34:15.827 / 04:34:25.830`）就被走到，远快于验收单给的 4 分钟上限。

证据：[`item3-events.json`](/tmp/myagent-acc-watchdog/item3-events.json)（完整事件日志 + 逐轮采样的事件类型序列）、[`item3-health.json`](/tmp/myagent-acc-watchdog/item3-health.json)（28 点 `health.watchdog` × `used` 序列、首次 not-ok 采样点原文、逐字 detail）。

## 场景 4 — 命题 B：宿主停下之后没有任何东西再写

**命题**：宿主停止后 60s 内，DB 的 sha256 / size / mtime 完全不变，且 `-wal`、`-shm`、`.lock` 不再出现。

**停机**：`kill -TERM 37395`（隔离宿主的 node 进程，pid 由 `lsof -nP -iTCP:3180 -sTCP:LISTEN` 确认），发出时刻 `2026-11-04T12:53:40+0800`（`epoch 1793768020.760`）。后台作业 `bash-7ab03567919b483b` 随后 **completed, exit code 0**（优雅退出）。

**命令**（`/tmp/myagent-acc-watchdog/scenario4.sh`，逐字输出即 `item4-stopwrite.txt`）：

```bash
DB=~/.dsh/state/myagent-acc-watchdog/myagent.sqlite3
shasum -a 256 "$DB"; stat -f '%z %m' "$DB"; ls -a "$(dirname "$DB")"
lsof -nP -iTCP:3180 -sTCP:LISTEN; lsof -nP "$DB" "$(dirname "$DB")"
sleep 60
shasum -a 256 "$DB"; stat -f '%z %m' "$DB"; ls -a "$(dirname "$DB")"
lsof -nP -iTCP:3180 -sTCP:LISTEN; lsof -nP "$DB" "$(dirname "$DB")"
```

**观察**【实测】：

| 项 | sample 1（`04:54:01Z`，停机后 20.4s） | sample 2（`04:55:01Z`，停机后 80.9s） | 第三次读（sample 2 之后） |
| --- | --- | --- | --- |
| sha256 | `494b4a14f563292432e90e4d8bc45d6d276bb72cf27e80b4fb46095f6f30d649` | 同左 | 同左 |
| `stat -f '%z %m'` | `94208 1793768020` | `94208 1793768020` | `94208 1793768020` |
| `ls -a` | `. .. inbox myagent.json myagent.sqlite3 work` | 同左 | — |
| `lsof -nP -iTCP:3180 -sTCP:LISTEN` | 无输出，exit 1 | 无输出，exit 1 | — |
| `lsof -nP <DB> <dir>` | 无输出，exit 1（**没有任何进程开着它**） | 无输出，exit 1 | — |

- **mtime `1793768020` = `2026-11-04T12:53:40+0800`，正是 SIGTERM 那一刻**。优雅退出把 WAL checkpoint 进主库（主库由 4096 → 94208 字节）并删掉了 `myagent.lock`、`myagent.sqlite3-shm`、`myagent.sqlite3-wal`；此后 60s 内一个字节都没再动。
- **sample 1 时就没有 `-wal`**，所以验收单提到的 S34 情形（有 `-wal` 时必须 `mode=ro&immutable=1` 才打得开）本轮**不适用**。为留证起见，停机后的只读查询是把 DB **复制**到 `/tmp/myagent-acc-watchdog/copy-for-readonly-query.sqlite3` 再查的，证据目录本身没有被打开过——查询后复查 `ls -a` 与 sha256 仍与 sample 1/2 一致。
- sample 1 的 `ps | grep '[s]leep '` 命中两行：`38907 bash -c sleep 5; ls -la …` 和 `38911 sleep 5`，那是**我自己那条探查命令**的 shell，不是宿主的；sample 2 时已消失。宿主的 `sleep 90` / `sleep 30` 在停机前就都已结束。
- 停机后只读查询 DB：`effects` 表 **0 行**（队列已排空），`kv` 只剩 `settings:document` / `settings:revision`。

**判定：通过**【实测】。命题 B 成立——宿主停止后没有任何定时器再触发、没有任何写入、没有 WAL/SHM/lock 复活，且没有进程仍持有这些文件。
（口径说明：本轮证明的是"**停机后**不再写"。停机前 Watchdog 的 `setTimeout` 都带 `unref?.()`（`src/app/watchdog.ts:160`），因此它不会独自把进程吊住——这一点是【推断】，由源码得出，本轮未单独举证。）

---

## 5. 收尾核验

| 项 | 起点 | 终点 | 一致 |
| --- | --- | --- | --- |
| `lib/index.js` sha256 | `04d171f85a6bc1f079ab3a1f03f31f2fd2d58ecb300c2e37e02f9ab4dbadd1a1` | `04d171f85a6bc1f079ab3a1f03f31f2fd2d58ecb300c2e37e02f9ab4dbadd1a1` | **是**【实测】 |
| `lib/index.js` 字节数 / mtime | `269132` / `Nov 4 11:56:06 2026` | `269132` / `Nov 4 11:56:06 2026` | **是**【实测】 |
| 中途抽查（12:47，场景 3 之后） | — | `04d171f8…` | **是**【实测】 |

本轮全程未运行 `pnpm build` / `pnpm check` / `scripts/gate.sh`，被测产物没有被移动过，因此**没有任何结论需要标 待复验**。

| 项 | 观察 | 标注 |
| --- | --- | --- |
| 隔离宿主退出状态 | `kill -TERM 37395` 后后台作业 `bash-7ab03567919b483b` **completed, exit code 0**；`ps -p 37395` / `ps -p 37391` 均无此进程 | 【实测】 |
| 端口 3180 | `lsof -nP -iTCP:3180 -sTCP:LISTEN` → 无输出，exit 1（停机后、sample 1、sample 2、收尾各查一次，全部为空） | 【实测】 |
| 日常数据 `~/.dsh/state/myagent/` | `myagent.sqlite3` sha256 起点 `a793caacbbcb2e1d5f96608305878340c52f5c31d7f031e05a4c4df628a987f5`，终点**同一个值**；目录清单与全部 mtime（`12:21` / `11:40` / `09:00`，均早于本轮开始时刻 `12:26`）逐字未变；`myagent.lock` / `-shm` / `-wal` 仍在原位 | 【实测】**未被触碰** |
| 日常宿主（端口 3080） | pid `24619` 全程存活并仍 `LISTEN 127.0.0.1:3080`；本轮未重启、未 reload、未向 3080 发过任何 POST/PUT（只用 `lsof` 看过它一眼） | 【实测】 |
| `myagent` 项目目录 | 本轮只写了本报告一个文件 `docs/v2/14-live-acceptance-watchdog.md`；`src/`、`lib/` 只读，未改一字。**但同期有本会话之外的进程在写该目录下的其它文档，见 §5.1** | 【实测】 |
| 证据目录 | `/tmp/myagent-acc-watchdog/`，清单见 §6 | 【实测】 |

### 5.1 并发写入的诚实说明（重要）

收尾核对项目目录时发现，**本轮期间有别的进程在写 `~/Documents/SA/myagent`**，不是本轮验收写的：

| 文件 | mtime | 本轮是否碰过 |
| --- | --- | --- |
| `docs/v2/08-acceptance-recipe.md` | `12:27:06` | 否 |
| `README.md` | `12:27:48` | 否 |
| `docs/v2/00-audit-and-plan.md` | `12:28:26` | 否 |
| `docs/v2/02-live-acceptance-v2.md` | `12:28:26` | 否 |
| `docs/v2/14-live-acceptance-watchdog.md` | `13:00:35`（收尾时仍在增量写） | **是——本轮唯一写入的文件** |

`13:00` 复查：`find -newermt '2026-11-04 12:59:00'` 在整个项目里只命中本报告一个文件，说明那波并发写入在 `12:28:26` 之后就没再动过。【实测】

【实测】本轮对该项目只做了 `read` / `grep` 和这一份报告的写入；上面四个文件本轮从未被 `write`/`edit` 触碰，它们在 `12:27–12:28` 的改动来自本会话之外（日常宿主 pid 24619 已运行 1 天 12 小时，其 stateDir 在 `12:21` 也有活动痕迹）。该项目不是 git 仓库（`git status` → `致命错误：不是 git 仓库`），所以无法用 diff 举证归属，只能用 mtime 与本轮的工具调用记录对照。【推断：改动来自另一个并发会话】

**但这不动摇任何结论**：被测产物 `lib/index.js` 的 mtime 全程停在 `Nov 4 11:56:06 2026`，sha256 在 `12:26`（起点）、`12:47`（中途）、`12:58`（终点）三次读取都是 `04d171f85a6bc1f079ab3a1f03f31f2fd2d58ecb300c2e37e02f9ab4dbadd1a1`、269132 字节；`src/` 下最新的文件是 `src/app/executor.ts`（`06:09:33`）与 `src/app/watchdog.ts`（`05:30:40`），都远早于本轮。并发写入动的是文档，不是被测代码。

### 5.2 关于 S34 的一条附带实测

验收单提示：停机后若第一次采样就有 `-wal`，需要 `mode=ro&immutable=1` 才打得开。本轮**优雅退出把 `-wal`/`-shm` 都删掉了**，所以该情形没有出现。但把 DB 复制到 `/tmp` 后用 `sqlite3.connect('file:…?mode=ro', uri=True)` 打开时，**`-shm`（32768 字节）和空的 `-wal` 被创建了出来**，而 `pragma journal_mode` 读出的是 `wal`。【实测】也就是说：WAL 模式的库即使已经静默（无 `-wal` 兄弟文件），只读打开仍会在**它自己所在目录**造出 `-shm`/`-wal`。这正是本轮坚持"先复制、再查副本、原件不打开"的原因——证据目录复查后仍只有 `inbox / myagent.json / myagent.sqlite3 / work`，sha256 仍是 `494b4a14…`，size/mtime 仍是 `94208 1793768020`。

---

## 6. 证据清单

| 文件 | 内容 |
| --- | --- |
| `host.log` | 隔离宿主 stdout（含 `dsh web: http://127.0.0.1:3180/?token=…` 就绪行；退出码 0，无 stderr 输出，共 82 字节） |
| `overlay.patch.yml` | 隔离覆盖层（未改动） |
| `settings1.json` / `put1-time.txt` | 场景设置 PUT #1 的 body 与时刻 |
| `put2-time.txt` | 场景 2 的 PUT（`everyMs=10000`）请求/响应时刻与响应体摘要 |
| `drop-time.txt` | 投料 T0 的 epoch 与本地时刻 |
| `sampler.py` / `samplerB.py` / `scenario4.sh` | 本轮实际执行的采集脚本 |
| `raw-state.jsonl` / `raw-ps.jsonl` / `raw-events.jsonl` / `raw-markers.jsonl` | Run A 逐轮原始流（28 轮，4s 间隔） |
| `rawB.jsonl` / `rawB-markers.jsonl` | Run B 逐轮原始流（35 轮，2s 间隔） |
| **`item1-state.json`** | 场景 1：28 点 `state` 序列 + 违规列表（违规 0） |
| **`item1-ps.txt`** | 场景 1：逐点 `ps` 原文 |
| **`item2-latency.json`** | 场景 2：时延与三个网格检验的完整算式 |
| **`item2b-mechanism.json`** | 场景 2 §2.2：机制取证（policyVersion 不变 + pass 冻结 27.3s） |
| **`item3-events.json`** | 场景 3(a)：完整事件日志 + 逐轮事件类型序列 |
| **`item3-health.json`** | 场景 3(b)(c)：28 点 `health.watchdog` × `used` 序列、首次 not-ok 原文、逐字 detail |
| **`item4-stopwrite.txt`** | 场景 4：两次采样逐字输出 |
| `runB-before.txt` / `runB-after.txt` / `runB-put-time.txt` / `runB-put.json` | Run B 的 PUT 前后读数 |
| `copy-for-readonly-query.sqlite3` | 停机后为取证复制出来的 DB 副本（只读查询用它，证据目录原件未被打开） |

## 7. 顺带看到的、没被要求的东西

1. **"需要人"这条升级线没有落地成任何持久记录。**【实测】Ticket `a688c9df` 的完整事件日志是 `created → rescued → rescued → launched → report`，**没有任何一条对应 `04:34:25.830Z` 那次 `health.problem("… it needs a person")`**。这个判定只活在 `health.watchdog` 这一格瞬态健康板上。停机后查 DB，`events` 表里找不到它，`kv` 里也没有。也就是说：场景 3(b) 证到了"升级可达"，但升级本身**事过无痕**。
2. **`health.watchdog` 是所有 Ticket 共用的一格，后一个 Ticket 的成功会把前一个 Ticket 的"需要人"直接抹掉。**【实测】Run A 写下的 `ok:false / "Ticket a688c9df … needs a person"` 一直保持到 `04:49:25.986Z`，然后被 Ticket `1b888157` 的一次普通 rescue 覆盖成 `ok:true / "1 stuck launch(es) rescued"`——中间没有任何人确认过，也没有任何地方记下它曾经存在。
3. **升级之后那一格会立刻变陈旧，但看起来仍是"当前值"。**【实测】`04:34:55.835Z` 之后 `health.watchdog.at` 冻结了约 14.5 分钟（Run B 的 0.00–29.42s 采样点全都是这个 `at`），而同期间 `look()` 每 10s 照跑（Run B 冻结窗内实测到 `04:49:25.986Z`、`04:49:35.990Z` 两次 look）。原因是 Ticket A 的 launch 在 `04:35:01.199Z` 完成后离开了 `starting`，`rescueStuck` 再也看不见它，于是没人再刷新那一格。面板上读到的是一句 15 分钟前的话，却带着"当前健康状态"的身份。
4. **两个 Ticket 最后都正常收尾了。**【实测】`a688c9df`：`launched 04:35:01.199Z` → `report 04:35:21.714Z` → `ended {outcome:"done", reason:"The worker reported ready"}`；`1b888157`：`launched 04:49:36.676Z` → `report 04:50:03.438Z` → 同样 `done`。工作目录里 `hello.txt` / `hello-b.txt` / `RESULT.md` 都在。即：Watchdog 报了两次 rescue + 一次"需要人"，而那次 launch 其实只是慢（prepare 是 `sleep 90`），最后自己成功了——**升级信号与被升级对象的成功之间没有任何对账**。这是本轮设置刻意造出来的情形，但它说明 `launchStuckMs` 触发的升级不携带"后来其实起来了"的回撤。
5. `effects` 表在停机时为 **0 行**【实测】：两次 rescue 各自 `enqueue` 的那一行都被消化掉了，没有留下积压或孤儿 effect。

## 8. 四个场景的判定汇总

| 场景 | 命题 | 判定 |
| --- | --- | --- |
| 1 | N3：prepare 在跑时槽位一直被计上（`used` 恒为 1，一次 0 都不行） | **通过**【实测】22/22 存活采样点 `used=1`，违规 0 |
| 2 | N2：改 `everyMs` 不重启就重装正在跑的定时器 | **证伪**【实测】时延 34.729s；`rescued#1` 命中 mount+7×60s 网格（残差 +23ms），不命中 PUT+10s 网格（偏 +2849.7ms）；PUT 后 20s 那次"必须 rescue"的 look 根本没有发生 |
| 3 | N1：rescue 不让问题消失，`maxActions` 之后"需要人"可达，且那一刻槽位仍计 1 | **通过**【实测】(a) 2 条 `rescued` 均 `by {system, watchdog}`；(b) `04:34:25.830Z` 转 not ok，detail 逐字 `Ticket a688c9df has not started after 2 attempts to rescue it; it needs a person`；(c) 同刻 `used=1` |
| 4 | 命题 B：宿主停下后没有任何东西再写 | **通过**【实测】60s 内 sha256/size/mtime 逐字不变，`-wal`/`-shm`/`.lock` 均未出现，`lsof` 对端口与文件都为空 |

**给下一步的一句话**：N1、N3 的修复在现场成立；N2 的修复代码本身没写错，但它挂在 `Runtime.refresh()` 上，而 `refresh()` 在"launch 正卡着"这个唯一需要它的窗口里三条路径全断（`saveSettings` 不直调、watchdog/executor 改动不产生 policy effect 因而不发 `policy.changed`、pass 在 prepare 期间不结束所以 `extra:[refresh]` 不跑）——把 `watchdog.settingsChanged()` 直接接到 `saveSettings()` 里（或让 `look()` 每次都比对 `armedEveryMs`）就够了，两条都已【实测】验证过断点位置。

