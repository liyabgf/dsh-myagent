# 生态节点与任务环境：接入微信/飞书/电报，以及 terminal-mac 的定位

本文两部分：**(A)** 三个聊天平台怎么接成 myagent 的生态节点；**(B)** `govijr/terminal-mac` 是什么、能不能当"更好的任务环境"。

证据分级：**【代码】**＝本仓源码里读到的（可复核，附行号）；**【平台】**＝各平台公开 API 的常识，
接入前必须核对当前版本文档（我没有联网核对过它们的最新变化）；**【判断】**＝我的建议与取舍。

---

## A. 生态节点

### A.1 桥的契约——【代码】`src/sources/chat.ts:1-55` 的文件头就是规范

`chat.ts` 的注释原话：它是 P8 的参考实现，两端都是文件系统，**"and the shape a third-party platform Source copies"**。
所以接一个平台**不需要改 myagent 一行代码**，只需要写一个桥进程。契约如下：

**入站（桥 → myagent）**：频道目录**顶层**的一个 `*.md` 文件 = 一条消息。

```md
---
from: U01ABCDEF        # 平台身份，必填：它是 sources.chat.identities 的键
id: msg-123            # 平台消息 id，可选；没有它则**文件名**就是这条消息的身份
thread: t-9            # 可选；会随 replyTo.thread 回到出站文件
title: weekly alerts   # 可选；文件名是兜底
---
正文即请求文本
```

四条硬规则（都来自 `chat.ts:27-47`）：

| 规则 | 内容 | 桥要注意什么 |
| --- | --- | --- |
| **身份只映射、不推断** | `from` 不在 `identities` 里 → **不产生 Trigger 也不产生 Decision**，消息**原地滞留**，健康板报"有几条等着映射" | 不要为了让消息通过而伪造 `from`；滞留是**唯一可逆**的答案 |
| **不按标点拒绝** | front matter 坏了、或没有 `from`，**不当错误拒绝**，而是像未映射一样滞留 | 桥写坏了文件不会丢消息，就地改好、下次扫描就受理 |
| **幂等** | Trigger id = `key('chat', channelId, messageId)`，**只由消息身份决定，绝不含时间戳** | 重投同一个 `id` 是同一条消息；真要新消息必须换 `id` 或换文件名 |
| **先认领后处理** | 取走一条消息时**先 unlink 原文件**，两次重叠扫描只有一个能归档 | 桥不要依赖"文件还在"来判断是否已处理 |

**出站（myagent → 桥）**：`<频道目录>/out/reply-<hash>.md`【代码 `chat.ts:469-497`】

- 内容 = 可选 front matter `---\nthread: <t>\n---\n` + 正文；
- 文件名 hash 是 `(channel, thread, text)` 的纯函数 → **重试写同样字节，不会重复发**；
- 放在 `out/` 而不是与入站文件并列，因为该 Source 会读顶层所有 `*.md`——回信放外面会被当成一条没有 `from` 的消息，永远滞留在健康板上；
- `deliver` **故意不受** `enabled`/`paused`/`deny` 约束：那三者拦的是**进气**（不产生新工作），而一份已经授权的工作欠下的报告不是新工作。把它扣住会让"答案没送到"和"答案本来就不欠"变得无法区分；
- 频道不存在或被停用 → `UserError('reply_unroutable')`（"地址写过了，却没人收"）。

> **桥必须消费 `out/`**：读走 → 发到平台 → 删除或移走。文件名本身是幂等键，桥自己的去重也应该用它。

**频道配置**【代码 `src/core/policy.ts:168-205`】：

```
sources.chat.enabled      bool，默认 false
sources.chat.identities   平台账号 id → { actor: 必填 1-120 字, note?: ≤500 字 }   .strict()
sources.chat.channels[]   最多 20 条，id 唯一：
    id          /^[a-z][a-z0-9-]{0,39}$/   （如 telegram-main、lark-dev、wecom-ops）
    directory   1..4096，**必填不给默认**——否则多个频道会静默读同一个地方
    enabled     bool，默认 true
```

**关键结论**：`channels` 与 `identities` 都是 **`.strict()`**，加任何额外字段都会被 schema 拒掉。
所以**平台凭据（bot token、app id/secret）在结构上就不可能放进 myagent 的配置**——
它们只能待在桥进程自己的环境里。这不是限制，是正确的边界：

> **myagent 保持平台无关；桥持有凭据；myagent 持有"谁是谁"与"谁能派活"。**

### A.2 桥的职责边界【判断】

桥**只做三件事**：① 把平台事件写成入站 `.md`；② 消费 `out/` 并发回平台；③ 保管自己的凭据与重连。

桥**绝不做**：身份判定（那是 `identities`）、授权（那是 `allowedSenders`）、去重（那是 Trigger id）、
重试（那是效果队列）。**把安全判断放进桥，等于把它放到一个没有测试、没有门禁、没人看的地方。**

### A.3 三个平台的可行性排序

