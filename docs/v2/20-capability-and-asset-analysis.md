# 能力分析：myagent 提供了哪些 DSH 不具备的东西，以及它临时制造的工具资产值不值得留

**为什么在发布前做这份分析**：一个插件如果提供的东西宿主已经有，它就是在增加攻击面与维护成本；
如果它提供的东西有价值，那价值必须说得清是哪一部分、以及为什么宿主给不了。
第二部分（临时工具资产）是操作者提出的问题，而它有实测证据支撑。

**方法**：能力对照基于 DSH 实际的 bundle 清单（`plugin_manager list_bundles` 的输出，25 个条目、
两百余个 row），不是基于印象。临时工具资产基于 `examples/real-run-*` 里两次真实运行的实际文件。

---

## 第一部分：能力对照

### 1.1 DSH 已经有的（所以 myagent 不提供价值、或只提供边际价值）

必须先把这些说清，否则"myagent 能定时触发"这类话就是虚的：

| DSH 已有 | 来自 | myagent 的对应物 | 判断 |
| --- | --- | --- | --- |
| 定时任务 | `dsh-schedule` | cron 来源 | **重叠**。myagent 的价值不在"能定时"，而在定时产生的请求要**过门禁、成为有授权依据的 Ticket** |
| 后台命令 | `dsh-jobs-local`、`tool-jobs` | `subprocess` 端口（prepare 等） | **重叠**，myagent 只是使用方 |
| 子代理与编排 | `dsh-subagent`、`dsh-workflow-ptc`、`tool-workflow` | worker 会话 | **不同层次**：DSH 的编排是**一次对话内**的扇出；myagent 的 worker 是**独立的、有自己 Ticket 与目录的持久工作** |
| 长时间自主推进 | `dsh-goal`、`dsh-goal-round-driver` | Ticket 的生命周期 | **不同目的**：goal 推进的是"一个会话里的目标"，Ticket 是"一件有起止、有授权、有产物的事" |
| 技能 | `dsh-skill`、`skill-filesystem`、`tool-skill` | 无 | **myagent 缺这个**，而它正是第二部分的答案（见 §2.4） |
| token 计量 | `dsh-token-meter` | `usage`（来自 DSH 的事件） | **myagent 是消费方**，不重复造；它加的是**按 Ticket 归集**与 `windowed` 标记 |
| 会话持久化与查询 | `session-persistence-jsonl`、`session-query-sqlite` | 无 | myagent 不碰，只读 |
| 权限与审批 | `dsh-permission-presets`、`dsh-user-approval`、`dsh-authorization` | `WORKER_PERMISSION` | **myagent 是使用方**，而且用法相反（见 §1.2 第 3 条） |
| 沙箱 | `dsh-sandbox-local`、`dsh-sandbox-policy`、`bash-sandbox` | **未使用** | **这是 myagent 的一个真实缺口**：宿主提供了沙箱，而 worker 拿的是完全访问（`SECURITY.md` 第 1 条） |
| 超时 | `dsh-tool-call-timeout-policy` | Watchdog | **不同层次**：那是单次工具调用的超时，不是对一件长工作的监督 |
| 网页抓取 | `dsh-web-search`、`dsh-web-fetch`、`tool-web` | worker 自己写脚本 | **重叠**——而两次真实运行里 worker 都选择自己写 Python 抓取脚本，**没有用宿主的 web 工具**。这本身值得注意（见 §2.3） |

### 1.2 DSH 没有、myagent 提供的（按价值排序）

**1. 「工作」是一个持久的第一类实体（Ticket）。**
DSH 的基本单位是**会话**（一段对话）。会话没有授权依据、没有结果语义、没有依赖关系、
没有"这件事做完了还是失败了"的终态。`session-query-sqlite` 能查会话，但**查到的不是工作项**。
myagent 的 Ticket 有：身份（由 Trigger 身份纯函数派生）、授权（Mandate）、生命周期与终态、
产物登记、依赖边、以及**一份跨重启存活的追加式事件日志**。
**这是全部其余能力的地基**——没有"工作"这个实体，就没有"工作的授权""工作的失败记录""工作之间的依赖"。

