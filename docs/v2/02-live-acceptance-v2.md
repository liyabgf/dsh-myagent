# 真宿主验收（V2 增量）

**本报告是重建的。** 执行验收的子代理跑完了全部项目并完成了清理，但在写报告之前失败退出，
所以叙述部分丢失了。下面的每一条结论都绑定到**它留下的原始残件**（`/tmp/myagent-acceptance-v2/`）、
**隔离环境的数据库**、或**我自己重新执行的核对**。凡是没有残件支撑的，都写明"证据已丢失"，
不凭它的中途消息下结论。

> ## ⚠ 更正（验收代理复核后提出，见 `docs/v2/02b-live-acceptance-v2-addendum.md`）
>
> 本报告由我在代理失败退出后**从残件重建**，其中三条结论是错的。代理被唤回后逐项复核，更正如下：
>
> 1. **§7 的标题"Watchdog —— 通过"是错的，应为"部分：探测得证，救援被证伪"。**
>    救援在真宿主里是**空操作**（N1，HIGH）：`Effects.runDue` 在有 pass 在跑时直接返回，而那个 pass
>    正是卡在 prepare 命令里的这次 launch，所以重新入队的行会被正在跑的那次结算掉；
>    而 `starting.delete` 又让这张 Ticket 从 `stuckLaunches` 里消失，于是 Watchdog 再也看不到它、
>    **永远到不了 `maxActions`/"需要人"**。证据：整个库只有一行 `rescued`、`needs_person: null`、
>    worker 日志只有一个 turn、而尝试的 `startedAt = createdAt + 90.08s`——正好是那个 `sleep 90` 自己跑完的时刻。
> 2. **§4 里"rescued 发生在 launched 之前，正是'救援 → 才启动'的语义"是错的因果。**
>    那个 `launched` 是**原来那次 launch 的 sleep 自己结束**，发生在救援之后 37 秒，与救援无关。
>    把这条留着就会盖住 N1。
> 3. **§9 里"自动产生了新 Ticket 并跑到 stage: done"只有一张成立。**
>    `d9493df4` 确实 `done`；`2cfc2761` 是 `stage: "running"`、`ended: null`——它证明的是另一件事
>    （**session 来源被停用时规则来源仍被受理**，即 Defect B 的修复），不是"跑完"。
>
> 另外三处需要读者知道：§6 的 `assignment_stale` 不是"证据丢失"而是**本轮根本没驱动**
> （retry 会先结束 #1 再启动 #2，同一个 Session 顺序恢复，造不出"被取代的尝试迟到汇报"）；
> §9 三条负面路径的 Decision **全都在 `item9-negatives.json` 里、没有丢失**（三条都是 `ignored`，
> 理由分别是 `system_actor` / `sender_not_allowed` / `source_disabled`，
> 且 deny 那条的 detail 写的是 "The rule Source is denied"——**点名 rule 而不是 session**，没有一条含 "session"）；
> §8 里 `archived_after_lift: false` 是**代理自己的假阴性**（在解除后 0.0 秒就查了），文件其实已归档，不要引用该字段。
>
> 代理还查出 7 个我没记录的缺陷（N1–N7），以及 §12 状态表里三行需要改。详见附录。
>
> **另外，本文 §13 与 `00` §4.15 对 S32 是否结案的记录直接对立**（本文记未结案，`00` 记已结案）。
> 第 32 轮裁定：两者各对一半，因为**它们是两个不同的命题**——「40 个未处理错误归零」**已证实**，
> 「宿主停止后没有定时器再触发」**未证实**（§8.2 那次 T0+60s 采样从未做过）。
> 「S32 结案」这句话把前者的结论挪用到了后者上。详见 `00` §4.27，以及第 33 轮正在跑的场景 4。

- 环境：profile `myagent-test`，端口 3180，stateDir `~/.dsh/state/myagent-acceptance`
- 被验收的产物：`lib/index.js` sha256 `f6b29adc453f87aa3de9de6e6ab48ceba79c0ded9644f7731247778cce52ad8a`
- 日常宿主（3080、profile `web`、`~/.dsh/state/myagent/`）：**只读**，详见 §11

---

## 1. schema 迁移 1 → 5（真宿主 + 副本演练）——通过

副本演练（`verify-migration-fixed.txt`，脚本对静止的 WAL 库改用 `immutable=1` 之后）：

