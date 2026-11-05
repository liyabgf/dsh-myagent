# 验收配方：可演示的完整闭环

这份文档的用途是：**任何人（包括未来的我）按它跑一遍，就能证明这套系统真的在工作**，
而不是相信某份文档的说法。每一步都写明**做什么、看什么、什么才算证明**。

它跑在**隔离环境**里。绝不拿日常宿主做实验：日常宿主的 stateDir 是 `~/.dsh/state/myagent/`，
端口 3080，profile `web`——那里面有操作者真实的 Ticket、排期与主 Session。

---

## 0. 前置

```bash
cd ~/Documents/SA/myagent

# 0.1 离线闸门：typecheck + build + 全部测试 + 产物核对，一步不给过就退出非 0
./scripts/gate.sh; echo "退出码 $?"
```

**什么才算证明**：退出码 **0**，并且输出里同时有 `Tests  N passed (N)` 与
`artifact：lib/index.js 比每个源文件都新`、`产物盖的 schema 版本是 5`。

> **不要**用 `./scripts/gate.sh | head` 之类的方式看结果。本项目曾经连续 7 轮把"构建干净"报成事实，
> 而实际上 `| head` 触发的 SIGPIPE 杀掉了 `pnpm check` 的最后一步 build，产物陈旧了 7.5 小时。
> **判定权在退出码，不在输出里的某句话。** 详见 `docs/v2/04-execution-discipline.md` §0.1。

```bash
# 0.2 迁移演练：在副本上跑五步阶梯，并演练回滚。线上库全程只读
./scripts/verify-migration.sh                      # 默认目标：日常库的快照
./scripts/verify-migration.sh <任何一个库文件>       # 也可以指定
```

**什么才算证明**：末行 `── 通过：可以升级线上库`，且输出里
`迁移前` 与 `迁移后` 的**摘要相同**（四张既存数据表逐字节未变）、
`回滚演练` 之后摘要**仍相同**、`integrity_check ok`、`foreign_key_check` 干净。

> 摘要用**显式列名**而不是 `select *`：`select *` 量的是表的形状，一次加列的迁移会让每行多出 NULL 字段、
> 摘要因此变化，而数据一个字节都没动。第一版脚本就这么把一次纯加法迁移误判成"数据被改动"。

---

## 1. 起隔离宿主

隔离 profile 已存在：`~/.dsh/profiles/myagent-test/`，它把 `myagent` 以
`link:~/Documents/SA/myagent` 装进来，所以**它总是加载当前构建**。

覆盖层（给 myagent 独立的 stateDir 与独立的主 Session id，这样日常宿主的锁、数据、Session 都碰不到）：

```yaml
# /tmp/myagent-acceptance/isolated-state.patch.yml
- id: myagent
  name: myagent
  config:
    stateDir: ~/.dsh/state/myagent-acceptance
    mainSessionId: myagent-acc-main
```

启动命令（上一轮验收实际用过、并从它的 `host.log` 第一行取证）：

```bash
cd <DSH 检出目录>
node --import tsx/esm apps/cli/src/bin.ts \
  --profile myagent-test \
  --patch /tmp/myagent-acceptance/isolated-state.patch.yml \
  --port 3180 --no-open
```

> **✅ 已核实（第 33 轮）**：`<DSH 检出目录>` = **`~/deepseek-harness`**，
> `ls ~/deepseek-harness/apps/cli/src/bin.ts` 存在。
> 定位办法值得记下来：它不在 `~/Documents/SA` 下（所以我上一轮 `find` 没找到），
> 而是从 `plugin_manager list_bundles` 里那些 `availability: "missing"` 的官方 bundle 的
> **`installTarget.spec`**（形如 `link:~/deepseek-harness/packages/...`）读出来的。
> **一个工具的"缺失项"元数据，恰好泄漏了它自己的安装根**——这不是设计给这个用途的，但它是可靠的。

**什么才算证明**：日志里出现 `dsh web: http://127.0.0.1:3180/?token=…`，并且