**2. 确定性的授权门禁，且判定可复算。**
每个请求先成为 Trigger，门禁是 **(Trigger, Settings) 的纯函数**，判定结果作为 Decision 存下来。
所以"这件工作当初为什么被允许"是**事后可回答、且可复算**的——改设置不会让旧判定失去意义，
因为判定记的是当时的输入。每张 Mandate 上还盖了 `policyVersion`，
**授权摘要一变，在跑的 Ticket 会收到通知**（第 48 轮实测：只改 `identities` 一个字段就让 `policyVersion` 从
`ad064036…` 变成 `0bafb839…`）。
DSH 的 `authorization`/`approval`/`permission-presets` 管的是**一个在跑的代理能做什么**，
**不管"谁可以发起工作、依据什么"**。这是两件不同的事。

**3. 为"无人值守"设计的执行语义。**
myagent 给 worker **完全访问**，理由恰恰是**没有人在旁边批准**——
一个会被逐次审批打断的 worker 无法完成无人值守的工作。它的边界是**自己的目录**与**自己 Ticket 的结束**。
DSH 的模型是**以审批为中心**的（人在环里）。**这是一种不同的安全姿态，不是更好的**——
`SECURITY.md` 把它写成设计事实而不是缺陷，而风险清单第一条就是"真边界应当是 OS 级的，而 myagent 没有提供"。
**这一条的价值在于它把权衡说清了**，而不在于它更安全。

**4. 多来源进气，且身份必须被映射而不是被推断。**
- inbox：目录里出现一个文件就成为请求（**真边界是那个目录的权限**）
- chat：平台身份**必须经操作者写的映射表**才成为 Actor；**未映射的消息被留住、不消耗**
  （第 38 轮真宿主实测：8 个扫描周期内一字节未动，补上映射后**恰好受理一次**）
- rule：一件工作的结果可以触发下一件（深度受限、超限时留一条持久记录而不是静默丢弃）

DSH 的进气只有两个：**用户**，和**排期**。
**"未映射就留住"这个设计是 P8 的核心**：门禁拒绝会把 Trigger 存成 ignored，
而 Trigger 身份是消息身份的纯函数，所以**那条消息将永远无法被重新评估**——
留住是唯一可逆的答案。

**5. 监督（Watchdog）。**
检测**卡在飞行中的启动**并救援（救援方式是"忘掉 + 重新入队"，因为**打断一个 pending 的 attempt 是空操作**——
这是第 33 轮真宿主验收量出来的，而不是设计时想到的）；检测**静默的 worker**；
**升级到"需要人"**并留下持久的 `escalated` 事件；每轮 pass 限制动作数，超了就明说"需要人"。
DSH 有工具调用的超时策略，**没有对一件长工作的监督**。

**6. 一个"每个副作用都有执行与失败记录"的效果队列。**
重试带退避；`Later` 推迟**不算失败**（这个区分是第 24 轮修的：把"还没到时候"记成"失败了一次"
会让重试预算被无关的等待吃掉）；彻底放弃时**必须留下持久痕迹**——
`launch`/`input` 在 Ticket 上写一份失败报告（可见、可重试、不级联）、
`send` 写 `reply_lost` 事件 + `REPLY-UNDELIVERED.md`（**欠的那句话逐字保留**）、
`notify` 写 `notice_lost`、`trigger` 写一条 `lost` 的 Trigger 行（或退化路径的有界 kv 条目）。
DSH 的 `jobs` 是后台命令，**不是一本带放弃语义的副作用账本**。

**7. 跨 worker 协调必须过单一写者。**
`myagent_note_ticket`（给另一张 Ticket 留言）与 `myagent_read_artifact`（读另一张 Ticket 登记的产物，
**带授权检查**）都经 Engine，所以协调是**有记录的**而不是两个会话私下商量。
第 50 轮的生产运行里这条**真的被用到了**：「信息比对」读了「搜集信息」的产物并合并成综合论述。
DSH 的 `subagent`/`workflow` 协调的是**一次编排内部**的代理，不是**独立排期的持久工作项之间**。

**8. 依赖图与级联。**
下游等上游；上游 `failed`/`dropped` 会级联，而 **`stopped` 刻意不级联**（停止是人的动作，
把它当成失败会级联出一堆没人想要的后果）；有环检测。
DSH 的 workflow 是脚本级的扇出，**不是跨会话的持久依赖图**。

