# Examples 历史脚本逐文件代码审核（27/27 脚本全文完成；历史事实未审）

仅本报告写入；按 inventory.json 锁定 examples 下全部 Python 脚本，逐文件全文阅读。禁止联网、执行采集、安装、构建、改代码及运行态。历史文本/HTML/PDF仅枚举，新闻事实未审；未读条目保持未审。

## 操作日志

- E001（完成）：读取 docs/v2/audit38/inventory.json（只读局部，完整文件2711行）；glob 枚举得到 27 个 `examples/**/*.py`，与交付数一致。未执行任何脚本。
- E002（完成）：全文读取全部 27 个脚本；按静态代码审查记录职责、IO、依赖、失败和路径特征。未运行脚本。
- E003（完成）：读 examples/README.md 52 行、daily-digest.json 32 行、data-report.md 20 行，locale/en.json与zh.json各6行、.gitignore 10行、LICENSE 21行。库存扫描 examples 路径206项，包含125457行；不逐条读取历史采集件。

## 逐文件覆盖

| 文件 | 全文/行数 | 职责与代码审查（静态） |
|---|---:|---|
| examples/real-run-1-collect/scripts/article.py | 已读 33 | 读 HTML、复用 html2txt T，stdout 截断文章+正则提元数据；无网络/写入；未校验 argv 长度，标题不解实体，文件可任意绝对路径 |
| examples/real-run-1-collect/scripts/body.py | 已读 25 | 读文本筛长行/前缀去重，stdout 截断；无依赖/写入；短段(<75)一律丢、去重只看前70 chars，可误删不同段 |
| examples/real-run-1-collect/scripts/digest_news.py | 已读 60 | glob 固定 BASE/raw RSS XML、stdout TSV；ET 解析+正则移除 namespace；ParseError 静默空集；未验证 feed/条目数，clean 标签正则非HTML parser |
| examples/real-run-1-collect/scripts/fetch.py | 已读 76 | manifest TSV→curl外网→raw/与manifest.csv追加；stdlib+curl；无URL allowlist/尺寸上限/逐行错误隔离，slug 冲突覆写；subprocess非零码仍依stdout判断；终止可留半文件/半记录；硬编码联系信息与UA；不可复用且有采集副作用（本轮未执行） |
| examples/real-run-1-collect/scripts/gnews_decode.py | 已读 56 | 输入ID，curl两次Google私有batchexecute协议、间隔0.4秒、stdout TSV；无 curl 超时外层/返回码校验，可能stdout空而错误静默成为no-signature；ID未编码，调用任意输入可构造路径URL；解析嵌套JSON可能抛错 |
| examples/real-run-1-collect/scripts/html2txt.py | 已读 50 | stdlib HTMLParser读取HTML，可选写文本；跳过标签用单计数器，非嵌套/损坏标记可能错配；head片段策略宽；写目标直接覆盖非原子；路径由参数给定 |
| examples/real-run-1-collect/scripts/mk_appendix.py | 已读 204 | manifest读入→大量硬编码 claim/source key→覆写 brief.md 附录；stdlib；未找到key会显式标记；URL只转义竖线；以首次marker切割重写，重复运行替换附录；硬编码样例事实不是审计证据 |
| examples/real-run-1-collect/scripts/mk_m8.py | 已读 62 | 固定digest.tsv按title片段择条并输出搜索URL；stdlib；依赖当前工作目录；不校验TSV字段/URL，slug可能碰撞，缺匹配打印MISS |
| examples/real-run-1-collect/scripts/mk_news_manifest.py | 已读 48 | 固定query列表输出Bing/Google RSS TSV；urllib；纯stdout无副作用；未做URL/slug重复检验，硬编码市场/时间约束 |
| examples/real-run-1-collect/scripts/mk_news_manifest2.py | 已读 54 | 第二波query及HN Algolia URL TSV；依赖stdlib；纯stdout；HN numericFilters固定epoch，查询窗口/参数版本硬编码，未校验 |
| examples/real-run-1-collect/scripts/mk_registry.py | 已读 52 | manifest.csv→按域分类生成registry.md直接覆写；stdlib；domain标为registrable但仅去www；只将状态200且有local_path列为成功，不核对文件/bytes/hash；失败明列 |
| examples/real-run-1-collect/scripts/parse_hn.py | 已读 29 | 读JSON列表或glob、去重按日期/分数输出；stdlib；objectID缺失时多个记录均视为同一None而丢弃；异常catch过宽但可继续 |
| examples/real-run-1-collect/scripts/parse_rss.py | 已读 48 | RSS/Atom转TSV；stdlib ET；破坏式去namespace正则可能破坏文本/属性，仅支持无namespace element；错误明列；TSV字段未转义嵌入tab/newline |
| examples/real-run-1-collect/scripts/pick_articles.py | 已读 32 | digest.tsv按片段选第一条Bing URL输出；依赖cwd固定路径；重复URL不输出；slug不完全净化且冲突不检测；坏行跳过 |
| examples/real-run-2-compare/analysis/scratch/bnews.py | 已读 22 | 即时curl Bing RSS、regex抽item并解apiclick url；stdlib+curl；输出不持久；HTTP状态/returncode忽略，XML regex易破，任意query直接网络 |
| examples/real-run-2-compare/analysis/scratch/bsearch.py | 已读 33 | curl Bing网页、regex提结果/解base64 redirect；stdlib+curl；错误输出可见；HTML结构脆弱，输出标题/URL摘要手动截断，无HTTP状态校验 |
| examples/real-run-2-compare/analysis/web/bingnews.py | 已读 18 | JSON批量query→curl并写指定文件、摘要RSS；stdlib+curl；异常每query捕获、sleep 1；输入路径不受控可覆盖任意指定文件，未检查HTTP/状态码，query拼URL未quote_plus |
| examples/real-run-2-compare/analysis/web/bingurls.py | 已读 22 | JSON query→curl Bing RSS并解URL；stdlib+curl；异常局部捕获、sleep；与bingnews重复逻辑但不存原始响应，regex/HTTP未验证 |
| examples/real-run-2-compare/analysis/web/gnsearch.py | 已读 22 | Google RSS批次抓取写指定路径；stdlib+curl；异常局部捕获、sleep；导入json前赋 `Q=json=None` 冗余；无HTTP校验，任意输出路径直接覆写 |
| examples/real-run-2-compare/scripts/build_chronology.py | 已读 667（1–463+464–667） | 硬编码 E 事件数组→analysis CSV+MD；stdlib csv/os；不读/验证引用源或日期/字段语义；两个目标直接覆写非事务；路径正文残留历史Ticket绝对位置，MD字段不转义竖线；作为记录模板可复用，事实部分仅历史数据 |
| examples/real-run-2-compare/scripts/build_exposure_register.py | 已读 177 | 硬编码 R→analysis CSV；stdlib csv/os；不读取 docstring 所称MD来源，人工保持两份可能漂移；枚举/金额不验证，无货币合并计算；直接覆盖；作为小型结构数据导出器可复用 |
| examples/real-run-2-compare/scripts/fetch_legal.py | 已读 287 | 固定官方/聚合URL→raw临时.part+replace、追加manifest；stdlib+curl；90秒外层、60秒curl、两次重试、0.4秒节流；curl `-w` 的 `\\t` 经 curl 格式化成 TAB，程序按 TAB 解析，初始疑点已撤销；无尺寸/URL限制；模块import会mkdir |
| examples/real-run-2-compare/scripts/fetch_sec.py | 已读 167 | 本地submissions选择filing→curl→HTML转txt→提legal passages写MD；stdlib+curl+同目录html2txt；老索引URL根错（EX-02）；HTTP失败仍manifest记local且留错误页；TimeoutExpired未捕获；无节流/下载限额；提取[:14000]不标截断 |
| examples/real-run-2-compare/scripts/fetch_stage3.py | 已读 303 | uk/eu/doj/news四part外网采集，raw/txt/manifest写入；stdlib+curl，可选vendor/pypdf；双层timeout但returncode不判断；失败仍记local、覆盖旧文件；pdf异常统一称unavailable；模块import mkdir；固定URL数组可参数化复用 |
| examples/real-run-2-compare/scripts/filter_legal.py | 已读 137 | 读index_all.tsv关键词评分/规范标题去重→notes TSV/MD；stdlib；prefix110碰撞会合并不同文章；替换胜出行时corpus合并写旧对象（EX-03）；同日期score反向排序低分先，可能非意图；阈值/词表未验证 |
| examples/real-run-2-compare/scripts/html2txt.py | 已读 72 | stdlib HTMLParser→文本、可写文件；缺输出父目录时makedirs('')失败（EX-04）；table每cell换行丢对应；双引号/弯引号转换改变原文；简单skip计数非严格DOM |
| examples/real-run-2-compare/scripts/parse_index.py | 已读 232 | 多格式本地raw→TSV；stdlib；兄弟路径含~但无expanduser，默认静默0行（EX-05）；解析错误静默；SEC平行数组不校验长度；只净化snippet tab，title/pub/link可破坏TSV；只读数据不执行外部文本 |

