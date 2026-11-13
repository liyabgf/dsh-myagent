# Audit39 R1/R2 执行只读审核

## 范围与方法

审核提交 `99e99b5`（R1）、`77292c2`（R2）的完整 diff，并与当前 desk-loop/llm/runtime/effects/prompts/memory/lock/executor 及相关 tests 互证。仅本报告由 execution-r12 独占写入；不修改源码、tests、lib、运行态，不 build、不跑测试、不 push。发现区分静态确认与实验；目前未执行实验。

## 操作与失败账本

- O01：先尝试读取 `~/Documents/SA/docs/v2/audit39-execution-audit.md`，工具报 not found；使用 glob 定位后读取正确文件 `~/Documents/SA/myagent/docs/v2/audit39-execution-audit.md`（48 行）。未修改原件。
- O02（完成）：`git show --format=fuller 99e99b5` 与 `77292c2` 完整 diff/stat 均退出 0；当前 HEAD=`99477e1f96119608bc8d1fc70f7f4473786f7407`，`git status --short` 仅显示既有 `lib/index.js`、`lib/index.d.ts` 修改及本报告/既有报告未跟踪，未触碰。两提交改动路径、R1/R2 supervision 日志、修复计划已读。
- O03（完成）：只读 `read/grep/glob` 检查 desk-loop/desk-history/runtime/desk-llm/effects/prompts/store/health 及 `audit38-repro.spec.ts`、effects/prompts tests；工具调用退出成功。
- O04（失败）：初次绝对路径读取总控文档报 not found（路径误在仓库根）；随后 glob 定位并成功读取 `myagent/docs/v2/audit39-execution-audit.md`。该失败不改变工作树。
- O05（约束）：未执行 `pnpm test/vitest/typecheck/build/gate`，未做实验、未改业务源码/tests/lib/运行态，故以下均为静态确认；提交声称的 gate 只能作为日志声明，未在本轮复验。

## 发现（增量）

### F01 · P1 · stop 仍未 join，关库后异步访问可达（静态确认）

证据：`src/app/desk-loop.ts:146-151` 的 stop() 返回 void，仅 abort 并 splice 整个 queue；`:167` 以 void 丢弃 runLoop Promise；当前 entry 仍在 `:174` await processEntry。Runtime 在 `src/app/runtime.ts:1422-1424` 调 stop 后立即 Store.close、释放锁。provider abort 拒绝后，runLoop catch 在 `desk-loop.ts:190-193` 仍读取 tickets；若工具异步执行已在途，则 `:335-344` 还会写 tool history。更坏的是 catch 内 ticket.get 在 try 之外，关库异常可使 runLoop Promise 拒绝且没有接收者（:167），running 标志也不复位。触发：有 ticketId 的流/工具尚未完成时关闭 Runtime；即使 provider 正确响应 abort，Promise continuation 也不会被同步 stop 等待。原契约：修复计划 `:152,162` 要求等待当前 turn 结束、Store.close 前不再写入；仅加 stop 调用未满足。还存在关闭导致的 aborted 被同一 timeout 分支 report dropped 的语义混淆（:184,190-199），应与正常停机中断分开。

### F02 · P1 · 当前 turn 回复守卫取到最终 assistant 时间，追问后被错误结案（静态确认，新回归）

证据：`desk-loop.ts:276-283` 先 append 最终 assistant，`:373` 随后用 recent(1).at(-1).at 命名 lastUserAt。`desk-history.ts:76-99` 明确选最新一条非 system（不限制 role=user），因此此时实际是刚写的 assistant。若同一 turn 较早执行 myagent_reply（写 replied 事件）后模型再返回普通文本，replied.at < 最终 assistant.at，`:374-376` 不再阻止 `:385` ready。同毫秒偶然相等不构成正确性保证。契约：计划 `:156,166` 要求当前 turn 已追问保留 open。RT09 (`tests/audit38-repro.spec.ts:109-115`) 只放入固定 2026-01-01 的旧 replied，没覆盖本 turn 追问→最终文本，不能捕获此回归。

### F03 · P1 · error/aborted/max-tokens 带 tool calls 仍执行副作用（静态确认，修复漏分支）

证据：`desk-loop.ts:286-312` 仅当 toolCalls.length===0 才校验 failFinish；有 tool calls 即进入 `:314-349` 执行所有工具并继续 LLM，未检查失败 finish。`desk-llm.ts:73-84,93-107` 保留组装出的 tool calls，并从 reason.kind 提取 finishReason，二者可同时存在。触发：provider 已输出完整工具块，但随后 terminal error/aborted/max-tokens；仍可能 create/dispatch/reply/report 等副作用，后续轮还可最终 ready。契约：计划 `:154,164` 的失败必须可见 failed/dropped，并不能把部分结果作为成功。RT11 (`audit38-repro.spec.ts:133-140`) 只有 text-delta+error，不含 tool calls，故该路径全空。

### F04 · P2 · requestId 回合幂等完整遗漏，绿灯仍要求缺陷存在（静态确认）