**9. 一个以"工作"为中心的操作面。**
面板显示 Ticket/Work/Project/产物/依赖/健康/丢失的请求，而不是对话列表。

### 1.3 判断：哪些是有价值资产

**真正有价值、且 DSH 结构上给不了的**（按不可替代性排序）：

1. **Ticket 这个实体 + 追加式事件日志 + 单写者 Engine**（§1.2 第 1 条）。
   这不是一个功能，是一个**数据模型**，而 DSH 的会话模型无法表达它。
2. **门禁 + Decision + policyVersion**（第 2 条）。"授权可复算"这个性质在 DSH 里没有对应物。
3. **效果队列的放弃语义**（第 6 条）。**"彻底放弃之后留下什么"这个问题，
   本项目花了六轮才答完**（`notify`/`trigger` 那两个洞是最后补的），
   而答案（进日志、进文件、进 triggers 表，**但绝不写 Decision，因为那会伪造一个从未发生的裁决**）
   是可以直接搬走的设计。
4. **"未映射就留住"这个可逆性原则**（第 4 条）。它来自一个具体的推理：
   身份是纯函数 ⇒ 拒绝会永久烧毁那条消息 ⇒ 所以只能留住。**这条推理对任何"外部请求进入系统"的设计都成立。**

**有价值但形式是文档而不是代码的**：

5. **`docs/v2/` 那 20 份文档**——五态能力标注法、变异检验作为纪律（11 条规则 + 事故对照表）、
   验收配方（每条都写"什么才算证明"）、安全风险清单（**区分真边界与逻辑守卫**）。
   **这可能是整个仓库最可迁移的部分**，因为它与 myagent 无关：它是一套
   "如何让一个代理系统在没有人盯着的情况下仍然可信"的方法。

**价值有限的**：

6. **面板**：只有 jsdom 覆盖，而一个 CSS 特异性 bug 在 172 条断言全绿的情况下活了好几轮
   （第 47 轮，只有一个真人看页面才发现）。**它的质量保证是弱的。**
7. **cron 来源**：与 `dsh-schedule` 重叠，价值在门禁而不在调度。
8. **预算**：只有可见性、没有上限（P6 的已知缺口）。
9. **单实例**（决定 D3）：一个 kind 一个实例，所以"两个平台"这类需求满足不了。

**不是资产、而是负债的**：worker 无 OS 级沙箱（宿主明明提供了 `dsh-sandbox-*`）、
面板与 API 不在宿主认证之后、inbox 身份自述。**这三条决定了它只适合单机单用户**，
而这一点必须写在最显眼处（已在 `SECURITY.md`）。

---

## 第二部分：临时工具资产

### 2.1 实测：它们是什么、有多少

两次真实运行共产出 **22 个 Python 脚本**，全部在各自的 Ticket 目录里：

| | 脚本数 | 体积特征 | 例子 |
| --- | --- | --- | --- |
| `real-run-1-collect` | 14 | 多数 1–3 KB；一个 26 KB | `html2txt.py`(1675B)、`fetch.py`(2807B)、`parse_rss.py`、`gnews_decode.py`、`mk_registry.py`、`mk_appendix.py`(26KB) |
| `real-run-2-compare` | 8 | 明显更大 | **`build_chronology.py`(69,814B)**、`build_exposure_register.py`(16KB)、`fetch_stage3.py`(14KB)、`fetch_legal.py`(14KB)、`html2txt.py`(2044B) |

### 2.2 三条硬证据说明"有可复用价值、但现在完全没被复用"

**证据一：同一个通用能力被独立发明了两次。**
`html2txt.py` 在两次运行里都存在，**内容不同**（1675 字节 vs 2044 字节，`cmp` 判定不相同）。
HTML→纯文本是一个与任务无关的通用能力，而**两个 worker 互相看不见对方的工具**，
所以各写了一遍。**这是重复发明，不是巧合**：两次运行的主题不同（新闻简报 vs 法律年表），
唯一共同的就是"要把网页变成可读文本"。

**证据二：迭代方式是复制而不是修改。**
`mk_news_manifest.py` 与 `mk_news_manifest2.py` 并存（2248B / 2669B）。
一个 `2` 后缀意味着 worker 写了第二版而没有改第一版——**在同一张 Ticket 内部就已经不复用自己的产物了**。

