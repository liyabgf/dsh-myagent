# 16 · chat Source 闭环现场验收（第 38 轮 · P8 任务 E · 四场景定界）

> 本报告**边跑边写**：每个场景一落地就落盘，不做最后一次性汇总。
> 标注约定：**【实测】**= 本轮亲自测量，附证据文件名；**【推断】**= 由测量或源码推出的判断。
> 判定用语：**通过** / **证伪** / **未得证**。
> 本轮**只跑验收单点名的四个场景**，不做开放式审计。
> 本轮**未执行** `pnpm build` / `pnpm check` / `scripts/gate.sh`（任一条都会移动被测产物）。

## 0. 冻结版本核验（起点）

| 项 | 值 | 标注 |
| --- | --- | --- |
| 被测产物 | `~/Documents/SA/myagent/lib/index.js` | — |
| sha256（起点） | `b955704fcc677affeb3db01952bdb33080c4f72fdcfea53d7c96a94afe774576` | 【实测】 |
| 字节数（起点） | `303956` | 【实测】 |
| mtime（起点） | `Nov 4 18:20:26 2026` | 【实测】 |
| 验收单钉死的 sha256 / 字节数 | **一致** | 【实测】 |
| 验收单钉死的 mtime | 写的是 `Nov 4 18:16:45 2026`，**实测晚 3 分 41 秒** | 【实测】 |
| 有无源文件比产物新 | `find src tests scripts prompts locale package.json cordis.patch.yml -type f -newer lib/index.js` → **空** | 【实测】 |

命令：

```bash
shasum -a 256 ~/Documents/SA/myagent/lib/index.js
stat -f "size=%z mtime=%Sm name=%N" ~/Documents/SA/myagent/lib/index.js
find src tests scripts prompts locale package.json cordis.patch.yml -type f -newer lib/index.js
```

**mtime 差异的处置**：sha256 与字节数逐位相同，所以**被测产物的身份没有变**——验收单说"构建是确定性的（本会话验过两次）"，
一次 18:20:26 的重建产出同样字节正好与这条断言自洽；旁证是 `lib/index.d.ts` 的 mtime 同为 `18:20`，而
`src/sources/chat.ts` 的 mtime 是 `18:17`（即那次重建发生在最后一次改源码之后）。
按验收单的停止条件（"**哈希**在起点或终点不一致就停下报告"）——哈希一致，故继续。
`720 tests` 与 `gate 退出 0` 本轮**未复测**（复测必须重建），沿用验收单给定的数字，标【推断】。

## 0.1 日常宿主数据的起点快照（只读）

```
a793caacbbcb2e1d5f96608305878340c52f5c31d7f031e05a4c4df628a987f5  ~/.dsh/state/myagent/myagent.sqlite3
size=167936 mtime=Nov 4 11:40:37 2026
```

`~/.dsh/state/myagent/` 起点内容：`inbox/`、`myagent.json`、`myagent.lock`、`myagent.sqlite3`、
`myagent.sqlite3-shm`、`myagent.sqlite3-wal`、`work/`。【实测】
日常宿主全程在跑（pid **24619**，`node --import tsx/esm apps/cli/src/bin.ts --profile web`，监听 `127.0.0.1:3080`）；
本轮对它**只发过 GET**，未重启、未写、未 toggle 任何插件。【实测】

## 0.2 隔离环境与投料方式

| 步骤 | 命令 / 观察 | 标注 |
| --- | --- | --- |
| 覆盖层 | `/tmp/myagent-acc-chat/overlay.patch.yml`：`stateDir: ~/.dsh/state/myagent-acc-chat`、`mainSessionId: myagent-chat-main` | 【实测】 |
| 起点隔离性 | `~/.dsh/state/` 起点只有 `myagent`、`myagent-acc-watchdog`、`myagent-acceptance` → `myagent-acc-chat` 是本轮新建 | 【实测】 |
| 启动宿主 | `cd ~/deepseek-harness && node --import tsx/esm apps/cli/src/bin.ts --profile myagent-test --patch /tmp/myagent-acc-chat/overlay.patch.yml --port 3180 --no-open 2>&1 \| tee /tmp/myagent-acc-chat/host.log`（后台作业 `bash-15077492a1d141c5`，宿主 pid **57025**） | 【实测】 |
| 就绪行 | `dsh web: http://127.0.0.1:3180/?token=<token-sha256:09cee1614808>` | 【实测】 |
| 监听确认 | `lsof -nP -iTCP:3180 -sTCP:LISTEN` → `node 57025 … TCP 127.0.0.1:3180 (LISTEN)` | 【实测】 |
| 新 stateDir 自建 | `inbox/ work/ chat/ myagent.json myagent.lock myagent.sqlite3{,-shm,-wal}` | 【实测】 |
| `mountedAt` | `2026-11-04T10:28:36.570Z` | 【实测】 |
| 模型凭据 | shell 环境里**没有** `A_API_KEY`，但 profile `myagent-test` 的 provider `a` 用 `apiKeyEnv: A_API_KEY`，而 `~/.dsh/.credentials.yaml` 的 `refs:` 里有该键 → DSH 的 LocalCredentialProvider 解析得到；场景 1 的 worker 真跑到了模型（见下） | 【实测】 |
| 请求栅栏 | 每条请求带 `-H 'x-myagent-request: 1'`，Host 头为 `127.0.0.1:3180`，不带 `Origin`（`sameOrigin()` 三个条件都要满足） | 【实测】 |
| 投料方式 | 消息文件先写在 `/tmp/myagent-acc-chat/`，`touch -t $(date -v-40S +%Y%m%d%H%M.%S)` 回拨 mtime，再 `mv` 进频道目录（`mv` 保留 mtime，避免"落盘瞬间被扫"与 settle 竞态） | 【实测】 |
| settle 窗口 | `src/sources/chat.ts:66` → `const SETTLE_MS = 1000`；回拨 40s 远超该窗口 | 【实测】 |

**配置前读码得到的形状**（`src/sources/chat.ts`，不猜 front matter）：

- 消息文件 = 频道目录**顶层** `*.md`（`.` 开头跳过，子目录不读）；可选 `---` front matter：
  `from`（平台 id，`identities` 的键）、`id`（缺省时**文件名**就是消息身份）、`thread`、`title`；正文即请求文本。
- Trigger id = `key('chat', channelId, messageId)` = `sha256(JSON.stringify(parts)).slice(0,32)`（`src/core/ids.ts:11`）。
- 归档 = `take()` 先 `unlink` 原文件（claim 在前），再写 `<频道目录>/{accepted,observed,rejected}/<triggerId>-<原文件名>`，
  正文前加一行 `<!-- myagent: <note> -->`。名字里没有时间戳（S31）。
