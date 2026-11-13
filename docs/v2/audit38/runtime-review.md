# 主审：运行时装配与跨模块契约

状态：进行中；基线 a06e999。仅已读文件/范围列入覆盖。所有结论静态审核，尚未做隔离行为复现。

## 操作记录

- A002：全文读取用户提供的37号附件364行、04纪律445行、package.json 97行、src/index.ts 105行、src/deployment.ts 96行、src/app/executor.ts 803行、runtime.ts 1200–1767。read runtime limit=2200 被工具拒绝（上限2000），未据此声称全文读取。
- 清单命令退出0：git ls-files 387个受控文件，正则提取729条import边。初次 glob `src/**/*.ts` 返回无匹配；采用 git受控清单成功。正则图不是AST图，包含类型边，尚未分离动态与运行依赖。
- 静态依赖摘要命令退出0：core只依赖core/平台库；app runtime为装配根，executor通过窄host接口依赖engine/store/sessions/effects；sources通过SourceHost进入Runtime。

## 已确认的结构问题（待行为复现）

### RT-01 高：recover() 对 DeskLoop 的恢复分支在启动顺序下不可达

证据：runtime.start:1263先执行recover；1276才new DeskLoop；1289才sessions.setDeskLoop。recover:1588却以sessions.hasDeskLoop()判断是否恢复main-desk分诊。新实例调用recover时始终false，导致遗留running triage直接continue（1594），没有assignmentInterrupted或重新入队。reconcileGhostTickets:1641又永久跳过main-desk，无法补救。

触发：配置deskLlm provider+model、triage desk main，进程/插件在分诊turn中重启，库中只剩running triage，而launch效果已完成或遗失。影响：票挂起，恢复契约不成立。与先前37号“usesMainDesk存在即恢复通过”相反。

### RT-02 高：stop() 未停止 DeskLoop，关闭数据库后仍可能写入

证据：runtime.stop:1387–1421中取消abort、停止passes/sources/sessions/effects/workers并close数据库，没有调用deskLoop.dispose/stop。需进一步全文读取DeskLoop确认其私有abort是否与Runtime lifetime关联。若不关联，则正在进行的LLM和内存队列不会停止，可能在store.close后追加history/report。

### RT-03 中：主分诊提示词实际仍包含worker指令，R3提交说明与内容不符

证据：executor:36–40 TRIAGE_BRIEF仍要求工具关闭，没有轻量直答/网关约定；taskText:687无条件追加“call myagent_report”，main-desk launch:502直接拼接taskText。mainTools没有worker report（待tools全文核实），会引导desk调用不存在工具。

### RT-04 中：worker-slot容量检查先于triage分支

证据：executor.launch:489对所有ticket先做used>=maxWorkers返回Later；500才判断toMain。注释496–499声明main-desk无worker槽，但worker全满时分诊仍被阻塞。starting包含分诊，used:455统一计入，可能造成分诊占用worker槽。需用隔离deployment复现。

### RT-05 中：附件后续输入路径校验与初始附件不一致

executor.copyAttachments:582–607初始附件检查plain name/symlink/workRoot；deliverInputs:735–743直接readFile(srcPath)和basename后写入sandbox，失败只warn且随后标记delivered。可导致附件读取失败仍把输入标为送达；是否属于平台可信路径需追溯engine.answer与HTTP/chat调用链。

### RT-06 中：materializeInput的“已有相同文件”判据只有字节数

executor:299–310 对COPYFILE_EXCL EEXIST仅比较size；相同大小不同内容会当作已复制，返回目标路径。注释称“identical size”，但向消费worker传递的产物可能不是源文件。需同长度不同内容复现；不擅自改实现。

## 覆盖台账（主审子集）

|文件|已读范围|状态|
|---|---|---|
|src/index.ts|全文1–105|已审入口；DSH服务契约待Inspect核实|
|src/deployment.ts|全文1–96|已审路径与配置；未发现本轮确认阻断|
|src/app/executor.ts|全文1–803|已审，RT03–06待复现|
|src/app/runtime.ts|1200–1767|部分审核，RT01已静态确认，RT02待交叉|
|package.json|全文1–97|已读，发布边界另由surface审查|
|docs/v2/04-execution-discipline.md|全文1–445|已读，执行纪律纳入38|
|用户37号附件|全文1–364|已读，不等于仓库37号内容|