**证据三：被丢弃的东西里有实质性的程序。**
`build_chronology.py` 有 **69,814 字节**——那不是一个小工具，那是一个把一手文件
（DOJ 判决、欧盟措施、CMA 决定、SEC 定期报告）归一成可审计年表的**完整程序**。
Ticket 结束之后它就躺在那个目录里，**没有任何索引、没有任何机制让下一张 Ticket 知道它存在**。

### 2.3 一个附带发现：worker 没有用宿主的 web 工具

DSH 提供 `dsh-web-search`、`dsh-web-fetch`、`tool-web`，
而两次运行的 worker **都选择自己写 Python 抓取脚本**（`fetch.py`、`fetch_legal.py`、`fetch_sec.py`、`fetch_stage3.py`）。

**未核实原因**（需要看那两个会话的记录才能确定），但可能的解释值得记下来：
批量抓取需要**并发、重试、限速、断点续抓、以及把每条来源登记成可追溯的清单**，
而单次 `web_fetch` 工具调用不适合这种形状的工作。
**如果这个解释成立，那它指出的是一个真实的工具缺口**：
宿主给的是"取一个页面"，而研究工作要的是"取三百个页面并留下登记"。

### 2.4 判断与修法

**按可复用性分三类**：

| 类别 | 例子 | 判断 |
| --- | --- | --- |
| **通用、应当成为共享工具** | HTML→文本、限速抓取、RSS 解析、Google News URL 解码、**来源登记表生成** | **有明确复用价值**。其中 `mk_registry.py` / `sources/registry.md` 那一套（279 条登记，每条带 URL 与取回时间）**是最有价值的**——它是"让研究可审计"这个方法本身 |
| **可复用的是模式而不是代码** | `build_chronology.py`、`build_exposure_register.py` | 领域专用（法律事件、风险敞口），但**形状可复用**：抓一手来源 → 抽取 → 归一成带日期的表 → 每条来源登记出处与取回时间 |
| **不可复用** | `mk_appendix.py`、`mk_m8.py` | 某一个交付物的排版脚本，本质是一次性的 |

**结构性结论**：

> **myagent 有产物登记（artifact registry），所以"成果"是可发现、可交叉引用的；
> 但它没有工具登记，所以"方法"完全不可复用——每张 Ticket 都从零开始重新发明工具。**

而**宿主已经有正确的容器**：DSH 的 **skill** 机制（`dsh-skill`、`skill-filesystem`、`tool-skill`）
正是"一个持久的、可被发现的、代理可以加载的能力"。所以修法很清楚：

**建议（未实现，按代价排序）**：
1. **一条"提升为 skill"的路径**：让 worker（或操作者在面板上）把 Ticket 目录里的一个脚本
   提升为一个 skill，于是下一张 Ticket 一开始就有它。**这是把一次性资产变成持久资产的最小改动。**
2. **随 bundle 附几个通用 skill**：至少 HTML→文本、限速抓取、来源登记表三个——
   **它们已经被两次运行各自独立发明过了，这就是需求的证据**。
3. **给 worker 的提示词里加一句**：先看有没有现成的 skill / 共享工具，再决定要不要自己写。
   **这一条已经查实是必要的**：`prompts/` 下两个提示词文件（`worker.md`、`orchestrator.md`）里
   **"skill" 出现 0 次**，而 `worker.md` 对工具的全部表述是
   **"You have three tools, and no others"**（指 myagent 那三个：`myagent_report`、
   `myagent_note_ticket`、`myagent_read_artifact`）。
   **所以 worker 被明确告知的世界里没有"现成的共享工具"这一类东西**——
   它重复发明 `html2txt.py` 不是偶然，而是提示词shape出来的必然。
   （一个细节要诚实说明：preset 里确实装了 `agent-instructions`、`shell`、`tool-fs` 等段，
   而 `dsh-skill`/`tool-skill` 在 dsh-base 里，所以**技能工具本身可能是可用的**；
   缺的不是能力，而是**myagent 从没告诉 worker 去找它**。
   这两者的修法不同：前者要改 preset，后者只要改一句话。）
