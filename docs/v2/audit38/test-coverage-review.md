# Audit38 · 测试覆盖与断言有效性审核

范围：仓库旧有 spec 与 helpers（排除本轮新增审核探针）。只读静态审查，不修改测试/生产/运行态，不运行测试/构建。目标：逐文件记录实际阅读、被测命题、假桩边界和未覆盖异常，核实历史声称的 executor/recovery 新增测试是否存在。

## 操作日志

- T001 计划：枚举 tests 文件；复用本分支已经全文阅读的测试状态，补读未完整文件，优先 executor/recovery/desk-history/notify/http/chat/panel。先建报告，后增量写。没有进程命令或实验。

## 既有阅读证据

本分支前两阶段全文读取：transaction.spec.ts、recovery.spec.ts、watchdog.spec.ts、effects.spec.ts、agent-delivery.spec.ts、background.spec.ts、files.spec.ts、session-health.spec.ts、prompts.spec.ts、skills.spec.ts、views.spec.ts、tools.spec.ts。其余本轮已全文读取：executor.spec.ts、desk-history.spec.ts、notify.spec.ts、http.spec.ts、chat.spec.ts、chat-contract.spec.ts、chat-send.spec.ts、delivery.spec.ts、dependencies.spec.ts、deployment.spec.ts、fault-injection.spec.ts、attachments.spec.ts、auto-retry.spec.ts、flow.spec.ts、mount.spec.ts、notify-machine.spec.ts、policy.spec.ts、recipes-route.spec.ts、recipes.spec.ts、runtime-budget.spec.ts、session-decoration.spec.ts、silent-visibility.spec.ts、store.spec.ts、temp.spec.ts、ticket-delete.spec.ts、timing.spec.ts、tool-schema-json.spec.ts、tool-surface-docs.spec.ts、worker-preset.spec.ts、desk-tools.spec.ts、helpers/deployment.ts、helpers/host.ts、helpers/temp.ts、bridges.spec.ts；engine.spec.ts、sources.spec.ts 已补读至末尾。其它审查者所读 build.spec.ts、panel.spec.ts 仅注明委托范围，非本分支亲读。

## 逐文件实际覆盖与断言边界

