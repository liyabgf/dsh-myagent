# 飞书 / Lark 桥

用**长连接事件订阅**（WebSocket），**不需要公网地址、不需要配加解密**。
这是套件里**唯一需要装依赖**的桥——原因见下。

契约、排障、安全边界见 [`../README.md`](../README.md)。

## 0. 为什么这个桥要 `npm install`

飞书的长连接是 **protobuf over WebSocket**（官方 SDK 为此带了约 29 KB 生成代码 `pbbp2`）。
零依赖实现它，等于手写一个**没人能从文档核实的协议**——那正是桥最不该有的性质。
所以这个桥用官方 SDK 做**传输**，且只做传输：

- **身份、授权、去重**仍在 myagent（`identities` / `allowedSenders` / Trigger id）
- **消息映射**在 `transform.mjs`，是纯函数，**不装 SDK 也能测**（`tests/bridges.spec.ts`）

依赖只装在 `bridges/lark/`，不进 myagent 的 `package.json`。

## 1. 建应用（开发者后台）

1. 建一个**企业自建应用**，记下 **App ID** 与 **App Secret**（凭证与基础信息）。
2. 加**机器人**能力。
3. 开权限：**读取与发送单聊、群聊消息**（`im:message` 一类）。
4. **事件订阅 → 选「长连接模式」**，订阅事件 **`im.message.receive_v1`**。
5. **创建版本并发布**，通过企业管理员审核。**没发布的应用不会推事件**——这是最常见的那个"什么都不发生"。

> 国际版 Lark 用 `LARK_DOMAIN=lark`；国内飞书用默认 `feishu`。

## 2. 在面板里建一个频道

「聊天」页 → 频道表单：id 例如 `lark-main`，目录用绝对路径。
（目录不用手工建，但**权限要紧**：谁能写这个目录，谁就能以任何已映射身份提交工作。建议 `chmod 700`。）

## 3. 写 env 文件

```sh
mkdir -p ~/.config/myagent/bridges
cat > ~/.config/myagent/bridges/lark-main.env <<'ENV'
LARK_APP_ID=cli_xxxxxxxx
LARK_APP_SECRET=xxxxxxxxxxxxxxxx
MYAGENT_CHANNEL_DIR=~/.myagent/channels/lark-main
LARK_MODE=mentions
ENV
chmod 600 ~/.config/myagent/bridges/lark-main.env
```

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `LARK_APP_ID` | ✅ | — | 开发者后台 → 凭证与基础信息 |
| `LARK_APP_SECRET` | ✅ | — | 同上 |
| `MYAGENT_CHANNEL_DIR` | ✅ | — | 与面板那条频道的目录**完全一致** |
| `LARK_MODE` | | `mentions` | `mentions`（私聊 + 群里 @ 它或 @所有人）/ `dm` / `all` |
| `LARK_CHATS` | | 空 | 只收这些 `chat_id`（逗号分隔） |
| `LARK_BOT_OPEN_ID` | | 自动读 | 机器人自己的 `open_id`。读不到就**退化成"任何 @ 都算"**，并在日志里说明 |
| `LARK_DOMAIN` | | `feishu` | 海外版填 `lark` |
| `MYAGENT_OUTBOUND_MS` | | `3000` | 多久扫一次 `out/`（入站是推送，出站是轮询） |
| `MYAGENT_REPLY_KEEP_DAYS` | | `7` | `out/sent/` 保留几天（0 = 永久） |
| `BRIDGE_LOG_LEVEL` | | `info` | `debug` 打印每条跳过的消息及原因 |

### 不是桥读、但 node 读的两个变量

> 这两个**不在上面的表里**是故意的：表由测试与代码里的 `process.env.*` 双向比对
> （`tests/bridges.spec.ts`），而它们是 **node 自己**读的，桥的代码里不会出现——写进表里会让那条测试红。

