# 11 · 测试报告

**本文是当前快照，不是"旧报告 + 增补"。** 上一版成文于第 30 轮（631 条），其后挂过一段第 40 轮的增补（723 条）；
两段都已折进正文，本文的每一处数字都是本轮重新量的。

**数据来源**：`/tmp/myagent-gate.log`（最近一次**完整四步** `scripts/gate.sh`，起于 **2026-11-05 02:40:09**）、
`tests/` 目录的逐文件清点、`src/` 的逐点 grep、`docs/v2/00-audit-and-plan.md` §4.25–§4.46 的逐轮记录。

**本轮跑过的命令**（只有这些）：`pnpm typecheck`（退出码 **0**）、
`pnpm vitest run tests/transaction.spec.ts`（**14 passed**，退出码 0，用于 §3 的对账）、
以及对 `127.0.0.1:3080` 的只读 `GET`（带 `x-myagent-request: 1`）。
**没有跑** `pnpm build` / `pnpm check` / `scripts/gate.sh`：闸门含 `pnpm build`，而本轮产物被钉住，重建会移动它。
跑完复算 `shasum -a 256 lib/index.js` = `768a6adb1cfc136cc7d0b0e99578fa047fafc95cb5330e33b2b9943236c7c3e2`、
**320163 字节**、mtime `2026-11-05 02:40:13`，与闸门日志末行逐字一致，**未变**。

**本轮期间这棵树被主代理动过两次**，所以本文的每个数都带**测量时刻**（纪律 §0.9：判据可以长期引用，实例必须带时间戳）：
一次是 02:04 的面板 CSS 修复 + 一条测试（`panel/index.html` 2121 → **2128** 行、127974 → **128775** 字节、sha256 `290eed86…` → **`2fdbfcad0f440318…`**；`tests/panel.spec.ts` 3328 → **3340** 行、185 → **186** 条），一次是 02:40:09 的完整闸门重跑。
**产物哈希在本轮被独立量到四次都相同**（00:5x、01:1x、02:3x、02:4x），而 mtime 动过三次（00:43:54 → 02:04:00 → 02:40:13）——即**重建过两次、内容一次都没变**。按纪律 §0.2b，这本身就是“内容未变、且构建是确定的”的证据：**两次改的都是面板与它的测试，两者都不进 bundle。**

---

## 0. 结论

`scripts/gate.sh` 上一次运行**退出码 0**，四步全过：typecheck ✓ / build ✓ / test ✓ / artifact ✓。
计数行是 `Test Files  33 passed (33)`、**`Tests  760 passed (760)`**，Start at `02:40:09`，Duration 见日志。

**本文先后量到两个权威数，两个都记**：

| 时刻 | 运行 | 计数 | 产物 | 备注 |
| --- | --- | --- | --- | --- |
| **00:43:54** | 完整四步 | **759** | `768a6adb1cfc136c…`（320163 B） | 本文 00:5x–02:3x 期间的权威值；那份日志已被 `: > "$log"` 截断覆盖，但本文在它被覆盖前逐字读过 |
| 02:21:41 | **`--quick`**（两步） | 760 | 同上 | **跳过了 build 与两项产物核对**；本文 02:3x 读到的正是这份日志，并据此发现它只有 `── typecheck` 与 `── test` 两节 |
| **02:40:09** | 完整四步 | **760** | `768a6adb1cfc136c…`（320163 B，mtime 02:40:13） | **本文取这一个为权威** |

差的那一条是 `tests/panel.spec.ts` 的 CSS 断言（§2 的 panel 行）。

**退出码这次可以从日志本身读出来，不再是间接核实。** 上一版报告说"`scripts/gate.sh:82-87` 只把结论 echo 到
stdout、不进 `$log`，所以日志里没有结论行"——**那条陈述已被代码否证**：`scripts/gate.sh:84` 与 `:88` 都是
`echo … | tee -a "$log"`，而 `:88` 那行只在 `[ "${#failures[@]}" -eq 0 ]` 的分支里执行、紧接着就是 `exit 0`。
本轮日志的末三行逐字是：

```
── artifact
── 计数：Tests  760 passed (760)
结论：通过。产物 768a6adb1cfc136c…（320163 字节）
```

**而这一节本轮多了一条，是本文亲手撞出来的**：`--quick` 与完整闸门**写同一个日志文件**（`gate.sh:20`），所以 02:21:51 那次只跑了 typecheck+test 的运行，在日志里留下的也是一行“结论：通过”——**下一个读者会把它当成四步全绿的证据**。本文 02:3x 读到的正是这样一份日志（只有两节），于是主代理在 `scripts/gate.sh:22-25` 把运行方式写成了日志的**首行**：

```
── 本次运行：scripts/gate.sh （2026-11-05 02:40:09）
```

脚本自己的注释逐字写着理由：**“判定权在退出码，但退出码不留痕；留痕的那份东西必须自己说明它验了什么、没验什么。”**
这与纪律 0.1 是同一条规律的第二层：0.1 管的是“别拿一句话当结论”，这一条管的是“**别拿一份不说明自己范围的记录当结论**”。
**`--quick` 跳过的是什么**（`gate.sh:42-44,50-71`）：`pnpm build`，以及两项产物核对——`find src tests -name '*.ts' -newer lib/index.js`（陈旧）与 `grep -q "\.run($version)" lib/index.js`（盖的 schema 版本）。即 `--quick` 的绿灯**完全不含“部署的是这份源码”这一层**，而那一层正是 S32 那次事故的一半（陈旧 7.5 小时、盖的是 schema 1）。

所以"结论：通过"这一行出现在日志里，等价于 `failures` 为空、脚本走到了 `exit 0`。
**限定**：这是从日志正文 + 脚本源码推出的，不是本轮观测到的退出码（本轮被禁止重跑闸门）。

产物身份（只读复算，未重建）：`lib/index.js` = `768a6adb1cfc136c…`，**320163 字节**；
`find src tests -name '*.ts' -newer lib/index.js` → **0 个文件**（本文自己跑的，不是从闸门读的）。
**但这条检查只 glob `*.ts`**，而 `panel/index.html` 在 00:43:54 那次闸门时就已经比产物新——**它不会被标成陈旧**。见 §7 第 12 条。

未处理错误：日志里 `Errors` / `Unhandled` **零命中**（`grep -cE "Errors|Unhandled" /tmp/myagent-gate.log` → 0），
闸门的计数行也只有 `Tests  760 passed (760)`、**没有** `/ Errors N error` 那一段（`gate.sh:81` 抓的是
`grep -oE "Errors +[0-9]+ error"`，抓不到就不打印）。日志里有 **6 条** `MaxListenersExceededWarning`
（`exit listeners` 超过 10 个），不影响退出码。日志里唯一含 `failed` 字样的一行是
`:82` 的一条**测试名**（`✓ leaves a failed report on the Ticket, and the front desk hears about it`），不是失败。

一句话：**就离线证据而言是绿的**。但"绿"的边界在 §6、§7——760 条全部跑在桩宿主上，其中面板那 **186 条**
全部跑在 jsdom 里；真浏览器从未验证过任何面板行为。而 §5 记的是更根本的一条：
**本项目已经有四次"绿着通过的缺陷"**，其中一次至今没补上。

---

## 1. 这个判定是怎么来的：`scripts/gate.sh` 与 S32

绿灯的定义是**退出码**，不是输出里的一句话（`docs/v2/04-execution-discipline.md` §0.1）。
这条规则是从本仓库的真实事故里长出来的：第 11–18 轮**连续七轮**报告"构建干净、567 条全绿"，而实际上

- `pnpm check` 的**退出码一直是 1**：`pnpm test` 在 567 条全过的同时报 **40 个未处理错误**
  （一个 inbox 定时器在 Store 关闭后触发 → `ERR_INVALID_STATE: database is not open`）；
- 发布的产物**陈旧了 7.5 小时**、盖的还是 schema 版本 1：`| head -N` 提前退出触发 SIGPIPE，
  杀掉了 `check` 的最后一步 `build`，而"没看到 `Build complete`"被读成了"构建过了"。

两件事都看不见，因为判定依据是 `grep` 出来的某句话（S32，`docs/v2/00-audit-and-plan.md:882-938`）。
`scripts/gate.sh` 就是把 §0.1 从自觉变成机器强制：每一步单独跑、单独记退出码（不串 `&&`，
因为"还有哪些也坏了"本身是要知道的信息），同时打印测试数与未处理错误数，**任何一步失败就自己 `exit 1`**，
结论行写着"在修好这些之前，不许说全绿"。想知道状态就读它的退出码，不要读它的输出。

它当场就挣回了成本：写好那一轮抓到两个 `pnpm vitest run` 看不见的 typecheck 错误（vitest 剥类型不做检查），
第一次 `exit 0` 是在修掉它们之后。

**S32 的结案状态（第 32 轮的裁定，`00` §4.27）**：`00` §4.15 记"已结案"、`02` §13 记"未结案"，两者各对一半，
因为它们是**两个不同的命题**——**命题 A（40 个未处理错误归零）已证实**；
**命题 B（宿主停止之后没有定时器再触发）在第 32 轮时仍未证实**。
命题 B 此后**被第 33 轮的真宿主验收证实了**：`docs/v2/14-live-acceptance-watchdog.md` 场景 4【实测】
SIGTERM 后 60s 内 sha256 `494b4a14…` 三次采样全同、`94208 1793768020` 全同、目录列表全同
（`-wal`/`-shm`/`.lock` 均未重现）、`lsof` 对 3180 与库文件两次都空。
**但那条证据说的是"产物文件没被写"**，`02b` §3 自己划的界仍然有效：它不等于"那个定时器没触发过"
（触发了但因 Store 已关而抛错、一个字节都没写，也满足这个观测）。本文按这个界写：**A 结案，B 有了正面证据、
但证据的强度止于"无写入"**。

---

## 2. 清单：`tests/` 逐文件

`tests/` 现在是 **35 个 `.ts`、14188 行**：**33 个 spec 文件** + 2 个 helper（本文 00:5x 量到的是 14176 行，差的是 02:04 那一条测试）。
"我数的"一列是对 `^\s*(it|test)(\.\w+)?\(` 的逐文件计数（这个正则**把一处 `it.each(…)` 数成 1 条**，
所以它天然少于闸门报的数，差额在 §3 逐条对清）；"闸门报的"一列取自 `/tmp/myagent-gate.log` 的
`✓ tests/<file> (N tests)` 行。

