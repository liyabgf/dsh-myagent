# Audit39 R3/R4 实际执行复核

## 范围与方法

只读审核提交 `619ef93`（R3）、`9c52ee6`（R4）的完整 diff、当前 bridges/source/panel 与 spec。仅本报告允许写入；不修改业务、tests、lib、运行态，不运行 build/test/网络/桥。所有结论明确区分静态判断与实验。

## 操作账本

- R34-001：已先读总审计文档。首次在 `~/Documents/SA` 执行 pwd/git status/log，git因非仓库退出128；读取同目录文档失败后用glob定位 `myagent`。随后在目标仓库执行 git status/log，退出0；HEAD `99477e1`，既有 `lib/index.js`、`lib/index.d.ts` 修改受保护。已先创建本报告标题。
- R34-002：已读两提交全部 diff（包括 supervision 增量）、stat/name-status，命令退出0；其中一次详细diff误用上层工作目录退出128，随后在目标仓库完整重读成功。当前源码已交叉读取 WeCom、Telegram、共享 inbound、Inbox、ScheduleSchema、HTTP Desk与DeskHistory、panel相关函数。未运行项目代码。
- R34-003：已读取WeCom crypto/state、相关 bridges/panel/desk specs、Health实现与HTTP settings路由；已将静态发现增量写入本报告。未执行实验。

## 结论摘要

R3：Telegram“先入站后offset”顺序静态正确，但跳过消息也推进offset；WeCom超限分支有totalBytes守卫，仍缺finish幂等保护，5秒ACK未验证且先写后ACK本身存在超时风险；WeCom官方crypto向量明确未修；附件调用点已传msgId，但前16字符截断/同消息同名仍可碰撞；20MB读取虽有上限却保留全量chunks内存；四桥单飞仅进程内，跨进程副作用未闭合。R4：ScheduleSchema确有三字段，但真实scheduleView只回传deliverTo原值、没有budget/preset原值，U01实际未完成；Desk分页方向与since升序匹配；生成器仅拒绝script路径，envFile/channel等仍未转义；U04无源码改动且settings仍整表PUT无CAS。所有“测试通过/闸门/产物”均为历史监督记录，本轮未重跑。

## 初步发现（静态）

### R34-F01 · P2 · C06 修复被同一 scan 的健康覆盖撤销

条件：inbox目录的 mkdir 成功，但 readdir 抛错（EIO/权限变化等），且没有其它 issues。`src/sources/inbox.ts:71–77`直接调用 `health.problem()` 后返回空数组；`205`使用该helper，末尾 `279–282`因 issues 为空调用 `health.record(detail)`，并记录 last.ok=true。因此“IO错误通过health可见”并未稳定实现；源码 `200–203`自身已准确解释这种覆盖风险。建议仅记录：readdir错误进入同一个 issues 数组，再统一写最终health。

### R34-F02 · P2（手动复制运行时可提升影响） · U03 仅检查 script，envFile/channel 未转义

`panel/index.html:3340`正则实际是 `/[\s'"\\\`$;|&<>()]/`（以git diff与当前源码为准），能拒绝脚本路径内部空格、引号、换行和 `$()`，不是JSON转义失效。但 `3334–3335` 的 channel/envFile 未检查；`3352`原样写 systemd EnvironmentFile，`3366`写 XML Label，`3372`把 envFile 插入 `/bin/sh -c`双引号字符串，`3377–3378`写 XML 路径。输入 envFile=`/tmp/$(id).env`时生成 shell 命令替换，含 `&`/`<`则XML不合法；envFile含换行可注入systemd配置行。repo含 `%`仍会被systemd说明符解释。没有正确分别处理shell/XML/systemd的全部输入。静态构造例，未执行命令/解析/网络。

### R34-C01 · P1条件风险 · WeCom超限路径通常无end/ACK双响应，但finish缺幂等保护

`bridges/wecom/bridge.mjs:156–166`超64KiB后 finish(413)→req.destroy()；即使发生end，`166`也因totalBytes仍超限而返回，无法走到 `180`的200 ACK。不能把req.destroy直接认定为413后ACK。但`156`每个data事件都继续进入，若destroy前又收到第二个超限chunk，会再次调用`finish(413)`；`137–140`没有writableEnded/destroyed幂等守卫。通常Node destroy会停止流，是否出现ERR_HTTP_HEADERS_SENT需实验；本轮未启动HTTP服务，未声称复现双响应或成功送达413。

