# 数据模型与迁移说明

权威来源是 `src/app/store.ts`（本文所有列定义都从它逐字取出，不是凭记忆写的）。
迁移的**操作步骤**与**回滚**在 `docs/v2/03-deployment-and-rollback.md`；本文讲的是**模型本身**与它为什么长成这样。

---

## 1. 一个贯穿全部设计的决定：JSON 记录是权威，列只用来查询

每张表都有一列 `record TEXT NOT NULL`，里面是那个实体的**完整 JSON**。
表上其它的列都是**从 record 派生出来的、可查询的副本**——用来 `WHERE`、`ORDER BY`、建索引，
而不是用来保存事实。

```sql
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL,
  open INTEGER NOT NULL,
  record TEXT NOT NULL,
  workId TEXT GENERATED ALWAYS AS (json_extract(record, '$.workId')) VIRTUAL,
  workSeq INTEGER GENERATED ALWAYS AS (json_extract(record, '$.workSeq')) VIRTUAL
) WITHOUT ROWID;
```

**为什么**：领域模型（`src/core/model.ts`）是一个有嵌套、有可选字段、有联合类型的 TypeScript 形状。
把它拆成关系列，每加一个字段就要一次迁移；把它当 JSON 存，加字段是**纯代码变更**，
而查询能力靠"挑几个字段提升成列"来补。

**代价，必须说清**：
- 数据库**不认识**这些字段之间的关系。列是从 JSON 里抽出来的，所以数据库无法阻止
  `record` 里的 `workId` 指向一个不存在的 Work。
- 提升成列的字段是**手挑的**，挑漏了就查不了（只能全表扫 + 解析 JSON）。
- 两个来源可能不一致：如果有人绕过 Store 直接改 `record`，派生列会自动跟着变
  （`GENERATED ... VIRTUAL` 是读时计算的），但**手写的非生成列不会**（如 `open`、`createdAt`）。

**推论**：**引用完整性由 Engine 保证，不由数据库保证**。这是"单 Engine 单写者"这条不变量
在存储层的直接后果——它不是风格偏好，而是这个数据模型能成立的前提。

---

## 2. 十一张表

| 表 | 主键 | 可查询列 | 存的是什么 |
| --- | --- | --- | --- |
| `schema_version` | 无（单行） | `version INTEGER NOT NULL` | 迁移阶梯的位置。**没有 PK/UNIQUE，`LIMIT 1` 也没有 `ORDER BY`**（见 §5 的已知弱点） |
| `triggers` | `id` | `source`、`kind`、`at`、`disposition` | 一次请求，以及门禁对它的处置。`disposition` 提升成列是为了让"被拒的请求"可以按类查询 |
| `tickets` | `id` | `createdAt`、`open`、`workId`✳、`workSeq`✳ | 一件工作。`open` 是 0/1，让"未结束的"可以走索引 |
| `decisions` | `id` | `triggerId`、`at`、`outcome` | 门禁的一次判断，含 `policyVersion`（在 record 里） |
| `projects` | `id` | `name`、`createdAt` | 分组：一组 Work |
| `works` | `id` | `projectId`、`name`、`createdAt` | 分组：一组 Ticket，`projectId` 可空 |
| `artifacts` | **(`ticketId`, `path`)** | `at` | 一次报告声称产出的文件。**复合主键 = 同一个路径的新声称替换旧的** |
| `events` | **(`ticketId`, `seq`)** | `at`、`type` | 一张 Ticket 的生命日志。复合主键保证 `seq` 在 Ticket 内唯一且单调 |
| `ticket_deps` | **(`upstream`, `downstream`)** | — | 依赖边。复合主键 = **一条边只有一条**，重复 `dependOn` 是幂等的 |
| `effects` | (`kind`, `key`) | `dueAt`、`running`、`failures` | 持久化的副作用队列。索引 `effects_due ON effects (dueAt, kind)`。**列名是 `running` 而不是 `claimed`**——「claimed」是代码里的概念名，写进数据模型文档就会让人去查一个不存在的列 |
| `kv` | `key` | — | 设置文档（`settings:document`）、提示词覆盖等。只有 `key`/`value` 两列 |

✳ = 生成列（见 §3）。

**三张表用复合主键，而且都是有意的**：`artifacts` 让"同一路径的新声称覆盖旧的"成为存储层的性质；
`events` 让 `seq` 成为身份的一部分（所以 Watchdog 重启后不会忘记它数过几次）；
`ticket_deps` 让一条边只存一次（所以"身份必须是它所标识之物的纯函数"这条原则在存储层也成立）。

---

## 3. 生成列，以及它带来的两个 SQLite 陷阱

`tickets.workId` 与 `tickets.workSeq` 是：

```sql
workId TEXT GENERATED ALWAYS AS (json_extract(record, '$.workId')) VIRTUAL
```