## 索引、配方、发布边界与附录

| 文件 | 全文覆盖 | 结论 |
|---|---:|---|
| examples/README.md | 52行 | 两配方介绍；“完整设置直接粘贴”会重设未包含字段为schema默认，需提醒用户；“只认title/scope”已落后于附件能力 |
| examples/daily-digest.json | 32行 | observe安全默认；cron Asia/Shanghai；scope允许共享成品目录；report.files要求共享目录绝对路径，与常见仅登记Ticket内相对产物契约可能冲突，需引擎复核，候选；未执行 |
| examples/data-report.md | 20行 | inbox请求，无网络、只读data、成品本目录；缺数据dropped；matplotlib仅已有可用时画图；目录/文件表述不一致但不影响核心IO边界 |
| examples/real-run-1-collect/README.md | 62行 | 历史入口/目录说明；列raw与digest等文件并不证明当前仓随附；历史成功/条数/事实声明未核验 |
| examples/real-run-2-compare/README.md | 105行 | 历史任务说明；复现命令指向旧运行态目录；不能直接视为此仓可复现；“所有案号均未取得”与前文具名案号不一致属于历史文档自述，不作事实审定 |
| locale/en.json | 6行 | meta title/description；无执行/文件/网络动作；文案省略chat/rule，只是描述不完整 |
| locale/zh.json | 6行 | 与en键一致；无凭据、无执行面 |
| .gitignore | 10行 | `/lib/`锚定顶层、私有blocklist锚定；仅Git忽略不能替代release rsync排除（主报告另审） |
| LICENSE | 21行 | 标准MIT软件许可；不自动证明第三方历史抓取文章转载许可，本文不作法律结论 |

