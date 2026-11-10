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
#   scripts/release.sh --selftest-scan <一次性 git 仓路径>
#       只跑第 4 步那段扫描逻辑，指着一个 /tmp 里的仓自测"无命中不误判为崩溃、有命中必失败"。
#       不发布、不碰公开副本、不读闸门日志。存在的理由是：那段逻辑里有 `|| true` 与 pipefail 的交互，
#       而它只有在真发布时才跑得到——不能靠"下次发布时看看"来验证一条纪律。
#
# 退出码是唯一判定（0.1）。任何一步失败都非 0 退出，且**不会**推送。
#
# ┌────────────────────────────────────────────────────────────────────────────────┐
# │ 横幅：如果你是在**公开仓**里读到这一段，那么这一份 release.sh 不含隐私黑名单。    │
# │ 项目特定的替换字典与第 4 步的扫描模式表都在 scripts/.private-blocklist 里，      │
# │ 那个文件按设计不进公开仓（rsync 显式排除 + .gitignore 收着）。                   │
# │ 所以：**禁止用公开副本里的这份脚本发布**。用它发布的话，脚本会因为找不到黑名单    │
# │ 而 exit 1（这是刻意的）；万一有人绕过它，真实标识符会被原样推上去，而扫描报全绿   │
# │ ——因为它扫的就是占位串。发布只能在真源树里跑那份带黑名单的脚本。                 │
# │ 这段横幅不含任何真实标识符，所以它在脱敏之后依然成立（脱敏只把家目录换成 ~）。    │
# └────────────────────────────────────────────────────────────────────────────────┘
set -euo pipefail

SRC=~/Documents/SA/myagent
PUB=~/Documents/SA/myagent-public
REPO=liyabgf/dsh-myagent
# 隐私黑名单（字典 + 模式表）。外置的理由写在 load_blocklist 上面。
# 可以用 MYAGENT_BLOCKLIST 指到别处，那是为了**自测**（--selftest-scan 要能造一份带 [binary-ok] 的副本）；
# 真发布不许设它。即使设了也占不到便宜：load_blocklist 要求两段都非空、且每个字面量都被某条模式覆盖，
# 一个空文件会让发布当场失败，而不是静默降级成"没有项目特定项"。
BLOCKLIST="${MYAGENT_BLOCKLIST:-$SRC/scripts/.private-blocklist}"
# 脱敏的后缀白名单：**只能有一份**，两段 python 都从这个变量读（经 argv 传进去）。
# 事故：通用段的白名单含 .csv .tsv .yaml .d.ts，项目特定段不含——公开仓里 19 个受控后缀文件
# （11 个 .tsv、6 个 .csv、pnpm-lock.yaml、lib/index.d.ts）中，那 17 个表格与那把锁文件
# **从来没有经过项目特定字典**，真实标识符就躺在 examples/real-run-*/ 的表格里发出去了。
# 而第 4 步的模式扫描抓不到它们：那些标识符出现在表格的**值**里，形态上不命中任何一条模式 → 全绿。
# 两份白名单各自维护，迟早再次分叉；所以不许有两份。
# 注：pathlib 的 `Path('index.d.ts').suffix` 是 '.ts' 而不是 '.d.ts'，所以下面 python 侧
# 除了按 suffix 匹配，还额外认一次"名字以 .d.ts 结尾"——否则 '.d.ts' 这一项就是一句空话。
TEXT_SUFFIXES='.md .ts .js .mjs .cjs .yml .yaml .json .py .html .sh .txt .tsv .csv .d.ts'
MODE=release
SELFTEST_REPO=''
if [ "${1:-}" = "--selftest-scan" ]; then
  # 自测模式：只跑第 4 步的扫描逻辑，指着一个一次性仓。不发布、不碰公开副本、不读闸门日志。
  MODE=selftest
  SELFTEST_REPO="${2:-}"
  VERSION=selftest
  MESSAGE=selftest
  if [ -z "$SELFTEST_REPO" ]; then echo "用法：scripts/release.sh --selftest-scan <git 仓路径>" >&2; exit 2; fi
else
  VERSION="${1:-}"
  if [ "$VERSION" = "--dry-run" ]; then MODE=dry; VERSION="${2:-}"; shift 2 2>/dev/null || shift $#; else shift 1 2>/dev/null || shift $#; fi
  # 提交信息是可选的其余参数。**不给就用版本号**，但那是一条没有信息的提交信息，
  # 而公开仓库的历史是别人判断"这个版本改了什么"的唯一入口——所以宁可要求调用者写。
  MESSAGE="${*:-$VERSION}"
  if [ -z "$VERSION" ]; then echo "用法：scripts/release.sh [--dry-run] <version> [提交信息…]" >&2; exit 2; fi
