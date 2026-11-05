# V2 P0.5：当前构建的真宿主验收

**日期**：2026-11-03（18:00–18:55 Asia/Shanghai，UTC+8）
**Profile**：`myagent-test`（`~/.dsh/profiles/myagent-test`，`bundles = [@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, myagent]`，`dependencies.myagent = link:~/Documents/SA/myagent`）
**端口**：`3180`（日常宿主在 `3080`，全程未被写入；只做过只读 GET）
**状态目录**：`~/.dsh/state/myagent-acceptance`（隔离，独立锁；**不是** `~/.dsh/state/myagent`）
**宿主进程**：pid `72808`（`node --import tsx/esm apps/cli/src/bin.ts --profile myagent-test --patch … --port 3180 --no-open`），锁 `{"pid":72808,"host":"<host>","token":"2d1c1fff-…","at":"2026-11-03T10:03:36.698Z"}`
**启动命令**：

```bash
cd ~/deepseek-harness && pnpm dsh --profile myagent-test \
  --patch /tmp/myagent-acceptance/isolated-state.patch.yml --port 3180 --no-open
```

覆盖层 `/tmp/myagent-acceptance/isolated-state.patch.yml`（不改 profile 自身的任何文件）：

```yaml
- id: myagent
  name: myagent
  config:
    stateDir: ~/.dsh/state/myagent-acceptance
    mainSessionId: myagent-acc-main
```

> `mainSessionId` 必须覆盖，原因见 §Bug B1。

## 0. 构建身份（怎么证明跑的是哪份代码）

| 证据 | 值 |
| --- | --- |
| `lib/index.js` | size `202230`，mtime `2026-11-03 17:45:18`，sha256 `53eaa9c4d48d15fd403eb8d3fe3c0e0ed76c4653d6b68b17ac1ee4dc0d48c67e` |
| 最新的 `src/` 文件 | `src/app/sessions.ts` mtime `2026-11-03 17:34:44`（`store.ts` 17:34:05，其余 ≤ 13:04:50） |
| 结论 | `lib mtime 1793699118.89 > newest src 1793698484.90` → **构建产物比每一个源文件都新**，宿主加载的就是当前 `src/` 的构建 |
| 面板字节一致 | `panel/index.html` size `55086`，sha256 `80e604fd1b58db66b9101dcf95c3e994705cf6ca2eb98329643b1ef926039e25`；`GET http://127.0.0.1:3180/myagent/` → `served_bytes=55086 code=200`，落地文件 sha256 **完全相同** |
| 新行为字符串在构建里 | `could not run: DSH ended its turn as blocked` lib=1/src=1；`gave up after repeated attempts` lib=1/src=2；`copied from` lib=1/src=1；`recentTools` lib=6/src=8 |
| 路由表（从 `lib/index.js` 提取） | 全部 21 条：`GET state / tickets / tickets/:id / recipes / tickets/:id/progress / tickets/:id/files / tickets/:id/file / schedules / decisions / triggers / prompts / effects`；`POST tickets / tickets/:id/answer / :id/note / :id/stop / :id/retry / decisions/:id/dismiss / schedules/preview / pass / main-session`；`PUT settings / prompts` |

**12 个 GET 路由当场全部 200**（18:50:51）：

```
state 200 | tickets?state=all&limit=5 200 | tickets/d6398704… 200 | recipes 200
tickets/d6398704…/progress 200 | …/files 200 | …/file?path=RESULT.md 200
schedules 200 | decisions?limit=5 200 | triggers?limit=5 200 | prompts 200 | effects 200
```

### 0b. 一条必须写明的事实：源码树在验收过程中被别人同时在改

本文所有证据对应的是**隔离宿主 18:03:36 挂载时加载的那份 `lib/index.js`**（mtime `2026-11-03 17:45:18`，sha256 `53eaa9c4…`，size `202230`）。但收尾核查（19:00）发现：

- `lib/index.js` 在 **18:20:21 被重新构建过**（现为 sha256 `08de8f1e34780e88536b10ddac63569f69d6fd3e5ec12ddbd6a7805de9411e2e`，size `202389`）——**在挂载之后**。正在跑的宿主进程把 17:45:18 那份加载在内存里，所以本文的证据不受影响；但**磁盘上的文件已经不是我验证的那份**。
- 同时 `src/`、`tests/`、`prompts/`、`docs/v2/00-audit-and-plan.md` 在 18:13–18:43 之间陆续有新 mtime（`src/sources/cron.ts` 18:13:58、`src/core/timing.ts` 18:26:30、`src/core/policy.ts` 18:27:04、`prompts/worker.md` 18:37:30、`src/app/http.ts` 18:43:39……）。**这些改动都不是本次验收写的**：本次在项目树里写的唯一文件是本文（见 §11）。
- `panel/index.html` 没被动过（mtime 仍是 `16:03:10`），所以"服务端字节 = 磁盘字节"的比对到收尾仍然成立。
- 对 §9 的每一条 bug，我已对**当前源码**复核过它们仍然在：`src/app/executor.ts:145,147,148,154,289,291` 六处 `throw new Later` 都还在，`src/app/effects.ts:107` 也仍然只认返回值；`src/app/tools.ts:84-88` 的 `outcome: updated.ended?.outcome` 也还在。18:20:21 的新构建同样含全部 6 处 `throw new Later` 与 UNRUNNABLE_SESSION 文本。**所以 §9 的 B3/B4（以及其余各条）对"被验的构建"和"当前树"都成立。**

**含义**：「当前构建」是个移动目标。如果要为 18:20:21 那份（及之后的）构建出验收证据，需要重新挂载一次隔离宿主再跑本文的流程；本文的证据止于 sha256 `53eaa9c4…`。

**同源围栏**：无标记头 → `403`；`origin: http://example.com` → `403`；带 `x-myagent-request: 1` → `200`；未知路由 → `404 {"error":"No route for GET /myagent/api/nope"}`。

**路径穿越防护**（对 `tickets/d6398704…/file`）：

| 请求 | 结果 |
| --- | --- |
| `path=../../../../etc/passwd` | `400 {"error":"That path is outside this Ticket's directory"}` |
| `path=/etc/passwd` | `400 {"error":"That path is outside this Ticket's directory"}` |
| `path=RESULT.md/..` | `400 {"error":"RESULT.md/.. is a directory"}` |
| `path=nope.md` | `404 {"error":"There is no file at nope.md"}` |
| 无 `path` | `400 {"error":"A path is required"}` |
| 未知 Ticket | `404 {"error":"No Ticket has this id","code":"ticket_missing",…}` |

本次验收共产生 **5 张 Ticket**，全部在这个隔离状态目录里：

| id[:8] | 标题 | via | 最终 stage |
| --- | --- | --- | --- |
| `d6398704` | 验收-当前构建-完整一张 | inbox | `done` |
| `7e6dfc29` | 附件-两个同名文件 | inbox | `done` |
| `5ae4c3f7` | 附件-路径不存在 | inbox | `failed`（prepare） |
| `12ae32cc` | 阻塞识别-等待中的工作者 | inbox | `waiting`→`failed`(gaveUp)→`failed`(blocked)→retry→`done` |
| `d43e7ba6` | 验收-面板派活-停止 | **session** | `stopped` |

---

## 1. 一张完整 Ticket（P0 项）

**触发**：18:05:48 往 `~/.dsh/state/myagent-acceptance/inbox/current-build-full-ticket.md` 丢一个 615 字节的 `.md`（front matter `title:` + `scope:`，正文四步：`date` / `pwd` / 写 `evidence.txt` / `wc -c`）。`inbox.pollMs` 已由 `PUT settings` 调到 1000。

**EXPECTED**：Decision `accepted`；stage `pending → running → done`；`RESULT.md` 落在 Ticket 自己的目录且 `Authorized by:` 正确；主 Session 收到一条摘要 ≤120 字的 notice；`deliveryError` 为空；`effects` 回到 0 行；运行中 `GET progress` 有 `turn >= 2`、非空 `lastSaid`、`recentTools` 倒序。

**OBSERVED**

