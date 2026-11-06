#!/usr/bin/env node
/**
 * Real-browser verification loop for myagent's operator panel.
 *
 * Why this exists: 172+ assertions in `tests/panel.spec.ts` run under jsdom, which does not compute layout boxes
 * and did not catch either the CSS specificity bug (`#v2-banner { display: flex }` beating `.hidden`, §4.49) or
 * the 37,112 px unbounded detail height when opening a real production Ticket (`19dd5c9c`, 7.0 MB full-page screenshot).
 *
 * This script drives the machine's real Google Chrome via Playwright against the live host on port 3080 (or `PORT`),
 * captures screenshots, and asserts 5 concrete visual/computed-style invariants:
 *   1. Banner specificity & hidden state (`getComputedStyle.display === 'none'` when healthy).
 *   2. Tab switching mutual exclusion (active tab `display !== 'none'`, all 7 others `=== 'none'`).
 *   3. Bounded box-model heights (`#d-files .filelist`, `#d-artifacts`, and document scrollHeight stay bounded
 *      even on a 547-file / 78-artifact Ticket).
 *   4. Deep-link routing (`#ticket=<id>` and `#work=<id>`).
 *   5. Cross-Ticket citation backlink (F6: opening `b356ac64` shows that `19dd5c9c` cited/corrected it) + Quick Settings.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('~/deepseek-harness/benchmarks/node_modules/playwright')

const PORT = process.env.PORT || '3080'
const BASE = `http://127.0.0.1:${PORT}/myagent/`
const SHOT_DIR = process.env.SHOT_DIR || '/tmp'

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`)
    passed++
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

const LAUNCH = {
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
}
let browser = await chromium.launch(LAUNCH)

try {
  const pageErrors = []
  const consoleErrors = []
  const badResponses = []
  // `pageerror` alone is not "no errors": a failed HTTP request and a console.error are both real failures the
  // operator would see in devtools, and neither throws. An audit found exactly that gap — one 404 per page load
  // (the browser's automatic favicon probe) had been invisible to this script since it was written.
  // 抽成函数是因为下面会**换页面**（见 freshPage）：换页之后这四个监听器必须重新挂上，
  // 否则"全程 0 条控制台错误"那条断言就只在旧页面上成立——那正是量具说谎的方式。
  const attachWatchers = pg => {
    pg.on('pageerror', err => pageErrors.push(String(err)))
    pg.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 120)) })
    pg.on('response', res => { if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`) })
    pg.on('requestfailed', req => badResponses.push(`FAILED ${req.url()}`))
  }
  let page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  attachWatchers(page)

  /**
   * 换掉**整个浏览器进程**（不只是页面），并重挂监听器。
   *
   * 为什么需要它：检查从 21 条长到 77 条之后，headless Chrome 的内存一路累积，到后面两节
   * （547 文件的重型任务、跨任务深链）**随机崩**（`Target page … has been closed`，崩溃行号每次都不同——
   * 资源型崩溃的特征，不是某一行逻辑错）。
   * 已实测无效的修法：启动参数（--disable-dev-shm-usage / force-device-scale-factor，3/3 崩）、
   * fullPage→视口截图（3/3 崩）、页内 fetch→Node 侧 fetch（3/3 崩）、
   * `goto(BASE, {waitUntil:'networkidle'})`（必崩：面板每 5 秒轮询，networkidle 永远等不到空闲）、
   * **只换页面不换进程**（崩在换页那一步）。换进程才真的把内存还回去。
   */
  const relaunch = async () => {
    await browser.close()
    browser = await chromium.launch(LAUNCH)
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    attachWatchers(page)
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
  }

  console.log(`── 1. 打开面板与基础计算样式 (${BASE})`)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)

  const initStyles = await page.evaluate(() => {
    const cs = id => {
      const el = document.getElementById(id)
      return el ? getComputedStyle(el).display : null
    }
    return {
      v2Banner: cs('v2-banner'),
      chatBanner: cs('chat-banner'),
      headerPos: getComputedStyle(document.querySelector('header')).position,
    }
  })
  check('v2-banner 在正常宿主下隐藏', initStyles.v2Banner === 'none', `display=${initStyles.v2Banner}`)
  check('chat-banner 在正常宿主下隐藏', initStyles.chatBanner === 'none', `display=${initStyles.chatBanner}`)
  check('顶栏 sticky 布局生效', initStyles.headerPos === 'sticky', `position=${initStyles.headerPos}`)

  console.log('── 1b. 总览是落地页（U1）')
  const ov = await page.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return el ? getComputedStyle(el).display !== 'none' : null }
    return {
      overviewVisible: vis('tab-overview'),
      // vis() 返回布尔；写成 === 'none' 会永远为假——上一版就是这么把量具自己的 bug 报成了面板的 bug。
      ticketsHidden: vis('tab-tickets') === false,
      kpis: document.querySelectorAll('#ov-kpis .ov-kpi').length,
      kpiLabels: [...document.querySelectorAll('#ov-kpis .l')].map(n => n.textContent.trim()),
      attentionText: (document.getElementById('ov-attention')?.textContent || '').trim().slice(0, 40),
      firstTabSelected: document.querySelector('#tabs button')?.getAttribute('aria-selected'),
      firstTabLabel: document.querySelector('#tabs button')?.textContent.trim(),
    }
  })
  check('落地即总览（tab-overview 可见、tab-tickets 隐藏）', ov.overviewVisible === true && ov.ticketsHidden === true,
    `overview=${ov.overviewVisible} ticketsHidden=${ov.ticketsHidden}`)
  check('第一个导航项是「总览」且为选中态', ov.firstTabLabel === '总览' && ov.firstTabSelected === 'true', `${ov.firstTabLabel}/${ov.firstTabSelected}`)
  check('KPI 一排 6 张卡，且不含机器路径', ov.kpis === 6 && !ov.kpiLabels.some(l => l.includes('/Users')), ov.kpiLabels.join('|'))
  check('「需要你处理」有内容或明确说"系统安静"（不是空白/[object]）',
    ov.attentionText.length > 0 && !ov.attentionText.includes('[object'), ov.attentionText)

  console.log('── 1c. 健康抽屉与打通（U2 / U3）')
  // 状态胶囊可点 → 抽屉打开（计算样式，不是 classList：§4.49 的教训）
  await page.click('#health')
  await page.waitForTimeout(500)
  const drawerOpen = await page.evaluate(() => {
    const d = document.getElementById('health-drawer')
    const cs = getComputedStyle(d)
    return {
      display: cs.display,
      position: cs.position,
      width: Math.round(d.getBoundingClientRect().width),
      onTop: cs.zIndex,
      rows: d.querySelectorAll('table tbody tr').length,
      text: (d.textContent || '').slice(0, 60),
      links: d.querySelectorAll('button.linklike').length,
    }
  })
  check('点状态胶囊打开健康抽屉（display 非 none、fixed 定位、在视口内）',
    drawerOpen.display !== 'none' && drawerOpen.position === 'fixed' && drawerOpen.width > 200 && drawerOpen.width <= 460,
    `display=${drawerOpen.display} pos=${drawerOpen.position} w=${drawerOpen.width}`)
  check('抽屉里列出健康条目（表格行 > 0）', drawerOpen.rows > 0, `rows=${drawerOpen.rows}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const drawerClosed = await page.evaluate(() => getComputedStyle(document.getElementById('health-drawer')).display)
  check('Esc 关闭抽屉', drawerClosed === 'none', `display=${drawerClosed}`)

  // 两个顶栏胶囊的"可点"线索（cursor），以及归属行是否真的是按钮而不是死文本
  const clickables = await page.evaluate(() => {
    const cur = id => { const el = document.getElementById(id); return el ? getComputedStyle(el).cursor : null }
    return { health: cur('health'), chatWaiting: cur('chat-waiting'), lost: cur('lost-count') }
  })
  check('状态胶囊 cursor=pointer（"可点"的唯一视觉线索）', clickables.health === 'pointer', `cursor=${clickables.health}`)

  // 归属按钮只在"这张任务真的归入了某条工作"时才存在。所以先问 API 找一张有归属的，而不是随便点第一张——
  // 随便点会得到"没有按钮"，而那既可能是缺陷也可能只是这张没归入，两者不可区分（不可区分的断言等于没有断言）。
  const filedId = await page.evaluate(async () => {
    const res = await fetch('/myagent/api/tickets?state=all&limit=200', { headers: { 'x-myagent-request': '1' } })
    const body = await res.json()
    return (body.tickets || []).find(t => t.workId)?.id ?? null
  })
  if (filedId === null) {
    // 如实记为跳过，不算通过也不算失败：这个部署里没有归入工作的任务，本条无法在真浏览器上行使。
    // 机制本身由 tests/panel.spec.ts 的夹具测试保证（那条是能失败的，且经变异检验）。
    console.log('  – 归属行可点（U3 缺口 1）：跳过 —— 本部署没有任何任务归入工作，无可断言对象')
  } else {
    await page.goto(`${BASE}#ticket=${filedId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const belong = await page.evaluate(() => {
      const btn = document.querySelector('#detail .kv button.linklike')
      return btn ? { text: btn.textContent.trim(), cursor: getComputedStyle(btn).cursor } : null
    })
    check('归属行是可点按钮而非死文本（U3 缺口 1）',
      belong !== null && belong.cursor === 'pointer' && belong.text.length > 0,
      belong ? `${belong.text} cursor=${belong.cursor}` : '有归属却没画出按钮')
  }

  // U4：先打开一张任务再量——检查跑在 #detail 为空的时候，量的是"没有东西"，不是"折叠行为"。
  await page.click('#tabs button[data-tab="tickets"]')
  await page.click('#filter button[data-filter="all"]')  // 【U7】下拉改 chips
  await page.waitForTimeout(500)
  const anyRow = await page.$('#tickets li:not(.group-head)')  // 【U22】排除分段标题
  if (anyRow) { await anyRow.click(); await page.waitForTimeout(700) }
  const fold = await page.evaluate(() => {
    const d = document.querySelector('#detail details.tech')
    if (!d) return null
    const closed = !d.hasAttribute('open')
    const textLen = (d.textContent || '').length
    d.open = true
    const openedHeight = Math.round(d.getBoundingClientRect().height)
    d.open = false
    return { closed, textLen, openedHeight }
  })
  check('技术细节默认折叠且折叠时不丢文本（U4）',
    fold !== null && fold.closed === true && fold.textLen > 40,
    fold ? `closed=${fold.closed} 折叠内文本 ${fold.textLen} 字，展开后高 ${fold.openedHeight}px` : '页面上没有技术细节折叠区')

  // U6：提示词分角色卡（只读；U5 的结果卡片要一次真实的创建才能出现，而本脚本是只读的——
  // 那一包由 tests/panel.spec.ts 的三条夹具测试覆盖，这里不假装验过。）
  await page.click('#tabs button[data-tab="prompts"]')
  await page.waitForTimeout(600)
  const prompts = await page.evaluate(() => {
    const card = role => {
      const c = document.getElementById(`prompt-card-${role}`)
      if (!c) return null
      return {
        visible: getComputedStyle(c).display !== 'none',
        chip: document.getElementById(`p-${role}-state`)?.textContent.trim() ?? null,
        count: document.getElementById(`p-${role}-count`)?.textContent.trim() ?? null,
        hasReset: document.getElementById(`p-${role}-reset`) !== null,
      }
    }
    return { worker: card('worker'), orchestrator: card('orchestrator') }
  })
  check('提示词两个角色各有卡片、状态芯片、字数与单角色恢复按钮（U6）',
    prompts.worker !== null && prompts.orchestrator !== null
      && prompts.worker.visible && prompts.worker.chip !== null && prompts.worker.hasReset
      && /字$/.test(prompts.worker.count ?? ''),
    `worker=${JSON.stringify(prompts.worker)} orchestrator=${JSON.stringify(prompts.orchestrator)}`)
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  // U7：筛选 chips 与导航徽标
  await page.click('#tabs button[data-tab="tickets"]')
  await page.waitForTimeout(500)
  const chips = await page.evaluate(() => {
    const list = [...document.querySelectorAll('#filter .chip-btn')]
    return {
      count: list.length,
      labels: list.map(b => b.textContent.trim()),
      pressed: list.map(b => b.getAttribute('aria-pressed')),
      pressedBg: list.length ? getComputedStyle(list.find(b => b.getAttribute('aria-pressed') === 'true') || list[0]).backgroundColor : null,
    }
  })
  check('筛选是 4 档 chips 且恰有一档处于按下态（U7）',
    chips.count === 4 && chips.pressed.filter(v => v === 'true').length === 1,
    `${chips.labels.join('|')} pressed=${chips.pressed.join(',')}`)
  await page.click('#filter button[data-filter="all"]')
  await page.waitForTimeout(400)
  const afterChip = await page.evaluate(() =>
    [...document.querySelectorAll('#filter .chip-btn')].map(b => b.getAttribute('aria-pressed')).join(','))
  check('点「全部」后按下态跟着换档', afterChip === 'false,false,false,true', afterChip)
  const navLabels = await page.evaluate(() =>
    [...document.querySelectorAll('#tabs button')].map(b => {
      const clone = b.cloneNode(true)
      clone.querySelectorAll('.badge').forEach(x => x.remove())
      return clone.textContent.trim()
    }))
  check('菜单用操作者的词（任务/记录，不再是 Ticket/门禁记录）',
    navLabels.includes('任务') && navLabels.includes('记录') && !navLabels.includes('Ticket') && !navLabels.includes('门禁记录'),
    navLabels.join('|'))

  // U8：列表时刻是相对表达，绝对时刻在 title 上（相对化不能丢信息）
  const times = await page.evaluate(() => {
    // 【U22】行里现在有两种带 title 的 span：时刻（title=绝对时刻）与结局原因（title=整句原文）。
    // 只取前一种——又一次"给容器新增同类元素后，'取第一个'的选择器被抢位"，这次是选择器按属性筛，不只按位置。
    const cells = [...document.querySelectorAll('#tickets li .meta span')].filter(n => /\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}:\d{2}/.test(n.getAttribute('title') ?? ''))
    return cells.slice(0, 3).map(n => ({ text: n.textContent.trim(), title: n.getAttribute('title') }))
  })
  check('任务列表用相对时间且 title 带绝对时刻（U8）',
    times.length > 0 && times.every(t => /刚刚|分钟前|小时前|天前|\d{4}\//.test(t.text) && /\d{4}/.test(t.title || '')),
    times.map(t => `${t.text}←${t.title}`).join(' ; ') || '没有带 title 的时刻单元')

  // U9：全局搜索（⌘K 聚焦 → 输入 → 结果出现且可点）
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  await page.waitForTimeout(200)
  const focused = await page.evaluate(() => document.activeElement?.id === 'search')
  check('⌘/Ctrl+K 聚焦搜索框（U9）', focused === true, `activeElement=${focused}`)
  await page.fill('#search', '信息')
  await page.waitForTimeout(500)
  const sr = await page.evaluate(() => {
    const out = document.getElementById('search-results')
    if (!out) return null
    const rows = [...out.querySelectorAll('.sr')]
    return {
      visible: getComputedStyle(out).display !== 'none',
      rows: rows.length,
      first: rows[0] ? rows[0].textContent.trim().slice(0, 30) : null,
      // 结果框必须真的浮在内容之上（z-index + fixed/absolute 定位），否则会被页面内容盖住。
      pos: getComputedStyle(out).position,
      z: getComputedStyle(out).zIndex,
    }
  })
  check('输入后结果浮层出现、有行、且定位在内容之上',
    sr !== null && sr.visible && sr.rows > 0 && sr.pos === 'absolute' && Number(sr.z) >= 60,
    sr ? `rows=${sr.rows} pos=${sr.pos} z=${sr.z} first=${sr.first}` : '没有 #search-results')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const cleared = await page.evaluate(() => ({
    value: document.getElementById('search')?.value,
    hidden: document.getElementById('search-results')?.classList.contains('hidden'),
  }))
  check('Esc 清空搜索并收起结果', cleared.value === '' && cleared.hidden === true, JSON.stringify(cleared))

  // U10：Esc 一次只关一层（这正是分处注册时踩到的缺陷）
  await page.click('#tabs button[data-tab="tickets"]')
  await page.waitForTimeout(400)
  const row0 = await page.$('#tickets li:not(.group-head)')  // 【U22】排除分段标题
  if (row0) { await row0.click(); await page.waitForTimeout(700) }
  const fileBtn = await page.$('#d-files button.linklike')
  if (fileBtn) {
    await fileBtn.click()
    await page.waitForTimeout(600)
    const opened = await page.evaluate(() => (document.getElementById('d-fileview')?.textContent || '').trim().length)
    await page.click('#health')
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const afterOne = await page.evaluate(() => ({
      drawerHidden: document.getElementById('health-drawer').classList.contains('hidden'),
      fileLen: (document.getElementById('d-fileview')?.textContent || '').trim().length,
    }))
    check('Esc 一次只关一层：抽屉关了，文件查看器还在（U10）',
      opened > 0 && afterOne.drawerHidden === true && afterOne.fileLen > 0,
      `抽屉关=${afterOne.drawerHidden} 查看器字数=${afterOne.fileLen}（开时 ${opened}）`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const afterTwo = await page.evaluate(() => (document.getElementById('d-fileview')?.textContent || '').trim().length)
    check('再按一次 Esc 才收起文件查看器', afterTwo === 0, `字数=${afterTwo}`)
  } else {
    console.log('  – Esc 分层（U10）：跳过 —— 该任务目录里没有可点的文件')
  }

  // U11：设置分区表单 + 脏状态 + JSON 折叠
  await page.click('#tabs button[data-tab="settings"]')
  await page.waitForTimeout(500)
  const st = await page.evaluate(() => {
    const dirty = document.getElementById('settings-dirty')
    const advanced = document.getElementById('settings-advanced')
    return {
      sections: document.querySelectorAll('.set-sec').length,
      dirtyHidden: dirty?.classList.contains('hidden'),
      secButtons: document.querySelectorAll('.set-sec button[data-sec]').length,
      advancedOpen: advanced?.hasAttribute('open'),
      // **不量子节点的盒子**：Chrome 对闭合的 <details> 用 content-visibility 跳过内容渲染，
      // 而这个 textarea 自带 min-height:340px，自身盒子仍然报 340px——量子节点永远"可见"，量具错（第三次同类）。
      // 可靠的布局事实是 <details> 自己的高度：闭合时 ≈ summary 高，展开后远大于它。
      detailsHeight: Math.round(advanced.getBoundingClientRect().height),
      summaryHeight: Math.round(advanced.querySelector('summary').getBoundingClientRect().height),
    }
  })
  check('设置分成分区表单且各区有自己的保存按钮（U11）',
    st.sections >= 4 && st.secButtons === st.sections, `sections=${st.sections} buttons=${st.secButtons}`)
  check('高级 JSON 默认折叠（details 高度 ≈ summary，内容未被布局）',
    st.advancedOpen === false && st.summaryHeight > 0 && st.detailsHeight <= st.summaryHeight + 6,
    `open=${st.advancedOpen} details高=${st.detailsHeight}px summary高=${st.summaryHeight}px`)
  check('干净状态下不显示脏提示', st.dirtyHidden === true, `dirtyHidden=${st.dirtyHidden}`)
  await page.click('#settings-advanced summary')
  await page.waitForTimeout(200)
  const adv2 = await page.evaluate(() => {
    const d = document.getElementById('settings-advanced')
    return { open: d.hasAttribute('open'), value: (document.getElementById('settings').value || '').length }
  })
  check('点开折叠能编辑整份 JSON（有内容、可见）', adv2.open === true && adv2.value > 40, `value ${adv2.value} 字`)
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  // U12：频道表控件（加/启停/删）
  await page.click('#tabs button[data-tab="chat"]')  // 【U14】来源页解散，聊天自成页
  await page.waitForTimeout(700)
  const ch = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#chat table tbody tr')]
    const form = { id: document.getElementById('ch-id'), dir: document.getElementById('ch-dir') }
    return {
      header: [...document.querySelectorAll('#chat table th')].map(n => n.textContent.trim()),
      rowButtons: rows[0] ? [...rows[0].querySelectorAll('button')].map(b => b.textContent.trim()) : [],
      hasForm: form.id !== null && form.dir !== null,
      noJsonHint: (document.getElementById('chat')?.textContent || '').includes('sources.chat.channels'),
    }
  })
  // 表单必须始终在（那才是 U12 关掉"只能改 JSON"这条债的东西）；操作列只在**真的有频道**时才断言——
  // 本部署当前一个频道都没配，表压根不渲染，此时断言表头是断言一个不存在的东西。
  check('聊天一节始终带加频道表单（U12）', ch.hasForm === true, `hasForm=${ch.hasForm}`)
  if (ch.header.length > 0) {
    check('频道表有「操作」列且每行至少两个按钮（启停/删除）',
      ch.header.includes('操作') && ch.rowButtons.length >= 2,
      `header=${ch.header.join('|')} rowBtns=${ch.rowButtons.join('/')}`)
  } else {
    console.log('  – 频道表操作列（U12）：跳过 —— 本部署没有配置任何频道，表未渲染（表单那一条已断言）')
  }
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  // U13：派活页的模式开关（一次性派 / 定时派）
  await page.click('#tabs button[data-tab="new"]')
  await page.waitForTimeout(400)
  const dm = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#dispatch-mode .chip-btn')]
    return {
      labels: chips.map(c => c.textContent.trim()),
      pressed: chips.map(c => c.getAttribute('aria-pressed')),
      onceVisible: getComputedStyle(document.getElementById('dispatch-once')).display !== 'none',
      timedHidden: getComputedStyle(document.getElementById('dispatch-timed')).display === 'none',
    }
  })
  check('派活页默认「一次性派」，两块内容互斥（U13）',
    dm.labels.join('|') === '一次性派|定时派' && dm.pressed.join(',') === 'true,false' && dm.onceVisible && dm.timedHidden,
    `${dm.labels.join('|')} pressed=${dm.pressed.join(',')} once=${dm.onceVisible} timedHidden=${dm.timedHidden}`)
  await page.click('#dispatch-mode button[data-mode="timed"]')
  await page.waitForTimeout(600)
  const dm2 = await page.evaluate(() => ({
    timedVisible: getComputedStyle(document.getElementById('dispatch-timed')).display !== 'none',
    onceHidden: getComputedStyle(document.getElementById('dispatch-once')).display === 'none',
    listRows: document.querySelectorAll('#schedules li').length,
  }))
  check('切到「定时派」后显示排期列表且一次性表单收起',
    dm2.timedVisible && dm2.onceHidden, `timed=${dm2.timedVisible} onceHidden=${dm2.onceHidden} rows=${dm2.listRows}`)
  await page.click('#dispatch-mode button[data-mode="once"]')
  await page.waitForTimeout(300)

  // U14：来源页解散后，五个分区各归其位
  const u14 = await page.evaluate(() => {
    const has = (sel, text) => { const el = document.querySelector(sel); return el !== null && (el.textContent || '').includes(text) }
    return {
      navLabels: [...document.querySelectorAll('#tabs button')].map(b => {
        const c = b.cloneNode(true); c.querySelectorAll('.badge').forEach(x => x.remove()); return c.textContent.trim()
      }),
      overviewHasSources: has('#ov-sources', '') || document.querySelectorAll('#ov-sources table tbody tr').length > 0,
      overviewCardTitle: has('#tab-overview', '活从哪来'),
      decisionsHasLost: has('#tab-decisions', '丢失的请求') && has('#tab-decisions', '判定'),
      drawerHasHealth: document.getElementById('health-detail') !== null && document.getElementById('effects') !== null,
      chatPageHasChat: has('#tab-chat', '身份映射') || document.getElementById('chat') !== null,
    }
  })
  check('导航不再有「来源」，改为「聊天」（U14）',
    !u14.navLabels.includes('来源') && u14.navLabels.includes('聊天'), u14.navLabels.join('|'))
  check('来源状态表搬到总览的「活从哪来」', u14.overviewCardTitle && u14.overviewHasSources,
    `card=${u14.overviewCardTitle} rows=${u14.overviewHasSources}`)
  check('丢失的请求与判定同住记录页', u14.decisionsHasLost, `=${u14.decisionsHasLost}`)
  check('健康与队列的容器在抽屉里（id 沿用）', u14.drawerHasHealth, `=${u14.drawerHasHealth}`)
  check('聊天自成页且带身份映射', u14.chatPageHasChat, `=${u14.chatPageHasChat}`)

  // U15：技术细节里的「来源 Trigger」→ 记录页只看那一条
  await page.click('#tabs button[data-tab="tickets"]')
  await page.click('#filter button[data-filter="all"]')  // U7 起 filter 是 chips，不是 select
  await page.waitForTimeout(500)
  const anyRow2 = await page.$('#tickets li:not(.group-head)')  // 【U22】排除分段标题
  if (anyRow2) { await anyRow2.click(); await page.waitForTimeout(700) }
  // 这个按钮住在**默认折叠**的技术细节里，所以要先展开——Playwright 拒绝点不可见元素是对的：
  // 真人也得先展开才点得到。检查照用户的动作走，而不是绕过它。
  const techFold = await page.$('#detail details.tech')
  if (techFold) { await page.click('#detail details.tech summary'); await page.waitForTimeout(250) }
  // U16 之后折叠区里有两个 linklike（授权的发起者、来源 Trigger），所以沿 dt 找到 Trigger 自己那格——
  // 与 jsdom 侧同一个歧义，那边修了这边忘了：选择器"取第一个"是这类错误的共同根源。
  const trigHandle = await page.evaluateHandle(() => {
    const term = [...document.querySelectorAll('#detail details.tech dt')].find(d => d.textContent === '来源 Trigger')
    return term ? term.nextElementSibling?.querySelector('button.linklike') ?? null : null
  })
  const trig = trigHandle.asElement()
  if (trig) {
    const trigId = await page.evaluate(h => h.textContent.trim(), trig)
    await trig.click()
    await page.waitForTimeout(700)
    const filtered = await page.evaluate(() => ({
      hash: location.hash,
      onDecisions: getComputedStyle(document.getElementById('tab-decisions')).display !== 'none',
      text: (document.getElementById('decisions')?.textContent || '').slice(0, 60),
      hasClear: [...document.querySelectorAll('#decisions button')].some(b => b.textContent.trim() === '看全部'),
    }))
    check('「来源 Trigger」点一下落到过滤后的记录页（U15）',
      filtered.onDecisions && filtered.hash === `#trigger=${trigId}` && filtered.hasClear,
      `hash=${filtered.hash} 说明=${filtered.text.slice(0, 34)}`)
  } else {
    console.log('  – 来源 Trigger 深链（U15）：跳过 —— 该任务没有来源 Trigger')
  }

  // U16：事件日志里的 Session id 可复制（有事件才断言；没有就如实跳过）
  const ev = await page.evaluate(() => {
    const box = document.getElementById('d-events')
    if (!box) return null
    const text = box.textContent || ''
    const hasId = /myagent-[a-z0-9-]+|[0-9a-f]{32}/.test(text)
    return { hasId, buttons: box.querySelectorAll('button.linklike').length, empty: text.trim().length === 0 }
  })
  if (ev !== null && ev.hasId) {
    check('事件日志里的 id 是可点复制的按钮（U16）', ev.buttons > 0, `buttons=${ev.buttons}`)
  } else {
    console.log('  – 事件日志 id 复制（U16）：跳过 —— 该任务没有含 id 的事件')
  }

  // U17：线上界面上不该再出现英文枚举词（这是操作者说"不明确"的直接来源）
  const enums = ['pending', 'running', 'waiting', 'failed', 'blocked', 'done', 'dropped', 'stopped',
    'accept', 'ignore', 'observe', 'unavailable']
  const seen = []
  for (const t of ['overview', 'tickets', 'decisions']) {
    await page.click(`#tabs button[data-tab="${t}"]`)
    await page.waitForTimeout(600)
    if (t === 'tickets') { await page.click('#filter button[data-filter="all"]'); await page.waitForTimeout(500) }
    // **只查当前可见面板内的元素**：隐藏面板仍留在 DOM 里，查整个 document 会把同一批元素
    // 在三个页面上各报一次，命中无法归因（第一版正是这样，报了三份一模一样的 accept）。
    const hits = await page.evaluate(([list, tab]) => {
      const root = document.getElementById('tab-' + tab)
      if (!root) return ['<没有这个面板>']
      return [...root.querySelectorAll('.stage')]
        .filter(n => n.offsetParent !== null || getComputedStyle(n).display !== 'none')
        .map(n => n.textContent.trim()).filter(x => list.includes(x))
    }, [enums, t])
    if (hits.length > 0) seen.push(`${t}: ${hits.join(',')}`)
  }
  check('阶段与判定胶囊上不再出现英文枚举词（U17）', seen.length === 0, seen.join(' | ') || 'clean')
  // 顶栏胶囊同样中文化，且英文原值留在 title 上（排障时与日志对得上）
  const hdr = await page.evaluate(() => ({
    mode: document.getElementById('mode')?.textContent.trim(),
    counts: document.getElementById('counts')?.textContent.trim(),
    title: document.querySelector('#mode b')?.getAttribute('title'),
  }))
  check('顶栏两颗胶囊是中文，且 acceptMode 原值在 title 上',
    /受理模式：(通过即执行|只记录不执行)/.test(hdr.mode || '') && (hdr.counts || '').startsWith('任务')
    && /^acceptMode=(auto|observe)$/.test(hdr.title || ''),
    `mode=${hdr.mode} counts=${(hdr.counts || '').slice(0, 24)} title=${hdr.title}`)
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  // U18：把"动作前有多少字说明"这个量具本身做成回归守卫。
  // 基线（改造前）：动作前最差 407 字（记录页丢失一节），可见说明总量最大 771 字（聊天页）。
  // 改造后实测：27 与 136。阈值放宽到 60 / 260，留出正常文案增长的空间，但一整墙解释塞回来就会红。
  const prose = await page.evaluate(async () => {
    const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      return r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }
    const isTarget = el => el.matches('button, input, select, textarea, table, ul.list, .chip, .stage, [role="status"]')
    const out = []
    for (const tab of ['overview', 'tickets', 'works', 'new', 'decisions', 'chat', 'settings']) {
      document.querySelector(`#tabs button[data-tab="${tab}"]`).click()
      await new Promise(r => setTimeout(r, 450))
      const root = document.getElementById('tab-' + tab)
      let worst = 0
      for (const card of root.querySelectorAll('section.card')) {
        let proseChars = 0, hit = false
        const walk = node => { for (const el of node.children) {
          if (hit || !visible(el)) continue
          if (el.matches('details:not([open])')) continue
          if (isTarget(el)) { hit = true; continue }
          if (el.matches('p')) proseChars += (el.textContent || '').trim().length
          if (el.matches('h1,h2,h3')) continue
          walk(el) } }
        walk(card)
        worst = Math.max(worst, proseChars)
      }
      let total = 0, folds = 0, openFolds = 0
      for (const para of root.querySelectorAll('p')) {
        if (!visible(para) || para.closest('details:not([open])')) continue
        total += (para.textContent || '').trim().length
      }
      for (const d of root.querySelectorAll('details.why')) { folds += 1; if (d.hasAttribute('open')) openFolds += 1 }
      out.push({ tab, worst, total, folds, openFolds })
    }
    return out
  })
  const worstAll = Math.max(...prose.map(x => x.worst))
  const totalAll = Math.max(...prose.map(x => x.total))
  check('每页动作前的说明字数都小（U18；改造前最差 407 字）', worstAll <= 60,
    `最差 ${worstAll} 字 · ` + prose.map(x => `${x.tab}:${x.worst}`).join(' '))
  check('每页可见说明总量都小（U18；改造前聊天页 771 字）', totalAll <= 260,
    `最大 ${totalAll} 字 · ` + prose.map(x => `${x.tab}:${x.total}`).join(' '))
  check('解释都收在折叠里且默认收起', prose.every(x => x.openFolds === 0) && prose.some(x => x.folds > 0),
    prose.map(x => `${x.tab}:${x.folds}折/${x.openFolds}开`).join(' '))
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  // U19：三步引导（**只读**——绝不点「启用」，那会改线上设置）
  await page.click('#tabs button[data-tab="chat"]')
  await page.waitForTimeout(700)
  const guide = await page.evaluate(() => {
    const steps = [...document.querySelectorAll('#chat-steps li')]
    const first = document.getElementById('chat')?.children[0]
    return {
      count: steps.length,
      labels: steps.map(li => (li.querySelector('.what b')?.textContent || '').trim()),
      now: steps.filter(li => li.classList.contains('now')).length,
      done: steps.filter(li => li.classList.contains('done')).length,
      nowHasAction: steps.some(li => li.classList.contains('now') && li.querySelector('button') !== null),
      laterHasNoAction: steps.filter(li => li.classList.contains('later')).every(li => li.querySelector('button') === null),
      firstIsSteps: first?.id === 'chat-steps',
      marks: [...document.querySelectorAll('#chat-steps .mark')].map(m => m.textContent.trim()),
    }
  })
  check('聊天页首元素是三步引导，不是段落（U19）', guide.firstIsSteps === true, `first=${guide.firstIsSteps}`)
  check('三步引导画出真实顺序（启用→加频道→映射身份）',
    guide.count === 3 && guide.labels.join('|') === '启用这条来源|加一个频道|把发消息的人映射成发起者',
    `${guide.count} 步：${guide.labels.join(' → ')}`)
  check('当前步恰好一个、且带就地动作；未轮到的步骤不给动作',
    guide.now <= 1 && (guide.now === 0 || guide.nowHasAction) && guide.laterHasNoAction,
    `now=${guide.now} done=${guide.done} 当前步有动作=${guide.nowHasAction} 后续无动作=${guide.laterHasNoAction}`)
  check('做完的步骤标记是 ✓ 而不是数字',
    guide.marks.every((m, i) => i < guide.done ? m === '✓' : m === String(i + 1)),
    `marks=${guide.marks.join(',')}`)
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  // U20：工作页表单收进「新建」动作 + 只有一项时默认选中
  await page.click('#tabs button[data-tab="works"]')
  await page.waitForTimeout(800)
  const w20 = await page.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return el ? getComputedStyle(el).display !== 'none' : null }
    const rows = document.querySelectorAll('#works li').length
    return {
      pjForm: vis('pj-form'), wkForm: vis('wk-form'),
      toggles: [...document.querySelectorAll('button')].filter(b => /新建(项目|工作)/.test(b.textContent.trim())).map(b => b.textContent.trim()),
      detail: (document.getElementById('work-detail')?.textContent || '').trim().slice(0, 24),
      rows,
    }
  })
  check('两个新建表单默认收起（U20）', w20.pjForm === false && w20.wkForm === false,
    `pj=${w20.pjForm} wk=${w20.wkForm}`)
  check('唤出按钮各一个、且页面上没有重名的提交按钮', w20.toggles.join('|') === '新建项目|新建工作', w20.toggles.join('|'))
  check('只有一条工作时进页就选中它（详情不是那句空提示）',
    w20.rows === 1 ? !w20.detail.startsWith('选择左边') : true, `rows=${w20.rows} detail=${w20.detail}`)
  await page.click('#pj-toggle')
  await page.waitForTimeout(300)
  const opened = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById('pj-form')).display !== 'none',
    focused: document.activeElement?.id,
  }))
  check('点「新建项目」展开表单且焦点落进名字字段', opened.visible && opened.focused === 'pj-name',
    `visible=${opened.visible} focused=${opened.focused}`)
  await page.click('#pj-cancel')
  await page.waitForTimeout(250)

  // U22：「全部」分两段 + 已结束行带结局原因 + 摘要可展开
  await page.click('#tabs button[data-tab="tickets"]')
  await page.waitForTimeout(500)
  await page.click('#filter button[data-filter="all"]')
  await page.waitForTimeout(700)
  const g = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#tickets li.group-head')].map(li => li.textContent.trim())
    const rows = [...document.querySelectorAll('#tickets li:not(.group-head)')]
    const nums = heads.map(h => Number((h.match(/（(\d+)）/) || [])[1] ?? -1))
    return {
      heads, rows: rows.length, sum: nums.reduce((a, b) => a + b, 0),
      reasonRows: rows.filter(r => (r.textContent || '').includes('结局原因')).length,
      // 带原因的行里，原因那个 span 的 title 必须就是整句原文（列表上会截断，title 不截）
      reasonTitled: rows.filter(r => [...r.querySelectorAll('.meta span[title]')]
        .some(sp => (sp.textContent || '').startsWith('结局原因：')
          && sp.getAttribute('title') === sp.textContent.replace(/^结局原因：/, ''))).length,
      endedRows: rows.filter(r => (r.textContent || '').includes('结束于')).length,
      expandBtns: [...document.querySelectorAll('#tickets button.linklike')].filter(b => b.textContent.trim() === '展开').length,
      headsClickable: [...document.querySelectorAll('#tickets li.group-head')].every(li => li.getAttribute('aria-current') === null),
      tallRow: Math.max(...rows.map(r => Math.round(r.getBoundingClientRect().height))),
    }
  })
  // 分几段取决于数据：空的那一段不画（线上这批 12 条**全部已结束**，于是只有"已结束（12）"一段）。
  // 断言的是**规则**——每段标题的计数之和等于行数、且标题只可能是这两种——不是"必须有两段"。
  check('「全部」按结束与否分段，段标题计数之和等于行数（U22）',
    g.heads.length >= 1 && g.heads.length <= 2 && g.sum === g.rows
    && g.heads.every(h => /^(进行中|已结束)（\d+）$/.test(h)),
    `${g.heads.join(' | ')} 行=${g.rows}`)
  check('已结束的行都说"结束于 …"', g.endedRows > 0, `结束于=${g.endedRows} / 行=${g.rows}`)
  if (g.reasonRows > 0) {
    check('带结局原因的行，整句原文都在 title 上（截断也不丢）', g.reasonTitled === g.reasonRows,
      `有原因=${g.reasonRows} 其中 title 齐备=${g.reasonTitled}`)
  } else {
    console.log('  – 结局原因 title（U22）：跳过 —— 本部署这批已结束的任务都没有 endedReason')
  }
  check('分段标题不是一条任务（没有 aria-current，点它不该打开详情）', g.headsClickable === true, `=${g.headsClickable}`)
  // 摘要截断：**只读**断言。
  // 曾经写过点击式探测（展开→量高→收回），它量到了很有说服力的数字（「信息比对」117px → 1125px），
  // 但会让 Chrome 在后面第 4 节的重型任务整页截图之后崩掉；停用该块则 71 条全过、加上它就必崩（可复现两次）。
  // 加过"探测后整页重载"归零状态也没用，所以判定是资源型不稳定而非状态泄漏——**不与它纠缠**：
  // 断言改成不点击、不改任何状态，量"可见摘要被截断成一句（≤60 字）且给了展开按钮"。
  const trunc = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tickets li:not(.group-head)')]
    const withBtn = rows.filter(li => [...li.querySelectorAll('button.linklike')].some(b => b.textContent.trim() === '展开'))
    if (withBtn.length === 0) return null
    const lens = withBtn.map(li => {
      const span = [...li.querySelectorAll('.row span.muted')].find(x => (x.textContent || '').trim().length > 0)
      return (span?.textContent || '').trim().length
    })
    return { rows: withBtn.length, max: Math.max(...lens), min: Math.min(...lens) }
  })
  if (trunc !== null) {
    check('长摘要被截断成一句（≤60 字）并给了「展开」（U22）', trunc.max <= 61,
      `${trunc.rows} 行有展开按钮，可见摘要 ${trunc.min}–${trunc.max} 字`)
  } else {
    console.log('  – 摘要截断（U22）：跳过 —— 这批任务的摘要都不够长，没有「展开」按钮')
  }

  // U23：记录页分区 + 判定筛选 + 徽标不再重复 id（全部只读）
  await page.click('#tabs button[data-tab="decisions"]')
  await page.waitForTimeout(800)
  const rec = await page.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return el ? getComputedStyle(el).display !== 'none' : null }
    const chips = [...document.querySelectorAll('#records-nav .chip-btn')]
    const filt = [...document.querySelectorAll('#decision-filter .chip-btn')]
    const dupIds = [...document.querySelectorAll('[id]')].map(e => e.id)
      .filter((id, i, a) => a.indexOf(id) !== i)
    const rows = [...document.querySelectorAll('#decisions li')]
    return {
      navLabels: chips.map(c => c.textContent.trim()),
      navPressed: chips.map(c => c.getAttribute('aria-pressed')),
      cardsVisible: [vis('card-decisions'), vis('card-lost')],
      filterLabels: filt.map(c => c.textContent.trim()),
      rows: rows.length,
      // 「我看过了」必须带后果说明，否则它就是一个不知道点了会怎样的按钮
      dismissTitles: [...document.querySelectorAll('#decisions button')]
        .filter(b => b.textContent.trim() === '我看过了').map(b => (b.getAttribute('title') || '').length),
      dupIds: [...new Set(dupIds)],
      badgeChat: document.getElementById('badge-chat') !== null,
      badgeDec: document.getElementById('badge-decisions') !== null,
    }
  })
  check('记录页有分区导航，且一次只显示一张卡（U23）',
    rec.navLabels.length === 2 && rec.cardsVisible.filter(Boolean).length === 1,
    `${rec.navLabels.join('|')} pressed=${rec.navPressed.join(',')} 卡可见=${rec.cardsVisible.join(',')}`)
  check('判定有结局筛选且计数写在标签上',
    rec.filterLabels.length === 3 && rec.filterLabels.every(l => /（\d+）$/.test(l)),
    rec.filterLabels.join(' | '))
  check('页面里没有重复的元素 id（U14 遗留的 badge-sources 重复已修）',
    rec.dupIds.length === 0, rec.dupIds.join(',') || 'none')
  check('两颗徽标各归其主：聊天等待在聊天、丢失在记录', rec.badgeChat && rec.badgeDec,
    `badge-chat=${rec.badgeChat} badge-decisions=${rec.badgeDec}`)
  if (rec.dismissTitles.length > 0) {
    check('「我看过了」按钮带后果说明（title 非空）',
      rec.dismissTitles.every(len => len > 10), `${rec.dismissTitles.length} 个按钮，title 长度 ${rec.dismissTitles.join(',')}`)
  } else {
    console.log('  – 「我看过了」title（U23）：跳过 —— 这批判定里没有需要收起的拒绝')
  }
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  // U24：分段控件 + 当前档说明 + 范围 placeholder 是默认值原文（与 policy.ts 逐字比对）
  await page.click('#tabs button[data-tab="new"]')
  await page.waitForTimeout(500)
  const seg = await page.evaluate(() => {
    const box = document.getElementById('dispatch-mode')
    const btns = [...box.querySelectorAll('.chip-btn')]
    const bg = b => getComputedStyle(b).backgroundColor
    return {
      cls: box.className,
      labels: btns.map(b => b.textContent.trim()),
      pressed: btns.map(b => b.getAttribute('aria-pressed')),
      bgs: btns.map(bg),
      hint: (document.getElementById('dispatch-mode-hint')?.textContent || '').trim(),
      nScope: document.getElementById('n-scope')?.getAttribute('placeholder') || '',
      wkScope: document.getElementById('wk-scope')?.getAttribute('placeholder') || '',
      idLabel: (document.querySelector('label[for="s-id"]')?.textContent || '').trim(),
    }
  })
  check('模式开关是分段控件：选中档与未选中档底色不同（U24）',
    seg.cls.includes('seg') && seg.bgs[0] !== seg.bgs[1] && seg.pressed.join(',') === 'true,false',
    `${seg.cls} ${seg.labels.join('|')} 底色=${seg.bgs.join(' vs ')} pressed=${seg.pressed.join(',')}`)
  check('当前档有一句说明，且与档位对得上',
    seg.hint.length > 8 && seg.hint.includes('现在派一张'), `hint=${seg.hint.slice(0, 40)}`)
  // 线上 placeholder 必须与 policy.ts 的 DEFAULT_SCOPE 逐字一致：常量改了而面板没跟，这里就红。
  const defScope = await (async () => {
    const src = await (await import('node:fs/promises')).readFile('src/core/policy.ts', 'utf8')
    const m = /const DEFAULT_SCOPE = '((?:[^'\\]|\\.)*)'/.exec(src)
    return m ? m[1].replace(/\\'/g, "'") : null
  })()
  check('范围 placeholder 是默认值原文，与 policy.ts 的 DEFAULT_SCOPE 逐字一致',
    defScope !== null && seg.nScope === defScope && seg.wkScope === defScope,
    defScope === null ? 'policy.ts 里找不到 DEFAULT_SCOPE'
      : `n-scope=${seg.nScope === defScope} wk-scope=${seg.wkScope === defScope} 原文前 40 字=${defScope.slice(0, 40)}`)
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  // U21：归档与删除的按钮与两步确认（删除第一步**不发任何请求**——面板侧已断言——所以点它再取消是只读安全的）
  await page.click('#tabs button[data-tab="works"]')
  await page.waitForTimeout(800)
  const lifecycle = await page.evaluate(() => {
    const detail = document.getElementById('work-detail')
    const btns = [...(detail?.querySelectorAll('button') ?? [])].map(b => b.textContent.trim())
    return { btns, hasDetail: detail !== null }
  })
  check('工作详情带「归档」与「删除」按钮（U21）',
    lifecycle.btns.includes('归档') && lifecycle.btns.includes('删除'),
    lifecycle.btns.join(' | '))
  if (lifecycle.btns.includes('删除')) {
    await page.evaluate(() => {
      const detail = document.getElementById('work-detail')
      const btn = [...detail.querySelectorAll('button')].find(b => b.textContent.trim() === '删除')
      if (btn) btn.click()
    })
    await page.waitForTimeout(700)
    const confirmState = await page.evaluate(() => {
      const detail = document.getElementById('work-detail')
      const text = detail?.textContent || ''
      const btns = [...(detail?.querySelectorAll('button') ?? [])].map(b => b.textContent.trim())
      // 断言用**全文**，只在失败信息里截断：确认行在详情的末尾（任务列表之后），
      // 第一版把 slice(0,300) 的结果同时拿去断言，于是量到的是"开头那 300 字里没有确认行"——量具自己错了。
      return { text, head: text.slice(0, 120), tail: text.slice(-180), btns }
    })
    check('删除是两步确认，且后果带数字并说明不可撤销',
      // 断**规则**不断数据形状：名下有东西时说"N 张任务/条工作会失去这个归属"，没有时说"它名下没有东西"。
      // 线上这个工作恰好 0 张任务，第一版只认前一种，就红了（与 U12 频道表、U22 分组同一课）。
      /确认删除？/.test(confirmState.text)
        && (/\d+ (张任务|条工作)会失去这个归属/.test(confirmState.text) || /它名下没有东西/.test(confirmState.text))
        && /不可撤销/.test(confirmState.text)
        && confirmState.btns.includes('确认删除') && confirmState.btns.includes('取消'),
      `尾部=${confirmState.tail} 按钮=${confirmState.btns.join('/')}`)
    // 立刻取消，不留在确认态。
    await page.evaluate(() => {
      const detail = document.getElementById('work-detail')
      const btn = [...detail.querySelectorAll('button')].find(b => b.textContent.trim() === '取消')
      if (btn) btn.click()
    })
    await page.waitForTimeout(600)
  }
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  // 每加一批检查，崩溃点就往前提一次（§4.107 记的是第 4/5 节，U21 的块加进来后变成了第 2 节）。
  // 与其每次崩了再往前挪一次 relaunch，不如把它放在**每个大节之前**：换浏览器进程是真的把内存还回去，
  // 而换页面不是（实测过）。代价是几次导航，收益是脚本不再随机死。
  await relaunch()
  // N5：平台接入页与每频道健康（只读）。**断规则不断数据**：宿主可能还跑着没有 channels() 的旧 bundle，
  // 那时健康列显示"—"是正确的；把它断成数字就会因为部署新旧而红。
  await page.click('#tabs button[data-tab="chat"]')
  await page.waitForTimeout(900)
  const onboarding = await page.evaluate(() => {
    const pick = [...document.querySelectorAll('#platform-pick .chip-btn')]
    const head = [...document.querySelectorAll('#chat table thead th')].map(th => th.textContent.trim())
    const firstRow = [...(document.querySelectorAll('#chat table tbody tr')[0]?.querySelectorAll('td') ?? [])]
      .map(td => td.textContent.trim())
    return {
      platforms: pick.map(b => b.textContent.trim()),
      pressed: pick.map(b => b.getAttribute('aria-pressed')),
      head, firstRow,
      guide: (document.getElementById('platform-guide')?.textContent || '').length,
    }
  })
  check('平台目录列出能做的、没做的与不能做的（N5）',
    onboarding.platforms.some(p => p.includes('Telegram')) && onboarding.platforms.some(p => p.includes('飞书'))
      && onboarding.platforms.some(p => p.includes('（未做）')) && onboarding.platforms.some(p => p.includes('（无官方路径）')),
    onboarding.platforms.join(' | '))
  check('默认选中一个平台并给出了引导正文',
    onboarding.pressed.filter(v => v === 'true').length === 1 && onboarding.guide > 200,
    `pressed=${onboarding.pressed.join(',')} 引导 ${onboarding.guide} 字`)
  // 断规则不断数据的形状（这条纪律本仓已错过四次）：这个部署可能一个频道都没配，表就不渲染，
  // 表头自然为空——那不是缺陷，是"没有可断言的对象"。U12 的频道表检查就是这么写的，照它办。
  if (onboarding.head.length > 0) {
    check('频道表带三个健康列（积压/待取回信/最近进气）',
      ['积压', '待取回信', '最近进气'].every(col => onboarding.head.includes(col)),
      onboarding.head.join('|'))
  } else {
    console.log('  – 健康列（N5）：跳过 —— 本部署没有配置任何频道，表未渲染')
  }
  if (onboarding.firstRow.length > 0) {
    // 每一列要么是数字/相对时间，要么是"—"；空字符串意味着渲染漏了一格。
    check('健康列不留空格子（缺席画"—"，不画成空白）',
      onboarding.firstRow.slice(3, 6).every(cell => cell.length > 0),
      onboarding.firstRow.slice(3, 6).join('|'))
  } else {
    console.log('  – 健康列取值（N5）：跳过 —— 这个部署还没有配置任何频道')
  }
  // 凭据不许出现在页面上：生成的单元只引用 env 文件。
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#platform-guide button')].find(b => b.textContent.trim() === 'systemd')
    if (btn) btn.click()
  })
  await page.waitForTimeout(600)
  const unitText = await page.evaluate(() => document.getElementById('platform-guide')?.textContent || '')
  check('生成的守护单元引用 env 文件，且不含带值的凭据',
    unitText.includes('EnvironmentFile=') && !/(TOKEN|SECRET|PASSWORD)\s*=\s*["']?[A-Za-z0-9_-]{8,}/.test(unitText),
    `EnvironmentFile=${unitText.includes('EnvironmentFile=')} 命中带值凭据=${/(TOKEN|SECRET|PASSWORD)\s*=\s*["']?[A-Za-z0-9_-]{8,}/.test(unitText)}`)
  await page.click('#tabs button[data-tab="overview"]')
  await page.waitForTimeout(300)

  console.log('── 2. 遍历 8 个 Tab 验证显隐互斥')
  // 【U13】排期并入派活：一级面板 9 → 8（'schedules' 不再是独立面板）
  // 【U14】'sources' → 'chat'：来源页解散，一级面板仍是 8 个
  const allTabs = ['overview', 'tickets', 'works', 'new', 'decisions', 'chat', 'settings', 'prompts']
  for (const t of allTabs) {
    await page.click(`#tabs button[data-tab="${t}"]`)
    await page.waitForTimeout(250)
    const vis = await page.evaluate(( list) => {
      return Object.fromEntries(list.map(name => [
        name,
        getComputedStyle(document.getElementById(`tab-${name}`)).display,
      ]))
    }, allTabs)
    const activeVisible = vis[t] !== 'none'
    const othersHidden = allTabs.filter(x => x !== t).every(x => vis[x] === 'none')
    check(`Tab [${t}] 激活且其余 ${allTabs.length - 1} 个隐藏`, activeVisible && othersHidden, `active=${vis[t]}`)
    if (t === 'settings' || t === 'chat' || t === 'works') {
      await page.screenshot({ path: `${SHOT_DIR}/panel-after-${t}.png`, fullPage: true })
    }
  }

  console.log('── 3. 设置页可视化快捷助手检验')
  await page.click('#tabs button[data-tab="settings"]')
  await page.waitForTimeout(250)
  const quickExists = await page.evaluate(() => {
    const box = document.getElementById('settings-quick')
    return box !== null && getComputedStyle(box).display !== 'none'
  })
  check('设置页可视化快捷栏 #settings-quick 渲染可见', quickExists)

  await relaunch()
  console.log('── 4. 打开 547 文件 / 76 产物的重型 Ticket (19dd5c9c) 检验盒模型高度有界性')
  // 【实测教训，勿再加回】这里曾经加过一次 `page.goto(BASE, { waitUntil: 'networkidle' })` 想"让渲染器从干净状态开始"，
  // 结果**必崩**（Target page closed）。原因不是内存：面板每 5 秒轮询一次，`networkidle` 在这种页面上
  // 永远等不到空闲，goto 与轮询互相拖着，最后把 Chrome 弄死。二分定位过程：停用 U23 块→仍崩；去掉重载→72 条全过。
  // 要在活跃轮询的页面上重新导航，用 `waitUntil: 'domcontentloaded'` 或干脆 `page.reload()`，别用 networkidle。
  await page.click('#tabs button[data-tab="tickets"]')
  await page.click('#filter button[data-filter="all"]')  // 【U7】下拉改 chips
  await page.waitForTimeout(500)
  const clicked19 = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#tickets li:not(.group-head)')]  // 【U22】排除分段标题
    const target = items.find(li => li.textContent.includes('信息比对')) || items[0]
    if (target) { target.click(); return true }
    return false
  })
  await page.waitForTimeout(700)
  const boxMetrics = await page.evaluate(() => {
    const h = sel => {
      const el = document.querySelector(sel)
      return el ? Math.round(el.getBoundingClientRect().height) : -1
    }
    return {
      docHeight: document.documentElement.scrollHeight,
      detailHeight: h('#detail'),
      filesListHeight: h('#d-files .filelist'),
      artifactsHeight: h('#d-artifacts'),
    }
  })
  check('已打开重型 Ticket 详情', clicked19)
  check('#d-files .filelist 高度受控 (<= 400px，修复前 16947px)', boxMetrics.filesListHeight > 0 && boxMetrics.filesListHeight <= 400, `${boxMetrics.filesListHeight}px`)
  check('#d-artifacts 高度受控 (<= 400px，修复前 13510px)', boxMetrics.artifactsHeight > 0 && boxMetrics.artifactsHeight <= 400, `${boxMetrics.artifactsHeight}px`)
  check('整页 scrollHeight 受控 (<= 3600px，修复前 37112px)', boxMetrics.docHeight <= 3600, `${boxMetrics.docHeight}px`)
  // 这张原先是 fullPage。盒模型断言在它之前就跑完了，它只是给人看的留档；
  // 而 3385px 高的整页位图正是把 headless Chrome 顶崩的那一步（实测偶发 `Target … has been closed`）。
  // 降为视口截图：断言一条没少，脚本不再随机死在半路。
  await page.screenshot({ path: `${SHOT_DIR}/panel-after-tickets-all.png` })

  await relaunch()
  console.log('── 5. 跨 Ticket 引用回溯 (F6) 与深链路由 (#ticket= / #work=)')
  await page.goto(`${BASE}#ticket=b356ac649bc46a144c38f9b4b6619175`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  const f6Info = await page.evaluate(() => {
    const el = document.getElementById('d-mentions')
    return el ? { text: el.textContent, visible: getComputedStyle(el).display !== 'none' } : null
  })
  check('深链 #ticket=b356ac64 打开对应 Ticket 并渲染 F6 跨 Ticket 引用提示 (#d-mentions)',
    f6Info !== null && f6Info.visible && f6Info.text.includes('信息比对'),
    f6Info ? f6Info.text.slice(0, 60) : 'missing')
  await page.screenshot({ path: `${SHOT_DIR}/panel-after-f6-mentions.png`, fullPage: true })

  // Test #work=<id> deep link if any work exists
  // 原先这是在 `page.evaluate` 里发的 fetch。第 5 节一直是全脚本最脆弱的一步（此前偶发
  // `Target page … has been closed` 就崩在这附近），而"取一个 work id"根本不需要浏览器参与——
  // 改成 Node 侧发请求，把一次浏览器内存操作从脆弱点上拿掉。
  const workId = await (async () => {
    try {
      const res = await fetch(`${BASE}api/works`, { headers: { 'x-myagent-request': '1' } })
      const body = await res.json()
      return body.works?.[0]?.id ?? null
    } catch { return null }
  })()
  if (workId) {
    await page.goto(`${BASE}#work=${workId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const workTabState = await page.evaluate(() => ({
      worksDisplay: getComputedStyle(document.getElementById('tab-works')).display,
      detailText: document.getElementById('work-detail')?.textContent || '',
    }))
    check(`深链 #work=${workId.slice(0, 8)} 自动切换到「工作」页并加载详情`,
      workTabState.worksDisplay !== 'none' && workTabState.detailText.includes(workId),
      `display=${workTabState.worksDisplay}`)
  }

  check('全程 0 页面未捕获异常 (pageerror)', pageErrors.length === 0, `errors=${pageErrors.length}`)
  check('全程 0 条控制台错误 (console.error)', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ') || 'clean')
  check('全程 0 条失败请求 (>=4xx)', badResponses.length === 0, badResponses.slice(0, 2).join(' | ') || 'clean')
} finally {
  await browser.close()
}

console.log(`\n── 结论：通过 ${passed} 条，失败 ${failed} 条`)
process.exit(failed === 0 ? 0 : 1)