- 回复 = `deliver()` 写 `<频道目录>/out/reply-<hash>.md`，`hash = key('chat-reply', channel, thread ?? '', text)`；
  有 thread 时正文前加 `---\nthread: …\n---\n`。`deliver` **不受** `enabled`/`paused`/`deny` 影响（那三个只挡 intake）。

---

## 场景 1 — 已映射身份的闭环（契约 §7.3）

### 1.0 配置

```bash
cd /tmp/myagent-acc-chat
mkdir -p ~/.dsh/state/myagent-acc-chat/chat/room-a && chmod 755 .../room-a
curl -sS -H 'x-myagent-request: 1' http://127.0.0.1:3180/myagent/api/state -o state-00.json
jq '.settings | .acceptMode="auto" | .allowedSenders=["operator","acc-alice"]
    | .sources.chat = {enabled:true,
        identities:{"U01ACC01":{actor:"acc-alice",note:"P8 task E acceptance mapping"}},
        channels:[{id:"room-a",directory:"~/.dsh/state/myagent-acc-chat/chat/room-a",enabled:true}],
        pollMs:1000}' state-00.json > settings-01.json
curl -sS -X PUT -H 'x-myagent-request: 1' -H 'content-type: application/json' \
  --data @settings-01.json http://127.0.0.1:3180/myagent/api/settings
```

**观察**【实测】：`HTTP 200`，`settingsRevision: 0 → 1`；回读 `acceptMode:"auto"`、
`allowedSenders:["operator","acc-alice"]`、`sources.chat` 与提交逐字段相同（证据 `put-settings-01.json`）。
`policyVersion` 由 `2092926da72d2083` → **`ad064036620e3f9f`**；`chat.policy` = `{enabled:true,paused:false,deny:false,acceptMode:"auto",allowedSenders:["operator","acc-alice"]}`；
`sources.chat` 状态 = `{ok:true, detail:"1 channel(s)", counts:{accepted:0,ignored:0,observed:0,duplicate:0,waiting:0}}`；
健康板 `source:chat` = `1 channel(s)`（证据 `state-01.json`）。
频道目录权限 `755` → 未触发"writable by others"那行（`chat.ts:303-307` 检查 `mode & 0o022`）。

> 附带实测（不是本轮要求，但顺手记下）：`policyVersion` 在**加入 identities 的那次 PUT** 之后移动了。
> 这一条同时改了 `acceptMode`/`allowedSenders`/`chat`，所以**它不能单独证明 §2.3**；
> 单独证明留给场景 2 第 5 步（只加一条映射，看 `policyVersion` 是否移动）。

### 1.1 投料

```bash
cat > staging-acc-001.md <<'EOF'
---
from: U01ACC01
id: msg-acc-001
thread: t-acc-1
title: P8 chat closed loop: write one small file and report ready
---
In your own Ticket directory, create a file named `hello.txt` containing exactly one line:
`P8 chat closed loop OK`
… (正文要求 report state:"ready"、files:["hello.txt"]、summary 必须含字面量 chat-loop-ok)
EOF
touch -t "$(date -v-40S +%Y%m%d%H%M.%S)" staging-acc-001.md
mv staging-acc-001.md ~/.dsh/state/myagent-acc-chat/chat/room-a/acc-001.md
```

**观察**【实测】：落盘时刻 `epoch 1793788281.179` = `2026-11-04T10:31:21.18Z`；
文件 mtime `1793788241`（= `18:30:41+0800`，比落盘早 **40s**，`SETTLE_MS=1000` 早已过）；size `509`。
`pollMs=1000`，**未调用** `POST /api/pass`——以下全部由定时扫描自己完成。

投料前用 `key()` 预先算出的期望 Trigger id（`node -e` 复算 `sha256(JSON.stringify(["chat","room-a","msg-acc-001"])).slice(0,32)`）：
**`40dbe2b2f906fb6eae3f4d0a99e4b235`**，期望归档名 **`40dbe2b2f906fb6eae3f4d0a99e4b235-acc-001.md`**。【实测（本地复算）】

### 1.2 七条证据

**① Ticket 出现，且 `mandate.sender.id` 是映射后的 actor 名、不是平台 id**【实测】

`GET /api/tickets?state=all` → `count: 1`，`id = 13d773d0c8099c3150b9b966562cdfa8`，`via: "chat"`。
`GET /api/tickets/13d773d0c8099c3150b9b966562cdfa8`（证据 `ticket-01.json`）：

```json
"origin": { "triggerId": "40dbe2b2f906fb6eae3f4d0a99e4b235" },
"mandate": {
  "scope": "Work in this Ticket's own directory. Produce files there and report what they are; do not change anything outside it.",
  "strength": "explicit",
  "via": "chat",
  "sender": { "id": "acc-alice", "kind": "person" },
  "policyVersion": "ad064036620e3f9f",
  "at": "2026-11-04T10:31:21.949Z"
}
```

`mandate.via == "chat"` ✔；`mandate.sender.id == "acc-alice"`（映射表里的名字）**且不是** `U01ACC01`（平台 id）✔；
`mandate.sender.kind == "person"` ✔。
Trigger 记录本身（`GET /api/triggers`，证据 `triggers-01.json`）同样是 `actor:{id:"acc-alice",kind:"person"}`、
`disposition:{state:"accepted",ticketId:"13d773d0…",decisionId:"7471619d94f4646c872ff4cec8ee691b"}`，
`at` = **`2026-11-04T10:30:41.000Z`**，正是文件的 mtime 而不是扫描瞬间。

**② `GET /api/tickets/<id>` 带 `replyTo`，指名那个频道**【实测】

```json
"replyTo": { "kind": "chat", "channel": "room-a", "thread": "t-acc-1" }
```

`channel` 就是配置的那个频道 id，`thread` 来自消息自己的 front matter（不是从 actor 推出来的）。

**③ 消息文件已离开频道目录，并被归档；归档名是消息身份的纯函数**【实测】

```
~/.dsh/state/myagent-acc-chat/chat/room-a
└── accepted/40dbe2b2f906fb6eae3f4d0a99e4b235-acc-001.md
```

`acc-001.md` 在频道目录顶层**已不存在**（`find` 全树只有 `accepted/` 与后来的 `out/`）。
归档路径 = **`<频道目录>/accepted/`**，归档名 = **`40dbe2b2f906fb6eae3f4d0a99e4b235-acc-001.md`**
= `<Trigger id>-<原文件名>`，与 1.1 投料前本地复算出的期望值**逐字符相同** → 名字里没有扫描时刻、没有时间戳。
归档内容首行是 claim 时写的批注，其后是原文（证据 `evidence-archive-001.md`）：

