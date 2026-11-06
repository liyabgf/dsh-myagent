# Telegram 桥

零依赖（Node ≥18 自带 `fetch`），长轮询，**不需要公网地址**。

契约、排障、安全边界见 [`../README.md`](../README.md)。

## 1. 建一个 bot

1. 在 Telegram 里找 **@BotFather** → `/newbot` → 起名字 → 拿到 token（形如 `123456:ABC-DEF...`）。
2. 把 bot 拉进群，或直接私聊它。
3. 群里默认只认 **@ 它**的消息（`TELEGRAM_MODE=mentions`）；私聊消息一律算找它。

## 2. 在面板里建一个频道

「聊天」页 → 「频道」表下面的表单：

- **频道 id**：小写字母开头，只能含小写字母、数字、短横线，最多 40（例如 `telegram-main`）
- **目录**：绝对路径（例如 `~/.myagent/channels/telegram-main`）

保存后面板会**立刻请系统再看一遍目录**（`POST pass`），所以回到屏幕上的是"它读到东西了吗"，不是"保存成功"四个字。

> 目录不需要你手工创建：桥写入时会 `mkdir -p`，Source 扫描时也会建。但**权限要紧**——
> 谁能写这个目录，谁就能以任何已映射身份提交工作（契约 §7.6）。建议 `chmod 700`。

## 3. 写 env 文件

```sh
mkdir -p ~/.config/myagent/bridges
cat > ~/.config/myagent/bridges/telegram-main.env <<'ENV'
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
MYAGENT_CHANNEL_DIR=~/.myagent/channels/telegram-main
TELEGRAM_MODE=mentions
ENV
chmod 600 ~/.config/myagent/bridges/telegram-main.env
```

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | ✅ | — | @BotFather 给的 token |
| `MYAGENT_CHANNEL_DIR` | ✅ | — | 与面板里那条频道的目录**完全一致** |
| `TELEGRAM_MODE` | | `mentions` | `mentions`（私聊 + 群里 @ 它）/ `dm`（只私聊）/ `all`（全收，先确认群里的人都在映射表里） |
| `TELEGRAM_CHATS` | | 空 | 只收这些 chat id（逗号分隔）。留空即不限 |
| `TELEGRAM_POLL_MS` | | `5000` | 轮询间隔。长轮询本身会在服务端等 25 秒 |
| `MYAGENT_REPLY_KEEP_DAYS` | | `7` | `out/sent/` 里已发回信保留几天（0 = 永久） |
| `BRIDGE_LOG_LEVEL` | | `info` | `debug` 会打印每条被跳过的消息**及跳过原因** |

## 4. 跑起来

```sh
node /path/to/myagent/bridges/telegram/bridge.mjs
```

看到 `{"level":"info","event":"bot-identified",...}` 就说明 token 有效、连上了。
要交给操作系统看护，用面板「接入一个平台 → Telegram → systemd / launchd」生成的单元
（单元里**不含凭据**，只 `EnvironmentFile=` 引用上面那个 env 文件）。

## 5. 映射身份（第一次必须做）

1. 在群里 @ bot 说一句话（或私聊它）。
2. 回面板「聊天」页：**「等映射」会出现一个数字**——那是 Telegram 的数字用户 id。
3. 在身份映射表单里把它映射成一个人（例如 `alice`），并确认这个人在 `allowedSenders` 里。
4. 下一次扫描就受理它，**不需要重发消息**。

## 6. 操作者验收清单

离线测试证明的是**契约**，不是平台。下面每一步都要看到证据才算过：

| # | 做什么 | 通过的证据 |
| --- | --- | --- |
| 1 | 起桥 | 日志出现 `bot-identified`，`config` 行里的 `directory` 与面板那条频道一致 |
| 2 | 私聊一句"整理本周周报" | 日志 `message-written`；面板「聊天」页**等映射 +1** |
| 3 | 映射那个 id | 「等映射」归零；任务列表出现一张新任务，发起者是映射的那个名字 |
| 4 | 等它跑完 | **群里/私聊收到回信**；面板频道表「待取回信」回到 0 |
| 5 | 群里 @ bot 一句 | 同样受理（`mentions` 模式） |
| 6 | 群里**不** @ bot 说一句 | 日志 `skipped {"reason":"not-mentioned"}`，**不产生任务** |
| 7 | 杀掉桥，让它跑完一张任务 | 面板频道表「**待取回信**」变成 1（这就是"桥没在跑"的信号） |
| 8 | 重新起桥 | 那封回信**几秒内送达**，且**只送达一次**（去重生效） |
| 9 | 群里发同一条消息两次 | 只有一张任务（`id` 是 `<chatId>-<messageId>` 的纯函数） |
| 10 | 话题群（forum）里 @ 它 | 回信落在**同一个话题**里，不是主时间线 |

第 7–8 步是最容易跳过、也最该做的：**"答案没送到"与"答案本来就不欠"必须能区分**，
而区分它们的唯一信号就是「待取回信」。

## 7. 这个平台特有的两件事

- **`message_id` 只在单个 chat 内唯一**，所以桥写的 `id` 是 `<chatId>-<messageId>`。
  如果哪天你改这个桥，别把它简化成裸 `message_id`：两个群的同号消息会**塌成同一个 Trigger**，
  而因为 Trigger id 是纯函数，第二个群的消息会被**静默去重掉**——不报错，只是不见了。
- **一个 token 只能跑一个桥**：`getUpdates` 的 `offset` 是全局的，两个桥会互相抢消息，
  表现为"每条消息随机消失一半"，而两边日志看起来都正常。
