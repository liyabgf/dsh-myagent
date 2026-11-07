#!/usr/bin/env bash
# 发布：把真源同步到公开副本、按性质脱敏、扫描暂存字节、bump 版本、提交推送、并从远端核实。
#
# 为什么要有这个脚本：前两次发布是手工做的，而**手工做的那次漏了两个真实的 DSH Web token**——
# 因为脱敏是按"我以为 token 长什么样"（UUID 形态）扫的，而它们是 base64url。
# 教训写成了纪律 0.12：**按性质扫，不按形态扫**。这个脚本就是那条纪律的执行体。
#
# 用法：
#   scripts/release.sh --dry-run 0.1.3     # 做完除 commit/push 之外的一切，并打印将要提交的内容
#   scripts/release.sh 0.1.3               # 真的发布
#
# 退出码是唯一判定（0.1）。任何一步失败都非 0 退出，且**不会**推送。
set -euo pipefail

SRC=~/Documents/SA/myagent
PUB=~/Documents/SA/myagent-public
REPO=liyabgf/dsh-myagent
MODE=release
VERSION="${1:-}"
if [ "$VERSION" = "--dry-run" ]; then MODE=dry; VERSION="${2:-}"; shift 2 2>/dev/null || shift $#; else shift 1 2>/dev/null || shift $#; fi
# 提交信息是可选的其余参数。**不给就用版本号**，但那是一条没有信息的提交信息，
# 而公开仓库的历史是别人判断"这个版本改了什么"的唯一入口——所以宁可要求调用者写。
MESSAGE="${*:-$VERSION}"
if [ -z "$VERSION" ]; then echo "用法：scripts/release.sh [--dry-run] <version> [提交信息…]" >&2; exit 2; fi

step() { printf '\n── %s\n' "$*"; }

# ── 1. 前置：真源的闸门必须是绿的 ─────────────────────────────────────────────
# 不在这里跑闸门：完整闸门要几分钟，而调用者通常刚跑过。改为**要求证据**——
# 日志存在、其最后一次运行是完整四步（不是 --quick）、且结论是通过。
step "1/7 前置检查"
log=/tmp/myagent-gate.log
[ -f "$log" ] || { echo "✗ 没有 ${log}：先在 ${SRC} 跑 ./scripts/gate.sh" >&2; exit 1; }
head -1 "$log" | grep -q 'scripts/gate.sh  *（' && ! head -1 "$log" | grep -q -- '--quick' \
  || { echo "✗ $log 的最后一次运行不是完整四步闸门（是 --quick 或无法辨认）；重跑 ./scripts/gate.sh" >&2; exit 1; }
grep -q '^结论：通过' "$log" || { echo "✗ 最后一次闸门未通过，不许发布" >&2; exit 1; }
echo "  ✓ 完整闸门通过：$(grep -E '^── 计数' "$log" | tail -1 | sed 's/^── //')"
echo "  ✓ 产物：$(grep '^结论：通过' "$log" | tail -1 | sed 's/^结论：通过。//')"
# 树必须静止（0.13 的补充：一个还在写的树量出来的东西没有意义）
# bridges/ 也在里面：它会被 rsync 同步进公开仓（排除清单里没有它），所以"树是否静止"必须把它算进去。
# 漏掉它的后果是——发布时正好有个桥文件在被写，公开仓收到半截文件，而两次测量都显示"静止"。
h1=$(cd "$SRC" && find src tests scripts panel prompts bridges -type f -exec shasum -a 256 {} + | shasum -a 256 | cut -c1-16)
sleep 2
h2=$(cd "$SRC" && find src tests scripts panel prompts bridges -type f -exec shasum -a 256 {} + | shasum -a 256 | cut -c1-16)
[ "$h1" = "$h2" ] || { echo "✗ 真源在两次测量之间变了（$h1 → ${h2}）：有东西还在写，先让它停下" >&2; exit 1; }
echo "  ✓ 真源静止（${h1}）"