```bash
B=http://127.0.0.1:3180/myagent
H='x-myagent-request: 1'
curl -s -H "$H" "$B/api/state" | python3 -m json.tool | head -30
```

返回 200，`health` 各项 `ok: true`，`sources` 里 cron / inbox / session / rule 四个都在，
并且 `policyVersion` 有值（十六位十六进制）。

**顺手核对没碰日常宿主**：

```bash
sqlite3 "file:$HOME/.dsh/state/myagent/myagent.sqlite3?mode=ro" 'select version from schema_version'
lsof -nP -iTCP:3080 -sTCP:LISTEN | tail -1     # pid 应当与开始前相同
```

---

## 2. 闭环一：一个文件变成一件做完的工作

这是最短的完整闭环，也是这套系统存在的理由。

```bash
INBOX=$HOME/.dsh/state/myagent-acceptance/inbox
cat > "$INBOX/demo-1.md" <<'MD'
---
title: 验收-闭环一
scope: 只在本 Ticket 自己的目录里读写；不访问网络；不删除任何已有文件。
---
在你的目录里写一个文件 evidence.txt，内容两行：当前时间戳、pwd 的输出。
写完调用 myagent_report，state=ready，summary 说明 evidence.txt 的字节数，files 填 evidence.txt。
MD
# 让文件的 mtime 老于静置窗口，否则扫描会认为它还在被写
touch -t "$(date -v-10S '+%Y%m%d%H%M.%S')" "$INBOX/demo-1.md"
```

等最多一个扫描周期（默认 1 秒）加一轮 pass（默认 2 秒）：

```bash
sleep 8
curl -s -H "$H" "$B/api/tickets?state=all&limit=5" | python3 -c '
import json,sys
for t in json.load(sys.stdin)["tickets"]:
    print(t["id"][:8], t["stage"], t["title"])'
```

**什么才算证明**（每一项都要看到，缺一项就是没通）：

1. 出现一张 `stage=done` 的 Ticket，标题是 `验收-闭环一`
2. `GET $B/api/tickets/<id>` 里：
   - `assignments[-1].report.state == "ready"`，`summary` 是 worker 自己写的话
   - `artifacts` 有一条 `path: "evidence.txt"`（**登记表里有它**）
   - `execution.directory` 指向隔离 stateDir 下的工作目录，且 `evidence.txt` **真的在那个目录里**
     （`ls` 它；登记表说有而磁盘上没有，就是登记在撒谎）
   - `ended.outcome == "done"`
3. `GET $B/api/tickets/<id>/events` 返回的序列包含
   `created → launched → report`（`seq` 从 1 开始、连续）
4. inbox 目录里 `demo-1.md` **不在了**，而 `accepted/` 里有一个
   **`<triggerId>-demo-1.md`**，首行是 `<!-- myagent: Ticket <id> -->`
   > 归档名是**事件身份的纯函数**，不是时间戳。这保证同一个请求被扫两次也只有一份归档；
   > 时间戳版本曾经让操作者看到一条请求两份归档、计数说谎（S31）。
5. 主 Session 收到了一条通知（`GET $B/api/state` 的 `mainSession.exists` 为 true——
   **它是被这条通知按需创建的**；B1 之前这里会静默丢掉所有回报而健康板干净）

---

## 3. 闭环二：排期自己触发

```bash
curl -s -H "$H" -X PUT "$B/api/settings" -H 'Content-Type: application/json' -d '{
  "acceptMode": "auto",
  "allowedSenders": ["operator"],
  "sources": {"cron": {"enabled": true, "schedules": [{
    "id": "demo", "name": "验收用", "enabled": true,
    "prompt": "在你的目录里写 scheduled.txt，内容一行：这是排期触发的。然后 myagent_report state=ready。",
    "timing": {"kind": "cron", "expression": "* * * * *", "timeZone": "Asia/Shanghai"}
  }]}},
  "watchdog": {"enabled": true, "everyMs": 15000, "launchStuckMs": 60000, "maxActions": 2}
}' | python3 -m json.tool | head -5
# 注意是 POST 而不是 GET：预览要带上"从现在起算"的时刻，所以它是一个带 body 的动作而不是一个读取。
# 本文此前写的是 GET，那会 404 —— 配方里一条错的命令比没有命令更坏，因为它让人以为系统坏了。
curl -s -H "$H" -X POST "$B/api/schedules/preview" -H 'Content-Type: application/json' -d '{}' | python3 -m json.tool | head -12
```