- **executor.spec.ts（全文，999 行）**：真实 Runtime+Store+StubHost；覆盖 worker slots、pause/deny、stale launch、prepare/attachment、watchdog rescue、跨 Ticket note/artifact、Watchdog interval、slot gauge。假桩：DSH Session/子进程由 StubHost 模拟，未验证真实 DSH 权限或真实 shell。
- **recovery.spec.ts（全文，250 行）**：确实存在且覆盖 crash/reload takeover、same-session preserve、queued launch、ended Ticket、lock、front desk restart。历史 37 号文档:413/416 声称 R1 新增两条 executor DeskLoop 路径与 follow-up 路由测试已补；当前 executor/recovery 全文未见对应专项断言，文件存在不能证明该覆盖。详见下方更正。
- **desk-history.spec.ts（全文，263 行）**：SQLite 内存测试 append/dedup/recent/since/trim/tool_calls，以及 R3 gateway/直答结案。`makeStore` 是窄假 Store，仅 DeskLoop 读取的 history/tickets/events；未覆盖真实 Runtime wiring、LLM provider、持久重启。
- **notify.spec.ts（全文，267 行）**：真实 deployment 通知/RESULT/relay、policy notice、Watchdog escalation once、triage anti-echo；macOS osascript 分支用 `if (process.platform !== 'darwin') return`，Linux CI 对桌面通知主体不执行。
- **http.spec.ts（全文，1210 行）**：路由 fence、state、tickets/settings/prompts/schedules/files/lost/projects/works/dependencies/events/chat health/reply，StubHost request 直调 handler，不是真 HTTP/TCP；不覆盖浏览器代理/并发连接/真实端口。
- **chat.spec.ts（全文，865 行）**、**chat-contract.spec.ts（全文，465 行）**、**chat-send.spec.ts（全文，921 行）**：覆盖 Chat parser/identity hold/thread/archive/reply queue/lost delivery；桥出站与 Runtime wiring有真实 deployment。假桩/缺口：平台 API、网络、跨进程 bridge 未运行；`chat.ts` contextSubscribers 含 ended Ticket 的异常路径未见断言。
- **sources.spec.ts（全文，1193 行）**：cron/inbox/rule/registry/deny/pause/unhandled/permissions 全覆盖；unhandled 分支通过覆盖 `engine.receive` 返回 disposition，但真实 receive 已先写 Ticket，文件注释明确承认不能证明“nothing ran”，属于有意的窄探针而非完整行为证明。
- **engine.spec.ts（全文，1622 行）**：Engine 状态、artifact、work/deps/triage/delete/role/attachments/report。大量 FakeExecutor/Memory；不覆盖 SQLite 并发、真实 DSH Session。
- **store.spec.ts（全文，474 行）**：schema/migration/lost/effects/transactions/KV/reopen；未覆盖跨进程并发 append 或损坏 JSON/blob。
- **fault-injection.spec.ts（全文，780 行）**：通知/trigger/launch/upstream faults、lost persistence/restart；Store 写失败用替换 `insertLost` 方法模拟，真实只读 SQLite 故障明确未覆盖。
- **bridges.spec.ts（全文，1032 行）**：frontmatter/inbound/outbound/Telegram/Lark/DingTalk/WeCom/QQ 协议与附件；所有平台网络凭证/真实 webhook/WS 连接未运行，仅纯 transform 与文件契约。
- **build.spec.ts（全文，55 行，委托者已读）**：只检查 bundle 存在/mtime/schema 文本；其余断言 `skipIf`，bundle 缺失时后三项不执行。**panel.spec.ts（本分支全文6009行，连续分段补读）**：jsdom 页面行为，fetch route 全假；不是真浏览器/CSP。
- 其它已全文读取文件（attachments、auto-retry、dependencies、deployment、flow、mount、notify-machine、policy、recipes-route、recipes、runtime-budget、session-decoration、silent-visibility、temp、ticket-delete、timing、tool-schema-json、tool-surface-docs、worker-preset、desk-tools）均已在本轮记录；其共同边界为 StubHost/Memory 或路由假响应，具体命题以各 spec 断言为准。

## 断言盲区与假桩发现

1. **历史变异检验不可由当前文件存在推出**：docs/v2/37 明确 M-R2b/M-R3c 曾缺操作记录；本次只核实测试文件/断言存在，未运行变异，故不声称变异已执行。37 文档自身给出 M-R2b 等价 G3、M-R3c 无效变异的历史结论，但这是历史证据，不是本次实验。
2. **Chat unhandled 探针是窄假桩**：sources.spec.ts:1104-1126 直接覆盖返回 disposition，真实 Engine 已落库，故只证明归档/backlog，不证明未执行。
3. **Session decoration 旧盲区已修正**：session-decoration.spec.ts:64-96 用 fakeAgent+front-desk 正控制+real worker 对照，区别于 37 文档描述的已删除错误探针；当前文件可区分 impostor refused 与全路径未运行。
4. **macOS 通知测试条件跳过**：notify.spec.ts:126-169 和 notify-machine.spec.ts 的 darwin 分支在非 macOS 直接 return，CI 绿色不代表通知命令在本机可用。
5. **真实运行态未覆盖**：所有 deployment 使用 StubHost；没有测试真实 DSH Host、真实 shell、真实 bridge 网络、SQLite 多进程并发、跨主机 lock。
6. **helpers/deployment.ts 的 `settle` 依赖固定短等待**：多文件注释承认 nudge/pass 异步竞态；虽有 `untilPass` 等改进，但部分旧 spec 仍以 80ms/40ms 等等待为前置，存在负载相关 flaky 风险。
7. **build.spec.ts 的 skipIf**：bundle 缺失时仅存在性测试失败，mtime/schema/旧表断言被跳过；不能把“测试文件通过”理解为产物完整核验。
8. **Store 测试无损坏记录/并发**：round-trip 与 migration 证明正常 JSON/单连接路径，不证明损坏 blob 的错误分类或多 writer seq 唯一性。
9. **helpers/host.ts 的停止/解绑模拟弱于真实宿主（静态确认）**：144-145 的 `cancel()` 仅增加计数、不改 status，`whenIdle()` 立即 resolve；167/180/183 的 register/restrict/guard disposer 无操作。测试可证明请求了取消/释放，却不能证明实际 turn 已 idle、旧工具/guard 已解绑。`toolsOf` 持续累计注册，`tool` 531 行取首个项，也可能掩盖热更新后的最新定义。
10. **HTTP 的“非 JSON”用例未送非 JSON（静态确认）**：http.spec.ts:220-228 的用例传 body:undefined，实际只验证空对象 schema 拒绝；helpers/host.ts:549 总对 body JSON.stringify，不能构造坏 JSON 或多 chunk/流中断。名称夸大了实际覆盖。
11. **DeskTools 成功调用路径未验证（静态确认）**：desk-tools.spec.ts:9 把 StubHost 强转 ToolsHost，只有 unknown-tool/bad-JSON 两类执行测试；没有任何带真实 Engine/store 的成功管理工具调用及取消/拒绝时序断言。
12. **flow 附件测试弱分支（静态确认）**：flow.spec.ts:900-907 在 inputs 目录不存在时只断言 input.attachments，不要求文件物化；“复制到 inputs before deliver”的命题可在复制完全失效时仍通过。