# ── 2. 同步代码与文档；保留只在公开副本里存在的东西 ───────────────────────────
step "2/7 同步"
[ -d "$PUB/.git" ] || { echo "✗ ${PUB} 不是一个 git 仓库" >&2; exit 1; }
# 保留清单：这些是发布物自己的东西，真源里没有，删了就没了。
# 不靠"rsync 不加 --delete"来保它们——那会让真源里**删掉**的文件在副本里永远残留，
# 于是副本慢慢变成一份谁也不认识的混合物。显式保留 + 显式删除才是可核对的。
KEEP=(LICENSE SECURITY.md examples/real-run-1-collect examples/real-run-2-compare)
for k in "${KEEP[@]}"; do [ -e "$PUB/$k" ] || echo "  ! 保留项不存在：${k}（首次发布时应先创建）"; done
# `/lib` 而不是 `lib`：不带斜杠的 rsync 排除模式匹配**任何层级**的同名目录，于是 bridges/lib
# （六个套件模块）跟着顶层的 bundle 目录一起被排掉了——公开仓里的桥因此**跑不起来**
# （它们 import '../lib/*.mjs'），而当时的"7/7 远端核实"全绿，因为它只比 HEAD 与版本号。
# node_modules / .git / .DS_Store 保持不锚定：那三个正是"任何层级都要排"。
# 注：这段注释必须在 rsync **之前**——插在反斜杠续行中间的话，`#` 会被当成 rsync 的参数（试过，报 usage）。
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude /lib --exclude .DS_Store \
  --exclude LICENSE --exclude SECURITY.md --exclude 'examples/real-run-*' \
  "$SRC"/ "$PUB"/
cp -R "$SRC/lib/." "$PUB/lib/"
echo "  ✓ 代码、文档、prompts、panel、lib 已同步；保留项：${KEEP[*]}"

# 该同步的每一个文件都真的在公开仓工作树里吗？在**推送之前**查，否则会把一个坏树推上去再报错——
# 0.6.1 就是这么发生的：远端核实在第 7 步，而推送在第 6 步。
# 这个检查抓的是"排除清单或 .gitignore 悄悄吞掉了一个目录"，两次都发生过（rsync 的 lib、.gitignore 的 lib/）。
expected=$(cd "$SRC" && find src tests scripts panel prompts bridges docs -type f \
  ! -name '.DS_Store' ! -path '*/node_modules/*' | sort)
missing=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -e "$PUB/$f" ] || { echo "  ✗ 公开仓工作树缺：$f" >&2; missing=$((missing + 1)); }
done <<<"$expected"
[ "$missing" -eq 0 ] || { echo "✗ 少了 $missing 个文件，不发布（查 rsync 排除清单与 .gitignore 的锚定）" >&2; exit 1; }
echo "  ✓ 该发布的文件都在（$(grep -c . <<<"$expected") 个）"