**什么才算证明**：`preview` 给出**三个不同的**将来时刻（不是三个相同的、也不是两个）；
等到下一个整分钟后，`tickets` 里多出一张 `via: "schedule"` 的 Ticket。**它的 `sender` 是 `operator`，不是排期的 id**（`cron.ts:183`，第 48 轮验收实测）——这是设计如此：排期是操作者自己写下的，所以发起者就是操作者；而**规则来源不同**，它的 `sender` 是规则 id（见 §4 的 `demo-rule`），因为那是系统自己发起的下一步。**本文此前写的是 `sender: "demo"`，照着它核对会以为系统坏了。**

**顺手验一条容易坏的**：把 `expression` 改成别的时刻再 `PUT` 一次，`preview` 必须**立刻**反映新时刻。
> 曾经不改：游标里存的是算好的 `next` 而没有存它是从哪条规则算出来的，
> 于是来源守着旧槽位、面板显示新槽位。现在游标条目带 `spec` 指纹。

---

## 4. 闭环三：主动任务（规则来源）

这一步证明系统能**自己发起没人写的工作**，而且授权是两道关。

```bash
curl -s -H "$H" -X PUT "$B/api/settings" -H 'Content-Type: application/json' -d '{
  "acceptMode": "auto",
  "allowedSenders": ["operator", "demo-rule"],
  "sources": {"rule": {"enabled": true, "allowSystemActors": true, "rules": [{
    "id": "demo-rule", "when": {"outcome": "done"},
    "then": {"prompt": "在你的目录里写 followed-up.txt，内容一行：这是上一张完成后自动发起的。然后 myagent_report state=ready。"},
    "maxDepth": 2
  }]}}
}' > /dev/null
```

再跑一遍 §2（换个文件名与标题），等它 `done`。

**什么才算证明**：

1. 自动多出**第二张** Ticket，其 `mandate.via == "rule"`、`mandate.sender == "demo-rule"`
2. 它的事件日志第一条是 `created`，`by` 是 `{kind: "system", id: "demo-rule"}`
   —— **规则 id 就是 actor**，所以"谁发起了这张"可查
3. **负面路径**（三条都要验，否则只证明了一半）：
   - 把 `allowSystemActors` 改成 `false` → 再跑一次 §2 → 上游照常 `done`，
     但**没有**新 Ticket；`GET $B/api/decisions` 里有一条 `outcome: ignore`、
     `reason: system_actor`，detail 点名 `demo-rule`
   - 把 `demo-rule` 从 `allowedSenders` 里去掉 → 同样被拒，`reason: sender_not_allowed`
   - 把 `sources.rule.deny` 设为 `true` → **不产生任何 Trigger 与 Decision**
     > 这一条与上面两条**不同**，而且必须不同：deny 在产出侧生效，
     > 所以请求没有被"拒绝后丢掉"。规则来源的 Trigger id 是那次结束的纯函数，
     > 一旦被门禁拒掉就**永远不能被重新评估**——解除 deny 也救不回那条链（N4）。
4. `GET $B/api/state` 的 `policyVersion` 在上面每次改设置后都**不同**
   > 修复前五个 rule 旋钮产生**同一个** policyVersion，所以收紧规则来源的授权
   > 不会通知任何在跑的 Ticket（Defect A / S33）。

---

## 5. 闭环四：Watchdog 救一个卡住的启动