### R34-F03 · P1未验收 · WeCom先落盘再ACK未证明5秒契约

`bridges/wecom/bridge.mjs:110–123`先writeMessage，再await saveState；`180–183`等onInbound全部成功后才200、失败500。修复了“200后落盘失败”窗口，但磁盘慢/状态写慢会令ACK超过文件头 `18`所列5秒；无超时预算或持久化队列、无真实平台验收证据，不能声明B04端到端完成。跳过消息在 `112`直接完成后ACK，合理；20MB附件下载与此WeCom文本入站路径无关，不能混为慢ACK的实际原因。

### R34-F04 · P1 · WeCom crypto仍明确留作未修

`bridges/wecom/crypt.mjs:10–12`明确声明测试仅为本实现往返、没有官方样本；`bridges/wecom/README.md:59`同样只称本实现往返。具体协议缺口仍在：`crypt.mjs:57`明文拼接仅random16+text+corpId，没有计划所要求4字节消息长度；`45–47`依赖Node默认autoPadding后再手动unpadded，`60–61`加密也同时手动padding与默认padding，自循环不能证明官方兼容。R3 supervision在 `docs/v2/audit39-supervision.md` 的S020注记B02官方向量未取得且保持候选；修复计划 `207,215,219`明确要求长度/padding/官方向量。故不能把R3闸门绿灯解释为官方协议验收，缺口并不只等于缺测试。

### R34-F05 · P1未决 · Telegram offset顺序正确，但“跳过消息”仍推进offset

`bridges/telegram/bridge.mjs:225–236`每条 update 先 await inbound，再 saveState(offset=该update_id)，包括 `inbound` 返回 `{ skipped }` 的过滤/不支持消息（`117–120`）。这保证处理失败时不推进，但跳过消息仍被确认并从轮询中消费；若契约要求跳过消息可重试/后续策略处理，则不满足；若“跳过即确认”是预期，则静态通过。未实验。

### R34-F06 · P1未决 · 附件唯一性只在调用点传入msgId，仍可能同消息多附件碰撞

调用点完整：Telegram `bridge.mjs:129–131`传 `message.id`，QQ `bridge.mjs:130`传 `msgId`；共享实现 `inbound.mjs:94–97`只取msgId清洗后前16字符，再拼原文件名。不同消息若前16字符相同会覆盖；同一消息多个附件若文件名相同也覆盖。`bridges/lib/inbound.mjs:78–80`旧注释仍声称“同名覆盖是同消息重投相同字节”，与新增跨消息前缀不完全一致。静态条件性风险，未实验。

### R34-F07 · P2 · 20MB“流式读取”仍把全量内容保存在内存

`bridges/lib/inbound.mjs:99–110`用response.body逐chunk读取并限额，但把所有chunks保留，最后Buffer.concat；已累计chunks受20MiB上限约束，concat瞬间还分配同等buf（两份合计约40MiB，另加当前chunk/底层缓冲），并发下载也无总额度。临时文件仅在完整内存缓冲后才于 `112–114`创建。故修复了无限制arrayBuffer/超限继续读，但不是边读边落盘。超限时临时文件尚未创建，不应报“超20MB残留tmp”；写入失败或rename失败时却没有finally清理，可能残留 `.tmp-*`。未实验。

### R34-F08 · P1/P2 · 单飞只挡本进程tick，停止等待/共享state串行化缺失

QQ/Lark/DingTalk/WeCom各自 `startOutboundLoop` 的 `inFlight` 在对应bridge进程内防重叠tick；但R3计划要求“停止时等待当前tick”（修复计划R3范围`audit39-repair-plan.md:209`），当前SIGINT/SIGTERM handler仅`clearInterval`/`server.close`后立即`process.exit(0)`（WeCom `263`；其余桥同形），未等待inFlight结束；Telegram无tick锁，虽poll主循环可能串行，需调用者保证。共享 `drainOut`及`recordSentReceipt`外部副作用仍由各独立桥进程分别执行，单飞不提供跨进程互斥；同channel启动两份进程仍可能重复发送。另R3允许修改/计划了`bridges/lib/state.mjs`串行化（supervision S020允许列表），但提交完整diff未改该文件，`state.mjs:23–29`仍是无锁read-merge-write；并发保存可互相丢字段。故单飞只解决一部分，不等于单飞副作用或关停安全完成。