- Trigger：`id=2a984415eec79d1788356c323394118a`，`source=inbox`，`at=2026-11-03T10:05:48.048Z`，`actor={id:operator,kind:person}`，`disposition={state:"accepted", ticketId:"d6398704…", decisionId:"bb4781e5…"}`。
- Decision：`{"id":"bb4781e5e316004874f9be757da64b1e","outcome":"accept","reason":"accepted","reasonText":"The gate admitted this request.","ticketId":"d6398704…","policyVersion":"72b190e0f6c8cb9b"}`。
- inbox 文件被移走并盖戳：`inbox/accepted/2026-11-03T10-05-49-219Z-current-build-full-ticket.md`，首行 `<!-- myagent: Ticket d6398704fa7302e217f7e8b76111ce29 -->`。
- Ticket：`id=d6398704fa7302e217f7e8b76111ce29`，`stage=done`，`outcome=done`，`endedReason="The worker reported ready"`，`createdAt=10:05:49.215Z`，`ended={at:10:07:29.800Z, by:"agent", outcome:"done"}`，`directory=~/.dsh/state/myagent-acceptance/work/验收-当前构建-完整一张-d6398704`。
- Assignment：`state=ended`，`startedAt=10:05:49.234Z`，`deliveredAt=10:05:49.278Z`，`endedAt=10:07:29.800Z`，`endedReason=reported`，**`deliveryError` 字段在 JSON 里根本不出现**（`undefined`，即空）。
- `RESULT.md`（758 字节，18:07）：

  ```
  # 验收-当前构建-完整一张

  - Ticket: d6398704fa7302e217f7e8b76111ce29
  - State: ready
  - At: 2026-11-03T10:07:29.800Z
  - Authorized by: operator via inbox
  - Policy version: 72b190e0f6c8cb9b
  ```

- 产出 `evidence.txt`（115 字节）内容就是 worker 自己跑出来的：`2026-11-03 18:06:03 CST` + 它自己的目录绝对路径。
- notice 落进主 Session `myagent-acc-main`（`agent/inbox/spliced`，18:07:29.850）：`source={kind:"myagent", form:"notice"}`，`summary` **正好 120 字**（`len(summary) == 120`，尾部被截成 `…录了 bash \`date\` 输出的时间戳 2026-11…`），`target="next-step"`，正文 436 字。**整个主 Session 日志里没有任何 `turn/start`** → notice 没有唤醒它。
- `GET /api/effects` → `{"counts":{}}`；`GET /api/state` 的 `counts.effects` → `{}` → **0 行**。
- worker 会话日志（`…-d6398704--/worker-d6398704…`）：
  - 两段式重授权，本 Ticket 自己的时间戳：`18:05:49.229 permission/preset {"preset":"workspace-write"}` + `sandbox/mode {"mode":"workspace-write"}` + `approval/policy {"policy":"ask"}` → `18:05:49.233 permission/preset {"preset":"danger-full-access"}` + `sandbox/mode {"mode":"danger-full-access"}` + `approval/policy {"policy":"never"}`（4 ms 内完成；§2 的 `7e6dfc29` 在 18:16:07.724→.728 上重复了同一形状）。
  - `turn/end {"turn":1,"reason":{"kind":"completed"}}` → **收尾的 turn 没有被取消**。
  - `request/header` 里 worker 拿到 **19 个工具**：`bash, edit, glob, grep, interrupt_agent, job_kill, job_list, job_output, list_agents, list_subagent_models, myagent_report, read, read_image, send_message, skill, subagent, todo_write, web_fetch, write`；`ask_user_question / present / plugin_manager / schedule_create / create_goal / workflow` **都不在**。

**运行中的 progress**（`GET /api/tickets/d6398704…/progress`，1 秒一次连续采样 176 次，18:05:51–18:07:44，全部对着**未结束**的 Ticket）：

```
18:06:04 turn=1 tools=['bash','bash']                        lastSaid=''
18:06:25 turn=1 tools=['glob','bash','bash']                 lastSaid=''
18:07:00 turn=1 tools=['write','glob','bash','bash']         lastSaid=''
18:07:30 turn=1 tools=['myagent_report','read','bash','write','glob','bash','bash'] lastSaid=''
18:07:44 status=idle turn=1 …                                lastSaid="四步全部执行完成，Ticket 已 ready。…"
```

结束后同一份 progress 的完整字段：

```json
{ "sessionId":"worker-d6398704fa7302e217f7e8b76111ce29", "loaded":true, "agentStatus":"idle", "turn":1,
  "lastSaid":"四步全部执行完成，Ticket 已 ready。\n\n1. `date '+%Y-%m-%d %H:%M:%S %Z'` → …",
  "lastEventAt":"2026-11-03T10:07:44.796Z",
  "recentTools":[ {"name":"myagent_report","at":"…10:07:29.780Z"}, {"name":"read","at":"…10:07:14.815Z"},
                  {"name":"bash","at":"…10:07:07.115Z"}, {"name":"write","at":"…10:07:00.190Z"},
                  {"name":"glob","at":"…10:06:24.017Z"}, {"name":"bash","at":"…10:06:03.846Z"},
                  {"name":"bash","at":"…10:06:03.828Z"} ],
  "assignment":{ "id":"ccac85a7…","state":"ended","startedAt":"…10:05:49.234Z","deliveredAt":"…10:05:49.278Z" } }
```

`recentTools` 的时间戳严格递减（10:07:29.780 → 10:07:14.815 → 10:07:07.115 → 10:07:00.190 → 10:06:24.017 → 10:06:03.846 → 10:06:03.828）→ **倒序（newest-first）成立**。

**`turn >= 2` 这一条：本 Ticket 上是 FAIL（观测值 `turn=1`），但这不是缺陷，是期望写错了。** `progressOf()`（`src/app/runtime.ts:104-133`）取的是 DSH `turn/start` 事件里的 `data.turn`，也就是**会话轮次序号**，不是模型往返次数或工具调用次数。一次 launch 只投递一条 Input，因此只有一个 turn；无论它内部调了多少次工具，`turn` 都是 1。`turn >= 2` 只有在**同一个 Session 收到第二条 Input**（`/note`、`/answer`、`/retry`）之后才可能出现，本文在 §1b 与 §5 里都拿到了。

### 1b. `turn >= 2` 的真证据（对运行中的 worker）

- Ticket `12ae32cc`（§3 用的那张）在收到第二条 Input 后：`GET progress` → `"turn": 2`（18:37:36 实测），`recentTools` 仍倒序（10:25:51.383 → 10:25:41.940 → 10:25:36.530），`lastSaid` 非空。
- Ticket `d43e7ba6`（§5 的 `/note`）：`18:42:55 status=running turn=2` —— **对着一个正在跑 turn 的 worker 采到的**。

### 1c. `pending → running` 没有被直接观测到

诚实记录：`pending` 这个 stage 我**一次都没在轮询里抓到**。5 张 Ticket 的最早一次采样都已经是 `running`（`d6398704` 在 18:05:51 已 `running`；`7e6dfc29` 在 18:16:08.517 已 `running`；间隔 0.3–1 秒的轮询也没抓到）。原因是 launch 效果在同一个 pass 里就被取走了，`pending` 的窗口小于采样间隔。可观测到的替代证据：`POST /retry` 的响应里 `stage="pending"`、`assignments[-1]={state:"pending", startedAt:null}`（18:43:54，见 §5），以及 Assignment 的 `createdAt(10:05:49.215Z) → startedAt(10:05:49.234Z)` 之间那 19 ms 就是 `pending` 期。

**VERDICT**

| 子项 | 判定 |
| --- | --- |
| Decision `accepted` | **PASS** |
| stage  progression | **PASS（`running → done` 直接观测；`pending` 只在 `/retry` 响应与时间戳差里间接可见，见 §1c）** |
| `RESULT.md` + `Authorized by: operator via inbox` | **PASS** |
| 主 Session notice，摘要 ≤120 字，不唤醒 | **PASS**（正好 120 字，无 `turn/start`） |
| `deliveryError` 为空 | **PASS** |
| `effects` 回 0 行 | **PASS** |
| progress：`lastSaid` 非空、`recentTools` 倒序、对运行中的 worker | **PASS** |
| progress：`turn >= 2` | **FAIL as stated / PASS as specified**：单次 launch 下 `turn` 恒为 1（DSH 的轮次序号）；两条 Input 之后实测 `turn=2`（§1b） |

---

## 2. 附件全链路

### 2a. 正例：两个同名文件

**触发**：18:16:06 往 inbox 丢 `attachments-two-same-name.md`，front matter：

```
attach: /tmp/myagent-acceptance/att-a/report.csv, /tmp/myagent-acceptance/att-b/report.csv, /tmp/myagent-acceptance/att-a/notes.txt
```

两个源文件同名不同内容：`att-a/report.csv` 31 B（sha256 `eace399d…`），`att-b/report.csv` 35 B（sha256 `75693a91…`），`att-a/notes.txt` 39 B。

**EXPECTED**：`attachments/<name>` 与 `attachments/<name>-2.<ext>` 在 worker 第一轮**之前**就位；ticketView 暴露 `attachments`；worker 的任务文本列出这些副本。

**OBSERVED**

- `ticketView.attachments`（18:16:08.517，Ticket 刚 `running`）：

  ```json
  [{"name":"report.csv","source":"/tmp/myagent-acceptance/att-a/report.csv"},
   {"name":"report-2.csv","source":"/tmp/myagent-acceptance/att-b/report.csv"},
   {"name":"notes.txt","source":"/tmp/myagent-acceptance/att-a/notes.txt"}]
  ```

  → **`-2` 改名成立**，且保留了扩展名（`report-2.csv`，不是 `report-2`）。