```bash
curl -s -H "$H" -X PUT "$B/api/settings" -H 'Content-Type: application/json' -d '{
  "acceptMode": "auto", "allowedSenders": ["operator"],
  "executor": {"maxWorkers": 1, "prepare": "sleep 90"},
  "watchdog": {"enabled": true, "everyMs": 10000, "launchStuckMs": 15000, "maxActions": 2}
}' > /dev/null
# 再投一个请求文件（照 §2 的写法），然后观察 90 秒
```

**什么才算证明**：

1. `GET $B/api/state` 的 `health` 里出现 `watchdog` 条目，detail 含 `stuck launch(es) rescued`
2. 那张 Ticket 的事件日志里有一条 `type: "rescued"`、`by: {kind:"system", id:"watchdog"}`、
   `detail.why` 说明它为什么被救
3. **`rescued` 在 `launched` 之前**

> **这一步上一轮验出了 N1（HIGH）**：救援曾经是**空操作**——`Effects.runDue` 在有 pass 在跑时直接返回，
> 而那个 pass 正是卡在 prepare 里的这次 launch，重新入队的行会被正在跑的那次结算掉；
> 而 `starting.delete` 又让它从探测里消失，于是**永远到不了 `maxActions`/"需要人"**。
> 上一轮的"通过"是错的：那个 `launched` 是 `sleep 90` 自己跑完的时刻（`startedAt = createdAt + 90.08s`）。
> 已修（不再删 `starting`），但**修复的回归测试是离线的**（桩现在支持 `delayMs`），
> 所以这一步在真宿主里要重新看一次：救援之后那张 Ticket 是否**仍然**在 `stuckLaunches` 里、
> 以及 `workerSlots.used` 是否**仍然是 1**（N3：少计会让 `maxWorkers` 在真实资源意义上被超过）。

跑完把 `executor.prepare` 与 `watchdog.launchStuckMs` 改回正常值，否则后面每一步都要等 90 秒。

---

## 6. 闭环五：按来源暂停是无损的

```bash
cat > "$INBOX/demo-pause.md" <<'MD'
---
title: 验收-暂停期间
---
做点事，然后 myagent_report state=ready。
MD
touch -t "$(date -v-10S '+%Y%m%d%H%M.%S')" "$INBOX/demo-pause.md"
# 记下此刻的 triggers/decisions 计数，然后把 inbox 设为 paused
curl -s -H "$H" "$B/api/state" | python3 -c 'import json,sys;print(json.load(sys.stdin)["counts"])'
curl -s -H "$H" -X PUT "$B/api/settings" -H 'Content-Type: application/json' \
  -d '{"acceptMode":"auto","allowedSenders":["operator"],"sources":{"inbox":{"enabled":true,"paused":true}}}' > /dev/null
sleep 6
```

**什么才算证明**：

1. `demo-pause.md` **还在 inbox 里**（`ls $INBOX`），**没有**出现在 `rejected/`
2. triggers 与 decisions 的计数**没有增加**
3. 解除 pause（`"paused": false`）之后再等一轮 → 它被正常受理，成为一张 Ticket，
   归档名是 `<triggerId>-demo-pause.md`

> 这一步验的是"暂停/拒绝在**产出侧**而不在门禁"。走门禁的版本会**消耗**请求：
> 文件进 `rejected/`、Trigger 存成 ignored，而**再投一个字节相同的文件会撞上重复短路**、
> 被再次归档为拒绝并带着旧理由。所以"暂停一个吵闹的来源"在旧行为下等于
> "永久丢弃暂停期间的所有消息"（S9）。

---

## 6b. 闭环六：聊天来源（P8，第 38 轮已真宿主验收通过）

这一条证明**身份映射**与**双向**两件事：一个平台身份如何成为一个真实 Actor，
以及一份报告如何回到请求来的那个地方。参考实现的**两端都是文件系统**，所以整个闭环在真宿主里看得见。