fi

step() { printf '\n── %s\n' "$*"; }

# ── 隐私黑名单：字典与模式表都在仓库外 ────────────────────────────────────────
# 为什么必须外置：SPECIFIC 字典与第 4 步的模式表原先就写在本脚本里，而本脚本会被 rsync 同步进公开副本，
# 于是副本里的那份**自己把自己脱敏成空操作**——字典变成 `'<bot-id>': '<bot-id>'`（键先被替换成了占位串），
# 模式表变成"去公开仓里搜占位串"。任何人从公开仓 clone 之后拿它发布，真实标识符会被原样推上去，
# 而扫描报全绿：它搜的就是刚刚被换上去的那些占位串。
# 当时只要做到这一步就能避免：**让猎手不住在猎场里**——两张表搬进 scripts/.private-blocklist，
# rsync 显式排除、.gitignore 收着，脚本读它；文件缺失就 exit 1，绝不静默降级成"这个项目没有特定项"。
SPECIFIC_KEYS=()
SPECIFIC_VALS=()
PATTERNS=()
BINARY_OK=()

# 把两边的空白去掉（bash 3.2 没有 ${var,,} 之类的便利，也没有 readarray，所以手工来）
trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

load_blocklist() {
  if [ ! -f "$BLOCKLIST" ]; then
    echo "✗ 缺少隐私黑名单：${BLOCKLIST}" >&2
    echo "  它按设计不进公开仓（rsync 排除 + .gitignore），所以从公开仓 clone 出来的树里没有它是**正常**的，" >&2
    echo "  也正因如此这份脚本不能用来发布（见文件开头的横幅）。" >&2
    echo "  怎么办：从操作者的私有备份取回 scripts/.private-blocklist，放回 ${BLOCKLIST}，再重跑。" >&2
    echo "  **不许**为了跑通而新建一个空文件：那等于把项目特定脱敏与第 4 步的模式表一起清空，" >&2
    echo "  发布会照常推送真实标识符，而扫描报全绿——那就是 0.7.0／0.8.1 那两次事故的形状。" >&2
    exit 1
  fi
  local section='' line key val stripped
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"                       # CRLF 编辑器会在模式尾巴上留一个 \r，那会让正则失配
    stripped=$(trim "$line")
    case "$stripped" in
      '')    continue ;;                       # 空行
      '#'*)  continue ;;                       # 注释（缩进过的也算，与 python 侧的解析保持一致）
      '['*']') section="${stripped#[}"; section="${section%]}"; continue ;;
    esac
    case "$section" in
      specific)
        case "$line" in
          *'=>'*) key=$(trim "${line%%=>*}"); val=$(trim "${line#*=>}") ;;
          *) echo "✗ 黑名单 [specific] 这一行没有 '=>' 分隔符：${line}" >&2; exit 1 ;;
        esac
        [ -n "$key" ] || { echo "✗ 黑名单 [specific] 有一项的键是空的：${line}" >&2; exit 1; }
        SPECIFIC_KEYS+=("$key"); SPECIFIC_VALS+=("$val") ;;
      patterns)  PATTERNS+=("$line") ;;         # 模式**逐字**收下：前导/尾随空格可能是模式的一部分
      binary-ok) BINARY_OK+=("$stripped") ;;
      '')        echo "✗ 黑名单第一行不是段落标记（应为 [specific] / [patterns] / [binary-ok]）：${line}" >&2; exit 1 ;;
      *)         echo "✗ 黑名单里有无法辨认的段落 [${section}]（行：${line}）" >&2; exit 1 ;;
    esac
  done < "$BLOCKLIST"
  # 空表就是"降级成没有项目特定项"，而那正是事故本身，所以要当场失败而不是安静地扫 nothing。
  if [ "${#SPECIFIC_KEYS[@]}" -eq 0 ]; then
    echo "✗ 黑名单的 [specific] 段是空的：那等于取消了项目特定脱敏。请核对 ${BLOCKLIST}" >&2; exit 1
  fi
  if [ "${#PATTERNS[@]}" -eq 0 ]; then
    echo "✗ 黑名单的 [patterns] 段是空的：那等于取消了第 4 步的扫描。请核对 ${BLOCKLIST}" >&2; exit 1
  fi
  # 自洽不变式：每一个"要被替换掉的字面量"，也必须有一条扫描模式能抓住它。
  # 少了这一条，"往字典里加了新标识符、忘了加模式"就只能靠人记住——而这次要修的事故
  # （0.7.0 发出 bot 用户名、0.8.1 发出数字 id）根源正是"两处清单各自维护、没人对账"。
  local k p covered
  for k in ${SPECIFIC_KEYS[@]+"${SPECIFIC_KEYS[@]}"}; do
    covered=0
    for p in ${PATTERNS[@]+"${PATTERNS[@]}"}; do
      if printf '%s' "$k" | grep -qE -e "$p" 2>/dev/null; then covered=1; break; fi
    done
    if [ "$covered" -eq 0 ]; then
      echo "✗ 黑名单不自洽：[specific] 里的字面量没有任何一条 [patterns] 能匹配它（键长 ${#k} 字）。" >&2
      echo "  替换与扫描必须覆盖同一批东西，否则字典里那一项只是「发布时替换一次」，" >&2
      echo "  而漏掉它的文件（后缀不在白名单里、或是二进制）永远不会被发现。请把该字面量补进 [patterns]。" >&2
      exit 1
    fi
  done
  echo "  ✓ 隐私黑名单已载入：项目特定项 ${#SPECIFIC_KEYS[@]} 条、扫描模式 ${#PATTERNS[@]} 条、二进制白名单 ${#BINARY_OK[@]} 条"
}