# ── 3. 脱敏：按性质，不按形态 ────────────────────────────────────────────────
step "3/7 脱敏"
python3 - "$PUB" <<'PY'
import pathlib, re, sys, hashlib
root = pathlib.Path(sys.argv[1])
def h12(s): return hashlib.sha256(s.encode()).hexdigest()[:12]
stats = {}
def bump(k, n=1): stats[k] = stats.get(k, 0) + n
SKIP_DIRS = {'node_modules', '.git'}
TEXT = {'.md', '.ts', '.js', '.mjs', '.cjs', '.yml', '.yaml', '.json', '.py', '.html', '.sh', '.txt', '.tsv', '.csv', '.d.ts'}
for p in root.rglob('*'):
    if not p.is_file() or any(d in p.parts for d in SKIP_DIRS) or p.name == 'pnpm-lock.yaml':
        continue
    if p.suffix not in TEXT:
        continue
    try: s = p.read_text()
    except Exception: continue
    o = s
    # (a) 已知键后面的高熵值。**这是 0.12 的核心**：上一次漏掉的两个 token 就是因为只按 UUID 形态扫。
    for key in ('token', 'access_token', 'api_key', 'apikey', 'secret', 'password', 'authorization'):
        pat = re.compile(rf'((?:\?|&|\b){key}=)([A-Za-z0-9_.\-]{{16,}})')
        for m in set(pat.findall(s)):
            s = s.replace(f'{m[0]}{m[1]}', f'{m[0]}<{key}-sha256:{h12(m[1])}>')
            bump(f'{key}= 后的高熵值')
    # (b) UUID 形态（锁文件、会话 id）
    for m in set(re.findall(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', s)):
        s = s.replace(m, f'<uuid-sha256:{h12(m)}>'); bump('UUID')
    # (c) 本机身份：家目录、主机名、用户名。**用户名要最后替换**，否则 (a)(b) 的哈希前缀里若含它会二次替换。
    home = re.compile(r'/Users/[A-Za-z0-9._-]+')
    for m in set(home.findall(s)):
        s = s.replace(m, '~'); bump('家目录路径')
    if s != o: p.write_text(s)
print('  替换统计：' + (', '.join(f'{k} ×{v}' for k, v in sorted(stats.items(), key=lambda kv: -kv[1])) or '无可替换项'))
PY
# 主机名与用户名是项目特定的，所以放在这里而不是上面的通用规则里：
# 通用的部分（键后高熵、UUID、家目录）对任何项目都成立，特定的部分必须显式列出、可核对。
python3 - "$PUB" <<'PY'
import pathlib, sys, hashlib
root = pathlib.Path(sys.argv[1])
def h12(s): return hashlib.sha256(s.encode()).hexdigest()[:12]
# 每一项都是**实测出现过**的，不是想象出来的：见 docs/v2/00-audit-and-plan.md §4.60。
SPECIFIC = {
    '<host>': '<host>',
    'alice': 'alice',           # 测试夹具里的演员名，恰好是操作者的用户名
    # 操作者的电报数字 id 与 bot 用户名。两者都不是"秘密"——bot 用户名天生公开，数字 id 任何与他对话过的人都拿得到
    # ——但它们是**个人数据**，而这个仓是公开的。原先漏掉是因为脱敏按"我以为要保护什么"列的：token、主机名、UUID，
    # 而没有"这个人是谁"。0.7.0 就把 bot 用户名发出去了，0.8.1 又把 id 发出去了，两次都没被扫描拦住。
    '<telegram-user-id>': '<telegram-user-id>',
    '<bot-username>': '<bot-username>',
    '<bot-id>': '<bot-id>',
    '-100200300': '-100200300',
    '<操作者当时那个会话的任务标题>': '<操作者当时那个会话的任务标题>',
}
n = 0
for p in root.rglob('*'):
    if not p.is_file() or 'node_modules' in p.parts or p.name == 'pnpm-lock.yaml' or p.suffix not in {
            '.md', '.ts', '.js', '.mjs', '.cjs', '.yml', '.json', '.py', '.html', '.sh', '.txt'}:
        continue
    try: s = p.read_text()
    except Exception: continue
    o = s
    for k, v in SPECIFIC.items():
        if k in s:
            n += s.count(k)
            s = s.replace(k, v)
    if s != o: p.write_text(s)
print(f'  项目特定项替换：{n} 处')
PY

# ── 4. 扫描暂存字节（不是工作区）─────────────────────────────────────────────
step "4/7 扫描暂存字节"
cd "$PUB"
git add -A
bad=0
# 形态类：这些都是**实测漏过或差点漏过**的，所以逐个点名，不靠一个通用正则。
# `/Users/[A-Za-z]` 而不是裸 `/Users/`：裸的会命中三种假阳性，全是**描述规则的地方**而不是泄漏——
# 计划文档里写的 `/Users/<name>`、本脚本自己的正则 `/Users/[A-Za-z0-9._-]+`、以及本脚本的扫描模式 `'/Users/'`。
# **猎手必然含有猎物的形状**，所以模式要匹配"真实家目录的样子"（斜杠后直接是字母），
# 而不是"任何提到这个前缀的地方"。
# 另一件自指的事：脱敏会把本脚本里的 'alice' 换成 'alice'，所以**公开副本里的 release.sh 与真源不是同一份**。
# 这不要紧（发布用的是真源里的那份），但它意味着**不能拿副本里的脚本去发布**——那样它扫的就是 'alice' 了。
for pat in '/Users/[A-Za-z]' 'Mac\.lan' 'alice' '<telegram-user-id>' '<bot-username>' '<bot-id>' '-100200300' \
  '[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}' \
           '?token=[A-Za-z0-9_-]\{16,\}' '_authToken=[A-Za-z0-9]' '-----BEGIN [A-Z]'; do
  # 后两个模式收紧成"真实泄漏的形状"而不是"提到这个词"：本脚本自己的模式列表里就含有字面量
  # '_authToken' 与 '-----BEGIN'，而**猎手必然含有猎物的形状**。排除本脚本会留下真盲区，
  # 所以正确做法是让模式匹配 `_authToken=` 后跟值、`-----BEGIN ` 后跟类型——
  # 那才是一条凭据，而提到这个词不是。
  # `|| true` 是必需的，不是防御性写法：git grep 无命中时退出 1，而 set -o pipefail 会让整条管道失败、
  # set -e 随即杀掉脚本——于是"干净"这件事表现得像一次崩溃。**一个只在有发现时才能跑完的检查，
  # 等于在最需要它通过的那一次不可用。**
  n=$( { git grep --cached -I -l -E "$pat" 2>/dev/null || true; } | wc -l | tr -d ' ')
  printf '  %-42s %s 个文件\n' "$pat" "$n"
  [ "$n" != "0" ] && bad=1
done
# 性质类：已知键后面的高熵值（脱敏应当已经把它们换成 <…-sha256:…> 了，所以这里应当为 0）
n=$(git grep --cached -I -o -E '(token|secret|api_key|password)=[A-Za-z0-9_-]{16,}' 2>/dev/null | grep -vc 'sha256:' || true)
printf '  %-42s %s 处\n' '键后高熵值（未脱敏的）' "${n:-0}"
[ "${n:-0}" != "0" ] && bad=1
if [ "$bad" != "0" ]; then
  echo "✗ 扫描未通过。**不推送。** 逐处判断它在证明什么，再决定换成哈希前缀还是删掉整句" >&2
  echo "  （不要一律换成 redacted：那些位置往往是在证明「两次采样逐字相同」，抹掉值会让结论留下而证据消失）" >&2
  exit 1
fi
echo "  ✓ 暂存字节干净"

# ── 5. 版本 ──────────────────────────────────────────────────────────────────
step "5/7 版本 $VERSION"
python3 - "$PUB/package.json" "$VERSION" <<'PY'
import json, sys, pathlib, collections
p = pathlib.Path(sys.argv[1]); d = json.loads(p.read_text(), object_pairs_hook=collections.OrderedDict)
old = d.get('version')
d['version'] = sys.argv[2]
d.pop('private', None)                      # npm/pnpm 拒绝安装 private 包
d['license'] = 'MIT'
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
print(f'  {old} → {sys.argv[2]}')
PY
git add -A

# ── 6. 提交与推送 ────────────────────────────────────────────────────────────
step "6/7 提交与推送"
echo "  将要提交的文件数：$(git diff --cached --name-only | wc -l | tr -d ' ')"
echo "  随包发布但不进 bundle 的文件（W4 的清单，供与上次发布比对）："
(cd "$SRC" && ./scripts/gate.sh --shipped-only | tail -n +2 | sed 's/^/    /')
if [ "$MODE" = dry ]; then
  echo "  --dry-run：不提交、不推送。以上即全部检查结果。"
  echo "  注意：dry-run 只重置索引，**公开副本的工作区已经被同步与脱敏改过了**。"
  echo "        这是刻意的——否则第 3、4 步就无法检查真实的字节。副本是派生物，下一次真发布会覆盖它。"
  git reset -q
  exit 0
fi
git commit -q -m "$MESSAGE" || { echo "  （没有变化可提交）"; }
git push -q origin main
echo "  ✓ 已推送 $(git rev-parse --short HEAD)"

# ── 7. 从远端核实 ────────────────────────────────────────────────────────────
# **不用 raw.githubusercontent**：它有 CDN 缓存，0.1.2 那次它落后于真实提交，
# 于是我差点去查一个不存在的提交问题（§4.60）。用 gh api，它打到 API 而不是缓存。
step "7/7 从远端核实"
remote_head=$(git ls-remote origin -h refs/heads/main | cut -f1)
local_head=$(git rev-parse HEAD)
[ "$remote_head" = "$local_head" ] || { echo "✗ 远端 HEAD $remote_head ≠ 本地 $local_head" >&2; exit 1; }
echo "  ✓ HEAD 一致：${local_head:0:12}"
gh api "repos/$REPO/contents/package.json?ref=main" --jq '.content' 2>/dev/null | base64 -d \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"  远端 version: {d['version']} | license: {d['license']} | private: {d.get('private','（无）')}\")"
gh api "repos/$REPO/commits/main" --jq '"  远端最新提交: " + .sha[0:12] + "  " + (.commit.message | split("\n")[0])'
# 远端必须有本地要发布的每一个文件。只比 HEAD 与版本号看不出"少同步了一整个目录"——
# bridges/lib 就这么丢过一次，而核实步骤报了全绿。
expected=$(cd "$SRC" && find src tests scripts panel prompts bridges docs -type f \
  ! -name '.DS_Store' ! -path '*/node_modules/*' | sort)
remote_paths=$(gh api "repos/$REPO/git/trees/main?recursive=1" --jq '.tree[].path' 2>/dev/null | sort)
missing=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  grep -qxF "$f" <<<"$remote_paths" || { echo "  ✗ 远端缺：$f" >&2; missing=$((missing + 1)); }
done <<<"$expected"
[ "$missing" -eq 0 ] || { echo "✗ 公开仓少了 $missing 个文件（同步或排除清单有问题）" >&2; exit 1; }
echo "  ✓ 远端文件齐全：$(grep -c . <<<"$expected") 个（src tests scripts panel prompts bridges docs）"
echo "  ✓ 发布完成。安装命令：install_bundle target: github:$REPO"