| 文件 | 行数 | 我数的 | 闸门报的 | 钉住的行为 |
| --- | --- | --- | --- | --- |
| `tests/agent-delivery.spec.ts` | 160 | 12 | 12 | 幂等投递：崩溃后的重试不会把同一份工作交两次，两个去重面（Session 持久历史 / inbox 待领消息）都要覆盖，因为恢复看见前者、活着的 agent 看见后者。 |
| `tests/attachments.spec.ts` | 162 | 11 | 11 | 请求带来的文件在启动前**复制进 Ticket 自己的目录**；复制不了就让 Ticket 失败，而不是让 worker 凭一个已被移走的文件产出看似合理的东西。 |
| `tests/background.spec.ts` | 143 | 16 | 16 | 一次停止究竟停到了什么：shell 作业、子代理、以及一个不肯死的东西不能让其余的继续跑在已撤回的授权下。 |
| `tests/build.spec.ts` | 55 | 4 | 4 | 发布的产物就是这份源码构建的：存在、比每个源文件新、盖的版本号等于 `SCHEMA_VERSION`、不再创建已删掉的表。**其中 3 条是 `it.skipIf(!existsSync(bundle))`**（`:37`、`:45`、`:51`），第 1 条 `:32` 无条件跑——上一版报告说"四条都是 `it.skipIf`"，**与代码不符**。 |
| `tests/chat-contract.spec.ts` | 422 | 24 | **28** | P8 的契约层（第 35 轮 A+B）：第五个 kind 对**每个**调用点可见（门禁按自己的来源走、读 chat 块自己的 `enabled`、pause/deny 不串到别的来源）、身份映射**就是**授权（映射移动 `policyVersion`、note 不移动、顺序无关、映射了也还要过 `allowedSenders`、空 actor 什么都不映射）、旧设置文档照常解析（无 `sources.chat` 键、空文档、没人读的字段被拒、频道缺目录或撞 id 被拒）、`ReplyTo` 活过受理、`Delivery.send` 是端口的一部分而不是对每个实现的要求。**含 `:413` 一处 `it.each` 覆盖五个 kind**（见 §3）。 |
| `tests/chat-send.spec.ts` | 519 | 12 | 12 | P8 的发送路径（第 36 轮 C2）：Runtime 真挂载 ChatSource 后一张消息变成 Mandate 写着来源的 Ticket、未映射被留住而补映射后同一份文件恰好受理一次、回复带着 Trigger 上的地址与 worker 自己的话出门并消费掉效果行、`blocked` 的问题回到频道且不带只有 myagent 前台才看得懂的指令、同样的话只排一次而不同的话排两次、Source 拒绝时效果行留着并按行计失败并在板上点名、**彻底放弃时在 Ticket 的日志与目录里各留一处痕迹且都比健康板活得久**、地址指向一个只产出的 Source 时失败而不是去调不存在的东西、无 `replyTo` 时不抛不发只计数、从没配过 chat 的部署照常跑其余来源。 |
| `tests/chat.spec.ts` | 451 | 13 | **14** | P8 的聊天 Source 本体（第 36 轮 C1）：已映射身份的消息变成 actor 为映射名、kind 为 person、via 为 chat、带频道回复地址的 Trigger；未映射的**什么都不产出、文件留在原处、板上说清有几条在等**；补映射后同一条消息**恰好一次**被受理；停用的频道连看都不看；produce 侧 paused/deny（**含 `:235` 一处 `it.each` 两个旋钮**，见 §3）；同一条消息扫多少次都只有一个 id；两个频道的消息、身份与回复地址互不串；`deliver` 写出的回复文件名是内容的纯函数所以重试不重复；频道消失或停用时用点名那件事的错误码拒绝；**谁都能写的频道目录**要带模式与补救办法报出来、且在一轮也取走了消息的 pass 里存活；还在写的那条留给下一次轮询；Source 自己关着时什么都不做。 |
| `tests/delivery.spec.ts` | 115 | 10 | 10 | 一份 Report 出门时变成什么（标题、转述文本、`RESULT.md`），以及状态目录上的单写者锁。 |
| `tests/dependencies.spec.ts` | 116 | 5 | 5 | 一张 Ticket 等另一张：等待用 `Later` 表达而**不是**失败；边与它的日志写在同一个事务里、成环被拒。 |
| `tests/deployment.spec.ts` | 131 | 10 | 10 | 部署配置：路径展开、`DSH_HOME`、`machineOf`，以及人写错一个路径时错误必须**点名那个设置**。 |
| `tests/effects.spec.ts` | 269 | 16 | **16** | 效果队列的保证，带具体数字：退避、跨重启存活、不发生两次、永不停止的重试与静默放弃都不允许，`Later` 被**抛出**时同样算数；**以及第 43 轮加进来的那条：一轮安静的 pass 会把上一轮的抱怨清掉，而一个仍在排队的失败不会**（`effects.ts:156-163` 的 `summarize()` 守卫）。上一版记 15 条，现在 16 条。 |
| `tests/engine.spec.ts` | 965 | 72 | **72** | 领域规则本体（跑在 `Memory` 上）：受理、门禁、报告、停止、重试、策略变更、产物登记、事务回滚不留痕、级联结束、Project/Work 归类、协作通道、产物引用授权，以及第 40/44 轮加进来的 `notice_lost` 与 `lost` 处置（`:947`、`:961`、`:96`、`:117`）。上一版记 68 条。 |
| `tests/executor.spec.ts` | 679 | 26 | **26** | 执行器自己的规则：并发上限与排队、暂停无损、prepare 命令的失败可见、卡在飞的 launch 仍被计数（`:503`）、分层上下文、Input 署真名、**改 `watchdog.everyMs` 在保存那一刻就生效而不是等旧网格的下一跳（`:623`，走 `runtime.saveSettings`）**、**worker 报完之后槽位计数立刻归零且健康板上不再有那句会过期的 gauge（`:653`、`:673`，S38）**。上一版记 24 条。 |
| `tests/fault-injection.spec.ts` | 524 | 10 | **10** | 第 41 轮起的新套件：真跑队列（重试预算 5 与 15/30/60/120s 退避都是 Runtime 自己的，不是测试设的）把 `notify` 与 `trigger` 两种效果**一路失败到彻底放弃**，然后断言留下的痕迹——`notice_lost` 带着本来要说的话、比健康板活得久、跨重启还在；一个被放弃的 `trigger` 变成 `triggers` 表里的一条 `lost` 行（有 error 与 effect key、**没有 Decision**）、读不出的载荷变成有界文本而**不在 triggers 表里造一个叫 "lost" 的来源**、同一个失败效果被放弃两次只写一行、`lost` 行**不算重复**所以门禁会重跑、写丢失记录本身失败时这一轮 pass 不被带走；以及 `launch` 彻底放弃后 Ticket 上留着失败报告而前台确实听到了。 |
| `tests/files.spec.ts` | 219 | 15 | 15 | 面板读 Ticket 目录：`resolveInside` 的越界守卫（`../` 与绝对路径）、文本判定、大小上限、文件与 progress 路由。 |
| `tests/flow.spec.ts` | 585 | 23 | 23 | 离线全链路：inbox 文件 → Ticket → 带提示词与报告工具的 worker Session → `RESULT.md` + 前台通知 → 一个问题变成回到**同一个** worker 的答案。 |
| `tests/http.spec.ts` | 857 | 45 | **45** | HTTP 面（操作者看这个无人值守系统的唯一窗口）：同源围栏、路由契约表、领域拒绝 → 状态码与人能照做的措辞、`policyVersion` 出口、**chat 在 `state` 上的四个事实（`:567` 点名被留住的身份并把已映射的排除在外、`:589` 说清健康行没点名的还有几个、`:611` 区分"没在看"与"队列是空的"、`:633` 直接答门禁会用的策略而不是让页面自己推回落）、`:651`/`:670` 那个此前完全没有出口的回复计数、以及 `:700` 起的「队列放弃过的请求」一组 7 条（含 `:794` 那条"列出每一条而不是最新的窗口"）**。上一版记 32 条。 |
| `tests/mount.spec.ts` | 117 | 7 | 7 | 挂载期一个 bundle 允许对宿主做什么：不碰 Session、`apply` 永不 reject、停止被包住。 |
| `tests/notify-machine.spec.ts` | 338 | 16 | 16 | 桌面通知：真跑子进程读它被要求显示什么，以及通知被拒绝不能带走投递自己的结果。**仅 POSIX**（按 `:` 切 `PATH`）。 |
| `tests/notify.spec.ts` | 187 | 9 | 9 | 一张结束的 Ticket 留下的记录（`RESULT.md`、前台通知）、设置变更对在跑工作的影响、以及写不出记录时仍要通知。 |
| `tests/panel.spec.ts` | **3340** | **186** | **186** | 面板页面**本身**在 jsdom 里执行：渲染、每 3 秒轮询不吃掉操作者刚输入的东西、后端旧于页面时的能力探测与横幅、转义、工作页、详情页四个 V2 区块，以及第 37 轮的聊天卡（未映射等待队列的 7 种状态、身份映射的增删改与二次确认、页头 `#chat-waiting` 药丸）与第 45–46 轮的「丢失的请求」区块（两条路径分开呈现、`#lost-count` 药丸、bundle 答不出来时隐藏并说清"读不到"不等于"没有丢失"）。上一版记 146 条。 **第 186 条是本轮 02:04 加的，而它是这一整节里最值得单说的一条**：它钉的是 `.hidden { display: none !important }`（`panel/index.html:85`），而那行 CSS 上方的注释（`:83`）逐字写着 “**Found only by a person looking at the page.** Every other `.hidden` user is class-styled, so this also protects the …”。即**这条规则此前只有一个人看着页面才能发现**，现在有一条 jsdom 断言钉住它——而 **jsdom 的 CSS 层叠与真浏览器不是一回事**，`!important` 的优先级恰恰是层叠的一部分（§7 第 1 条）。上一版记 146 条，本文 00:5x 记 185 条。 |
| `tests/policy.spec.ts` | 362 | 34 | 34 | 门禁与策略版本：每个 Trigger 都过 `gate`，每张 Mandate 都带着产生它的那个版本；deny 与 enabled 是两件事；系统 actor 要过两道关。 |
| `tests/prompts.spec.ts` | 79 | 8 | 8 | 提示词：随包发出的文本、操作者的覆盖与冲突、以及找到这个包自己 ship 的文件。 |
| `tests/recipes-route.spec.ts` | 62 | 4 | 4 | recipes 路由：面板的模板选择器读的与人手抄的是**同一份文件**。 |
| `tests/recipes.spec.ts` | 168 | 9 | 9 | 两个入门配方对着真 schema 与真门禁跑一遍：烂掉的配方比没有更坏，因为它看着能抄。 |
| `tests/recovery.spec.ts` | 210 | 7 | 7 | 重启后看见什么、怎么办：接管 worker 随进程死掉的 Assignment、重放排队但从未启动的 launch、不复活已结束的 Ticket。 |
| `tests/sources.spec.ts` | 910 | 42 | 42 | 产生 Trigger 的来源（inbox 目录 / cron 排期 / 规则）：重入闩不孤儿化 Source、deny 与 pause 无损、深度守卫留下持久记录、健康板不擦自己的告警、inbox 目录权限自检。**第 44 轮修掉了其中三处 flaky**（`:273`、`:296`、`:312` 原来断言 `toBeGreaterThan(Date.now())`，跨分钟边界就随机变红；改成与各测试体开头读的 `clockBefore` 比较，性质未削弱）。 |
| `tests/store.spec.ts` | 450 | 27 | **27** | SQLite 单写者：领域记录、效果队列、设置、KV、`SchemaTooNew` 拒绝打开一个更新的库，以及第 44 轮加进来的有界 `kv` 条目（`pushLostPayload` / `lostPayloads`，`LOST_TRIGGER_KEEP=20`、`LOST_TRIGGER_CHARS=1000`）。上一版记 24 条。 |
| `tests/timing.spec.ts` | 130 | 22 | 22 | cron 的定时：解析、下次运行、时区缺口与重复。 |
| `tests/tools.spec.ts` | 356 | 22 | 22 | 工具面：拒绝要说清下一步而不是把栈扔给模型；schema 要挡住会产生没人要的工作的参数。 |
| `tests/transaction.spec.ts` | 175 | **7** | **14** | 事务契约，同一组断言对 `Memory` 与 `Store` **各跑一遍**（`:62` 的 `for`，见 §3）。 |
| `tests/views.spec.ts` | 168 | 13 | 13 | 面板与工具共读的那个 JSON 形状，逐字段钉住。 |
| `tests/watchdog.spec.ts` | 217 | 11 | **11** | Watchdog 的判断（只用别人已有的动作）：卡在启动、静默多久、达到上限后说"需要人"、关掉时两个探测器都不调、改间隔不重启即生效（`:142`），**以及第 34 轮 N8 的两条：升级作为一条持久记录到达宿主、措辞与板上那句逐字相同（`:179`），静默 worker 那条升级路径也记（`:203`）**。上一版记 9 条。 |
| `tests/helpers/host.ts` | **509** | 0 | — | 不是测试：DSH 宿主的替身，记录系统发出的每个调用，好让测试既能断言发生了什么、也能断言**没碰什么**。第 41 轮给它加了 `StubOptions.notify = { fails, error? }` 与 `host.refusals`（故障注入的旋钮与它自己的凭证），上一版记 429 行。 |
| `tests/helpers/deployment.ts` | 38 | 0 | — | 不是测试：用桩宿主搭一整个部署（真文件系统上的 `stateDir`/`inbox`/`work` + 真 SQLite + 真锁），flow/http/panel/executor/chat-send/fault-injection 都从它起步。 |

