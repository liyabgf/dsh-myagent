# 接入清单

把 myagent 接进真实宿主的**一次性**流程。前提是全离线验证已经通过；这里做的只是「真宿主才能验证的那一层」，
一次跑完、当场清理。任何一步失败就停下、按「回滚」退回去，不要边跑边改。

## 0. 前提（离线，必须全绿）

```bash
cd ~/Documents/SA/myagent
pnpm check          # typecheck + 全部用例 + build（用例数以它自己的输出为准，别在文档里写死）
```

`lib/index.js` 必须是最新的：真宿主加载的是构建产物，不是 `src/`。

## 1. 隔离宿主（不动日常 profile）

用一个独立 profile，跑在另一个端口，**不碰** `web` profile：

```bash
# profile 目录：~/.dsh/profiles/myagent-test
#   package.json: dsh.profile.bundles = [@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, myagent]
#                 dependencies.myagent = link:~/Documents/SA/myagent
#   cordis.yml:   []
#   cordis.patch.yml / pnpm-workspace.yaml: 从 web profile 复制（模型 provider 等）
cd ~/.dsh/profiles/myagent-test && pnpm install
cd ~/deepseek-harness && pnpm dsh --profile myagent-test --port 3180 --no-open
```

注意 CLI 的形状是 `dsh --profile <name> [options]`，**没有** `web` 子命令——app 由 profile 的 bundle 决定。

### 断言（按顺序，每条都要过）

| # | 断言 | 怎么验 |
| --- | --- | --- |
| 1 | 宿主起来了，插件挂载了 | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3180/myagent/` → `200` |
| 2 | **挂载期没有创建任何 Session** | `GET /api/state` 的 `mainSession.exists` → `false` |
| 3 | 健康板干净 | `GET /api/state` 的 `health` 里没有任何 `ok: false` |
| 4 | 同源守卫生效 | 不带 `x-myagent-request: 1` 请求 `/api/state` → `403` |
| 5 | inbox → Ticket → worker → RESULT.md | 往 `inboxDir` 丢一个 `.md`（mtime 需早于 1 秒），等 ~20 秒：Ticket `stage` 走 `pending`→`running`→`done`，worker 目录里出现 `RESULT.md` |
| 6 | 投递盖了戳 | DB 里该 Assignment 的 `startedAt` 与 `deliveredAt` 都非空（缺 `deliveredAt` 会让「静默结束→waiting」的兜底永不触发） |
| 7 | worker 权限是 `danger-full-access` | Session 日志里有 `permission/preset` 事件；`approval/policy` **不是** `ask`（是 `ask` 就说明恢复路径没重新授权，turn 会 `blocked`） |
| 8 | 结束后不 cancel 收尾的 turn | Session 日志的 `turn/end.reason.kind` 不是 `aborted` |
| 9 | 主 Session 按需创建 | `POST /api/main-session` → 返回 `sessionId`；`GET /api/state` 的 `mainSession.exists` → `true` |
| 10 | 报告送达前台 | 主 Session 的日志里有一条 `source.kind = myagent`、`form = notice` 的消息（`blocked` 时是 `relay`，会唤醒它） |
| 11 | 停止真的停 | `POST /api/tickets/:id/stop` → `ended.outcome = stopped`，worker 的 shell 作业与 subagent 被收掉 |
| 12 | 关停干净 | 停宿主后 `stateDir/myagent.lock` 消失（`stop()` 跑通了） |

看 Session 日志（zstd 压缩）：

```bash
zstd -dc '~/.dsh/sessions/<workspace-slug>/<session-id>/session.v4.jsonl.zstd' | python3 -m json.tool --json-lines | less
```

### 验证结果（2026-11-03 04:40–05:12 的隔离运行，全部通过）

| # | 断言 | 证据 |
| --- | --- | --- |
| 1 | 面板 200 | `GET /myagent/` → 200 |
| 2 | 挂载期不创建 Session | `state.mainSession.exists = false`，健康板无问题 |
| 3 | 健康板干净 | 全程 `health` 无 `ok: false` |
| 4 | 同源守卫 | 无标记头 → 403；`origin: http://example.com` → 403 |
| 5 | inbox → Ticket → worker → RESULT.md | 三个文件 + `RESULT.md` 落在 Ticket 自己的目录 |
| 6 | 投递盖戳 | `startedAt` 与 `deliveredAt` 均非空，`deliveryError` 为空 |
| 7 | worker 权限 | 日志先 `workspace-write` + `approval: ask`（DSH 建 Session 时的默认），随后被改成 `danger-full-access` + `approval: never` |
| 8 | 不 cancel 收尾的 turn | 小任务与 33 个动作的长任务，`turn/end.reason.kind` 均为 `completed` |
| 9 | 主 Session 按需创建 | `POST /api/main-session` → 返回 DSH 真正给的 id，`state.mainSession.exists = true` |
| 10 | 报告送达前台 | 主 Session 日志出现 3 条 `agent/inbox/spliced`，`source = {kind: myagent, form: notice}`，summary 截到 120 字上限 |
| 11 | 停止真的停 | Ticket `stopped`、worker `turn/end: aborted/user`、后台作业 `job/settled status: killed` |
| 12 | 关停释放锁 | 三次停宿主后 `myagent.lock` 均消失，3180 无监听 |