```
<!-- myagent: Ticket 13d773d0c8099c3150b9b966562cdfa8 -->
---
from: U01ACC01
…
```

**④ 真有 worker 跑起来了：Ticket 走到报告**【实测】

`GET /api/tickets/<id>`：`stage: "done"`，`outcome: "done"`，
`ended: {at:"2026-11-04T10:31:49.328Z", by:"agent", outcome:"done", reason:"The worker reported ready"}`。
报告（`reports[0]`）：

- **`state: "ready"`**
- **`summary`**：`chat-loop-ok: created hello.txt in this Ticket's directory containing exactly one line, "P8 chat closed loop OK", and verified its contents by reading it back. Nothing outside the Ticket directory was changed.`
- `files: ["hello.txt"]`，`at: 2026-11-04T10:31:49.328Z`

`GET /api/tickets/<id>/progress`（Session 仍在，`loaded: true`，证据 `progress-01.json`）：

```json
{"sessionId":"worker-13d773d0c8099c3150b9b966562cdfa8","loaded":true,"agentStatus":"idle","turn":1,
 "lastSaid":"Done. [hello.txt](hello.txt) contains the single line `P8 chat closed loop OK`, and the Ticket is reported `ready` …",
 "recentTools":[{"name":"myagent_report","at":"2026-11-04T10:31:49.309Z"},{"name":"read",…},{"name":"write",…},{"name":"bash",…}],
 "usage":{"inputTokens":9224,"outputTokens":495,"cacheReadTokens":28036,"messages":5,"totalTokens":37755,"windowed":false},
 "assignment":{"id":"32fdd3b21d60a4d0065c0f4add260efc","state":"ended","startedAt":"2026-11-04T10:31:22.010Z","deliveredAt":"2026-11-04T10:31:22.070Z"}}
```

`usage`：**inputTokens 9224 / outputTokens 495 / cacheReadTokens 28036 / messages 5 / totalTokens 37755**。
非零 token 计数 + 四次真实工具调用（`bash`、`write`、`read`、`myagent_report`）= 模型真的被访问了，**不需要**走"模型不可达"那条分支。
worker 目录 `~/.dsh/state/myagent-acc-chat/work/p8-chat-closed-loop-write-one-small-file-and-rep-13d773d0/`
里有 `hello.txt`（23 字节，内容 `P8 chat closed loop OK`）与 `RESULT.md`（598 字节，含 `Authorized by: acc-alice via chat`）。【实测】

**⑤ 回复文件出现在 `<频道目录>/out/`，名字是 `reply-<hash>.md`，内容含报告摘要**【实测】

```
~/.dsh/state/myagent-acc-chat/chat/room-a/out/reply-40f114496924e6c7a442ba5998bfb28e.md
size=253 mtime=Nov 4 18:31:49 2026
```

文件全文（证据 `evidence-reply-001.md`）——前几行：

```
---
thread: t-acc-1
---
chat-loop-ok: created hello.txt in this Ticket's directory containing exactly one line, "P8 chat closed loop OK", and verified its contents by reading it back. Nothing outside the Ticket directory was changed.

Files:
- hello.txt
```

正文第 4 行起就是报告的 `summary` 原文（逐字符相同），后面附 `Files:` 列表；front matter 把 `thread: t-acc-1` 带回给桥。
文件名里的 hash **本地复算一致**：`key('chat-reply','room-a','t-acc-1', <去掉 front matter 的正文>)`
= `40f114496924e6c7a442ba5998bfb28e` → 名字是 (频道, thread, 文本) 的纯函数，重投同一句会覆盖同样字节而不重复。【实测（本地复算）】
**这就是 P8 双向那一半在真宿主里唯一可见的落点：请求从 `room-a/` 进来，答案回到 `room-a/out/`。闭环闭合。**

**⑥ `counts.sends` 前后采样**【实测】

| 采样点 | 证据文件 | `counts.sends` |
| --- | --- | --- |
| 挂载后、配置前（`mountedAt 10:28:36.570Z`） | `state-00.json` | `{queued: 0, nowhere: 0}` |
| PUT 设置后、投料前 | `state-01.json` | `{queued: 0, nowhere: 0}` |
| 投料后、报告前（~`10:31:47`） | `state-02.json` | `{queued: 0, nowhere: 0}` |
| 报告后（`10:32:29`） | `state-03.json` | **`{queued: 1, nowhere: 0}`** |

`queued` 由 0 变 **1**（"曾经非零"成立），`nowhere` **全程 0 未变**——这条 chat Ticket 有 `replyTo`，
所以它不该动 `nowhere`，与契约 §3.3 一致。同时 `counts.effects` = `{}`（`send` 效果行已被消耗，没有滞留重试）。

**⑦ Ticket 事件序列**【实测】

`GET /api/tickets/<id>/events?limit=500` → **3 条**（接口按 seq 倒序返回，下面按 seq 升序引用；证据 `events-01.json`）：

| seq | type | at |
| --- | --- | --- |
| 1 | `created` | `2026-11-04T10:31:21.951Z` |
| 2 | `launched` | `2026-11-04T10:31:22.010Z` |
| 3 | `report` | `2026-11-04T10:31:49.328Z`（`detail: {state:"ready", assignmentId:"32fdd3b2…"}`，`by:{kind:"agent"}`） |

时间线：文件落盘 `10:31:21.18Z` → `created` `10:31:21.951Z`（**0.77s** 后，一个 poll 周期内）→ `launched` `+59ms`
→ `report(ready)` `+27.3s` → 回复文件 mtime `10:31:49`（与报告同一秒）。

> 顺带记录（不是验收项）：`send` 本身**不在 Ticket 事件流里留一行**——它的痕迹是 `out/` 里的回复文件、
> `RESULT.md`、以及 `counts.sends.queued`。事件流到 `report` 就结束，没有 `sent` 事件。

### 1.3 判定

**通过**【实测】。七条证据全部到手：映射身份成为 `person` actor（不是平台 id）、`replyTo` 指名频道、
原文件被归档成纯函数名、真 worker 跑到 `ready` 报告并留下 token 用量、回复文件落在 `out/` 且正文含报告摘要、
`sends.queued` 0→1 而 `nowhere` 不变、事件序列 `created → launched → report`。
契约 §7.3 那条"消息进来 → Ticket → worker 报告 → `send` 送回那个目录"在真宿主里**完整可见**。

---

## 场景 2 — 未映射身份：**留住，不拒绝**（契约 §2.2，安全核心）

### 2.0 起点计数（投料前）