- 磁盘上的副本与时间线（0.3 秒一次连续采样 176 次，值全程不变）：

  ```
  dir attachments/ = ['notes.txt','report-2.csv','report.csv']
    [notes.txt 39B mtime=18:16:07.709] [report-2.csv 35B mtime=18:16:07.709] [report.csv 31B mtime=18:16:07.709]
  ```

  字节数与源文件一一对应（31/35/39），**没有互相覆盖**。
- **"在第一轮之前"是硬证据**：Ticket `createdAt=10:16:07.706Z`，三个副本 mtime `18:16:07.709`，Assignment `deliveredAt=10:16:07.776Z`，worker 日志 `turn/start {"turn":1}` 在 `18:16:07.765`。副本比 `turn/start` 早 **56 ms**，比 `deliveredAt` 早 **67 ms**。
- worker 任务文本里确实列了副本（会话日志 `user/message id=myagent:launch:c534d164…` 原文）：

  ```
  ## Files that came with the request
  They are copied into `attachments/` inside your directory, so work from those copies:
  - attachments/report.csv (copied from /tmp/myagent-acceptance/att-a/report.csv)
  - attachments/report-2.csv (copied from /tmp/myagent-acceptance/att-b/report.csv)
  - attachments/notes.txt (copied from /tmp/myagent-acceptance/att-a/notes.txt)
  ```

- 结果：`stage=done`，`ended={at:10:17:23.383Z, by:"agent", outcome:"done"}`，`deliveryError` 不出现，worker 报告 `state=ready`，summary 自己说清了改名：「`report-2.csv`（35 字节，来自 `/tmp/myagent-acceptance/att-b/report.csv`，即与前者同名的另一个 `report.csv`，复制时被改名）」。产出 `att-report.md`（2161 字节）。

**VERDICT：PASS**

### 2b. 反例：`attach:` 路径不存在

**触发**：18:19:34 丢 `attachments-missing-path.md`，`attach: /tmp/myagent-acceptance/att-a/notes.txt, /tmp/myagent-acceptance/does-not-exist-9f3a.csv`（第二个不存在）。

**EXPECTED**：Ticket 以 `failed` 结束，摘要点名那个路径，**不起 worker**。

**OBSERVED**（Ticket `5ae4c3f7e21b79912d83613afd0e98b5`，`createdAt=10:19:36.181Z`，`ended.at=10:19:36.193Z`，全过程 12 ms）

```
stage = failed | outcome = failed | ended.by = "system"
endedReason = "Prepare failed: The attached file /tmp/myagent-acceptance/does-not-exist-9f3a.csv
  could not be copied into the Ticket's directory: Error: ENOENT: no such file or directory,
  copyfile '/tmp/myagent-acceptance/does-not-exist-9f3a.csv' ->
  '~/.dsh/state/myagent-acceptance/work/附件-路径不存在-5ae4c3f7/attachments/does-not-exist-9f3a.csv'"
```

**没有起 worker**，三条独立证据：

1. `GET progress` → `{"loaded": false, "recentTools": [], "assignment":{"id":"236dde83…","state":"ended"}}`（没有 `agentStatus`、没有 `turn`）；
2. `ticketView.execution` 里**没有 `sessionId`** 字段；
3. `ls -d ~/.dsh/sessions/*5ae4c3f7*` → **NONE**（连会话目录都没建）。

健康板：`executor: {ok:false, detail:"Prepare failed for 5ae4c3f7…: The attached file /tmp/myagent-acceptance/does-not-exist-9f3a.csv …"}`。

**VERDICT：PASS**（`failed` + 点名路径 + 不起 worker，三条都对）

**但有三条附带事实要记下来**（详见 §Bug B2）：这张 Ticket `reports: []`（**没有 Report 记录**，失败只写在 `ended.reason` 里），`waitsForPerson=false`，`counts.attention=0`，`tickets?state=attention` 里查不到它，**没有 `RESULT.md`**，**主 Session 一条 notice 都没收到**。目录里留下一个只复制了一半的 `attachments/`（`notes.txt` 39 B 在里面，缺的那个不在）。

---

## 3. blocked-turn 识别（不可运行的 Session）

**怎么造出来的**：DSH 的 `archived-session-gate`（`packages/api/session-controller/src/archived-session-gate.ts`）会对**已归档 Session** 的每一步 `agent/pre-step` 返回 `{kind:'reject'}`，而 `packages/core/agent-loop/src/agent.ts:349` 把 reject 收成为 `turnEnds = {kind:'blocked'}`。它的文档注释正好描述了 myagent 依赖的语义：*"A late waking delivery to an archived Session … proposes a step the gate rejects, which the loop ends as `blocked` without a request."*

步骤（全部对隔离宿主）：

1. 18:25:30 inbox 投 `blocked-detection.md`，让 worker 跑 `echo ready-to-wait` 后调 `myagent_report(state=waiting, question="要我继续吗？")`。Ticket `12ae32cc0fd1c13b843e16b430651271`：18:25:42 `stage=waiting`、`assignment.state=running`、`report.state=waiting`、`assignments=1`，`progress.agentStatus=idle`。
2. 18:28:29 用 DSH 自己的 RPC 归档那个 worker Session（cookie 由 `GET /?token=…` 换来）：

   ```
   POST /api/workspace/archiveSession
   {"type":"client-request","rpcId":"33333333-…","method":"workspace/archiveSession",
    "payload":{"args":{"request":{"sessionId":"worker-12ae32cc0fd1c13b843e16b430651271","stopActivity":false}}}}
   → {"ok":true,"value":{"archivedSessionIds":[… "worker-12ae32cc0fd1c13b843e16b430651271"]}}
   ```

3. 18:35:05 `POST /api/tickets/12ae32cc…/answer`（`{"text":"继续。请运行 echo woke-after-archive …"}`）唤醒它。

**EXPECTED**：`failed` 的 Report，摘要说这个 Session 跑不起来；一条健康问题；**不自动开新 Assignment**。

**OBSERVED**

- worker 会话日志（同一个 Session 的完整轮次史）：

  ```
  18:25:30.288 turn/start {"turn":1}
  18:25:59.910 turn/end   {"turn":1,"reason":{"kind":"completed"}}
  18:35:05.550 turn/start {"turn":2}
  18:35:05.566 turn/end   {"turn":2,"reason":{"kind":"blocked"}}      ← 16 ms，中间没有 step/start，没有 request/header
  ```

  即：**turn 开了、模型一次都没被请求、直接以 blocked 收尾**。
- Ticket 上的 Report（`10:35:05.567Z`，比 `turn/end` 晚 1 ms）：

  ```json
  {"state":"failed",
   "summary":"The worker Session could not run: DSH ended its turn as blocked before any model request, so nothing was produced. Retrying reuses this same Session and ends the same way. Stop this Ticket and open a new one for the work; its directory is left exactly as it was, so a new Ticket can continue from whatever is in it.",
   "at":"2026-11-03T10:35:05.567Z"}
  ```

- 健康问题：`sessions: {ok:false, detail:"Ticket 12ae32cc0fd1c13b843e16b430651271: its Session ended the turn as blocked without reaching the model", at:"2026-11-03T10:35:05.567Z"}`。
- **没有自动开新 Assignment**：`assignments` 仍然是 **1 条**，id 仍是 `4afa2959c85329601a3f164f73b66bc4`，`state` 仍是 `running`（`/answer` 因为当前 Assignment 未结束而复用了它，符合 `engine.answer()` 的 `current.state === 'ended'` 判断）。
- 附带：两条积压的 Input（18:29 的 note + 18:35 的 answer）都盖上了 `deliveredAt`（`10:35:05.562Z` / `10:35:05.573Z`）。
- 与旧行为的对比：旧标本 `19e4bab1` 是 6 个 Assignment 全 `waiting`；这次是**一条 Assignment、一个 `failed` Report、一条健康问题、零个新 Assignment**。行为确实换了。

**VERDICT：PASS**（三条期望全部命中；构造方式已写明，可复现）

**收尾**：18:37 `POST /api/workspace/unarchiveSession` 把它从归档集合里撤掉（`ok:true`，归档数 38 → 37，`worker-12ae32cc…` 已不在列表里）。归档集合存在 DSH 共享的 `~/.dsh/storages/workspace.json` 里，所以这一步是**必须的复原**，已做。

---

## 4. 效果队列的放弃路径

**怎么造出来的**：不是我刻意注入的故障——它是 §Bug B3 自己触发的，因此这条证据同时是那个 bug 的现场。

18:29:09 对一张 `attention` 未清、`report.state=waiting` 的 Ticket `12ae32cc` 发了一条 **note**。`executor.deliverInputs()`（`src/app/executor.ts:289`）判定「不是 answer 的 Input 要等人」，于是 `throw new Later(SLOT_RETRY_MS)`；但 `Effects.settle()` 只认**返回**的 `Later`，抛出来的当成失败计数。

