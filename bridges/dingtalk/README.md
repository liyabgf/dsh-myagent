# 钉钉桥（Stream 模式）

机器人消息进来写 myagent 频道目录，myagent 欠的回信从 `out/` 取走、通过消息自带的 `sessionWebhook` 发回去。
与 Telegram 桥同一条契约：**桥是传输**，不决定身份（`sources.chat.identities`）、不决定谁能派活
（`allowedSenders`）、不决定任务能碰什么（`scope`）。

## 装与跑

```bash
cd bridges/dingtalk && npm install    # 唯一需要装依赖的原因：Stream 模式的 WebSocket 协议用官方 SDK
DINGTALK_CLIENT_ID=xxx DINGTALK_CLIENT_SECRET=xxx MYAGENT_CHANNEL_DIR=/path/to/channels/dingtalk-main \
  node bridge.mjs
```

| 环境变量 | 说明 | 必填 |
|---|---|---|
| `DINGTALK_CLIENT_ID` | 开放平台 → 应用详情 → 凭证与基础信息 | 是 |
| `DINGTALK_CLIENT_SECRET` | 同上 | 是 |
| `MYAGENT_CHANNEL_DIR` | 这个频道的目录（与 `sources.chat.channels[].directory` 一致） | 是 |
| `DINGTALK_MODE` | `mentions`（默认）/ `dm` / `all`。群消息本来就只有 @ 它才会到达，所以三档实际差别在单聊与过滤 | 否 |
| `DINGTALK_CHATS` | 只收这些 `conversationId`（逗号分隔），留空即不限 | 否 |
| `MYAGENT_OUTBOUND_MS` | 出站轮询间隔（默认 3000ms） | 否 |
| `MYAGENT_REPLY_KEEP_DAYS` | 已发回信的保留天数（默认 7） | 否 |

## 建应用（一次性）

1. [开放平台](https://open.dingtalk.com/) 建一个**企业内部应用**，拿到 Client ID / Client Secret。
2. 给应用添加**机器人**能力。
3. 消息接收选 **Stream 模式**（免公网地址、免加解密——这正是选它而非 HTTP 回调的原因）。
4. 在 `sources.chat.channels` 里加一条频道指向你要的目录，`identities` 里把同事的 `senderStaffId`
   映射成你认识的名字。

## 平台约束（诚实清单）

- **回信只能走 `sessionWebhook`**，而且它有寿命（平台文档约 90 分钟）。桥在 POST 前先查过期：
  过了窗口的回信**留在 `out/` 不发**（面板显示「待取回信」），同一会话来了新消息就重新开门。
  这不是故障，是平台的门关了；日志会写清楚过期时刻。
- **一个应用只能跑一个桥**：Stream 推送是集群分发而非广播，跑两个会把消息劈成两半，而两边看起来都健康。
- **文件暂不支持**：`sessionWebhook` 只收文本；文件投递需要上传 API，第一版没做，错误会留在桥日志里
  而文件留在 `out/`——不做静默丢弃。
- **回信回执（点开回信里的「来自哪张任务」）还没有**：平台回执不带回信消息 id 的可键控形状，
  等第一批真实流量见过之后再定（不发明字段形状，是这里的纪律）。
- **字段形状以官方 SDK 的类型声明为准**（`dingtalk-stream-sdk-nodejs@2.0.4` 的 `RobotTextMessage`），
  不是凭记忆写的；但**整个桥尚未在真实钉钉租户上跑过**——第一批消息进来时对照日志核一遍
  `message-written` 行的字段（`chat`/`from`/`chars`）就是验收。

## 心跳

进程每 5 秒 touch `<频道目录>/.heartbeat`（G-2）。它说的是**进程活着**，不是流量在流：Stream 是推送制，
没有轮询循环可挂。myagent 的 chat 扫描看这个文件的年龄，超过 5 分钟上健康板。
