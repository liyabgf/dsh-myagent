# 31 · 总管独立 LLM API 入口

**实现时间**：2026-11-11  
**工程编号**：D1–D10  
**状态**：已落地并通过闸门（1170 条测试，schema v7 验证通过）

---

## 一、为什么要做

原来的总管（总管 = myagent 的总管会话，唯一的交互入口）通过 DSH 的 Session/PTC 机制运行：

```
消息 → relay → ensureMaster → DSH Session（PTC 模式）→ run_code → 工具
```

PTC（Program-to-Tool Call）的问题：模型输出的不是原生工具调用，而是一段 JavaScript 程序，DSH 在 Session 创建时把所有工具 schema **投影进 `run_code` 的执行环境**，这个投影结果被缓存在 Session 状态里。如果投影时某个工具定义不合规（schema 有不可序列化的值），整面工具失效——连原生的 `bash` 都用不了。而且这个损坏状态会被 DSH 的 Session 持久化文件保存下来，**重启不修复**，唯一的修法是销毁 Session。

活体实证：主会话 `session-051e3501` 在 2026-11-09 出现工具桥故障，从那天开始总管能判断但不能执行任何工具。这个状态持续了约 3 天，所有经过 triage 的 chat 消息都停在"判断正确但落地不了"的状态。

---

## 二、现在的架构

```
消息 → relay → DeskLoop（排队）→ ctx.llm.stream（原生 function calling）→ 直接执行工具
                    ↑
              对话历史：SQLite desk_messages 表（schema v7）
```

关键变化：
- **ctx.llm**：复用 DSH 的 LLM 服务（`ctx.llm.stream()`），不自己写 HTTP 客户端。这样 DSH 配置的所有 provider（OpenAI/Anthropic/DeepSeek/任意第三方）自动可用，API key 仍在 DSH 的 provider 配置里。
- **原生 function calling**：模型直接输出 tool_calls，不走 PTC/run_code，没有 schema 投影，没有缓存状态可以损坏。
- **fallback**：`deskLlm.provider` / `deskLlm.model` 未配置时，自动回退到 DSH Session 路径。这样现有测试不受影响（测试不配 provider），生产环境配好就切换。

---

## 三、新增文件

| 文件 | 作用 |
|------|------|
| `src/app/desk-history.ts` | 对话历史：append/dedup/recent/since/latestSeq/setSystem |
| `src/app/desk-llm.ts` | 封装 `ctx.llm.stream()`：组装 GenerateOptions，收集 StreamChunk，拼出 DeskLlmResponse |
| `src/app/desk-tools.ts` | mainTools → ToolSchema[]（直接用 `z.toJSONSchema`）；解析并执行 LLM 返回的 tool_calls |
| `src/app/desk-loop.ts` | 总管主循环：队列 + prompt 组装 + LLM turn 循环 + 工具轮 + 历史持久化 |
| `tests/desk-history.spec.ts` | DeskHistory 单测（8 条） |
| `tests/desk-tools.spec.ts` | 工具桥单测（4 条） |

---

## 四、改动的文件

| 文件 | 改了什么 |
|------|---------|
| `src/core/policy.ts` | 新增 `deskLlm: { provider, model, temperature=0.2, maxTokens=4096 }` 配置块 |
| `src/app/store.ts` | 新增 `deskHistory: DeskHistory` 属性；schema v7 迁移（`desk_messages` 表） |
| `src/app/sessions.ts` | 新增 `setDeskLoop()`、`hasDeskLoop()`；`relay()`/`notify()` 在 DeskLoop active 时路由到它 |
| `src/app/runtime.ts` | 新增 DeskLoop 创建与初始化；`deskLoop` 属性暴露给 HttpHost |
| `src/app/http.ts` | 新增三条路由：`GET desk/status`、`GET desk/messages`、`GET desk/providers` |
| `panel/index.html` | 新增「总管」标签页（对话历史气泡 + provider/model 选择器 + 状态 chip）；**JS 必须在 IIFE 内**（否则 `api` 访问不到）|
| `tests/panel.spec.ts` | 新增 desk 路由 mock；SERVED 加 3 条；nav 断言加「总管」 |

---

## 五、配置方式

在面板「总管」标签页选 provider 和 model，点保存。或者直接用 API：

```json
PUT /myagent/api/settings
{
  "deskLlm": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "temperature": 0.2,
    "maxTokens": 4096
  }
}
```

provider 和 model 的值来自 `GET /myagent/api/desk/providers` 返回的列表（转发自 `ctx.llm.listProviders` + `ctx.llm.listModels`）。

---

## 六、已知限制

- **DeskLoop 只在 provider+model 配置后激活**：未配时 fallback 到 DSH Session 路径（原来的 PTC 路径）
- **notify 不触发 LLM turn**：notify 消息（如 worker 完成通知）只追加到历史，不唤醒总管。这是设计决定：避免每次任务完成都花一次 LLM 调用。
- **对话历史不迁移**：旧的 DSH Session 历史（`.zstd` 文件）不会迁移到 `desk_messages` 表，新 Session 从零开始。
- **ctx.llm 仍是依赖**：总管不再依赖 DSH 的 PTC/Session 机制，但仍然依赖 `ctx.llm` 服务——这是无状态的调用，不存在缓存损坏的问题。

---

## 七、测试覆盖

| 层次 | 测试文件 | 条数 |
|------|---------|------|
| DeskHistory | `tests/desk-history.spec.ts` | 8 |
| 工具桥 | `tests/desk-tools.spec.ts` | 4 |
| 面板「总管」tab | `tests/panel.spec.ts`（已有 319 条中含） | — |
| 闸门 | `./scripts/gate.sh` 退出码 0 | 1170 条全绿 |

---

## 八、和架构审核的关系

`docs/v2/30-desk-centric-architecture-audit.md` 识别了 5 个结构缺口：
1. **降级**（P0）：总管工具桥坏了应该有降级路径 → **这个实现里 fallback 到 DSH Session，不是"跳过 triage 直接建 worker 票"**（工具桥坏了应该修，不应该绕过总管）
2. **审视**（P1）：任务完成/失败不唤醒总管审视 → **未做**（需要在 delivery.ts 里把 `ready`/`failed` 改为 `relay` 而不是 `notify`）
3. **巡检**（P2）：总管没有定时巡检 → **未做**
4. **健康检查**（P3）：工具桥故障不检测 → **有 health.desk 条目，但检测的是 recent errors，不是主动探测**
5. **自动重建**（P3）：主会话损坏不自动重建 → **DeskLoop 本身没有"主会话"概念，不存在这个问题了**

缺口 2 和 3 是下一轮的工作。
