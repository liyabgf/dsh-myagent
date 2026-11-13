# 运行边索引

AST枚举注册/事件/效果/KV调用。参数文字来自源码，不代表调用一定可达；拓扑语义与发现见topology和分报告。

|文件|行|调用|首参数|
|---|---:|---|---|
|src/app/agent-delivery.ts|42|ctx.on|'session/event'|
|src/app/agent-delivery.ts|51|this.seen.set|session|
|src/app/agent-delivery.ts|62|this.seen.set|agent.session|
|src/app/delivery.ts|519|host.effects.handle|'notify'|
|src/app/delivery.ts|520|host.effects.handle|'send'|
|src/app/delivery.ts|587|this.host.effects.enqueue|'notify'|
|src/app/delivery.ts|597|this.host.effects.enqueue|'notify'|
|src/app/delivery.ts|637|this.host.effects.enqueue|'send'|
|src/app/delivery.ts|758|this.host.effects.enqueue|'notify'|
|src/app/desk-loop.ts|116|this.enqueue|{ kind: 'relay', requestId, text, ticketId }|
|src/app/desk-loop.ts|125|this.enqueue|{ kind: 'notify', requestId, text, ticketId }|
|src/app/effects.ts|96|this.handlers.set|kind|
|src/app/executor.ts|332|host.effects.handle|'launch'|
|src/app/executor.ts|333|host.effects.handle|'input'|
|src/app/executor.ts|346|this.host.effects.enqueue|'launch'|
|src/app/executor.ts|352|this.host.effects.enqueue|'input'|
|src/app/executor.ts|388|this.host.effects.enqueue|'launch'|
|src/app/executor.ts|400|this.host.effects.enqueue|'launch'|
|src/app/executor.ts|438|this.host.effects.enqueue|'launch'|
|src/app/executor.ts|490|this.starting.set|ticketId|
|src/app/health.ts|28|this.entries.set|name|
|src/app/http.ts|366|route|'GET'|
|src/app/http.ts|367|route|'GET'|
|src/app/http.ts|378|route|'GET'|
|src/app/http.ts|413|route|'POST'|
|src/app/http.ts|427|route|'POST'|
|src/app/http.ts|437|route|'GET'|
|src/app/http.ts|438|route|'POST'|
|src/app/http.ts|439|route|'GET'|
|src/app/http.ts|445|route|'GET'|
|src/app/http.ts|451|route|'POST'|
|src/app/http.ts|452|route|'POST'|
|src/app/http.ts|453|route|'POST'|
|src/app/http.ts|454|route|'POST'|
|src/app/http.ts|455|route|'POST'|
|src/app/http.ts|456|route|'POST'|
|src/app/http.ts|459|route|'POST'|
|src/app/http.ts|461|route|'POST'|
|src/app/http.ts|462|route|'GET'|
|src/app/http.ts|467|route|'POST'|
|src/app/http.ts|471|route|'GET'|
|src/app/http.ts|479|route|'GET'|
|src/app/http.ts|485|route|'POST'|
|src/app/http.ts|492|route|'POST'|
|src/app/http.ts|498|route|'POST'|
|src/app/http.ts|504|route|'POST'|
|src/app/http.ts|510|route|'POST'|
|src/app/http.ts|517|route|'POST'|
|src/app/http.ts|526|route|'POST'|
|src/app/http.ts|532|route|'GET'|
|src/app/http.ts|534|route|'GET'|
|src/app/http.ts|536|route|'GET'|
|src/app/http.ts|544|route|'GET'|
|src/app/http.ts|567|route|'GET'|
|src/app/http.ts|576|route|'POST'|
|src/app/http.ts|597|route|'GET'|
|src/app/http.ts|615|route|'GET'|
|src/app/http.ts|636|route|'GET'|
|src/app/http.ts|641|route|'GET'|
|src/app/http.ts|647|route|'GET'|
|src/app/http.ts|659|route|'GET'|
|src/app/http.ts|682|route|'GET'|
|src/app/http.ts|720|route|'PUT'|
|src/app/http.ts|725|route|'GET'|
|src/app/http.ts|740|route|'GET'|
|src/app/http.ts|741|route|'GET'|
|src/app/http.ts|742|route|'POST'|
|src/app/http.ts|746|route|'POST'|
|src/app/http.ts|751|route|'POST'|
|src/app/http.ts|755|route|'PUT'|
|src/app/http.ts|761|route|'POST'|
|src/app/http.ts|766|route|'POST'|
|src/app/http.ts|771|route|'GET'|
|src/app/prompts.ts|112|this.cache.set|role|
|src/app/prompts.ts|197|this.store.set|KV.promptsConfig|
|src/app/prompts.ts|198|this.store.set|KV.promptsRevision|
|src/app/prompts.ts|209|this.store.set|KV.promptsConfig|
|src/app/prompts.ts|210|this.store.set|KV.promptsRevision|
|src/app/prompts.ts|224|this.store.set|KV.promptsConfig|
|src/app/prompts.ts|225|this.store.set|KV.promptsRevision|
|src/app/prompts.ts|244|this.store.set|KV.promptsConfig|
|src/app/prompts.ts|264|this.store.set|KV.promptsConfig|
|src/app/prompts.ts|265|this.store.set|KV.promptsRevision|
|src/app/runtime.ts|435|this.store.set|KV.mainSession|
|src/app/runtime.ts|439|this.sessionIndex.set|sessionId|
|src/app/runtime.ts|511|this.effects.handle|'trigger'|
|src/app/runtime.ts|945|this.store.set|key|
|src/app/runtime.ts|1018|this.store.set|retryKey|
|src/app/runtime.ts|1033|this.store.set|KV.operatorQueue|
|src/app/runtime.ts|1040|this.store.set|KV.operatorQueue|
|src/app/runtime.ts|1121|this.store.set|nudgeKey|
|src/app/runtime.ts|1435|this.sessionIndex.set|sessionId|
|src/app/runtime.ts|1456|this.context.on|'agent/status'|
|src/app/runtime.ts|1510|this.context.on|'agent/disposed'|
|src/app/runtime.ts|1532|this.context.on|'agent/error'|
|src/app/runtime.ts|1547|this.sessionErrors.set|agent.id|
|src/app/session-health.ts|83|this.problems.set|subject|
|src/app/sessions.ts|440|this.ctx.on|'agent/created'|
|src/app/sessions.ts|449|this.ctx.on|'tools/result'|
|src/app/sessions.ts|594|presets.set|agent.session|
|src/app/sessions.ts|701|this.bindings.set|agent|
|src/app/sessions.ts|749|this.crafts.set|agent|
|src/app/sessions.ts|926|this.attempts.set|ticket.id|
|src/app/store.ts|784|this.set|KV.settingsDocument|
|src/app/store.ts|785|this.set|KV.settingsRevision|
|src/app/store.ts|829|this.set|KV.lostTriggers|
|src/core/engine.ts|336|this.emit|{ type: 'trigger.received', triggerId: trigger.id, disposition }|
|src/core/engine.ts|396|this.emit|{ type: 'trigger.received', triggerId: trigger.id, disposition }|
|src/core/engine.ts|405|this.emit|{ type: 'ticket.created', ticket: prepared }|
|src/core/engine.ts|624|this.emit|{ type: 'ticket.resumed', ticket: next }|
|src/core/engine.ts|709|this.emit|{ type: 'assignment.ended', ticketId, assignmentId: assignment.id }|
|src/core/engine.ts|712|this.emit|{ type: 'ticket.ended', ticket: next }|
|src/core/engine.ts|776|this.emit|{ type: 'assignment.started', ticketId, assignmentId }|
|src/core/engine.ts|833|this.emit|{ type: 'report.recorded', ticket: updated, report: next }|
|src/core/engine.ts|1213|this.emit|{ type: 'assignment.ended', ticketId, assignmentId: assignment.id }|
|src/core/engine.ts|1214|this.emit|{ type: 'ticket.ended', ticket: next }|
|src/core/engine.ts|1216|this.emit|{ type: 'report.recorded', ticket: next, report: recorded }|
|src/core/engine.ts|1283|this.emit|{ type: 'policy.changed', effects }|
|src/core/engine.ts|1326|this.emit|{ type: 'assignment.ended', ticketId, assignmentId: assignment.id }|
|src/core/engine.ts|1327|this.emit|{ type: 'ticket.ended', ticket: next }|
|src/core/engine.ts|1713|this.emit|{ type: 'ticket.ended', ticket: next }|
|src/core/memory.ts|14|this.records.set|record.trigger.id|
|src/core/memory.ts|17|this.records.set|id|
|src/core/memory.ts|23|this.records.set|this.keyOf(dependency.upstream, dependency.downstream)|
|src/core/memory.ts|29|this.records.set|key|
|src/core/memory.ts|47|this.records.set|project.id|
|src/core/memory.ts|52|this.records.set|id|
|src/core/memory.ts|57|this.records.set|work.id|
|src/core/memory.ts|63|this.records.set|id|
|src/core/memory.ts|69|this.records.set|ticket.id|
|src/core/memory.ts|83|this.records.set|id|
|src/core/memory.ts|89|this.records.set|decision.id|
|src/core/memory.ts|95|this.records.set|id|
|src/core/memory.ts|100|this.records.set|`${artifact.ticketId}\u0000${artifact.path}`|
|src/core/memory.ts|107|this.records.set|key|
|src/core/memory.ts|114|this.records.set|thread.key|
|src/core/timing.ts|56|formats.set|zone|
|src/sources/cron.ts|114|this.cursor.set|state|
|src/sources/cron.ts|271|this.cursor.set|state|
|src/sources/registry.ts|60|this.running.set|kind.name|
|src/sources/registry.ts|61|this.signatures.set|kind.name|
|src/sources/rule.ts|99|this.host.effects.enqueue|'trigger'|
