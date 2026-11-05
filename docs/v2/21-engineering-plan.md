# 21 · 收尾工程计划（带纪律）

**这份文档的用途**：把当前所有已知的欠账排成一个**可执行、可验收、可中断**的工程，
每一项都自带**文件边界**、**验证标准**、**必须的变异检验**、以及**外部可核对的完成判据**。

**为什么需要它**：本项目已经出现过三种"看起来做完了"——
一次是产物七轮没重建而我一直报全绿（0.1/0.2 的由来）；
一次是修泄漏的清理函数自己引入了偶发 ENOTEMPTY（§4.59）；
一次是我写下的"该怎么测"的配方本身是错的、照着它写出了不可能失败的断言（§2.2 的 S44 测试）。
**共同点是：完成与否由执行者自己宣称。** 所以这份计划里每一项的完成判据都必须是**别人能一条命令核对的**。

---

## 0. 约束所有工作包的纪律（违反任何一条，该包不算完成）

沿用 `04-execution-discipline.md` 的 11 条，另外**三条是本项目后半段新学到的，在此并列**：

| | 纪律 | 来源 |
| --- | --- | --- |
| **0.11** | **我记下的"配方"需要和我记下的"结论"同样程度的怀疑。** 结论我会要证据，而配方因为"只是建议"就绕过了审查——但下一个人会照着做，于是它和结论一样有后果 | F1修法3 无落点、F7 前提是预测、S44 测试配方错，三次 |
| **0.8 强形式** | 变异之后**还要检查：删掉哪条断言会让测试在缺陷全活时变绿**。一条不可能失败的断言比没有断言更坏，因为它读起来像覆盖 | §4.45 M1、§4.46 M1、§4.59 M1、S44 测试 |
| **0.12** | **按性质扫，不按形态扫。** 脱敏要扫"某个已知键后面的高熵串"，不是扫"我以为 token 长什么样"；枚举缺陷类要从**原因**出发搜，不是从 grep 到的字符串出发 | UUID 正则漏掉 base64url token；`toBeGreaterThan(Date.now())` 漏掉另一种形状的竞态 |

**另外三条执行规矩**：

- **一次只开一个工作包**，除非两个包的文件边界**经检查确认不相交**（W3 与 W6 可以并行，W0 与 W1 不行）
- **每个包结束时跑完整四步闸门**（不是 `--quick`），并核对：退出码 0、测试数不降、`find src tests -name '*.ts' -newer lib/index.js` 为空
- **变异检验之后必须重建**（0.2b：还原会更新 mtime，使新鲜度断言变红而内容其实未变）

---

## W0 · 给测试桩加"myagent 在这个 Session 上注册了什么"的读取口

**为什么是第一个**：S44（提权路径）的回归测试**写不出来**，不是因为断言难写，而是因为探针不存在。
第一次尝试用 `host.guardOf(id)` 失败了——**orchestrator 那条路根本不注册 guard，只有 worker 会被 restrict**，
所以"没有 guard"对被正确拒绝的冒充者和被装扮成前台的冒充者**同时成立**。

**做什么**：`tests/helpers/host.ts` 的 `AgentRecord.ctx.tools.register(...)` 与
`ctx.systemPrompt.section(...)` 现在只被调用、不被记录。加两个读取口：

```ts
toolsOf(agentId: string): string[]          // 注册过的工具名，按注册顺序
sectionsOf(agentId: string): unknown[]      // 注册过的提示词段
```

**边界**：只改 `tests/helpers/host.ts`。**不改 `src/`**——这是纯测试基础设施。

**验证标准**：
1. 一条测试断言**真 worker** 的 `toolsOf(workerId(ticketId))` 含 `myagent_report`、
   `myagent_note_ticket`、`myagent_read_artifact`——**这三个是 `sessions.ts:36` 允许清单的子集，先核**
2. 一条测试断言**主 Session** 的 `toolsOf(masterId)` 含 `myagent_create_ticket`
3. **变异检验**：让 `toolsOf` 永远返回 `[]` → 上面两条必须变红。
   **再做 0.8 强形式**：删掉第 1 条的断言，第 2 条是否仍然能抓住？（若不能，说明两条断言守着同一件事，要改）

**完成判据**（外部可核）：`pnpm vitest run tests/helpers` 或相应 spec 退出码 0；
`grep -c "toolsOf" tests/helpers/host.ts` ≥ 2；完整闸门退出码 0 且测试数 ≥ 771。

