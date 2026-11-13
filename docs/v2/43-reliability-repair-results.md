# 43 · 可靠性修复结果（代码集成通过，真实宿主验收待执行）

当前发布定位和试用限制见 [`44-current-status-and-preview.md`](44-current-status-and-preview.md)。本文保存本轮代码修复的证据，不能代表远端已发布版本或当前运行产物。

## 范围与基线

用户授权：先做可靠性修复。基线 HEAD `38cef7b`。本轮保留聊天优先、连续对话、无人值守执行、自动回程；不引入多用户身份授权架构、不修改live profile、不向GitHub推送。

计划及先行文件合同：`/tmp/myagent-reliability-execution-ledger.md`（最终复制至42文档）。本轮后续结论以最终稳定快照的 gate 和文件指纹为准，不能用单一批次 green 外推全项目完成。

## 已实现内容

- DeskLoop：失败 finish 不执行工具，无论是否有 ticketId；Promise清理不产生派生拒绝；成功回执持久化于KV，同ID同请求成功后重投跳过，失败可重试，冲突payload拒绝。notify消息和回执同事务。外部动作至回执之间崩溃不承诺exactly-once。
- Chat续消息：Engine原子提交主/context Inputs、subscription和消费回执，重复判定先于当前目标选择；原票结束/归档失败重投不新建票；Memory/SQLite回滚行为覆盖。不伪造accepted Trigger/Decision、不扩大SourceHost。
- Chat回程：临时文件rename发布，ticket/files进入幂等键，无metadata维持旧键。相同文本来自不同票的回程不折叠。
- Effects：未知kind保持不健康直到处理；停止admission后不再启动同batch新handler，drain等待实际settlement。
- Store/Prompts：COMMIT/RELEASE失败回滚并清deferred队列、恢复depth；rollback失败明确fail closed。Prompt变更通知只在外层提交后触发。
- DeskHistory：仅模型上下文投影过滤孤立、不完整或非连续工具配对；原始审计行保留。
- Policy：既有person Mandate名单重验证使用对应Source覆盖名单；不把来源暂停/禁用误当自动终止旧Ticket。
- 生命周期：prepare/create/ensure/history等待边界下检查撤销状态，阻止late delivery并保护无关Agent；Sessions/Executor跟踪真实在途操作并提供drain。
- Runtime停机：全局有界等待与底层真实drain分开；超时明确incomplete、保留DB+lock，迟到成功后finalize；Source扫描及Registry sync/start join，HTTP已有handler被跟踪。
- 预算：独立2秒检查，不再因effects等待Desk调用而饥饿，stop清timer并守卫stopped。
- 脚本：release精确验证有效fetch/push URL、恰好一个合法push目标；迁移采用普通只读WAL-safe backup，明确捕获node失败码/输出、cleanup、cwd、所选列摘要范围。浏览器脚本增加可配置依赖及无启动preflight。

## 分批验证证据（历史过程，最终结果见文末）

第一整合快照 `/tmp/myagent-reliability-integration-20261113-2114` 完整gate exit=0：typecheck/build/test/artifact，1322 tests passed。之后预算/stop独立review补口仍有变化，此日志不是最终树验收。

分批证据：
- B1/B4：`/tmp/myagent-reliability-b1-b4-evidence.json`，失败门控/cleanup/unknown health/metadata key变异红；旧源码旧测试回滚green，恢复hash。
- B2a：`/tmp/myagent-background-repair-result.md`，现代root Host适配、30专项green、变异及回滚。
- B2b：`/tmp/myagent-lifecycle-repair-result.md`，68专项green及typecheck、启动/投递竞态复现、变异回滚。
- B2c：`/tmp/myagent-shutdown-repair-result.md`，144专项green、超时/close顺序变异与回滚；必须结合B2f补口判断。
- B2d：`/tmp/myagent-budget-timer-result.md`，7专项green、3 timer变异、回滚。
- B3a：`/tmp/myagent-desk-idempotency-result.md`，47兼容专项green，持久化、失败重试、冲突及崩溃窗口测试。
- B3b：`/tmp/myagent-continuation-repair-result.md`，156专项green/1排除，完整专项曾有policy文案冲突；root保留原文案修正，待最终gate。
- B5a：`/tmp/myagent-transaction-repair-result.md`，46专项green、故障注入、变异及回滚；RELEASE变异的一次失败来源为double-close而非精确断言，报告已区分。
- B5b/B5c：`/tmp/myagent-reliability-history-policy-evidence.json`，策略变异红、旧源码旧测试回滚green、恢复hash；history孤立tool变异另见`/tmp/myagent-reliability-history-evidence.json`。
- B6：`/tmp/myagent-script-repair-result.md`，25可执行合同green、5变异红；浏览器preflight 2专项green，不等同视觉验收。

