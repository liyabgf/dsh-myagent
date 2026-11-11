# 五个回归剧本

每一部都是「在活体上做一件事，看系统怎么响应」。不是单测的延伸——单测钉的是机制，
这里钉的是**操作者真正在乎的那一件事**。一部剧本只验一件事，验证标准写在它自己的「判据」里。

这五个剧本选自 waste ledger（一天 12 张票里的废品），每一条都是曾经花了真 token 或被手停过的事。

## 剧本 1：一条非请求消息不再建票

**场景**：在 Telegram 或 QQ 聊天室发一条「1」（或「在吗」「测试」）。

**预期路径**：
1. 消息经桥变成 Trigger，gate 放行（身份映射、allowedSenders 通过）。
2. `triage.enabled: true + desk: main` → 分诊票生成，relay 进主会话。
3. 总管读消息，判定 `dropped`（不是请求），调用 `myagent_close_ticket(state: 'dropped')`。
4. 分诊票关闭，不创建 worker 票，0 worker 槽被占用。

**判据**：
- 面板「记录」页 → 「总管代你决定的」→ 看到那条消息，结局标注「无需处理」，附总管的理由。
- 面板「任务」页 → 没有新的 worker 票。
- 0 worker 槽被消耗。

**前置**：triage.enabled = true, triage.desk = main, triage.sources 含 chat。
**已知依赖**：总管工具桥需可用（PTC 模式 `run_code` 投影全部工具定义不报错）。

## 剧本 2：同一对话里两条消息不被劈成两张票

**场景**：在 Telegram 或 QQ 发一条请求（如「研究资本布局」），等几秒后再发一条补充（如「重点看中间层」）。

**预期路径**：
1. 第一条消息建票，自动订阅 Thread `chat:<channel>:<thread>`。
2. 第二条消息到达时，Thread 已有订阅票 → Subscription fan-out 直接投递为 note（answer 如果票在 waiting）。
3. 不创建新票，不走门禁。

**判据**：
- 面板「任务」页 → 只有一张票。
- 该票的详情 → 事件流有两次进气（第一次建票，第二次 note）。
- 该票详情 → 「线程」行显示 Thread key 与订阅数 = 1。

**前置**：triage 需判断第一条是请求（accept → 建票 → 订阅）。

## 剧本 3：worker 在超预算时自动停下

**场景**：排期或聊天票的 worker 卡住不报告。`runtimeBudgetMs` 设了 60 分钟。

**预期路径**：
1. 预算到点（60 分钟）→ 总管收到一条 note（提醒收尾），worker 继续运行。
2. 宽限期（10 分钟）后仍在跑 → 系统停下，Ticket 记为 `stopped`。
3. 停下事件写进 Ticket 历史。

**判据**：
- 面板「任务」页 → 该票 stage 变为 stopped。
- Ticket 事件流最后一条 = `stopped`，reason 含「超出时间预算」。
- 不需要操作者手动停止。

**变体**：`watchdog.silentMs` 设了 600000 时，静默 10 分钟先在决断队列停一条（不打断）。

## 剧本 4：同 Work 的后序票能读前序票的产物树

**场景**：票 A 产出 `skills-pack/` 目录（含多个子目录），报告时 `files: ["skills-pack/"]`。票 B 在同一个 Work 里，需要读 `skills-pack/sub/file.json`。

**预期路径**：
1. 票 A 报告 `files: ["skills-pack/"]` → 引擎登记目录产物（尾斜杠标记）。
2. 票 B 调 `myagent_read_artifact(path: "skills-pack/sub/file.json")` → 被目录产物覆盖授权 → 成功。
3. 不需要票 B 重新下载或重新生成。

**判据**：
- 票 B 能读 `skills-pack/` 下任意路径。
- 血缘记 `readPath` = `skills-pack/sub/file.json`（实际读的文件），不是目录名。
- 面板「关联引用」显示这条读取。

**验证过的反面**：102 万 token 的那张票正是因为只登记了 13 个索引文件、27 个技能目录不可见——补的尾斜杠让它整棵树可读。

## 剧本 5：跨 Work 的读取被拒绝

**场景**：票 C 属于 Work X，票 D 属于 Work Y（或未归组）。票 C 尝试读票 D 的文件。

**预期路径**：
1. `myagent_read_artifact` → `canCollaborate` 返回 false → 拒绝。
2. 文件系统层面也拒绝：`guardWorkerCall` 对非同 Work 的路径返回拒绝信息。

**判据**：
- 工具返回 `artifact_missing` 或 `collaboration_refused`。
- guard 拒绝信息含「outside its own Work」。
- 未归组的票没有 peer：`peerDirs` 返回空，所有兄弟目录读取都被拒。

**第二把锁**：前缀混淆——`out/` 不会覆盖 `output/x`（比较带斜杠的目录名，不是前缀匹配）。