**消息文件的形状**（取自 `src/sources/chat.ts` 自己的文档注释，不是凭记忆）：
频道目录顶层的一个 `*.md` 就是一条消息，可选的 `---` 前置字段 + 正文，**正文就是请求文本**：

```md
---
from: U01ABCDEF        平台身份 —— `sources.chat.identities` 的键，**必填**
id: msg-123            平台的消息 id；没有它则**文件名**就是这条消息的身份
thread: t-9            可选；会跟着 `replyTo.thread` 走
title: weekly alerts   可选；文件名是兜底
---
把本周的告警整理一下。
```

> 前置字段写坏了、或者没有 `from`，**不会因为标点而被拒**（inbox 的教训）：文件被**留住**，
> 就像一条未映射的消息，原地改好之后下一次扫描就受理。

**配置**（`PUT $B/api/settings`，注意 `actor` 也必须出现在 `allowedSenders` 里）：

```json
{"acceptMode":"auto","allowedSenders":["operator","acc-alice"],
 "sources":{"chat":{"enabled":true,"pollMs":1000,
   "identities":{"U01ACC01":{"actor":"acc-alice","note":"操作者本人"}},
   "channels":[{"id":"room-a","directory":"<隔离 stateDir>/chat/room-a","enabled":true}]}}}
```

### 6b.1 已映射：完整闭环

投一个消息文件进频道目录（正文让 worker 写一个小文件然后 `myagent_report state=ready`），
把 mtime 往回拨过静置窗口。

**什么才算证明**（第 38 轮实测到的，逐条都要看到）：

1. Trigger 的 id **等于投料前本地复算的 `key('chat','room-a',<消息id>)`**——逐字符相同。
   这是"身份是纯函数"的直接验证；用时间戳的话这条必然对不上
2. `mandate.sender` = `{id:"acc-alice", kind:"person"}`，**不是平台 id `U01ACC01`**；`mandate.via` = `"chat"`
3. `GET …/tickets/<id>` 带 `replyTo = {kind:"chat", channel:"room-a", thread:"t-acc-1"}`
4. 原文件从频道目录**消失**，并归档为 `<channel>/accepted/<triggerId>-<原名>.md`（**纯函数名、无时间戳**）
5. **worker 真跑到模型**：报告 `state:"ready"`，且 `GET …/progress` 的 `usage` 有真实数字
   （第 38 轮那次是 `{in 9224, out 495, cacheRead 28036, msgs 5, total 37755}`）
6. **回复文件出现在 `<channel>/out/reply-<hash>.md`**，正文就是报告摘要的原文，前置字段带回 `thread`。
   **这是整条闭环最重要的一项**：它是 P8 双向那一半唯一变得可见的地方。
   文件名里的 hash 是 `(channel, thread, text)` 的纯函数，所以**重试不会产生第二份**
7. `GET /api/state` 的 `counts.sends` 从 `{queued:0, nowhere:0}` 变成 `{queued:1, nowhere:0}`
8. 事件序列 `created → launched → report`（第 38 轮那次：文件落盘到 `created` 只用 **0.77s**）

### 6b.2 未映射：留住，不是拒绝

投第二个文件，`from` 用一个**不在 `identities` 里**的平台 id。

**什么才算证明**：

1. **零 Trigger、零 Decision**（比对投料前后的 `state.counts`，并查 `GET …/triggers`、`GET …/decisions`）
2. **文件还在频道目录里**，而且**一字节没动**（第 38 轮量到 308B、mtime 未变）
3. `state.chat.waiting` = `{count:1, ids:["<那个平台 id>"]}`
4. 健康板有一行，**原文照抄**：`1 message(s) from unmapped identities are waiting (<id>); add each id to
   sources.chat.identities, or remove the file`
5. **然后把那个 id 加进 `identities`** → **同一条消息被受理，且只受理一次**：
   一张 Ticket、一份归档、`waiting.count` 归 0；而且它的 `at` **仍是文件的 mtime**，不是受理时刻