**合计：33 个 spec 文件，我数到 748 个 `it(`/`it.each(`；闸门报 33 个文件、760 条。**

---

## 3. 对账：748 与 760

差 **12**，来自**三个**文件，而且三处都是**设计如此**：写下来的 `it` 比跑起来的少，因为一处被复制、两处被展开。

| 文件 | 我数的 | 闸门报的 | 差额从哪来 |
| --- | --- | --- | --- |
| `tests/transaction.spec.ts` | 7 | 14 | **+7**。7 条断言全写在 `for (const implementation of implementations)` 里（`tests/transaction.spec.ts:62`），对 `Memory` 与 `Store` 各跑一遍 → 7 × 2 = 14。**本轮单独跑过确认**：`pnpm vitest run tests/transaction.spec.ts` → `✓ tests/transaction.spec.ts (14 tests)`，退出码 0。 |
| `tests/chat-contract.spec.ts` | 24 | 28 | **+4**。23 条普通 `it(` + **1 处 `it.each`**（`:413`，`['rule', 'chat', 'session', 'inbox', 'cron']` 五个 kind）→ 23 + 5 = 28。我的正则把 `it.each(` 数成 1 条，所以少 4。 |
| `tests/chat.spec.ts` | 13 | 14 | **+1**。12 条普通 `it(` + **1 处 `it.each`**（`:235`，`paused` 与 `denied` 两个旋钮）→ 12 + 2 = 14。 |
| 其余 30 个文件 | **724** | **724** | **逐个相符**（其中 `panel.spec.ts` 本轮由 185 变 **186**） |
| 合计 | **748** | **760** | **+12** |

**上一版的差额是 7、且全部来自 `transaction.spec.ts`；这一版是 12、来自三处——而差额在本轮 00:5x 与 02:4x 两次测量里都是 12**（747/759 与 748/760），即**新加的那一条测试是普通 `it(`，没有改变对账的形状**。
增量不是"数错了"，是套件里多了两种把一条 `it` 变成多条的写法（`it.each`），而我用的正则对它们是盲的。
这正是"对账"这一节存在的理由：**差额必须能逐条归因，归不了因的差额就是没数清。**

- **没有** `it.skip` / `it.todo` / `it.only` / `it.fails` / `describe.skip`（`grep -rnE '(it|test|describe)\.(skip|todo|only|fails|concurrent)' tests/` → **0 命中**）。
  `tests/panel.spec.ts:13` 的头注释明写 "Nothing here is marked `it.fails`"——**本轮复核仍然为真**。
- **`it.each` 两处**（上表）、**`it.skipIf` 三处**，全部在 `tests/build.spec.ts:37,45,51`，条件是 `!existsSync(bundle)`。
  产物在（320163 字节），所以三条都跑了（闸门报 4，含 `:32` 那条无条件的）。
  产物若不存在，它们会**静默跳过**而不是变红——那时闸门会报 **757**。
  这条弱点的实际表现**未核实**：核实它需要移走 `lib/index.js`，而本轮不许动产物。
  **上一版说"四条都是 `it.skipIf`"，与代码不符**（`:32` 是无条件的 `it(`）。

---

## 4. 变异检验：哪些修复是"撤掉就变红"证明过的

判据是纪律第 3 档的验证标准（`docs/v2/04-execution-discipline.md`，第 3 档"先审计现状、定义不变量与失败条件"）
与 §0.8：**新测试必须经过变异检验——把修复撤掉，测试立刻变红；变异不红就改测试直到它红，
而不是把这条变异记成"已检验"。**

上一版列了 11 处，并明写"总数本文不再声称"。本轮把 §4.29–§4.46 逐条核对后**给出总数**：
**文档里写明"经变异检验"的一共 49 处，分 25 个条目**——第 32 轮及以前 11 处，第 33–46 轮新增 38 处。
下表每行一个条目；"条数"是该条目里**文档点名的**变异个数。

### 4.1 第 32 轮及以前（11 处，与上一版一致，行号已按当前树复核）

| # | 出处 | 它守的修复 | 撤掉什么会变红 | 钉住它的测试 |
| --- | --- | --- | --- | --- |
| 1 | `00:146` | S8：事件必须在**提交后**发布 | 把 `emit` 改回事务内直接发布 | `tests/engine.spec.ts:638` `it('publishes nothing for a command whose transaction rolled back')`、`:649` `it('holds a nested command’s events until the outer transaction commits')` |
| 2 | `00:197` | S11：`report()` 只接受 running 的 Assignment，`gaveUp` 走独立命令 | 把 `?? (systemGaveUp ? latestAssignment(ticket) : undefined)` 改回 `?? latestAssignment(ticket)` | `tests/engine.spec.ts:541` `it('refuses a worker report for an attempt that never started, and leaves the Ticket alone')`、`:553` `it('still records the system giving up on an attempt that never started')` |
| 3 | `00:270` | S19：超出地平线的排期不再凭空造时刻；扫描末尾不擦自己的告警 | 恢复"造一个一分钟后的假 slot" / 恢复无条件写摘要 | `tests/sources.spec.ts:430` `it('fires the real slot once and then stops, instead of minting a Ticket a minute')`、`:451` `it('keeps the alarm it raised, instead of clearing it with its own summary line')` |
| 4 | `00:425` | S7：`Memory` 与 `Store` 的事务语义统一成一份契约 | 把 `Memory` 改回"只在 depth 0 快照" | `tests/transaction.spec.ts:103` `it('undoes only the inner writes when a nested transaction fails and the outer swallows it')`——它变红而 `Store` 那组仍绿，正说明契约咬得住 |
| 5 | `00:601` | 级联取消（第 10 轮） | 去掉 `failTicket` 里的级联调用 | `tests/engine.spec.ts:719` `it('ends what waited on a Ticket that failed, and says which one it waited on')`、`:733` `it('keeps the difference between "it failed" and "there was nothing to do"')` |
| 6 | `00:668` | §4.10：报告按 `assignmentId` 归属 | 把过滤改回 `runningAssignment(ticket)` | `tests/engine.spec.ts:514` `it('stops offering a retry once the replacement attempt is running and has said nothing itself')` |
| 7 | `00:921` | S32 的真 bug：`SourceRegistry.sync()` 的重入闩 | 撤掉重入闩 | `tests/sources.spec.ts:748` `it('orphans nothing: every Source it started is one it can stop')` |
| 8 | `00:1093` | N5：深度截断写进上游 Ticket 的日志（`rule_stopped`） | 去掉那行日志写入 | `tests/sources.spec.ts:792` `it('leaves a durable record on the Ticket whose ending stopped it')` |
| 9 | `00:1156` | S36：`escapeText` 真的转义，且文本节点那六处**不再**转义 | 把 `escapeText` 改回 `String(text ?? '')` | `tests/panel.spec.ts:2586` `it('shows a state directory as text rather than as an element')`（`:2602` `it('leaves an ampersand alone where the text node already does the escaping')` 守反方向） |
| 10 | `00:1168` | N1 + N3：`rescueStuckLaunch` 只重新入队，**不再删** `starting` | 把 `starting.delete` 加回 `rescueStuckLaunch` | `tests/executor.spec.ts:503` `it('keeps counting the launch as starting, so it stays visible and still holds its slot')` |
| 11 | `00:1105` | N2 的**第一次**修复：`refresh()` 调 `watchdog.settingsChanged()` | —（文档记为经变异检验，未写出撤掉哪一行） | `tests/watchdog.spec.ts:142` `it('takes effect without a restart, and does not push the next look further away')` |

> **第 11 条必须与第 12 条一起读。** 它守着的那条测试**今天仍然直接调 `watchdog.settingsChanged()`**
> （`tests/watchdog.spec.ts:160`、`:165`），也就是说它测的是"调用这个方法会重新上膛"，
> **不是"改设置会调用这个方法"**。第 33 轮的真宿主验收正是**证伪**了后者
> （`00` §4.29：三条路径同时关闭，检测延迟 34.729s 对 15s 阈值）。
> 一句留在 `00:1806-1809` 的话值得原样引：**"一个修复的测试必须覆盖'谁会触发它'，而不只是'它被触发后做什么'。"**

### 4.2 第 33–46 轮新增（38 处，14 个条目）

