# 装进日常宿主（web profile）

前提：`pnpm check` 全绿（用例数以它的输出为准），阶段 E 的 12 条断言在隔离宿主里全部通过
（见 `docs/integration-checklist.md` 的验证结果表）。

**这一步会重启你正在用的宿主**，包括跑着当前对话的那个进程。选一个你可以接受刷新的时刻。

## 1. 装

现状：`~/.dsh/profiles/web/package.json` 里 `dependencies.myagent` 的 link 和
`node_modules/myagent` 都还在（上次安装留下的），**只差 bundles 数组里没有它**。所以只需两处改动：

```bash
# 1) 把 myagent 加进 bundles（顺序放在最后：它的 patch 要在 dsh-web-app 之后打）
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('~/.dsh/profiles/web/package.json')
d = json.loads(p.read_text())
bundles = d['dsh']['profile']['bundles']
if 'myagent' not in bundles:
    bundles.append('myagent')
p.write_text(json.dumps(d, indent=2) + '\n')
print('bundles =', bundles)
PY

# 2) 让宿主重新加载
```

**不需要重启宿主。** DSH 的 live profile 会立即应用变更：改完 `package.json` 的那一刻，正在跑的宿主就会加载 myagent；
之后每次改代码，在 GUI 的插件管理里把 myagent **关一下再开**，就会重新挂载并加载新构建
（`panel/index.html` 是每次请求现读的，所以面板改动刷新页面即可，连开关都不用动）。

真要重启的话，必须先停掉旧进程再起，否则新进程会因 `EADDRINUSE` 退出——启动日志里那串
"某插件缺少 webServer 服务"就是那个没起来的进程在等，不是已挂载实例的问题。

不用跑 `pnpm install`：link 已经存在。跑了也无害。

装好以后：

- 面板 <http://127.0.0.1:3080/myagent/>
- 状态目录仍是 `~/.dsh/state/myagent`，所以**阶段 E 的 6 张 Ticket、设置（`observe` + 每天 09:00 一条排期）都还在**
- 受理模式是 `observe`：到点只记录、不执行，一个 worker 都不会起

## 2. 验

```bash
cd ~/Documents/SA/myagent && ./scripts/verify-live.sh
```

这个脚本**只读**：不创建 Ticket、不创建 Session、不改设置。退出码 0 = 全过。
它查的是：面板挂载、同源守卫（三种不该给的请求都必须 403）、健康板、排期与下次触发、
预览接口、Ticket 与门禁记录可读。

想看更细的，用面板：

| 看什么 | 在哪 |
| --- | --- |
| 有没有问题 | 顶栏「状态」，鼠标悬停看详情 |
| 到点会不会跑 | 「排期」页，每条都有下次触发时间 |
| 门禁怎么判的 | 「门禁记录」页，`observed` = 本来会派但没派 |
| 工作目录在哪 | 顶栏「状态」气泡，或 Ticket 详情里的 `directory` |

## 3. 从 observe 到 auto

1. 让它按 `observe` 跑一天。09:00 那条排期会在「门禁记录」里留一条 `observed`。
2. 点开看：标题对不对、请求文本是不是你想要的、范围（scope）写得对不对。
   这一步是唯一能发现"我写的排期其实不是我以为的意思"的机会。
3. 没问题就在「设置」页把 `acceptMode` 改成 `auto`（或整份粘 `examples/daily-digest.json` 再改这一项）。
   改动立刻生效，在跑的 Ticket 会收到一条说明。
4. 第一次真跑，建议守着面板看它跑完：Ticket 从 `pending` → `running` → `done`，
   产出在 Ticket 自己的目录里，`RESULT.md` 是给人看的那一份。

`maxWorkers` 默认 2。想让它一次只跑一个（省 token、也更容易看清），在设置里改成 1。

## 4. 出问题就退

```bash
# 停止加载，保留安装与数据
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('~/.dsh/profiles/web/package.json')
d = json.loads(p.read_text())
d['dsh']['profile']['bundles'] = [b for b in d['dsh']['profile']['bundles'] if b != 'myagent']
p.write_text(json.dumps(d, indent=2) + '\n')
print('bundles =', d['dsh']['profile']['bundles'])
PY
# 然后重启宿主
```

或者在 GUI 的插件管理里把 myagent 停用。数据一律不动，重新加回去就接着用。

彻底清掉（**不可恢复**，会删掉所有 Ticket 记录和产出索引）：

```bash
rm -rf ~/.dsh/state/myagent            # 数据库、work 目录、inbox
# 会话日志（可选）：
ls -d ~/.dsh/sessions/*myagent* ~/.dsh/sessions/*-*-*-*-* 2>/dev/null   # 先看清楚再删
```

## 5. 改了代码以后怎么让宿主用上

| 改了什么 | 要怎么生效 |
| --- | --- |
| `panel/index.html` | 刷新页面即可（每次请求现读） |
| `src/**`（重新 `pnpm build` 之后） | 插件管理里把 myagent 关一下再开 |
| `cordis.patch.yml`、`package.json` 的 bundles | 同上；改 bundles 也可以直接重启宿主 |
| `examples/*.md`、`prompts/*.md` | 面板的「提示词」页读的是内置文件的副本，刷新即可；配方走 `GET /api/recipes`，也是现读 |

## 6. 装完以后我会验什么

告诉我装好了，我会做这几件事（都不改你的数据）：

1. 跑 `scripts/verify-live.sh`，把逐条结果贴给你
2. 读一次 `GET /api/state`，确认健康板干净、计数与阶段 E 留下的一致
3. 确认挂载期**没有**新建 Session（`mainSession.exists` 应当还是安装前的值）
4. 如果你同意，再投一个一次性的验收任务走完整链路（会创建一个 worker Session 和一个工作目录），
   跑完当场停掉

之后要不要把 09:00 那条排期从 `observe` 改成 `auto`，由你决定。