```bash
curl -sS -H 'x-myagent-request: 1' http://127.0.0.1:3180/myagent/api/state -o state-04-before-s2.json
curl -sS -H 'x-myagent-request: 1' 'http://127.0.0.1:3180/myagent/api/triggers?limit=50'
curl -sS -H 'x-myagent-request: 1' 'http://127.0.0.1:3180/myagent/api/decisions?limit=50'
curl -sS -H 'x-myagent-request: 1' 'http://127.0.0.1:3180/myagent/api/tickets?state=all&limit=50'
```

【实测】`counts.triggers = 1`、`counts.decisions = 1`、`counts.open = 0`、`counts.ended = 1`、
`counts.sends = {queued:1, nowhere:0}`、`policyVersion = ad064036620e3f9f`、`chat.waiting = {count:0, ids:[]}`、
`sources.chat.counts = {accepted:1}`；三个列表接口各自 `count = 1`
（trigger `40dbe2b2…`、decision `7471619d…`、ticket `13d773d0…`）。

### 2.1 投料：`from` 不在映射表里

```bash
cat > staging-acc-002.md <<'EOF'
---
from: U09UNMAPPED
id: msg-acc-002
thread: t-acc-2
title: P8 scenario 2: an unmapped identity must be held
---
Write a file named `held.txt` containing the single line `scenario-2-held`, then call the report tool with
state "ready" and a one-sentence summary that contains the literal token `s2-held-ok`.
EOF
touch -t "$(date -v-40S +%Y%m%d%H%M.%S)" staging-acc-002.md
mv staging-acc-002.md ~/.dsh/state/myagent-acc-chat/chat/room-a/acc-002.md
```

【实测】落盘 `epoch 1793788650.48` = `2026-11-04T10:37:30.48Z`，文件 mtime `1793788610`（早 40s），size `308`。
等了 **8s**（= 8 个 `pollMs=1000` 周期）才采样，不是"还没来得及扫"。

### 2.2 五条证据

**① 没有 Trigger，也没有 Decision**【实测】

投料后 8s（`state-05-s2-held.json`）：`counts.triggers = 1`、`counts.decisions = 1`、`counts.open = 0`、
`counts.ended = 1`、`counts.sends = {queued:1, nowhere:0}` —— **六个数字与 2.0 的起点逐位相同**。
`GET /api/triggers` → `count: 1`，ids 只有 `40dbe2b2f906fb6eae3f4d0a99e4b235`（场景 1 那条）；
`GET /api/decisions` → `count: 1`，ids 只有 `7471619d94f4646c872ff4cec8ee691b`；
`GET /api/tickets?state=all` → `count: 1`，只有 `13d773d0…`。
`sources.chat.counts.accepted` 仍是 **1**（未 +1），`duplicate`/`ignored`/`observed` 一个都没有 → 这条消息**没有走门禁**，
连"被拒"的记录都没留下。

**② 文件仍在频道目录里**【实测】

```
~/.dsh/state/myagent-acc-chat/chat/room-a/acc-002.md
-rw-r--r--  1 alice  wheel  308  11月  4 18:36 acc-002.md
```

`find` 全树：顶层有 `acc-002.md`，`accepted/` 里仍只有场景 1 那一份，`out/` 里仍只有场景 1 那一份回复。
size 仍是投料时的 `308`、mtime 仍是投料时的 `18:36` → **原文件连一个字节都没被改动**（没有被批注、没有被搬走）。
文件全文（原样）：

```
---
from: U09UNMAPPED
id: msg-acc-002
thread: t-acc-2
title: P8 scenario 2: an unmapped identity must be held
---
Write a file named `held.txt` containing the single line `scenario-2-held`, then call the report tool with
state "ready" and a one-sentence summary that contains the literal token `s2-held-ok`.
```

**③ `chat.waiting` 报 `count: 1` 并列出那个平台 id**【实测】

```json
"waiting": { "count": 1, "ids": ["U09UNMAPPED"] }
```

**④ Source 的健康板那一行（逐字引用）**【实测】

`state.health["source:chat"]`（`at: 2026-11-04T10:38:11.054Z`，**`ok: false`**）：

```
1 message(s) from unmapped identities are waiting (U09UNMAPPED); add each id to sources.chat.identities, or remove the file
```

同一次快照里 `sources.chat`（Source 自己的状态行）= `{ok:true, detail:"1 channel(s), 1 waiting (unmapped)", lastTriggerAt:"2026-11-04T10:30:41.000Z", counts:{accepted:1}}`
—— `lastTriggerAt` 仍停在场景 1 那条，**没有被这条未映射消息推进**。

**⑤ 加上映射之后，同一条消息被受理，且只受理一次**【实测】

只改 `identities` 一个字段（`allowedSenders`、`acceptMode`、`channels`、`pollMs` 全部原样）：

```bash
jq '.settings | .sources.chat.identities["U09UNMAPPED"] = {actor:"acc-alice",note:"scenario 2: mapping added while the message is held"}' \
  state-05-s2-held.json > settings-02.json
curl -sS -X PUT -H 'x-myagent-request: 1' -H 'content-type: application/json' \
  --data @settings-02.json http://127.0.0.1:3180/myagent/api/settings
```

`HTTP 200`，`settingsRevision: 1 → 2`（`T_map_epoch = 1793788733.08` = `10:38:53.08Z`）。8s 后（`state-06-s2-mapped.json`）：

| 观察项 | 值 |
| --- | --- |
| 新 Trigger id | **`bf0cad26d5e9aed2dd0d1ab395887d04`** = 投料前本地复算的 `key('chat','room-a','msg-acc-002')`，逐字符相同 |
| 新 Trigger 的 `at` | **`2026-11-04T10:36:50.000Z`** = 文件的 mtime，**不是**受理时刻（`10:38:5x`）→ 受理的是**同一条**消息，不是一条新消息 |
| 新 Trigger 的 `actor` | `{id:"acc-alice", kind:"person"}`（映射表里的名字，不是 `U09UNMAPPED`） |
| `disposition` | `{state:"accepted", ticketId:"0389fef84bd3f3faf8e73dea2a62889c", decisionId:"e4261c52ec80f7a118556adf63f1947a"}` |
| Trigger / Decision / Ticket 总数 | `2 / 2 / 2`（各 **+1**，一个不多） |
| 归档 | `accepted/bf0cad26d5e9aed2dd0d1ab395887d04-acc-002.md` —— **一份**，首行 `<!-- myagent: Ticket 0389fef84bd3f3faf8e73dea2a62889c -->` |
| 频道目录顶层 | `ls *.md` → `No such file or directory`（原文件已被 claim 走） |
| `chat.waiting` | **`{count: 0, ids: []}`** |
| 健康板 `source:chat` | 回到 `{ok: true, detail: "1 channel(s)"}` |
| `sources.chat.counts` | `{accepted: 2}`（1 → 2，正好 +1；`duplicate` 仍 0） |