4. **在 Ticket 结束时问一句"这次写的工具有没有值得留下的"**——
   把复用变成一个显式的决定，而不是一个从不发生的偶然。

**这条为什么值得在发布前写下来**：它是**从真实使用里长出来的需求**，
而不是设计时想到的功能。两次运行、22 个脚本、一个被发明两次的 `html2txt.py`、
一个 69 KB 的程序被丢弃——**这些是数据，不是推测**。

---

## 附：这份分析本身的可核性

- DSH 的能力清单来自 `plugin_manager list_bundles` 的实际输出（25 个 bundle 条目），不是印象
- 脚本清单、体积、以及 `html2txt.py` 两份内容不同，来自对 `examples/real-run-*/scripts/` 的实测
  （`ls -la` 与 `cmp`）
- 两次运行的 token、时长、产物数、事件序列来自第 50 轮对日常宿主的只读查询
- **原先标为未核实的两处，一处已查实**：worker **没有**被告知 skill 的存在
  （`prompts/` 下 "skill" 命中 0 次，且 `worker.md` 明写 "You have three tools, and no others"）——
  见 §2.4 第 3 条。另一处仍未核实：worker 为什么不用宿主的 web 工具（需要看那两个会话的记录）


---

## 3. 追加（第 50 轮）：skill 的加载路径已查实，以及"随包发 skill"卡在哪一步

### 3.1 已确认：worker **有**技能工具，所以那句提示词不是假指令

`src/app/sessions.ts:36` 的 worker 允许工具清单里**含 `'skill'`**，而 `cordis.patch.yml:73-76`
在 worker preset 里装了 `dsh-skill-filesystem` 与 `dsh-tool-skill`。
**所以第 2 部分的诊断是准的：重复发明是纯粹的提示词缺口，不是能力缺口。**
0.1.2 已在 `prompts/worker.md` 加了「Reuse before you build」一节，用两次运行的实测证据说话，
并要求 worker 在报告里点出哪些脚本是通用的——**因为下一个 Ticket 看不见它的目录，
唯一能让它受益的途径是有人把脚本提升成 skill**。

> 先查证再写，是因为这个项目有过教训：**告诉一个会话去用某个它其实没有的工具，是一条假指令**
> （`tests/chat-send.spec.ts:205` 的注释就是这么写的）。

### 3.2 skill 从哪些根加载（权威来源：DSH 源码 `packages/skill/skill-filesystem/src/index.ts`）

模块注释："discovers directory-bundle and flat Markdown skills from **project, custom, and user roots**"。

| 根 | 配置项 | 对 myagent 是否可用 |
| --- | --- | --- |
| **project** | 由工作目录推定 | **不合适**：worker 的 `cwd` 是它那张 Ticket 的目录，所以 project 根的 skill 是**每张 Ticket 一份、随 Ticket 结束而失效**——正好与"可复用"相反 |
| **custom** | **`customSkillDirs?: string[]`** | **这是正确的机制**：显式目录列表，与 cwd 无关 |
| **user** | 由 `dshHome` / `agentsHome` 推定 | 可用但**不该由插件写**：那是用户自己的空间，插件往里放东西是越界 |
| **bundled** | `bundledSkillDir?`，默认取 `$DSH_BUNDLED_SKILL_DIR`，被 `includeDefaultRoots` 门控 | **不可用**：那是 DSH 自己的内置根，第三方 bundle 不该占 |

**结论：随包发 skill 的正确机制是 `customSkillDirs`**——包里放一个 `skills/`，让它指向那里。

### 3.3 卡住的那一步（未解决，写给下一轮）

`customSkillDirs` 是**字符串数组**，而 `cordis.patch.yml` 是**静态 YAML**。
要指向"myagent 自己被安装到的那个目录下的 `skills/`"，就需要一个**运行时才知道的绝对路径**，
静态 YAML 表达不了。三个可能的解法，**都未验证**：

1. **在插件代码里设**：`src/index.ts` 在 apply 时用 `import.meta.dirname` 解析出包内 `skills/` 的绝对路径，
   再通过 ctx 改 `skill-filesystem` 的配置。**需要查**：cordis 是否允许一个插件在运行时改另一个插件的配置，
   以及改了之后 catalog 会不会重扫。