**EXPECTED**：5 次失败 + 退避之后，`gaveUp` 在 **Ticket 上**记一条 `failed` Report（不只是健康板一行），并且 Ticket 变成可重试。

**OBSERVED**

- 健康板逐次计数（`effects` 条目）：

  | 时刻（CST） | detail |
  | --- | --- |
  | 18:29:09.836 | `input failed 1 of 5 times: Later: deferred` |
  | 18:30:55.696 | `input failed 4 of 5 times: Later: deferred` |
  | 18:32:55.792 | `input 6f4d1b6d43ce7c747889f25b0e778e0a gave up: Later: deferred` |

- 退避曲线与 `backoff(failures, cap) = min(cap, 15000·2^(failures-1))` 对得上：18:29:09.836 → +15 s → +30 s → +60 s → 18:30:55.696（第 4 次）→ +120 s → 18:32:55.792（第 5 次，放弃）。观测值与公式差 ≤1 s。
- **Ticket 上真的多了一条 `failed` Report**（不只是健康板）：

  ```json
  "assignment.report": {"state":"failed",
    "summary":"Handing your work to the worker gave up after repeated attempts: Later: deferred",
    "at":"2026-11-03T10:32:55.792Z"}
  ```

  `stage` 从 `waiting` 变 `failed`，`waitsForPerson=true`，`counts.attention=1`，`tickets?state=attention` → `[('12ae32cc','failed','Handing your work to the worker gave up after attem…')]`。
- `counts.effects` 回到 `{}`（放弃时 `settleEffect` 把行删了）；只读查库 `select * from effects` → **0 行**。
- **可重试**：`canRetry()` 走 `waitsForPerson(ticket)` 分支返回 true；18:43:54 `POST /api/tickets/12ae32cc…/retry` → `200`，旧 Assignment 结束、新 Assignment `565673a6db57f46387777fa227432bd9` 以 `pending` 出现（见 §5）。它真的跑完了：`turn/start {"turn":3}` 18:43:54.469 →`turn/end {"turn":3,"reason":{"kind":"completed"}}` 18:44:16.188，`report=ready`，`stage=done`，`ended={at:10:44:08.417Z, by:"agent", outcome:"done"}`，`RESULT.md` 写好（`Authorized by: operator via inbox`），**同一个目录**（`…/阻塞识别-等待中的工作者-12ae32cc`）、**同一个 Session**。

**VERDICT：PASS**（机制完全按预期工作）——**但触发它的输入是一个 bug**，所以这一行"live"要连着 B3 一起读：正常语义下（真的投递失败）它同样会走到这里，只是今天线上还没发生过真的投递失败。

---

## 5. 写路由与操作者动词（当前构建）

全部对 `http://127.0.0.1:3180/myagent/api/…`，都带 `x-myagent-request: 1`。

| 动词 | 何时 | 请求 | 观测到的响应 / 后果 | 判定 |
| --- | --- | --- | --- | --- |
| `PUT settings` | 18:00:15 | `acceptMode:auto, executor.maxWorkers:1, sources.inbox.pollMs:1000` | `settingsRevision 0 → 1`；重启后（18:03:36 新进程）读回来仍是 `revision=1, acceptMode=auto, maxWorkers=1, pollMs=1000` → **设置跨重启持久** | **PASS** |
| `POST main-session` | 18:04:58 | — | `{"sessionId":"myagent-acc-main"}`；`state.mainSession.exists=true, running=true` | **PASS**（但见 B1：默认 id 会撞） |
| `POST tickets`（面板派活表单） | 18:40:10 | `title/request/sender/scope` | `{"stored":"stored","disposition":"accepted","ticketId":"d43e7ba6190d137f42468f69d331d629","reason":"accepted","acceptMode":"auto"}`；该 Ticket 的 **`via` 字段 = `session`**（轮询里 `waiting\|running\|session`）——**线上第一张 `via=session` 的 Ticket** | **PASS** |
| `PUT prompts` | 18:38:54 | `{"worker": <内置 prompts/worker.md + 一段带 MARKER-PROMPT-OVERRIDE-7f31 的覆盖>}` | `{"revision":1}`（原 0）；`GET prompts` → `worker chars=3458, override 已设, pinsBase=false, MARKER present=True` | **PASS** |
| ↳ 后来的 worker 拿到覆盖了吗 | 18:40:10 起的 `d43e7ba6` | — | 该 worker 会话日志的 `system/message`（turn 1 step 1）里 marker 出现在 char 3536，小节标题 `## 验收标记（本次 PUT prompts 写入的覆盖）` 在；**worker 的第一条 assistant 文本就是 `MARKER-PROMPT-OVERRIDE-7f31`** | **PASS** |
| ↳ 已存在的 worker 也重新装配了吗 | `12ae32cc` 的 retry | — | 同一个 Session：`turn=1 step=1` 的 `system/message` **marker=False**（len 8127，PUT 之前）；`turn=3 step=1` 的 **marker=True**（len 9236，PUT 之后）→ revision 变化会让老 worker 在下一步拿到新提示词 | **PASS** |
| `POST tickets/:id/note` | 18:42:55（`d43e7ba6` 运行中） | `{"text":"补充一步：现在用 bash 运行 sleep 25 …"}` | `200`；1 秒内 `progress` → `status=running turn=2`；worker 日志 `turn/start {"turn":2}` 18:42:55.937 | **PASS** |
| `POST tickets/:id/stop` | 18:42:55.3 | `{"reason":"验收：中途停止，验证 turn 取消与后台作业被收掉"}` | 响应 `stage=stopped`，`ended={at:10:42:56.008Z, by:"person", outcome:"stopped", reason:"验收：中途停止，…"}`，`assignment.state=ended, endedReason=stopped` | **PASS** |
| ↳ `turn/end` 原因 | — | — | `18:42:56.011 turn/end {"turn":2,"reason":{"kind":"aborted","reason":{"kind":"user"}}}`（stop 后 3 ms） | **PASS** |
| ↳ 后台作业 `job/settled` | — | — | `18:42:56.013 job/settled {"jobId":"bash-52ff555656d347d8","kind":"bash","label":"sleep 300","status":"killed","cause":"kill","producerReported":true,"detail":"signal: SIGTERM; 验收：中途停止，验证 turn 取消与后台作业被收掉"}`（turn 被取消后 2 ms；**停止原因被带进了 kill detail**） | **PASS** |
| `POST tickets/:id/retry` | 18:43:54（对 gave-up 的 `12ae32cc`） | — | `200`；`stage=pending`；`assignments` 变 2 条：`4afa2959…` `state=ended`、新的 `565673a6…` `state=pending, startedAt=null`；随后真跑到 `done`（§4） | **PASS** |
| `POST decisions/:id/dismiss` | 18:43:54 与 18:50 | 对 `303a2116…`（附件反例那条 Decision） | `{"dismissed":"303a2116…","decision":{… "detail":"[dismissed]\n[dismissed]" …}}` | **PASS**（但**不幂等**：调两次就叠两行 `[dismissed]`） |
| `POST pass` | 18:43:54 | — | `{"requested":true,"effects":{}}` | **PASS** |
| `PUT settings`（改排期） | 18:45:42 / 18:46:17 / 18:46:4x | 见 §6 | `settingsRevision 1 → 2 → 3 → 4` | **PASS** |
| `POST tickets/:id/answer` | 18:35:05 | 见 §3 | `200`，Input `kind=text` 立刻投递（`deliveredAt=10:35:05.573Z`），并触发了 blocked 识别 | **PASS** |

**关于 `answer` vs `note` 的语义差异，现场抓到了**：同一张 `attention` 未清的 Ticket，18:29:09 的 **note** 被推迟（进效果队列，最后给了它一张 `failed` Report，§4），18:35:05 的 **answer** 立刻投递。代码就是 `src/app/executor.ts:289` 那句 `if (ticket.attention !== undefined && input.kind !== 'text') throw new Later(SLOT_RETRY_MS)`。设计意图对，实现踩了 B3。

---

## 6. 排期在半途被改（cron 规则指纹的重算行为）

**EXPECTED**：建一条排期让它记下游标条目，然后 `PUT settings` 改时刻，Source 的 `status().next` 与面板的 `schedules/preview` **一致**地指向新时刻。

**OBSERVED**（排期 `accept-cron`，`kind=daily`，`timeZone=Asia/Shanghai`；`GET /api/schedules` 报的 `zone=Asia/Shanghai`，`now=11-03 18:47:15`）

