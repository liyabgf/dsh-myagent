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
# 用法：scripts/gate.sh [--quick | --shipped-only]
#   --quick         跳过构建与产物核对（只跑 typecheck 与测试）。默认不跳，因为产物才是被部署的东西。
#   --shipped-only  只打印下面那段"随包发布但不进 bundle 的文件"清单，四步一步都不跑，
#                   也**不碰** /tmp/myagent-gate.log。这个模式的退出码 0 只代表清单打印成功，
#                   **不代表闸门通过**——判定权始终在完整闸门的退出码（0.1）。
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

# ─── 随包发布但不进 bundle 的文件：清单生成 ───────────────────────────────────
# 为什么要在 node 里解析、而不是在 bash 里 glob：清单的来源是 package.json 的 files 数组，
# 那是 **npm 的 glob 方言**（`locale/*.json` 里 `*` 不跨 `/`、目录项要递归、`**` 要跨层）。
# 在 bash 里复刻它等于自己写一个 glob 匹配器，写错的方式还很安静（少匹配一个目录 = 又一个盲区）。
# 这个脚本本来就依赖 node（下面核 schema 版本那段在用），而 Node >= 22 的 fs.globSync
# 就是同一套方言，所以解析放在 node 里：依赖没增加，语义由运行时保证。
#
# 输出：每行「路径 + 两个空格 + sha256」，按路径排序（ASCII 下即字节序），
# 所以同一棵树两次运行逐字节相同，可以直接和上次发布的清单 diff。
emit_shipped_manifest() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");

    // 枚举目录时永远跳过的东西：npm 自己就不发布它们，而且它们会破坏
    // "同一棵树两次输出逐字节相同"——.DS_Store 只要有人用 Finder 打开过目录就会变。
    const SKIP_DIRS = new Set(["node_modules", ".git"]);
    const SKIP_FILES = new Set([".DS_Store"]);

    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const entries = Array.isArray(pkg.files) ? pkg.files : [];

    // bundle 目录从 main（退而求其次 exports 的 "."）推出来，不写死 "lib"：
    // 它**就是** bundle，归新鲜度检查与版本号检查管，结论行也已经打印了它的 sha256。
    let mainField = pkg.main;
    if (!mainField && pkg.exports && pkg.exports["."]) {
      const dot = pkg.exports["."];
      mainField = typeof dot === "string" ? dot : dot.default || dot.require || dot.import;
    }
    const norm = (p) => String(p).replace(/^\.\//, "").replace(/\/+$/, "");
    const bundleDir = mainField ? path.dirname(norm(mainField)).split(path.sep).join("/") : "";
    const isBundle = (rel) => !!bundleDir && bundleDir !== "." &&
      (rel === bundleDir || rel.startsWith(bundleDir + "/"));

    const found = new Set();
    const walk = (rel) => {
      let st;
      try { st = fs.statSync(rel); } catch { return; }   // files 里写了但树上没有：跳过，不猜
      if (st.isDirectory()) {
        let names;
        try { names = fs.readdirSync(rel); } catch { return; }
        for (const name of names) {
          if (SKIP_DIRS.has(name)) continue;
          walk(rel === "." ? name : rel + "/" + name);
        }
        return;
      }
      if (!st.isFile()) return;                          // 符号链接等：不是随包发布的真实文件
      const rel2 = rel.split(path.sep).join("/");
      if (SKIP_FILES.has(path.posix.basename(rel2))) return;
      if (isBundle(rel2)) return;
      found.add(rel2);
    };

    for (const raw of entries) {
      const entry = norm(raw);
      if (!entry) continue;
      if (entry.startsWith("!")) {                       // files 不支持否定项；真出现就跳过而不是猜
        console.log("   ⚠ files 里有否定项 " + entry + "，本清单没有实现否定语义，请手工核对");
        continue;
      }
      if (isBundle(entry)) continue;
      if (/[*?[\]{}]/.test(entry)) {
        let hits;
        try {
          hits = fs.globSync(entry, {
            cwd: process.cwd(),
            exclude: (p) => SKIP_DIRS.has(String(p)) || SKIP_FILES.has(String(p)),
          });
        } catch { hits = []; }                           // 模式非法：报空，不猜、也不让闸门挂掉
        for (const hit of hits) walk(String(hit));
      } else {
        walk(entry);
      }
    }

    const files = [...found].sort();
    for (const rel of files) {
      const digest = crypto.createHash("sha256").update(fs.readFileSync(rel)).digest("hex");
      console.log("   " + rel + "  " + digest);
    }
    if (files.length === 0) {
      console.log("   ⚠ 清单为空：package.json 的 files 没解析出任何文件（报告步骤，不影响退出码）");
    }
    const scope = bundleDir && bundleDir !== "."
      ? "；不含 " + bundleDir + "/ —— 它就是 bundle，由新鲜度与版本号检查覆盖"
      : "";
    console.log("   （共 " + files.length + " 个文件，按路径排序" + scope + "）");
  '
}

# 单独跑上面那一段。必须在 `: > "$log"` 之前处理：这个模式**不许**动共享日志，
# 否则别人上一次完整闸门的证据就被清掉了（日志是唯一留痕的东西）。
if [ "${1:-}" = "--shipped-only" ]; then
  echo "── shipped（单独模式：只报告清单，四步一步都没跑；退出码 0 ≠ 闸门通过）"
  emit_shipped_manifest
  exit $?
fi

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

# 随包发布、但**不进 bundle** 的文件：只报告哈希，不做判定、不影响退出码。
# 为什么这里不能套用上面那条新鲜度规则：这些文件永远不会进 lib/index.js，
# 所以"比 lib/index.js 新"对它们**根本不成立**——它只会随编辑顺序任意触发，
# 而一个任意触发的检查会被忽略，那比没有检查更坏（0.2）。
# 诚实的说法是：它们不被新鲜度覆盖，这是它们此刻的哈希，拿去和上次发布的清单比。
# 实测过两次这个盲区：第 46 轮改了 panel 而产物哈希不变，0.1.2 改了 prompts/worker.md 而 771 条全绿、
# 产物哈希仍是 3f772ddc…——**闸门看不见这两类文件的改动**，而 package.json 的 files 里它们都在。
# 清单来源是 package.json 的 files 数组而不是硬编码路径，否则下一个随包目录就是同一个盲区。
{ echo "── 随包发布但不进 bundle 的文件（只报告，与上次发布的清单 diff）"
  emit_shipped_manifest
} | tee -a "$log"

echo
if [ "${#failures[@]}" -eq 0 ]; then
  echo "结论：通过。产物 $(shasum -a 256 lib/index.js 2>/dev/null | cut -c1-16)…（$(stat -f %z lib/index.js 2>/dev/null) 字节）" | tee -a "$log"
  exit 0
fi
echo "结论：未通过 —— ${failures[*]}" | tee -a "$log"
echo "在修好这些之前，不许说\"全绿\"。详情：$log"
exit 1