**为什么是生成列而不是普通列**：这两个字段是第 3 步迁移**加到已有表**上的。
如果加普通列，就得回填每一行的 JSON——一次数据改写，风险与收益不成比例。
生成列**读时从 record 计算**，所以加列不触碰任何既存数据，而且**可以建索引**
（`tickets_work ON tickets (workId, workSeq)`），于是"某个 Work 里的 Ticket 按序取出"是一次索引查询。

**陷阱一：`PRAGMA table_info` 看不到生成列。**
迁移的幂等检查原本用 `table_info(tickets)` 判断 `workId` 是否已存在——而生成列**被它省略**，
所以每次启动都以为列不存在、于是 `ALTER TABLE ... ADD COLUMN` 报 `duplicate column name: workId`。
**新装的环境反而起不来**。修法是改用 `PRAGMA table_xinfo(tickets)`，它包含隐藏列。
这个 bug 被源码与测试**各自独立撞到一次**。

**陷阱二：`STORED` 不能后加，`VIRTUAL` 可以。**
SQLite 允许 `ADD COLUMN ... GENERATED ALWAYS AS (...) VIRTUAL`，但**不允许** `STORED`。
`VIRTUAL` 是读时计算（写入不多花时间、读取每次算），对这两个字段够用，
因为查询频率远低于写入频率。

---

## 4. `WITHOUT ROWID`，以及它带来的第三个陷阱

所有实体表都是 `WITHOUT ROWID`（主键即 B-tree 的键，省一层间接）。

**陷阱三：没有 rowid，所以 `ORDER BY rowid` 是运行时错误。**
`Dependencies` 类最初按 `rowid` 排序取边——typecheck 看不出来（那是 SQL 字符串），
测试也没覆盖到那条路径，直到真跑才炸。
现在 `Dependencies` **按端点排序**（`ORDER BY upstream` / `ORDER BY downstream`），
并且 `byProject` 用 `projectId IS ?` 而不是 `= ?`，因为 `projectId` 可空、而 `NULL = NULL` 在 SQL 里不成立。

---

## 5. 迁移阶梯：1 → 5

| 版本 | 加了什么 | 为什么是这一步 |
| --- | --- | --- |
| 1 | 基线：`schema_version`、`triggers`、`tickets`、`decisions`、`effects`、`kv` | V1 |
| 2 | `artifacts`；**删掉从未被使用的 `settings` 表** | 产物登记（P1c）。删表是因为它从建库起就没有写入点，留着会让人以为设置在库里 |
| 3 | `projects`、`works`；`tickets` 加 `workId`/`workSeq` 生成列与 `tickets_work` 索引 | 分组（P1）。**用 `table_xinfo` 做幂等检查**（§3 陷阱一） |
| 4 | `events` | 生命日志（P2/P4）。Watchdog 的计数器必须跨重启存活，所以它进库而不是进内存 |
| 5 | `ticket_deps` 与 `deps_downstream` 索引 | 依赖图（P2） |

**每一步都是纯加法**（唯一的删除是第 2 步那张空表）。这一点**是回滚方案成立的前提**：
因为没有任何一步改写或丢弃既存数据，所以"把 `schema_version` 改回 1"对旧构建是安全的——
它会看到多出几张它不认识的表，而那些表它根本不查。

**如果将来出现破坏性的一步，这个前提就没了**，回滚将只剩"恢复备份"一条路。
所以 §6 的备份不是可选的礼貌，而是破坏性迁移的**前置条件**。

---

## 6. 迁移的安全性质（每条都有测试）

1. **事务性**：整个阶梯在一个事务里跑。任何一步抛错，**版本号保持原样、数据一个字节都不变**。
   测试用一个**故意冲突的 VIEW** 让 `CREATE TABLE IF NOT EXISTS` 抛错，然后断言版本仍是 1 且摘要不变。
   （这个测试的第一版是 `expect(true).toBe(true)`——一条永远不会失败的断言。它被换成了现在这条。）
2. **幂等**：每一步都能重复执行。第 3 步靠 `table_xinfo`，其余靠 `IF NOT EXISTS`。
3. **既存数据不动**：`verify-migration.sh` 在**副本**上比对迁移前后的摘要，
   摘要用**显式列名**而不是 `select *`——`select *` 量的是表的形状，一次加列就会让它变化，
   从而把一次纯加法迁移误判成"数据被改动"（第一版脚本真的这么误判过）。
4. **备份用 `VACUUM INTO`，不用 `cp`**：`cp` 一个 WAL 模式的库会拷到一个**不一致**的快照
   （主库文件与 `-wal` 分开拷）。`VACUUM INTO` 产出一个自洽的单文件。