| # | 轮次 / 出处 | 它守的修复 | 撤掉什么会变红 | 钉住它的测试 | 条数 |
| --- | --- | --- | --- | --- | --- |
| 12 | 第 33 轮 / `00:1816` | **N2 的第二次修复**：`watchdog.settingsChanged()` 直接从 `saveSettings()` 调（`src/app/runtime.ts:578`），不再只挂在 `refresh()` 上；并暴露只读诊断 `Watchdog.armedInterval()` / `Runtime.watchdogArmedInterval()` | 从 `saveSettings` 里去掉那行调用 | `tests/executor.spec.ts:623` `it('takes effect on the save itself, not at the next tick of the old grid')`——它走的是**真接线**（`runtime.saveSettings(...)` → `runtime.watchdogArmedInterval()`），所以撤掉那行会红 | **1** |
| 13 | 第 34 轮 / `00:1861` | **N8**：升级进事件日志（`WatchdogHost.escalate` + `Engine.watchdogEscalated`，新事件类型 `escalated`，`by={system,watchdog}`），**卡住的启动与静默的 worker 两处都写**；且 `escalated` 不计入 `actionsTaken` | 移除那两处调用 | `tests/watchdog.spec.ts:179` `it('reaches the host as a durable record, with the same words the board shows')`、`:203` `it('records the silent-worker escalation too, which is the other way in')`（两条都断言 `acted` 仍是 `false`） | **1**（覆盖两个调用点） |
| 14 | 第 35 轮 / `00:1938` | **P8 任务 A+B**（契约层：`chat` kind、`ReplyTo`、`Delivery.send?`、`TwoWaySource`、`sources.chat` 设置块） | 子代理自报"每条都变红、还原后产物哈希逐字回到原值（`sha256 -c` 通过）" | 主要在 `tests/chat-contract.spec.ts`（28 条） | **6**（我只要求 3 条）。**每条变异的具体内容文档没有逐条列出 → 未核实**；核实它需要读那个子代理的原始汇报，而它没有落盘到 `docs/` |
| 15 | 第 35 轮 / `00:1978` | **第四处 `enabled` 缺口**：`authorizationShape` 里 `cron`/`inbox`/`session` 各自硬编码 `enabled`，后加入的 kind 只出现在派生的 `perSource` 条目里、而那里不带 `enabled` → 停用 `rule`/`chat` **不移动 `policyVersion`**。修法是放进**派生的**条目 | 移除那行 `enabled` | `tests/chat-contract.spec.ts:413` `it.each(['rule','chat','session','inbox','cron'])('moves policyVersion when %s is toggled')`——**五条全红**。（第一版测试对每个 kind 硬设 `enabled: false`，而 `chat` 默认就是 `false`，于是"停用 chat"是空操作、断言以"修复无效"的样子失败；改成**翻转当前值**才对五种默认值都成立） | **1**（一处修改、五条测试） |
| 16 | 第 36 轮 / `00:2009`、`:2042-2047` | **P8 任务 C1**（`src/sources/chat.ts` 本体 + `tests/chat.spec.ts`） | 其中第三条是"把 `Date.now()` 混进回复文件名的 key"——**最初是绿的**，因为两次投递落在同一毫秒、扰动没有可观测后果；实现者没有收手，而是把测试加强到两次投递间隔 5ms（并写明理由：效果队列的重试发生在退避之后，绝不会在同一瞬间），之后变异**变红** | `tests/chat.spec.ts`（14 条），其中 `:327` `it('writes the reply as a file whose name is a pure function of what it carries, so a retry does not duplicate')` | **3**（另两条的具体内容文档未逐条列出 → 未核实） |
| 17 | 第 36 轮 / `00:2087-2099` | **P8 任务 C2**（发送路径：`send` 走效果队列、彻底放弃时的两处痕迹 `reply_lost` + `REPLY-UNDELIVERED.md`） | 文档点名的四条：**M1** 把 `Date.now()` 放进 `sendKey`（它显式复核了 C1 那条教训：在 M1 就位时**删掉那个刻意的 5ms 间隔，测试仍然变红**，因为两次调用之间的 Store 写入本身就越过了毫秒 → 间隔是双保险而不是承重结构）；**M2** 把 `send` 改成内联 → **4 条变红 + 3 个未处理错误，而 happy-path 测试仍然是绿的**；**M7** 覆盖 `reply_unreceivable`（此前三条测试都碰不到它）；**M8** 靠一条**字面量**的 `readdirSync` 断言抓住文件名（此前测试 import 了 `UNDELIVERED_FILE` 常量，改个名字两边一起动就测不到文件名了） | `tests/chat-send.spec.ts`（12 条），其中 `:277` `it('records a give-up in the Ticket's log and its directory, and both outlive the health board')` | **8**（M1–M8；M3–M6 的具体内容文档未逐条列出 → 未核实） |
| 18 | 第 37 轮 / `00:2191-2195` | **P8 任务 D**（面板聊天卡 + `state.chat` + `counts.sends` 出口，不新增路由） | **M1** 最初只让**两条等待测试中的一条**变红——另一条的 fixture 里没有已存储的 chat Trigger，所以 `countBySource()` 没有 chat 行、`sourceStatus()` 恰好把 Source 自己的 counts 透传了过来，**fixture 在无意中帮忙**。补了一个已映射的消息（真实部署的状态）后重放 M1 → **2 条红** | `tests/http.spec.ts:567`、`:589`、`:611`、`:633`、`:651`、`:670`；`tests/panel.spec.ts:2614` 起 `describe('the chat Source')` 一组 | **5**（只有 M1 被逐条描述；M2–M5 → 未核实） |
| 19 | 第 37 轮 / `00:2207` | **结构化的 `waiting()` 读法**：`ChatSource.waiting()` 返回 `{count, ids, more}`，与健康句在同一处、由同一组值组成；`http.ts` **优先**用它，正则退为"Source 不提供 `waiting()` 时"的路径。修的是"改一句英文健康文本就能静默清空面板上的等待队列、而消息还在磁盘上" | 让 `waiting()` 永远返回空 → **2 条测试变红**（所以这条路径是承重的、且已被覆盖，不是死方法） | `tests/http.spec.ts:567` `it('names the identities whose messages are being held, and leaves the mapped one out')`、`:589` `it('says how many identities the health line did not name, rather than cutting them off silently')` | **1** |
| 20 | 第 39 轮 / `00:2321` | **S38**：`health.executor` 那句 `"1 of 2 worker slots in use"` **被删掉**，而不是让它每轮更新。决定性证据是 `grep -rn "worker slots in use" tests/ panel/index.html` → **零命中**：那句话没有任何读者。连带的新语义是 `health.executor` 条目惰性创建 → **健康跑的时候这个条目根本不存在** | 把那句 gauge 加回去 → 新测试立刻变红 | `tests/executor.spec.ts:653` `it('is zero as soon as the worker has reported, and the board carries problems only')`，其中 `:673` 是 `expect(state.health.executor).toBeUndefined()` | **1** |
| 21 | 第 40 轮 / `00:2344` | **`notice_lost`**：`notify` 彻底放弃后在 Ticket 的事件日志里留一条持久记录（新事件类型 + `Engine.noticeLost`，`by={system,delivery}`，detail 带种类、状态、错误原文与**本来要说的那句话**截到 400 字） | 去掉那行 `record` → 变红 | `tests/engine.spec.ts:947` `it('is recorded on the Ticket, with what was going to be said')`、`:961` `it('refuses to invent a Ticket that does not exist')` | **1** |
| 22 | 第 41 轮 / `docs/v2/17-fault-injection.md` §6 | **故障注入基础设施 + `notify` 那半的欠账**（`StubOptions.notify = {fails, error?}` 注入在桩 agent 的 `inject`/`followup`——`src/` 里仅有的两个调用点 `agent-delivery.ts:107-108`，所以队列真实的 5 次重试 / 退避 / 放弃路径原样跑过） | **M1** `runtime.ts` 的 `kind === 'notify'` → `'MUTATION-M1-notify'`（等于撤掉第 40 轮那段接线）→ **2 红**（另 4 条绿是**对的**：瞬时那条断言的是事件**不存在**）；**M2** 删掉 `text:` 那一段 → **2 红**，两处都只红在 `- "text": "写好了 digest.md"`；**M3** 把旋钮弄哑（`host.ts:331` 的 `budget.left <= 0` → `>= 0`）→ **3 红**，然后按 0.8 追一层（见 §5 第 2 条） | `tests/fault-injection.spec.ts:93`、`:147`、`:184` | **3**（`17` §6 逐条列了 M1–M3，并写明"全部已还原"、`src/app/runtime.ts` 的 sha256 开工前与还原后都是 `75d13aba…`、`grep -rn MUTATION src tests` → 0 命中） |
| 23 | 第 43 轮 / `00:2580`、`:2593`、`:2619-2624` | **缺陷 (2)**：`effects` 与 `delivery` 两个健康条目**永远回不到 ok**（`record()` 是唯一能清掉问题的东西，而它从不在这两个条目上被调用）。修法是 pass 级 `complained` 标志 + 每轮说一句"没问题"，**并补了一个我没规格出来的守卫**：`summarize()` 在它抱怨过的任何一行**仍然 pending** 时也提前返回（`src/app/effects.ts:156-163`）——否则一次失败把行推迟到 15s 退避之后，下一轮 pass 什么都 claim 不到、于是"安静"，**把一个永久的假警报换成一个假的"一切正常"** | **M1** 去掉那个 pending 守卫 → **5 条既存测试变红**（"所以这不是品味，是承重的"）；**M2** 让 pass 从不做摘要；**M3** 见 §5 第 3 条；**M4** 去掉 `delivery` 的标志 → 以 §4.38 的确切 signature 变红（`expected '' to contain 'RESULT.md'`），证明 `delivery` 的边界只能是"一次投递"而不是"一轮 pass" | `tests/fault-injection.spec.ts:93`（名字已改成 `…the event outlives the health line the next pass clears`）、`:147`（`…while the health line is erased by the next quiet pass and by the restart itself`）、`:184`；`tests/notify.spec.ts` 那条钉住 `Could not write RESULT.md …` 要跨 pass 存活的 | **4**（M1–M4） |
| 24 | 第 44 轮 / `00:2700-2704` | **`lost` 处置状态**：`trigger` 效果彻底放弃后在 `triggers` 表插一行 `disposition={state:'lost', error, effectKey}`（**不写 Decision**，因为门禁从未跑到裁决，写一条等于伪造一个从未发生的裁决；`receive` 在一个事务里，抛出会把 Decision 一起回滚）；读不出的载荷走**退化路径**，存进有界的 `kv` 条目而**不进 `triggers` 表**（否则面板会出现一个叫 "lost" 的来源，那是关于"工作从哪来"的一句假话）；以及它自己枚举消费者时抓到的真错——**`receive` 把已存的 `lost` 行当作 `{stored:'duplicate'}` 返回**，与事实完全相反 | **M1**：在缺陷完全活着的情况下，**删掉那条重写测试里的"行存在"与"进气计数"两条断言，测试就变绿了**——因为它其余的断言（健康行被清、无 Decision、无 Ticket）**在一个什么都不写的系统里也全部成立**。只有那两条是承重的守卫 | `tests/fault-injection.spec.ts:241`、`:321`、`:363`、`:402`、`:437`；`tests/engine.spec.ts:96`、`:117` | **文档只点名了 M1**，总数 → **未核实**（核实它需要那个子代理的原始汇报，未落盘到 `docs/`） |
| 25 | 第 45–46 轮 / `00:2756`、`:2772-2775` | **丢失请求的可见性**：`GET lost` 独立路由（`src/app/http.ts:542`）用 `list()` 而**不是** `since()`、`counts.lost` 挂进 `GET state`（`http.ts:262-270`）、面板 `#lost-count` 药丸与「丢失的请求」区块（两条路径分开呈现、bundle 答不出来时隐藏） | 代理"跑完变异检验、**精确还原了两处变异**之后"死亡。**M1 的守卫是"列出每一条 lost 行，而不是最新的一个窗口"**；它按 0.8 的强形式做了删检，**发现删掉某条断言后缺陷全活时测试仍绿**，正要去加强那条测试时死了——**那条加强没有做** | `tests/http.spec.ts:794` `it('lists every lost row rather than the newest window, so a busy system cannot bury one')` | **2**（两处变异已还原）；**具体是哪两处、以及删掉的是哪条断言，文档没有写 → 未核实** |

**49 = 11 + 1 + 1 + 6 + 1 + 3 + 8 + 5 + 1 + 1 + 1 + 3 + 4 + 1 + 2**（第 24 条按文档点名的 1 处计）。
这个总数**只统计文档写明"经变异检验"并给出条数的**；第 14/16/17/18/24 条里有 **20 处**只给了个数、
没逐条写出变异内容，本文标 **未核实**而没有替它们编内容。

### 4.3 仍然**没有**变异检验的修复

有测试、但文档没有记录"撤掉修复它就变红"这一步的（前八条上一版已列，本轮逐条复核**仍然如此**）：

- **N4**（规则来源的 deny/pause 有损）与 **N6**（`policyVersion` 在设置层面没有出口）：第 24 轮各补了测试，文档只说"补了测试"。
- **S33**（三处 fallthrough：`sourcePolicy` / `gate()` 的 `enabled` / `authorizationShape.perSource`）：两条回归测试直接来自验收代理的测量。
  **注意它与第 15 条的区别**：第四处 `enabled` 缺口（第 35 轮）**有**变异检验，而原始那三处**没有**。
- **S34**（`verify-migration.sh` 打不开静止的 WAL 库）：修在脚本里，靠 A/B 实测（无 `-shm` → 退出 1；有 `-shm` → 退出 0），
  **没有任何自动化测试**——它是 shell 脚本，不在 vitest 的范围内。