---

## W1 · S44 的回归测试（依赖 W0）

**为什么**：一条**没有测试的安全修复可能被静默回退**。而这条修复堵的是提权路径
（id 以 `worker-` 开头的会话 → 拿到 orchestrator 的管理工具 → 能建"以完全访问运行"的 Ticket）。

**做什么**：在 `tests/flow.spec.ts` 写断言对——

```ts
host.emit('agent/created', { agent: { id: workerId('0'.repeat(32)) } as never })
await settle(runtime)
expect(host.toolsOf(workerId('0'.repeat(32)))).toEqual([])      // 一个 myagent 工具都没有
// 对照：真 worker 仍然被装扮
drop(inbox, 'real.md', '做点事。'); await settle(runtime)
expect(host.toolsOf(workerId(runtime.store.tickets.list()[0]!.id))).toContain('myagent_report')
```

**第二条才是让第一条能够失败的东西**——没有它，"什么都不装扮"也能通过（这正是上一次失败的原因）。

**边界**：`tests/flow.spec.ts`（或新建 `tests/session-decoration.spec.ts`）。不改 `src/`。

**验证标准**：
1. **变异检验 M1**：把 `decorateAgent` 退回 `await this.decorate(agent, this.host.ticket(ticketId))`
   → 测试必须变红，且**红在第一条断言上**（`expected [ 'myagent_create_ticket', … ] to deeply equal []`）
2. **0.8 强形式 M2**：M1 仍在的情况下删掉对照断言 → **必须仍然红**。
   如果它变绿，说明这条测试和上次一样是空的，**不许提交**
3. 变异后必须**逐字还原**（用 sha256 比对备份），并重建

**完成判据**：完整闸门退出码 0、测试数 ≥ 772、M1 与 M2 的红/绿结果都写进
`docs/v2/06-security-risk-register.md` §2.2（把那一条从"欠账"改成"已覆盖"，并记下两次变异的结果）。

---

## W2 · 把"有会话冒充 worker 名字"上浮到健康板

**为什么**：现在这条只写 `logger.warn`。**一条没人看得见的拒绝，正是 S33 那句假审计记录的成因。**

**做什么**：给 `SessionsHost` 加一个**窄端口成员**（照 `replyLost` / `noticeLost` / `escalate` 的先例），
把这件事记到 `SessionHealth` 上——**注意必须按主体记账**（第 50 轮的 `SessionHealth` 已经是按 ticketId /
`MAIN_SESSION` 分键的），而这个主体**不是任何 Ticket**，所以要么用一个专门的键
（如 `IMPOSTOR_SESSION`），要么让它归到 `MAIN_SESSION` 之外的第三类。
**不要塞进某张 Ticket 的槽位**，否则一张无关 Ticket 的状态会把它顶掉（N9）。

**边界**：`src/app/sessions.ts`、`src/app/session-health.ts`、`src/app/runtime.ts`（接线）、tests。

**验证标准**：
1. 冒充者出现 → 健康板 `sessions` 条目 `ok: false`，detail **点名那个会话 id 与它想冒充的 ticketId**
2. **它不会被无关的东西清掉**：另一张 Ticket 正常结束时，这条仍在
3. **它会过去**：那个会话消失/被 dispose 后，下一轮安静的 pass 清掉它（第 43 轮的语义）
4. **变异检验**：去掉按主体记账、改回共享槽位 → 第 2 条必须变红

**完成判据**：完整闸门退出码 0；`06` §2.2 的第 2 条欠账改为已完成。

---

## W3 · 三个通用 skill（机制已查明）

**为什么**：两次真实运行**各自独立发明了 `html2txt.py`**（1675 与 2044 字节、内容不同），
还出现过 `mk_news_manifest2.py`（复制而不是修改）。**这是从真实使用里长出来的需求，不是设想的功能。**

**机制（已查实，不要再推导）**：`packages/skill/skill/src/index.ts` 是 provider 注册表，
暴露 `register(skill: SkillRegistration): () => void`（`:439`）；
`SkillSource` 含 `'runtime'`（`:40`）；skill **可以是虚拟的**（`:58` "absent for virtual skills"）；
`SkillResourceBase` 可为 `{kind:'directory', path}`（`:42-44`），路径可用 `import.meta.dirname` 在运行时解析。
**不需要 `customSkillDirs`，不需要 patch YAML 表达路径，不要往 user/bundled 根写。**