| 步 | 动作 | `settingsRevision` | Source `status().next`（`GET /api/state` → `sources.cron.next`） | `POST /api/schedules/preview` → `next[0]` | 一致？ |
| --- | --- | --- | --- | --- | --- |
| 1 | 18:45:42 建排期，`time=23:11` | 2 | `1793718660000` = **2026-11-03 23:11:00 CST** | `2026-11-03T15:11:00.000Z` = **2026-11-03 23:11:00 CST** | **是** |
| 2 | 18:46:17 `PUT settings` 只把 `time` 改成 `23:45` | 3 | `1793720700000` = **2026-11-03 23:45:00 CST** | `2026-11-03T15:45:00.000Z` = **2026-11-03 23:45:00 CST** | **是** |
| 3 | 紧接 step2（18:46:17 之后同一分钟内）`PUT settings` 只改 `name`（时刻不动） | 4 | `1793720700000` = **2026-11-03 23:45:00 CST**（**没动**） | — | — |

`GET /api/schedules` 与预览的描述串也一致：`daily at 23:11 (Asia/Shanghai)` → `daily at 23:45 (Asia/Shanghai)`。

**游标里的规则指纹**（只读查 `kv` 表，`select value from kv where key='source:cron:cursor'`）：

```
step1 后： {"accept-cron":{"next":1793718660000,"missed":0,"spec":"{\"kind\":\"daily\",\"time\":\"23:11\",\"timeZone\":\"Asia/Shanghai\"}"}}
step2 后： {"accept-cron":{"next":1793720700000,"missed":0,"spec":"{\"kind\":\"daily\",\"time\":\"23:45\",\"timeZone\":\"Asia/Shanghai\"}"}}
step3 后： {"accept-cron":{"next":1793720700000,"missed":0,"spec":"{\"kind\":\"daily\",\"time\":\"23:45\",\"timeZone\":\"Asia/Shanghai\"}"}}   ← 未变
```

指纹 `spec` 持久化了；`spec` 变了 `next` 就重算（step2，`1793718660000 → 1793720700000`）；`spec` 没变就不重算（step3，`next` 与 `spec` 都原封不动）——正是 `src/sources/cron.ts:78-95` 那三条分支（`entry.spec === spec` → 跳过；`entry.spec === undefined` → 信任旧条目并补记指纹；否则重算）。

**VERDICT：PASS**。这正是 `docs/integration-checklist.md` 记的"改了排期的时刻不生效"那个 bug 的修复，第一次在真宿主上看到重算行为。

> 未验的部分：这条排期**没有真的到点触发过**（23:11 / 23:45 都在验收窗口之外，宿主 18:55 就停了）。所以「cron 正常触发（槽位精确）」与「宕机错过槽位折成一条」两行仍然只有旧代码的 live 证据。

---

## 7. `scripts/verify-live.sh` 对隔离宿主

18:47:14 跑 `PORT=3180 ./scripts/verify-live.sh`，原样输出（去掉 ANSI 色码）：

```
验证 http://127.0.0.1:3180/myagent
── 1. 插件挂载了
  ✓ 面板页（200）
── 2. 同源守卫（不该给的一律 403）
  ✓ 无标记头访问 API（403）
  ✓ 跨源 Origin（403）
  ✓ 带标记头访问 API（200）
── 3. 挂载期没有偷偷创建 Session
  · 主 Session exists=True id=myagent-acc-main
── 4. 健康板
  · 问题： [('effects', 'input 6f4d1b6d43ce7c747889f25b0e778e0a gave up: Later: deferred'),
            ('sessions', 'Ticket 12ae32cc0fd1c13b843e16b430651271: its Session ended the turn as blocked without reaching the model')]
  · 计数： {'open': 0, 'ended': 5, 'attention': 0, 'triggers': 5, 'decisions': 5, 'workerSlots': {'used': 0, 'max': 1}} | 队列： {}
  · 受理模式： auto | 暂停： False
  ✗ 健康板有问题（见上）
── 5. 排期与下次触发
  · 时区 Asia/Shanghai | 现在 11-03 18:47:15
  · accept-cron    启用 下次 11-03 23:45:00 | daily at 23:45 (Asia/Shanghai)
  ✓ 排期可读
── 6. 预览接口（写操作里唯一无害的一个，不落库）
  · 描述: daily at 09:00 (Asia/Shanghai)
  · 接下来三次（本地时间）: ['11-04 09:00', '11-05 09:00', '11-06 09:00']
  ✓ 预览返回三次触发
── 7. Ticket 列表与门禁记录可读
  · 共 5 张（只显示最新 5 张）
    d43e7ba6 | 验收-面板派活-停止         | stopped
    12ae32cc | 阻塞识别-等待中的工作者       | done
    5ae4c3f7 | 附件-路径不存在           | failed
    7e6dfc29 | 附件-两个同名文件          | done
    d6398704 | 验收-当前构建-完整一张       | done
  ✓ Ticket 列表可读
  · 门禁记录 5 条（最新 5 条）
    2026-11-03T10:40:10 | accept   | accepted | 验收-面板派活-停止
    2026-11-03T10:25:30 | accept   | accepted | 阻塞识别-等待中的工作者
    2026-11-03T10:19:36 | accept   | accepted | 附件-路径不存在
    2026-11-03T10:16:07 | accept   | accepted | 附件-两个同名文件
    2026-11-03T10:05:49 | accept   | accepted | 验收-当前构建-完整一张
  ✓ 门禁记录可读

通过 8 条，失败 1 条
EXIT CODE = 1
```

**VERDICT：脚本跑通了，8 过 1 失，退出码 1。**

唯一那条失败**不是**系统坏了，而是**健康板上留着两条我刚刚故意造出来的问题**（§4 的 gave-up 与 §3 的 blocked-turn）。脚本第 4 步的判据是：

```python
bad=[(k,v.get("detail")) for k,v in s["health"].items() if not v.get("ok",True)]
… sys.exit(1 if bad else 0)
```

也就是**只要健康板上有任何一条 `ok:false` 就退出 1**，不区分「系统自己坏了」和「上游/历史/预期内的问题」。

上游 429 会让它退出 1，这一点**当场就有实证**（不是我推的）：19:00:52 对日常宿主做一次只读 `GET http://127.0.0.1:3080/myagent/api/state`，它的健康板上正好只有一条问题，就是上游限流：

```json
"health": { "sessions": { "ok": false,
  "detail": "the main Session: LlmError: 429: {\"message\":\"Rate limit: 60 requests per minute per account. Retry after 3 seconds.\",\"type\":\"rate_limit_error\",\"param\":\"\",\"code\":\"rpm_exceeded\"}" } }
```

其余字段全部健康（`counts = {"open":0,"ended":8,"attention":0,"triggers":10,"decisions":10,"effects":{},"workerSlots":{"used":0,"max":2}}`，`settingsRevision=7`，`acceptMode=auto`）。按脚本第 4 步的判据，这一刻在日常宿主上跑 `./scripts/verify-live.sh` 会得到「通过 N 条，失败 1 条」并**退出 1**，而 myagent 本身什么都没坏——它只是把上游的一次 429 如实报在了健康板上（路径：`src/app/runtime.ts:566-571` 的 `agent/error` 监听器 → `this.health.entry('sessions').problem(detail)`）。

> 我没有真的对 3080 跑那个脚本：脚本第 6 步会 `POST /api/schedules/preview`，而任务规定对日常宿主只允许 GET。上面这条是用 GET 拿到的健康板 + 脚本自己的判据得出的。

**按要求不修，只记录**（§Bug B5）。

---

## 8. `docs/v2/00-audit-and-plan.md` §1 状态列的更新

「当前构建」= `lib/index.js` sha256 `53eaa9c4…`（mtime 17:45:18）。下表只列**本次动过的**行；没列到的行状态不变。