```
迁移前 version=1 摘要=dacb42ed007e2b26
迁移后 version=5 摘要=dacb42ed007e2b26     ← 四张数据表逐字节未变
回滚演练：版本号改回 1 之后摘要仍为 dacb42ed007e2b26
── 通过：可以升级线上库
```

真宿主：隔离库现在是 **version 5**，`tickets=25`、`events=71`、`artifacts=11`。
上一轮验收（`docs/v2/01-live-acceptance-current-build.md`）留下的 5 张 Ticket 仍在，
迁移脚本对同一份数据的核对里也确认了 5 triggers / 5 tickets / 5 decisions / 5 kv 保留。

**顺带修掉的工具缺陷（S34）**：演练脚本原来用 `mode=ro` 打开，而一个干净停止的宿主留下的是
WAL 模式、**没有 `-shm` 兄弟文件**的库，SQLite 无法只读打开它——**这个工具在它被造出来要保护的那种文件上失败**。
子代理做了干净的 A/B（无 `-wal`/`-shm` 的原始副本 → 退出 1；一次普通打开造出 `-shm` 后 → 退出 0），
并用文件头第 18–19 字节 `0202` 证明了是 WAL。已改为 `mode=ro&immutable=1`。

## 2. 产物登记 —— 通过（正反两面都得证）

残件 `item2-ticket.json`，Ticket `714e759a423ea81e8ae051faf61289e6`：

```json
"artifacts": [{"path": "report.md", "note": "wrote report.md", "at": "2026-11-03T18:44:52.860Z"}]
"notes": [{"at": "2026-11-03T18:44:52.860Z",
           "text": "Not registered as this Ticket's artifact, because it is not a path inside the Ticket directory: ../escape"}]
```

worker 报了 `report.md`、`./report.md`（同一个文件的两种写法）与 `../escape`（越界）。
结果：**登记表里只有一条** `report.md`（归一化生效），越界的那条**不在登记表里、但在 Ticket 的 notes 里可见**，
并带着确切的拒绝措辞。这正是设计意图：越界路径不静默丢弃。
全库累计 **11 条产物、覆盖 11 张 Ticket**。

## 3. Project / Work —— 仅有离线覆盖，**线上不可达**

> **【已过期】** 本文写作时确实零调用者；第 21–22 轮补了 HTTP 入口与面板 tab，四条路由在日常宿主上实测返回 200。准确的说法是：**入口已存在，但从未在真宿主上被驱动过**。

`createProject`、`createWork`、`attachWork` 在 `src/` 里**零调用者**：没有 HTTP 路由、没有工具、面板也没有入口。
子代理的路由与工具清点确认了这一点（worker 侧只有 `myagent_report`、`myagent_note_ticket`；
主 Session 侧是 create/list/status/answer/note/stop/retry）。

**状态：离线验证（引擎层 6 条测试 + 迁移测试），线上不可达。** 入口在 P7。
在此之前不得声称"项目与工作流可用"。

## 4. 事件日志 —— 通过

真宿主库里 **71 条事件、覆盖 20 张 Ticket**。三条序列最能说明它的作用：

```
规则产出的那张 d9493df4：  1 created(by=system/digest-done) → 2 launched → 3 report
被 Watchdog 救的那张 ce1a9d76： 1 created → 2 rescued → 3 launched → 4 report
有重试的那张：              1 created → 2 launched → 3 report → 4 retried → 5 launched → 6 report
```

- 第一行证明**规则 id 就是 actor**（`by.id = digest-done`），所以"谁发起了这张"在记录里是可查的。
- 第二行证明 `rescued` 发生在 `launched` **之前**——正是"启动卡住 → 救援 → 才启动"的语义。
- 第三行是离线测试先发现、这里在真宿主复现的事实：**一张 Ticket 有两个 `launched`**，
  因为重试会开一个新尝试并启动它。只看状态永远看不到这件事（行里只有最新那个尝试）。

`seq` 是每张 Ticket 自己的、从 1 开始，已由上面三条序列证实。

## 5. 依赖（DAG）—— 仅有离线覆盖，**线上不可达**

> **【已过期】** 本文写作时确实零调用者；第 21–22 轮补了 HTTP 入口与面板 tab，四条路由在日常宿主上实测返回 200。准确的说法是：**入口已存在，但从未在真宿主上被驱动过**。

`dependOn`、`blockedBy`、级联取消同样**零调用者**、无路由、无工具。
**状态：离线验证（5 条部署级 + 5 条级联测试），线上不可达。** 入口在 P7。