发布关系（当前 package.json:18–29、已在主报告全文读取）：npm files 仅匹配 `examples/*.md` 与 `examples/*.json`，实际顶层为 README.md、data-report.md、daily-digest.json；`examples/real-run-*` 的27脚本和历史语料不在该随包清单。运行时配方通过 recipes 读取顶层模板，历史脚本无导入主链证据。Git公开副本不同：scripts/release.sh:353–368 显式保留并排除覆盖 `examples/real-run-*`，因此公开仓可继续含历史资产；“不进npm包”不等于“不进GitHub仓库”。本轮未构建/打包验证，判断是静态manifest边界。

历史资产枚举：inventory.json 中 `examples/` 共206项（grep获得206条路径），完整逐路径/行数/哈希清单引用 `docs/v2/audit38/inventory.json:507–1948`；本报告27代码表逐条覆盖所有py。非代码179项包含顶层配方/README、两轮README/RESULT、run1 brief/registry/manifest与m1–m10 TSV、run1 txt 新闻/官方/SEC文本、run2 analysis 01–05/两个CSV、notes候选/SEC摘录/子任务稿、三阶段manifest、run2 txt SEC/DOJ/EU/UK/articles。原始HTML/XML/JSON/PDF与vendor/raw目录主要在历史README中描述，inventory所列当前受控项不证明这些原件仍在；如存在额外未受控资产，未枚举未审。没有逐条事实核验，没有把历史成功声明用作当前代码证据。

