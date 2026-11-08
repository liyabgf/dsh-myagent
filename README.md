# myagent

属于你自己的 Agent 系统：一个 DeepSeek Harness（DSH）bundle。定时排期、本地投递目录、主 Session 对话、规则、聊天平台这**五条来路**，
经**同一道门禁**变成 Ticket；每个 Ticket 由**自己的 DSH Session**在**自己的目录**里无人值守地做完，再把结果送回**它来的那条路**。

设计目标是给一个人减负：平时你只在 Telegram（或飞书）里说话，面板只在你想查账时打开，能自动的都不问你。

架构参照 [`dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype)，领域模型做了裁剪：
保留 Source / Trigger / Policy / Decision / Mandate / Ticket / Assignment / Report / Delivery 九个概念，
去掉 Thread、Subscription、Correlation，评估（Eval）只有确定性门禁、没有模型评审（接缝留在 `Assessor`）。

**先读 [`SECURITY.md`](SECURITY.md) 再装**：worker 拿到的是完全访问，没有 OS 级沙箱；面板与 API 不在宿主认证之后。
那两条不是待办清单里的项目，而是这套系统的安全模型前提（单机单用户）。

---

## 一条请求走过的路

```
Source ──Trigger──▶ gate（策略）──Decision──▶ Mandate + Ticket ──Assignment──▶ worker Session
                        │                                                          │
                        ├─ ignored：记下原因，什么都不跑                              │ Report
                        └─ observed：记下，不执行（observe 模式）                      ▼
                                                       RESULT.md + 回程（聊天/通知）+ 面板
```

- **Trigger**：一次请求事实。id 由「来源 + 让它唯一的事实」算出（cron 是排期与时刻，inbox 与 chat 是频道与消息 id），
  所以重启不会重复，宕机漏掉的一批时刻折叠成一个 Trigger。
- **gate**：纯函数 `gate(trigger, settings)`。判定 `accepted / observed / ignored`，理由固定成八种
  （`sender_not_allowed`、`source_disabled`、`paused`、`empty_request`、`system_actor`、`unknown_source`、`observed`、`accepted`）。
  每次判定都写一条 **Decision**，面板可查——「为什么没跑」永远有据可查。
  **门禁之前不发生任何领域写入**：连"这条消息在追问某张已完成的任务，所以把它们归到同一个工作"这种归组，
  也是在门禁放行之后、与 Ticket 同一个事务里做的（拒绝即回滚）。
- **Mandate**：授权本身。谁发的（sender）、经哪条来路（via）、范围多大（scope）、强度（explicit/inferred）、
  当时的策略版本号。Ticket 带着它出生，之后改设置**不会**追溯扩大它；会影响在跑 Ticket 的变化会被写进它的历史并告诉它。
- **Ticket / Assignment**：Ticket 是一件工作的全部历史；Assignment 是「一轮执行」。失败、被打断、等人回答之后再继续，
  都是新 Assignment，历史不丢。
- **Report**：worker 用 `myagent_report` 汇报，`state` 是事实分类：`progress / waiting / ready / blocked / failed / dropped`。
  `ready` 和 `dropped` 结束 Ticket；`waiting`、`blocked`、`failed` 让 Ticket 等人——**等人这件事一定会被推到该看到的人面前**
  （送回聊天室、唤醒前台、必要时上健康板），不会只在面板里等着你去发现。
- **Delivery**：`ready/failed/dropped` 写进 Ticket 目录的 `RESULT.md`，并送回它来的那条路。
  如果这份结果复用了别的任务的成果或用到了沉淀的手艺，回程末尾会加**一行人话**说明
  （`（这份用上了「上周竞品数据」的成果）`），没有复用时一个字都不加。前台主 Session 收到一条通知
  （需要人回答时才**唤醒**它，其余只留在历史里，不白花一次模型调用）；可选的 macOS 桌面通知。

所有跨进程的副作用（启动 worker、投递输入、送报告）都走**持久化 effect 队列**，崩溃后重试而不是丢失。

## 五条来路

| 来源 | 怎么产生 Trigger | actor | 备注 |
| --- | --- | --- | --- |
| `cron` | 设置的排期到点 | `operator`（排期就是操作者写下的规则） | `every / daily / weekly / cron` 四种写法、时区、DST；宕机漏掉的时刻折叠成一个 Trigger 并带 `missed` 计数 |
| `inbox` | 往目录里丢一个 `*.md` | `operator`（能把文件放进这个目录的就是操作者，边界在文件系统权限） | 每 5 秒轮询；只认 `.md`、不认隐藏文件；刚写入 1 秒内的文件等下一轮；接手后移到 `accepted/`、`observed/` 或 `rejected/`（拒绝原因写进文件头） |
| `session` | 主 Session 里 `myagent_create_ticket`，或面板「派活」 | 调用者 | 不轮询，走同一道门禁 |
| `rule` | 某个事件发生时（例如一张 Ticket 结束） | 规则自己（`system`） | 规则是操作者写下的，所以它算"人写的自动"；`then` 里给 prompt 与 scope |
| `chat` | 聊天平台的消息，由**桥**写成频道目录里的文件 | **经映射表**得到的名字 | 见下一节；未映射的发送者**被留住、不消耗**，映射补上后由下一次扫描放行 |

### 聊天：桥在外面跑，凭据不进设置

`chat` 来源只认一个**频道目录**：桥进程把平台消息写成带 front matter 的 `.md`，把回复从 `out/` 取走发回平台。
这个切分是有意的——**平台凭据（bot token、app secret）从来不进 myagent 的设置**，因为设置页的高级 JSON 编辑器
渲染的是整份文档，凭据进去就等于出现在面板里。凭据只活在桥自己的 env 文件里。

- 现在能用：**Telegram**、**飞书 / Lark**（`bridges/telegram/`、`bridges/lark/`）。
- 面板的「聊天」页负责**接入引导**：生成 launchd（macOS）或 systemd（Linux）的启动单元、指出 env 文件该放哪、
  显示每个频道的健康（积压、待取回信、最近进气）。它**不代管桥进程**——桥是你自己的服务，起停归你。
- 环境变量清单见 `bridges/README.md` 与各平台 README（`tests/bridges.spec.ts` 有"文档与代码不得漂移"的双向断言）。
  Telegram 桥没有 `package.json`（只用 Node 内置模块与 `bridges/lib/`）；飞书桥有，需要装依赖。
- 出站回复超过平台单条上限会**自动分片**，发送失败按平台的 `retry_after` 退避，分片进度落盘可续。
- 在聊天里**回复机器人的某条报告**并追问，系统会把这次追问与那张已完成的任务归到同一个「工作」下，
  于是新任务能看见旧任务的成果（见下节）。这件事只在门禁放行时发生。

请求文件可以带前置元数据（inbox 只认 `title`、`scope`、`attach`/`attachments` 三个键；多写的键会被忽略，
而发起者恒为 `operator`——能把文件放进这个目录的人就是操作者）：

```markdown
---
title: 本周竞品动态
scope: 只读 ~/notes，产物写在本目录
attach: /abs/last-week.csv
---
整理这三家的更新，产出 digest.md 和 table.csv。
```

## 安装

```
plugin_manager install_bundle  target=github:liyabgf/dsh-myagent
```

装进当前 profile 后启用 `myagent` 插件即可，不需要改 profile 配置——所有路径都有默认值：

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `stateDir` | `<DSH_HOME>/state/myagent` | 数据库与锁；改它会重挂插件 |
| `workRoot` | `<stateDir>/work` | 每个 Ticket 的目录都建在这里面 |
| `inboxDir` | `<stateDir>/inbox` | 投递目录 |
| `mainSessionId` | `myagent-main` | 主 Session（前台） |
| `promptMaxChars` | `100000` | 提示词覆盖上限（volatile，改完即生效） |

随包发布的是 `lib/`（bundle）、`cordis.patch.yml`、`locale/`、`prompts/`、`panel/`、`bridges/`、`examples/`、`README.md`。
**`docs/` 与 `src/`、`tests/`、`scripts/` 不随包**——它们是仓库里的开发资料，装完在宿主里看不到；
本文里指向 `docs/v2/…` 的链接请去 GitHub 仓库看。

### 装进宿主之前（给要改这个仓的人）

`plugin_manager install_bundle` 对**正在运行的** profile 会立即生效，那等于一次宿主热重载：装一个没验证过的 bundle，
就是拿操作者正在用的宿主去试错。所以顺序是固定的：

1. `./scripts/gate.sh` 全绿（typecheck → build → 全部用例 → 产物新鲜度与随包清单），**退出码是唯一判据**。
   其中两组是专门为这一步写的：`tests/mount.spec.ts`（挂载期不创建、不解析、不装饰任何 Session；`apply()` 在一个
   所有服务都抛异常的宿主上也不 reject；`stop()` 每一步都有界、可以停两次；同一状态目录的第二次部署被拒绝），
   `tests/flow.spec.ts`（离线跑完整链路，含 observe 模式一个 worker 都不起）。
2. `node scripts/verify-browser.mjs`：用真浏览器打线上面板做只读检查。它会报告**跳过了哪几条、为什么、谁在覆盖**——
   一条检查凭空消失而结论看不出来，比它变红更危险。
3. 只在需要真宿主行为（模型调用、真实 Session 生命周期）时，才在**独立 profile + 独立端口**上验证，不动日常那个。
4. 挂上以后第一件事是看 `/myagent/api/state` 的 `health`，有问题它会写在那里，不会静默。

几条硬规则，都来自真实翻车：

- **挂载期不碰 Session。** 在 `apply()` 里创建的 agent 会在宿主启动失败时跟着被拆解，把一个插件的错误塞进宿主自己的
  关闭链路。主 Session 改成按需创建（面板按钮，或 `POST /myagent/api/main-session`）。
- **`apply()` 不 reject。** 起不来就记日志、标红健康、什么都不做。
- **DSH 回答的 id 才是真的 id。** `sessionController.create()` 可能复用一个空白 Session 并回一个**不同的** sessionId，
  所以 worker 的 Session id 记在 Ticket 的 `execution.sessionId` 上，之后所有投递、停止、turn 结束都按它寻址。
- **事件监听器里的异常会打死宿主。** `agent/created`、`agent/status`、`session/event` 的回调跑在 DSH 自己的派发里，
  抛出就是 `fatal load failure`、进程退出。所有监听器一律包起来，异常只进日志和健康板。
- **恢复的 worker 要重新授权。** DSH 在 `create()` 返回前就派发 `agent/created`，那一步抛异常会留下一个权限还是
  profile 默认值（`workspace-write` + `approval: ask`）的 Session；`resume()` 必须像新建一样把它配好，
  否则无人值守的 turn 会在等一个没人能给的审批时 `blocked`，Ticket 静默卡死。

bundle 还会注册一个 agent preset `myagent-worker`：**worker Session 专用**，不含向人提问、展示、计划模式、
插件管理、定时、目标、工作流这些工具（无人值守时，任何等人的工具都会把它挂住），前台命令 5 秒转后台。
主 Session 用 profile 自己的默认 preset，只额外挂上 myagent 的工具和提示词段落。

## 第一次运行：先 observe，再 auto

`acceptMode` 默认是 **`observe`**：门禁照常判定、Decision 照常记录，但**什么都不执行、也不写任何领域数据**。
先看几天记录对不对，再在面板里把 `acceptMode` 改成 `auto`。这是刻意的：一个会自己动手的系统，应该先证明它判断得对。

面板：`http://<你的 DSH Web GUI 地址>/myagent/`。
所有 API 只接受同源请求——必须打到 loopback，并带 `x-myagent-request: 1`，别的页面驱动不了它。
（这个头是**同源围栏**，防的是别的网页跨源调用；本机任何进程都能发它。详见 `SECURITY.md`。）

| 面板页 | 做什么 |
| --- | --- |
| 总览 | 一眼看完：几个在跑、几个等人、健康、队列 |
| 任务 | 看进行中/等人/已结束；打开一个任务看范围、报告、输入、产物、事件历史、**关联引用与借力来源**；回答它、补备注、重试本轮、停止、归档或删除 |
| 工作 | 「工作」（Work）与「项目」（Project）的分组：把任务归进去、看一条工作下所有任务与它们的产物、归档或删除 |
| 派活 | 直接开一个 Ticket（和其它来路同一道门禁），可带附件绝对路径、可指定归属的工作、可声明依赖 |
| 记录 | 每个 Trigger 的判定与原因；「丢失」一节列出扫描到但没能入库的请求 |
| 聊天 | 接入一个平台：选平台、看引导正文、生成 launchd/systemd 单元、看每个频道的健康 |
| 设置 | 分区表单 + 整份 settings JSON（两者双向同步），保存即生效；影响在跑的 Ticket 时系统会把变化告诉它们 |
| 提示词 | 覆盖 worker / orchestrator 两个角色的提示词（留空即用内置，单角色可单独恢复）；下方是**「已掌握的手艺」**：内置的三门常驻，加上 worker 沉淀的动态手艺（可暂停、可两步确认忘掉、可跳到来源任务） |

JSON API（都要带那个头）：

```
GET  state | tickets | tickets/:id | tickets/:id/events | tickets/:id/files | tickets/:id/file
     tickets/:id/progress | tickets/:id/dependencies | decisions | triggers | effects | lost
     works | works/:id | projects | projects/:id | schedules | recipes | prompts
PUT  settings | prompts
POST tickets | pass | main-session | schedules/preview | decisions/:id/dismiss
     tickets/:id/answer | note | stop | retry | delete | work | dependencies | dependencies/drop
     works | works/:id/archive | works/:id/unarchive | works/:id/delete
     projects | projects/:id/archive | projects/:id/unarchive | projects/:id/delete
     prompts/skills/:name/toggle | prompts/skills/:name/delete
```

## 设置字段

顶层是 `.strict()` 的：**多写一个不认识的键会整份被拒并点名是哪个路径**，不会静默忽略。

```jsonc
{
  "acceptMode": "observe",          // auto | observe
  "allowedSenders": ["operator"],   // 谁可以发起工作（最多 50 个）
  "paused": false,                  // 暂停：不启动、不投递，什么都不过期
  "executor": {
    "maxWorkers": 2,                // 同时跑几个 worker（1..8）
    "prepare": "",                  // 每个新 Ticket 目录建好后、worker 起跑前跑一次的 shell 命令
    "model": "",                    // worker 用哪个模型，"provider/model"；留空用 profile 默认
    "sandbox": "local"              // 只有 local 可用；写成 "vm" 会在健康板上明说"这个版本没有 VM 沙箱"
  },
  "watchdog": {                     // 看门狗：探测卡住的启动与静默的 worker
    "enabled": true, "everyMs": 60000,
    "launchStuckMs": 600000,        // 启动卡多久算卡住
    "silentMs": 0,                  // 0 = 关；非 0 时静默超过它就打断并换一轮重做
    "maxActions": 2                 // 救几次；到上限就 escalate（写事件 + 上健康板 + 告诉请求者需要人）
  },
  "triage": {                       // 进气分诊：请求先经一个判断，再决定开不开任务
    "enabled": false,               // 默认关：它每条请求要花一轮 Session
    "desk": "dedicated"             // dedicated = 分诊自己一个 Session（默认）；main = 复用你的主 Session
  },
  "sources": {
    "cron": { "enabled": true, "schedules": [
      { "id": "digest", "name": "每日摘要", "prompt": "写今天的摘要", "scope": "",
        "timing": { "kind": "daily", "time": "09:00", "timeZone": "Asia/Shanghai" } }
    ]},
    "inbox": { "enabled": true, "directory": "", "pollMs": 5000 },
    "session": { "enabled": true },
    "rule": { "enabled": true, "rules": [
      { "id": "nightly-after-digest", "when": { /* 事件条件 */ }, "then": { "prompt": "…", "scope": "…" } }
    ]},
    "chat": {
      "enabled": false,             // 默认关：接了平台才开
      "pollMs": 5000,
      "identities": { "<平台用户 id>": { "actor": "operator" } },   // 映射表：平台身份 → 系统里的名字
      "channels": [
        { "id": "telegram", "directory": "~/telegram", "enabled": true }
      ]
      // 每个来源都能各自覆盖 acceptMode / paused / deny / allowedSenders / allowSystemActors
    }
  },
  "notify": { "enabled": false }    // macOS 桌面通知
}
```

`timing` 四种写法：`{kind:'every', seconds}`（≥60）、`{kind:'daily', time, timeZone?}`、
`{kind:'weekly', time, weekdays:[1..7], timeZone?}`、`{kind:'cron', expression, timeZone?}`（五段 Vixie cron，
日/周同时受限时按「或」匹配）。不存在的本地时刻（DST 跳空）跳过，回退日按较早的那个瞬间触发一次。

## 复用与编排：后一个任务不必从零开始

这几件事都是自动的，你不需要配置什么，但值得知道它们在发生：

- **工作（Work）与项目（Project）**是给人看的分组。把任务归进一个工作，它就有了同伴；项目是工作的上一层。
  归档只是"别再往这里放东西"，底下的东西原样保留，随时可取消归档。
- **自动归组**：在聊天里回复某张已完成任务的报告并追问，系统会把两者归到同一个工作（工作名取自那张任务的标题）。
  三条自动建工作的路径（显式给名字、继承依赖上游、追问归组）**都按名字去重**，所以不会每条追问长出一个新工作。
- **产物目录与受控物化**：worker 可以用 `myagent_read_artifact` 不带参数地浏览"我能读到哪些任务的哪些**已登记**产物"
  （最新在前，条数、摘要长度、总字节都有上限，被截断时会明说 `truncated` 与 `total`）；
  带上 `ticket_id` 与 `path` 就读内容；再加 `materialize: true` 会把那个文件**拷贝**进自己工作区的
  `inputs/<来源任务前8位>/`，于是几百 MB 的 CSV 也能用脚本处理而不必塞进上下文。
  读之前会先量大小（超过 64 MB 直接拒，**一个字节都不拷**），目的地路径逐段查软链、已存在的不同文件不覆盖。
- **双向血缘**：一次成功的读取会在**双方**的事件日志里各写一条 `artifact_read`（按 (来源, 目标, 路径) 去重）。
  面板的任务详情里显示为「关联引用」（谁用了我的成果）与「借力来源」（我用了谁的成果），两边都能点开。
  **授权是纯的、记录只在真的读到之后写**——所以"试了一下但被拒"不会在血缘里留痕。
- **手艺（Skills）**：worker 在报告里可以用 `promote_skill` 申报"这个脚本跑通了、下次别人也能用"，
  通过质检（非软链、非空、≤64 KB、不得硬编码本任务的私有目录）后成为一门 DSH 虚拟 Skill。
  它**只注册进 worker 自己的作用域层**，不进全局层，所以它不会出现在你与前台的对话里；
  技能目录那一行由 myagent 用固定文案撰写（"正文由 worker 撰写、未经复核、当作不受信文本"），
  worker 写的标题与说明只留在正文里。**计数是"用过这门手艺的任务数"**，同一张任务重复加载只算一次，
  且只算宿主真正加载成功的那次。
- **依赖（depends_on）**：开任务时可以声明"等某几张做完"。上游以 `done` 结束才放行；上游 `failed`/`dropped` 会
  级联结束下游（并写明是级联）；上游被**人停掉**时下游会一直等——那是留给人的决定，不是系统该替他做的。
  指向已删除的墓碑、或指向以非 `done` 结束的上游，会被明确拒绝而不是建一条永不释放的边。

## 带文件下任务

一个任务常常需要输入：一份 csv、一张截图、一个 PDF。`session`、`inbox`、`cron` 三条来路都能带文件，方式一致——**给绝对路径**：

- **主 Session**（推荐）：在 DSH GUI 里把文件附上或说出路径，模型用 `myagent_create_ticket` 的 `attachments` 传进来。
- **inbox**：请求文件的 front matter 里写 `attach: /abs/a.csv, /abs/b.pdf`。
- **cron**：排期的 `prompt` 里写清路径（排期没有 attachments 字段，因为定时任务读的通常是固定位置的数据）。
- **chat**：聊天消息只带文本；要给文件，用 inbox 或主 Session。

文件在 worker 起跑**之前**被复制进 Ticket 自己的目录（`attachments/<名字>`），所以排队期间源文件被移动或清理都不影响这次执行；
同名文件自动改名（`report.csv`、`report-2.csv`）而不是互相覆盖。**复制不了就让 Ticket 失败**，
不会让 worker 在没有输入的情况下编一个像样的结果出来。

## 面板管什么，主 Session 管什么

**下任务走对话（聊天平台或主 Session），面板只做监工与查账。** DSH 的 GUI 已经是一个成熟的对话入口，
原生支持附件、图片、文档和流式进度，在面板里重造一套只会更差。

| | 对话（Telegram / 飞书 / 主 Session） | 面板 `/myagent/` |
| --- | --- | --- |
| 派活、带文件、追问 | **在这儿做**：一句话说完；带文件走主 Session 或 inbox | 也能派，表单而已；带文件要填绝对路径 |
| 看谁在跑、跑到哪一步 | 报告与"需要人"的推送会送到你说话的那个房间 | **在这儿看**：实时进度（第几轮、最近的工具调用、它最后说了什么） |
| 看产出了什么 | 回程里列了文件名，还有一行"这份用上了谁的成果" | **在这儿看**：目录树、大小、文本内联预览、任何文件都能下载、血缘 |
| 干预（回答/备注/重试/停止） | 可以让模型代做（`myagent_answer_ticket` 等） | **在这儿做**：停止要填原因，删除是两步确认且写明后果，都不用浏览器原生弹窗 |
| 改设置、提示词、排期、手艺 | 可以让模型代做 | **在这儿做**：排期编辑器带下次触发预览，改完立刻生效 |

worker 的 Session 在 GUI 会话列表里就叫 **Ticket 的标题**（面板给你 id 和一键复制）。
这个宿主没有指向某个会话的网址，所以面板给不出深链——它给的是"去哪儿找"。

## worker 的边界

一个 worker Session 用 `danger-full-access` + `approval: never`（无人值守没人可问）。**必须分清哪些是真边界、哪些只是约定**：

**DSH 强制的（真的挡住）**

1. **工具白名单**：`WORKER_TOOLS`（文件、搜索、shell 与作业、web、`skill`、todo、subagent）
   + myagent 自己的三个：`myagent_report`、`myagent_read_artifact`、`myagent_note_ticket`。
   没有 ask-user、present、plan-mode、plugin-manager、schedule、goal、workflow，也没有任何平台工具。
2. **Ticket 结束后一律拒绝**：`tools.guard` 在 Ticket 结束后拒绝任何调用——授权随 Ticket 结束而结束，
   留着的 Session 只供人翻看。
3. **跨任务只有两道门**：读别的任务的产物必须走 `myagent_read_artifact`（只读**已登记**的路径，
   门禁是 `canCollaborate`：同一个工作，或两张都未归入任何工作），递话必须走 `myagent_note_ticket`（落成目标 Ticket 上的一条 Input）。
   两道门都写事件、都在面板上可见。**"未归入工作"不是隔离而是开放**——要隔离就把任务归进一个工作（`SECURITY.md` §4）。

**只是提示词约定的（挡不住一个存心越界的模型）**

4. **"待在自己的目录里"**。每个 worker 的 cwd 是 `<workRoot>/<slug>-<id前8位>`，但在 `danger-full-access` 下
   DSH 的文件沙箱**不限制任何修改**——那个目录是 cwd，不是围栏。`prompts/worker.md` 里那句话是唯一约束。
   **别把它当安全边界。**

**已知缺口**

5. **子代理逃过上面两条**：worker 用 `subagent` 派生的子代理，其作用域链是「子 → 预设 → 全局」，**不经过父 worker**，
   所以父身上的 `tools.restrict` 和结束后的 `tools.guard` 对子代理都不生效（而父的作用域层里的**手艺**它会继承）。
   能碰到它的只有 `stopBackground`/`drainChildren`（尽力而为，10 秒上限）。

**换成真隔离不是免费的**：DSH 的 `workspace-write` 预设由操作系统强制（macOS Seatbelt、Linux bwrap/Landlock、
Windows ACL 受限令牌），且沙箱不可用时拒绝执行而不悄悄退回不受限——但 myagent 目前有六处仍是宿主直接 IO
（附件投递、`RESULT.md`、`REPLY-UNDELIVERED.md`、任务删除时的目录清理、目录列举与度量、`prepare` 命令的执行），
它们都得先搬进 `ExecutionSandbox` 接口，`executor.sandbox: 'vm'` 才有意义。所以现在把它设成 `'vm'`
**不会**静默假装隔离，而是在健康板上明说做不到（清单见 `docs/v2/12-unimplemented.md` §3.1）。

`prepare` 命令失败**不重试**：半成品目录在下次尝试看来像是准备好了，那比重试一次危险得多。
它会直接把这个 Ticket 报成 `failed`，并把命令的输出记在报告里。

## 状态与恢复

- 一个 SQLite 文件（`node:sqlite`，零原生依赖，WAL）：**11 张表** —— schema_version / triggers / tickets / projects /
  works / decisions / effects / artifacts / events / ticket_deps / kv。
  每张表都有一列 `record` 存实体的完整 JSON，**JSON 是权威、其余列只是可查询的派生副本**；所以数据库里没有外键约束，
  引用完整性由 Engine 保证。详见 `docs/v2/13-data-model.md`。
- 删除一张任务是**两个独立的选择**：产生的资产（目录里的文件、`RESULT.md`）留不留，记录（标题、授权、报告、事件历史）留不留。
  留记录就是留一块**墓碑**：它从所有列表里消失，但按 id 仍能解析，所以别的任务里指向它的备注与产物会显示"已删除"而不是报错。
  删除是两步确认，后果写明路径、文件数与总字节；任务还在跑时拒绝删除。
- **一个状态目录只允许一个写者**：`myagent.lock` 记录持有者 pid；持有者已死的锁会被接管，活着的则明确报
  `LockHeld` 并拒绝启动，而不是两个 Engine 同时启动同一个 worker。
- 数据库由更新版本写过（schema 号更大）时拒绝打开。
- 启动时的恢复规则：**Assignment 说在跑、而它的 Session 不在**，就是被进程死亡打断——结束成 `interrupted`，
  加一条说明「进程重启了」的输入，开一个新 Assignment 在同一个目录里接着做。已经载入的 Session 不动。
- 事务里注册的 `afterCommit` 只在最外层提交后跑，回滚就丢掉；嵌套用 savepoint。
- effect 失败按 15s、30s、60s…退避，最多 5 次；彻底失败会在健康里留一条问题，并且**会告诉该知道的人**。

## 目录

```
src/core/      领域：model、policy（门禁）、engine（唯一的领域写者）、timing、ids、errors、memory（内存仓库，测试用）
src/app/       运行时：store（SQLite）、effects、passes、health、lock、prompts（含手艺库）、skills（内置手艺与动态注册）、
               sessions、tools、executor（含 ExecutionSandbox 与本地实现）、delivery、views（给面板的形状）、
               files（读 Ticket 目录，有界且拒绝越界）、agent-delivery（幂等投递）、
               background（停掉 worker 留在身后的作业与子代理）、http、runtime、
               watchdog（探测卡住的启动与静默的 worker，救不动时说"需要人"并推到该看到的人面前）
src/sources/   来路：kind（协议）、cron、inbox、session、rule、chat、registry
bridges/       聊天平台的桥（独立进程，不是插件的一部分）：lib/ 共用件、telegram/、lark/，
               各带 README 与环境变量表；面板只生成启动单元与做接入引导，不代管进程
docs/          设计文档、接入清单、装进日常宿主的手册（**不随包发布**，见上文）
docs/v2/       28 份文档、约 16900 行。入口：00 审计与计划（主文档，缺陷目录 + 决定 + 逐轮记录）·
               01/02/02b 真宿主验收记录 · 03 部署与回滚 · 04 执行纪律（7 条 + 事故对照表）· 05 面板 ·
               06 安全风险清单 · 07 模块与能力清单（五态标注）· 08 验收配方 · 09 架构图 · 10 新旧对照 ·
               11 测试报告 · 12 未实现能力 · 13 数据模型 · 20 能力与资产分析 · 25 生态节点与任务环境 ·
               26 真机验收步骤
               **先读 04（纪律）与 06（安全）**：前者说明这个项目犯过哪些错、现在靠什么机制挡住；
               后者说明哪些守卫是真边界、哪些只是逻辑守卫——**worker 没有沙箱**这一条尤其要先知道。
scripts/       gate.sh（四步闸门，退出码是判据）、verify-browser.mjs（真浏览器只读检查，会报告跳过项）、
               verify-live.sh（对已装好的宿主做只读验证）、release.sh（脱敏、扫描、发布与远端核实）
panel/         单文件监工台（无构建步骤，原生 JS）：总览 / 任务 / 工作 / 派活 / 记录 / 聊天 / 设置 / 提示词与手艺
prompts/       三个角色的内置提示词：worker、orchestrator、triage（前两个可在面板覆盖）
examples/      可直接用的配方（每日竞品摘要 / 月度数据报表），由 tests/recipes.spec.ts 用真实 schema 校验；
               同时也是面板模板的来源（GET /api/recipes 读的就是这些文件，所以不会各说各话）
tests/         挂载、离线全链路、崩溃恢复、配额、幂等投递、后台作业、HTTP、视图、面板（jsdom 真实加载）、
               工具、Effects、Store、门禁与时序、配置解析、五类来源、提示词与手艺、配方、桥（含文档漂移双向断言）
```

## 开发

```bash
pnpm install
pnpm typecheck && pnpm vitest run && pnpm build   # = pnpm check
./scripts/gate.sh                                  # 四步闸门；退出码 0 才算绿
```

## 已知边界

- **worker 没有 OS 级沙箱**，面板与 API 不在宿主认证之后，inbox 的发起者身份是自述的。
  这三条是设计前提而不是待办，完整分级见 [`SECURITY.md`](SECURITY.md) 与 `docs/v2/06-security-risk-register.md`。
- **桌面通知能不能点开，取决于本机装了什么。** 装了 `terminal-notifier` 时通知可以点击直接打开那张 Ticket；
  只有系统自带的 `osascript` 时，通知会显示标题、状态和摘要的前 160 字，但**点击没有任何反应**，
  而且在通知中心里署名"脚本编辑器"——那是 osascript 的宿主身份，改不了。通知始终只是提醒，
  记录在回程消息与 `RESULT.md` 里。
- **一个被 DSH 留在坏状态里的 Session 是救不回来的。** 崩溃可能把一个 worker Session 留在 `end-seed` 状态，
  此后每次投递都是"消息进去、turn 立刻 blocked、什么都没产出"。系统能认出这种情况：记成 `failed` 报告、上健康板、
  写明重试无用（要停掉这张、另开一张，目录原样保留）。它不会自动换一个新 Session——那会在没人看着的时候悄悄丢掉上下文。
- 面板是服务端渲染的单页，没有 React 客户端 bundle；够用，但不是 DSH 原生 UI 插件。
- `tickets.page()` / `count()` 会把所有 Ticket 读进内存——个人规模（几百到几千条）没问题，上万条要换成分页 SQL。
- 没有模型评审（Assessor）：门禁是确定性的，「这个请求值不值得做」由提示词、`triage` 与 `acceptMode` 决定。
- 个人微信 / 个人 QQ 没有官方 API，不做。企业微信、钉钉、Discord、Slack、QQ 官方机器人的桥尚未写；
  接缝是现成的：照 `bridges/telegram/` 写一个 transform + bridge，再在面板的平台清单里加一行。

## 报告安全问题

见 [`SECURITY.md`](SECURITY.md)。请开一个 private 的 GitHub security advisory，或在 issue 里注明 `[security]`
并避免附上可复现的凭据；**不要在 issue 里粘贴你的 `stateDir` 内容**（`myagent.lock` 里有 token，
`myagent.sqlite3` 里有你的全部工作记录）。
