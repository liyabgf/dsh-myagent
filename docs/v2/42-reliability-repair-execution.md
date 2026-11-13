# 42 · 可靠性修复执行账本副本

本文件是本轮逐项修复执行账本的仓库副本；最早登记及各批增补时间线详见 `/tmp/myagent-reliability-execution-ledger.md`。本体第一次授权测试偏差等按原记录不删改。

## 原始合同

目标 HEAD `38cef7b`。遵循 `docs/v2/40-new-discipline-and-baseline.md` R1–R10：分批限文件先登记；构建/gate仅/tmp快照；不push、不碰live配置；变异与rollback均隔离且恢复hash核对；每条测试记录命令自身exit code；不把历史日志、代码存在或单批green说成全项目合同完成。

范围：DeskLoop失败工具门控与request receipt、子代理/Session/Executor/Pass/Source/Runtime停机、chat续消息原子消费与指纹、outbound及Effects健康、Store事务和Prompt afterCommit、Policy revalidate、Desk历史工具配对、budget timer及release/migration/browser验证入口。多用户身份与OS sandbox不在本轮实现。

## 分批及证据目录

### B1 DeskLoop失败处理

允许 `src/app/desk-loop.ts`、`tests/desk-history.spec.ts`、`tests/audit38-repro.spec.ts`。RED见 `/tmp/myagent-reliability-b1-red.log`：旧实现error/aborted finish仍二次模型调用，并由finally派生Promise触发unhandled rejection。GREEN初gate `/tmp/myagent-reliability-b1-green.log`（1228 tests）。

实现：失败tool-call finish无论ticketId都不执行；triage可记录failed，无ticket时写Desk健康错误；Promise清理用成功/失败双分支then，不产生未处理派生reject；失败request可重试。

变异和恢复详见 `/tmp/myagent-reliability-b1-evidence.json`。两变异均exit1；回滚旧源码但保留新合同为exit1（符合RED），恢复后专项exit0；不得把RED rollback说成回滚机制失败。

### B2 子代理停止、在途投递与Pass

证据分开：B2a `/tmp/myagent-background-repair-result.md`；B2b `/tmp/myagent-lifecycle-repair-result.md`。DSH现代服务只能drain exact root tree；非root member子树不得提升root并误停兄弟，目前该形状明确失败/待Host支持。B2b覆盖prepare/late create/second ensure/history await窗口与Pass超时，隔离68项green、typecheck0。慢Desk阻塞budget经B2d解决；Runtime安全关闭由B2c负责。

### B2c Runtime/source/registry/http/effects停机

结果 `/tmp/myagent-shutdown-repair-result.md`，快照144/144，typecheck0。Timeout、源扫描join与close顺序变异按报告所列exit。停机超时不再close DB或release lock；真实drain Promise持续跟踪，成功后延迟finalize。

已知边界：Runtime工具直接操作、Runtime start-stop重叠、Host disposer端到端合同、lock unlink failure尚未完全证明；不得称“所有可能writer均被join”。具体以结果报告§34起说明为准。

### B2d 预算独立timer

结果 `/tmp/myagent-budget-timer-result.md`，runtime独立timer、7项green、3项mutations红、隔离rollback hash。预算grace保持原语义。先前一次本体限定4 tests exit0为偏差，日志/承认见/tmp账本，非隔离证据。

### B3 Desk持久成功回执与Chat续消息消费

B3a `/tmp/myagent-desk-idempotency-result.md`；B3b `/tmp/myagent-continuation-repair-result.md`；方案 `/tmp/myagent-idempotency-design.md`。

Desk成功receipt存在时顺序/重启重放跳过，失败不盖章可重试，外部副作用与receipt提交间崩溃不承诺exactly-once。Chat continuation的Input/context/subscription/receipt同Engine transaction提交，不新增Disposition伪装accepted。附件空正文换文件名会话采用ticket-relative metadata稳定指纹：移除派生title，source case red/green日志在 `/tmp/myagent-reliability-chat-title-{red,green}.log`。

补充B3d：existing lost Trigger上禁止续消息receipt，显式source_identity_lost；RED `/tmp/myagent-reliability-lost-red.log`，GREEN `/tmp/myagent-reliability-lost-green.log`。不能静默接受或改写lost disposition。

### B4 回程与Effects

`src/app/chat.deliver`临时文件+rename；有ticket/files元数据加入identity，没有元数据保留旧key。unknown effect在pending期间保持health problem，注册handler并处理后才能清除。证据`/tmp/myagent-reliability-b1-b4-evidence.json`：unknown-health及metadata-key变异红、旧源码+测试回滚专测0、恢复专项0。

### B5 事务、Prompt、Policy、Desk history

B5a `/tmp/myagent-transaction-repair-result.md`：COMMIT/RELEASE失败回滚、rollback失败fail-closed，Prompt监听afterCommit；隔离故障注入与变异日志见结果报告。一次本体46项限定测试因代理执行偏差退出0，属于本体测试违规，已如实登记，不能算隔离证据。

B5b history窗口只向模型投影连续、完整的tool-call/result回合，since审计行不删除；B5c Source policy revalidate与gate使用同source名单。各自RED/GREEN/变异/回滚证据在`/tmp/myagent-reliability-history-evidence.json`、`/tmp/myagent-reliability-history-policy-evidence.json`。

### B6 release/migration/browser verifier

script结果 `/tmp/myagent-script-repair-result.md`。B6a三个文件的隔离测试/typecheck/mutations/rollback hash在其报告。release只验证展开后的有效URL、single push target；migration用只读SQLite online backup、原退出码捕获和更准确提示。B6b浏览器依赖preflight不启动浏览器，2项隔离测试见本轮集成测试。

## 已知执行偏差

1. 事务代理与budget代理误在本体运行限定tests；未运行本体build/gate，无commit/push，完整记录见`/tmp/myagent-reliability-execution-ledger.md`与各报告。
2. 本轮不同TMP快照曾复制相互更改中的工作树，导致少量RED、typecheck失败；日志均保留，最终必须以统一最终快照gate判定。
3. final review发现stopSubagents无children仍取消closing parent、nested drain timeout可能丢失join；通过B2f补充修复/测试。原review `/tmp/myagent-reliability-final-review.md`。
4. 第一次B6b/chat/policy迭代中有red和实现调整；均不删除日志、不把中间失败冒称成功。

## 最终验收条件

必须在工作树冻结后新建唯一`/tmp/myagent-reliability-integration-final`快照（源码+tests+scripts+docs+新增文件、node_modules只读链接），执行完整`bash scripts/gate.sh`并捕获脚本自身退出码；记录typecheck/build/test/artifact、总测试数、snapshot源码树hash和产物hash。还要确认本体lib hash保持基线`7524842568f1c04b4a403afe14323020792beccb81f75fb209c0ae98b8122128`，最终复查git diff --check/status与push仍为`no_push`。仅gate绿仍不等于Host或聊天平台真实端到端；未覆盖边界持续标待验收。