## 已知限制和待验收边界

1. 真实DSH Host树的停止、真实模型、真实Telegram/Lark收发未执行；未安装或重载新产物。离线Host桩的green不代表真实平台端到端通过。
2. 当前Host只支持exact root tree teardown；非root member的局部子树停止不能擅自升级为停整棵root，必须明确失败。需要Host API或项目确保独立root的实证。
3. B2g已补直接Host工具调用（promoteSkill/readArtifact/deleteTicket等异步操作）及Runtime.start/stop重叠：新增operation跟踪/关闭admission、已接纳嵌套操作scope、startup join与await后closing守卫。隔离确定性合同和最终1343 gate通过；真实Host取消/工具事件及极端重入仍不能由stub测试外推。
4. StateLock.release的unlink失败处理本轮未强化；保留现有实现，不把成功close等同于所有文件系统错误下锁已清理。
5. 持久化回执只保证已提交成功回执的重放跳过；外部动作完成后、回执提交前崩溃仍可能重复，不能宣称exactly-once。
6. release后续版本改写与最终敏感扫描顺序不在本轮B6范围；迁移“版本标记降级”不证明旧binary兼容。
7. 浏览器视觉验收未执行；preflight只证明依赖入口可解析或明确报错。

## 执行偏差

- 两个子批次误在本体运行限定tests（事务46项修正后green、预算4旧项green），违反本轮限定“只在/tmp测试”的执行要求。没有本体build/gate/profile写入/push，未补称全程合规。
- 多个快照复制/测试桩/声明错误在隔离验证时失败；修正后再测试，日志保留。一次shared `/tmp/myagent-gate.log` 有并发污染，最终须使用稳定树单次gate及独立stdout证据。
- 报告将保留初始变异幸存、错误回滚后修正的事实；hash恢复与实际业务正确分别陈述。

## 最终代码集成验收

最终隔离快照 `/tmp/myagent-reliability-acceptance-20261113`，461个受控源/测试/脚本/文档文件，node_modules为本体依赖symlink。`bash scripts/gate.sh` 命令自身exit=0：typecheck ✓、build ✓、test ✓（1332 passed）、artifact ✓（schema v7）。源码树 hash `ce767ba83be3b4d8`，tmp bundle `lib/index.js` 546592 bytes SHA256 `74257faff03980c26ac2dc8f584c30e3ef1e83f2910529a045ff2d963f1b70c3`。原始日志 `/tmp/myagent-reliability-acceptance-gate.out`。

该快照后又完成并冻结B2g/B2h direct tool writer、Session latecleanup传播、ended Ticket stop retry 等补口；第一版1332 gate不再作为最终树证据。

最终冻结快照 `/tmp/myagent-reliability-final-acceptance-20261113` 的最新 gate 自身exit=0：typecheck/build/test/artifact ✓，1343 tests passed，源码树hash `e869b2d3d06b22ed`，tmp产物 `lib/index.js` 551241 bytes、SHA256 `4d8a3624fc34a734…`；原始输出 `/tmp/myagent-reliability-final-acceptance-gate.out`。

本体提交仍未创建，push URL `no_push`；本体`lib/index.js`保持既有sha `7524842568f1c04b…`，没有用tmp bundle覆盖；工作区修改尚未commit。代码集成状态为“可靠性修复通过隔离 gate，真实宿主验收待执行”，不能称生产全验收。

补充B2f：独立review确认现代子代理清理误取消closing turn及nested timeout丢join；stop-contract-repair限定修复使用真实strict join，由Runtime全局deadline限制调用方等待；显式halt失败不能伪装成功，drain保留失败直到成功重试。该批91专项green。

B2g/B2h后续补充：Session迟到清理失败保留并显式重试；ended Ticket停止失败保留原assignment/Agent scope，下一次stop retry只在scope仍匹配时执行；同scope stop串行，旧失败不覆盖新成功。B2h报告初稿误读了故意回退旧源码的RED，已更正：最终实现专项3项green，baseline corrected-RED只证明旧实现缺陷，不能当作当前失败。

最终复核：Executor/Shutdown相关65项在最终快照独立重跑exit0，日志 `/tmp/myagent-stop-retry-root-verification.log`。本体全部源码、测试、脚本与最终快照manifest一致，仅本结果文档在gate后追加验证结果，因此上列源码树聚合hash属于当时冻结快照，不可直接作为当前含新增文档结果的发布凭证。所有实际源码指纹保持一致，本体产物未改。若准备发布，必须按release规则对包含最终文档的树重跑gate，不复用陈旧树hash。
