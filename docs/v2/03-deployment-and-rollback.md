# 部署与回滚

本文说的是**已经在真实数据上验证过的步骤**，不是设想。凡是有证据的地方都写明了证据在哪；
凡是尚未验证的地方都直说。

## 0. 这套东西由什么组成

| 部件 | 位置 | 升级时会变吗 |
| --- | --- | --- |
| 插件包（代码） | `~/Documents/SA/myagent`，构建产物 `lib/index.js` | 每次升级都变 |
| 补丁行（挂载与 worker 预设） | `~/.dsh/profiles/<profile>/cordis.patch.yml` | 只在行定义变化时 |
| 状态目录 | `~/.dsh/state/myagent/`（可由 `stateDir` 改） | **数据在这里，升级不动它** |
| SQLite 库 | `<stateDir>/myagent.sqlite3`（+ `-wal`、`-shm`） | **schema 版本会变** |
| 设置文档 | 库里的 `kv` 行 `settings:document` | 只在操作者改设置时 |
| 提示词 | `prompts/*.md`（随包发布，可被面板覆写并存进库里） | 随包变；覆写值留在库里 |
| 面板 | `panel/index.html`（随包发布，由路由原样送出） | 随包变 |

**当前 schema 版本：5。** 版本历史见 §3。

## 1. 升级前必读：一个方向能回滚，另一个不能

`schema_version` 是"更旧的构建拒绝打开这个文件"的**唯一**开关。所以：

- **升级**（旧库 + 新代码）：安全。迁移阶梯会把库带到当前版本，且每一步都是加法的（§3）。
- **降级**（新库 + 旧代码）：**旧构建会抛 `SchemaTooNew` 并拒绝打开**，插件因此什么都不做。
  降级不是"装回旧包"就完事，必须同时把库降回去（§4）。

这是设计决定，不是缺陷：一个不认识的 schema 被旧代码写入，才是真正不可恢复的损坏。

## 2. 升级步骤

### 2.1 构建

```bash
cd ~/Documents/SA/myagent
pnpm check          # typecheck + 全部测试 + 构建；必须全绿
```

### 2.2 迁移演练（**在副本上**，线上库只读）

```bash
./scripts/verify-migration.sh            # 默认对 ~/.dsh/state/myagent/myagent.sqlite3 取快照演练
./scripts/verify-migration.sh <别的库>    # 也可以指定任何一个库
```

脚本做的事，以及为什么这么做：

1. 用 `VACUUM INTO` 取一致性快照。**不是 `cp`**：WAL 模式下只复制主文件会丢掉 `-wal` 里的内容，
   那不是备份而是残缺副本。源库自始至终以 `mode=ro` 打开。
2. 记录四张既存数据表（`triggers`、`tickets`、`decisions`、`kv`）的内容摘要。
   **摘要用显式列名，不是 `select *`**：`select *` 量的是表的形状，一次加列的迁移会让每行多出 NULL 字段、
   摘要因此变化，而操作者的数据一个字节都没动。第一版脚本就是这么把一次纯加法迁移误判成"数据被改动"的。
3. 用当前构建打开副本，触发迁移。
4. 重新取摘要并对比；检查新表在、死表不在；跑 `pragma integrity_check` 与 `foreign_key_check`。
5. **演练回滚**：把版本号改回 1，再取一次摘要。

只有全部通过（退出码 0，末行 `── 通过：可以升级线上库`）才继续。

**已验证的证据**（2026-11-03，对真实线上库的副本，10 triggers / 8 tickets / 10 decisions / 4 kv）：

```
迁移前：version=1  摘要=bcf92225a76e43e7
迁移后：version=5  摘要=bcf92225a76e43e7     ← 四张数据表逐字节未变
✓ artifacts 表已建   ✓ 死表 settings 已删除   ✓ integrity_check ok   ✓ foreign_key_check 干净
回滚演练：版本号改回 1 之后摘要仍为 bcf92225a76e43e7
旧构建需要的东西都在：8 行 ticket、主 Session 46 字节、cron 游标 151 字节、设置 1391 字节
```

