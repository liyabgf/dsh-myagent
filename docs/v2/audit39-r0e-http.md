# R0e HTTP 独立测试记录

## 计划（先行记录）

- 任务范围：仅修改 `tests/http.spec.ts` 与本独占报告；不改 helper、其他测试或 `src/lib/`，不 build/commit/push。
- 初始 `tests/http.spec.ts` SHA-256：`ae9b7c73d1db50725d13c920b0f64f44417c8f221f5ea581f8e91336691973a0`。
- 先读取现有 HTTP 测试、测试 host/request helper，以及 `src/app/http.ts` 的 body 读取和路由注册实现。
- 添加具真实 `IncomingMessage` 形状的 async iterator 请求，直接调用 `stubHost.routes` 中真实注册的 handler，覆盖坏 JSON、多 chunk 合法 JSON、stream throw；断言响应状态及无副作用。
- 保留旧用例，必要时修正会把非 JSON 情况描述为 JSON parse 测试的误导名称。
- 执行 `http.spec.ts` 和 typecheck，记录命令、真实退出码与关键输出。

## 初始状态

报告创建前不存在；测试文件初始哈希如上。随后检查了现有 HTTP 测试、`tests/helpers/host.ts` request、`tests/helpers/deployment.ts`、`src/app/http.ts` readBody/failure/registerHttp，以及运行命令定义。

## 发现与实施

- `host.request` 将传入 body 先 `JSON.stringify`；旧名声称“not JSON”，实际传 `undefined`，触发空对象的 schema 拒绝。保留原用例及大 body 断言，仅改准确名称与变量名。
- 仅在本测试文件内增加 `invokeRealRequest`：请求含 method/url/headers/async iterator，chunks 原样转为 Buffer；直接取 `host.routes.get('/myagent')` 调用 runtime 已真实注册的 `registerHttp` handler。
- 坏 JSON `{"worker":` 返回 400，payload 精确为 `The request body is not JSON`。
- 先产出一个完整合法 JSON chunk、随后 iterator 抛 `Error('request stream failed')` 返回 500，payload 精确为该异常信息，确认完整 chunk 不会提前产生写入。
- 两个拒绝用例均比较写入前后 prompts（含 revision）、state counts/settings/settingsRevision、host calls、work 目录，并断言无 operator decision、无 agent。
- 合法 JSON 分三块，特意把“中”的 UTF-8 三字节拆开，返回 200；worker current/override 完整匹配中文原文，revision 恰为 1；无 Ticket 或 Session 副作用。合法写入对象为 prompts，不是 settings。
- 最终测试文件 SHA-256：`c5a8544be962f34827d6537b17cb50d0154d378f2803eec2a86f18bcbe72155c`。

## 实际验证

工作目录均为 `/Users/liyang/Documents/SA/myagent`。初次测试和 typecheck 均通过；工具未给 exit marker，因此额外执行显式保存并打印命令退出码的同一检查，以下保留真实输出。

### HTTP spec

命令：`pnpm exec vitest run tests/http.spec.ts; result=$?; printf '\\n[exit code: %s]\\n' "$result"; exit "$result"`

```text
 RUN  v4.1.8 /Users/liyang/Documents/SA/myagent
 ✓ tests/http.spec.ts (61 tests) 3693ms
 Test Files  1 passed (1)
      Tests  61 passed (61)
   Start at  15:14:28
   Duration  4.06s (transform 201ms, setup 0ms, import 275ms, tests 3.69s, environment 0ms)
[exit code: 0]
[stderr]
(node:76532) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 exit listeners added to [process]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
(Use `node --trace-warnings ...` to show where the warning was created)
```

### Typecheck

命令：`pnpm run typecheck; result=$?; printf '\\n[exit code: %s]\\n' "$result"; exit "$result"`

```text
[exit code: 0]
[stderr]
$ tsc --noEmit
```

## 写入范围与交接

本 agent 仅写入 `tests/http.spec.ts` 和本报告；最终已人工检查该测试文件 diff。未修改 helper、src、lib、其他测试，未执行 build/commit/push。工作树中其他文件的并发变动属于其他 agent，不在本任务中改写或回退。测试存在上示 listener warning，但真实退出码为 0。本报告完成后停止写入。