**幂等复验**：受理之后又过了 **43s**（≈43 个 1s 扫描周期）再看（`state-07-s2-after.json`）——
`accepted/` 里仍然只有 **2** 个文件（`ls -1 | wc -l` = 2），`counts.triggers/decisions` 仍是 `2/2`，
`counts.accepted` 仍是 `2`，`chat.waiting` 仍是 `{count:0, ids:[]}` → 反复扫描**没有**把同一条消息受理第二次，
也没有写出第二份归档。（这正是 S31 那个"一次请求两份归档"缺陷的反面。）

顺带把这条 Ticket 也跑完了【实测】：`0389fef8…` `stage:"done"`、`outcome:"done"`、
`summary` = `s2-held-ok — wrote held.txt in this Ticket's directory containing the single line \`scenario-2-held\`, and nothing outside the directory was touched.`、
`replyTo = {kind:"chat", channel:"room-a", thread:"t-acc-2"}`、`mandate.policyVersion = 0bafb8394ef33f6f`（映射之后的版本），
`out/` 里多出第二份回复 `reply-fd97c146eefc7e6420b1486f0a901b61.md`（192 字节，mtime `18:39`），`counts.sends` → `{queued:2, nowhere:0}`。

**⑥ 附带实测：只改 `identities` → `policyVersion` 移动（契约 §2.3）**【实测】

`ad064036620e3f9f` → **`0bafb8394ef33f6f`**。这次 PUT 的差异**只有** `sources.chat.identities` 多了一个键，
所以这条是干净的单变量证据（场景 1 那次 PUT 同时改了三个字段，不能单独证明）。
说明身份映射确实进了 `authorizationShape`（`src/core/policy.ts:282` 的 `identities: identityShape(kind, settings)`），
收紧映射会通知在跑的 Ticket。

### 2.3 判定

**通过**【实测】。未映射的消息在真宿主里**被留住而不是被拒绝**：不产生 Trigger、不产生 Decision、
文件一个字节没动地留在原处、`chat.waiting` 与健康板都点名那个平台 id；把映射加上去之后，
**同一条**消息（Trigger id 与 `at` 都是消息身份的纯函数）被受理**恰好一次**，等待队列归零。
契约 §2.2 那条"门禁拒绝不可逆、所以未映射必须走产出侧"的推理，在现场得到了它要的观测：
如果这条消息当初被送进门禁，`bf0cad26…` 这个 id 就会以 `ignored` 存死，加映射也救不回来。

---

## 场景 3 — 面板读的那套 API 表面（不开浏览器）

### 3.1 `GET /api/state` 的 `chat` 与 `counts.sends`

```bash
curl -sS -H 'x-myagent-request: 1' http://127.0.0.1:3180/myagent/api/state -o state-08-s3.json
jq '{chatKeys: (.chat|keys), chat, sendsKeys: (.counts.sends|keys), sends: .counts.sends}' state-08-s3.json
jq '.chat | has("channels")' state-08-s3.json
```

**观察**【实测】（证据 `state-08-s3.json`）：

```json
"chatKeys": ["policy", "waiting"],
"chat": {
  "policy": {"enabled":true,"paused":false,"deny":false,"acceptMode":"auto","allowedSenders":["operator","acc-alice"]},
  "waiting": {"count":0,"ids":[]}
},
"sendsKeys": ["nowhere","queued"],
"sends": {"queued":2,"nowhere":0}
```

| 验收单点名的字段 | 实测 | 判定 |
| --- | --- | --- |
| `chat.policy` = `{enabled, paused, deny, acceptMode, allowedSenders}` | 五个键**全在**，值与设置一致；`paused/acceptMode/allowedSenders` 是 `sourcePolicy('chat')` 回落全局之后的**有效值** | **通过**【实测】 |
| `chat.waiting` = `{count, ids}` | 在；本轮还实测到 `more` 只在超过 `LIST_LIMIT=5` 时才出现（`chat.ts:265-269`），三个未映射场景都没到 5 条所以没有该键 | **通过**【实测】 |
| `chat.channels` | **`jq '.chat\|has("channels")'` → `false`；`.chat` 的键只有 `policy` 与 `waiting`** | **证伪**【实测】 |
| `counts.sends` = `{queued, nowhere}` | 在，两个键都在（`counts` 之下，不在 `chat` 之下） | **通过**【实测】 |

`chat.channels` 那一项的实情：频道清单在**同一份响应的另一处** —— `state.settings.sources.chat.channels`：

```json
[{"id":"room-a","directory":"~/.dsh/state/myagent-acc-chat/chat/room-a","enabled":true}]
```

这不是漏做，是有意的设计，源码里写明了理由（`src/app/http.ts:197-203`）：`chatView` "故意不做 `settings.sources.chat` 的副本——
页面已经通过 `state.settings` 拿到那份文档，同样的事实有第二种形状就是要同步的第二件事"；`chatView` 只放**非服务器不可**的三件事实
（门禁自己对 Source 策略的读法、等待计数、健康行里解析出的 id）。
所以：**面板能拿到频道，但拿的位置是 `settings.sources.chat.channels`，不是 `chat.channels`**。验收单这一项写错了位置。【实测 + 源码】

### 3.2 `replyTo`：chat 的 Ticket 有，别的来源的 Ticket 没有

造一张 inbox 的 Ticket（inbox Source 默认启用，读 `<stateDir>/inbox`，actor 硬编码 `operator`，在 `allowedSenders` 里）：

```bash
cat > staging-inbox-001.md <<'EOF'
---
title: P8 scenario 3: an inbox Ticket must carry no replyTo
---
Write a file named `inbox-marker.txt` … report state "ready" … token `s3-inbox-ok`.
EOF
touch -t "$(date -v-40S +%Y%m%d%H%M.%S)" staging-inbox-001.md
mv staging-inbox-001.md ~/.dsh/state/myagent-acc-chat/inbox/inbox-001.md
```

**观察**【实测】：inbox Ticket `fcee629a738b98af11026a73253bf70b`（`via:"inbox"`，`actor:{id:"operator",kind:"person"}`，
Trigger `b0ecf99848f80c8bd48eba40c27b6423`，归档 `inbox/accepted/b0ecf998…-inbox-001.md`），
`created 10:43:17.074Z → launched 10:43:17.129Z → report 10:43:59.831Z`，`stage:"done"`，
`summary` = `s3-inbox-ok: wrote inbox-marker.txt in this Ticket's directory containing the single line \`scenario-3-inbox\` (17 bytes, 1 line, trailing newline), verified by byte dump.`