6. 再等 ~40 秒（约 40 个扫描周期），**不出现第二份归档**

> 这一条是**留住与丢弃的区别**，也是契约禁止把未映射消息交给门禁的原因：
> 门禁拒绝会把 Trigger 存成 ignored，而 Trigger id 是消息身份的纯函数，
> 所以**那条消息永远不能被重新评估**——事后补上映射也救不回来。

**顺手验 §2.3**：第 5 步那次 `PUT` **只改了 `identities` 一个字段**，
而 `policyVersion` 必须变化（第 38 轮实测 `ad064036…` → `0bafb839…`）。身份映射是授权的一部分。

### 6b.3 暂停在产出侧

把 `sources.chat.paused` 设为 `true`，投第三个文件：**文件留在原处、零 Trigger、零 Decision、
`policyVersion` 不动**，健康行说 `paused — messages stay where they are until the pause lifts`。
解除之后**被留住的那条与下一条都被受理**（这与规则来源不同：文件不会过期，事件会）。

### 6b.4 面板

「来源」页里应当有聊天一节：状态、**未映射等待队列**（每个 id 一个「映射它」按钮，
但 `(no from)` 的身份**不给按钮**、只说去改文件——一个不可能成功的控件比没有控件更坏）、
频道表、身份映射表（可增删改）、回复计数（并解释 `nowhere` 对 cron/inbox 是正常的）。
页头有 `#chat-waiting` 药丸（0 时隐藏），**所以被留住的消息在每一页都看得见**——
它不产生 Decision、不产生 Ticket、不弹 toast，没有这个药丸它就是隐形的。
另外「丢失的请求」区块与页头药丸显示被彻底放弃的请求（`GET …/api/lost`），
UI 里明写**系统不会自动重放它们**。

> ⚠ **面板的所有断言都在 jsdom 里**，真浏览器从未验证过（无 CSS、无真 HTTP）。
> 这一条在真宿主上属于"能打开看"，不属于"已验证"。

## 6c. 闭环七：**一次不顺利的运行**（第 50 轮新增，尚未跑过）

前六条闭环全部走的是**顺利路径**——请求内容是探针（"写一个小文件然后报告"），worker 一次就成。
第 50 轮的第一次真实使用证明这不够：**762 条测试全绿、六条闭环在隔离宿主上零证伪，
而真实工作（90 分钟、1200 万 token、撞上游限流、需要人手动救、两个 worker 互读产物）
一次就暴露了十条问题**（`docs/v2/19-production-findings.md`）。
其中 F1/F2/F3 **只在"不顺利"时才存在**，所以顺利路径的验收在结构上不可能发现它们。

**这一条闭环要在隔离宿主上用故障注入制造一次 worker 失败，然后核对三件事。**
第 41 轮的 `StubOptions.notify = {fails, error?}` 已经证明了这条路可行——
**缺的是把它用在 worker 失败上**（那需要一个能让 worker 的模型调用失败的旋钮，
`agent/error` 那条路径；**如果桩里没有，这一条就先记为"需要新旋钮"，不要用别的方式绕**）。

**核对清单**（三条都要有明确答案，"看起来没事"不算）：

1. **记录里能不能看出失败过？** Ticket 的事件日志必须有一条带**原因**的事件
   （不是只有 `turn_ended` 加一个 `assignmentId`）。第 50 轮之前这里答案是**不能**：
   429 的原文只存在于健康行里，而 `Engine.turnEnded` 的签名根本不接受原因。
2. **板上会不会留下假警报？** 失败恢复、Ticket 成功结束之后，
   健康板上那条失败必须**消失**；而**另一张 Ticket 的问题不得把它顶掉**（N9 那条：一个共享槽位）。
   第 50 轮之前这里答案是**会留三小时**（F2）。
3. **没人干预时会怎样？** 回合结束而没有报告 → Ticket 必须进入 `waiting` 且**升 attention**；
   "Session DSH 不会跑"那种 → 必须记成 `failed` 报告（`runtime.ts:838-850` 的两个分支）。
   **这一条是唯一能区分"系统会叫人"与"系统静默地等着"的测试**，
   而它必须在**没有人去救**的前提下跑——否则量到的是人的行为，不是系统的。