| §1 原行 | 原状态 | 新状态 | 本文证据 |
| --- | --- | --- | --- |
| cron **改时刻后重算 next** | `offline` | **`live`** | §6：step2 `next 1793718660000 → 1793720700000`，Source 与 preview 一致；step3 反例（只改名不重算） |
| cron 规则指纹持久化 | `live` | **`live`（当前构建）** | §6：游标 `spec` 三次读值，随时刻改变、不随名字改变 |
| inbox 扫描 / accepted / observed | `live` | **`partial`**：`accepted` = `live`（当前构建，5 个文件进 `accepted/` 且都带 `<!-- myagent: Ticket … -->`）；**`observed` 本次没跑**（全程 `acceptMode=auto`），仍只有旧代码证据 | §1、§2 |
| 门禁 + observe 模式 | `live` | **`partial`**：门禁 `accepted` = `live`（当前构建，5 条 Decision 全 `accept/accepted`，`policyVersion=72b190e0f6c8cb9b`）；**`observe` 模式与 observe→auto 切换本次没跑** | §1、§5 |
| Ticket/Assignment/Report 生命周期 | `live` | **`live`（当前构建）** | 5 张 Ticket：`ready`×3、`waiting`×1、`failed`×2（gave-up + blocked）、`stopped`×1、`retried`×1；`pending/running/ended` 三种 Assignment 状态都见过 |
| `blocked` / `failed` / `progress` 报告 | **`absent(live)`** | **`partial`**：`failed` 报告 = **`live`**（两条，§3 §4）；`progress` 报告 = 仍无 live；**`blocked` 报告与 relay（唤醒前台）= 仍无 live**（本次的 blocked 是 turn 层的，不是 worker 调 `myagent_report(state=blocked)`，所以走的是 `failed` + `notice`，主 Session 5 条全是 `form=notice`，没有一条 `relay`，也没有一次 `turn/start`） | §3、§4、§Bug 表下方 |
| worker 启动 + 每 Ticket 一个目录 | `live` | **`live`（当前构建）** | 5 个 `<slug>-<id[:8]>` 目录；retry 复用同一目录 |
| worker 权限两段式重授权 | `live` | **`live`（当前构建）** | §1：`workspace-write`+`ask` @18:16:07.724 → `danger-full-access`+`never` @18:16:07.728 |
| 停止 = 取消 turn + 杀作业 | `live` | **`live`（当前构建）** | §5：`turn/end{aborted,user}` @18:42:56.011 + `job/settled{status:killed, cause:kill, SIGTERM}` @18:42:56.013 |
| 收尾 turn 不取消 | `live` | **`live`（当前构建）** | `d6398704` turn1 `completed`；`7e6dfc29` turn1 `completed`；`12ae32cc` turn1/3/4 `completed`（stop 只取消了 turn2） |
| RESULT.md | `live` | **`live`（当前构建）** | 3 份（`d6398704` 758 B、`7e6dfc29`、`12ae32cc`），`Authorized by: operator via inbox`；`stopped` 的 `d43e7ba6` 与 prepare-failed 的 `5ae4c3f7` 正确地没有 |
| notice（不唤醒、120 字摘要） | `live` | **`live`（当前构建）** | 主 Session 5 条 `agent/inbox/spliced`，`form=notice`，每条 `len(summary)==120`，`target=next-step`，全程无 `turn/start` |
| 主 Session 按需创建 + 记录真实 id | `live` | **`live`（当前构建），但带 B1** | `POST /api/main-session` → `myagent-acc-main`，`exists=true`；默认 id 会跨部署相撞（B1） |
| 效果队列排空 | `live` | **`live`（当前构建）** | 每次结束后 `counts.effects={}`；只读查库 `effects` 0 行 |
| 效果队列**放弃路径**（5 次耗尽） | `offline` | **`live`** | §4：1/5 → 4/5 → gave up，退避 15/30/60/120 s 与公式吻合，Ticket 上落了 `failed` Report，且 retry 成功跑到 `done` |
| 单写者锁 | `live` | **`live`（当前构建）** | 隔离锁 `pid 72808`（token `2d1c1fff…`）与日常锁 `pid 24619`（token `fb8b230f…`）同时存在且互不干扰；停宿主后隔离锁文件消失 |
| 同源围栏 + 路径穿越防护 | `live` | **`live`（当前构建）** | §0：403/403/200/404 + 六种 file 路由坏输入 400/400/400/404/400/404 |
| 全部 12 个 GET 路由 | `live` | **`live`（当前构建）** | §0：12/12 → 200 |
| worker 工具白名单 | `live` | **`live`（当前构建）** | §1：19 个工具的完整名单，`myagent_report` 在，六个面向人的工具都不在 |
| 附件全链路 | **`offline`** | **`live`** | §2a 正例（`-2` 改名、比 `turn/start` 早 56 ms、任务文本列出副本）+ §2b 反例（`failed` + 点名路径 + 零 worker） |
| files/progress/recipes 对**运行中**的 worker | `offline` | **`partial → live（progress）`**：`progress` 对运行中的 worker 采样 176+ 次（含 `status=running turn=2`）；**`files`/`file` 只对已结束的 Ticket 查过**（200 + 正确的目录树与穿越防护），`recipes` 只在挂载后查过 | §1、§1b、§0 |
| blocked-turn 识别（不可运行的 Session） | `offline` | **`live`** | §3：归档 Session → `turn/end{blocked}`（16 ms，无模型请求）→ `failed` Report + `sessions` 健康问题 + Assignment 数不变 |
| 操作者动词：answer/note/dismiss/pass/PUT prompts/POST tickets | **`absent(live)`** | **`live`** | §5：六个全部命中，外加 `retry`、`stop`、`PUT settings`；`POST tickets` 产出线上第一张 `via=session` 的 Ticket；`PUT prompts` 的覆盖被后来的 worker 与已存在的 worker 都拿到 |
| 5s 前台→后台提升 | `live` | **`live`（未重新验证）**：本次的后台作业是模型自己传 `run_in_background:true` 起的（`tool/call bash {"command":"sleep 300","run_in_background":true}`），**不是 5 秒提升**。`job/registered`+`job/settled` 这对证据有，5 秒规则本身没被触发 | §5 |
| 幂等消息投递 | `offline` | `offline`（未变） | 只观测到 `deliveredAt` 都盖了戳、`requestId` 形如 `launch:<assignmentId>` / `input:<inputId>`；没有制造重复投递 |
| inbox `rejected/` 路径 | `offline` | `offline`（未变） | 隔离 inbox 里只有 `accepted/`（4 个文件），没有 `rejected/`，也没有 `observed/` |
| 桌面通知 | `offline` | `offline`（未变） | 全程 `notify.enabled=false`（新状态目录的默认值），没有可观测记录 |
| 面板行为（109 条 jsdom） | `offline` | `offline`（未变） | 没有真浏览器；只验了服务端字节一致 |
| 工具守卫（Ticket 结束后拒绝） | `offline` | `offline`（未变） | 没有对已结束的 Ticket 的 Session 发起工具调用 |
| subagent 在停止时被收掉 | `partial` | `partial`（未变） | 本次所有 scope 都写了「不调用 subagent」，没有子代理可收 |
| 崩溃恢复 / `maxWorkers=2` 并发 / 出厂配方 / cron 到点触发 / 宕机错过槽位 / LockHeld / SchemaTooNew | `live`/`offline` | **未变** | 本次没碰：没有杀进程、`maxWorkers` 全程为 1、没跑配方、没让槽位到点、没有让第二个写者去抢同一个状态目录 |
| Watchdog / Token 记账 / OS 级隔离 / 网络出口 / 外部副作用幂等 / 多 Worker 协作 / 产物注册 / DAG / 按来源策略 / Assessor 接缝 | `absent`/`design` | **未变** | 结构性缺口，不是一次验收能改的 |

**从 `offline`/`absent(live)` 升到 `live` 的行，一共 5 条**：cron 改时刻后重算 next、效果队列放弃路径、附件全链路、blocked-turn 识别、操作者动词。
**另有 12 条原来是"旧代码的 live"，现在拿到了当前构建的 live 证据**（见上表标 `live（当前构建）` 的行）。
**§0 那条支配全局的事实因此作废**：当前构建下已经有 5 张 Ticket 被创建、启动、投递、报告并结束过。

---

## 9. 本次发现的 bug 与意外（都只有证据，没有修）

### B1（高，可用性）默认 `mainSessionId: 'myagent-main'` 在同一个 DSH_HOME 下跨部署相撞

第一次 `POST /api/main-session`（18:00:46，隔离宿主，`stateDir=~/.dsh/state/myagent-acceptance`）返回：

```json
{"error":"RemoteError: session \"myagent-main\" belongs to \"~/.dsh/state/myagent/work\", not \"~/.dsh/state/myagent-acceptance/work\""}
```

原因：DSH 的 workspace 注册表把 session id 全局绑到创建它的 workspace。`~/.dsh/storages/workspace.json` 里就有：

```json
"<uuid-sha256:76782a0f20a2>": {"path":"~/.dsh/state/myagent/work","title":"work",
  "sessionIds":["myagent-main"], "createdAt":"2026-11-02T15:12:26.803Z"}
```

`src/deployment.ts:33` 的默认值是常量 `'myagent-main'`，`src/deployment.ts:85-86` 也只在为空时回落到它。于是**同一台机器上第二个 myagent 部署（不同 `stateDir`）永远建不出主 Session**，除非显式配 `mainSessionId`。

后果不止是报错：`sessions.notify()`（`src/app/sessions.ts:393-397`）与 `relay()` 在 `resumeMaster()` 返回 `undefined` 时**静默 return**，所以这种部署下所有报告都送不到前台，而且健康板不会因此变红。本次靠覆盖层写 `mainSessionId: myagent-acc-main` 绕过（18:04:58 → `{"sessionId":"myagent-acc-main"}`）。

建议方向（不在本次范围内实施）：默认值从 `stateDir` 派生（例如 `myagent-main-<stateDir 的短哈希>`），或在 `createMainSession()` 拿到这种 RemoteError 时写一条健康问题，而不是静默丢弃报告。