**做什么**：
1. **先读 `SkillRegistration` 的定义**，搞清 `register` 单个 skill 时的 **rank 语义**
   （`BUNDLED_SKILL_RANK = 600`，"Lower ranks win duplicate skill names"）——**这是目前唯一未核实的一项**，
   而它决定取名策略（与 DSH 内置同名时谁赢）
2. 三个 skill：**HTML→文本**、**限速抓取**、**来源登记表**
3. **正文从真实脚本提炼，不要重写**：
   `examples/real-run-1-collect/scripts/html2txt.py`、`fetch.py`、`mk_registry.py`
   （以及 `real-run-2-compare/scripts/fetch_legal.py` 的限速与重试参数）。
   **它们被真实工作验证过，重写会丢掉验证换来的细节**
4. 在 `src/index.ts` 的 apply 里注册，**注销函数在 dispose 里调**（与其余资源生命周期一致）
5. `prompts/worker.md` 的「Reuse before you build」一节（0.1.2 已加）**要点名这三个 skill**，
   否则"先找现成的"仍然找不到东西

**一条先查的线索（可能让 W3 简单一个数量级）**：DSH 的技能目录里已经出现了
**`myagent:worker`** 与 **`myagent:orchestrator`**，其描述正是 `prompts/worker.md` 与
`prompts/orchestrator.md` 的开头（"You are one Ticket's worker. You run unattended…" /
"You are myagent's orchestrator. You do not do the work yourself…"），
**带 `myagent:` 前缀**；此前还出现过一条 `myagent:v2-live-acceptance`。
**所以已经有某个机制在把这个 bundle 的内容以 skill 形式发布**，而我还没查明是哪一个
（仓库里没有 `skills/` 目录，`cordis.patch.yml` 里只有 DSH 自己的 `skill-filesystem` 与 `tool-skill`，
`src/` 里也没有 `ctx.skills` 调用；候选是 `dsh-harness-dev-context` 或某个 project/user 根的自动发现）。

**W3 的第一步因此改成**：先查明 `myagent:worker` 是从哪里来的。
- **如果它是"某个目录被自动发现"的结果** → W3 就退化成"把三个 skill 文件放到那个目录"，
  不需要写任何注册代码，也不需要碰 `src/index.ts`
- **如果它是运行时注册的** → 按上面 `ctx.skills.register` 的方案做

> **不要在没查清这条之前动手写注册代码**：如果已经有一个更简单的机制，
> 我写的注册代码就会与它并存，产生两个来源、两种命名、以及"哪一个赢"的问题——
> 而 §3.3b 里那条 rank 未核实的风险正是这种并存会带来的。

**边界**：`src/index.ts`、新增 `skills/`（或内联正文）、`prompts/worker.md`、tests。
**不改** `sessions.ts`（W2 在动它）——**所以 W3 与 W2 不能并行**。

**验证标准**：
1. 一条测试断言 catalog 里有这三个 skill、`source === 'runtime'`、名字符合 `isSkillName` 的 kebab-case 语法
2. 一条测试断言**worker 能加载其中一个**（`skill` 在 `sessions.ts:36` 的允许清单里，所以这条路是通的）
3. **变异检验**：去掉注册 → 第 1 条变红；把正文换成占位符 → 需要有一条断言检查正文含关键内容
   （例如限速参数），否则"注册了三个空壳"也能通过
4. `package.json` 的 `files` 要包含 skill 文件所在的目录（若走磁盘而非内联）——
   **并核实它真的进了发布物**（`npm pack --dry-run` 或 clone 后检查）

**完成判据**：完整闸门退出码 0；`20-capability-and-asset-analysis.md` §2.4 的建议 ②③ 标为已完成；
发布后 clone 一份确认 skill 文件在。

---

## W4 · 补 `gate.sh` 的盲区：不进 bundle 却随包发布的文件

**为什么**：改 `prompts/worker.md` 之后**产物哈希没变**（771 全绿），因为 `prompts/*.md` 与
`panel/index.html` 一样**随包发布、运行时从磁盘读、但不打进 `lib/index.js`**。
而新鲜度检查**只 glob `*.ts`**，所以**这两类文件的改动闸门看不见**。
第 46 轮记过面板那一半，0.1.2 是同一个盲区的第二个实例。