# ── 第 4 步的扫描逻辑（自测模式也跑它，所以它是真代码而不是副本）──────────────
# 返回 0＝暂存字节干净；非 0＝有命中或有模式报错。
scan_staged_bytes() {
  local repo="$1"
  cd "$repo"
  local bad=0 pat n code hits errf tracked scannable leaked ign unjudged f ok x
  errf=$(mktemp /tmp/myagent-scan-err.XXXXXX)
  for pat in ${PATTERNS[@]+"${PATTERNS[@]}"}; do
    # git grep 的退出码是三态的：0＝有命中，1＝无命中，>1＝模式或仓库有问题。
    # 原先写的是 `… || true`：它把"无命中"与"模式非法"一起吞掉，然后 `wc -l` 报 0 个文件、
    # 于是**一条跑不起来的模式表现得像一条干净的模式**。实测这不是假想：原表里
    # `?token=…`（ERE 里 `?` 开头的重复算符没有操作数）与 `[0-9a-f]\{8\}…`（ERE 里 `\{` 是字面量）
    # 两条都是死的，而 11 条模式打印出来全是"0 个文件"，看上去像全绿。
    # 纪律 0.1 的读法在这里就是：无命中不是崩溃（照常继续），模式报错是失败（bad=1）。
    code=0
    hits=$(git grep --cached -I -l -E -e "$pat" 2>"$errf") || code=$?
    if [ "$code" -gt 1 ]; then
      echo "  ✗ 模式跑不起来（git grep 退出码 ${code}）：${pat}"
      echo "    报错：$(head -c 200 "$errf" | tr '\n' ' ')"
      echo "    一条报错的模式等于没有这条模式，而它打印出来的仍然是「0 个文件」。"
      bad=1
      continue
    fi
    n=$(printf '%s' "$hits" | grep -c . || true)
    printf '  %-46s %s 个文件\n' "$pat" "$n"
    if [ "$n" != "0" ]; then bad=1; fi
  done
  rm -f "$errf"
  # 性质类：已知键后面的高熵值（脱敏应当已经把它们换成 <…-sha256:…> 了，所以这里应当为 0）
  code=0
  n=$(git grep --cached -I -o -E -e '(token|secret|api_key|password)=[A-Za-z0-9_-]{16,}' 2>/dev/null | grep -vc 'sha256:' || true)
  printf '  %-46s %s 处\n' '键后高熵值（未脱敏的）' "${n:-0}"
  if [ "${n:-0}" != "0" ]; then bad=1; fi
  # 盲区 (i)：`git grep --cached -I` 的 -I 会**跳过二进制文件**，于是任何二进制里的标识符都扫不到。
  # 断言"索引里的文件数 == 能被扫描的文件数"，不等就说明有二进制躲过了扫描 → 交人工判定。
  # 判定结果可以写进黑名单的 [binary-ok] 段（一行一个路径），那是显式的、可核对的放行；
  # 没有这一段就一律失败——不许把"扫不到"默认当成"没有"。
  tracked=$(git -c core.quotepath=false ls-files | grep -c . || true)
  scannable=$(git -c core.quotepath=false grep --cached -Il -e '' | grep -c . || true)
  printf '  %-46s %s / %s\n' '索引文件数 / 可扫描（文本）文件数' "$tracked" "$scannable"
  if [ "$tracked" != "$scannable" ]; then
    leaked=$(comm -23 \
      <(git -c core.quotepath=false ls-files | LC_ALL=C sort) \
      <(git -c core.quotepath=false grep --cached -Il -e '' | LC_ALL=C sort) || true)
    echo "  ✗ 有文件躲过了扫描（-I 跳过二进制）："
    printf '%s\n' "$leaked" | sed 's/^/      /'
    local unjudged_n=0
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      ok=0
      for x in ${BINARY_OK[@]+"${BINARY_OK[@]}"}; do [ "$x" = "$f" ] && ok=1 && break; done
      if [ "$ok" -eq 0 ]; then unjudged_n=$((unjudged_n + 1)); echo "      未经人工判定：$f"; fi
    done <<<"$leaked"
    if [ "$unjudged_n" -gt 0 ]; then
      echo "  ✗ ${unjudged_n} 个二进制文件从未被扫描过。逐个打开确认里面没有隐私数据，" >&2
      echo "    然后把路径写进 ${BLOCKLIST} 的 [binary-ok] 段（一行一个），再重跑。" >&2
      echo "    在那之前不许发布：扫描报的「干净」并不包含它们。" >&2
      bad=1
    else
      echo "  ! 上述文件已在黑名单 [binary-ok] 段里被人工判定过，放行（它们仍然不被扫描）。"
    fi
  fi
  # 盲区 (ii)：.gitignore 里的文件**根本不进索引**，git grep --cached 看不见它们。
  # 不阻断（被忽略的东西本来就不发布），但要列出来让人确认里面没有隐私数据——
  # 本仓的 /lib/ 就曾被 .gitignore 吞掉过（那次是"该发布的没发布"，这次要防的是"该扫的没扫"）。
  # 只报 `!!`（被忽略）与 `??`（未跟踪）：这一段跑在 `git add -A` 之后，正常的暂存状态
  # （`A `/`M `）是**要被提交、也已经被扫描**的东西，把它们列进来只会让警告变成噪音，
  # 而一条全是噪音的警告会被忽略，那比没有警告更坏（0.2）。第一版就是直接打了整份 status。
  ign=$(git status --porcelain --ignored 2>/dev/null | grep -E '^(\!\!|\?\?)' || true)
  if [ -n "$ign" ]; then
    echo "  ! 工作树里有**不在索引里**的条目（不阻断；它们不被扫描，请人工确认里面没有隐私数据）："
    printf '%s\n' "$ign" | sed 's/^/      /'
    printf '%s\n' "$ign" | grep '^!!' | sed 's/^!! //' | while IFS= read -r p; do
      [ -n "$p" ] || continue
      if [ -d "$p" ]; then
        echo "      （被忽略的目录 ${p}：$(find "$p" -type f 2>/dev/null | grep -c . | tr -d ' ') 个文件在工作树里，索引里没有）"
      fi
    done
  fi
  if [ "$bad" != "0" ]; then
    echo "✗ 扫描未通过。**不推送。** 逐处判断它在证明什么，再决定换成哈希前缀还是删掉整句" >&2
    echo "  （不要一律换成 redacted：那些位置往往是在证明「两次采样逐字相同」，抹掉值会让结论留下而证据消失）" >&2
    return 1
  fi
  echo "  ✓ 暂存字节干净"
  return 0
}

