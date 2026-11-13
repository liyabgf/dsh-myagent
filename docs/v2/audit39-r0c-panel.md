# Audit39 R0c · panel 测试断言修正

## 范围与初始证据（编辑前创建）

- cwd：`/Users/liyang/Documents/SA/myagent`。
- 唯一测试写入：`tests/panel.spec.ts`；独占报告：`docs/v2/audit39-r0c-panel.md`。
- 编辑前 SHA-256：`tests/panel.spec.ts` = `7bae5253708c29ff13e885716497c0711af1989341c9474d4234733dac2048e9`。
- 审核输入 SHA-256：`docs/v2/audit38/test-coverage-review.md` = `5981827fc19a7cd7c6a6027caa9b3c9298f892e80e165cabf2b0ab789263ffa1`。
- 初始命令：`pwd && shasum -a 256 tests/panel.spec.ts docs/v2/audit38/test-coverage-review.md`；工具返回完整输出但未展示 exit code marker，后续验证命令将显式输出真实退出码。
- 已阅读 audit38 全文，panel 逐功能组发现位于 119–147 行；重点为空 matcher 两处、Work 删除负向请求断言、归档下拉无关 archive 缺少 fixture 与断言。

## 计划

1. 定向阅读两处空 matcher、Work 删除/归档测试及页面对应只读逻辑，确定实际支持的契约。
2. 恢复两处任务值精确 matcher；保留已有正控制，加入删除后 GET 数量不增的负控制；为归档下拉加入当前归属与无关 archive 的严格正负控制。
3. 排期 preset/maxRuntimeMs/deliverTo 丢失归属 R4：不改产品、不改为预期失败，不用 skip 假绿；必要时只添加明确 todo。
4. 仅运行 `pnpm exec vitest run tests/panel.spec.ts` 与 `pnpm typecheck`，记录命令与真实退出码；复核仅授权文件被本分支写入，并记录最终 hash。

## 执行与验证

- 仅编辑 `tests/panel.spec.ts`；未改 `panel/index.html`、src、其它测试/helper/lib。排期三字段问题归 R4，仅在对应 schedule save case 前写 `TODO(R4)`，未添加 skip 或预期失败。
- 改动：两处 `detailValue('任务')` 均恢复精确 `.toBe(...)`；Work 删除加确认前未发请求、详情有读取正控制、确认后/后续 10 秒刷新期间不再读删除对象的负控制，并用 works 列表继续刷新作正控制；归属下拉 fixture 增加无关 archived Work，断言活跃 Work 与当前归属 archived Work（包括选中值）在场、无关 archived Work id/label 均不在场。
- 命令：`pnpm exec vitest run tests/panel.spec.ts`；结果 1 file、319 tests passed；真实退出码 `0`。
- 命令：`pnpm typecheck`（执行 `tsc --noEmit`）；真实退出码 `0`。
- 未运行 build、commit/push 或运行态操作。
- 最终 `tests/panel.spec.ts` SHA-256：`d75e27b2a0d2ddc51384a03f24ac8f7f90425e45ce81df6af3622a70b6f94aa6`。
- `git status --short` 显示工作树存在其它既有修改（docs/v2/39-corrective-repair-engineering.md、lib/index.js、tests/desk-tools.spec.ts、tests/flow.spec.ts、tests/helpers/host.ts 及若干 Audit39 文件）；未触碰或清理。
