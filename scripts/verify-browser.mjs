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

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors = []
  const consoleErrors = []
  const badResponses = []
  page.on('pageerror', err => pageErrors.push(String(err)))
  // `pageerror` alone is not "no errors": a failed HTTP request and a console.error are both real failures the
  // operator would see in devtools, and neither throws. An audit found exactly that gap — one 404 per page load
  // (the browser's automatic favicon probe) had been invisible to this script since it was written.
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 120)) })
  page.on('response', res => { if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`) })
  page.on('requestfailed', req => badResponses.push(`FAILED ${req.url()}`))

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
  const anyRow = await page.$('#tickets li')
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
    const cells = [...document.querySelectorAll('#tickets li .meta span')].filter(n => n.getAttribute('title'))
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
  const row0 = await page.$('#tickets li')
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
  const anyRow2 = await page.$('#tickets li')
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

  console.log('── 4. 打开 547 文件 / 76 产物的重型 Ticket (19dd5c9c) 检验盒模型高度有界性')
  await page.click('#tabs button[data-tab="tickets"]')
  await page.click('#filter button[data-filter="all"]')  // 【U7】下拉改 chips
  await page.waitForTimeout(500)
  const clicked19 = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#tickets li')]
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
  await page.screenshot({ path: `${SHOT_DIR}/panel-after-tickets-all.png`, fullPage: true })

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
  const workId = await page.evaluate(async () => {
    const res = await fetch('/myagent/api/works', { headers: { 'x-myagent-request': '1' } })
    const body = await res.json()
    return body.works?.[0]?.id || null
  })
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
