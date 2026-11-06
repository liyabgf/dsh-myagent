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

  console.log('── 2. 遍历 8 个 Tab 验证显隐互斥')
  const allTabs = ['tickets', 'works', 'new', 'decisions', 'sources', 'schedules', 'settings', 'prompts']
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
    check(`Tab [${t}] 激活且其余 7 个隐藏`, activeVisible && othersHidden, `active=${vis[t]}`)
    if (t === 'settings' || t === 'sources' || t === 'works') {
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
  await page.selectOption('#filter', 'all')
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