load_blocklist

if [ "$MODE" = selftest ]; then
  # 自测：只跑扫描。要求那个仓已经 git add 过（扫的是暂存字节，不是工作区）。
  step "自测：第 4 步的扫描逻辑 → $SELFTEST_REPO"
  [ -d "$SELFTEST_REPO/.git" ] || { echo "✗ ${SELFTEST_REPO} 不是一个 git 仓（自测要在 /tmp 下的一次性仓里做，别指着真源或公开副本）" >&2; exit 2; }
  if scan_staged_bytes "$SELFTEST_REPO"; then echo "  自测结果：干净（退出码 0）"; exit 0; else echo "  自测结果：未通过（退出码 1）"; exit 1; fi
fi

# 发布必须从真源树里跑那份脚本：公开副本里的这份不带黑名单（横幅说的就是这件事）。
# 这条断言把"用错脚本"从一个靠人记住的约定变成一个会失败的检查——脱敏会把副本里的 SRC 换成 ~，
# 于是它多半会在第 1 步就找不到闸门日志，但那是**碰巧**，不是设计。
SELF_TREE=$(cd "$(dirname "$0")/.." && pwd)
if [ "$SELF_TREE" != "$SRC" ]; then
  echo "✗ 这份 release.sh 位于 ${SELF_TREE}，而它要发布的真源是 ${SRC}。" >&2
  echo "  如果你是从公开仓 clone 来的：公开副本里的那份**不含隐私黑名单**，" >&2
  echo "  用它发布等于取消项目特定脱敏与扫描模式表。请到真源树里跑那份。" >&2
  exit 1
