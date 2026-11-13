# R0d flow audit

## 计划（先行记录）
- 核对 `tests/flow.spec.ts` 末尾 attachments 用例。
- 只读核对 `src/app/executor.ts` 的 `deliverAttachment` / `deliverInputs`，裁定附件真实目录与输入交付契约。
- 在不修改产品实现的前提下，增强测试：校验真实附件字节与输入 `deliveredAt`；移除条件降级，避免测试假绿。
- 仅运行 flow 定向 Vitest 与 typecheck；不运行 build。
- 报告记录变更、命题裁定、命令及真实退出码。

## 基线 SHA-256（写入计划时）
- `tests/flow.spec.ts`: `1bf5aa166dd15e1e3c0cba1bacc5fb49f9861def16cfa2d265e38b9ad058b4a9`
- `src/app/executor.ts`: `00d88964c8a14f85dd0d88b0a22402b6137195d1a8af3bd41358df351f07fc50`

## 合同裁定与改动
- `LocalHostSandbox.deliverAttachment`（`src/app/executor.ts:226-230`）将字节写入 `<workspace>/attachments/<name>`，不是 `inputs/`。
- `deliverInputs`（`src/app/executor.ts:734-754`）先尝试复制附件，再向 worker 投递 prompt，随后调用 `inputsDelivered` 标记输入与 Assignment 已投递。该流程中附件复制错误会被 warn 捕获，因此测试直接检查最终字节，避免丢附件仍被元数据断言掩盖。
- `tests/flow.spec.ts` 附件用例改为断言 `attachments/photo.jpg` 的精确字节、note 的 attachment 路径以及 `deliveredAt` 存在；移除目录不存在时退化为只验元数据的分支。
- 因真实合同是 `attachments/`，原测试标题中的 `inputs/` 属测试命题错误；没有证据表明这是生产实现缺陷，无需产品待修项。

## 验证
- `pnpm exec vitest run tests/flow.spec.ts`：真实退出码 **1**；30 条中 29 通过，1 条失败。失败为既有、非附件用例 `a profile that does not know several of the worker tools > leaves the Ticket unlaunched rather than running a worker with no restriction at all`：`tests/flow.spec.ts:712` 期望 Assignment 为 `pending`，实为 `running`。新增附件字节与 deliveredAt 用例通过。未为此任务改动该测试或生产代码。
- `pnpm typecheck`：真实退出码 **0**（执行 `tsc --noEmit`）。
- 未运行 build。

## 最终 SHA-256
- `tests/flow.spec.ts`: `b0dbaf521ff951269f644993917fa7eca4d21e84654a62fa7b0407d8b1f6efe7`

## 命令输出（关键结果）
```text
RUN  v4.1.8 ~/Documents/SA/myagent
✓ copies attachment bytes into attachments/ and marks the note delivered 353ms
FAIL tests/flow.spec.ts > a profile that does not know several of the worker tools > leaves the Ticket unlaunched rather than running a worker with no restriction at all
AssertionError: expected 'running' to be 'pending' // Object.is equality
Expected: "pending"
Received: "running"
❯ tests/flow.spec.ts:712:48
Test Files  1 failed (1)
Tests       1 failed | 29 passed (30)
Duration    8.21s (transform 191ms, setup 0ms, import 263ms, tests 7.85s, environment 0ms)
$ tsc --noEmit
FLOW_EXIT_CODE=1
TYPECHECK_EXIT_CODE=0
```

stderr 另有 `MaxListenersExceededWarning`（11 个 process exit listeners）。命令包装为捕获两条命令的 `$?` 后输出，包装自身退出码为 0；不能据此误报 Vitest 成功。

## 待跟进
- 空工具集场景的 pending/running 失败交由 host 相关任务负责人核对；此任务不调整授权隔离断言，也不以跳过或放宽制造全绿。
- 本附件用例证明最终文件内容及输入交付标记，未用额外测试探针验证 prompt 调用瞬间的复制顺序；顺序依据只读源码。文件不存在或字节损坏会直接失败。

仅写入 `tests/flow.spec.ts` 和本报告；未修改产品、helpers、其它测试、lib、运行态或 git 状态。完成后停止写入。