## 6. 按尝试的报告身份 —— 通过

残件 `item6-ticket.json`：`stage: done`，**`assignments: 2`**（确实发生了重试，即确实存在"上一个尝试"）。
两个 worker 会话日志（`item6-worker.jsonl`、`item7-worker.jsonl`）里
`INVALID_TOOL_OUTPUT` 与 `not lossless` 的出现次数都是 **0**——
上一轮验收在同一个位置观测到 **2 次**（B4：`outcome: undefined` 让 DSH 判定"不是无损 JSON"，
而报告其实已经落库，worker 因此以为汇报失败并白白重试一轮）。**B4 的修复在真宿主得证。**

`assignment_stale` 是否被真的抛出过：**证据已丢失**（残件里没有这一项的判定记录）。
离线有测试覆盖（S11 的两条，经变异检验）。

## 7. Watchdog —— 通过（卡在启动的探测器）

残件 `item7-evidence.json`，Ticket `ce1a9d7603b04d220f57dbaedfcefd0e`，`launchStuckMs` 设为 15s：

```
健康板：  t+1.5s  {ok:true}
          t+55.8s {ok:true, detail:"1 stuck launch(es) rescued"}
事件行：  seq=2 type=rescued by={kind:system,id:watchdog} detail={why:"its worker never came up within 15s"}
进程数：  t+1.5s → 1，t+92s → 0
```

救援发生了、日志里有署名的 `rescued` 行、健康板说出了它做了什么、卡住的进程最终归零。
**`needs_person: null`** —— 达到 `maxActions` 后转为"需要人"的那条路径**没有跑到**，
所以它是**部分验证**：救援本身已证，上限后的行为只有离线覆盖。

静默 worker 探测器（`silentMs`）**未验证**：默认 0（关闭），且需要真 Session 长时间不产事件。

## 8. 按来源策略 —— 通过（三条都得证）

残件 `item8-summary.json`：

| 场景 | 文件留在原处 | 进了 rejected/ | deny/pause 期间新增 Trigger | 新增 Decision | 解除后被受理 |
| --- | --- | --- | --- | --- | --- |
| A：`sources.inbox.deny` | ✓ | ✗ | 0 | 0 | ✓ |
| B：`sources.inbox.paused` | ✓ | ✗ | 0 | 0 | ✓ |

**这正是"暂停/拒绝在产出侧而不在门禁"的证据**：门禁拒绝会把文件移进 `rejected/`、
把 Trigger 存成 ignored，而且**再投一个字节相同的文件会撞上重复短路**、被再次归档为拒绝并带着旧理由。
两个场景都是零 Trigger、零 Decision、文件原地不动、解除后正常受理。

C：`item8c-second.json` + summary 里的 `deny_at=03:05:32.058`、`second_startedAt=19:06:04.530Z`、`second_stage=done`
——**deny 之后已受理的 Ticket 照常启动并跑完**，即 deny 不推迟已受理工作（与 pause 的区别）。

## 9. 规则来源（主动任务）—— 通过（正面与三条负面）

**正面**（`item9-rule-ticket.json`、`item9e-rule-ticket.json`）：
上游 Ticket 以 `done` 结束后，**自动产生了新 Ticket 并跑到 `stage: done`**，
其 `via = "rule"`、`sender = "digest-done"`（规则 id）。这是**第一次有真宿主证据表明系统能自己发起工作**。

**Defect A 的修复线上得证**（`item9-policyversions.json`）——五个 rule 旋钮各自产生**不同**的策略版本：

```
plain(allowSystemActors=true) 6aac6b1a798c3244   allowSystemActors=false 31d02a8c4bdc2d70
deny=true                     445e3195efe98a29   acceptMode=observe      853334daaa1494d5
allowedSenders=[nobody]       27712f5bc29a5463
```
修复前这五个值**全部相同**（子代理的原始测量：五个都是 `29663dc7df4b8496`）。

**负面三条**（`item9-negatives.json`）：`allowSystemActors=false`、规则 id 不在 `allowedSenders`、
`sources.rule.deny=true`。三种情况下**规则来源仍然产出了 Trigger**（`new_rule_triggers` 各一条），
即"来源照跑、门禁拒绝"，而不是"什么都没了"——请求没有丢失，拒绝是有记录的。
三条各自的 Decision 详情与拒绝措辞**证据已丢失**，所以"拒绝的理由文本是否正确"这一点未得证；
离线有测试覆盖（含"detail 必须点名 rule 且不得出现 session"）。