fi

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
# ── 闸门证据必须对应**这一棵树**：陈旧日志识别 ────────────────────────────────
# 事故：日志里原先没有任何源码树哈希，前置检查只 grep 了两句固定的话（首行像不像完整闸门、
# 有没有 ^结论：通过），而这两句话都不随源码变化。于是"上一次跑完闸门之后又改了一批文件"
# 这件事对第 1 步完全不可见——发布照跑，公开仓收到的是没被验过的树，而第 7 步的远端核实全绿
# （它比的是 HEAD 与版本号，两者都与"验过哪棵树"无关）。
# 当时只要做到这一步就能避免：把树的指纹写进日志本身（gate.sh 的 emit_tree_hash_line），
# 发布前用**同一份实现**重算（gate.sh --tree-hash，避免两处管道漂移）并比对，不等就拒绝发布。
log_tree=$(grep -E '^── 源码树哈希：' "$log" | tail -1 | grep -oE '[0-9a-f]{16}' | tail -1 || true)
if [ -z "$log_tree" ]; then
  echo "✗ ${log} 里没有「── 源码树哈希：」这一行。" >&2
  echo "  这是一份旧格式的闸门日志：它无法证明自己验的是哪一棵树，而那正是陈旧日志能骗过前置检查的原因。" >&2
  echo "  **不当作通过**。请在 ${SRC} 重跑 ./scripts/gate.sh（完整四步）再发布。" >&2
  exit 1
fi
now_tree=$(cd "$SRC" && ./scripts/gate.sh --tree-hash)
if [ "$log_tree" != "$now_tree" ]; then
  echo "✗ 闸门证据对应的是另一棵树：日志里是 ${log_tree}，此刻的真源是 ${now_tree}。" >&2
  echo "  也就是说闸门跑完之后源码或产物又变了，那份「结论：通过」不为现在这棵树作证。" >&2
  echo "  请重跑 ./scripts/gate.sh（完整四步）再发布。" >&2
  exit 1