## 历史声称核实

- docs/v2/37 §G4 的 R2/R3 对应测试当前存在：notify.spec.ts 有 anti-echo，desk-history.spec.ts 有直答与 gateway 工具数。但历史变异未重跑，本轮不把旧 exit 记录作为本轮实验。
- **更正 docs/v2/37 §G10 的覆盖结论（静态对照）**：37 行 411-413 声称 executor.spec 新增 DeskLoop 路径覆盖，但全文 999 行里没有 DeskLoop/relay 作为启动前置的测试；DeskLoop 只出现在注释/特性背景。当前 `executor.spec.ts:938-964` 测 settings save 立即改 Watchdog interval，`:966-999` 测 slot count；不是 executor DeskLoop 启动路径。37 行 415-416 声称 follow-up input 路由已有新增测试，但 recovery.spec 全文 250 行只有 restart/lock/front desk，未见 DeskLoop follow-up route。故覆盖声称无法从当前工作树测试证据确认；需主线查对应提交/历史文件，不能报告为已覆盖。
- `tests/flow.spec.ts:875-910` 附件 note 探针在 inputs/ 不存在时降级为只检查 TicketInput.attachments，明确不能证明真实附件文件物化；实际文件复制路径仍需 executor/附件集成断言。

## 47 个旧 spec 覆盖台账

共 47 个旧 `*.spec.ts`（不含本轮 `audit38-repro.spec.ts`）。标注“本分支已读”表示全文读取；build 本分支已全文读；panel 由 lead 声明已读，本分支只读至976行故不算全文；recovery/engine/sources 已在此前阶段分段全文读完。