- **S24/B3**（`Later` 是抛出的而 `settle()` 只认返回的）与 **S25/B4**（`myagent_report` 返回 `outcome: undefined`）：各记"+ 2 条测试"。
- **S31**（inbox 归档在并发下重复）：测试改成了自诊断断言，未记变异检验。
- **B1 / B2**（主 Session 缺失时前台回报被静默丢弃 / prepare 失败无报告无通知不可重试）。
- **§4.20 产物引用、§4.21 真实 token 计量、§4.22 inbox 权限自检、§4.23 Input 署真名**：都只写了"测试 N 条"。
  其中 §4.23 的两条本身是**互斥对**（协作通道的文本必须同时含 `the worker of Ticket <id>` 与 `not from the operator`；
  操作者的备注必须**不含** `not from the operator`），这种写法排除了"对所有人都写不是操作者"的假修法，但它不等同于变异检验。
- **面板 V2 UI**（`panel.spec.ts` 109 → 146 → **186**）：三轮增量都未记变异检验。**本轮 02:04 那一条 CSS 断言也没有**——而它是这一族里最容易被删掉而不被发现的一条：它钉的是一条 CSS 规则的 `!important`，撤掉 `!important` 之后**只有当另一条规则也命中同一个元素时**才会显形。

第 31–46 轮新增的、**同样没有**变异检验的：

- **`mountedAt`**（第 31 轮）：有测试（`00` §4.27 记为 `tests/http.spec.ts:486`），未记变异检验。
  而且 §4.27 自己记了一条更要紧的：**这个字段要等下一次重载才生效**——"验证工具本身的可用性也需要被验证"。
- **`decision_missing`**（第 31 轮，替换 `dismiss` 里用错的 `trigger_missing`）：未记变异检验。
- **第 41 轮那个 `??` 运算符优先级 bug 的修复**（`src/app/runtime.ts:293-306`，`??` 比 `===` 松，
  于是 `summary ?? (detail === undefined)` 把一条 **policy** 通知本来要说的话丢掉了）：
  **report 通知那一半有变异检验**（第 22 条的 M2：删掉 `text:` 那一段 → 2 红），
  **policy 通知那一半连测试都没有**。`tests/fault-injection.spec.ts:519-524` 的注释逐字记了这笔欠账：
  那条测试"被尝试过并撤下，而不是留成红的或伪造的"，因为 reproducing 一条丢失的 policy 通知
  还缺一个我没查清的事实（`saveSettings` 的策略效果在桩环境下如何到达 `delivery.policyChanged`——
  `allowedSenders` 变更后 `exhaust(runtime, 'notify')` 没有产生任何 `notice_lost`）。
  **这是本轮清单里唯一一处"缺陷已被端到端量到过、修复只被覆盖了一半"的。**
- **`reply_unroutable` / `reply_unreceivable` 的措辞**（第 36 轮裁定 2 与 §4.34 (iv)）与 **N7 的注释修正**：
  都是文本，没有测试能钉住；`00` §4.33 的理由本身就说清了为什么这要紧
  （"一条描述错了自己成因的错误消息，会把读它的人引到错的地方去找"）。
- **三处 Source 的 catch-all**（`src/sources/inbox.ts:228-234`、`src/sources/chat.ts:385-386`、`src/sources/cron.ts:194-196`）：
  **未修**，所以无从变异检验。这是 S33 那一族的**第四次**出现（纪律 §0.10 逐条列了四次）；
  今天对 `lost` 不可达（只有 `rule.ts:99` 入队 `trigger` 效果，而规则来源从不调 `receive`），
  但**任何未来的 `Disposition` 成员都会走进它们**。
- **`Runtime.sourceStatus()` 整体替换 `counts`** 那个疣（§4.36 (2)）：**未修**。D 靠读
  `sources.source('chat').status()` 绕过了，但疣在 `runtime.ts` 里，会影响下一个有 gauge 的 Source。
- **N9 / N10 / N11**（第 33 轮验收顺带发现的四个里的后三个）：N8 修了之后 N9/N10 被**降级**为显示层瑕疵
  （日志里两条升级各自在自己的 Ticket 下、事件的 `at` 不冻结），**N11 仍然是真缺陷且未修**——
  Watchdog 升级了一个只是慢的启动，而**没有任何东西把升级与后来的成功对账**，所以"需要人"可能是一个永远不会被纠正的假警报。
  三条都没有变异检验，因为三条都没有修复。
- **`sends()` 的两个计数是"每次挂载以来"的内存数**（§4.36 (3)）与 **`channels`/`allowedSenders` 仍只能改整份 JSON**（(4)）：未修。

**一处不是"没有变异检验"、而是"有、但守卫已知偏弱"**：

- **`GET lost` 的"列出每一条而不是最新的一个窗口"**（`src/app/http.ts:542`，用 `list()` 而不是 `since()`）。
  第 45–46 轮的代理按 0.8 的强形式做了删检，**发现删掉某条断言后缺陷全活时测试仍绿**，
  正要去加强 `tests/http.spec.ts:794` 那条时死了，**加强没有做**（`00:2772-2775`）。
  所以这个性质**目前可能只由一条可以被删掉的断言守着**。
  这是一条明确的、范围很小的**测试强度**欠账，不是功能缺陷。
  **具体是哪条断言本文未核实**：核实它要重跑一次删检，而那需要改测试文件，本轮被禁止。

**这条清单的意义**：变异检验证明的是"这条测试真的咬住了这行代码"。没有它的测试仍可能因为桩的形状、
断言写得太宽、或修复与测试同时被改而**通过却不管事**——§5 就是这个现象的七次真实发生，§6 是它的桩侧成因。

---

## 5. 纪律 0.8 的强形式：绿着通过的缺陷

**这一节属于测试报告，不属于审计记录。** 纪律 §0.8 的规则是一句话：

> 变异检验的意义是"证明这条测试能失败"。所以撤掉修复后测试**仍然是绿的**，第一反应必须是**测试太弱**
> （扰动没有可观测后果），而不是"代码本来就没问题"。（`docs/v2/04-execution-discipline.md:144-160`）

它的**强形式**（§4.43 起被反复要求）多问一句：**变异红了之后，还要问"是我的测试强，还是环境碰巧帮我"——
并且要检查删掉哪些断言会让它变绿。**

本项目已经**七次**撞上这个族。其中**四次**是精确意义上的"绿着通过"：**变异保持绿色，或缺陷完全活着而测试因为删掉断言变绿**。
四次里三次当场补强了，**第四次没有**（代理死了）。

| # | 轮次 / 出处 | 发生了什么 | 它证明的是 | 后来怎样 |
| --- | --- | --- | --- | --- |
| 1 | 第 25 轮 / 纪律 §0.8 引 | 测试助手 `one()` 永远返回 `tickets[0]`，于是"两张 Ticket 互相读产物"的测试实际在测"一张 Ticket 读自己的产物"，**而它通过了** | 同族前身：**测试测了错的对象** | 已修（助手改成忠实回答） |
| 2 | **第 36 轮 C1** / `00:2042-2047` | 变异"把 `Date.now()` 混进回复文件名的 key"**最初是绿的**——两次投递落在**同一毫秒**，那个时间戳根本没有机会显现 | **变异保持绿色 ⇒ 先怀疑测试**。这是 §0.8 被写成纪律的那次事故 | **当场补强**：两次投递之间留 5ms（并写明理由：效果队列的重试发生在退避之后，绝不会在同一瞬间），之后变异**变红** |
| 3 | 第 37 轮 D 的 M1 / `00:2191-2195` | 变异只让**两条等待测试中的一条**变红——另一条的 fixture 里没有已存储的 chat Trigger，所以 `countBySource()` 没有 chat 行、`sourceStatus()` 恰好把 Source 自己的 counts 透传了过来 | **变异红了也要追问**：fixture 在无意中帮忙 | **当场补强**：给那条测试补一个已映射的消息（真实部署的状态），重放 M1 → **2 条红** |
| 4 | 第 41 轮故障注入代理的 M3 / `17` §6 | 把旋钮弄哑（`budget.left <= 0` → `>= 0`）→ 3 条红；然后**在旋钮仍然哑的情况下删掉 `expect(host.refusals).toHaveLength(2)` → 那条测试变绿**。它其余每一条断言（前台恰好 1 条通知、`effectCounts() == {}`、没有 `notice_lost`、健康行里没有 `gave up`）**在一次"什么都没失败"的运行里同样成立** | **守卫是承重的，而环境会帮倒忙**：不加那一行，这个测试会用一次根本没有故障的运行去证明"失败两次再成功不会留下丢失记录" | 断言保留；`17` §6 把它写成 0.8 的教科书式执行 |
| 5 | **第 43 轮 M3** / `00:2619-2624` | 在 M2（pass 从不做摘要）仍然就位的情况下，**删掉第 3 条测试里那三条"清除"断言，测试就变绿了——而那次运行里缺陷是完全活的**：它打印出了真实的板子内容 `[{"name":"effects","detail":"notify failed 2 of 5 times: Error: the front desk is not reachable"}]` 与页头的 `"1 problem(s)"` | **一条测试里可以有多数断言是空转的** | **当场补强**：四条测试全部改为断言"系统自己清除了"，没有一条被删或弱化，原先钉住的每一个事实都还在（用 grep 逐条核过） |
| 6 | **第 44 轮 M1** / `00:2700-2707` | 在缺陷完全活着的情况下，**删掉那条重写测试里的"行存在"与"进气计数"两条断言，测试就变绿了**——因为它其余的断言（健康行被清、无 Decision、无 Ticket）**在一个什么都不写的系统里也全部成立**。**只有那两条是承重的守卫** | 同上，而且结论更尖：**"这条测试有很多断言"与"这条测试能失败"是两件事** | **本文未核实**是否补强：`00` §4.45 只记了发现与那句规律，没有记加强动作 |
| 7 | **第 45–46 轮 M1** / `00:2772-2775` | 删检发现**删掉某条断言后缺陷全活时测试仍绿**（守卫是"`GET lost` 列出每一条 lost 行，而不是最新的一个窗口"），代理正要去加强那条测试时**死了** | 同一个失效模式，第三次出现在"删检"这个动作上 | **没有做**。这是 `GET lost` 那个性质目前的测试强度欠账（见 §4.3 末条） |

**这七次合起来说的是同一件事，而它是一条关于测试质量的陈述，所以写在这里而不是写在审计记录里：**

> **绿色不是一个结论，是一个需要被解释的观测。** 一个套件可以有 760 条全绿、退出码 0、
> 而其中某条测试的多数断言是空转的、某条变异根本无从显现、某个 fixture 正在替被测代码兜底。
> 唯一能区分"这条测试能失败"与"这条测试有很多断言"的动作，就是撤掉修复看它红不红——
> **然后再删掉断言看它还红不红。**

**本报告的判定因此有两层，不是一层**：§0 那个"绿"只说退出码；这一节说的是那个退出码**值多少**。
第 4 节那 49 处变异检验是这套测试里**已被证明会失败**的部分；§4.3 那一批是**尚未被证明**的部分。
两者的区别不是"覆盖率高不高"，而是"这些测试能不能失败"。

---

## 6. 桩的保真度：测试绿而生产坏

`tests/helpers/host.ts`（**509 行**）与 `tests/helpers/deployment.ts`（**38 行**）都是**桩**。
这个仓库反复遇到的失败模式不是"测试不够多"，而是**桩与真实契约分歧，于是套件绿着、生产错着**。
`docs/v2/00-audit-and-plan.md` §6（`:1506-1574`）把桩的问题分成三类并逐条点名；下面是四次已经付过代价的，
以及第 41 轮新付的一次。

