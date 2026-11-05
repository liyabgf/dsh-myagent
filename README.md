# myagent

属于你自己的 Agent 系统：一个 DeepSeek Harness（DSH）bundle。定时任务、本地投递、主 Session 对话这三条来路，
经**同一道门禁**变成 Ticket；每个 Ticket 由**自己的 DSH Session**在**自己的目录**里无人值守地做完，再把结果送回来。

架构参照 [`dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype)，领域模型做了裁剪：
保留 Source / Trigger / Policy / Decision / Mandate / Ticket / Assignment / Report / Delivery 九个概念，
去掉 Thread、Subscription、Correlation，评估（Eval）第一版只有确定性门禁、没有模型评审（接缝留在 `Assessor`）。

---

## 一条请求走过的路

```
Source ──Trigger──▶ gate（策略）──Decision──▶ Mandate + Ticket ──Assignment──▶ worker Session
                        │                                                          │
                        ├─ ignored：记下原因，什么都不跑                              │ Report
                        └─ observed：记下，不执行（observe 模式）                      ▼
                                                                          RESULT.md + 主 Session + 面板
```

- **Trigger**：一次请求事实。id 由「来源 + 让它唯一的事实」算出（cron 是排期与时刻，inbox 是文件名、mtime、大小），
  所以重启不会重复，宕机漏掉的一批时刻折叠成一个 Trigger。
- **gate**：纯函数 `gate(trigger, settings)`。判定 `accepted / observed / ignored`，理由固定成八种
  （`sender_not_allowed`、`source_disabled`、`paused`、`empty_request`、`system_actor`、`unknown_source`、`observed`、`accepted`）。
  每次判定都写一条 **Decision**，面板可查——「为什么没跑」永远有据可查。
- **Mandate**：授权本身。谁发的（sender）、经哪条来路（via）、范围多大（scope）、强度（explicit/inferred）、
  当时的策略版本号。Ticket 带着它出生，之后改设置**不会**追溯扩大它。
- **Ticket / Assignment**：Ticket 是一件工作的全部历史；Assignment 是「一轮执行」。失败、被打断、等人回答之后再继续，
  都是新 Assignment，历史不丢。
- **Report**：worker 用 `myagent_report` 汇报，`state` 是事实分类：`progress / waiting / ready / blocked / failed / dropped`。
  `ready` 和 `dropped` 结束 Ticket；`blocked` 和 `failed` 让 Ticket 等人。
- **Delivery**：`ready/failed/dropped` 写进 Ticket 目录的 `RESULT.md`；主 Session 收到一条通知（`blocked` 才**唤醒**它，
  其余只留在历史里，不白花一次模型调用）；可选的 macOS 桌面通知。

所有跨进程的副作用（启动 worker、投递输入、送报告）都走**持久化 effect 队列**，崩溃后重试而不是丢失。

## 三条来路

| 来源 | 怎么产生 Trigger | actor | 备注 |
| --- | --- | --- | --- |
| `cron` | 设置的排期到点 | `operator`（排期就是操作者写下的规则） | 支持 `every / daily / weekly / cron` 五种写法、时区、DST；宕机漏掉的时刻折叠成一个 Trigger 并带 `missed` 计数 |
| `inbox` | 往目录里丢一个 `*.md` | `operator` | 每 5 秒轮询；只认 `.md`、不认隐藏文件；刚写入 1 秒内的文件等下一轮；接手后移到 `accepted/`、`observed/` 或 `rejected/`（拒绝原因写进文件头） |
| `session` | 主 Session 里 `myagent_create_ticket`，或面板「派活」 | 调用者 | 不轮询，走的是同一道门禁 |

请求文件可以带前置元数据：

```markdown
---
title: 本周竞品动态
scope: 只读 ~/notes，产物写在本目录
---
整理这三家的更新，产出 digest.md 和 table.csv。
```

## 安装

作为 bundle 装进当前 profile（DSH 会认 `dsh.bundle.patch` 指向的 `cordis.patch.yml`）：

```
plugin_manager install_bundle  target=~/Documents/SA/myagent
```

或手动：把这个目录 `pnpm link` / 复制进 profile 的安装层，再启用 `myagent` 插件。
装完不需要改 profile 配置——所有路径都有默认值：

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `stateDir` | `<DSH_HOME>/state/myagent` | 数据库与锁；改它会重挂插件 |
| `workRoot` | `<stateDir>/work` | 每个 Ticket 的目录都建在这里面 |
| `inboxDir` | `<stateDir>/inbox` | 投递目录 |
| `mainSessionId` | `myagent-main` | 主 Session（前台） |
| `promptMaxChars` | `100000` | 提示词覆盖上限（volatile，改完即生效） |

### 装进宿主之前

`plugin_manager install_bundle` 对**正在运行的** profile 会立即生效，那等于一次宿主热重载：装一个没验证过的 bundle，
就是拿操作者正在用的宿主去试错。所以顺序是固定的：

1. `pnpm check` 全绿（typecheck + 全部用例 + build；用例数与覆盖率以它的输出为准，文档里不写死数字，因为每加一个测试就会失真），其中两组是专门为这一步写的：
   - `tests/mount.spec.ts`：挂载期**不创建、不解析、不装饰任何 Session**；`apply()` 在一个所有服务都抛异常的宿主上
     也**不 reject**（插件起不来，就只是插件起不来）；`stop()` 每一步都有界，可以停两次；同一个状态目录的第二次
     部署被拒绝。
   - `tests/flow.spec.ts`：离线跑完整链路——inbox 文件 → 门禁 → Ticket → worker Session（带提示词与工具白名单）→
     `myagent_report` → `RESULT.md` + 主 Session 通知；`blocked` → 唤醒前台 → 回答 → 同一个 worker 收到；observe 模式
     一个 worker 都不起。
2. 只在需要真宿主的行为（模型调用、真实 Session 生命周期）时，才在**独立 profile + 独立端口**上验证，不动日常那个。
3. 挂上以后第一件事是看 `/myagent/api/state` 的 `health`，有问题它会写在那里，不会静默。

三条硬规则，来自一次真实的翻车：

- **挂载期不碰 Session。** 在 `apply()` 里创建的 agent，会在宿主启动失败时跟着被拆解，把一个插件的错误塞进宿主
  自己的关闭链路。主 Session 改成按需创建（面板上的按钮，或 `POST /myagent/api/main-session`）。
- **`apply()` 不 reject。** 起不来就记日志、标红健康、什么都不做。
- **DSH 回答的 id 才是真的 id。** `sessionController.create()` 可能复用一个空白 Session 并回一个**不同的** sessionId；
  所以 worker 的 Session id 记在 Ticket 的 `execution.sessionId` 上，之后所有投递、停止、turn 结束都按它寻址。
  同理，`notice` 形态的消息 `summary` 上限是 120 字符，超了是被拒绝而不是被截断。
- **事件监听器里的异常会打死宿主。** `agent/created`、`agent/status`、`session/event` 的回调跑在 DSH 自己的派发里，
  抛出就是 `fatal load failure`、进程退出。所有监听器一律包起来，异常只进日志和健康板。
- **「跑一轮」是真的去看一眼。** 面板那个按钮会让每个 Source 立刻轮询一次（`nudge()`），而不是等下一个轮询周期；
  inbox 的扫描是串行的，所以并发地"看一眼"不会把同一个请求文件搬走两次。
- **恢复的 worker 要重新授权。** DSH 在 `create()` 返回前就派发 `agent/created`，所以那一步抛异常会留下一个
  权限还是 profile 默认值（`workspace-write` + `approval: ask`）的 Session。`resume()` 必须像新建一样把它配好，
  否则无人值守的 turn 会在等一个没人能给的审批时 `blocked`，Ticket 静默卡死。

bundle 还会注册一个 agent preset `myagent-worker`：**worker Session 专用**，不含向人提问、展示、计划模式、
插件管理、定时、目标、工作流这些工具（无人值守时，任何等人的工具都会把它挂住），前台命令 5 秒转后台。
主 Session 用 profile 自己的默认 preset，只额外挂上 myagent 的工具和提示词段落。

## 第一次运行：先 observe，再 auto

`acceptMode` 默认是 **`observe`**：门禁照常判定、Decision 照常记录，但**什么都不执行**。
先看几天记录对不对，再在面板里把 `acceptMode` 改成 `auto`。这是刻意的：一个会自己动手的系统，
应该先证明它判断得对。

面板：<http://127.0.0.1:3080/myagent/>（跟着你的 DSH Web GUI 端口走）。
所有 API 只接受同源请求——必须打到 loopback，并带 `x-myagent-request: 1`，别的页面驱动不了它。

| 面板页 | 做什么 |
| --- | --- |
| Ticket | 看进行中/等人/已结束；打开一个 Ticket 看范围、报告、输入，回答它、补备注、重试本轮、停止 |
| 派活 | 直接开一个 Ticket（和 inbox、cron 同一道门禁） |
| 门禁记录 | 每个 Trigger 的判定与原因 |
| 来源 | 三个来源各自的下次时刻、最近触发、计数；健康；effect 队列 |
| 设置 | 整份 settings JSON，保存即生效；影响在跑的 Ticket 时，系统会把变化告诉它们 |
| 提示词 | 覆盖 worker / orchestrator 两个角色的提示词，留空即用内置；保存后下一轮就绑定到在跑的 Session |

JSON API（都要带那个头）：`GET state|tickets|tickets/:id|decisions|triggers|effects|prompts`、
`PUT settings|prompts`、`POST tickets`、`POST tickets/:id/answer|note|stop|retry`、`POST pass`。

## 设置字段

```jsonc
{
  "acceptMode": "observe",          // auto | observe
  "allowedSenders": ["operator"],   // 谁可以发起工作
  "paused": false,                  // 暂停：不启动、不投递，什么都不过期
  "executor": {
    "maxWorkers": 2,                // 同时跑几个 worker（1..8）
    "prepare": "",                  // 每个新 Ticket 目录建好后跑一次的 shell 命令
    "model": ""                     // worker 用哪个模型，"provider/model"；留空用 profile 默认
  },
  "sources": {
    "cron": { "enabled": true, "schedules": [
      { "id": "digest", "name": "每日摘要", "prompt": "写今天的摘要", "scope": "",
        "timing": { "kind": "daily", "time": "09:00", "timeZone": "Asia/Shanghai" } }
    ]},
    "inbox": { "enabled": true, "directory": "", "pollMs": 5000 },
    "session": { "enabled": true }
  },
  "notify": { "enabled": false }    // macOS 桌面通知
}
```

`timing` 四种写法：`{kind:'every', seconds}`（≥60）、`{kind:'daily', time, timeZone?}`、
`{kind:'weekly', time, weekdays:[1..7], timeZone?}`、`{kind:'cron', expression, timeZone?}`（五段 Vixie cron，
日/周同时受限时按「或」匹配）。不存在的本地时刻（DST 跳空）跳过，回退日按较早的那个瞬间触发一次。

## 带文件下任务

一个任务常常需要输入：一份 csv、一张截图、一个 PDF。三条来路都能带文件，方式一致——**给绝对路径**：

- **主 Session**（推荐）：在 DSH GUI 里把文件附上或说出路径，模型用 `myagent_create_ticket` 的 `attachments` 传进来。
- **inbox**：请求文件的 front matter 里写 `attach: /abs/a.csv, /abs/b.pdf`。
- **cron**：排期的 `prompt` 里写清路径（排期没有 attachments 字段，因为定时任务读的通常是固定位置的数据）。

文件在 worker 起跑**之前**被复制进 Ticket 自己的目录（`attachments/<名字>`），所以排队期间源文件被移动或清理都不影响这次执行；同名文件自动改名（`report.csv`、`report-2.csv`）而不是互相覆盖。**复制不了就让 Ticket 失败**，不会让 worker 在没有输入的情况下编一个像样的结果出来。

## 面板管什么，主 Session 管什么

**下任务走主 Session，面板只做监工。** 这不是偷懒：DSH 的 GUI 已经是一个成熟的对话入口，原生支持附件、图片、文档和流式进度，在面板里重造一套只会更差，而且永远追不上。

| | 主 Session（DSH GUI 里的对话） | 面板 `/myagent/` |
| --- | --- | --- |
| 派活、带文件、追问 | **在这儿做**：附上文件说一句话，模型用 `myagent_create_ticket`（含 `attachments`）开单 | 也能派，表单而已；带文件要填绝对路径 |
| 看谁在跑、跑到哪一步 | 报告以通知形式落在这里的历史里 | **在这儿看**：实时进度（第几轮、最近的工具调用、它最后说了什么），每 3 秒刷新且不会吃掉你正在输入的内容 |
| 看产出了什么 | 通知里列了文件名 | **在这儿看**：目录树、大小、文本内联预览（UTF-8）、任何文件都能下载 |
| 干预（回答/备注/重试/停止） | 可以让模型代做 | **在这儿做**：停止要填原因，删排期要二次确认，都不用浏览器原生弹窗 |
| 改设置、改提示词、改排期 | 可以让模型代做 | **在这儿做**：排期编辑器带下次触发预览，改完立刻生效 |

worker 的 Session 在 GUI 会话列表里就叫 **Ticket 的标题**（面板给你 id 和一键复制）。这个宿主没有指向某个会话的网址，所以面板给不出深链——它给的是"去哪儿找"。

## worker 的边界

一个 worker Session 用 `danger-full-access` + `approval: never`（无人值守没人可问）。**必须分清哪些是真边界、哪些只是约定**：

**DSH 强制的（真的挡住）**

1. **工具白名单**：`WORKER_TOOLS`（文件、搜索、shell 与作业、web、skill、todo、subagent）+ `myagent_report`。
   没有 ask-user、present、plan-mode、plugin-manager、schedule、goal、workflow。
2. **Ticket 结束后一律拒绝**：`tools.guard` 在 Ticket 结束后拒绝任何调用——授权随 Ticket 结束而结束，
   留着的 Session 只供人翻看。

**只是提示词约定的（挡不住一个存心越界的模型）**

3. **"待在自己的目录里"**。每个 worker 的 cwd 是 `<workRoot>/<slug>-<id前8位>`，但在 `danger-full-access` 下
   DSH 的文件沙箱**不限制任何修改**（`sandbox-policy/src/index.ts:71-72`）——那个目录是 cwd，不是围栏。
   `prompts/worker.md` 里那句"待在你的目录里"是唯一约束。**别把它当安全边界。**

**已知缺口**

4. **子代理逃过上面两条**：worker 用 `subagent` 派生的子代理，其作用域链是「子 → 预设 → 全局」，**不经过父 worker**
   （`agent-preset-registry/src/index.ts:171-174`、`core/tools/src/index.ts:394-397`），所以父身上的 `tools.restrict`
   和结束后的 `tools.guard` 对子代理都不生效。能碰到它的只有 `stopBackground`/`drainChildren`（尽力而为，10 秒上限）。

**换成真隔离几乎免费**（V2 的 P6 要做的事）：DSH 的 `workspace-write` 预设，其边界**就是 session 自己的 cwd**
（`sandbox-policy/src/index.ts:199-206`），由操作系统强制——macOS Seatbelt、Linux bwrap/Landlock、Windows ACL
受限令牌；而且**沙箱不可用时它拒绝执行，不会悄悄退回不受限**（`sandbox-local/src/index.ts:1-8`）。
配上 `approval: never`，越权请求被确定性拒绝（`user-approval/src/index.ts:64`）。myagent 本来就用 Ticket 目录当 cwd
创建 worker，所以换预设即可得到"物理上写不出自己目录"的 worker。代价：需要写目录外的配方（例如每日摘要写
`~/Documents/SA/digests/`）得靠 `additionalWritableRoots`（部署级）或由 scope 声明的可写根来满足。

`prepare` 命令失败**不重试**：半成品目录在下次尝试看来像是准备好了，那比重试一次危险得多。
它会直接把这个 Ticket 报成 `failed`，并把命令的输出记在报告里。

## 状态与恢复

- 一个 SQLite 文件（`node:sqlite`，零原生依赖，WAL）：**11 张表** —— schema_version / triggers / tickets / decisions / effects / kv / artifacts / projects / works / events / ticket_deps。
  （曾经还有一张 `settings`，它从建库起就没有写入点，已在迁移第 2 步删除。）
  每张表都有一列 `record` 存实体的完整 JSON，**JSON 是权威、其余列只是可查询的派生副本**；所以数据库里没有外键约束，引用完整性由 Engine 保证。详见 `docs/v2/13-data-model.md`。
- **一个状态目录只允许一个写者**：`myagent.lock` 记录持有者 pid；持有者已死的锁会被接管，活着的则明确报
  `LockHeld` 并拒绝启动，而不是两个 Engine 同时启动同一个 worker。
- 数据库由更新版本写过（schema 号更大）时拒绝打开。
- 启动时的恢复规则：**Assignment 说在跑、而它的 Session 不在**，就是被进程死亡打断——结束成 `interrupted`，
  加一条说明「进程重启了」的输入，开一个新 Assignment 在同一个目录里接着做。已经载入的 Session 不动。
- 事务里注册的 `afterCommit` 只在最外层提交后跑，回滚就丢掉；嵌套用 savepoint。
- effect 失败按 15s、30s、60s…退避，最多 5 次；彻底失败会在健康里留一条问题。

## 目录

```
src/core/      领域：model、policy（门禁）、engine（唯一的领域写者）、timing、ids、errors、memory（内存仓库，测试用）
src/app/       运行时：store（SQLite）、effects、passes、health、lock、prompts、sessions、tools、executor、delivery、
               views（给面板的形状）、files（读 Ticket 目录，有界且拒绝越界）、agent-delivery（幂等投递）、
               background（停掉 worker 留在身后的作业与子代理）、http、runtime、
               watchdog（探测卡住的启动与静默的 worker，并在救不动时说"需要人"）
src/sources/   来路：kind（协议）、cron、inbox、session、rule（由一次结束自动发起下一件工作）、registry
docs/          设计文档、接入清单（integration-checklist.md：12 条断言与已验证结果）、
               装进日常宿主的手册（install-live.md：装 / 验 / observe→auto / 回滚）
docs/v2/       **V2 的十五份文档（约 6100 行），从本文件原本完全看不见，所以在此列出入口：**
               00 审计与计划（主文档，S1–S37 缺陷目录 + D1–D11 决定 + 逐轮记录）·
               01/02/02b 真宿主验收记录（02 顶部有更正块，02b 是验收代理的复核附录）·
               03 部署与回滚 · 04 执行纪律（7 条 + 事故对照表）· 05 面板 · 06 安全风险清单 ·
               07 模块与能力清单（221 项，五态标注）· 08 验收配方（5 条闭环，可照跑）·
               09 架构图 · 10 新旧对照 · 11 测试报告 · 12 未实现能力（88 条）· 13 数据模型
               **先读 04（纪律）与 06（安全）**：前者说明这个项目犯过哪些错、现在靠什么机制挡住；
               后者说明哪些守卫是真边界、哪些只是逻辑守卫——**worker 没有沙箱**这一条尤其要先知道。
scripts/       verify-live.sh：对已装好的宿主做只读验证（不建 Ticket、不建 Session、不改设置）
panel/         单文件监工台（无构建步骤，原生 JS）：Ticket / 派活 / 门禁记录 / 来源 / 排期 / 设置 / 提示词
prompts/       两个角色的内置提示词（可在面板覆盖）
examples/      两个可直接用的配方（每日竞品摘要 / 月度数据报表），由 tests/recipes.spec.ts 用真实 schema 校验；
               同时也是面板模板的来源（GET /api/recipes 读的就是这些文件，所以不会各说各话）
tests/         挂载、离线全链路、崩溃恢复、配额、幂等投递、后台作业、HTTP、视图、面板（jsdom 真实加载）、
               工具、Effects、Store、门禁与时序、配置解析、来源、提示词、配方
```

## 开发

```bash
pnpm install
pnpm typecheck && pnpm vitest run && pnpm build   # = pnpm check
```

## 已知边界

- **桌面通知能不能点开，取决于本机装了什么。** 装了 `terminal-notifier`（`brew install terminal-notifier`）时通知可以点击直接打开那张 Ticket；只有系统自带的 `osascript` 时，通知会显示标题、状态和摘要的前 160 字，但**点击没有任何反应**，而且在通知中心里署名"脚本编辑器"——那是 osascript 的宿主身份，改不了。通知始终只是提醒，记录在主 Session 与 `RESULT.md` 里。
- **一个被 DSH 留在坏状态里的 Session 是救不回来的。** 崩溃可能把一个 worker Session 留在 `end-seed` 状态，此后每次投递都是"消息进去、turn 立刻 blocked、什么都没产出"。系统现在能认出这种情况：记成 `failed` 报告、上健康板、并写明重试无用（要停掉这张、另开一张，目录原样保留）。它不会自动换一个新 Session——那会在没人看着的时候悄悄丢掉上下文。

- 面板是服务端渲染的单页，没有 React 客户端 bundle；够用，但不是 DSH 原生 UI 插件。
- `tickets.page()` / `count()` 会把所有 Ticket 读进内存——个人规模（几百到几千条）没问题，上万条要换成分页 SQL。
- 没有模型评审（Assessor）：门禁是确定性的，「这个请求值不值得做」由提示词和 `acceptMode` 决定。
- 聊天来源（飞书 / 微信 / Telegram）没接。接缝是现成的：写一个 `SourceKind` 产出 Trigger，
  再给 `Delivery` 加一个 `send`——不需要新的领域概念。