fi
echo "  ✓ 闸门证据对应这一棵树（源码树哈希 ${now_tree}；取样范围见 gate.sh 的 TREE_SAMPLE）"
# 日志里那份随包清单的哈希逐个再比一遍。这是免费的（文件都在原地），而且比一个聚合值更有用：
# 它会说出**哪一个**文件变了。lib/ 不在随包清单里（gate.sh 把 bundle 目录排除了），
# 所以产物哈希单独比一次；两者合起来才覆盖"会随包发布的一切"。
mf_n=0
mf_bad=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  rel=${line#"${line%%[![:space:]]*}"}          # 去掉行首空白
  path="${rel%%  *}"                            # gate.sh 的输出格式是「路径 + 两个空格 + sha256」
  want="${rel##*  }"
  got=$( (cd "$SRC" && shasum -a 256 "$path" 2>/dev/null) | cut -d' ' -f1 || true)
  mf_n=$((mf_n + 1))
  if [ "$got" != "$want" ]; then
    echo "  ✗ 随包文件与闸门日志不符：${path}（日志 ${want:0:16}… ≠ 现在 ${got:0:16}…）" >&2
    mf_bad=$((mf_bad + 1))
  fi
done < <(grep -E '^   .*  [0-9a-f]{64}$' "$log" || true)
if [ "$mf_bad" -gt 0 ]; then
  echo "✗ ${mf_bad} 个随包文件在闸门跑过之后变了：这份证据不为现在这棵树作证。请重跑 ./scripts/gate.sh" >&2
  exit 1
fi
if [ "$mf_n" -eq 0 ]; then
  echo "  ! 日志里一个随包文件哈希都没读到（gate.sh 的 emit_shipped_manifest 空了？）——这一项无从比对，请人工看一眼 ${log}"
else
  echo "  ✓ 随包清单里 ${mf_n} 个文件的哈希与日志逐个相符"
fi
log_art=$(grep '^结论：通过' "$log" | tail -1 | grep -oE '[0-9a-f]{16}' | head -1 || true)
now_art=$( (cd "$SRC" && shasum -a 256 lib/index.js 2>/dev/null) | cut -c1-16 || true)
if [ -z "$log_art" ] || [ -z "$now_art" ]; then
  echo "✗ 无法核对产物哈希（日志里读到「${log_art:-无}」，现在算出「${now_art:-无}」）：" >&2
  echo "  ${SRC}/lib/index.js 在不在？闸门是不是 --quick 跑的？请重跑 ./scripts/gate.sh" >&2
  exit 1
fi
if [ "$log_art" != "$now_art" ]; then
  echo "✗ 产物与闸门证据不符：日志里的 lib/index.js 是 ${log_art}…，现在是 ${now_art}…。请重跑 ./scripts/gate.sh" >&2
  exit 1
fi
echo "  ✓ 产物哈希与日志相符（lib/index.js ${now_art}…）"
# 树必须静止（0.13 的补充：一个还在写的树量出来的东西没有意义）
# bridges/ 也在里面：它会被 rsync 同步进公开仓（排除清单里没有它），所以"树是否静止"必须把它算进去。
# 漏掉它的后果是——发布时正好有个桥文件在被写，公开仓收到半截文件，而两次测量都显示"静止"。
h1=$(cd "$SRC" && find src tests scripts panel prompts bridges -type f -exec shasum -a 256 {} + | shasum -a 256 | cut -c1-16)
sleep 2
h2=$(cd "$SRC" && find src tests scripts panel prompts bridges -type f -exec shasum -a 256 {} + | shasum -a 256 | cut -c1-16)
[ "$h1" = "$h2" ] || { echo "✗ 真源在两次测量之间变了（$h1 → ${h2}）：有东西还在写，先让它停下" >&2; exit 1; }
echo "  ✓ 真源静止（${h1}）"

# ── 2. 同步代码与文档；保留只在公开副本里存在的东西 ───────────────────────────
# ── 1.5 CHANGELOG 追加（发布即记档：面板「更新」页与安装的包不可能漂移）───────────
# 【操作者决定】面板最后的页签展示版本更新内容；数据源 CHANGELOG.md 只由这条管道追加，
# 一版一行，写的人是发布这个动作本身（不是任何一只手）。
DATE=$(date +%F)
LINE="- **${VERSION}**（${DATE}）：${MESSAGE}"
if ! grep -qxF "$LINE" "$SRC/CHANGELOG.md"; then
  printf '%s\n' "$LINE" >> "$SRC/CHANGELOG.md"
  echo "  CHANGELOG.md：追加 $VERSION"
else
  echo "  CHANGELOG.md：$VERSION 已在（重跑发布），不重复追加"
fi

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
# `/scripts/.private-blocklist` 必须锚定并显式排除：它是隐私黑名单（真实标识符的字面量清单），
# 一旦跟着 rsync 进公开仓，就等于把要保护的东西发布出去——而第 3、4 步都读的是它，
# 谁也不会想到"扫描用的那张表本身就在被扫描的树里"。锚定（前导 /）是因为不带斜杠的排除模式
# 会匹配任何层级的同名文件，而"任何层级"正是上面 /lib 那次事故的原因。
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude /lib --exclude .DS_Store \
  --exclude LICENSE --exclude SECURITY.md --exclude 'examples/real-run-*' \
  --exclude /scripts/.private-blocklist \
  "$SRC"/ "$PUB"/
cp -R "$SRC/lib/." "$PUB/lib/"
echo "  ✓ 代码、文档、prompts、panel、lib 已同步；保留项：${KEEP[*]}"
# 黑名单不进公开仓，所以"该发布的文件都在"这一清单也必须把它排掉——否则第 2 步会因为
# 公开仓里少了一个**本来就不该在**的文件而拒绝发布（一个正确的排除被另一个检查当成事故）。
if [ -e "$PUB/scripts/.private-blocklist" ]; then
  echo "✗ 公开副本里出现了 scripts/.private-blocklist：它不该被同步过去（rsync 排除失效？）。" >&2
  echo "  先把 ${PUB}/scripts/.private-blocklist 从工作树与索引里去掉，并检查它有没有已经被推送过。" >&2
  exit 1
fi
# 该同步的每一个文件都真的在公开仓工作树里吗？在**推送之前**查，否则会把一个坏树推上去再报错——
# 0.6.1 就是这么发生的：远端核实在第 7 步，而推送在第 6 步。
# 这个检查抓的是"排除清单或 .gitignore 悄悄吞掉了一个目录"，两次都发生过（rsync 的 lib、.gitignore 的 lib/）。
expected=$(cd "$SRC" && find src tests scripts panel prompts bridges docs -type f \
  ! -name '.DS_Store' ! -path '*/node_modules/*' ! -path 'scripts/.private-blocklist' | LC_ALL=C sort)
missing=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -e "$PUB/$f" ] || { echo "  ✗ 公开仓工作树缺：$f" >&2; missing=$((missing + 1)); }
done <<<"$expected"
[ "$missing" -eq 0 ] || { echo "✗ 少了 $missing 个文件，不发布（查 rsync 排除清单与 .gitignore 的锚定）" >&2; exit 1; }
echo "  ✓ 该发布的文件都在（$(grep -c . <<<"$expected") 个）"