**（1）`Memory` 与 `Store` 的事务语义分歧（S7）。** `Memory.atomic` 有和 `Store` 同样的 depth 双减，另有三处分歧：
回调抛错时 `Memory` **回滚**而 `Store` **已提交**；depth 变负后 `Memory` 不再快照且 `afterCommit` 开始内联执行；
嵌套命令的错误被外层吞掉时 `Memory` **不回滚**。而**所有领域测试都跑在 `Memory` 上**，
V2 的级联取消恰恰依赖嵌套回滚语义——所以 S5/S6 在离线永远抓不到。
修法是纪律第 2 档那条："一个缺陷有两个实现时，写一份对两个实现跑同样断言的契约测试"，即 `tests/transaction.spec.ts`：
一份断言、两个实现，谁破坏约定就**失败两次**。它的价值靠变异检验证明（§4.1 第 4 条）。

**（2）假执行器不把尝试标成 started（S11 的前半步）。** 生产里 launch 会调 `assignmentStarted` 把 Assignment 变成
`running`，测试里的假执行器不会，于是"向一个从未启动的尝试汇报"在离线世界里成了常态——
**这恰好解释了 S11 为什么能活到今天**。修法是分两步且**顺序不能反**：先让三个假执行器
（`engine.spec` / `tools.spec` / `sources.spec`）的 `start()` 也调 `engine.assignmentStarted(...)`，
**再**收紧 `report()`。反过来做会得到十几条红测试，而"测试全红"会被误读成"修复错了"。
留下的 `marksStarted` 开关用来表达"launch 被尝试过但从未走到启动那一步"——那正是人的 retry 存在的那个状态。

**（3）`delayMs`：一个卡住的 launch 在离线**根本造不出来**（N1）。** 部署桩的 `spawn` 原本只有
`exitCode/stdout/stderr/throws`，**没有挂起能力**，所以"一个仍在飞的 launch"无法表达。后果是实的：
Watchdog 的救援在真宿主里是**空操作**，而 `starting.delete` 又让它从 `stuckLaunches` 里消失，
于是永远到不了 `maxActions`/"需要人"；`used()` 还因此少计一个真的在跑的进程（N3）。
**561 条离线测试看不到这件事**，因为那个状态在离线不可构造。修法是给桩加 `delayMs`（默认 0，对既有测试无影响），
测试下一轮才写出来（`tests/executor.spec.ts:503`，`{ spawn: { delayMs: 1_500 } }`）。
第一次尝试失败了，原因不是修复错，而是**测试造不出场景**：`executor.prepare` 属于**设置**而不是 `deployment()` 的选项，
所以 prepare 命令根本没跑、launch 同步完成、`starting` 在能观察之前就空了。
这条按纪律撤下而没有留成红测试或改成宽容断言——**能力先补上，测试下一轮才写出来**。
> **这一条此后的进展必须一起读**：第 33 轮的真宿主验收把 N1 与 N3 **都【实测】通过**了
> （`docs/v2/14-live-acceptance-watchdog.md` 场景 1：`sleep 90` 活着的 **22/22** 个采样点 `used=1`、违规 0；
> 场景 3：2 条 `rescued`、健康转 not ok 且 detail 逐字点名"需要人"、那一刻 `used` 仍是 1）。
> 所以"离线复现的是我构造的那个场景，不是线上那个"这句限定**对 N1/N3 已经不再成立**。

**（4）`attempt()` 桩要**忠实**回答，不能回 `undefined`。** 纪律第 2 档明写：`ToolsHost` 加一个成员，
测试 harness 里的字面量也要加，而且桩要忠实——`attempt(ticketId)` 返回 `undefined` 会让测试
**只走回退路径、永远碰不到身份本身**（本会话两次踩到：`artifacts`、`attempt`）。
现在的桩照生产的语义回答：`tests/attachments.spec.ts:121-123` 的注释写着
"Mirrors what `Sessions.attempt` answers in production"。

**（5）第 41 轮新付的一次：桩根本没有"让一个 notify 失败"的旋钮。** `tests/helpers/host.ts:252-254` 的注释逐字记着为什么：
桌面通知**吞掉自己的错误**（`delivery.ts:431`），所以 `spawn` 旋钮弄不坏一次 notify，
而 notify 碰的另一样东西就是前台自己的 agent——**于是整套测试此前根本到不了 `notify` 的 `onPermanentFailure`**。
第 40 轮因此把 `notice_lost` 的接线记成明确欠账（`00:2346-2352`），第 41 轮补上旋钮
（`StubOptions.notify = {fails, error?}`，`:270`；注入点是桩 agent 的 `inject`/`followup`，
即 `src/` 里仅有的两个调用点 `agent-delivery.ts:107-108`，所以处理器失败的位置与 DSH 会让它失败的位置相同）。
`fails` 是**预算**而不是开关、而且是**必填**字段（漏写不会被静默当成"永远失败"）；
`host.refusals`（`:184`）是旋钮自己的凭证——**§5 第 4 条那次删检删的正是它**。

**仍未解决的保真度问题**（§6 点名，本轮逐条复核，**全部仍在**）：

| 桩的形状 | 后果 | 本轮复核 |
| --- | --- | --- |
| `inject` 同步持久化，而真 DSH 是放进 `inbox.nextStep` 由 driver 领取 | "跨重启至多一次"这条保证在 inject 路径上是**假的**，而桩让它看起来被证明了 | 仍在 |
| `followup` 把消息永远留在 `inbox.nextTurn` 且不产生事件（与真 DSH 正好相反） | 同上 | 仍在 |
| `agent/status` 从不由桩发出 | "DSH 先发 `idle` 后让 `turn/end` 可见"这个顺序**无法表达**——而那正是 `runtime.ts` 说自己存在的理由 | 仍在 |
| `tools.get()` 永远返回 `{}`（`tests/helpers/host.ts:160`） | `WORKER_TOOLS` 的预过滤在**每个测试里都是死代码** | 仍在（本轮 grep 复核） |
| `SessionEvent` 没有 `time`（真类型是必填） | `lastEventAt` 在任何测试里都是 undefined，**任何"多久没事件"的停滞探测在离线不可测**——直接影响 Watchdog 的静默探测器 | 仍在（`grep -n "SessionEvent\|time:" tests/helpers/host.ts` → 0 命中） |
| `sessionProjections` 服务完全没有（`grep -c` → **0**） | V2 预算的**硬阻塞**：离线 `ctx.sessionProjections` 是 undefined，任何预算代码都会 TypeError | 仍在 |
| `sessionPersistence.flush()` **从不失败**（`:392`） | `agent-delivery.ts:110-112` 那个"flush 必须在 `accepted?.()` 之前"的顺序在测试里**不可观测**——顺序在桩里永远成立 | 仍在 |
| `res` 没有 `write()`、`status` 从 0 开始；`webServer.port` 硬编码 3080（真类型是 `number\|undefined`） | 无法构建或测试任何流式/SSE 路由；同源围栏的 HTTPS 分支不可测 | 仍在 |
| 桩**无法让 `trigger` 处理器因 I/O 失败**（`17` §3.0） | `receive` 在 core 里不做任何宿主 I/O（`policy.ts` 全函数无 `throw`、`executor.prepare` 与 `attachmentsOf` 是纯函数、事件与 `executor.start` 都在提交后且被 `store.ts:547-549` 包住）。能让它失败的只有 Store 的写入或那一行的 payload，而**让 SQLite 失败在离线里不可建模**（那会同时弄坏 `failEffect`/`settleEffect`，量到的是队列而不是 trigger）。所以 `lost` 那半只能用"载荷"这个通道测 | **新增的已知边界**，第 41 轮写进文档而不是被绕过 |

**最反直觉的一条仍然成立**：`tests/tools.spec.ts:177` 的
`it('opens one Ticket when the same request arrives twice, so a retried tool call cannot duplicate work')`
**只因为 harness 把时钟钉成了常量**（`tests/tools.spec.ts:61` 的 `now: () => '2026-11-03T02:00:00.000Z'`）——
生产里 Trigger id 含 `at = now()`，相隔一毫秒的两次调用是两张 Ticket、两个目录、两个 worker。
`POST /api/tickets`（`src/app/http.ts:360`）同样没有幂等键，**面板双击就是两张 Ticket**。

**一处已经被修掉的桩侧假象，值得单独记**：第 41 轮查出 `tests/chat-send.spec.ts:313-314` 与当时的新测试
都在**模拟一次系统从不执行的清除**（`health.entry('effects').record(...)`）——
`record()` 是唯一能清掉健康问题的东西，而它从不在 `effects` 与 `delivery` 上被调用。
`00:2416-2417` 把它归到 S6 那一族：**测试断言了一个系统并不具备的性质**。
第 43 轮把清除变成真实行为之后，那四条测试被改为断言"**系统自己清了**"（§4.2 第 23 条的 M3/M4）。
> 这一条是桩保真度的**反面教材**：桩不是唯一的假象来源，**测试自己也可以造一个系统没有的性质**，
> 而它同样是绿的。

---

## 7. 已知缺口

按"能不能被这套测试覆盖"排序，前面的更根本。**这一节本轮重排过**：上一版的第 2 条（N1/N3 只有离线复现）
与"聊天来源"那一条已经**被真宿主验收关掉**，第 3 条（面板与 API 版本可能不一致）**从推测变成了实测**，
末尾新增两条。

1. **真浏览器从未验证过任何面板行为。** `tests/panel.spec.ts` 的 **186 条**全部跑在 jsdom
   （`tests/panel.spec.ts:1` 是 `// @vitest-environment jsdom`，而 `vitest.config.ts` 的全局 environment 是 `node`，
   所以只有这一个文件在 jsdom 里；无 CSS、无真 HTTP）。第 23 轮额外用 jsdom + 真 fetch 代理到 `127.0.0.1:3080`
   打过一次线上宿主，**那仍然不是浏览器**。因此 `scrollTop` 还原、横幅的 flex 排版、Blob 下载、剪贴板，
   以及"jsdom 不执行经 `innerHTML` 到达的脚本"这个前提带来的全部差异，都未经证明
   （`docs/v2/05-panel-v2-ui.md:88-89`；`tests/panel.spec.ts:395`、`:418` 的注释自己点名了 jsdom 缺什么）。
   S36 的两条转义测试、第 37 轮的聊天卡、第 45–46 轮的「丢失的请求」区块**都在这个范围内**。
   要核实需要一个真浏览器驱动（Playwright 一类）跑同一批断言。
2. **N2 的第二次修复仍然只有离线覆盖，而它的第一次修复是被真宿主证伪的。**
   第 23 轮加了 `Watchdog.settingsChanged()` 并只从 `Runtime.refresh()` 调它，离线测试（假定时器）通过；
   第 33 轮的真宿主验收**证伪**了它（`00` §4.29：三条路径同时关闭——`saveSettings()` 从不调 `refresh()`；
   只改 executor/watchdog 的 PUT 不移动 `policyVersion` 因而不发 `policy.changed`；
   `health.passes.at` 在整个 `sleep 30` 期间冻结了 27.3 秒，因为没有任何 pass 能在 launch 等待 prepare 时完成）。
   决定性证据是网格吻合：`rescued#1` 落在 `mountedAt + 7×60s` 上、误差 **23ms**，偏离 PUT+10s 网格 **2849.7ms**；
   检测延迟 **34.729s** 对 15s 阈值。第二次修复直接从 `saveSettings()` 调（`src/app/runtime.ts:578`），
   测试是 `tests/executor.spec.ts:623`（走真接线），**经变异检验**（§4.2 第 12 条）。
   **但从未在真宿主复验。** 要核实需要一次隔离宿主的验收运行：改 `everyMs` 后读
   `Runtime.watchdogArmedInterval()`（第 33 轮正是为了这个才把它暴露成只读诊断）并观测下一次 `rescued` 落在哪张网格上。
   > 这一条留下的规律比缺陷本身值钱，`00:1806-1809` 逐字写着：**"第 23 轮那条离线测试是真的通过了，
   > 而它测的是'调用 `settingsChanged()` 会重新上膛'，不是'改设置会调用 `settingsChanged()`'。
   > 假定时器让 `refresh()` 是否会被调用这件事完全不可见。一个修复的测试必须覆盖'谁会触发它'。"**
   > 那条测试今天仍在（`tests/watchdog.spec.ts:142`），仍然直接调 `settingsChanged()`。