| Ticket | `has("replyTo")` | `replyTo` |
| --- | --- | --- |
| chat `13d773d0c8099c3150b9b966562cdfa8` | **true** | `{"kind":"chat","channel":"room-a","thread":"t-acc-1"}` |
| chat `0389fef84bd3f3faf8e73dea2a62889c` | **true** | `{"kind":"chat","channel":"room-a","thread":"t-acc-2"}` |
| inbox `fcee629a738b98af11026a73253bf70b` | **false** | — |

`grep -c '"replyTo"' ticket-03-inbox-raw.json` → **0**（证据 `ticket-03-inbox-raw.json`、`ticket-01b-chat-raw.json`）：
inbox 那张的响应里**连这个键都不存在**，不是 `"replyTo": null`。
（`ticketView` 之外由 `http.ts:320` 单独挂上去：`store.triggers.get(ticket.origin.triggerId)?.trigger.replyTo` —— inbox 的 Trigger 从来不写 `replyTo`，所以是 `undefined`，JSON 里就不出现。）

**判定：通过**【实测】。

**顺带把契约 §3.3 的"没有 replyTo 时必须可观测"也测到了**【实测】：`counts.sends.nowhere` 由 `0` 变 **`1`**，
发生在 `state-08`（`10:43:13.553Z`，`ended:2`，`{queued:2,nowhere:0}`）与 `state-09`（`10:44:35.229Z`，`ended:3`，`{queued:2,nowhere:1}`）之间；
这个窗口里唯一结束的 Ticket 就是那张 inbox 的（`ended.at = 10:43:59.831Z`）→ `nowhere` 那一次递增就是它。
"send 什么都不做、不报错，但要能被观测到"在现场成立。

### 3.3 `paused: true` → 产出侧留住；解除 → 被留住的那条被受理

```bash
jq '.settings | .sources.chat.paused = true'  state-08-s3.json           > settings-03.json   # PUT → revision 3
# 投料 acc-003.md（from: U01ACC01, id: msg-acc-003, thread: t-acc-3），mtime 回拨 40s，mv 进 room-a/
jq '.settings | .sources.chat.paused = false' state-10-s3-held-paused.json > settings-04.json # PUT → revision 4
```

投料前本地复算期望 Trigger id：`key('chat','room-a','msg-acc-003')` = **`a79b6c91d648fcc410d735ba97baad09`**。

**暂停生效**【实测】（`state-09-s3-paused.json`，PUT 后 3s）：
`chat.policy.paused = true`；`sources.chat` 与 `health["source:chat"]` 同为
`{ok:true, detail:"paused — messages stay where they are until the pause lifts"}`；
`policyVersion` **没有移动**（仍 `0bafb8394ef33f6f`）——暂停是"停住工作"，不是"撤回授权"，与 `policy.ts:264-266`、`revalidate` 的注释一致。

**暂停期间投料，10s（= 10 个 1s 周期）之后**【实测】（`state-10-s3-held-paused.json`，落盘 `epoch 1793789101.01` = `10:45:01.01Z`）：

- 文件**仍在频道目录**：`room-a/acc-003.md`，`size=316`，mtime 仍是投料前的 `18:44:20`（未被批注、未被搬走）。
- **没有 Trigger、没有 Decision**：`counts.triggers = 3`、`counts.decisions = 3`（与投料前相同），
  `GET /api/triggers` 的 3 个 id 是 `b0ecf998…`(inbox)、`bf0cad26…`、`40dbe2b2…`——**没有** `a79b6c91…`；
  `GET /api/decisions` 的 3 个 id 是 `8743ba1f…`、`e4261c52…`、`7471619d…`。
- `sources.chat.counts.accepted` 仍是 `2`；`accepted/` 里仍是 2 份；`chat.waiting` 是 `{count:0, ids:[]}`
  ——**已映射**的消息被暂停留住时**不进等待队列**（等待队列只数未映射身份），健康行也只说 paused。这是对的：
  两件事的解法不同（一个要解除暂停，一个要加映射），混在一个数字里会让操作者看不出该做哪一件。【实测 + 推断】

**解除暂停，10s 之后**【实测】（`state-11-s3-unpaused.json`，PUT `epoch 1793789138.57` = `10:45:38.57Z`）：

| 观察项 | 值 |
| --- | --- |
| Trigger | **`a79b6c91d648fcc410d735ba97baad09`**（与投料前复算的期望值逐字符相同），`at = 2026-11-04T10:44:20.000Z` = 文件 mtime，**不是**解除暂停的时刻 |
| `actor` | `{id:"acc-alice", kind:"person"}` |
| `disposition` | `{state:"accepted", ticketId:"821c4f29aab7a570843bdf255e010340", decisionId:"da06236ff2bb37096613a2ca53f38473"}` |
| 计数 | `triggers 3→4`、`decisions 3→4`、`open 0→1`、`sources.chat.counts.accepted 2→3`（各 +1） |
| 归档 | `accepted/a79b6c91d648fcc410d735ba97baad09-acc-003.md`，**一份**；频道目录顶层的 `acc-003.md` 已消失 |
| 健康行 | 回到 `{ok:true, detail:"1 channel(s)"}`，`lastTriggerAt = 2026-11-04T10:44:20.000Z` |
| `policyVersion` | 仍 `0bafb8394ef33f6f`（解除暂停同样不动授权版本） |

**判定：通过**【实测】。`paused` 在**产出侧**生效（不产生 Trigger/Decision、文件留在原处），
解除之后**被留住的那条**被受理——正是契约 §6 表里那条被第 36 轮更正过的要求
（"文件型来源不会过期，留住 ≠ 丢弃"）：文件不会像 cron 的时隙那样过去就没了。

### 3.4 场景 3 总判定

**3 项通过、1 项证伪**【实测】。证伪的那一项是**验收单自己写错了位置**，不是实现缺东西：
`GET /api/state` 的 `chat` 只有 `policy` 与 `waiting` 两个键，频道清单在 `settings.sources.chat.channels`，
而 `counts.sends` 在 `counts` 之下。面板要的四类事实**都能从这一份响应里读到**，只是不在验收单画的那个位置。

---

## 场景 4 — 宿主停下之后没有任何东西再写

### 4.0 停宿主

```bash
job_kill bash-15077492a1d141c5        # 停掉那个后台作业
lsof -nP -iTCP:3180 -sTCP:LISTEN      # → 空，exit 1
ps -p 57025 -o pid,stat,command       # → 只有表头，exit 1（进程没了）
ps -ax -o pid,ppid,command | grep "[o]verlay.patch.yml"   # → 空（没有残留宿主进程）
```