# ── 3. 脱敏：按性质，不按形态 ────────────────────────────────────────────────
step "3/7 脱敏"
python3 - "$PUB" "$TEXT_SUFFIXES" <<'PY'
import pathlib, re, sys, hashlib
root = pathlib.Path(sys.argv[1])
def h12(s): return hashlib.sha256(s.encode()).hexdigest()[:12]
stats = {}
def bump(k, n=1): stats[k] = stats.get(k, 0) + n
SKIP_DIRS = {'node_modules', '.git'}
# 白名单从 argv 来，**不在这里重写一份**：两段 python 各写一份的结果是它们分叉了
# （通用段有 .csv .tsv .yaml .d.ts，项目特定段没有），于是公开仓里 17 个表格文件与那把锁文件
# 从来没经过项目特定字典，真实标识符就躺在 examples/real-run-*/ 的表格里发出去了。
TEXT = set(sys.argv[2].split())
def wanted(p):
    # pathlib 的 suffix 对 'index.d.ts' 给的是 '.ts'，所以 '.d.ts' 这一项要单独认一次，
    # 否则它在白名单里只是一句好看的空话（这个坑就是这么安静：不报错，只是永远匹配不到）。
    return p.suffix in TEXT or ('.d.ts' in TEXT and p.name.endswith('.d.ts'))
for p in root.rglob('*'):
    # pnpm-lock.yaml 不再被显式跳过。理由与风险：
    #  理由：它是公开仓里的一个受控文件（rsync 不排除、git 跟踪、第 4 步会扫它），却唯独不经过脱敏。
    #        "扫它但不洗它"自相矛盾——一旦它里面真出现 UUID 或 /Users/<name>，第 4 步只会把发布拦红，
    #        而没有任何一步能把它洗干净，唯一出路是手工编辑锁文件。实测此刻它 0 处命中
    #        （UUID / 家目录 / 键后高熵 / 操作者用户名 全为 0），所以取消跳过今天是一次空操作。
    #  风险：将来锁文件里若出现 UUID 形态的串（例如某个 git 依赖的 commit-ish），它会被换成
    #        <uuid-sha256:…>，那份**公开副本里的**锁文件就不再能逐字复现安装。接受它的理由：
    #        (a) 替换统计会把它打出来，看得见；(b) 真源的锁文件不受影响（脱敏只写公开副本）；
    #        (c) 与"把个人数据发布出去"相比，这是一个可逆的小代价。
    if not p.is_file() or any(d in p.parts for d in SKIP_DIRS):
        continue
    if not wanted(p):
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
print(f'  通用段：白名单 {len(TEXT)} 个后缀；' + ('替换统计：' + ', '.join(f'{k} ×{v}' for k, v in sorted(stats.items(), key=lambda kv: -kv[1])) if stats else '无可替换项'))
PY
# 主机名与用户名是项目特定的，所以放在这一段而不是上面的通用规则里：
# 通用的部分（键后高熵、UUID、家目录）对任何项目都成立，特定的部分必须显式列出、可核对。
# 但**字典本身不在这个脚本里**：它连同第 4 步的模式表一起住在 scripts/.private-blocklist（不进公开仓）。
# 原先它写死在这里，于是这份脚本被 rsync 同步进公开副本之后，副本里的那一份自己把自己脱敏成空操作
# （字典的键变成了占位串，`'<bot-id>': '<bot-id>'`），拿副本发布就会把真实标识符推上去、而扫描报全绿。
python3 - "$PUB" "$TEXT_SUFFIXES" "$BLOCKLIST" <<'PY'
import pathlib, sys, hashlib
root = pathlib.Path(sys.argv[1])
TEXT = set(sys.argv[2].split())          # 与通用段**同一份**白名单：两份白名单分叉过一次，见上面的事故注释
BLOCKLIST = pathlib.Path(sys.argv[3])
def h12(s): return hashlib.sha256(s.encode()).hexdigest()[:12]
def wanted(p):
    return p.suffix in TEXT or ('.d.ts' in TEXT and p.name.endswith('.d.ts'))