**做什么**：**不要照搬 `*.ts` 的规则**——"比 `lib/index.js` 新"对不进 bundle 的文件**根本不成立**
（它们永远不会比它旧）。正确做法是让闸门**报告这两类文件的 sha256**，
由发布流程去比对"上次发布时的哈希"，不一致就要求确认。

**边界**：`scripts/gate.sh`（以及可能的 `scripts/release.sh`，见 W5）。

**验证标准**：改一个字符到 `prompts/worker.md` → 闸门输出里它的哈希变化；改回来 → 哈希复原。
**这不是单元测试能覆盖的**（它是脚本行为），所以验证方式是**跑一次并贴输出**。

**完成判据**：`./scripts/gate.sh` 的输出里出现 `prompts/` 与 `panel/` 的哈希行；
`04-execution-discipline.md` 的 0.2 补一句"产物新鲜度只覆盖进 bundle 的文件"。

---

## W5 · 两棵树的漂移，与一条可重复的发布流程

**为什么**：现在有两棵树——`~/Documents/SA/myagent`（真源）与 `~/Documents/SA/myagent-public`（发布物）。
**已经漂移两次**：能力分析文档创建在了副本里（后来同步回来）；
副本的 `06`/`00` 缺 §2.2 与 §4.60。**手工同步必然继续漂移。**

**做什么**：写 `scripts/release.sh`，把发布变成一条命令：
1. 从真源 rsync 代码、测试、面板、prompts、docs、examples（排除 `node_modules`、`.git`、`lib`）
2. 复制 `lib/`（方案 A：交构建产物）
3. **脱敏**：按性质扫（0.12）——已知键后面的高熵串、`/Users/<name>`、主机名、会话路径、私人任务标题；
   **token 一律换成它自己的 sha256 前缀**，因为那些位置的原文是在证明"两次采样逐字相同"，
   换成 `<redacted>` 会让结论留下而证据消失
4. **扫暂存字节**（`git grep --cached`），不是扫工作区
5. 版本 bump、完整闸门、commit、push
6. **从远端核实**：`gh api` 取 HEAD（**不要用 raw.githubusercontent**，它有 CDN 缓存，
   0.1.2 那次它落后于真实提交）、远端 `package.json` 的 version、远端 `lib` 的 sha256、
   以及**修复标记在远端 bundle 里能 grep 到**

**边界**：新增 `scripts/release.sh`；`docs/v2/03-deployment-and-rollback.md` 补发布节。

**完成判据**：跑一次 `release.sh` 能从真源产出干净的发布物并推送成功；
两棵树的 `docs/v2/` 在同步后 `diff -rq` 只剩下**刻意不同**的文件（LICENSE、SECURITY.md、examples）——
**把"刻意不同"列成白名单，其余任何差异都算漂移**。

---

## W6 · §0.10 的第五次：三处 Source catch-all

**为什么**：`inbox.ts:228-234`、`chat.ts:385-386`、`cron.ts:194-196` 都有
"列举已知处置状态 + else 兜底成 accepted/ignored"。**今天对 `lost` 不可达**
（只有 `rule.ts:99` 入队 `trigger` 效果，而规则来源从不调 `receive`；且 `receive` 已不再把 `lost` 当重复），
**但任何未来的 `Disposition` 成员都会走进它们**。这是该族的第五次出现，
而前四次里有一次让**审计记录出现了一句假话**。

**做什么**：把隐式兜底改成**显式 else**：记一行健康问题**点名那个没人处理的状态**、
计入一个**诚实的计数**（不是 `accepted`）、**归档目录同理**——
把一个没被受理的请求归档进 `accepted/` 是**目录在说一句假话，而目录是操作者会去看的**。

**边界**：`src/sources/inbox.ts`、`chat.ts`、`cron.ts`、tests。**可与 W3 并行**（文件不相交）。

**验证标准**：一条测试用一个**伪造的处置状态**驱动每个 Source，断言：
不归档进 `accepted/`、计数不进 `accepted`、健康板有一行点名该状态。
**变异检验**：把显式 else 改回兜底 → 三条都必须变红。

**完成判据**：完整闸门退出码 0；`04-execution-discipline.md` §0.10 的第 4 条从"未修"改为已修。

---

## W7 · 小项打包（各自独立，可穿插做）

