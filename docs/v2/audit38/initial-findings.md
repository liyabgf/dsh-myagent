# 初始发现跨域复核（Audit38）

本文件只汇总当前审核证据；不含修复。证据路径、复现与覆盖范围详见同目录各审核报告及 repro-output.log。

|编号|严重度|发现|证据状态|
|---|---|---|---|
|RUNTIME-01|P1|main-desk running triage 在恢复时不会重排队：recover先于DeskLoop init/setDeskLoop|静态确认 + 原型probe|
|RUNTIME-02|P1|DeskLoop没有停止/abort；Runtime.stop关闭Store前不join它|静态确认，关闭写入probe待补|
|RUNTIME-03|P1|超时catch无role检查；worker调用askDesk附自身ticketId时可将worker report为dropped|prototype隔离probe复现|
|RUNTIME-04|P1|LLM provider错误finish带部分文字被当作正常ready结案|prototype隔离probe复现|
|RUNTIME-05|P2|main分诊brief拼入worker taskText末句myagent_report，工具面却只有mainTools，可能引导未知工具调用|静态确认；模型行为待验证|
|RUNTIME-06|P2|空/未配置Desk LLM时relay resolve但running triage不结案；Active status/settings切换未保证遗留队列恢复|静态确认|
|RUNTIME-07|P2|一条已知回复事件永久阻止此后同attempt直答结案|prototype隔离probe复现|
|RUNTIME-08|P2|相同requestId只去重history row，不去重LLM turn/工具副作用|prototype隔离probe复现|
|RUNTIME-09|P2|相同大小不同字节的已有artifact被物化为成功（源未覆盖）|prototype隔离probe复现|
|CORE-01|P1|异主机共享stateDir时把foreign-host lock视为stale并unlink|隔离probe复现|
|CORE-02|P1|Chat context订阅向ended/deleted ticket fanout抛错，主message已take，后续订阅丢失|静态确认，probe待补|
|CORE-03|P2|Watchdog加入dedupe Set先于report成功；report异常后永不重试告警|静态确认|
|CORE-04|P2|Memory事务未snapshot Threads，回滚后Thread残留，SQLite则回滚|隔离probe复现|
|CORE-05|P2|Prompts config/revision分次KV写，模块不包事务，失败时可能版本分裂|隔离probe复现；外层事务可达性待核|
|BRIDGE-01|P1|Telegram先推进update offset再持久化入站；写失败会永久漏消息|静态确认|
|BRIDGE-02|P1|WeCom密文长度/填充实现与预期封装不符|独立样本 decrypt 失败，非官方向量|
|BRIDGE-03|P1|WeCom回信route优先以AgentID作touser|静态确认|
|BRIDGE-04|P1|WeCom公网callback请求无体积限制且先200 ack后入站落盘|静态确认|
|BRIDGE-05|P1|4个push bridge间隔轮询可能重叠发送同一out条目|静态确认|
|BRIDGE-06|P1|QQ把304023/304024拒绝业务码标成成功，可能丢回信|静态确认|
|BRIDGE-07|P1|Telegram/QQ附件以用户文件名落共享attachments，跨消息可覆盖|静态确认；需确认不同消息同一channel目录与时序|
|UI-01|P1|排期转换器丢deliverTo、maxRuntimeMs、preset，任何排期编辑/启停/删除会重写全表丢字段|panel实现+ScheduleSchema+旧测试fixture静态交叉确认|
|UI-02|P2|Desk messages以server latestSeq推进，即使当前响应只有limit条；“加载更多”无可见绑定|静态确认，用户可见状态待浏览器验证|
|UI-03|P2|生成的launchd shell命令未转义输入路径|静态确认（仅操作者复制/安装时触发）|
|UI-04|P2|面板整份settings PUT无revision并发保护，可能覆盖其它并发保存字段|静态确认的客户端lost update风险|
|TEST-01|P2|多条测试helper弱模拟取消/idle/disposer；不能证明真实host关闭/解绑|静态确认|
|TEST-02|P2|HTTP “non JSON”测试helper总JSON.stringify，实际只测空body schema拒绝|静态确认|
|TEST-03|P2|flow附件物化命题有条件降级，inputs目录缺失时仅断言附件元数据|静态确认|
|TEST-04|P2|工具失败/探针无真实网络或真实host；全绿不等真机链路覆盖|全文覆盖报告|
|EXAMPLE-01|P2|27历史脚本含直接覆写、无hash证据、吞HTTP错误等多项单体工具风险|examples报告静态确认；历史资产非运行链|

## 需要排除/更正的早期候选

- 37号关于DeskLoop executor/follow-up新增专项测试：当前受控工作树无相应断言，历史覆盖声明不成立；见test-coverage-review.md。
- “queued=9发件积压”：Delivery计数为进程累计值，非pending队列；Effects表实际空（旧运行观察），不列缺陷。
- about.ts缺CHANGELOG静默失败：panel测试已有changes空态显示，撤回为缺陷。
- `triage.md`的worker工具与orchestrator主desk工具差异是dedicated/main不同运行模式，不等同工具漂移。
- 旧“ticket挂起8小时”时间戳把UTC当本地；静态核对实际约8分钟后stop，修正事实描述。
- triage直答空文本挂死修复已在fcf6a44，当前审核不把旧缺陷当当前未修复问题；保留regression probe。

状态：完整测试覆盖/文档审核/拓扑导出仍未结束；此表会依据最终文件级报告更新，不能作为最终全部发现清单。

## 历史/测试覆盖边界

- 旧测试全文台账与panel逐功能审核见test-coverage-review.md；当前旧spec全量执行曾1214/1214，但加入审核探针后的组合隔离gate出现runtime-budget时序失败（1217/1218），单测重跑退出0。该差异列为待验证竞态，不能称全绿。
- 文档报告见docs-review.md：39份目标中24全文、15抽样/分段未完成；当前历史文档不可作为当前产物验收。
- examples-code-review.md确认27 Python历史脚本全文，179历史数据文件只枚举不核实事实；生产npm files只包含顶层examples/*.md/json，但release同步GitHub保留real-run目录。

## 最终覆盖修订

文档补读完成39/39目标全文，旧spec47/47及helpers3/3全文，examples27脚本全文；coverage.md为逐文件状态。最终同快照完整gate退出0、1218/1218（含10审核探针），首次runtime-budget失败仍保留为间歇时序候选。本次不修复业务源码，不将历史数据逐条事实核验与代码审核混淆。