2. **patch 格式是否支持相对模块的路径占位**。**需要查** `packages/boot/plugin-manager/src/patch.ts` 与 loader 语义。
3. **文档化而不自动化**：README 里告诉用户自己把 `skills/` 加进 `customSkillDirs`。
   最省，但**把成本推给用户**，而那正是重复发明会继续发生的原因。

**在查清 1 或 2 之前不要写 skill 文件**：放错位置的 skill 是死文件，而死文件比没有文件更坏——
它让人以为能力已经提供了。**这与"实现了但没有调用者"是同一个陷阱换了一层：这次是"提供了但加载不到"。**

### 3.3b 【第 50 轮已解除】三个候选都不需要——正确的 API 是 `ctx.skills.register`

§3.3 的卡点建立在"skill 只能从目录根加载"这个前提上，**而那个前提是错的**。
`packages/skill/skill/src/index.ts` 是 **provider 注册表**，其模块注释说：
"providers such as `dsh-skill-filesystem` decide where skills come from;
**this service only merges provider catalogs**, resolves the winning skill…"。它暴露两个注册方法：

```ts
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void   // :390
register(skill: SkillRegistration): () => void                                            // :439
```

三条决定性事实：
- **`SkillSource` 里有一个 `'runtime'` 桶**（`:40`）——这就是为运行时注册准备的来源标记
- **skill 可以是虚拟的**：`:58` 写着 "Absolute instruction file path when supplied by the provider;
  **absent for virtual skills**"——正文可以是代码里的字符串，不必有磁盘文件
- **`SkillResourceBase` 可以是 `{kind:'directory', path}`**（`:42-44`），用于让正文解析相对资源，
  而 `path` 可以在运行时用 `import.meta.dirname` 算出来

**所以 myagent 随包发 skill 的正确做法**：在 `src/index.ts` 的 apply 里调
`ctx.skills.register({ …, source: 'runtime' })`，正文内联或指向包内目录；
**不需要 `customSkillDirs`，不需要 patch YAML 表达运行时路径，也不该往 user 或 bundled 根写。**
返回的注销函数要在 `dispose` 里调（与其余资源的生命周期一致）。

**取名要注意 rank**：`BUNDLED_SKILL_RANK = 600`（`:28`），而 "Lower ranks win duplicate skill names
before provider registration order is considered"（`:78`）——**与 DSH 内置同名时谁赢取决于 rank**。
`register` 单个 skill 时的 rank 语义**未核实**（要读 `SkillRegistration` 的定义）。

**下一步（可直接照做）**：写三个 skill——HTML→文本、限速抓取、来源登记表。
**需求证据就是两次真实运行各自独立发明过它们**（`html2txt.py` 两份、1675 与 2044 字节且不相同；
`mk_registry.py` → `sources/registry.md` 279 条登记）。**正文应当从那两个真实脚本里提炼**，
而不是重写一遍——它们被真实工作验证过，而重写会丢掉验证换来的细节（例如限速与重试的实际参数）。

### 3.4 顺带发现的一个验证盲区

改 `prompts/worker.md` 后跑完整闸门：**771 条全绿、而产物哈希没变**。
所以 **`prompts/*.md` 与 `panel/index.html` 一样：随包发布、运行时从磁盘读、但不进 `lib/index.js`**，
而 `scripts/gate.sh` 的新鲜度检查**只 glob `*.ts`**——**这两类文件的改动它都看不见**
（第 46 轮记过面板那一半，这是同一盲区的第二个实例）。

**修法不能照搬 `*.ts` 的规则**：那两类的"最新"判据不是"比 `lib/index.js` 新"
（它们本来就不进 bundle，永远不会比它旧），而是"有没有比上次发布新"。
更实际的做法是让闸门**报告**这两类文件的哈希、由发布流程去比对——
**因为对不进 bundle 的文件，"新鲜度"这个概念本身就不成立。**


### 3.5 【工程第 2 轮】W3 的调查结论：**我给代理的那个前提是错的**，而真正的答案更有用

我在 W3 的派单里说"技能目录里已经出现 `myagent:worker` 与 `myagent:orchestrator`，
所以**已经有某个机制在把这个 bundle 的内容以 skill 形式发布**，先查明它"。
**那个推论是错的**，而代理在死之前查到的九条事实足以证明它错（`/tmp/w3-investigation.md`）：