| | 项 | 修法 | 验证 |
| --- | --- | --- | --- |
| F4 | `sends.nowhere` 对单向通道单调增长、不说明任何事 | 拆成 `nowhereByDesign`（kind 属单向通道）与 `nowhereUnexpected`；**面板只显示后者** | 一条 session Ticket 结束后前者 +1、后者不变 |
| F5 | `verify-live.sh` 第 4 步把上游 429 当故障（S28） | 按 detail 分类，外部问题打印但放行；**且要求 `at` 在近期**，否则算问题（三小时前的 429 说明的是粘住，不是限流） | 造一条外部问题 → 脚本仍 exit 0；造一条内部问题 → exit 1 |
| F6 | 晚到的跨 Ticket 修正没有回路 | **先做最省的**：面板在 Ticket 详情显示"有别的 Ticket 的产物提到了你"（note 里已明写 id，扫得到） | 用 `real-run-2` 的那份 `04_给搜集信息Ticket的口径修正.md` 当夹具 |
| F8 | `session_bound` 从不写入、assignment 上没有 sessionId | 绑定时写事件并回填（**类型已存在，只缺写入点**） | 一条 Ticket 的事件流里出现 `session_bound`，且 `assignments[0].sessionId` 非空 |
| F9 | `progress.turn` 语义不明（曾是 1、后来 None） | **先查清语义再决定**：补上或删掉。**一个含义不明的字段比没有更坏** | 查到定义它的那行代码，把结论写进 `07` |
| §4.39 | policy 通知彻底放弃的 `notice_lost` 没有测试 | 桩已有 `StubOptions.notify`；**缺的是"`saveSettings` 的策略效果如何到达 `delivery.policyChanged`"这一段**，先查清它 | 一条 policy 通知被放弃 → `notice_lost` 的 detail 里有 `text` |
| 配方 | `08` §8.3 仍写"日常库是 version 1"（**同一句假话的第四 instance**） | 改成实测值，并写明"当时为真" | `grep -c "version 1" docs/v2/08-acceptance-recipe.md` 的命中处都带过期标注 |

---

## W8 · 真浏览器验证回路（最贵，但它是唯一能抓住 CSS 那类缺陷的东西）

**为什么**：`.hidden { display: none }` 被 `#v2-banner { display: flex }` 按特异性压掉，
两条互斥的横幅同时挂在屏幕上几小时，**而 172 条面板断言全绿**——
因为它们断言的是 `classList`，而 **jsdom 不按浏览器的方式计算层叠**。
**是一个真人看页面发现的。**

**做什么**（三选一，按代价）：
1. **每次发布前的人工清单**（最省，立刻可做）：把第 47 轮那 5 项写进 `08-acceptance-recipe.md`，
   发布前由人跑一遍并记录看到了什么
2. **无头浏览器**跑关键路径（截图 + 计算样式断言，例如 `getComputedStyle(el).display === 'none'`）
3. **在 jsdom 测试里断言 CSS 源码的性质**（就像 `.hidden !important` 那条）——
   **最弱，但零依赖**；只对"已知的特异性冲突"有效

**建议 1 + 3 立刻做，2 作为后续**。

**同时**：配方 §6c「一次不顺利的运行」还没有对应的**worker 失败旋钮**
（第 41 轮只有 `StubOptions.notify`）。要让 §6c 可跑，需要给桩加一个让 worker 的模型调用失败的能力——
**那是 W8 的一部分，因为只有它能验 F1/F2/F3 那一族**。

---

## W9 · `tests/http.spec.ts:360` 的时序 flake —— 【工程第 6 轮已关闭，见 §4.67】

**事实**：完整闸门偶发 `expected 'pending' to be 'running'`（Assignment 还没转成就断言了）。
单独跑该 spec **3/3 全过**，完整闸门**重跑即绿**，且当时工作区没有任何与它相关的改动。

**为什么单列一个包**：**它不能靠放宽断言修**。§4.57 记过一个容差范围，
**既没掩盖 flake、又让用例更难解释**——那是这类问题最坏的修法。
正确的修法是让测试**确定性地等到那个转换发生**。

**做什么**：
1. 先查清这条测试现在**靠什么等**：是 `settle(runtime)` 的边界不够（launch 效果在 settle 之后才落地），
   还是它根本没等、只是通常够快
