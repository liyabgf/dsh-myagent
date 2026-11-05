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
DRY="$(mktemp -d)/migration.sqlite3"
trap 'rm -rf "$(dirname "$DRY")"' EXIT

[ -f "$LIVE" ] || { echo "✗ 找不到数据库：$LIVE"; exit 2; }

# 四张既存数据表的内容摘要。Ticket、Schedule（settings:document + cron 游标）、Inbox 派生的 Trigger、
# Session（main-session:id）都在这四张表里，所以它们不变就意味着操作者的数据不变。
# 显式列名，不是 select *。select * 量的是**表的形状**：一次加列的迁移会让每行多出两个 NULL 字段，
# 摘要因此变化，而操作者的数据一个字节都没动——第一版脚本就是这么把一次纯加法的迁移误判成"数据被改动"的。
# 要量的是数据，所以只取版本 1 就存在的那些列。
digest() {
  {
    sqlite3 "$1" "select id, source, kind, at, disposition, record from triggers order by id"
    sqlite3 "$1" "select id, createdAt, open, record from tickets order by id"
    sqlite3 "$1" "select id, triggerId, at, outcome, record from decisions order by id"
    sqlite3 "$1" "select key, value from kv order by key"
  } | shasum -a 256 | cut -c1-16
}
counts() {
  sqlite3 "$1" "select 'triggers='||(select count(*) from triggers)||' tickets='||(select count(*) from tickets)\
||' decisions='||(select count(*) from decisions)||' kv='||(select count(*) from kv)||' version='||(select version from schema_version)"
}

# WAL 库只 cp 主文件不是有效备份（-wal 里的内容会丢），所以用 VACUUM INTO 取一致性快照，源始终只读。
# `immutable=1`, not plain `mode=ro`: a cleanly stopped host leaves a WAL-mode database with no `-shm` sibling, and
# SQLite cannot open that read-only without it — so the tool failed on exactly the quiescent file it exists to protect.
# `immutable` promises the file will not change under us, which is true here because the host is stopped.
sqlite3 "file:${LIVE}?mode=ro&immutable=1" "VACUUM INTO '$DRY'"
BEFORE="$(digest "$DRY")"
echo "── 快照取自 ${LIVE}（只读）"
echo "   迁移前：$(counts "$DRY")  摘要=$BEFORE"

# 用当前构建打开副本，触发迁移。
( cd "$(dirname "$0")/.." && node --experimental-transform-types -e "
import { Store } from './src/app/store.ts'
const store = new Store('$DRY')
store.close()
" 2>&1 | grep -v 'ExperimentalWarning\|--trace-warnings' || true )

AFTER="$(digest "$DRY")"
echo "── 迁移后：$(counts "$DRY")  摘要=${AFTER}"

status=0
if [ "$BEFORE" = "$AFTER" ]; then
  echo "   ✓ triggers/tickets/decisions/kv 四张表逐字节未变"
else
  echo "   ✗ 既存数据被改动了——不要升级线上库，先查这一步做了什么"
  status=1
fi

# 新表与索引应当在；旧的死表应当不在。
sqlite3 "$DRY" "select name from sqlite_master where type='table' and name='artifacts'" | grep -q artifacts \
  && echo "   ✓ artifacts 表已建" || { echo "   ✗ artifacts 表缺失"; status=1; }
sqlite3 "$DRY" "select name from sqlite_master where type='table' and name='settings'" | grep -q settings \
  && { echo "   ✗ 死表 settings 仍在"; status=1; } || echo "   ✓ 死表 settings 已删除"

integrity="$(sqlite3 "$DRY" 'pragma integrity_check')"
[ "$integrity" = "ok" ] && echo "   ✓ integrity_check ok" || { echo "   ✗ integrity_check: $integrity"; status=1; }
foreign="$(sqlite3 "$DRY" 'pragma foreign_key_check' | wc -l | tr -d ' ')"
[ "$foreign" = "0" ] && echo "   ✓ foreign_key_check 干净" || { echo "   ✗ foreign_key_check 有 $foreign 条"; status=1; }

# 回滚演练：把版本号改回升级前的值。这一步有效，当且仅当这次变更是纯加法的——旧构建既不读也不写新表。
previous="$(sqlite3 "$DRY" 'select version from schema_version')"
sqlite3 "$DRY" "update schema_version set version = 1"
ROLLED="$(digest "$DRY")"
if [ "$BEFORE" = "$ROLLED" ]; then
  echo "── 回滚演练：版本号改回 1 之后数据仍逐字节相同（摘要 ${ROLLED}）"
  echo "   旧构建需要的东西都还在：$(sqlite3 "$DRY" 'select count(*) from tickets') 行 ticket、\
主 Session $(sqlite3 "$DRY" "select length(value) from kv where key='main-session:id'" || echo 0) 字节、\
cron 游标 $(sqlite3 "$DRY" "select length(value) from kv where key='source:cron:cursor'" || echo 0) 字节、\
设置 $(sqlite3 "$DRY" "select length(value) from kv where key='settings:document'" || echo 0) 字节"
  echo "   （当前构建版本是 ${previous}；回滚只对纯加法的变更成立，加列或改形状之前请重新评估）"
else
  echo "   ✗ 回滚后数据不同——这次变更不是纯加法的，回滚需要备份而不是改版本号"
  status=1
fi

[ "$status" = "0" ] && echo "── 通过：可以升级线上库" || echo "── 未通过：不要升级线上库"
exit "$status"