### B2（中，诚实性）prepare 失败的 Ticket 对操作者是隐形的

Ticket `5ae4c3f7`（§2b）：`stage=failed`、`outcome=failed`、`ended.by=system`，但

- `reports: []` —— **没有 Report 记录**，失败原因只在 `ended.reason` / `endedReason` 里；
- `waitsForPerson: false`，`counts.attention: 0`，`GET /api/tickets?state=attention` 查不到它；
- **没有 `RESULT.md`**（`ENDING` 里含 `failed`，但那条路径是 `delivery.report()` 触发的，prepare 失败走的是 `engine.failTicket()`，不经过 Report）；
- **主 Session 一条 notice 都没收到**（整个验收期间主 Session 只有 5 条 spliced，全部对应另外 4 张 Ticket）。

也就是说：一个附件路径写错，Ticket 会安静地变成 `failed`，只在面板的 Ticket 列表和一条 `executor` 健康问题里可见。`failTicket()` 若改成走 `report(ticketId, {state:'failed', …})`，上面四条会一起好。

附带观察：失败时目录里留下**复制了一半的 `attachments/`**（`notes.txt` 39 B 在，缺的那个不在）。`README.md:213` 说"prepare 命令失败不重试，半成品目录在下次尝试看来像是准备好了"——那句话讲的是 `prepare` shell 命令，但附件复制的半成品是同一个形状的风险。

### B3（**高，可用性**）`Later` 被"抛"出来而不是"返回"，于是每一次合法推迟都算一次失败，5 次之后把 Ticket 判死

- `src/app/effects.ts:11-17` 的类文档写着 **"Thrown by a handler whose work is not runnable yet; the effect is deferred without counting a failure."**
- `src/app/effects.ts:30-32` 的选项文档写着 **"a `Later` never counts against it"**
- 但 `src/app/effects.ts:104-125` 的实现只认**返回值**：`const result = await handler(payload); if (result instanceof Later) { deferEffect… }`；**抛出来的 `Later` 落进 `catch`**，走 `failEffect` + `health.problem(\`${kind} failed ${next} of ${this.tries} times\`)`，第 5 次触发 `onPermanentFailure` → `gaveUp`。
- 而 `src/app/executor.ts` 的**全部 5 个 `Later` 调用点都是 `throw`**：`:145`（正在 halt）、`:147`（`settings.paused`）、`:148`（**worker 槽位满了**）、`:154`（正在关闭）、`:289`（Ticket 等人时的非 answer Input）、`:291`（`deliverInputs` 里的 paused）。

现场证据（§4）：一条 note 投给一张等人的 Ticket → `input failed 1 of 5 times: Later: deferred`（18:29:09.836）→ `4 of 5`（18:30:55.696）→ `input … gave up: Later: deferred`（18:32:55.792）→ Ticket 上多了一条 `failed` Report，摘要 `Handing your work to the worker gave up after repeated attempts: Later: deferred`。

**这意味着两条会伤人的路径**：

1. **给一张"等人"的 Ticket 加一条 note，约 4 分钟后这张 Ticket 会被判 `failed`**，理由是 `Later: deferred` —— 而系统设计上那条 note 本来只是要等到人回答之后再送出去。
2. **`paused: true` 或 worker 槽位排队超过 5 个退避周期（约 15+30+60+120 s ≈ 3.75 分钟）的 launch，会被永久判死**，摘要同样是 `Later: deferred`。`maxWorkers=1` 时只要队列里有 2 张 Ticket、前一张跑过 4 分钟，后一张就会被打死。日常宿主是 `maxWorkers=2`、8 张 Ticket 都在 15 分钟内跑完，所以线上从没暴露过。

修法很小（`throw` 改 `return`，或 `settle()` 的 catch 里先判 `error instanceof Later` 走 defer 分支），但**本次不改**。

### B4（**高，可用性/成本**）`myagent_report` 在非终态报告时返回 `outcome: undefined`，被 DSH 判为非法工具输出

`src/app/tools.ts:83-88`：

```js
return { ticket_id: ticketId, state: args.state, stage: ticketStage(updated),
         ended: updated.ended !== undefined, outcome: updated.ended?.outcome, … }
```

Ticket 没结束时 `updated.ended === undefined` → `outcome` 这个**键存在但值是 `undefined`** → DSH 的无损 JSON 校验拒绝它。

现场证据（Ticket `12ae32cc`，worker 会话日志）：

```
18:25:41.940 tool/call   myagent_report {"state":"waiting","summary":"我在等操作者的一句话","question":"要我继续吗？"}
18:25:41.957 tool/result isError=true  content="Error: tool \"myagent_report\" returned invalid output: value is not lossless JSON"
                                        error={"name":"ToolOutputError","code":"INVALID_TOOL_OUTPUT"}
18:25:51.383 tool/call   myagent_report {"question":"要我继续吗？","state":"waiting","summary":"我在等操作者的一句话"}
18:25:51.398 tool/result isError=true  同上
```

而报告**其实落库了**：Ticket 上 `report={"state":"waiting","summary":"我在等操作者的一句话","question":"要我继续吗？","at":"2026-11-03T10:25:51.395Z"}`（时间戳正好夹在第二次 `tool/call` 与它的错误 `tool/result` 之间）。worker 自己在 `lastSaid` 里写道：

> `myagent_report(state=waiting, …)` 连续两次调用均返回 harness 侧错误：`tool "myagent_report" returned invalid output: value is not lossless JSON`，报告未能落库。

对照组：两张 `state=ready` 的 Ticket（`d6398704`、`7e6dfc29`）的 `myagent_report` **没有**报错——因为那时 `ended` 有值、`outcome` 是 `'done'`，整个返回值都是合法 JSON。

所以受影响的是 **`progress` / `waiting` / `blocked` 以及未终态的 `failed`**，即所有"我还没做完"的报告：worker 看到工具报错 → 以为没报上 → 重试（白花一轮和一次模型调用）→ 还是报错 → 很可能在"报告失败"的认知下结束回合，落到 `turnEnded` 的 `waiting` 兜底上。修法同样很小（`outcome` 只在 `ended !== undefined` 时展开，或写成 `outcome: updated.ended?.outcome ?? null`），**本次不改**。

### B5（低，工具）`verify-live.sh` 把"健康板上有任何问题"一律当成失败

见 §7。判据是 `sys.exit(1 if bad else 0)`，不区分问题的来源与新旧。本次退出码 1 完全由两条**预期内**的问题造成；同理，一次上游 provider 429（经 `src/app/runtime.ts:566-571` 的 `agent/error` → `health.entry('sessions').problem(…)`）也会让它退出 1，看起来像"插件坏了"。**按要求不修。**

### B6（低，幂等）`POST decisions/:id/dismiss` 不幂等

`src/core/engine.ts:337-343` 每次都往 `detail` 后面追加一行 `[dismissed]`。对同一条 Decision 调两次的实测结果：`"detail": "[dismissed]\n[dismissed]"`。

### B7（低，已知项复现）诊断文件里出现被序列化的 Volatile

`~/.dsh/state/myagent-acceptance/myagent.json`：

```json
{"pid":72808,"stateDir":"…","workRoot":"…","inboxDir":"…","mainSessionId":"myagent-acc-main",
 "promptMaxChars":{},"at":"2026-11-03T10:03:36.698Z"}
```

`promptMaxChars` 写成 `{}` —— 就是 §1 表外的 S15（`writeMarker` 把一个 Volatile 序列化进了诊断文件），在当前构建下**依然存在**。

### 不算 bug 但值得记的两条意外

- **`progress.turn` 的语义与任务书里的期望不符**：它是 DSH 的会话轮次序号（`turn/start` 的 `data.turn`），一次 launch 恒为 1。想要 `>= 2` 必须有第二条 Input。见 §1、§1b。
- **`stopped` 的 Ticket 不发 notice**：`d43e7ba6` 停止后主 Session 没有任何 spliced。这是 `delivery.ts:24` 的 `TOLD = ['ready','blocked','failed','dropped']` 决定的，符合设计（操作者亲手停的，不用告诉他），只是要记住"停了就没消息"。

---

## 10. 没有验的东西，以及为什么

