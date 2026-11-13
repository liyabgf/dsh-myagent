#!/usr/bin/env bash
# 迁移演练：在一个副本上跑当前构建的迁移，证明既有数据一个字节都没变，并演练回滚。
#
# 为什么要有它：schema_version 是"更旧的构建拒绝打开"的唯一开关，而一次加列的迁移可以把数据在两个方向上
# 都搁浅（新构建查不到列，旧构建拒绝打开）。所以每一步 schema 变更都必须先在副本上跑一遍这个脚本，
# 拿到"四张数据表逐字节相同"的证据，才允许去动线上库。
#
# 用法：scripts/verify-migration.sh [数据库路径]
#   默认对线上库 ~/.dsh/state/myagent/myagent.sqlite3 做只读快照演练——线上库自始至终只读。
# 退出码：0 = 数据未变且回滚安全；非 0 = 有问题，不要升级线上库。
set -euo pipefail

LIVE="${1:-$HOME/.dsh/state/myagent/myagent.sqlite3}"
# Resolve the caller's database path before changing cwd for source imports.
LIVE_DIR=$(cd "$(dirname "$LIVE")" && pwd -P) || exit $?
LIVE="$LIVE_DIR/$(basename "$LIVE")"
SCRIPT_ROOT=$(cd "$(dirname "$0")/.." && pwd -P) || exit $?
WORK=$(mktemp -d "${TMPDIR:-/tmp}/myagent-migration.XXXXXX")
# Validate the absolute cleanup target before installing the EXIT trap.
case "$WORK" in /*/myagent-migration.??????) [ -d "$WORK" ] && [ ! -L "$WORK" ] || exit 2 ;; *) echo '✗ 无效临时目录' >&2; exit 2 ;; esac
cleanup() { local code=$?; trap - EXIT; rm -rf -- "${WORK:?}"; exit "$code"; }
trap cleanup EXIT
DRY="$WORK/migration.sqlite3"
NODE_OUT="$WORK/node.log"

[ -f "$LIVE" ] || { echo "✗ 找不到数据库：$LIVE"; exit 2; }

# 四张既存数据表的内容摘要。Ticket、Schedule（settings:document + cron 游标）、Inbox 派生的 Trigger、
# Session（main-session:id）都在这四张表里，所以它们不变就意味着操作者的数据不变。
# 显式列名，不是 select *。select * 量的是**表的形状**：一次加列的迁移会让每行多出两个 NULL 字段，
# 摘要因此变化，而操作者的数据一个字节都没动——第一版脚本就是这么把一次纯加法的迁移误判成"数据被改动"的。
# 要量的是数据，所以只取版本 1 就存在的那些列。
digest() {
  {
    sqlite3 -json "$1" "select id, source, kind, at, disposition, record from triggers order by id" || return $?
    sqlite3 -json "$1" "select id, createdAt, open, record from tickets order by id" || return $?
    sqlite3 -json "$1" "select id, triggerId, at, outcome, record from decisions order by id" || return $?
    sqlite3 -json "$1" "select key, value from kv order by key" || return $?
  } | shasum -a 256 | cut -c1-16
}
counts() {
  sqlite3 "$1" "select 'triggers='||(select count(*) from triggers)||' tickets='||(select count(*) from tickets)\
||' decisions='||(select count(*) from decisions)||' kv='||(select count(*) from kv)||' version='||(select version from schema_version)"
}

# Online backup honors WAL/locking; mode=ro forbids logical writes to the source.
# SQLite may need SHM sidecars; inability to access them is an error, never a fallback.
python3 - "$LIVE" "$DRY" <<'PY'
import contextlib, pathlib, sqlite3, sys, time, urllib.parse
uri = 'file:' + urllib.parse.quote(str(pathlib.Path(sys.argv[1]).resolve()), safe='/') + '?mode=ro'
deadline = time.monotonic() + 5
def progress(status, remaining, total):
    if time.monotonic() >= deadline:
        raise TimeoutError('SQLite snapshot exceeded 5 seconds')
with contextlib.closing(sqlite3.connect(uri, uri=True, timeout=5)) as source:
    with contextlib.closing(sqlite3.connect(sys.argv[2], timeout=5)) as target:
        source.backup(target, pages=256, progress=progress, sleep=0.05)
PY
BEFORE="$(digest "$DRY")"
echo "── 快照取自 ${LIVE}（只读）"
echo "   迁移前：$(counts "$DRY")  摘要=$BEFORE"

# 用当前构建打开副本，触发迁移。
# P1-7 fix: grep -v returning exit=1 when it filters ALL lines (normal for a clean migration)
# was being treated as a pipeline failure under set -o pipefail. Capture node's exit code
# separately and explicitly handle the "no matching lines" case from grep.
NODE_EXIT=0
if (cd "$SCRIPT_ROOT" && node --experimental-transform-types - "$DRY" <<'NODE'
import { Store } from './src/app/store.ts'
const store = new Store(process.argv[2])
store.close()
NODE
) >"$NODE_OUT" 2>&1; then
  NODE_EXIT=0
else
  NODE_EXIT=$?
fi
# Filter warnings for display only; the captured command status remains authoritative.
if [ -f "$NODE_OUT" ]; then
  if grep -v -e ExperimentalWarning -e --trace-warnings "$NODE_OUT"; then :; else grep_status=$?; [ "$grep_status" -eq 1 ] || { echo "✗ 无法读取迁移日志（grep exit ${grep_status}）" >&2; exit "$grep_status"; }; fi
fi
if [ "$NODE_EXIT" -ne 0 ]; then
  echo "   ✗ 迁移失败（node exit ${NODE_EXIT}）——不要升级线上库" >&2
  exit "$NODE_EXIT"
fi

AFTER="$(digest "$DRY")"
echo "── 迁移后：$(counts "$DRY")  摘要=${AFTER}"

status=0
if [ "$BEFORE" = "$AFTER" ]; then
  echo "   ✓ triggers/tickets/decisions/kv 所选既存列的稳定摘要未变"
else
  echo "   ✗ 既存数据被改动了——不要升级线上库，先查这一步做了什么"
  status=1
fi

# L04 fix: verify the schema_version was actually bumped to what the current build expects.
# A migration that only sets version=X but forgets to run the schema change would still pass
# the data check above, but the version bump proves the migration code was actually reached.
# Read the expected version from the source rather than hardcoding it.
VERSION_OUT="$WORK/version.log"
VERSION_EXIT=0
if (cd "$SCRIPT_ROOT" && node --experimental-transform-types -e "
import { SCHEMA_VERSION } from './src/app/store.ts'
process.stdout.write(String(SCHEMA_VERSION))
") >"$VERSION_OUT" 2>"$WORK/version.err"; then
  VERSION_EXIT=0
else
  VERSION_EXIT=$?
fi
if [ "$VERSION_EXIT" -ne 0 ]; then
  cat "$VERSION_OUT" "$WORK/version.err" >&2
  exit "$VERSION_EXIT"
fi
expected_version=$(cat "$VERSION_OUT")
actual_version=$(sqlite3 "$DRY" 'select version from schema_version')
if [ "$actual_version" = "$expected_version" ]; then
  echo "   ✓ SCHEMA_VERSION 已升至 ${actual_version}"
else
  echo "   ✗ SCHEMA_VERSION 应为 ${expected_version}，实际为 ${actual_version}"; status=1
fi
artifacts_table=$(sqlite3 "$DRY" "select name from sqlite_master where type='table' and name='artifacts'")
[ "$artifacts_table" = artifacts ] && echo "   ✓ artifacts 表已建" || { echo "   ✗ artifacts 表缺失"; status=1; }
settings_table=$(sqlite3 "$DRY" "select name from sqlite_master where type='table' and name='settings'")
if [ -n "$settings_table" ]; then echo "   ✗ 死表 settings 仍在"; status=1; else echo "   ✓ 死表 settings 已删除"; fi

integrity="$(sqlite3 "$DRY" 'pragma integrity_check')"
[ "$integrity" = "ok" ] && echo "   ✓ integrity_check ok" || { echo "   ✗ integrity_check: $integrity"; status=1; }
foreign="$(sqlite3 "$DRY" 'pragma foreign_key_check' | wc -l | tr -d ' ')"
[ "$foreign" = "0" ] && echo "   ✓ foreign_key_check 干净" || { echo "   ✗ foreign_key_check 有 $foreign 条"; status=1; }

# 回滚演练：把版本号改回升级前的值。这一步有效，当且仅当这次变更是纯加法的——旧构建既不读也不写新表。
previous="$(sqlite3 "$DRY" 'select version from schema_version')"
sqlite3 "$DRY" "update schema_version set version = 1"
ROLLED="$(digest "$DRY")"
if [ "$BEFORE" = "$ROLLED" ]; then
  echo "── 回滚演练：版本标记降级至 1 后，所选既存列摘要仍相同（摘要 ${ROLLED}）"
  echo "   当前构建版本标记为 ${previous}。此项仅验证选定列摘要，不证明旧构建兼容；旧版本需单独实测。"
else
  echo "   ✗ 回滚后数据不同——这次变更不是纯加法的，回滚需要备份而不是改版本号"
  status=1
fi

[ "$status" = "0" ] && echo "── 通过：源码迁移及选定列摘要检查通过；升级和旧构建兼容仍需独立验收" || echo "── 未通过：不要升级线上库"
exit "$status"