【实测】作业状态 = **`killed`**（`job_list` 的原文：`bash-15077492a1d141c5 [bash] killed — cd ~/deepseek-harness && exec node --import tsx/esm apps/cli/src/bin.ts …`）。
宿主 pid **57025** 已消失，端口 **3180 空闲**（`lsof` 无输出、退出码 1，在样本 1 与样本 2 各查一次，两次都空）。
`host.log` 里除了就绪行没有别的输出（没有崩溃栈、没有报错）。

停机是**优雅**的，这一点由三份副产物同时消失证明【实测 + 推断】：
`myagent.lock`（`src/app/lock.ts:75` 的 `process.once('exit', release)` 负责删）、
`myagent.sqlite3-wal`、`myagent.sqlite3-shm`（`store.ts:681` 的 `db.close()` 在最后一个连接关闭时 checkpoint 并删除）都不在了，
而主库从运行中的 `4096` 字节 + `247232` 字节 WAL（18:31 实测）变成 **`102400` 字节、无 WAL** ——
即 WAL 已被完整 checkpoint 进主库。主库 mtime = `18:50:23`，比确认进程消失的时刻（`18:50:43.7`）早 20s；
`job_kill` 的发起时刻我没有精确记录（在 18:50:20 前后），所以"最后那次写就是关闭时的 checkpoint"标【推断】，
但"最后一次写发生在 18:50:23、之后没有再写"是【实测】。

### 4.1 样本 1（停机后 ~41s，`epoch 1793789484.83` = `2026-11-04T10:51:24Z`）

证据文件 `s4-sample1.txt`，逐字：

```
$ ls -la ~/.dsh/state/myagent-acc-chat
total 264
drwxr-xr-x  7 alice  staff     224 11月  4 18:50 .
drwxr-xr-x  6 alice  staff     192 11月  4 18:28 ..
drwxr-xr-x  3 alice  staff      96 11月  4 18:29 chat
drwxr-xr-x  3 alice  staff      96 11月  4 18:43 inbox
-rw-r--r--  1 alice  staff     311 11月  4 18:28 myagent.json
-rw-r--r--  1 alice  staff  102400 11月  4 18:50 myagent.sqlite3
drwxr-xr-x  6 alice  staff     192 11月  4 18:45 work

$ shasum -a 256 <every file in ~/.dsh/state/myagent-acc-chat, top level>
e5830a286af8ddb1e3f28d966a62cc7d3f6c46ff1557b81555c55b799bb425e4  ~/.dsh/state/myagent-acc-chat/myagent.json
bc1b3f0358471d6a378c805113f043ff56d3490df83715059543aa4ef9236ab4  ~/.dsh/state/myagent-acc-chat/myagent.sqlite3

$ stat -f '%N size=%z mtime=%Sm mtimeEpoch=%m mode=%Sp' $D/*
…/chat          size=96     mtime=Nov  4 18:29:53 2026 mtimeEpoch=1793788193 mode=drwxr-xr-x
…/inbox         size=96     mtime=Nov  4 18:43:17 2026 mtimeEpoch=1793788997 mode=drwxr-xr-x
…/myagent.json  size=311    mtime=Nov  4 18:28:36 2026 mtimeEpoch=1793788116 mode=-rw-r--r--
…/myagent.sqlite3 size=102400 mtime=Nov  4 18:50:23 2026 mtimeEpoch=1793789423 mode=-rw-r--r--
…/work          size=192    mtime=Nov  4 18:45:38 2026 mtimeEpoch=1793789138 mode=drwxr-xr-x

$ ls $D | grep -E -- '-wal$|-shm$|\.lock$'
(none)
```

**关于 S34 的那条前置条件**：**样本 1 里没有 `-wal` 文件**（也没有 `-shm`），
所以"静止的 WAL 库必须带着 `-shm` 兄弟才能 `mode=ro` 打开"这个坑**本轮没有被触发**——优雅关闭已经把 WAL checkpoint 掉了。
我仍然按验收单的写法用 `mode=ro&immutable=1` 打开了一次（见 4.2），两种模式都可用。【实测】

### 4.2 两次采样之间的只读打开（`epoch 1793789533.04` = `10:52:13Z`）

证据文件 `s4-readonly-open.txt`：

```
$ sqlite3 "file:…/myagent.sqlite3?mode=ro&immutable=1" ".tables"
artifacts     effects     kv           schema_version  tickets      works
decisions     events      projects     ticket_deps     triggers          exit=0

$ … "select count(*) …"
tickets=4  triggers=4  decisions=4  effects=0  events=12  artifacts=4      exit=0

$ … "select id from tickets order by id;"
0389fef84bd3f3faf8e73dea2a62889c
13d773d0c8099c3150b9b966562cdfa8
821c4f29aab7a570843bdf255e010340
fcee629a738b98af11026a73253bf70b                                          exit=0

$ … "pragma integrity_check;"
ok                                                                          exit=0
```

四张 Ticket、四个 Trigger、四个 Decision、12 条事件、4 个 artifact **全在主库文件里**（没有滞留在 WAL 里），
`effects = 0`（效果队列已排空，没有滞留的 `send`/`launch` 行），`integrity_check = ok`。
这次只读打开**没有**制造任何副产物（见样本 2 的 `-wal/-shm/.lock` 仍是 `(none)`）。

### 4.3 样本 2（等 62s 之后，`epoch 1793789615.42` = `2026-11-04T10:53:35Z`；距停机 ~172s）

证据文件 `s4-sample2.txt`。逐字内容与样本 1 相同，只有我自己在末尾多附的一次 `lsof`：

```
$ diff <(grep -v '^###' s4-sample1.txt | head -24) <(grep -v '^###' s4-sample2.txt | head -24)
IDENTICAL (diff exit 0)

24a25,27
>
> $ lsof -nP -iTCP:3180 -sTCP:LISTEN
> (empty — exit 1)
```

即：**`ls -la` 全表相同、两个文件的 sha256 相同、五个条目的 size/mtime/mtimeEpoch/mode 逐个相同、`-wal|-shm|.lock` 两次都是 `(none)`**。

| 项 | 样本 1（10:51:24Z） | 样本 2（10:53:35Z） | 相同 |
| --- | --- | --- | --- |
| `myagent.sqlite3` sha256 | `bc1b3f0358471d6a378c805113f043ff56d3490df83715059543aa4ef9236ab4` | 同左 | ✔ |
| `myagent.sqlite3` size | `102400` | `102400` | ✔ |
| `myagent.sqlite3` mtime | `Nov  4 18:50:23 2026`（epoch `1793789423`） | 同左 | ✔ |
| `myagent.json` sha256 | `e5830a286af8ddb1e3f28d966a62cc7d3f6c46ff1557b81555c55b799bb425e4` | 同左 | ✔ |
| `-wal` / `-shm` / `.lock` | `(none)` | `(none)` | ✔ |
| 目录条目数与各自 mtime | `chat 18:29:53 / inbox 18:43:17 / work 18:45:38` | 同左 | ✔ |
| `lsof -nP -iTCP:3180 -sTCP:LISTEN` | 空（exit 1） | 空（exit 1） | ✔ |