3. **面板与 API 的版本不一致：本轮先实测到它、又实测到它结束。** 只读复核 `127.0.0.1:3080`（带 `x-myagent-request: 1`）：
   **00:5x 那一次**（当时宿主跑的是第 31–34 轮之间的 bundle）：
   `GET /api/state` 带 `mountedAt: 2026-11-04T04:21:30.904Z`（本地 12:21:30），
   而 **`GET /api/lost` → 404** `{"error":"No route for GET /myagent/api/lost"}`、
   `state` 里**没有** `chat` 键、`counts` 里**没有** `lost` 与 `sends`、`settings.sources` 只有 `cron/inbox/session/rule`。
   同一时刻 `GET /myagent/` 送出的 **127974 字节与磁盘 `panel/index.html` 逐字节相同**
   （sha256 `290eed863988b49ecbef8c3be84de517fb85f0756f13a2c7147d4da271e37325`），
   而那份页面里 `#lost-count`、`#chat-waiting`、`丢失的请求` **都在**。
   即：**线上当时就是"新页面 + 旧 API"**，而旧到什么程度可以被夹住——
   有 `mountedAt`（第 31 轮加的字段）而无 `sources.chat`（第 35 轮）⇒ 已加载 bundle ∈ **[第 31 轮, 第 35 轮)**。
   **01:40:15 插件被重载了**（pid 仍是 24619，即宿主进程没换），**02:4x 复测**：`GET /api/lost` → **200**
   `{"total":0,"shown":0,"rows":[],"payloads":[],"bounds":{"keep":20,"chars":1000}}`、`state.chat` 存在、
   `counts` 多了 `sends:{queued:0,nowhere:0}` 与 `lost:{rows:0,payloads:0}`、`settings.sources` 有**五个**块（`chat` 的 `.prefault({})` 默认值被 materialize 出来）、
   `health` 有 `source:chat`（`detail:"disabled"`）而**没有 `executor`**、`health.effects.detail` 逐字是 **`"no effect failed in this pass"`**
   （那是 `src/app/effects.ts:56` 的 `QUIET` 常量，即第 43 轮那个“健康条目自己会清”的行为正在线上跑着）、
   面板与磁盘**仍逐字节相同**（`2fdbfcad0f440318…`，128775 字节）。⇒ **已加载的就是本轮被钉住的 `768a6adb1cfc136c…`**
   （推断：`bounds` 那两个数把下界压到第 44 轮之后、`QUIET` 串压到第 43 轮之后、缺席的 `executor` 条目压到第 39 轮之后，
   而 `mountedAt` 01:40:15 落在那个哈希的三次构建之间——三次构建的哈希逐字相同。**确切身份仍未核实**：没有路由暴露 bundle 的哈希）。
   **所以这一条从“线上正在发生”变成“线上发生过、并且结束了”**，而它结束的方式恰好说明缺口没有关闭：
   **降级路径与正常路径在同一个晚上都被读到过，两次都只有只读的、对着空数据的观测**——`rows:[]`、`waiting:{count:0}`、`sends:{0,0}`、`chat.enabled:false`、`channels:[]`。
   **一次对空集合的 GET 不是一次验收。**
   面板对这个状态做了能力探测（`tests/panel.spec.ts:2315` `describe('a host whose plugin is older than the page')` 一组、
   `:2954` `describe('a host whose plugin has no chat view yet')` 一组），
   而 `panel/index.html:1307-1308` 的措辞是诚实的：**"这不代表「没有丢失的请求」，它代表「读不到」"**。
   **但探测之后的线上行为仍然只有第 23 轮那一次 jsdom+真 fetch 的实测，不是持续验证。**
4. **Project / Work / 依赖图从未在真宿主上被驱动过。** 路由与调用者都在
   （`src/app/http.ts` 的 `POST projects`/`POST works`/`POST tickets/:id/work`/`dependencies`），
   面板也有工作 tab（`panel/index.html:127` `data-tab="works"`），
   但本轮只读复核 3080：`GET /api/projects` → `{"projects":[]}`、`GET /api/works` → `{"works":[]}`，
   `counts` 里 9 张已结束的 Ticket **没有一张属于任何 Work**。第 33 轮与第 38 轮两次隔离验收也都没有驱动它们
   （`docs/v2/14-…` 的四个场景是 Watchdog 与停机，`docs/v2/16-…` 的四个场景是聊天闭环与停机）。
   所以级联取消、`released()` 的两种释放语义、`workSeq` 排序、依赖等待用 `Later` 表达、
   分层上下文里那段 `## The work this belongs to`——**全部只有离线证据**。
   仍然缺的功能面：没有改名与删除（路由表 19 GET / 14 POST / 2 PUT / **0 DELETE**）；
   依赖的对端候选上限 `state=all&limit=200`；没有 `#work=` 深链（`panel/index.html` 只有 `#ticket=`，`:547` 写、`:1940` 读）；
   事件类型没有筛选与中文对照；`Work` 还不能绑定 `Schedule`；规则来源的 `then.workId` 还没有写入路径。
5. **`GET triggers` 仍然没有任何页面用它，而 `GET lost` 有了。** 本轮复核 `panel/index.html` 的 `api(...)` 调用集合：
   `lost?limit=` **在**（第 45–46 轮加的），`triggers` **不在**（`grep -c "api('triggers" panel/index.html` → 0）。
   面板的契约测试把 `GET triggers` 排除在外，**这个排除是被断言的，不是漏掉的**。
6. **预算只有"可见"，没有"受控"，所以没有任何测试能覆盖上限。** token 用量是真实数字
   （来自 DSH 的 `assistant/message` 事件，在真宿主日志里核对过），但**上限不存在**：
   一个跑飞的 worker 会一直跑，Watchdog 只处理"卡住"与"静默"
   （`docs/v2/06-security-risk-register.md` §5、§6）。**桩侧的硬阻塞仍在**：`sessionProjections` 服务完全没有（§6）。
   同理未做：按 Work/Project 的累计成本、**面板渲染 `usage`**（本轮复核 `grep -c "usage\|Tokens\|token" panel/index.html` → **0**，
   所以操作者在任何界面上都看不到用量，尽管它已被诚实计量）、产物内容的来源标注。
7. **worker 没有沙箱，这是信任模型而不是待修的一行。** `WORKER_PERMISSION = 'danger-full-access'`
   （`src/app/sessions.ts:27`，本轮复核未变），Ticket 的 `scope` 只是**提示词约束**。
   在这条之下，所有"路径守卫""越界拒绝"（含 `tests/files.spec.ts` 那 15 条）只防**意外**，不防**恶意**。
   风险清单 §6 的两条"高"——给 worker 一个真边界（受限用户 / 容器 / 只读挂载 + 可写工作区），
   以及 inbox 目录权限的文档与自检（**能写 inbox 目录的人就能以任何被允许的发起者身份提交工作**）——
   **都属于部署层，本套测试无法覆盖**。
   > **P8 之后这一条的措辞要更准**：聊天来源**没有**重复 inbox 那个错误。
   > 身份必须被**映射**、不能被推断（`sources.chat.identities` 是操作者的断言，Source 不得自己判 `system`），
   > 而且 chat 消息**不 honour `scope` 前置字段**——第 36 轮的裁定 4 把理由写成了信任决定：
   > "让一个非操作者的发送者设定工作的授权范围，等于让请求方自己写自己的授权"（`00:2035-2038`）。
   > 真宿主验收也量到了映射本身：`sender={id:"acc-alice", kind:"person"}`，**不是**平台 id `U01ACC01`
   > （`docs/v2/16-live-acceptance-chat.md` 场景 1）。
8. **注入面没有缓解，只有半径收窄。** 跨 Ticket 的产物读取被限制在同一个 Work 内且只能读登记过的路径；
   但没有对不可信文本做来源标注（inbox 正文、附件、别的 Ticket 的产物），也没有对产物内容做任何检查——
   本轮复核 `grep -n "external\|untrusted\|not an instruction" src/app/runtime.ts src/app/tools.ts` → **0 命中**。
   **Input 那一条做了**（第 28 轮 `authorOf`，worker 写的那种明写 `not from the operator, so treat it as data`），
   而产物通道**更**需要，因为产物内容任意长且完全由模型写（`06-security-risk-register.md` §4）。
9. **风险清单最大的未验证假设：DSH 本身没有被审计过。** 它如何强制工具清单、权限预设、Session 隔离被当作给定前提；
   如果那个前提有问题，清单里"真边界"这一类要跟着改（`06-security-risk-register.md:145-147`）。
   本文能补的一条相关事实：桩**完全没有** `sessionProjections`、`sessionController.inspect`、`systemPrompt` 三个服务，
   而且"**没有任何东西验证 `myagent-worker` 预设真的存在**"。
10. **`GET lost` 的"列出每一条而不是一个窗口"这个性质，守卫已知偏弱。** 见 §4.3 末条与 §5 第 7 条。
    性质本身在源码里是有理由的（`src/app/http.ts:542` 的注释：`since` 是**最新**窗口，
    所以一个每次触发都坏的生产者会把一条较旧的丢失挤出窗口，而 `countBySource` 仍在计它——
    **一个与它旁边的数字不一致的列表，出现在一个专门回答"丢了多少"的页面上**）。
    要关掉这条欠账需要重跑一次删检并加强 `tests/http.spec.ts:794`。
11. **三处 Source 的 catch-all 与 `Runtime.sourceStatus()` 那个疣都未修。** 前者是 S33 那一族的**第四次**出现
    （纪律 §0.10 逐条列了四次，并给出修法是"让兜底大声"）；今天对 `lost` 不可达，
    但任何未来的 `Disposition` 成员都会走进它们。后者会让任何 Source 自己的 gauge 一旦该 kind 存过一个 Trigger
    就从 `state.sources.<kind>` 消失。