| 变量 | 什么时候需要 |
| --- | --- |
| `NODE_EXTRA_CA_CERTS` | 本机用**代理做 TLS 拦截**（Clash/Surge 一类的 TUN + MITM）时。症状很典型：**终端里手动跑正常，当守护进程就报 `SELF_SIGNED_CERT_IN_CHAIN`**——因为 launchd 与 systemd **都不读你的 `.zprofile` / `.bashrc`**，而那个变量通常正是在那里 export 的。指到系统证书包即可，例如 `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem`（macOS） |
| `PATH` | launchd 的 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`。面板生成的单元用 `env node`，**可能找不到 node**：把单元里的 node 换成绝对路径（`which node`），或在 env 文件里设 `PATH` |

**排障的第一步永远是看日志里的 `cause`**：桥的错误行带 `cause` / `causeCode` / `rootCause`，
因为 node 的 `fetch` 失败时外层消息只有 `fetch failed`，真正的原因在 `.cause` 上
（`ENOTFOUND`、`ECONNREFUSED`、`SELF_SIGNED_CERT_IN_CHAIN`…）。只记外层消息的日志等于没记。

## 4. 跑起来

```sh
cd /path/to/myagent/bridges/lark
npm install
node bridge.mjs
```

启动日志会打印一行 `constraint`，内容是**一个应用只能跑一个桥**——不是废话，见 §6。

要交给操作系统看护，用面板「接入一个平台 → 飞书 / Lark → systemd / launchd」生成的单元
（单元**不含凭据**，只引用上面那个 env 文件；launchd 没有 `EnvironmentFile`，
所以生成的是"先 `source` env 再 `exec`"的一层 shell）。

## 5. 映射身份（第一次必须做）

1. 在群里 @ 机器人说一句（或私聊它）。
2. 面板「聊天」页 →「等映射」出现一个 **`ou_` 开头的 open_id**。
3. 把它映射成一个人，并确认那个人在 `allowedSenders` 里。
4. 下次扫描受理，**不需要重发**。

> **`open_id` / `union_id` / `user_id` 是同一个人的三个键。桥固定用 `open_id`**（没有它才退回另两个）。
> 混用会让同一位同事在 `identities` 里变成两个身份，而看不出为什么其中一个不灵了——
> 所以映射表里**只放 `ou_` 开头的那种**。

## 6. 这个平台特有的三条硬约束

| 约束 | 后果与做法 |
| --- | --- |
| **事件必须 3 秒内处理完**，否则平台重推 | 桥收到事件**只写一个文件就返回**，入站路径上**不调任何 API**（群名走缓存、后台补）。重推本身无害（文件名就是消息 id，第二次写是同样字节），但慢处理器会让**每条消息都变两条** |
| **推送是集群分发，不是广播**：同一应用多个客户端，每条只随机给一个 | **一个应用只能跑一个桥。** 跑两个不会重复处理，而是**把消息劈成两半，而两边看起来都健康**——这是最难查的一种故障 |
| **长连接只支持事件订阅**，不支持卡片回调 | 交互卡片（按钮回调）需要 webhook 模式，本桥不做 |

另外两条映射决定（都有测试钉住）：

- **`content` 是 JSON 字符串**，不是对象。猜成对象是飞书桥最常见的**静默故障**（请求正文全空）。
- **`thread` 用 `root_id`**（退而 `thread_id`），**绝不用 `parent_id`**——回 parent 会让答复**每轮再嵌一层**。

## 7. 操作者验收清单

| # | 做什么 | 通过的证据 |
| --- | --- | --- |
| 1 | 起桥 | 日志 `connected {"transport":"websocket-long-connection"}`；`config` 行的 `directory` 与面板一致 |
| 2 | 看 `botOpenId` | 日志 `config` 行里 `botOpenId` 非 null。若为 null 会有一条 `bot-open-id-unavailable` **警告**，说明群里"任何 @ 都算"，需要设 `LARK_BOT_OPEN_ID` |
| 3 | 私聊一句"整理本周周报" | 日志 `message-written`；面板「等映射」+1 |
| 4 | 映射那个 `ou_` id | 等映射归零；任务列表出现新任务，发起者是映射的名字 |
| 5 | 等它跑完 | **飞书里收到回信**；面板频道表「待取回信」回到 0 |
| 6 | 群里 @ 机器人 | 受理；群里 @ **别人**则 `skipped {"reason":"not-mentioned"}` |
| 7 | 群里 @所有人 说一句 | 受理（官方 SDK 记录过飞书**经常省略 mentions 数组**，所以桥有内容级兜底） |
| 8 | 发一条**富文本**（带标题、多段） | 任务正文是拍平后的标题 + 段落，不是空的、也不是 JSON |
| 9 | 杀掉桥，让它跑完一张任务 | 面板频道表「**待取回信**」= 1 |
| 10 | 重新起桥 | 回信几秒内送达，**且只送达一次** |
| 11 | 在**话题群**里 @ 它 | 回信落在同一串里（走 `im/v1/messages/:id/reply`）；若日志出现 `reply-failed-falling-back-to-chat`，说明退回到发到会话里了——功能没坏，但请把这条日志反馈回来 |
| 12 | 连开两个桥（只在测试环境） | 你会看到消息被劈成两半。**别在生产这么做** |

第 9–10 步与第 11 步是最有价值的：**"答案没送到"与"答案本来就不欠"**只能靠「待取回信」区分，
而话题内回复是飞书独有的路径（Telegram 用 `message_thread_id`，两者不同）。

## 8. 未实现 / 待核实（如实记录）

- **webhook 模式**（HTTP 回调 + URL 校验 challenge + Encrypt Key 解密）**未实现**：长连接免公网、免加解密，
  对自托管更合适。需要公网入口的场景再说。
- **交互卡片回调**未实现（长连接不支持）。
- `bot/v3/info` 与 `im/v1/chats/:id` 两个调用是按官方 SDK 的通用 `request` 方式写的，
  **未在真机上核实过返回结构**；两者失败时桥都会**降级并记日志**（前者退化为"任何 @ 都算"，
  后者只是没有群名标题），不会崩。真机验收第 2 步就是在核这一条。
- 图片、文件、语音等非文本消息**不转发**（跳过原因里带类型，例如 `no-text:image`）。
  要转发得先把它们下载下来落到任务目录，那是另一件事。