完成边界：27/27 Python全文静态审核、5份examples索引/配方全文与4个附录文件全文。所有历史新闻文本、CSV/TSV内容、HTML/PDF原始字节、外部接口现行语义/可用性仍未审；不宣称采集可运行或报告事实正确。除本报告外未写文件；未联网、安装、构建、运行脚本、变更运行态或生产代码。E004收口：复读本报告并更正EX-01初始转义误报；两次对edit传相同old/new被工具拒绝，未产生文件变更，随后使用有效定向edit完成。

## 候选与确认问题（历史代码，不代表运行主链缺陷）

### EX-01 · curl元数据分隔符初始疑点（撤销，不是缺陷）

位置：real-run-2-compare/scripts/fetch_legal.py:230、239–248。`-w` 的反斜线+t由curl格式器展开TAB，再按真实TAB切分符合约定；不应把Python源码双反斜线直接当成最终输出。此前表中“可能全失败”已撤回；本轮未执行curl。

### EX-02 · fetch_sec 老版索引 URL 拼错且失败后继续（中，置信度高）

位置：real-run-2-compare/scripts/fetch_sec.py:54–71。触发：submissions.files 给出 `CIK...-submissions-001.json` 等历史索引名。代码拼 `https://www.sec.gov/Archives/edgar/daily-index/`，而 SEC submissions 的历史文件应在 data.sec.gov/submissions 下（外部协议结论尚未联网复核，列候选）；失败只log继续，无法证明“last four”齐全。无字段数量/排序校验亦可能选错，缺口应报告。

### EX-03 · 去重替换后 corpus 合并写到旧对象（中，置信度高）

位置：real-run-2-compare/scripts/filter_legal.py:99–105。触发：同标题第二行分数更高，或同分但日期更新。证据：先 `old=seen[key]`；胜出时 `seen[key]=r`，随后却修改 `old['corpus']`。影响：新胜出记录丢失旧语料来源，输出血缘不足；不会自动报错。应合并双方corpus再决定胜出记录。

### EX-04 · HTML转换器无法输出到当前目录文件名（低，置信度高）

位置：real-run-2-compare/scripts/html2txt.py:61–67。触发：按usage用 `out.txt` 作为相对目标，`os.path.dirname('out.txt')==''`；`os.makedirs('',exist_ok=True)` 抛 FileNotFoundError，转换结果未写。当前fetch_sec直接调convert不触发此CLI缺陷。

### EX-05 · 兄弟语料波浪号路径永不展开（中，置信度高）

位置：real-run-2-compare/scripts/parse_index.py:26–27、196–200。触发：默认运行。证据：CORPORA sibling 字面`~/.dsh/...`直接 `glob.glob(os.path.join(d,'*'))`，没有 expanduser；Python glob不做shell home展开。影响：sibling通常0行且无缺目录告警，声明的跨票比较语料遗漏；即使展开仍硬编码历史票号，不能从此仓复制直接复用。

### EX-06 · 采集/转换器直接覆写与静默失败形成证据链缺口（中，置信度高）

位置：run1/fetch.py:29–58/61；run2/fetch_sec.py:30–35/108–120；fetch_stage3.py:127–139/153–168/277–280；analysis/web/bingnews.py:5–7、gnsearch.py:5–7。触发：重复采集、网络非零/HTTP错误、进程在写入后但manifest前中止。影响：同名旧成功档可被错误页或部分内容覆盖；manifest追加旧记录仍指向新字节；无hash/不可变采样ID，无法从记录证明历史引文对应的字节。仅run2/fetch_legal成功路径采用.part+replace，但仍同名覆盖、没有不可变内容摘要。建议以run目录+内容哈希记录，错误记录不指向成功local，报告明确partial。

### EX-07 · HTML skip计数器可被空标签吞掉后续正文（低/中，置信度高）

位置：run1/html2txt.py:10–27 与run2/html2txt.py:12–33。触发：SKIP中的不闭合/自闭合标签（例如picture内结构不完整）或错误嵌套。计数只按标签集合+整数增减，无法验证关闭的是哪一层；HTMLParser对void/self-close行为需要专门输入覆盖。影响：后续文本被隐藏或错误恢复；这只影响派生文本，原始HTML仍在。候选需离线夹具验证，本轮未运行。