## 10. `scripts/verify-live.sh` —— 通过

`verify-live-3180-v2.txt` 末行：**通过 9 条，失败 0 条**。
（上一轮是 8 通过 1 失败，失败的那条是健康板带着故意造出来的问题。这次健康板干净。）
已知缺陷 S28 仍在：第 4 步对任何 `ok:false` 都 `exit 1`，不区分上游 429 与真故障。

## 11. 未干扰日常宿主 —— 通过（我自己核对的）

子代理只留下了**前置**快照（`daily-pre.txt`，02:15），没做后置 diff，所以这一项由我在 03:2x 重新执行：

```
比较集内文件尺寸差异：无
~/.dsh/state/myagent/myagent.sqlite3 的 schema 版本：仍为 1（未被迁移）
3080 监听者：pid 24619（未变，即日常宿主一直在跑且没被重启）
3180 监听者数：0（隔离宿主已停）
```
`myagent.json` sha256 前缀 `9c9b7fbe1768daff`、`myagent.sqlite3` 前缀 `52dba970970a9b19`。
日常宿主的 `-wal`/`-shm` mtime 会因它自己的 pass 而变化，这是预期的，不是干扰。

**停止后是否仍有写入**（我要求它核对的 S32 生产版）：`poststop.txt` 记录了 T0 基线
（03:15:58，sqlite3 sha256 `3325f896c29070003f8efa7ca0b33e66cac95ccf48ea9f76b7a951488ca6fd3b`，size 311296），
但**没有 T0+60s 的第二次采样**——它在这一步之后失败退出。所以"停止后无写入"**未得证**。
这一项与 S32（40 个未处理错误：inbox 定时器在 Store 关闭后触发）直接相关，仍未结案。

## 12. 能力状态汇总

| 能力 | 状态 |
| --- | --- |
| schema 迁移 1 → 5（含回滚演练） | **真宿主验证** |
| 产物登记（归一化 + 越界拒绝可见） | **真宿主验证** |
| 事件日志（seq、by、真实序列） | **真宿主验证** |
| 按尝试的报告身份（B4 不再报工具错误） | **真宿主验证**（`assignment_stale` 被抛出这一面：离线） |
| Watchdog：卡在启动的探测与救援 | **真宿主验证**（达到上限后转"需要人"：离线） |
| Watchdog：静默 worker 探测器 | **仅有离线覆盖**（默认关闭，未驱动） |
| 按来源 deny / pause（产出侧、无损） | **真宿主验证** |
| deny 不推迟已受理工作 | **真宿主验证** |
| 规则来源：主动发起工作并跑完 | **真宿主验证** |
| 五个 rule 旋钮都推动策略版本 | **真宿主验证** |
| 规则来源的三条负面路径 | **部分**（Trigger 产出得证；Decision 措辞证据丢失） |
| `verify-live.sh` | **真宿主验证**（9/9；S28 未修） |
| Project / Work | **离线验证，线上不可达**（零调用者，入口在 P7） |
| 依赖与级联取消 | **离线验证，线上不可达**（零调用者，入口在 P7） |
| 协作通道 `noteFromWorker` | **离线验证**（工具已注册在 worker 作用域，但本轮未驱动两个 worker 互发） |
| 停止后无写入 | **未得证**（基线记录了，第二次采样没做） |

## 13. 本轮新增/确认的缺陷

- **S32（未结案）**：`pnpm test` 在 567 条全过的同时报 40 个未处理错误，`pnpm check` 退出码 1。
  栈是 inbox 定时器在 Store 关闭后触发（`ERR_INVALID_STATE`）。已排除 `stop()` 顺序错误与"测试忘了 stop"。
  §11 那条"停止后无写入"未得证，与它直接相关。
- **S33（已修，本轮线上得证）**：两处 fallthrough + 一处枚举遗漏，见 §9。
- **S34（已修）**：演练脚本打不开静止的 WAL 库，见 §1。
- **产物陈旧（已修，流程性）**：`lib/index.js` 曾陈旧 7.5 小时而被报成"构建干净"。
  现在由 `tests/build.spec.ts` 与 `scripts/gate.sh` 机器强制，见 `docs/v2/04-execution-discipline.md` §0.1–0.2。