| 没验 | 为什么 |
| --- | --- |
| cron **到点真的触发** / 宕机错过槽位折成一条 | §6 的排期定在 23:11 与 23:45，验收窗口 18:00–18:55，宿主已停。要验就得让宿主跨过槽位，或者用 `every 60s` 的排期——后者会不断生成真 Ticket 与真模型调用，成本与噪声都不划算。这两行仍只有旧代码的 live 证据 |
| `observe` 受理模式、`observed/` 目录、observe→auto 切换 | 隔离状态目录一开始就必须是 `auto` 才能跑 §1，之后没有再切回去。要验的话得再投一个文件并把 `acceptMode` 改回 `observe`——机制未变，优先级低于本次的 7 项 |
| inbox `rejected/` 路径 | 需要一个被门禁**拒绝**的请求（例如 `sender` 不在 `allowedSenders` 里、或空正文）。本次 5 个请求全部 `accept`，所以 `rejected/` 目录一次都没生成 |
| 锁**拒绝第二个写者**（`LockHeld`） | 唯一干净的做法是在同一个隔离状态目录上再起一个宿主。那需要第二个 DSH 进程去读写共享的 `~/.dsh/storages/workspace.json` 与会话存储，对日常宿主有非零风险，收益只是把一行 `offline` 变成 `live`。**主动放弃**，日常宿主的锁全程只读比对（§11） |
| `SchemaTooNew` / 更旧版本拒绝 | 要验得改 `SCHEMA_VERSION` 或造一个未来版本的库文件，前者动 `src/`（禁止），后者会把隔离库置于一个不可回退的状态 |
| 桌面通知（`notify.enabled`） | 新状态目录的默认值是 `false`，本次没有打开：本机没装 `terminal-notifier`（`README` 与 §1 表都记着），打开也只会产生一条"发不出去"的调试日志，不是证据 |
| 5 秒前台→后台提升 | 模型自己用了 `run_in_background:true`，没给提升逻辑留下机会。要验得下一个"必须前台等 6 秒以上"的任务，并且祈祷模型不自己转后台 |
| `files` / `file` / `recipes` 对**运行中**的 worker | `progress` 对运行中的 worker 采样了 176+ 次，但 `files`/`file` 我是在 Ticket 都结束之后才查的（§0）。三个路由本身 200 且行为正确（含穿越防护），只是"运行中"这个条件只对 `progress` 成立 |
| 工具守卫（Ticket 结束后拒绝工具调用） | 要对一个已结束 Ticket 的 Session 发起一次工具调用。myagent 自己不会再投（`liveTicket` 挡住了所有动词），只能借 DSH 的 RPC 去唤醒那个 Session——那是 §3 用过的路子，但 §3 需要的是"活的 Ticket + 归档的 Session"， ended 的 Ticket 上 `agent/status` 监听器会直接 return，验不出守卫 |
| `blocked` **Report** 与 relay（唤醒前台） | 需要 worker 自己调 `myagent_report(state=blocked, question=…)`。B4 让这条路径现在必然给 worker 回一个工具错误，所以就算跑到也只会得到被污染的现场。**先修 B4 再验这一条**，否则拿到的是"blocked 报告 + 一次 ToolOutputError"的混合证据 |
| `progress` **Report**（`state=progress`） | 同样被 B4 挡住（未终态 → `outcome: undefined`） |
| subagent 在停止时被收掉 | 本次所有 scope 都明写"不调用 subagent"，为的是把 §5 的停止证据收窄到"一个后台作业"这一个变量上 |
| 崩溃恢复（interrupted + 恢复 note + 同目录重启） | 需要 `kill -9` 宿主。隔离宿主的锁与数据我能承担，但 DSH 侧共享的会话/工作区存储在一次硬杀之后的状态会波及日常宿主的视图，风险不对等 |
| `maxWorkers=2` 的并发 | 全程设为 1，为的是让 §1–§5 的时间线可读（一次只有一张在跑）。并发本身有旧代码的 live 证据（两张 Ticket 时间重叠） |
| 面板的真浏览器行为（109 条 jsdom 覆盖的那些） | 没有真浏览器可用；只验了服务端字节一致（sha256 相同） |

---

## 11. 收尾核查

### 隔离宿主已停

```
job_kill bash-ce3a90ca78d54074
```

（第一次启动的 `bash-cabb4044da854c08` 在 18:03 就已经 `job_kill` 掉，为了换 `mainSessionId`；当时同样验证过端口与锁。）

停止后的实测（19:00:44）：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 端口空了 | `lsof -nP -iTCP:3180 -sTCP:LISTEN` | 无输出（`3180 FREE (no listener)`） |
| 隔离锁释放 | `ls ~/.dsh/state/myagent-acceptance/myagent.lock` | `No such file or directory` → `runtime.stop()` 跑通了 |
| SQLite 干净关闭 | `ls -la ~/.dsh/state/myagent-acceptance/` | 只剩 `myagent.json`(312 B)、`myagent.sqlite3`(**86016 B**)、`inbox/`、`work/`；**`-wal` 与 `-shm` 都已消失**（WAL 已 checkpoint 进主库），锁文件也没了 |
| 没有残留进程 | `ps aux \| grep "[m]yagent-test"` | 无输出 |

### 日常宿主与它的数据没被动过

| 检查 | 手段 | 结果 |
| --- | --- | --- |
| 日常宿主还活着、还是同一个进程 | `lsof -nP -iTCP:3080 -sTCP:LISTEN` | `node 24619 … TCP 127.0.0.1:3080 (LISTEN)`（与 17:54 基线一致） |
| 日常锁没被抢 | `cat ~/.dsh/state/myagent/myagent.lock` | `{"pid":24619,"host":"<host>","token":"<uuid-sha256:dc5819a73897>","at":"2026-11-03T08:13:51.555Z"}` —— 与 17:54:21 基线**逐字相同**（pid、token、时间戳都没变） |
| `~/.dsh/state/myagent/` 内容没变 | 17:54:21 与 19:00:52 各做一次 `find … -exec stat -f '%N \| size \| mtime \| inode'` + `shasum -a 256`（`myagent.json` / `myagent.lock` / `myagent.sqlite3`），两份输出 `diff` | **`*** IDENTICAL ***`**：全部 39 行（目录、8 个 work 子目录、7 个 inbox 文件、库与锁）逐字相同，`diff` 无输出。基线 sha256：`myagent.json 9c9b7fbe…`、`myagent.lock 46706790…`、`myagent.sqlite3 52dba970…`，收尾复算一致 |
| `web` profile 没变 | `shasum -a 256` 基线 `package.json` = `3ddfcba9afb0c3f8b2264b8485f85bd6f438e4dee8769b47ca10e9da115dc338`，`cordis.patch.yml` = `c8ac1fa63184e32efc0f44a0513eee00a74219e50813c47e79b9cc008e67338e` | 收尾复算一致；且全程没有对它做过任何写操作，也没有调过 `plugin_manager` |
| 对 3080 只做过 GET | 本次对 `127.0.0.1:3080` 的全部请求：`GET /myagent/api/{state,tickets,recipes,schedules,effects,prompts,decisions,triggers}` 各一次（17:54），都带 `x-myagent-request: 1` | 没有任何 POST/PUT，没有碰它的设置或排期 |
| 源码树没被本次验收动过 | 本次写入的唯一项目文件是本文（mtime `19:09:23`）；`PUT prompts` 改的是**隔离库里的 kv**，不是 `prompts/*.md`。**但要注意**：`src/ tests/ prompts/ lib/ docs/v2/00-audit-and-plan.md` 在 18:13–18:43 之间确实出现了新 mtime，那是**别人在同时改这棵树**，不是本次验收写的——详见 §0b，那里也逐条复核了 §9 的 bug 在当前源码里依然存在 |

### 本次的全部写入位置

| 路径 | 是什么 |
| --- | --- |
| `docs/v2/01-live-acceptance-current-build.md` | 本文（项目树里唯一的新文件） |
| `~/.dsh/state/myagent-acceptance/**` | 隔离状态目录：库、锁、5 个 Ticket 目录、4 个 `inbox/accepted/` 文件 |
| `/tmp/myagent-acceptance/**` | 覆盖层 patch、轮询脚本、日志、导出的会话 JSONL、cookie jar、附件夹具（`att-a/`、`att-b/`） |
| `~/.dsh/sessions/--Users-alice-.dsh-state-myagent-acceptance-work*/**` | 主 Session 与 4 个 worker 的会话日志（DSH 自己的落盘位置，跑宿主就必然产生） |
| `~/.dsh/storages/workspace.json` | **共享文件，被动过两次**：归档 `worker-12ae32cc…`（§3 步骤 2）与撤销归档（§3 收尾）。收尾复算（19:00）：`archivedSessionIds` 计数 **37**（归档前 37 → 归档后 38 → 撤销后 37），`worker-12ae32cc…` 已不在列表中，而**原有的** `worker-19e4bab1e05a42a419fcc71a46460240` 仍在 → 恢复原状，没有连带删掉别人。这是本次唯一写到隔离状态目录之外的 DSH 数据 |

> `~/.dsh/profiles/myagent-test/` 里的文件**一个都没改**：`stateDir` 与 `mainSessionId` 是通过 `--patch /tmp/myagent-acceptance/isolated-state.patch.yml` 这个覆盖层给的，不是写进 profile 的 `cordis.patch.yml`。