| 平台 | 难度 | 要点【平台，接入前需核对当前文档】 |
| --- | --- | --- |
| **Telegram** | **最低** | Bot API：`getUpdates` 长轮询即可，**不需要公网入口**；`message.from.id` → `from`，`message_id` → `id`，论坛话题用 `message_thread_id` → `thread`；回信 `sendMessage(chat_id, message_thread_id)`。建议第一个做，用它验证 `out/` 回写闭环 |
| **飞书 / Lark** | 中 | 自建应用 + 事件订阅；SDK 支持**长连接模式**，同样免公网回调。`open_id`/`union_id` → `from`（**选一个并固定**，两者混用会让同一个人变成两个身份）；话题/回复用 `root_id` → `thread`；回信 `im/v1/messages` 带 `receive_id_type` |
| **微信** | **最高，且要选路** | **个人微信没有官方机器人 API**。可行的是 **企业微信自建应用**（官方、稳定，支持收发消息与群机器人）；公众号/服务号的客服消息是次选（有 48 小时窗口等限制）。**逆向协议（各种 hook/itchat 类）违反服务条款、封号风险高，不做** |

**关于"飞信"**：你写的是"飞信"。飞信（Fetion，中国移动）已基本停止运营、**没有开放的机器人 API**；
我按上下文猜你指的是**飞书（Lark）**并据此设计。**如果确实是飞信，请告诉我**——那条路我不建议走。

### A.4 "嗅探群里的问题" 怎么落——用现有机制，不加新代码【判断】

你的设想是两种模式并存：**被动嗅探**（读群聊、判断有没有问题、去解决）与**主动发起**（有人直接派活）。
主动发起已经支持（一条消息 = 一个 Trigger）。被动嗅探有一个**必须先解决的结构性问题**：

> **如果把群里每条消息都写进频道目录**，那么所有未映射的人的消息都会**原地滞留**——
> 健康板的"等映射"数会持续上涨、频道目录无界增长，而其中 99% 是闲聊。
> 滞留的设计初衷是"别把还能救的消息判死"，不是"当聊天记录用"。

所以嗅探不该走 chat Source，而该这样分工：

| 用途 | 走哪条路 | 为什么 |
| --- | --- | --- |
| **全量群聊记录** | **桥自己存**（在 myagent 之外，一个 transcript 目录/库） | 便宜、无界、不惊动门禁。myagent 不该为"记录"付门禁与健康板的代价 |
| **定时判断"有没有要动手的"** | **排期（已有）**：每隔一段时间发起一条请求——"读 `<transcript 路径>`，判断有没有需要处理的问题；有就产出结论/建工作" | 这是一条**有明确发起人（你）与明确 scope** 的正常任务，走的是与手动派活同一道门禁 |
| **显式 @ 机器人 / 私聊** | **chat Source → Trigger** | 这是"有人主动发起"，需要门禁判断谁能派活 |
| **先观察一周再放开** | **受理模式 `observe`** | 只记录"本来会受理什么"，什么都不执行——正好用来校准嗅探的误报率 |

三层授权不要混（这是现有设计的核心，也是嗅探场景唯一的安全阀）：
`identities` 决定**你是谁**，`allowedSenders` 决定**谁能派活**，`scope` 决定**能干什么**。

### A.5 建议的顺序与验收标准

| 步 | 内容 | 验收 |
| --- | --- | --- |
| **N1** | Telegram 桥（长轮询） | 群里 @ 一句 → 面板「聊天」页出现等映射 → 加映射 → 任务被受理 → **报告回到同一个话题**（`out/` 闭环） |
| **N2** | 飞书桥（长连接） | 同上；额外验证 `thread` 回到正确的帖子 |
| **N3** | 企业微信桥 | 同上；先确认走自建应用还是群机器人 |
| **N4** | transcript + 定时判断（嗅探） | 排期任务能读 transcript 并产出"今天群里有 N 件事值得动手"；`observe` 模式下先跑一周看误报 |
| **N5** | terminal-mac 接入（见 B） | worker 能截图/点击虚拟 Mac，并跑通一个"必须用 GUI"的示例任务 |

---

## B. terminal-mac：定位与真实边界

来源：<https://github.com/govijr/terminal-mac>（README，2026-11-07 读取）。以下事实均来自该 README。

### B.1 它是什么

**给 computer-use agent 用的一台独立 macOS 虚拟机**，从终端里看和控制（Apple Virtualization 跑真实 macOS guest；
guest 内的 helper 截屏并投递输入事件；终端用 Kitty/Ghostty/iTerm2 的图形协议显示）。

- 对外接口：**MCP 工具** `screenshot` / `click` / `drag` / `scroll` / `type` / `key` / `status`，
  外加一个教 observe → act → verify 循环的 skill；也有 CLI（`terminal-mac action default click 640 400`，返回 JSON、失败非零退出）。
- 要求：Apple silicon + macOS 14+；Ghostty/Kitty/iTerm2 才有内嵌画面；默认 64 GiB 逻辑磁盘；首次要下载数 GB 的 Apple 恢复镜像。
- 成熟度（README 自述）：**early release candidate**；**自签名、未公证**；"Live guest acceptance on a clean Mac is still pending"；
  **首次必须交互式初始化**（在 guest 里走完 Setup Assistant、建账号、手动授予 Screen Recording 与 Accessibility）——不是无人值守安装。