**以及一条反面要求**：跑完这三条之后，**`ended.outcome` 与 `endedReason` 不得看起来像一次干净的成功**。
第 50 轮那张被人救回来的 Ticket，收尾是 `outcome: "done"` / `"The worker reported ready"`，
与一次顺利的完成**不可区分**——**一个终态字段不能证明过程正常**（这是本轮我犯的那个错的通用形式）。

## 7. 面板

浏览器打开 `http://127.0.0.1:3180/myagent/`。

**什么才算证明**：

- 七个既有 tab 之外有 **工作** tab；能创建 Project 与 Work，打开一个 Work 能看到它的 Ticket **按 `workSeq` 排序**
- 打开 §2 那张 Ticket：
  - **产物**里能点开并下载 `evidence.txt`
  - **历史**里能看到 `created / launched / report`，每行有 `#seq`、本地时间、类型、`人|代理|系统 · id`
  - **依赖**分成「它等这些」与「这些在等它」两组
  - **归属**显示 Work 与"第 N 位"，并且能把它归入一个 Work
- 把一张 Ticket 的详情停在那儿不动 10 秒：它**自己刷新**，而你**展开的区块、填了一半的输入框、滚动位置都还在**
- 通知里给出的 `#ticket=<id>` 深链能直接打开那张 Ticket

> **如果面板顶部出现"插件比这个页面旧"的横幅**：那是能力探测在工作，不是坏了。
> 面板 HTML 是**每次请求从磁盘读**的，而 API 来自宿主进程里的 bundle——
> 所以改了面板不重载插件，就会是"新页面 + 旧 API"。
> 该状态下新区块只探测一次、不再轮询、不弹 toast；重载插件（或重启宿主）后横幅消失。

---

## 8. 收尾（必须做，否则下一次跑不起来）

```bash
# 8.1 停宿主（Ctrl-C 或结束那个后台作业），然后确认它真的停了
lsof -nP -iTCP:3180 -sTCP:LISTEN | wc -l              # 应当是 0
ls $HOME/.dsh/state/myagent-acceptance/myagent.lock    # 应当不存在
sqlite3 "file:$HOME/.dsh/state/myagent-acceptance/myagent.sqlite3?mode=ro&immutable=1" \
  'select version from schema_version'                  # 应当是 5

# 8.2 停止之后是否还有写入（S32 的生产版：定时器在库关闭后触发）
shasum -a 256 $HOME/.dsh/state/myagent-acceptance/myagent.sqlite3
sleep 60
shasum -a 256 $HOME/.dsh/state/myagent-acceptance/myagent.sqlite3   # 必须与上一次相同
ls $HOME/.dsh/state/myagent-acceptance/ | grep -E 'wal|shm|lock'    # 应当没有输出

# 8.3 日常宿主全程未受影响
sqlite3 "file:$HOME/.dsh/state/myagent/myagent.sqlite3?mode=ro" 'select version from schema_version'  # 应当是 5，且与验收前相同
# 【工程第 23 轮更正】这里原来写的是「仍是 1」。那在 V1 时代为真，日常库迁移到 5 之后就是假的了，
# 而它与同一节上方第 419 行的「应当是 5」直接矛盾。这句话已经在不同文档里以不同形式出现过四次（§4.57 记录过），
# 原因都是同一个：**一个写下时为真的数字被抄进了配方，之后没人回来核对**。
# 照这条配方跑的人会看到 5，然后以为日常库被验收污染了——一句过期的断言比没有断言更坏，因为它会让人去查一个不存在的问题。
# 这条检查的真正意思是"验收没有动日常库"，所以要比的是**验收前后相同**，而不是某个写死的值。
lsof -nP -iTCP:3080 -sTCP:LISTEN | tail -1                                                            # pid 未变
```