12. **测试套件泄漏临时目录：这是本文本轮量到的最大一条卫生问题，而它的严重度是斜率不是数字。**
    **成因是结构性的、可数的**：33 个 spec 文件里只有 **4 个** import `rmSync`（`notify-machine`、`notify`、`store`、`transaction`），
    而 `tests/helpers/deployment.ts` 的每个 `deployment()` 都 `mkdtempSync` 一个 stateDir（带一个真 SQLite 与锁文件）且**没有 `afterAll` 清理**。
    主代理在 02:2x 实测：**55,205 个 `myagent-*` 目录、49,869 个 `.sqlite3`、`os.tmpdir()` 占用 6.0 GB**，而且**仍在增长**
    （整合代理 15 分钟前量到的是 53,609 个 / 2.74 GB）。清空之后**紧接着一次 `--quick` 运行又泄漏了 266 个**。
    **本文 02:4x 独立复测**（清空 + 一次完整闸门 + 本文自己跑的两次单文件 vitest 之后）：`os.tmpdir()` 下 **532 个 `myagent-*` 目录、466 个 `.sqlite3`**。
    **已清理，根因未修**（`00` §4.51）。修复方案也写在那里，而它的关键约束值得原样留着：
    **不能用全局 `afterAll`**，因为 `tests/fault-injection.spec.ts` 的 `restart()` 与 `tests/store.spec.ts` **故意**保留目录跨 `Runtime` 重建——
    全局清理会把“还活着、正要被 restart 用的目录”也删掉。正确的位置是 `deployment()` 返回的句子上加一个 `cleanup()` 由各 spec 在 `finally` 里调，
    或者给 `Deployment` 加 `Symbol.dispose`，让既有的 `finally { await runtime.stop() }` 模式自然带上它。
    **`00` §4.51 那条流程教训是本文这一节最该被记住的一句**：第 32 轮量到“数百棵”时它被当成一条小卫生项记下而**没有修**；
    现在涨了一百倍，因为此后跑了大约四十轮闸门——**“凡是‘每轮都在产生’的东西，量到的那一刻就该修，因为它不是静态的数，是斜率。”**
    本文上一版对这一条的记法（“15 个 spec 文件里共 48 处 `mkdtempSync`，而整个 `tests/` 只有 9 处 `rmSync`/`rm`”）**方向对、量级错**：
    它数的是**代码里的调用点**，而泄漏量要乘的是**运行次数**。
    其余几条（本轮重新量过，数字与上一版不同）：**7 个** spec 文件用真 `setTimeout`（`background`、`chat`、`dependencies`、`effects`、`http`、`panel`、`sources`），
    而用假定时器的有 **3 个**（`panel`、`sources`、`watchdog`）——上一版记的是"6 个真 / 只有 panel 用假"，**两个数都变了**；
    `tests/background.spec.ts:25` 是一个真实的 10ms 竞态（`until(pending, undefined, 10)` 对一个 500ms 的 `setTimeout`）；
    `tests/files.spec.ts:62` 依赖 60 秒墙钟窗口与文件系统 mtime 精度；
    `tests/deployment.spec.ts` 与 `tests/notify-machine.spec.ts` 改全局 `process.env`；
    `notify-machine.spec.ts` 仅 POSIX（Windows 上会静默找不到通知程序且无测试）。
    **以及第 44 轮抓到并修掉的三处 flaky**：`tests/sources.spec.ts:273,296,312` 原来断言
    `toBeGreaterThan(Date.now())`，而 `next` 是按分钟取整的未来槽位、在 pass 期间算出、`Date.now()` 在它算完之后才读，
    所以**测试只要恰好跨分钟边界就失败**（实测两个值相差 207 毫秒、都落在同一个整分钟边界上）。
    `00:2717-2718` 对这件事的定性值得原样留着：**"一条会随机变红的测试，会让人学会忽略红色——那正是 0.1 要防的事。"**
13. **陈旧检查只 glob `*.ts`，所以一次只改面板的回归无法让闸门变红。** `scripts/gate.sh:53` 是
    `find src tests -name '*.ts' -newer lib/index.js`。面板不进 bundle（`00:2223-2225` 记了这个分工：面板走磁盘、代码走 bundle），
    所以这个 glob **对产物陈旧这件事是对的**——本文 00:5x 就量到过 `panel/index.html` 比产物新而闸门不报陈旧，那是**正确行为**。
    **但它意味着面板的唯一防线是 `tests/panel.spec.ts` 那 186 条 jsdom 断言**，而 §7 第 1 条说清了那 186 条的边界（真浏览器从未验证过任何面板行为）。
    本轮 02:04 那一条 CSS 断言正好落在这个缝里：它钉的是一条**只有人看着页面才能发现**的规则（`panel/index.html:83` 的注释逐字这么说），
    而现在钉住它的是 jsdom——**jsdom 的 CSS 层叠与真浏览器不是一回事**。
14. **纪律里三条至今只能靠自觉**：0.3 证据先于修复、0.4 修一类先枚举、第 4 档的冻结与快照。
    它们约束的是**动作顺序**而不是产物状态，所以难以变成断言。
    **两条已经被机器强制了**：0.1（`scripts/gate.sh` 自己决定退出码）与 0.2（`tests/build.spec.ts` 的 4 条）。

---

## 8. 测试数量史

只列文档里能引用到的数字，不补中间值。"轮"是 `00-audit-and-plan.md` 自己的编号。

| 时点 | 条数 | 产物 | 出处 |
| --- | --- | --- | --- |
| V2 开始（项目目标里的基线） | **470** | — | `00:102`（"stub 过去只抛第一个名字且永远单数，所以 470 个测试全绿"） |
| 第 2 轮 P1a | 516 | — | `00:489` |
| 第 8 轮 P1d 事件日志 | 521 | — | `00:539` |
| 第 9 轮 P2 依赖 | 527 | — | `00:573` |
| 第 10 轮 级联取消 | 532 | — | `00:602` |
| 第 11 轮 B1/B2 | 533 | — | `00:647` |
| 第 12 轮 P3 前置 | 534 | — | `00:669` |
| 第 13 轮 P3 协作通道 | 538 | — | `00:694` |
| 第 14 轮 P4 按来源策略 | 544 | — | `00:731` |
| 第 15 轮 P4 Watchdog | 548 | — | `00:766` |
| 第 16 轮 静默探测器 | 552 | — | `00:790` |
| 第 17 轮 P4 deny/enabled 分开 | 557 | — | `00:833` |
| 第 18 轮 P4 规则来源 | 561 | — | `00:876` |
| 第 19 轮（S32 暴露） | 567 通过 **+ 40 个未处理错误，退出码 1** | — | `00:883`、`:936` |
| 第 20 轮 S32 结案 | 568 → **571**，闸门首次 `exit 0` | — | `00:927`、`:995` |
| 第 22 轮 | **没有全量数**：只跑了目标套件（engine/sources/policy/store/transaction/http，共 204 条），文档明写"验证状态因此是 typecheck 干净 + 204 条目标测试通过，**不是全绿**" | — | `00:1025-1027` |
| 第 23 轮 面板 V2 UI | 611（`panel.spec.ts` 109 → 144） | — | `00:1116`、`05:10` |
| 第 23 轮 S36 补测试 | 615 | — | `00:1157` |
| 第 24 轮 N5/N4/N6 | 619 | — | `00:1104` |
| 第 25 轮 产物引用 | 624 | — | `00:1223` |
| 第 26 轮 真实 token 计量 | 627 | — | `00:1255` |
| 第 27 轮 安全风险清单 | 629 | — | `00:1292` |
| 第 28 轮 Input 署真名 | **631** | — | `00:1317` |
| 第 31 轮 `decision_missing`、`mountedAt`、三处不实陈述更正 | **631**，退出码 0 | `04d171f85a6bc1f0…`（269132 B） | `00:1465` |
| 第 33 轮 Watchdog 真宿主验收（N1/N3 通过、N2 **证伪**、命题 B 首次被测） | **632**，退出码 0 | `f96753fb5108adc1…`（270061 B） | `00:1836` |
| 第 34 轮 N8 升级进事件日志 | **634**，退出码 0 | `93a2ae41831d7c8a…`（270990 B） | `00:1874` |
| 第 35 轮 P8 A+B 契约层 | **657** →（同轮末）**662**，退出码 0 | `f07e56a6017318e0…`（276268 B） | `00:1938`、`:2004` |
| 第 36 轮 P8 C1 聊天 Source 本体 | **676**，退出码 0 | — | `00:2010` |
| 第 36 轮 P8 C2 发送路径 | **688**，退出码 0 | `8ca08244bcf39a03…`（298499 B） | `00:2068` |
| 第 37 轮 P8 D 面板与 `state.chat` | **720**，退出码 0 | `2a2ebf4a7208928b…`（302606 B）→ 修完 `waiting()` 后 `b955704fcc677aff…`（303956 B） | `00:2174`、`:2219-2220` |
| 第 38 轮 P8 E 真宿主验收（聊天闭环得证） | 未复测（复测必须重建、会移动被测产物 → 标【推断】） | `b955704fcc677aff…` 起点=终点 | `docs/v2/16-live-acceptance-chat.md` §5 |
| 第 39 轮 S38：把那句 gauge **删掉** | **721**，退出码 0 | `2cc5041d374adf93…`（**303860 B，比修复前小 96 字节**） | `00:2322` |
| 第 40 轮 `notice_lost` | **723**，退出码 0 | `f0fca3f7c538e250…` | `00:2344` |
| 第 41 轮 故障注入 + 查出两个 `src/` 缺陷 | **729**，退出码 0 | 代理跑完时与基线**逐字相同**（它被禁止改 `src/`）；主代理修完优先级 bug 后 → `ae77dcf482148802…` | `00:2374`、`:2453`、`:2473` |
| 第 43 轮 缺陷 (2)：`effects`/`delivery` 健康条目回到"此刻"语义 | **730**，退出码 0 | `d70994ba1afdb38c…`（310311 B） | `00:2566` |
| 第 44 轮 `lost` 处置状态 + 三处 flaky | **739**，退出码 0 | `83cfa43eee01190d…`（316488 B） | `00:2671` |
| 第 45–46 轮 丢失请求的可见性（`GET lost`、`counts.lost`、面板区块） | **759**（+7 http、+13 panel），退出码 0 | **`768a6adb1cfc136c…`（320163 B）** | `00:2751` |
| 第 47 轮 面板 CSS 修复 + 一条测试 | **760**（+1，全在 `panel.spec.ts`） | **`768a6adb1cfc136c…` 未变**（02:04 重建过，哈希逐字相同——面板与测试都不进 bundle） | `00` §4.51、本文 §2 的 panel 行 |
| **本文 00:5x 复算**（完整四步闸门，起于 2026-11-05 00:43:54） | **759**，33 个文件全过，日志末行 `结论：通过` | `768a6adb1cfc136c…`（320163 B，mtime `Nov  5 00:43:54 2026`），无源文件比它新 | 日志 `Tests  759 passed (759)`（那份日志已被 02:21 的运行截断覆盖，本文在被覆盖前逐字读过） |
| 02:21:41 一次 **`--quick`** 运行 | 760，但**跳过 build 与两项产物核对** | 同上 | 本文 02:3x 读到这份日志只有 `── typecheck` 与 `── test` 两节——**这正是 `gate.sh:22-25` 那行运行方式首行存在的原因**（§0） |
| **本文取为权威**（完整四步闸门，起于 **2026-11-05 02:40:09**） | **760**，33 个文件全过，首行 `── 本次运行：scripts/gate.sh （2026-11-05 02:40:09）`，末行 `结论：通过` | `768a6adb1cfc136c…`（320163 B，mtime `2026-11-05 02:40:13`），`find src tests -name '*.ts' -newer lib/index.js` → 0 | 日志 `Tests  760 passed (760)` |

**这段历史里最该被记住的不是增量，而是三格**：

- **567 → 571 那一格**：条数最多、看起来最绿的那一轮，退出码是 1，而它被报成了全绿七次。
- **631 → 632 那一格**：只加了一条测试，而那一轮**证伪了一个已经"修好并有离线测试"的修复**（N2）。
  条数几乎没动，而项目对自身的认知变了。
- **720 → 721 那一格**：条数**加一**、产物**小 96 字节**——因为修法是把一句会说假话的字符串**删掉**。
  `00:2311` 那句结论值得原样留着：**"一个数字如果会过期，就不该被存在一个不会过期的数字旁边。"**

所以本报告的判定只认闸门退出码，§7 的缺口只用"未核实/未做"这样的词，不用"基本覆盖""大体通过"。
而 §5 说的是退出码之上的那一层：**760 条全绿里，有 49 处已被证明会失败，有一批尚未被证明，
有一条已知的守卫可以被删掉而不红，还有一条 CSS 规则此前只有人看着页面才能发现。**