|文件|全文状态|主要覆盖主题/边界|
|---|---|---|
|agent-delivery.spec.ts|本分支已读|Session inbox/history 幂等；DSH persistence stub|
|attachments.spec.ts|本分支已读|附件名/工具 schema；IO 多由其它集成测试覆盖|
|auto-retry.spec.ts|本分支已读|upstream 错误自动重试、decision queue；事件由 StubHost 注入|
|background.spec.ts|本分支已读|jobs/subagents kill/drain，假 service|
|bridges.spec.ts|本分支已读|桥 transform/file 协议；无平台网络 |
|build.spec.ts|本分支已读（55 行）|bundle 文件/mtime/schema 字符串，缺 bundle 时部分 skip|
|chat-contract.spec.ts|本分支已读|Settings/policy/registry 契约，Source host 多为 stub|
|chat-send.spec.ts|本分支已读|真实 Runtime 文件回信/失败队列，外部 bridge 未运行|
|chat.spec.ts|本分支已读|ChatSource + fake Engine/Memory，部分 bridge kit 集成|
|delivery.spec.ts|本分支已读|消息文案/真实 Store、队列记录桩、同机锁|
|dependencies.spec.ts|本分支已读|真实 deployment 的依赖等待/释放|
|deployment.spec.ts|本分支已读|目录/Config 本地文件系统|
|effects.spec.ts|本分支已读|重试、Later、永久失败，真实 Store|
|executor.spec.ts|本分支已读|执行/隔离/附件/Watchdog slots；DSH 与 subprocess 为 stub|
|fault-injection.spec.ts|本分支已读|通知/触发/启动/upstream 故障；Store hook 直接替换模拟|
|files.spec.ts|本分支已读|真实临时文件/symlink 与 fake HTTP route|
|flow.spec.ts|本分支已读|端到端 stub deployment；附件物化断言有条件降级|
|http.spec.ts|本分支已读|fake request/response 调 route，无 TCP/真实浏览器|
|mount.spec.ts|本分支已读|Cordis/host stub 挂载与锁|
|notify-machine.spec.ts|本分支已读|通知命令构建，subprocess 不真实执行|
|panel.spec.ts|本分支全文已读（6009 行，连续分段）|jsdom + 假 fetch；逐功能组评估见补充章|
|policy.spec.ts|本分支已读|Settings/gate/policyVersion/revalidate 单元测试|
|prompts.spec.ts|本分支已读|KV fake store，包文件为本地真实读|
|recipes-route.spec.ts|本分支已读|fake HTTP route + shipped examples|
|recipes.spec.ts|本分支已读|真实 Settings/gate/inbox stub deployment|
|recovery.spec.ts|本分支已读|同目录重启恢复、锁；stub host 模拟 DSH session|
|runtime-budget.spec.ts|本分支已读|预算逻辑/Store，直接回拨 Assignment 时间|
|session-decoration.spec.ts|本分支已读|假 Agent 注册工具/Prompt，正负控制齐备|
|session-health.spec.ts|本分支已读|StubHost event 驱动 SessionHealth |
|silent-visibility.spec.ts|本分支已读|真实 watchdog timer/Runtime，需至少 10 秒|
|skills.spec.ts|本分支已读|fake skill registry，验证 agent/global scope 转交端口|
|sources.spec.ts|本分支已读|cron/inbox/rule/registry，Memory、文件系统组合|
|store.spec.ts|本分支已读|真实 SQLite、迁移、单连接事务；不含并发 writer|
|temp.spec.ts|本分支已读|Vitest onTestFinished 临时目录 teardown|
|ticket-delete.spec.ts|本分支已读|Runtime/真实临时目录删除及假 HTTP|
|timing.spec.ts|本分支已读|cron/DST 单元测试，依赖本机 Intl tzdata|
|tool-schema-json.spec.ts|本分支已读|真实 Tool definitions + 手写 JSON 合法性 walk；host 投影未实际调用|
|tool-surface-docs.spec.ts|本分支已读|源码/Prompt 文本互比，不验证 DSH 消费效果|
|tools.spec.ts|本分支已读|Store/Engine 工具端到端，部分 ToolsHost IO 为 stub|
|transaction.spec.ts|本分支已读|Memory 与 SQLite transaction 同契约 |
|views.spec.ts|本分支已读|纯投影 fixture |
|watchdog.spec.ts|本分支已读|Watchdog stub host；Runtime 健康输出由 silent-visibility 补 |
|worker-preset.spec.ts|本分支已读|真实 Runtime calls 经 StubHost 观察 |
|engine.spec.ts|本分支已读（分段至 1622 行）|Memory domain tests，不证明 Store 并发|
|notify.spec.ts|本分支已读|真实 Runtime/Store + StubHost relays；darwin-only 跳过|
|desk-tools.spec.ts|本分支已读|Tool schema/execution；ToolsHost 为 stub|
|desk-history.spec.ts|本分支已读|内存 SQLite + mocked LLM stream，非真实 provider|