> 8.2 上一轮**没有做完**（记了 T0 基线，没做 T0+60s 的第二次采样），所以"停止后无写入"至今**未得证**。
> 它与 S32（40 个未处理错误：inbox 定时器在 Store 关闭后触发）直接相关。
> S32 的根因已修（两次重叠的 `sync()` 会孤儿化一个已启动的 Source），但**生产版的这一条核对仍然是欠账**。

---

## 9. 一键冒烟

```bash
./scripts/verify-live.sh             # 默认 http://127.0.0.1:3080/myagent
PORT=3180 ./scripts/verify-live.sh   # 隔离宿主；脚本第 10 行就是 BASE="http://127.0.0.1:${PORT:-3080}/myagent"
```

**timing 的四种形状**（`src/core/policy.ts:36-39`，写配方时核对过，字段名错了 schema 会直接拒）：

```
{"kind": "every",  "seconds": 3600}
{"kind": "daily",  "time": "23:45", "timeZone": "Asia/Shanghai"}
{"kind": "weekly", "time": "09:00", "weekdays": [1, 3, 5], "timeZone": "Asia/Shanghai"}
{"kind": "cron",   "expression": "*/10 * * * *", "timeZone": "Asia/Shanghai"}
```

> `seconds` 的下限是 60、上限是 30 天；`weekdays` 是 1–7 且至少一个。
> 时区是**校验过的**——曾经一个没校验的时区让三个来源全部停摆，而保存本身还返回 200。

**什么才算证明**：`通过 9 条，失败 0 条`。

> **已知缺陷 S28（未修）**：它的第 4 步对**任何** `ok:false` 的健康条目都 `exit 1`，
> 不区分"上游 429"、"你自己刚造出来的问题"与"插件真的坏了"。
> 所以退出 1 时先看是哪一条，别当成验收失败。

---

## 10. 这份配方**不能**证明什么

写下来是为了防止它被读成比实际更强的东西：

- **§5 之外的 Watchdog 路径**：静默 worker 探测器（`silentMs`）默认关闭、本配方不驱动它；
  达到 `maxActions` 后转"需要人"的路径只有离线覆盖
- **Project/Work 与依赖图**：路由与面板都有了，但本配方只演示"能建、能看、能归类"，
  **没有演示依赖等待与级联取消**——那需要两张有先后的 Ticket，配方里还没写这一步
- **协作通道**（`myagent_note_ticket`）与**产物引用**（`myagent_read_artifact`）：
  两者都要求两个 worker 同时在跑并互相读写，本配方未覆盖；离线有测试
- **聊天来源已覆盖**（§6b，第 38 轮真宿主验收通过：`docs/v2/16-live-acceptance-chat.md`），
  但**多实例仍不做**（决定 D3：一个 kind 一个实例），所以"两个平台"这件事本配方证明不了
- **丢失请求的记录**（`GET …/api/lost` 与面板「丢失的请求」）在第 45–46 轮才落地，
  **还没有做过真宿主验收**：本配方 §6b.4 只说它应当出现在界面上，没说它在真宿主里被验过。
  要在真宿主里造出一个丢失的请求，需要让 `trigger` 效果连续失败 5 次，而**离线是靠故障注入桩做到的**
  （`StubOptions.notify` 只能让 notify 失败；`trigger` 那半用的是一个不可解析的 payload），
  真宿主里没有对应的开关——**这一条要么补一个安全的注入办法，要么就承认它只有离线覆盖**
- **预算**：token 用量现在可见（`GET …/progress` 的 `usage`，真实数字），但**没有上限**，
  所以没有什么可验的
- **面板在真浏览器里的行为**：所有面板断言都在 jsdom 里，`scrollTop` 还原与横幅的 flex 布局未经证明
- **DSH 宿主自身的安全性质**：工具清单、权限预设、Session 隔离如何被强制——
  这是 `docs/v2/06-security-risk-register.md` 最大的未验证假设