# 从黑名单读 [specific] 段（`字面量 => 替换值`）。每一项都是**实测出现过**的，不是想象出来的：
# 见 docs/v2/00-audit-and-plan.md §4.60 与黑名单文件自己的注释。
SPECIFIC = {}
section = None
for raw in BLOCKLIST.read_text().splitlines():
    line = raw.rstrip('\r')
    if not line.strip() or line.lstrip().startswith('#'):
        continue
    if line.startswith('[') and line.endswith(']'):
        section = line[1:-1].strip(); continue
    if section == 'specific' and '=>' in line:
        k, v = line.split('=>', 1)
        SPECIFIC[k.strip()] = v.strip()
if not SPECIFIC:
    # 解析不出任何一项 = 项目特定脱敏变成空操作 = 上面那次事故的形状。**失败，不要静默继续**。
    print(f'  ✗ 从 {BLOCKLIST} 的 [specific] 段解析出 0 项：项目特定脱敏会变成空操作', file=sys.stderr)
    sys.exit(1)
n = 0
files = 0
for p in root.rglob('*'):
    # 与通用段一致：不再按文件名跳过 pnpm-lock.yaml（理由写在通用段那一条注释里）。
    if not p.is_file() or 'node_modules' in p.parts or '.git' in p.parts:
        continue
    if not wanted(p):
        continue
    try: s = p.read_text()
    except Exception: continue
    o = s
    for k, v in SPECIFIC.items():
        if k in s:
            n += s.count(k)
            s = s.replace(k, v)
    if s != o:
        p.write_text(s); files += 1
print(f'  项目特定段：字典 {len(SPECIFIC)} 项、白名单 {len(TEXT)} 个后缀 → 替换 {n} 处，涉及 {files} 个文件')
PY

# ── 4. 扫描暂存字节（不是工作区）─────────────────────────────────────────────
step "4/7 扫描暂存字节"
cd "$PUB"
git add -A
# 模式表在 scripts/.private-blocklist 的 [patterns] 段（不进公开仓），由 load_blocklist 载入。
# 它原先就写死在本脚本里，于是这份脚本被同步进公开副本之后，副本里的那一份**自己把自己脱敏成
# "去搜占位串"**——猎手住进了猎场。搬出去之后模式可以放心写字面量，不必再为了避开本脚本里的
# 自我引用而放松形状（原先 `/Users/[A-Za-z]` 而不是裸 `/Users/`、`_authToken=` 后必须跟值，
# 都是为了绕开"本脚本自己也含有这些词"这件事）。
# 那条纪律依然有效，只是搬到了黑名单的注释里：模式匹配"真实泄漏的形状"，不匹配"提到这个词的地方"。
# 扫描逻辑抽成函数是为了能被 --selftest-scan 指着一次性仓自测：那段代码里有 git grep 的三态退出码
# 与 pipefail 的交互，而它原先只在真发布时才跑得到——一条只在发布时才被行使的纪律，等于没被验过。
if ! scan_staged_bytes "$PUB"; then
  exit 1
fi

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
  ! -name '.DS_Store' ! -path '*/node_modules/*' ! -path 'scripts/.private-blocklist' | LC_ALL=C sort)
remote_paths=$(gh api "repos/$REPO/git/trees/main?recursive=1" --jq '.tree[].path' 2>/dev/null | sort)
missing=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  grep -qxF "$f" <<<"$remote_paths" || { echo "  ✗ 远端缺：$f" >&2; missing=$((missing + 1)); }
done <<<"$expected"
[ "$missing" -eq 0 ] || { echo "✗ 公开仓少了 $missing 个文件（同步或排除清单有问题）" >&2; exit 1; }
echo "  ✓ 远端文件齐全：$(grep -c . <<<"$expected") 个（src tests scripts panel prompts bridges docs）"
echo "  ✓ 发布完成。安装命令：install_bundle target: github:$REPO"
