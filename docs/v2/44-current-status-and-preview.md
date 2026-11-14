# 44 · 当前状态与实验性预览说明

更新时间：2026-11-13 Asia/Shanghai

## 一句话结论

当前工作树适合作为**受控环境中的个人临时试用和开发者源码预览**，不应被宣传为稳定发行版、多用户安全服务或生产就绪的执行隔离系统。

## 当前代码状态

本轮可靠性修复针对以下方向完成了代码改造：

- DeskLoop 失败 finish 门控、Promise 拒绝清理、成功请求回执和失败重试。
- Chat 续消息原子 Input/消费回执、重复消息处理、出站原子文件和回程幂等键。
- Effects 未知类型健康告警、Store COMMIT/RELEASE 失败恢复、Prompt 提交后通知。
- Source 策略重验证、Desk 工具历史窗口配对。
- DSH 子代理 root-tree 停止适配、Session/Executor/Pass/Source/Runtime 在途工作跟踪、预算独立检查、停机超时保留 DB/lock。
- release、migration 和 browser preflight 验证脚本补口。

这些是代码实现和离线测试结论，不等于真实宿主已验收。

## 验证证据

最终隔离快照：`/tmp/myagent-reliability-final-acceptance-20261113`

- `bash scripts/gate.sh` 自身退出码：0
- typecheck：通过
- build：通过
- test：通过，1343 tests passed
- artifact：通过，schema version 7
- 最终快照源码树 hash：`e869b2d3d06b22ed`
- 快照 `lib/index.js`：551241 bytes，SHA256 `4d8a3624fc34a734…`
- 本体当前 `lib/index.js` 未被本轮构建覆盖，仍为原有 SHA256 `7524842568f1c04b…`

测试还包括故障注入、变异和隔离回滚；具体批次见 [`42-reliability-repair-execution.md`](42-reliability-repair-execution.md) 和 [`43-reliability-repair-results.md`](43-reliability-repair-results.md)。

## 尚未完成的验收

以下事项不能由 1343 项离线测试替代：

1. 本修复树已经由插件管理在当前 DSH Host 上部署（`application: applied`），完成了一次受控重试；但真实模型、桥接收发与浏览器视觉验收仍未执行。
2. Telegram/Lark 等桥未做真实平台收发闭环验收。
3. 浏览器脚本现在支持依赖预检，但真实浏览器视觉、console、深链和大任务布局检查尚未执行。
4. 当前 Host 的 subagents API 主要支持 exact root tree teardown；非 root member 的局部子树停止不能安全表达，代码会拒绝而不是误停兄弟。需要 Host 能力或部署约束的真实验收。
5. 当前上传/拖拽附件使用受控 opaque upload id，限制单文件8MiB/单票32MiB、文件数10；Ticket创建后的receipt归属若在进程崩溃前未写完会保守保留为reserved，需要人工恢复，不能宣称exactly-once。
5. 直接 Host 工具、启动与停止重叠等在途写入已增加跟踪，但真实宿主取消/事件顺序仍未证明覆盖所有极端情况。
6. 外部工具执行与成功回执提交之间仍存在崩溃窗口，不宣称 exactly-once。
7. StateLock 的 unlink 失败恢复、旧版本二进制兼容和最终敏感信息扫描不在本轮完整验收内。

## 安全与部署边界

当前实现仍缺少：

- 用户身份认证和会话身份传递；
- Ticket、产物、设置和 API 的按用户/租户归属授权；
- OS 级 worker/子代理隔离；
- 面板/API 的宿主身份认证接入。

worker 仍可能以运行进程的 OS 权限工作。inbox 的文件系统访问者可提交被系统视为 `operator` 的请求；chat 身份映射是逻辑守卫，不是强认证。Project/Work 是任务组织和协作边界，不是多用户安全隔离。

因此：

- **个人受控试用**：可以考虑，使用独立 profile、独立 stateDir，限制 inbox、聊天映射和面板/API 访问者，并保留备份。
- **公开源码预览**：可以，前提是明确标注 experimental/preview，保留上述限制。
- **让不信任的多人直接使用**：不建议，当前不具备安全条件。
- **稳定发行版/生产部署**：当前不宣称具备条件。

## 发布状态

本文件由公开预览准备树生成，已随公开预览提交同步到 GitHub `main` 分支。它描述的是该提交对应的源码与隔离验证证据，**不是 Stable release 或 Production-ready 承诺**。真实 Host、模型、桥接收发和浏览器验收仍按上文限制执行。

补充：当前宿主默认要求经过认证的浏览器 Peer，命令行直接访问 `/myagent/` 或 API 会返回 401；已登录 DSH Web GUI 的浏览器可正常访问。`x-myagent-request` 只是同源围栏，不是用户身份认证。