排期编辑器的服务端同样验过：`GET /api/schedules` 给出 `daily at 09:00 (Asia/Shanghai)` 与正确的下次触发；
`POST /api/schedules/preview` 对 `*/15 9-17 * * 1-5` 返回接下来三次（09:00 / 09:15 / 09:30）。

**验收配方真的跑通了**（`examples/daily-digest.json`，经 cron 触发而非手动派活，`RESULT.md` 里写着
`Authorized by: operator via schedule`）：抓 4 个源、3 成功 1 失败，产出
`~/Documents/SA/digests/2026-11-03.md`（7810 字节）与逐字节相同的 `latest.md`；
13 条新增按公司分组、带日期与原文链接；OpenAI 的 403 被点名；日期靠推断的两条被标注；
无法确认发布时间的线索单列且不计入新增数。`examples/data-report.md` 在源目录不存在时按配方汇报 `dropped`。

### 这一轮真宿主抓到、离线抓不到的两个 bug

1. **主 Session 的身份没被记住。** `sessionController.create({sessionId})` 会复用 GUI 的空白 Session 并**回一个别的 id**；
   worker 路径记了真实 id，主 Session 路径没记，于是所有按 `myagent-main` 找前台的地方全部落空——报告送不到操作者眼前。
   现在真实 id 存进 Store（`main-session:id`），重启后仍然有效。
2. **改了排期的时刻不生效。** cron 游标只存"算好的下次触发"，不存"它是按哪条规则算的"。把 09:00 改成 10:00 后，
   Source 仍在等旧槽位，而面板预览是现算的、显示新时间——两边说法不一致，表现出来就是"到点没跑"。
   现在游标同时记规则指纹，指纹变了就重算；旧版本写的条目（没有指纹）则被信任，以免升级时丢掉宕机期间欠下的槽位。

## 2. 接入日常 profile（只在用户明确同意后）

```
plugin_manager install_bundle  target=link:~/Documents/SA/myagent
```

**这一步会立即热重载正在运行的宿主**——等于一次重启。所以：

- 先确认宿主当前是健康的（`~/deepseek-harness/packages/client/*/lib/client.js` 存在；
  缺了会让 DSH 自己的 `client-modules` / `typert-loader` 启动失败，那与 myagent 无关但会一起崩）。
- 选一个操作者可以接受重启的时刻。
- 装完立刻看 `GET /myagent/api/state` 的 `health` 与宿主日志，有问题就 `set_bundle myagent enabled=false`。

默认 `acceptMode` 是 **`observe`**：只记录、不执行。先看点记录对不对，再在面板里改成 `auto`。

## 3. 回滚

```
plugin_manager set_bundle  target=myagent  enabled=false      # 停止加载，保留安装
plugin_manager remove_bundle  target=myagent                   # 完全移除（会删掉 profile 里的 link 依赖）
```

残留（按需清理）：

| 路径 | 是什么 |
| --- | --- |
| `~/.dsh/state/myagent/` | 数据库、work 目录、inbox（系统自己的数据） |
| `~/.dsh/profiles/myagent-test/` | 隔离验证用的临时 profile |
| `~/.dsh/sessions/*myagent*`、`*<ticketId 前 8 位>*` | 主 Session 与各 worker 的会话日志 |
| `~/.dsh/profiles/web/node_modules/myagent` | profile 里的 link（`remove_bundle` 会清掉） |

## 4. 不许再犯的规则

1. **离线不绿，不接宿主。** `pnpm check` 是唯一入口。
2. **挂载期不碰 Session，监听器不许抛。** 这两条都会把一个插件的错误放大成宿主的崩溃。
3. **接入是一次有边界的动作**：按上面的断言表跑一遍，跑完就清理，不拿操作者的宿主当调试台反复起停。
4. **DSH 回答的 id 才是真 id，而且要存下来。** 请求一个 Session id 只是请求；凡是之后要按 id 找它的地方，
   都得读那个被记住的答案，而不是读当初的请求。
5. **凡是"算好的值"被持久化，就要连"算它的依据"一起存。** 只存结果，规则一改结果就成了谎言。
6. **测试不许往自己的临时目录以外写。** `machineOf()` 会真的建目录，所以拿 `~/work` 当测试输入就是在操作者的家目录里
   留垃圾；配方的产出目录也不能落在源码树里（这一轮就落在了项目根的 `digests/`，已移出并改掉配方路径）。