- 尚未实现：VM 克隆、**回滚快照**、无障碍树快照、无人值守 guest 安装、tmux 透传；**也故意没有"删除 VM"的命令**。

### B.2 隔离模型的真实边界（这一段最重要）

**它隔离了什么**：guest 是另一台 Mac，有自己的应用/文件/账号/权限；**不使用宿主的输入与截屏 API**；
helper 拒绝在 `hw.model` 不以 `VirtualMac` 开头的机器上运行；宿主 home、项目目录、剪贴板、麦克风、摄像头**都不挂载**；
只有两个显式共享：`control`（读写，请求/应答 JSON 与截图）与 `tools`（只读的 helper app）；
没有远程控制网络监听，mailbox 会拒绝符号链接/硬链接/非常规文件、限制消息大小、校验请求 id、让过期动作失效。

**它没有隔离什么**（README 原话）：默认 NAT 网络**允许 guest 上网，并可能触达宿主与局域网上的服务**——
"**This is not a network-isolated or hardened hostile-code environment**"。`--offline` 可以去掉这条网络路径（但也就没法调外部 API 了）。

> 【判断】所以它的定位是**"别动我的桌面"，不是"可以跑不可信代码"**。
> 如果目标是跑不可信代码，需要的是容器/网络隔离，terminal-mac 不提供那一半。

### B.3 它**不能**"成为"任务环境——而你说的另一个方向才是对的

你给了两个选项："给它一个更好的任务环境"，或者"这个环境直接是 DSH 的"。README 的证据支持**后者**：

1. **MCP 工具里没有 shell exec**——只有 screenshot/click/drag/scroll/type/key/status。
   要在 guest 里跑一个 CLI agent，只能通过 `type` + `key` **往一个 GUI 终端里打字**，这条路脆弱且不可靠。
2. **宿主的项目目录没有挂进 guest**（只有 `control` 与 `tools` 两个共享），
   而 myagent 的 worker 恰恰需要一个工作目录（`stateDir/work/<ticket>/`）来读写产物。
3. terminal-mac 自己的定位也这么说："gives agents **computer use** in a separate virtual Mac"——
   它是一台**被驱动的设备**，不是一个**执行环境**。

**【判断】推荐的接法**：DSH/myagent 继续当任务环境（工作目录 + CLI worker + 门禁 + scope），
**terminal-mac 作为一台"设备"通过 MCP 接给 worker**：

```
terminal-mac mcp            # 起 MCP server
→ DSH 的 MCP 连接            # worker 于是拿到 screenshot/click/type/key/...
→ terminal-mac skills install --dir <worker 能读到的 skills 目录>
                             # myagent 已经 inject: ['skills']，这条现成
```

这样得到的是**新能力**（GUI 自动化：没有 API 的桌面应用、需要登录态的网页、Excel/客户端类操作），
而任务环境、权限模型、审计日志一律不变。**改动量最小、风险最低，而且这正是该工具的设计意图。**

### B.4 一个必须说清的风险：提示注入 → computer use

把 A 和 B 放在一起看，风险是叠加的：

> 群里的消息**不由你写**（任何人都能在群里说话），而 worker 现在能**操作一台有网、且能触达宿主局域网的 Mac**。
> 一条精心构造的群消息就可能把 worker 诱导去做它本不该做的事——这是真实的升级路径，不是理论。

现有设计里能用的防线（都已经在，关键是**别为了省事绕过**）：

| 防线 | 怎么用 |
| --- | --- |
| `identities` + `allowedSenders` | **只有映射过且在名单里的人能派活**。群聊里陌生人的话只是内容，不是指令 |
| `scope` | 给带 computer-use 的任务写明确的范围（例如"只在这个网页里查资料，不安装任何东西，不发送任何消息"） |
| `observe` 模式 | 新桥先跑 observe，看一周"本来会受理什么"，再放开 |
| `--offline` | 不需要上网的 GUI 任务，用离线 VM——直接切断"注入 → 外传"这条路 |
| guest 账号最小化 | 虚拟 Mac 里**不要登录敏感账号**（邮箱、银行、公司 SSO）；它是个工具机，不是你的第二台工作机 |

---

## C. 需要你定的三件事

1. **"飞信"是飞书（Lark）吗？** 如果是飞信本身，我建议不做（无开放 API）。
2. **微信走哪条路？** 企业微信自建应用（推荐，官方稳定）／公众号客服消息／先不做微信。
3. **terminal-mac 先接不接？** 我的建议是**排在 N1–N4 之后**：先把聊天闭环跑通（那是"AI 工作伙伴"的入口），
   再加 computer-use（那是"手"）。理由是入口没通之前，手没有活可干；而且 VM 要占几十 GB 磁盘与一次交互式初始化。
   如果你想先看它跑起来的样子，我可以只做"装 + 起 VM + 一张截图"的最小验证，不接 myagent。