### 2.3 备份

演练通过之后、动手之前，留一份真备份（演练用的是临时副本，跑完就删）：

```bash
sqlite3 "file:$HOME/.dsh/state/myagent/myagent.sqlite3?mode=ro" \
  "VACUUM INTO '$HOME/myagent-backup-$(date +%Y%m%d-%H%M%S).sqlite3'"
```

### 2.4 让宿主加载新构建

代码变了就必须让宿主重新加载它。**热重载不会自动发生**：正在跑的宿主持有的是它挂载时读到的 `lib/index.js`。

- 把插件在 profile 里关掉再打开，或者
- 重启宿主进程。

（不要另起一个宿主指向同一个 `stateDir`：单写者锁会拒绝它，那是设计。）

### 2.5 升级后核对

```bash
B=http://127.0.0.1:<端口>/myagent
H='x-myagent-request: 1'
curl -s -H "$H" "$B/api/state"    # health 应当干净；sources 三个都在；counts 与升级前一致
sqlite3 ~/.dsh/state/myagent/myagent.sqlite3 'select version from schema_version'   # 应当是当前版本
./scripts/verify-live.sh          # 端到端冒烟
```

`verify-live.sh` 目前有一个已知缺陷：**第 4 步对任何 `ok:false` 的健康条目都 `exit 1`**，
不区分"插件坏了"与"上游 429 / 你自己刚造出来的问题"。所以它退出 1 时先看是哪一条，别当成升级失败。

## 3. schema 版本历史

每一步都是**加法**：只加表、加索引、加 GENERATED VIRTUAL 列，不改任何既存列的形状，不重写任何既存记录。
这是"回滚 = 改一行版本号"能够成立的**唯一**理由，也是下一步必须重新评估的地方。

| 版本 | 加了什么 | 为什么这样加 |
| --- | --- | --- |
| 1 | 初始：`schema_version`、`triggers`、`tickets`、`decisions`、`kv`（以及一张从没人读写的 `settings`） | — |
| 2 | `artifacts` 表 + `artifacts_ticket(ticketId, at)`；删掉死表 `settings` | 产物登记表。删的是唯一一个从没人读也没人写的表 |
| 3 | `projects`、`works` 两表 + `works_project` 索引；`tickets` 加 `workId`、`workSeq` 两个 **GENERATED VIRTUAL** 列 + `tickets_work` 索引 | 用生成列而不是提升列：提升列由写入路径维护，会与它来源的记录静默分叉（旧构建重写该行时不更新提升列，索引就开始说谎）；生成列每次查询都从记录里读出来，不可能不一致 |
| 4 | `events` 表（PK `(ticketId, seq)`）+ `events_at` 索引 | 每张 Ticket 自己的历史。状态回答不了"按时间发生过什么"，因为 `mutate` 每次都重写整行 |
| 5 | `ticket_deps` 表（PK `(upstream, downstream)`）+ `deps_downstream` 索引 | 依赖边。id 就是两个端点，不带序号也不带时间戳 |

**两个踩过的 SQLite 陷阱**（都写进了代码注释，因为它们都是运行期错误、类型检查看不见）：

- `PRAGMA table_info` **不列出隐藏列**，而 GENERATED VIRTUAL 列就是隐藏列。
  迁移步骤的幂等检查如果用它，会以为列不存在、再 `ADD COLUMN` 一次，在**全新安装**上报
  `duplicate column name`。必须用 `PRAGMA table_xinfo`。
- `WITHOUT ROWID` 表**没有 rowid**，`ORDER BY rowid` 是运行期错误。

## 4. 回滚

### 4.1 首选：把版本号改回去

**成立的条件**：从当前版本回到目标版本之间的每一步都是纯加法的（§3 表格就是这张判断依据）。
成立时，旧构建既不读也不写新表，多出来的表对它不可见，所以改版本号就够了：

```bash
# 先停宿主，否则单写者锁在手上的那个进程会继续写
sqlite3 ~/.dsh/state/myagent/myagent.sqlite3 'update schema_version set version = 1'
```