证据：`desk-loop.ts:153-161` 无 single-flight/完成状态，无条件 push；`:219-241` 仅 append 历史后无条件 runTurn。`desk-history.ts:51-55` 只返回旧 seq，调用者没利用其去重结果。现有 RT10 (`tests/audit38-repro.spec.ts:119-130`) 明确顺序 relay 同一 requestId 两次并断言 provider calls===2，仍在最终测试树中保留缺陷观测，与 R1 完成不能互证。并发请求也逐个处理，无法复用 Promise；重启也无执行状态。契约：计划 `:155,165,171`、supervision R1-08 与 M-R1e 要求同进程顺序/并发只执行一次工具、持久识别执行状态。本轮未实验，不把历史 probe 当作新复现。

### F05 · P3 · unknown Effects 告警同 pass 被 quiet 覆盖（静态确认，C09修复无效）

证据：`src/app/effects.ts:112` 清 complained；`:125-128` 直接 health.problem，没有调用 `:151-155` complain/设置 complained/unresolved；`:138` 必调 summarize，而 `:163-170` 在无其他失败时 record(QUIET)。`src/app/health.ts:17-19` record 把 ok 设 true 并清故障。触发：队列仅有未注册 kind（或没有其他尚未解决的失败），runDue Promise 返回时健康已恢复，未知行仍留表（store.ts:761-764 计数不删除）。契约：计划 `:186,193,195` 要求未知 effect 可诊断，删除告警实现应有红测试。`tests/effects.spec.ts:221-229` 的 late-handler 用例经过未知 kind 却不检查健康，`:232-242` 同样只查计数；R2未加有效健康断言。

## R1/R2 逐项结论

- R1-01 recover 顺序：静态确认已按计划前移 DeskLoop 初始化（runtime.ts:1263-1285）；启动失败/未配置行为未有对应强测试。
- R1-02 生命周期：**不通过**，见 F01；abort 与清队列存在，但无 join。
- R1-03 角色超时：静态确认 triage+running guard（desk-loop.ts:190-205）；探针 worker fixture 缺 role 字段，虽命中不 drop，但没有验证真实 role=worker。
- R1-04/R2 finishReason：无 tool calls 的 error/aborted/max-tokens 路径静态正确；有工具路径见 F03。RT11 仅覆盖 error+partial text。
- R1-06 signal：静态确认 GenerateOptions 转发 signal（desk-llm.ts:60-67）；RT07 为已 abort signal 的弱桩，未证明阻塞 provider 实际停止。
- R1-07 replied：**不通过**，见 F02；当前 turn 边界取错消息。
- R1-08 requestId：**未修**，见 F04；RT10 继续断言两次 LLM。
- R1-09/R1-10：未配置抛错、停止后 enqueue reject 静态存在；notify 在未配置时仍先写历史再成功，不属于 relay 悬挂但未见专项覆盖。
- R2 C01/C03/C04/R2-12：lock 异机拒绝、watchdog 成功后 dedupe、Thread snapshot/restore、artifact 字节比较静态与契约相符；本轮未实验。
- R2 C05：两 KV 写确实包 Store.atomic，**事务通知仍不满足/未覆盖**，见 F06；recordSkillUse 仍单写 config且按设计不 bump revision。
- R2 C09：**不通过**，见 F05；告警被同轮 quiet 覆盖，且无有效测试。
- R2 C08：supervision 明确保持原行为，属于计划遗漏；R2范围列入但未修，不能计为通过。
- R2 C07：计划列为先核后决定，本提交未改，保持未决。

## 未执行实验与处置建议

本轮按授权不运行测试/构建/运行态实验，故没有“实验确认”项。建议后续隔离验证：stop 时阻塞 stream + tool 期间 Store.close 竞态；同 turn myagent_reply 后 assistant 结案；toolCalls+error finish 不得执行工具；同 requestId 顺序/并发 single-flight；unknown effect health 不被 quiet 清除；外层 atomic rollback 不得触发 prompts listener。任何修复均应补强测试并保留真实事务/持久 Store 证据。


### F06 · P2 · Prompts 通知不遵守外层事务提交，probe 降级掩盖故障（静态确认；嵌套场景）

证据：`src/app/prompts.ts:200-204,214-218,231-235,273-277` config/revision 本层原子写确有改进，但 notifyChange 在内层 atomic 返回后直接调用；外层 Store.atomic 尚未 commit 时也会触发 listener（`:144-146`）。Runtime listener (`runtime.ts:1276`) 同步写 DeskLoop history（desk-loop.ts:105-107），动态技能同步 listener 还可影响内存宿主注册。若外层随后 rollback，KV/SQLite可回滚，但已发通知的内存效果无法撤回；若外层一次多改也发多次中间状态通知。契约：计划 `:32,188` 要先核调用方事务所有者，避免重复事务/通知。R2将 SUP01 从“第二次set抛错，检查config保持旧值”改成 `tests/audit38-repro.spec.ts:60-75` 的 Map + atomic计数；该计数甚至不能证明两写都位于 atomic 回调内（任意位置空 atomic 也会通过），且不再注入第二写故障；`tests/prompts.spec.ts:13-15` atomic stub 也不回滚。应补真实 Store 第二写失败、嵌套rollback不通知/提交后一次通知的验收；当前本层 KV 原子性可静态认可，但事务通知合同未覆盖。