5. **只读打开一个静默的 WAL 库需要 `immutable=1`**：`mode=ro` 在没有 `-shm` 兄弟文件时**打不开**，
   而这个工具存在的意义正是保护那个文件。这是 S34。
6. **过新的库被拒绝**：构建带的版本低于库里的版本时抛 `SchemaTooNew` 并且**在 rethrow 之前关闭 db**
   （否则句柄泄漏，测试里表现为几十个 `database is not open`）。

**已知弱点（未修）**：`schema_version` 没有 PK/UNIQUE，读它用的是 `LIMIT 1` 且**没有 `ORDER BY`**。
所以如果那张表里出现多行，读到哪一行是不确定的；而一个非整数的版本会被当成"没有版本"从而**静默重新盖章**。
正常路径下它只有一行，但这是一个"数据库被人手改过就会表现得很奇怪"的地方。

---

## 7. 数据模型里**没有**的东西

写下来是为了防止有人假设它们存在：

- **没有外键约束**（`grep -c "FOREIGN KEY" src/app/store.ts` = **0**，本轮实测）。没有任何一张表声明 `FOREIGN KEY`，所以 `foreign_key_check` 干净**不代表**引用完整——
  它只检查声明过的约束，而一条都没声明。完整性由 Engine 的检查保证（`require()`、`work_missing`、
  `project_missing`、`dependency_cycle`）。
- **没有对 `record` 的 JSON 做数据库级校验**。一份坏 JSON 会被存进去，直到读出来解析时才炸。
- **没有历史版本 / 软删除**。`artifacts` 的复合主键意味着**新声称覆盖旧声称**，旧值不留痕；
  Ticket 的 `ended` 是终态，没有"取消结束"。
- **没有跨实体的事务边界之外的约束**。例如"一个 Work 里的 `workSeq` 必须连续"不是数据库性质，
  而是 `attachWork` 计算 `count + 1` 的结果；并发下靠单写者保证。
- **没有多租户列**。`projects`/`works` 是分组，不是隔离边界
  （见 `docs/v2/06-security-risk-register.md` §5）。

---

## 8. 对既有数据的承诺

项目的硬规则之一是**不破坏已有的 Ticket / Schedule / Inbox / Session 数据**。这个模型如何兑现：

| 数据 | 存在哪 | V2 做了什么 |
| --- | --- | --- |
| Ticket | `tickets.record` | 只**加**了可选字段（`workId`、`workSeq`、`origin.depth`）。旧 Ticket 的这些字段是 `undefined`，序列化时**键不出现**——所以旧记录读出来仍然是合法的 `Ticket` |
| Schedule | `kv` 里的设置文档 + 内存游标 | 游标条目**加了** `spec` 指纹（用来发现"时刻改了而游标没跟上"）。旧游标没有这个字段时按"未知"处理，即重新计算——**不会**沿用旧槽位 |
| Inbox 文件 | 磁盘（不是数据库） | 归档名从**时间戳**改成 **`<triggerId>-<原名>`**。旧归档文件不受影响（它们已经是历史），新归档名是事件身份的纯函数，所以同一个请求被扫两次只产生一份归档 |
| Session | DSH 自己的持久化（不是 myagent 的库） | myagent 只存 sessionId。主 Session 改为**按需解析或创建**（B1），所以旧部署里没有主 Session 也不会丢回报 |

**一个容易被忽略的性质**：`JSON.stringify` **会丢掉值为 `undefined` 的键**，
而解析回来时那个键也是 `undefined`——所以对这个模型而言它恰好是**无损**的。
但这个性质曾经咬过人（B4：一个字段"消失"了，其实是它本来就是 `undefined`），
所以任何依赖"键存在与否"的代码都必须显式处理，而不能假设键一定在。

---

## 9. 状态标注

按五态词表（`docs/v2/00-audit-and-plan.md` §4.25 的裁定）：

| 能力 | 状态 |
| --- | --- |
| 11 张表与迁移阶梯 1→5 | **真宿主验证**（日常库已在 05:33:53 的那次挂载中由 1 迁到 5，既存数据计数与副本演练一致、`integrity_check ok`；见 S37） |
| 迁移的事务性、幂等、既存数据不动 | **离线验证**（`tests/store.spec.ts` 24 条，含 v1→当前、v2→当前、迁移中途抛错、新装 upsert） |
| `verify-migration.sh` 的副本演练与回滚演练 | **真宿主验证**（跑在日常库的 `VACUUM INTO` 副本上） |
| 生成列可被索引、`workSeq` 排序正确 | **离线验证** |
| 依赖边的幂等（复合主键） | **离线验证** |
| 外键约束 | **尚未实现**，而且是**刻意的**（§7）——不是遗漏 |
| `record` 的 JSON 数据库级校验 | **尚未实现** |
| 产物声称的历史留存 | **尚未实现**（覆盖是设计，见 §7） |