|类别|状态|
|---|---|
|tests/helpers/*.ts|deployment/host/temp 3 个文件均全文读取|
|audit38-repro.spec.ts|发现存在，未读取，明确不在本次旧测试范围|
|真实运行态/平台网络|未运行|
|变异检验|未运行；只核对测试和历史文件证据|

## 操作日志（追加）

- T002：读取优先文件 executor/recovery/desk-history/notify/http/chat/chat-contract/chat-send；结果：文件均存在并返回完整内容（engine/sources 后段补读至末尾）。未运行进程。
- T003：读取其余旧 spec 与 helpers；结果：除 build/panel 由委托者声明阅读外，本分支完成旧 spec/helpers 全文覆盖；audit38-repro.spec.ts 明确未读。未修改任何源码/测试/运行态。
- T004：读取 docs/v2/37；确认其 G4 历史记录列出 M-R2b/M-R3c 缺口及后续闭环说明；本报告不把该历史记录冒充本轮变异执行。
- T005：逐文件读取剩余旧 spec 与 helpers；读取结果登记于“47 个旧 spec 覆盖台账”。无测试/构建/命令运行，故无进程退出码。
- T006：对照 docs/v2/37 §G4/G10 的历史覆盖声称与当前测试文本；发现 executor DeskLoop/follow-up 专项断言无法在当前工作树核实，已按“历史声称与当前证据不一致”落盘，不修改任何文件。

## panel.spec.ts 逐功能组补审（全文 6009 行）

操作 T007：按连续段读取 1-976、977-1676、1677-2665、2666-3565、3566-4505、4506-5476、5477-6009；每段均检查工具实际返回范围，输出截断后从下一行继续。修正之前误信“委托者读过 panel 测试”的状态；本轮已本人全文读完。

|功能组/位置|断言实际锁住|边界与缺口|
|---|---|---|
|Harness 20-556|运行真实 PAGE 脚本，fake timers/fetch/clipboard/download，卸载 listeners|CSS 不装入，fetch 为立即假响应，无 TCP/CSP/真实布局；响应始终提供 json()，无坏 JSON/网络拒绝/乱序 Promise|
|Header/Tabs 559-685|header 数/health/marker、初始 load、周期读、切页停 poll| fixture counts 不从 Store 生成；真实 API shape 需 http 集成保持|
|Ticket 687-862|授权/报告/input/附件渲染、answer/note/retry、空值/拒绝|**空断言：701 行 `expect(detailValue('任务'))` 无 matcher**，故该断言不判定结果|
|Progress/files 864-1023|Session/tool 顺序、copy 反馈、UTF8/base64、Blob字节/URL revoke、错误展示|只证明假 file payload 被消费；无法证明服务端安全解析/真实下载成功|
|Polling/drafts 1025-1129|3秒读、结束停表、focus/input/file/history 保留、hidden停表|fake clock 无慢请求与乱序返回；旧请求覆盖新选择仍待实际异步探针|
|Stop/address/list 1131-1270|两步 stop/取消/草稿、hash定位、筛选和list刷新|只证明请求发出；stop 实际取消看 Runtime/DSH测试|
|Work/group/artifacts/deps/events 1272-1668|项目/工作建立、workSeq排序、归属、artifact入口、依赖方向和确认、history分页|手写 fixture，后端独立契约不能只依赖此组|
|Header actions/dispatch 1670-1855|pause整份settings、pass/main、recipe/attachments/create/observe/reject|无并发提交/双击竞态；表单成功响应全假|
|Schedules 1857-2084|保存只保留持久字段、timing各种形状、preview拒绝/删除/停用|fixture scheduleRecord 缺 preset/maxRuntimeMs/deliverTo，故 `Object.keys` 断言锁住旧六字段，不能证明新字段编辑保留|
|Sources/Decisions/settings 2086-2377|health/effects表、原因文案/dismiss、JSON编辑、prompt恢复和conflict|含 dummy 409 响应，不能证明真实 optimistic concurrency 存在|
|Error/version/API 2379-2799|保留last good detail、旧bundle降级、遍历路由清单|SERVED 2561-2582 手写，并未解析真实路由表；没有 desk send/config/run 等写交互，故“only routes server has”仅对枚举范围成立|
|Markup/Chat 2801-3306|值转文本、身份/频道门禁控件、draft、计数解释、旧chat降级|jsdom 不执行 innerHTML script，`document.title` 不变不是唯一充分证据；同时断言无img/script节点更有意义|
|Lost 3308-3584|loss/payload分离、增长、截断/分页/无重放、hostile bytes惯性渲染|bound为手写 fixture，真实Store/API见http/store；不证明给定raw已持久化|
|CSS/overview/drawers 3586-3988|hidden!important源码、overview回答/queue、Esc层、channel facts与接入guide|CSS仅正则，不证明完整cascade；3933 `npm install` 只是文本存在，不能证明指南可运行|
|Archive/delete 3990-4120|两步确认/归档切换/保留当前归属|**弱断言：4089注释称删后不可再选中，4090却只断言最后GET已存在，不证明删后没读。** 4106注释称再造无关已归档工作，但未造/断言，排除无关归档未锁|
|UI细节/records/list/forms 4122-4528|scope跨文件比较、records过滤、summary展开/dirty、onboarding|硬编码 STAGES/OUTCOMES 4590-4591 未对真实类型集合做比较，新枚举不一定让套件失败|
|fold/locale/navigation/search 4530-5245|折叠顺序、中文词表、deep links、channel/settings局部保存、搜索/时间/badges|fixture日期部分取Date.now，fake clock/真实时钟组合仍依机器时区；global search只覆盖当前加载数据|
|Prompt/result/shortcode 5247-5369|result卡片、role恢复、shortcode|**空断言：5364 `expect(detailValue('任务'))` 无 matcher**；5366-5367另锁按钮文本，但主dd本身没被这句验证|
|Ticket deletion/triage/lineage/skills 5371-5682|delete后果/选择、tombstone、triage marker、lineage图、skill toggle/delete重置|图为模拟cites/taught数据；不存在信息与后台关系变化由其它层验证|
|CSS/backlinks/schedule/about 5684-5859|icon/max-height源码、text mention图、deep work、preset/budget文案、changes空列表说明|**纠正 app-support 审核候选：5810-5821 已证明 PAGE 对 `{changes:[]}` 显示CHANGELOG打包缺陷，因此 about catch返回空并不必然静默空页。** HTML存在处理，不能报已确认缺陷|
|Skill drawer/continue/group 5861-6009|正文drawer来源/警示/Esc、继续按钮发answer、归入后重读详情|来源跳转5900-5908只断言tab打开，没有目标请求/结果id断言；可被打开错误Ticket掩盖|

新增可确认断言问题：空 matcher 701/5364；删除Work的“不得再读”没有负向请求计数；归档下拉未覆盖无关archive；SERVED/枚举列表是手写清单；真实CSS/网络乱序不可由本套件证明。所有结论为静态审核，未运行实验。

## 最终覆盖修订与结论

**47/47 个旧 spec + 3/3 helpers 均已由本分支全文读取**；build.spec.ts 本人55行，panel.spec.ts 本人6009行连续分段。此前45/47或“委托者已读”表述作废，以此修订和台账为准。audit38-repro.spec.ts 明确未读，不混入旧测试覆盖。

executor/recovery 文件确实存在，但 docs/v2/37 声称的 DeskLoop executor/follow-up 新增专项断言无法从当前工作树确认，已列为历史证据不一致。主要盲区是 StubHost/假 HTTP、真实 DSH/网络/多进程未覆盖；sources unhandled 是窄探针；macOS 通知在非 macOS 跳过。未运行测试、构建、变异或运行态；不得宣称全项目测试通过。
