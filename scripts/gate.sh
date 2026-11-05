#!/usr/bin/env bash
# 验证闸门：一条命令给出唯一结论，并且自己决定退出码。
#
# 存在的理由是纪律 0.1（docs/v2/04-execution-discipline.md）：本仓库曾经连续 7 轮把"构建干净、全绿"
# 报成事实，而实际上 (a) `| head -N` 触发的 SIGPIPE 杀掉了 `pnpm check` 的最后一步 build，
# 产物陈旧了 7.5 小时；(b) `pnpm test` 在全部测试通过的同时报未处理错误，退出码一直是 1。
# 两件事都看不见，因为判定依据是 grep 出来的某句话，而不是退出码。
#
# 这个脚本不允许那种读法：它把每一步的退出码收集起来，最后只打印一行结论，
# 并且**只要有任何一步失败就以非 0 退出**。想知道状态，就读它的退出码。
#
# 用法：scripts/gate.sh [--quick]
#   --quick  跳过构建与产物核对（只跑 typecheck 与测试）。默认不跳，因为产物才是被部署的东西。
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

log=/tmp/myagent-gate.log
: > "$log"
# 把"这一次是什么模式跑的"写进日志本身。`--quick` 与完整闸门写同一个文件，所以日志里最后一次运行
# 可能只做了 typecheck+test（跳过 build 与两项产物核对），而下一个读者会把它当成四步全绿的证据。
# 判定权在退出码，但退出码不留痕；留痕的那份东西必须自己说明它验了什么、没验什么。
echo "── 本次运行：scripts/gate.sh $*（$(date '+%Y-%m-%d %H:%M:%S')）" | tee -a "$log"
failures=()

# 每一步都单独跑、单独记退出码。不用 && 串起来，因为串起来会在第一个失败处停住，
# 而"还有哪些也坏了"本身就是要知道的信息。
run() {
  local name="$1"; shift
  echo "── $name" | tee -a "$log"
  "$@" >> "$log" 2>&1
  local code=$?
  if [ "$code" -eq 0 ]; then
    echo "   ✓ $name"
  else
    echo "   ✗ ${name}（退出码 ${code}，详情在 ${log}）"
    failures+=("$name")
  fi
  return 0
}

run "typecheck" pnpm typecheck

if [ "$QUICK" -eq 0 ]; then
  run "build" pnpm build
fi

# 测试单独跑而不是走 pnpm check：check 的顺序变了以后两步会重复跑一次构建，
# 而且这里要的是 test 自己的退出码——它在"测试全过但有未处理错误"时也是非 0，那正是要暴露的情况。
run "test" pnpm test

if [ "$QUICK" -eq 0 ]; then
  # 产物核对：宿主加载的是 lib/index.js，不是 src/。源码再干净也不代表部署的是它。
  echo "── artifact" | tee -a "$log"
  stale=$(find src tests -name '*.ts' -newer lib/index.js 2>/dev/null | wc -l | tr -d ' ')
  if [ "$stale" != "0" ]; then
    echo "   ✗ artifact：有 $stale 个源文件比 lib/index.js 新，产物是陈旧的"
    failures+=("artifact")
  else
    echo "   ✓ artifact：lib/index.js 比每个源文件都新"
  fi
  # 版本号必须是源码声明的那个。陈旧产物会盖一个更小的数，而这种错在测试里永远看不见。
  version=$(node -e "
    const s = require('fs').readFileSync('src/app/store.ts', 'utf8')
    console.log((s.match(/SCHEMA_VERSION = (\d+)/) || [])[1] || '')
  " 2>>"$log")
  if [ -n "$version" ] && grep -q "\.run($version)" lib/index.js; then
    echo "   ✓ artifact：产物盖的 schema 版本是 $version"
  else
    echo "   ✗ artifact：产物里没有 .run($version)，它不是这份源码构建的"
    failures+=("artifact-version")
  fi
fi

# 测试数量与未处理错误：两个数都要看，只看前者就是 S32 那次事故的读法。
# 抓的是整行，不是"N passed"：失败时那一行是 "Tests  1 failed | 570 passed (571)"，
# 只匹配 passed 会在最需要看清的时候什么也抓不到。
tests=$(grep -E "^ *Tests " "$log" | tail -1 | sed 's/^ *//')
errors=$(grep -oE "Errors +[0-9]+ error" "$log" | tail -1)
# 计数行也要落盘：它是判断的一部分，而只打到 stdout 意味着事后无法从日志复核
# （尤其是"未处理错误"那一项——测试全过时它才是唯一能说明问题的数字）。
echo "── 计数：${tests:-无} ${errors:+/ $errors}" | tee -a "$log"

echo
if [ "${#failures[@]}" -eq 0 ]; then
  echo "结论：通过。产物 $(shasum -a 256 lib/index.js 2>/dev/null | cut -c1-16)…（$(stat -f %z lib/index.js 2>/dev/null) 字节）" | tee -a "$log"
  exit 0
fi
echo "结论：未通过 —— ${failures[*]}" | tee -a "$log"
echo "在修好这些之前，不许说\"全绿\"。详情：$log"
exit 1
