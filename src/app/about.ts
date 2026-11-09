/**
 * What the panel's 「说明」 page says. The server is the single owner of this text (A-1).
 *
 * The page exists because 0.10.4 put a one-click entry in the DSH sidebar: a new user lands in the panel and the first
 * question they have is "what is this thing" — and until this page the answer was a table of live data. The wording
 * here is deliberately a different text from the README rather than a copy of it: the README speaks to whoever is
 * evaluating or installing the bundle; this speaks to the operator standing in the panel with their own running
 * system in front of them. One audience per text is not two owners of one fact.
 *
 * The renderer copies these sentences verbatim, so this view is the only writer — `tests/panel.spec.ts` pins the
 * sections and `tests/http.spec.ts` pins the route, and neither rewrites the sentences.
 */

/** One section of the 「说明」 page: a heading and the sentences under it. */
export interface AboutSection {
  readonly heading: string
  readonly lines: readonly string[]
}

export function aboutView(): { sections: readonly AboutSection[] } {
  return {
    sections: [
      {
        heading: '这是什么',
        lines: [
          '一个给一个人用的任务系统。你从聊天、排期或这个面板交代一件事；它过一道门禁，建一张 Ticket，派一个无人值守的 worker 去做；产物登记在案，报告送回你说话的地方。',
          '它跑在 DSH（你正在用的这个宿主）里，活和数据都在你自己的机器上。',
        ],
      },
      {
        heading: '为谁',
        lines: ['一台机器，一个人。没有多用户、没有租户、没有团队权限——这些复杂度它刻意不要。'],
      },
      {
        heading: '它做什么',
        lines: [
          '收活：聊天、排期、收件箱目录、会话、规则，五个来源进同一道门禁。',
          '看守：每张任务有范围、预算与看门狗；worker 的轮次死于上游错误或宿主重载时，系统自动接回继续。',
          '沉淀：worker 交出的产物登记进目录，别的任务能复用；跑通的脚本能沉淀成手艺。',
          '回报：报告落 RESULT.md、送聊天、报主会话；只有你能拍板的事停在总览的「需要你决断的事」。',
        ],
      },
      {
        heading: '它刻意不做什么',
        lines: [
          '没有沙箱执行：worker 在你的宿主上跑（研究型预设的排期连 shell 都没有，但普通 worker 有）。',
          '没有模型评审：产物好坏由你抽查，系统只保证记录诚实、可追溯。',
          '不替你决定：值得你拍板的事会停进队列等你，而不是系统自作主张。',
        ],
      },
      {
        heading: '方向',
        lines: [
          '聊天优先：每加一个功能先问能不能在聊天里完成，面板是看见的地方，不是干活的地方。',
          '减少人的负担：需要你的只问一次，能自己爬起来的不叫你。',
          '诚实优先：读不到就说读不到，宁缺一个数字也不画一个假的。',
        ],
      },
      {
        heading: '想再深入读什么',
        lines: [
          '这个面板：总览是"现在有什么需要我"；任务/工作两页看历史；聊天页管频道；提示词页管角色与手艺。',
          '仓库（github.com/liyabgf/dsh-myagent）：README 讲安装与配置，SECURITY.md 讲安全边界与已知历史残留，docs/v2 是全部工程记录。',
        ],
      },
    ],
  }
}