### 4.4 判定

**通过**【实测】。宿主停下之后 **172 秒**内，stateDir 里没有任何一个字节发生变化：
sha256、size、mtime 三项全部逐位相同，`-wal`/`-shm`/`.lock` 一个都没有重新出现，端口 3180 两次都空闲。
没有留下"进程没了但还有人在写"的尾巴，也没有留下需要下一次启动去抢救的 WAL。

---

## 5. 收尾核验

| 项 | 起点 | 终点 | 一致 | 标注 |
| --- | --- | --- | --- | --- |
| `lib/index.js` sha256 | `b955704fcc677affeb3db01952bdb33080c4f72fdcfea53d7c96a94afe774576` | `b955704fcc677affeb3db01952bdb33080c4f72fdcfea53d7c96a94afe774576` | **✔** | 【实测】 |
| `lib/index.js` size / mtime | `303956` / `Nov  4 18:20:26 2026` | `303956` / `Nov  4 18:20:26 2026`（epoch `1793787626`） | **✔** | 【实测】 |
| 有源文件比产物新 | 无 | 无 | ✔ | 【实测】 |
| 日常库 `~/.dsh/state/myagent/myagent.sqlite3` sha256 | `a793caacbbcb2e1d5f96608305878340c52f5c31d7f031e05a4c4df628a987f5` | 同左 | **✔ 未被触碰** | 【实测，全程只读】 |
| 日常库 size / mtime | `167936` / `Nov  4 11:40:37 2026` | `167936` / `Nov  4 11:40:37 2026` | **✔** | 【实测】 |
| 日常 stateDir 其余文件 | `myagent.json`、`myagent.lock`、`-shm`、`-wal` 均 mtime `11月 4 12:21`；`inbox/ 11月 3 11:56`、`work/ 11月 4 09:00` | 逐个 mtime 相同 | **✔** | 【实测】 |
| 端口 3180 | 起点空闲 | **终点空闲**（`lsof -nP -iTCP:3180 -sTCP:LISTEN` 无输出、exit 1） | ✔ | 【实测】 |
| 宿主退出状态 | — | 作业 `bash-15077492a1d141c5` = **`killed`**（我主动 `job_kill`）；pid 57025 消失；`host.log` 只有就绪行，无异常输出；关闭是优雅的（lock/-wal/-shm 均已清理，见 §4.0） | — | 【实测】 |
| 日常宿主（3080，pid 24619） | 在跑 | **仍在跑**，`GET /myagent/api/state` → `HTTP 200`；全程只对它发 GET，未重启、未写、未 toggle 任何插件 | ✔ | 【实测】 |

本轮**未执行** `pnpm build` / `pnpm check` / `scripts/gate.sh`，也未 reload/restart/toggle 任何插件。
"gate 退出 0、720 tests"沿用验收单给定的数字：本轮既没有复测（复测必须重建，会移动被测产物），
也没有任何证据与之矛盾 → 标【推断】。

### 5.1 四场景判定汇总

| 场景 | 判定 | 一句话 |
| --- | --- | --- |
| 1 · 已映射身份的闭环（§7.3） | **通过**【实测】 | 七条证据齐；回复文件 `out/reply-40f114496924e6c7a442ba5998bfb28e.md` 正文含报告摘要原文，双向那一半在真宿主里可见 |
| 2 · 未映射身份被留住（§2.2） | **通过**【实测】 | 留住期间 0 Trigger / 0 Decision、文件一字节未动；加映射后同一条消息（Trigger id 与 `at` 都是消息身份的纯函数）被受理**恰好一次** |
| 3 · 面板读的 API 表面 | **3 项通过、1 项证伪**【实测】 | 证伪的是验收单自己：`state.chat` 只有 `{policy, waiting}`，频道在 `settings.sources.chat.channels`，`sends` 在 `counts.sends` |
| 4 · 停机后无人再写 | **通过**【实测】 | 172s 内 sha256/size/mtime 全部不变，`-wal`/`-shm`/`.lock` 一个都没回来，3180 空闲 |

### 5.2 顺手看见的、验收单没问的一件事

**`health.executor` 那行会说假话（陈旧的槽位数）**【实测】：`state-12-settled.json` 里
`counts.workerSlots = {used: 0, max: 2}`、`counts.open = 0`、`health.runtime.detail = "0 open Ticket(s), accept mode auto"`（`at 10:49:41.222Z`），
而同一份快照里 `health.executor = {ok:true, detail:"1 of 2 worker slots in use", at:"2026-11-04T10:45:38.610Z"}` ——
比现场晚 4 分钟、且断言了一个已经不成立的事实。原因在源码里看得见：那行只在 `launch()` 内部写
（`src/app/executor.ts:241` → `this.health.record(\`${this.used()} of ${settings.executor.maxWorkers} worker slots in use\`)`），
**槽位释放时没有人重写它**，所以它永远停在最后一次 launch 期间的读数。
这与 S19 / N5 同族（健康板上一句过期的话），只是方向相反：不是"摘要擦掉了问题"，而是"摘要留着一个不再为真的数字"。
面板若照它显示槽位，会与它旁边的 `counts.workerSlots` 当场矛盾。**不在本轮四个场景之内，未修**。

### 5.3 证据文件清单（`/tmp/myagent-acc-chat/`）

`overlay.patch.yml`、`host.log`、`state-00…state-12*.json`（12 份 `GET /api/state` 快照）、
`settings-01…04.json` 与 `put-settings-01…04.json`（四次 PUT 的正文与响应）、
`triggers-01…04.json`、`decisions-01/02.json`、`tickets-02…04.json`、
`ticket-01.json`、`ticket-01b-chat-raw.json`、`ticket-02.json`、`ticket-03-inbox-raw.json`、`ticket-03-inbox-final.json`、`ticket-04.json`、
`events-01.json`、`progress-01.json`、`evidence-archive-001.md`、`evidence-archive-002.md`、`evidence-reply-001.md`、
`s4-sample1.txt`、`s4-sample2.txt`、`s4-readonly-open.txt`、`s1.head`/`s2.head`（供 `diff`）、`tid.txt`/`inbox-tid.txt`/`drop-001.txt`。
工作笔记：`/tmp/p8-e-notes.md`。