## A003 隔离探针结果（2026-11-13 12:35 Asia/Shanghai）

命令 pnpm vitest run tests/audit38-repro.spec.ts，真实退出0，6个审核探针均观测到目标缺陷（不是回归验收通过）。原始输出 repro-output.log / repro-exit.txt。仅临时内存DB与/tmp工件目录，无线上写入。

- RT01：直接调用Runtime.recover的同一实现，模拟start恢复阶段hasDeskLoop=false，即使配置provider/model且running main triage，assignmentInterrupted次数=0。静态时序与行为探针一致。
- RT06：先物化AAAA，源文件改为同长度BBBB，再物化返回成功，目标仍AAAA。已复现。
- RT07 高：deskGenerate的signal仅在每个chunk到达后检查，未把signal传给ctx.llm.stream(options)。已abort调用仍先进入provider.stream，收到的options.signal为undefined。若stream.next悬挂，120秒timer只置位，不打断底层，超时不生效。位置desk-llm:56–74。
- RT08 高：超时处理不检查ticket.role；worker通过askDesk附带自身ticketId，LLM timeout时runLoop:176–181直接engine.report(workerId,dropped)。探针确认对普通worker id发出了dropped report，可能终止正在工作的worker。此前贯通ticketId扩大了此分支的影响面。
- RT09 中：某attempt内曾myagent_reply一次，后续请求者answer在同一running attempt继续，settleDirectTriageAnswer以startedAt为界检测旧replied，永远拒绝自动结案。探针确认最终直答后reports仍0。应以本轮entry/工具执行记录判断，不能用整attempt历史替代本轮。
- RT10 中：同requestId重复relay只去重user row，LLM仍跑两次；副作用工具可重复执行。探针user row=1而provider调用=2，需明确至少一次语义及幂等工具约束。
- RT11 高：provider stream以finish error携带部分文本时，DeskLoop仍将无toolCalls文本走settleDirectTriageAnswer并report ready；审核探针确认partial text导致ready。错误/截断响应不应被当作完成报告，需按finishReason分流并保留错误可见性。

隔离全闸门后续证据：增加全部审核探针后，既有runtime-budget.spec出现pending→running断言失败（1217 passed/1218 total，退出1）；此前同树未包含全部探针时1214/1214。该失败可能是异步测试环境扰动或已有竞态，尚未复现第二次，标待验证而非修复。

- RT02交叉确认：DeskLoop全文1–365没有dispose/stop方法，abortController从未abort；Runtime.stop没有DeskLoop处理。已静态确认，仍需关闭后写入复现。

已补读：runtime.ts 1–1199（故全篇1767行读完）、sessions.ts1–861（工具输出截断，862–941待续）、delivery.ts全文875、desk-loop全文365、desk-llm全文144、desk-tools全文116、desk-history全文170、http全文849、tests/helpers/deployment全文44。

HTTP审核：同源marker/host/origin保护存在，但match(routes)与decodeURIComponent发生try外（http:839 vs841）；畸形%编码可能逸出路由失败包装。文件端点lstat信息与后续实际读取之间可被worker并发替换，属于可信本机worker模型下TOCTOU风险，不能宣称OS级隔离。GET tickets/:id/events limit无上限，完整日志读入。Desk分页latestSeq契约与panel消费者问题与SR20交叉。

历史审核更正：37号G9以key(input)解释Event.seq属于对象混淆；G10声称已加真实executor/recovery测试，当前受控测试需逐项核实，不能沿用旧树。core-audit全文复核确认当前 executor.spec/recovery.spec 没有历史所称 DeskLoop relay拒绝/耗尽后running、triage follow-up专项；37号“R1新增两条executor测试/补上follow-up路由”声明不成立，已降级为错误历史记录。M-R3c删除网关会改变tool回执为Unknown tool，明显可观测差异，不能宣称等价变异。发送queued累计计数不等于待发送，前次“8小时悬挂”把03:52Z误作本地03:52，实际03:52Z=11:52本地，12:00停止约8分钟。

## 后续

读取runtime 1–1199、sessions、delivery、desk-loop/llm/history/tools、HTTP与文件IO、技能/健康/视图等剩余app文件全文；建立动态装配图与接口清单；隔离复现确认问题。历史文档错误按证据更正，不抹去原始记录。
