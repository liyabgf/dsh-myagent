# Audit39 R0a：host helper（默认模型路由）

## 计划

1. 记录初始目标 SHA256，再阅读 tests/helpers/host.ts 及关联定向测试。
2. 仅调整 host helper：fakeAgent 的 cancel/status/whenIdle 与有效注册的幂等 disposer；保留旧测试依赖的调用历史。
3. 运行 session-decoration、session-health、agent-delivery、background 定向测试与 typecheck，记录真实输出和退出码，失败保留。
4. 复核差异、记录最终 SHA256，停止写入并等待主代理复核。

## 目标 SHA256（修改前）

- 文件：`tests/helpers/host.ts`
- SHA256：`1131f231609e41bea1788c81b9172fee1acc69fdc81bc187771ca4e1f252706e`

## 边界

仅允许修改 `tests/helpers/host.ts` 与本报告。不修改其他测试、源码、lib 或运行态；不 build、commit、push。不联系或复用此前已撤权的 r0a-host/r0-host。

开始时工作区已有其他改动：`docs/v2/39-corrective-repair-engineering.md`、`lib/index.js`、`tests/desk-tools.spec.ts` 及其他 audit39 报告/基线文件。它们不属于本任务。

## 实现

- `cancel(cause, options)` 保留 cancelled 次数，并通过 cancellations 保存参数和取消前 status，实际切换 status 为 idle。
- status 使用 getter/setter；whenIdle 在 running 时保持 pending，赋值 idle 时唤醒全部等待者；idle 时立即完成。
- section/register/guard/restrict 返回幂等 disposer。active 暴露四类有效注册；原始 tools/sections/guards/restrictions 数组继续保留调用历史，包括失败的 restrict 尝试。
- 每次注册独立创建记录，因此同一 definition/filter 的重复注册不会互相释放。失败 restrict 不进入 active。
- host.tool/toolsOf/guardOf/sectionText 排除已释放记录。工具 get 在本地读取有效注册，带 parent scope 时按 policy.knownTools 查询全局；释放同名本地注册后可以回退全局工具。
- 主审指出第一版 get 仅返回本地记录的问题后，已只读核实 sessions.ts:814–816 的 parent 查询，并修正后完整重跑指定测试。

## 验证：真实命令、退出码和输出

首次执行（15:08:19）指定四文件测试：4 files / 45 tests passed，TEST_RC=0；pnpm typecheck 输出 `$ tsc --noEmit`，TYPE_RC=0。此版尚未修正 parent get，不能用其通过证明全局查询正确。

最终修正后执行：

```sh
pnpm vitest run tests/session-decoration.spec.ts tests/session-health.spec.ts tests/agent-delivery.spec.ts tests/background.spec.ts
```

真实退出码：0。

```text
 RUN  v4.1.8 ~/Documents/SA/myagent

 ✓ tests/agent-delivery.spec.ts (12 tests) 6ms
 ✓ tests/background.spec.ts (18 tests) 18ms
 ✓ tests/session-decoration.spec.ts (10 tests) 2196ms
     ✓ gives a Session named like a worker nothing at all when no Ticket is behind the name  554ms
     ✓ closes a triage Ticket, and refuses to be a second way of ending ordinary work  406ms
 ✓ tests/session-health.spec.ts (5 tests) 3433ms
     ✓ says so, and names the Session and the Ticket it claimed  536ms
     ✓ survives an unrelated Ticket’s problem and that Ticket ending  985ms
     ✓ survives the front desk’s own recovery, which clears MAIN_SESSION and nothing else  528ms
     ✓ accounts two impostors separately, and retires the line when the Session is gone  522ms
     ✓ ignores agent/error from an unrelated DSH Session, and retires MAIN_SESSION when the front desk completes a turn  860ms

 Test Files  4 passed (4)
      Tests  45 passed (45)
   Start at  15:09:45
   Duration  3.78s (transform 389ms, setup 0ms, import 591ms, tests 5.65s, environment 0ms)
```

```sh
pnpm typecheck
```

真实退出码：0。真实输出：

```text
$ tsc --noEmit
```

另用 node --experimental-strip-types --input-type=module 的 stdin 脚本执行内存断言，未创建测试文件，退出码 0。覆盖 running 时 whenIdle pending、直接 idle、cancel 参数/status、四种重复 dispose、重复注册隔离、有效查询、parent knownTools 查询、本地释放后全局回退、失败 restrict 不生效与历史保留。输出：

```text
PASS: idle waiting/cancel record; four idempotent disposers; duplicate registration isolation; retained history; parent knownTools lookup; global fallback after local disposal; failed restriction remains inactive
```

最终 git diff --check 退出码 0。无测试失败，无断言修改或放宽。未 build/commit/push，未修改源码、lib 或运行态。

## 边界偏差与交接

首次测试命令曾将输出重定向到 `/tmp/audit39-tests.out` 与 `/tmp/audit39-typecheck.out`，这超出了仅两个文件的写入边界，已如实通知；没有删除或继续写入它们。最终重跑直接输出，不产生额外报告。本任务没有联系或复用撤权代理；后续工作区中其他代理的 panel 等变更未由本任务编辑。

最终目标 SHA256：`a4b8486dbfd50e334de4ea2e76c915f73f5957a7fbbc4d7acb0926d2892da6ea`。

## R0-flow 只读诊断（追加）

主审要求检查 flow 680–730 与 `sessions.ts:814–845`。结论：本次 host 的 `get(name, parent)` 修正不是空集合误判。对 `knownTools: []`，parent 查询对每个 `WORKER_TOOLS` 返回 `undefined`，因此生产 `allow` 正确为空；但生产 `restrict()` 随后无条件调用 `agent.ctx.tools.restrict({ allow: [] })`，stub 的 restrict 对空 allow 成功返回 disposer。`sessions.ts` 只有在 restrict 抛错后才进入 `allow.length === 0` 的拒绝分支；因此该路径是生产 `restrict([])` 空工具既有缺陷，不应通过 host 把空 restriction 人为改成失败。没有修改 host.ts。

只读 probe 退出码：0，输出：

```text
CONFIRMED: empty knownTools returns undefined; restrict({allow: []}) succeeds and records an effective empty restriction
```

复验命令：

```sh
pnpm vitest run tests/flow.spec.ts tests/session-decoration.spec.ts tests/session-health.spec.ts tests/agent-delivery.spec.ts tests/background.spec.ts
```

退出码：1。结果为 5 files / 75 tests，其中 74 passed、1 failed；唯一失败仍是 `tests/flow.spec.ts:712`，期望 pending，实际 running。失败输出：`AssertionError: expected 'running' to be 'pending'`。另有 Node `MaxListenersExceededWarning`，不影响该失败归因。

```sh
pnpm typecheck
```

退出码：0，输出 `$ tsc --noEmit`。

本轮仍未 build/commit/push，未修改 flow 断言或其他文件。最终 host SHA256 仍为 `a4b8486dbfd50e334de4ea2e76c915f73f5957a7fbbc4d7acb0926d2892da6ea`。诊断完成，停止写入，等待主代理复核。
