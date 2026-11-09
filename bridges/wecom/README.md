# 企业微信桥（自建应用回调模式）

企业微信的消息以加密回调 POST 进来，写 myagent 频道目录；myagent 欠的回信从 `out/` 取走、用
`message/send` 主动推回去。与 Telegram 桥同一条契约：**桥是传输**，不决定身份、不决定谁能派活、
不决定任务能碰什么。

## 装与跑（零依赖）

```bash
WECOM_CORP_ID=ww_xxx WECOM_APP_SECRET=xxx WECOM_AGENT_ID=1000002 \
WECOM_TOKEN=xxx WECOM_ENCODING_AES_KEY=43位 \
MYAGENT_CHANNEL_DIR=/path/to/channels/wecom-main \
WECOM_PORT=3001 node bridge.mjs
```

Node 18+，`node:crypto` 与 `node:http` 就是全部——这是套件里**不需要 npm install** 的桥之二
（协议是文档齐全的 HTTP + AES）。

| 环境变量 | 说明 | 必填 |
|---|---|---|
| `WECOM_CORP_ID` | 管理后台 → 我的企业 → 企业ID | 是 |
| `WECOM_APP_SECRET` | 管理后台 → 应用管理 → 你的自建应用 → Secret | 是 |
| `WECOM_AGENT_ID` | 同页面的 AgentId（数字） | 是 |
| `WECOM_TOKEN` / `WECOM_ENCODING_AES_KEY` | 应用 → 接收消息 → 设置 API 接收 里生成的两个值 | 是 |
| `MYAGENT_CHANNEL_DIR` | 这个频道的目录（与 `sources.chat.channels[].directory` 一致） | 是 |
| `WECOM_PORT` | 回调服务监听的端口（默认 3001） | 否 |
| `WECOM_USERS` | 只收这些 userid（逗号分隔），留空即不限 | 否 |
| `MYAGENT_OUTBOUND_MS` / `MYAGENT_REPLY_KEEP_DAYS` | 出站轮询间隔（默认 3000ms）/ 回信保留天数（默认 7） | 否 |

## 建应用（一次性）

1. 管理后台建一个**自建应用**，记下 AgentId 与 Secret。
2. 应用 → **接收消息** → 设置 API 接收：生成 Token 与 EncodingAESKey，URL 填你的公网回调
   （见下面"公网"一节）。填 URL 那一步平台会当场发 GET 验证——桥会解出 echostr 并原样回答，
   通过即配置成功。
3. `sources.chat.channels` 加一条频道指向你的目录；`identities` 里把同事的 userid 映射成名字。

## 公网回调：两条现成的路子

企业微信**没有**长轮询（Telegram 的模式）也没有 Stream（飞书/钉钉的模式）——回调 URL 必须能从
它的服务器到达。单机部署的路子：

- **反向代理**：机器上已有 nginx/Caddy 的，把 `/callback` 转发到 `localhost:3001`。
- **隧道**：`cloudflared tunnel --url http://localhost:3001` 一类的临时隧道，把拿到的公网 URL
  填进回调配置。

这条约束是这个平台固有的，不是桥的缺陷；诚实地说：三桥里它的部署负担最重。

## 平台约束（诚实清单）

- **回信是主动推送**（`message/send`），不是被动回包：回调的 5 秒窗口装不下 myagent 的答案生成，
  桥对平台回 `success`（文档里"不作被动回复"的标准答案），真话稍后送达。
- **文本上限 2048 字节**：`drainOut` 按 600 字符切块（中文最坏 3 字节/字符，600 块块都落在
  字节上限内）。
- **文件暂不支持**：`message/send` 有媒体消息类型，但上传 API 第一版没接；错误留在桥日志、
  文件留在 `out/`——不做静默丢弃。
- **回执（点开回信跳来源任务）还没有**：与钉钉同一条纪律——等第一批真实流量见过推送回执的形状
  再写，不发明字段。
- **加解密按官方文档的算法实现**（AES-256-CBC + PKCS7 + SHA1 签名），测试是本实现的往返与
  签名核对；**整个桥尚未在真实企业里跑过**——配置回调 URL 那一步的 GET 验证就是第一关真验收，
  桥日志的 `callback-verified` 行就是通过的证据。

## 心跳

出站 tick 每 3 秒 touch `<频道目录>/.heartbeat`（G-2）。它说的是**进程活着**，不是流量在流。