然后装回旧构建并重启宿主。

**这一步已经在真实数据的副本上演练过**（§2.2 的第 5 步）：改回 1 之后四张表摘要不变，
旧构建需要的每一样东西都还在（ticket 行、主 Session id、cron 游标、设置文档）。

**什么时候不成立**：任何一步加了 NOT NULL 列、改了列的形状、重写了既存记录、或删了旧构建要读的表。
到那时唯一的回滚是 §2.3 的备份。所以每次改 schema 都必须重跑演练脚本，并在 §3 的表里写清这一步是不是加法。

### 4.2 兜底：恢复备份

```bash
# 停宿主，确认锁已释放
ls ~/.dsh/state/myagent/myagent.lock        # 应当不存在
mv ~/.dsh/state/myagent/myagent.sqlite3 ~/.dsh/state/myagent/myagent.sqlite3.bad
cp ~/myagent-backup-<时间戳>.sqlite3 ~/.dsh/state/myagent/myagent.sqlite3
```

注意这会丢掉备份之后的所有 Ticket、Schedule 变更与设置变更。inbox 目录里的文件不受影响
（它们在文件系统上，不在库里），但已经被受理并归档到 `accepted/` 的那些不会回来。

### 4.3 只回滚代码、不回滚数据

如果新版本的问题在代码而不在 schema（例如某个探测器误报），可以只装回旧构建**并保持库在新版本**——
但旧构建会因 `SchemaTooNew` 拒绝打开。所以这条路实际上不存在：**代码与 schema 版本必须一起回滚**。

## 5. 与数据无关的部分

- **设置文档**：schema 是 `.strict()` 的，**多一个不认识的键就整份解析失败**，而解析失败发生在 Runtime 构造函数里
  → `apply` 记一行日志就返回 → **插件静默什么都不做**。所以任何新的设置字段都必须可选或带默认值，
  新的块必须 `prefault({})`。这条规矩在 `sources.rule`、`watchdog`、以及三个来源的策略旋钮上都遵守了。
  降级到不认识新键的旧构建时，**新键会让旧构建解析失败**——所以降级前要把设置文档里的新块删掉。
- **提示词覆写**：存在库里的 `kv`，随数据一起回滚。
- **面板**：随包发布，无状态。
- **worker 预设**：是 `cordis.patch.yml` 里**独立的一行**，而且预设的修订版会被活着的 Agent 保留。
  所以改了 worker 的工具面之后，需要重启宿主**并且**让 worker Session 是新的——已在跑的 worker 会留着旧的组合。

## 6. 尚未验证的部分（不要当成已验证）

- 上面的迁移演练跑在**副本**上。**线上库当时是 version 1，但现在已经是 5** ——
  它不是我按这份文档的步骤升的，而是 `pnpm build` 触发了宿主热重载、在重新挂载时自动迁移的。
  事实、机制与影响见 `docs/v2/00-audit-and-plan.md` 的 **S37**。
  既存数据计数与演练完全一致（triggers=10 / tickets=8 / decisions=10 / kv=4）、`integrity_check ok`。
  **本文 §4.1 那句"首选：把版本号改回去"现在是一个真实可用的选项，而不是纸面推演**——
  因为库确实已经被升上去了。
- 隔离环境（独立 stateDir）里的 1 → 5 由验收代理验证，见 `docs/v2/02-live-acceptance-v2.md`。
- **新的、必须先读的一条**：在被生产宿主 `link:` 的项目目录里跑 `pnpm build` **会热重载那个宿主**。
  验证性构建要么在副本目录里做，要么先告知操作者。见纪律文档 §0.6。
- 降级路径演练的是"改版本号之后旧构建需要的数据都在"，**没有真的装回旧构建跑一遍**——
  因为旧构建的代码已经不在树里。要真验证，需要一个保留了 v1 构建的分支或标签。
- `scripts/verify-live.sh` 的第 4 步对健康条目的判断过粗（§2.5），已知未修。