1. **skill 名字的语法禁止冒号**：`SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`
   （`packages/skill/skill/src/index.ts:21`，导出为 `isSkillName`，`:35`），
   而 `ctx.skills.register()` 对不合法的名字**抛 `invalid skill name`**（`tests/skill.spec.ts:1026`）。
   **所以 `myagent:worker` 不可能是 `ctx.skills` 注册表里的 skill 名**——
   它是**另一个界面的显示串**，或者是某个观察者做的 `provider:name` 拼接。
2. **`skill-filesystem` 要求 YAML frontmatter 带 `name` 与 `description`**
   （`:825` "missing YAML frontmatter"、`:831` "frontmatter requires name and description"、`:835` 名字非法），
   而 `prompts/worker.md` 与 `prompts/orchestrator.md` **没有 frontmatter**（开头就是散文），
   **所以 skill-filesystem 会忽略它们，而不是发布它们**。
3. 本机没有 myagent 的 `skills/` 目录、没有 `~/.dsh/**/skills`、没有 `~/Documents/SA/.dsh`；
   唯一有 skills 目录的是**隔壁那个原型项目**
   （`~/Documents/SA/dsh-superagent-prototype/skills/`，形状是 `<skill-name>/SKILL.md`）。
4. 我在派单里点名的候选（`dsh-harness-dev-context`）**被 grep 排除**：它的 `src/index.ts` 里 "skill" 出现 0 次。
5. 整个 `packages/` 里 `registerProvider` 只有三处
   （`skill-filesystem`、`skill-office/src/index.ts:94`、`sandbox-windows-acl/src/acl-skill.ts:74`），**没有一处与 myagent 有关**。

> **所以我看到的那个带 `myagent:` 前缀的目录，与 DSH 的 skill 注册表不是同一个东西。**
> 它和同一份目录里的 `user-settings:deepseek-llm-api-custom`、
> `deepseek-model-reasoning-effort:deepseek-model-…` 是同一类显示串。
> **它到底由哪个界面拼出来，仍未查明**——但那已经不要紧了，
> 因为**它不是 myagent 可以用来发布 skill 的机制**，而 W3 需要的正是后者。

**而这次调查真正的收获，是把 §3.3b 那个未核实的问题答掉了**：

- **`RUNTIME_RANK = 250`**（`packages/skill/skill/src/index.ts:24`），而 `BUNDLED_SKILL_RANK = 600`（`:28`），
  且 "**Lower ranks win** duplicate skill names before provider registration order is considered"（`:78`）。
  **所以运行时注册的 skill（250）会赢过 DSH 内置的（600）**——
  这意味着 myagent 用 `ctx.skills.register` 发布的 skill 在同名时**优先**，
  取名时**要意识到这一点**（不要无意 shadow 掉宿主的内置 skill）。
- **skill 可以是虚拟的**（`:58` "absent for virtual skills"），
  **所以正文可以是代码里的字符串，完全不需要磁盘文件、也不需要解析任何安装路径**。

**因此 W3 的实现路径现在确定了，而且比我原先设想的简单**：
**用 `ctx.skills.register` 注册三个虚拟 skill，kebab-case 名字，正文内联**——
不走 `customSkillDirs`（那需要一个运行时才知道的绝对路径，而 §3.3 那个"静态 YAML 表达不了"的困难就是这么来的，
**虚拟 skill 直接绕开了它**），不往 user/bundled 根写。
**唯一还要读的是 `SkillRegistration` 的确切字段形状**（`:439` 的参数类型），那是实现时的第一件事。

> **这一轮的方法论收获**：**我给代理的前提是错的，而代理没有照着我的前提做，它去查了语法。**
> 如果它信了我那句"已经有机制在发布"，它就会去找那个不存在的机制、然后照它设计 W3——
> **于是三个 skill 会被放到一个加载不到它们的目录里，成为死文件**（§3.3 警告的正是这个）。
> **这是 0.11 的正面例子：配方（我给的调查方向）被当成结论来用会出事，而被当成假设来查就救回了整件事。**


### 3.6 【工程第 18 轮】W3 的机制全部查实——实现已是机械步骤