### R34-F09 · P1 · R4 U01仍丢预算/预设，真实view未回传原值

`src/core/policy.ts:43–65` ScheduleSchema确有 `deliverTo`、`maxRuntimeMs`、`preset`（默认worker）；panel `4137–4143` toRecord保留非undefined字段（maxRuntimeMs/preset仅保留>0/非worker），`4190–4203`编辑时从schedules既有view保留三字段；启停/删除调用toRecord（`4264–4274`）。但真实`src/app/views.ts:114–142` scheduleView只回传`presetText`、`budgetText`，没有原始`preset`/`maxRuntimeMs`，仅deliverTo原值在 `138`回传。panel `4292–4294`以该view作为schedules数据，故编辑、启停、删除任一排期重写表时，researcher仍退回worker、预算仍归零。deliverTo保留静态有效。新建/编辑UI也无三字段输入（`4206–4220`），能展示presetText不等于可以设置preset。此为真实跨层静态确认，不只是“依赖”的候选风险。

### R34-F10 · P1 · Desk分页方向与latestSeq一致，生成器仍有escaping缺口

`src/app/desk-history.ts:102–111` since为`seq > after ORDER BY seq ASC LIMIT`；HTTP `http.ts:641–645`返回messages与latestSeq；panel `4844–4853`使用本页最后seq，符合since升序并避免latestSeq跳过。新消息轮询继续从最后一条seq读，静态通过。U03脚本路径拒绝规则见F02，未覆盖envFile/channel/生成文本转义。

### R34-F11 · P1/P2 · U04无实际改动，监督记录不准确

R4 supervision S021将U04列为修复项（`docs/v2/audit39-supervision.md:487`），但提交`9c52ee6`完整diff仅`panel/index.html`与监督文档；`src/app/http.ts`无改动，panel `4236–4242`与`4924–4932`仍整份settings PUT，未携带revision/If-Match/CAS。`http.ts:720–724`虽返回`settingsRevision`，PUT仍直接saveSettings，无客户端期望revision比较。故“R4修改清单”未列U04并非完成，正确结论应为U04未修；监督日志的R4修复项计划包含它但执行日志和提交未声称完成，需总报告保留未决。

## 测试/证据覆盖复核（静态）

- `tests/bridges.spec.ts:809–839`仅自实现encrypt/decrypt往返、签名与corpId拒绝，不含WeCom官方向量；未读到HTTP POST端到端ACK/5秒/超限测试。监督gate数字本轮不执行。
- `tests/bridges.spec.ts`既有测试集中于纯映射/共享outbound，当前检索未发现R3新增测试；R3提交本身也不改tests。因此B01 offset故障重试、B04重复响应/5秒、B05重叠调用、B07碰撞与X08限额均无本提交测试证据。
- `tests/panel.spec.ts:1903`仍留TODO(R4)，`1904–1931` fixture缺少三字段且断言只含六字段；测试未实际验证U01修复，既有旧断言反而锁住字段缺失形态。`scheduleRecord` `137–140`也不含三字段。
- `tests/panel.spec.ts:3946–3988`仅验证普通repo与`~/`环境路径生成，不覆盖恶意/特殊envFile、channel、repo字符；故不能验证U03完整escaping。panel spec未发现U02大于50条翻页的端到端覆盖。
- `tests/desk-history.spec.ts:48–55,90–103`验证since单页顺序与trim基础语义；不能证明面板Load more按钮、轮询的联动，但与源码方向一致。

## 证据边界

本轮全部为静态审阅；没有运行测试、build、HTTP/桥、真实WeCom/Telegram、网络或解析器实验。R3/R4 supervision中“1222 passed / gate 0 / build”是历史记录，未由本轮重跑或独立验证。