2. 若是前者，**扩 `settle` 的收敛条件**（等到没有 pending 效果且 Assignment 已终态/running），
   **而不是在这条测试里加 sleep**——加 sleep 会让它更慢且仍然偶发
3. **验证方式必须能暴露偶发**：完整闸门**连跑 5 次**都要绿，而不是跑一次绿就算
   （这类缺陷的定义就是"单独跑必过、满负载偶发"，**一次绿什么也不证明**）

**边界**：`tests/http.spec.ts`、`tests/helpers/`（若改 `settle`）。**不改 `src/`**——
目前没有证据说这是产品缺陷而不是测试的等待条件不足；**若查出是产品的时序问题，要另开一个包并重新定级**。

**完成判据**：完整闸门连跑 5 次退出码全 0、测试数不低于 771。

**已达成**（5 次全 0、776 条）。根因是 `nudge` 不等待它请求的那趟 pass（`runtime.ts:667-674`），修法是加一个有界的等条件 helper `untilPass`，**原断言一字未动**。
**竞态类的验收只能是「多次运行 + 结构性论证」，不能是一次变异检验**——移除等待只会让它回到偶发，不是稳定变红。

## 依赖与顺序

```
W0 ──> W1 ──> W2
              │
W3（读 SkillRegistration 后可独立开工，但与 W2 争 sessions.ts，故排在 W2 之后）
W4（独立，随时）
W5（独立，随时；但每次发布前必须跑）
W6（独立，可与 W3 并行）
W7（各项独立，可穿插）
W8（独立，但 §6c 那半需要新旋钮）
```

**建议轮次分配**（每轮一个包，除非注明可并行）：

| 轮 | 做 | 为什么这个顺序 |
| --- | --- | --- |
| 1 | **W0 + W1** | 安全修复不能一直没有测试；W0 是 W1 的唯一前置，同一轮做完 |
| 2 | **W2** | 同一条缺陷的可见性；紧接着 W1 做完，上下文还热 |
| 3 | **W3** | 从真实需求长出来的功能；机制已查明，只剩 rank 语义待核 |
| 4 | ~~**W6 + W4**（可并行）~~ **W4 已于工程第 3–4 轮由主 Agent 关闭**（见 §4.65）；W6 因代理连续死亡改为主 Agent 自做 | 委派不再适用于需要先理解既有语义的改动 |
| 5 | **W5** | 把发布变成一条命令，之后每次发版都不再靠手工 |
| 6 | **W9** | 一个偶发红的闸门会侵蚀退出码的权威，而它是 0.1 的前提 |
| 7+ | **W7 分批、W8** | 小项与最贵的那项 |

---

## 明确不在范围内（不要顺手做）

- **多实例 Source**（决定 D3：一个 kind 一个实例）——这是设计决定，不是欠账
- **给 ready/dropped 路径补 `ended` 事件**——会移动套件里每一条事件序列断言，
  而中断已经由 `turn_ended{reason,error}` + `resumed` 表达两次了（§19 的 F1 更正）
- **预算的硬上限**（自动杀掉一张 Ticket）——本次生产运行证明了长任务是正常的
  （90 分钟、1200 万 token、78 个产物），**杀掉的权力应当留给人**；
  W7 之外若要加，只能是"软上限"：超限 → 记事件 + 上健康板 + 进 attention
- **面板与 API 加认证**——需要先查 DSH 是否提供把插件路由挂到宿主认证之后的能力（**未核实**）；
  在没有这个能力之前，任何"给 myagent 自己加 token"的方案都只是在同一个信任模型里挪动秘密
  （本机进程本来就能读设置文件），**所以要先想清楚它值不值得做，而不是先做**

---

## 每轮的收尾清单（照抄，不要凭记忆）

1. `./scripts/gate.sh`（**完整四步，不加 `--quick`**）→ **读退出码**，不要 grep 输出、不要过 `head`
2. 测试数**不低于**上一轮（当前基线 **771**）
3. `find src tests -name '*.ts' -newer lib/index.js` → **空**
4. 变异检验**至少两处**，且每处都做 0.8 强形式（删断言看会不会绿）
5. 变异还原后**再跑一次完整闸门**（0.2b），并核对哈希与还原前一致
6. 把这一轮写进 `docs/v2/00-audit-and-plan.md`，**包括失败的尝试与错的前提**
7. 若改了发布物：跑 W5 的发布流程，并**从远端核实**（`gh api`，不是 raw CDN）
