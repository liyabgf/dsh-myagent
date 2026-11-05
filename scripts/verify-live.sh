#!/usr/bin/env bash
# 对已经装了 myagent 的宿主做只读验证：不创建 Ticket、不创建 Session、不改设置。
#
#   ./scripts/verify-live.sh                 # 默认 http://127.0.0.1:3080
#   PORT=3180 ./scripts/verify-live.sh       # 换个端口
#
# 退出码 0 = 全部通过；1 = 有断言失败（逐条打印）。
set -uo pipefail

BASE="http://127.0.0.1:${PORT:-3080}/myagent"
H='x-myagent-request: 1'
pass=0; fail=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
check() { if [ "$2" = "$3" ]; then ok "$1（$2）"; else bad "$1：期望 $3，实际 $2"; fi; }

code() { curl -s --max-time 8 -o /dev/null -w '%{http_code}' "$@"; }
json() { curl -s --max-time 8 -H "$H" "$BASE/api/$1"; }

echo "验证 $BASE"

echo "── 1. 插件挂载了"
check "面板页" "$(code "$BASE/")" "200"

echo "── 2. 同源守卫（不该给的一律 403）"
check "无标记头访问 API" "$(code "$BASE/api/state")" "403"
check "跨源 Origin" "$(code -H "$H" -H 'origin: http://example.com' "$BASE/api/state")" "403"
check "带标记头访问 API" "$(code -H "$H" "$BASE/api/state")" "200"

echo "── 3. 挂载期没有偷偷创建 Session"
state="$(json state)"
if [ -z "$state" ]; then bad "读不到 /api/state，后面全部跳过"; echo; echo "通过 $pass 条，失败 $fail 条"; exit 1; fi
exists="$(printf '%s' "$state" | python3 -c 'import json,sys; print(json.load(sys.stdin)["mainSession"]["exists"])' 2>/dev/null)"
mainid="$(printf '%s' "$state" | python3 -c 'import json,sys; print(json.load(sys.stdin)["mainSession"]["id"])' 2>/dev/null)"
printf '  · 主 Session exists=%s id=%s\n' "$exists" "$mainid"
# exists 为 True 也是合法的（你点过"创建主 Session"）；这里只报告，不判定。

echo "── 4. 健康板"
printf '%s' "$state" | python3 -c '
import json,sys
s=json.load(sys.stdin)
bad=[(k,v.get("detail")) for k,v in s["health"].items() if not v.get("ok",True)]
print("  · 问题：", bad if bad else "无")
print("  · 计数：", {k:v for k,v in s["counts"].items() if k!="effects"}, "| 队列：", s["counts"]["effects"])
print("  · 受理模式：", s["settings"]["acceptMode"], "| 暂停：", s["settings"]["paused"])
sys.exit(1 if bad else 0)' && ok "健康板无问题" || bad "健康板有问题（见上）"

echo "── 5. 排期与下次触发"
json schedules | python3 -c '
import json,sys,datetime
d=json.load(sys.stdin)
local=lambda iso: datetime.datetime.fromisoformat(iso.replace("Z","+00:00")).astimezone()
print("  · 时区", d["zone"], "| 现在", format(local(d["now"]), "%m-%d %H:%M:%S"))
if not d["schedules"]: print("  · 没有排期")
for s in d["schedules"]:
    state = "启用" if s["enabled"] else "停用"
    nxt = format(local(s["next"]), "%m-%d %H:%M:%S") if s.get("next") else "不会触发"
    print("  ·", s["id"].ljust(14), state, "下次", nxt, "|", s["describe"])
' && ok "排期可读" || bad "排期读取失败"

echo "── 6. 预览接口（写操作里唯一无害的一个，不落库）"
json_next="$(curl -s --max-time 8 -X POST -H "$H" -H 'content-type: application/json' \
  -d '{"id":"verify-probe","prompt":"验证用","timing":{"kind":"daily","time":"09:00"}}' "$BASE/api/schedules/preview")"
printf '%s' "$json_next" | python3 -c '
import json,sys,datetime
d=json.load(sys.stdin)
local=lambda iso: format(datetime.datetime.fromisoformat(iso.replace("Z","+00:00")).astimezone(), "%m-%d %H:%M")
runs=[local(n) for n in d.get("next",[])]
print("  · 描述:", d.get("describe"))
print("  · 接下来三次（本地时间）:", runs)
sys.exit(0 if len(runs)==3 and len(set(runs))==3 else 1)' && ok "预览返回三次触发" || bad "预览异常"

echo "── 7. Ticket 列表与门禁记录可读"
json 'tickets?state=all&limit=5' | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("  · 共", d["count"], "张（只显示最新 5 张）")
for t in d["tickets"][:5]:
    print("   ", t["id"][:8], "|", t["title"][:18].ljust(18), "|", t["stage"])' && ok "Ticket 列表可读" || bad "Ticket 列表读取失败"
json 'decisions?limit=5' | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("  · 门禁记录", d["count"], "条（最新 5 条）")
for x in d["decisions"][:5]:
    print("   ", x["at"][:19], "|", x["outcome"].ljust(8), "|", x["reason"], "|", str(x.get("title") or "")[:20])' && ok "门禁记录可读" || bad "门禁记录读取失败"

echo
printf '通过 %d 条，失败 %d 条\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
