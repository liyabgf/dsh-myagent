# QQ 桥（QQ 机器人 · WebSocket 模式）

QQ 机器人的消息以 WebSocket 事件进来，写 myagent 频道目录；myagent 欠的回信从 `out/` 取走、
先试**被动回复**（不耗配额）、被拒就走**主动推送**（耗平台配额）。与 Telegram 桥同一条契约：
**桥是传输**，不决定身份、不决定谁能派活、不决定任务能碰什么。

## 装与跑（零依赖，Node 22+）

```bash
QQ_APP_ID=xxx QQ_APP_SECRET=xxx MYAGENT_CHANNEL_DIR=/path/to/channels/qq-main \
  node bridge.mjs
```

Node 22+（原生 `WebSocket`），无 `npm install`。

| 环境变量 | 说明 | 必填 |
|---|---|---|
| `QQ_APP_ID` / `QQ_APP_SECRET` | QQ 开放平台 → 机器人管理端 → 开发设置 | 是 |
| `MYAGENT_CHANNEL_DIR` | 这个频道的目录（与 `sources.chat.channels[].directory` 一致） | 是 |
| `QQ_USERS` | 只收这些 openid（逗号分隔），留空即不限 | 否 |
| `MYAGENT_OUTBOUND_MS` / `MYAGENT_REPLY_KEEP_DAYS` | 出站轮询间隔（默认 3000ms）/ 回信保留天数（默认 7） | 否 |

## 建机器人（一次性）

1. [QQ 开放平台](https://q.qq.com/#/apps) 注册并做**个人主体认证**（身份证实名即可，无需企业资质
   与对公账户；企业主体才需要对公打款验证）。
2. 创建机器人（个人主体可建 5 个）。
3. 开发设置里选 **WebSocket** 回调方式——官方文档明说"不依赖公网服务器部署，适合个人单机使用"。
4. 私聊使用要在管理端加**体验号码**（个人主体最多 20 个）；群聊要求你是群主/管理员。
5. `sources.chat.channels` 加一条频道指向你的目录；发一句话 → 回面板把出现的 openid 映射成一个人。

## 平台约束（诚实清单，全部查自官方文档 2026-10/11 版）

- **个人主体"暂不支持公开使用"**：机器人只进自己是群主/管理员的群（上限 500 个群）、
  私聊只对体验号码开放。单用户部署正好落在这个形状里；要公开放给同事用需要企业主体。
- **同一人在不同机器人下 openid 不同**：`identities` 里映射的 openid 换一个机器人就失效——
  这是 QQ 的身份模型，不是配置错误。
- **回信的两扇门**：被动回复（入站消息 id + 递增 msg_seq，一条入站可回几条，但有窗口）不耗配额；
  窗口关了走主动推送，**主动消息有平台的频率/月度配额**。两扇都关时回信留在 `out/`
  （面板「待取回信」可见），新消息会重新打开被动门——不是桥坏了，是平台的门关了。
- **WebSocket 断线**：桥带着 session 做 RESUME；丢了 session 就重新 IDENTIFY（中间的消息平台
  **不补投**，日志会说走的是哪条路）。心跳文件每 3 秒 touch，进程死了面板当晚报。
- **文件暂不支持**；回执（点开回信跳来源任务）等第一批真实流量见过再写——不发明字段形状。
- **传输已在真实机器人上验收**：桥日志出现 `hello`（心跳间隔取平台给的 **41250ms**）与
  `identified`（READY 到手 = token 与 intents 被平台接受），并且不再每 ~60 秒断线。
  **入站消息还没来过**——第一条消息进来时对照 `message-written` 行核字段（`author.id`/`content`/
  `group_openid`）仍是最后一步验收。
- **第一版为什么会在真机上断线循环**（留着当教训）：它在 socket 一 open 就发 IDENTIFY（协议要求先等
  HELLO）、把心跳间隔写成兜底的 30 秒（平台要 41.25 秒）、从**每个** dispatch 帧上取 `session_id`
  （只有 READY 带，于是它被抹成 undefined、RESUME 永远不可能）、IDENTIFY 漏了 `shard`、还把一个
  options 对象当成 Node 原生 WebSocket 的第二个参数（那是子协议列表，不是 headers）。服务端收下握手、
  等不到合法 IDENTIFY、约 60 秒后按 1006 断开——**而心跳文件一直是新鲜的**，所以面板上看它是活的。
  协议决定现在抽在 `protocol.mjs`（纯函数，`tests/bridges.spec.ts` 一条 bug 一把锁），
  传输留在 `bridge.mjs`（只有真账号能验的那一半）。

## 心跳

出站 tick 每 3 秒 touch `<频道目录>/.heartbeat`（G-2）。它说的是**进程活着**，不是流量在流；
WebSocket 自己的心跳是协议层的（op 1/11），两者回答不同的问题。