§3.5 定下了"用 `ctx.skills.register` 注册虚拟 skill"，本轮把剩下的三个未知全部查实，
**每一条都有 `file:line`**（都在 DSH 检出 `packages/skill/skill/src/index.ts`，除最后一条）：

**1. `ctx.skills` 对插件可用，且 DSH 自己有四处调用点可抄。**
`packages/experimental/creation-recommendations/src/skill.ts:16`、
`packages/experimental/plugin-recommendations/src/skill.ts:34`、
`packages/experimental/skill-badge/src/index.ts:59` 都是 `ctx.skills.registerProvider(() => …)`；
`packages/sandbox/sandbox-windows-acl/src/acl-skill.ts:74` 是 cordis 的 effect 形式
`yield ctx.skills.registerProvider(() => provider)`。
**注意这四处用的都是 `registerProvider`（注册一整个 provider），而 myagent 要的是 `register`（注册单个 skill）**——
后者更省，因为 myagent 不需要"发现"任何东西，它知道自己有哪三个 skill。

**2. `SkillRegistration` 的确切形状**（`:95`）：
`Omit<SkillDefinition, 'invocation' | 'provider'> & { invocation?, provider? }`，
而 `SkillDefinition extends SkillSummary` 且加 `content: string`。所以：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | **是** | kebab-case；`validateRuntimeSkill`（`:741`）用 `SKILL_NAME` 校验，不合语法就抛 `invalid skill name` |
| `description` | **是** | 非空，否则抛 `requires a description` |
| `source` | **是** | 用 `'runtime'`（`:40` 的 `SkillSource` 里有它） |
| `content` | **是** | **正文就是代码里的字符串**——虚拟 skill，`path` 不填（`:58` "absent for virtual skills"） |
| `whenToUse` | 否 | 额外的路由提示 |
| `invocation` | 否 | **省略＝模型与用户两个面都允许**（`:96` 的注释） |
| `provider` | 否 | 省略＝用注册表自己的 runtime provider |
| `resourceBase` | 否 | `{kind:'directory', path}` 或 `{kind:'url', url}`；虚拟 skill 用不到 |

**3. §3.3b 那个 rank 未核实项，答案是"不能设"。**
`rank` 属于 **`SkillCandidate`**（`:78`），**不属于 `SkillRegistration`**。
所以单个 `register()` 调用**无法指定 rank**，注册表内部给运行时 skill 赋 **`RUNTIME_RANK = 250`**（`:24`），
而 `BUNDLED_SKILL_RANK = 600`（`:28`）、"Lower ranks win"（`:78`）——
**即 myagent 的 skill 在同名时会赢过 DSH 内置的**。
**取名因此要带前缀意识**（例如 `myagent-html-to-text` 而不是 `html-to-text`），
**否则会静默 shadow 掉宿主的内置 skill，而没有任何一方会报错。**

**4. 实现清单（机械步骤，不需要再调查）**：
1. 新建 `src/app/skills.ts`，导出一个函数：调 `ctx.skills.register({name, description, whenToUse, source:'runtime', content})`
   并**返回它给的注销函数**
2. `src/index.ts` 的 apply 里调用它，**注销函数交给 cordis 的 effect/dispose**
   （照 `acl-skill.ts:74` 的 `yield` 形式，或照 myagent 既有的 `ctx.effect(() => async () => …)` 形式，见 `src/index.ts:40`）
3. `prompts/worker.md` 的「Reuse before you build」一节**点名这三个 skill**——
   否则"先找现成的"仍然指向空处
4. 正文**从 `examples/real-run-1-collect/scripts/html2txt.py` 与 `real-run-2-compare/scripts/html2txt.py` 提炼**
   （两份独立写的同名工具，1675 与 2044 字节、内容不同），**不要凭想象重写**

**5. 实现前唯一还要解决的是测试装置**：`tests/helpers/host.ts` 的假 ctx 里**未必有 `skills` 服务**，
而断言"skill 进了目录"需要一个能读的目录。**所以第一步是给假 ctx 加一个最小的 skills 记录器**
（照 W0 给 `toolsOf` 加读取口的同一手法：桩本来就 intercept 了 `ctx.tools.register`，
这里要 intercept `ctx.skills.register`），**否则又会写出一条不可能失败的断言**（§4.61/§4.75 那条教训）。
