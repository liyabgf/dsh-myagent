/**
 * The Client half of myagent: one click in the DSH shell that opens the myagent panel.
 *
 * Why this exists: the panel is a subpath of this same origin (`/myagent/`), and nothing in the shell ever said so —
 * an operator sitting in the DSH Web GUI had no visible way in. The shell provides the seat (`sidebar.footer.action`,
 * beside Settings, root-scoped, always rendered), so the whole feature is an anchor: no fetch, no state, nothing to
 * fail, and middle-click / cmd-click behave like any link.
 *
 * Visible text goes through the Client locale service; the two dictionaries are registered here and taken back on
 * dispose, so disabling the plugin leaves no words behind.
 */
window.__ModuleLoader__.load({
  id: 'myagent',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const offDicts = [
          ctx.locale.register('myagent', 'zh', {
            entry: 'myagent 面板',
            hint: '监工与查账的地方；下任务与收结果都在聊天室里完成，平时不需要打开',
          }),
          ctx.locale.register('myagent', 'en', {
            entry: 'myagent panel',
            hint: 'Where you supervise and audit. Tasks and results live in your chat room; you do not need this day to day.',
          }),
        ]
        const t = ctx.locale.bind('myagent')

        function PanelEntry() {
          const [, tick] = React.useReducer(count => count + 1, 0)
          React.useEffect(() => ctx.locale.subscribe(tick), [])
          return h('a', {
            href: '/myagent/',
            target: '_blank',
            rel: 'noopener noreferrer',
            title: t('hint'),
            style: {
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              color: 'inherit', textDecoration: 'none', font: 'inherit', opacity: 0.85,
            },
          },
          h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true' },
            h('rect', { x: '1.5', y: '2.5', width: '13', height: '11', rx: '2', fill: 'none', stroke: 'currentColor' }),
            h('path', { d: 'M1.5 6h13', stroke: 'currentColor', fill: 'none' })),
          h('span', null, t('entry')))
        }

        const offSlot = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'myagent-panel-entry',
          order: 10,
          label: () => t('entry'),
        }, PanelEntry))
        return () => { offSlot(); for (const off of offDicts) off() }
      },
    }
  },
})
