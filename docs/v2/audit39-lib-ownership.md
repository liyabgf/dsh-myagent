# Audit39 · lib/index.js 修改归属核验

## 状态

已完成归属核验，未覆盖、删除、移动、重建或提交 `lib/index.js`。用户原有修改保持工作树状态。

## 核验结果

### O001 · 归属核验计划

已落盘后执行只读身份核验。结果：工作区 `/Users/liyang/Documents/SA/myagent`，远端为 `https://github.com/liyabgf/dsh-myagent.git`；HEAD在核验时为 `98adbc4`，当前工程后续提交仍未把lib纳入。原有 `lib/index.js` 修改未触碰。

### O002 · 内容与源码对照

命令与结果：

- 工作树 `lib/index.js`：SHA-256 `2cac4b8c36ee96b638a0ae2fe7d14a4309e779727f782389eda0ad02d9524def`，516828字节。
- HEAD版本：SHA-256 `3207eff730830e119478a26a6d3616e130f37adf484c214effe03193a177585f`，510584字节。
- 差异：140行新增、20行删除。
- 差异内容对应当前 `src/` 仍存在的 Audit39前工程源代码：
  - `src/core/engine.ts` 三处 `Assignment.role` 继承；
  - `src/app/sessions.ts` 的 `ticketId` 透传；
  - `src/app/executor.ts` 的 DeskLoop启动顺序与main-desk输入路由；
  - `src/app/delivery.ts` 的ticketId与防回声；
  - `src/app/desk-tools.ts` 的 `myagent_use_tools`；
  - `src/app/desk-loop.ts` 的按需工具与直答结案。

结论：这不是随机手改。它是**当前仓库已提交源码的生成产物，但尚未被当前HEAD提交**。源码对应提交仍在历史中（R1/R3/空回复修复提交可见），当前src工作树无差异；Audit38最终隔离gate也记录同一产物hash `2cac4b8c…`。因此来源可追溯到当前源码与构建证据，不应称为“源码来源丢失”。但它仍不能在未确认前直接纳入修复工程：需要决定是否把生成物作为当前HEAD的正式bundle提交，或保持未提交以等待R0重新构建钉住。

### O003 · 归属处置决定

当前处置：**隔离保留、禁止覆盖**。

理由：

1. 覆盖它会丢失唯一剩余的编译成果；
2. 直接提交它会把没有完整来源、测试映射和逐文件差异的产物伪装成可追溯发布；
3. 当前Audit39设计阶段禁止业务修复与构建；
4. `lib/index.js` 的bundle内容已经由本报告记录hash/size/语义标记，未来R0/R1可在隔离副本中作为比对证据。

下一步候选方案（需要用户明确选择）：

- **A（推荐）**：保持当前工作树lib不提交；R0建立隔离快照，将该bundle作为只读历史残留，对应源代码在新批次重新验证后重建。
- **B**：单独提交“历史产物归档”到专门证据分支/目录；不将其作为正式发布bundle，不推送到main。
- **C**：用户确认放弃该残留后，另行执行清理；本报告未执行清理。

## 未执行声明

未运行 `pnpm build`、未运行发布脚本、未执行 `git restore`、未覆盖/删除/移动 `lib/index.js`、未修改业务源码/测试/运行态。