/**
 * What the panel's 「更新」 page says: the release history, one line per version.
 *
 * 【操作者决定】这个页从「说明」改成「更新内容」：说明页不该存在（README 对评估者说话，说明页曾对
 * 站在面板前的操作者说话——两份文本两个读者，但操作者自己说它不该在这儿），版本更新内容才是
 * 面板最后一个页签该放的：装了什么、改了什么，站在这里的人一眼看完。
 *
 * The list comes from `CHANGELOG.md` — appended by `scripts/release.sh` at every release, so this view
 * and the package the operator installed cannot drift apart: the file ships with the bundle. One source
 * (the release pipeline), one renderer (this view); neither hand-writes versions.
 */
import { readFileSync } from 'node:fs'
import { packageFile } from './prompts.ts'

/** One release as the 「更新」 page shows it. */
export interface ChangeEntry {
  readonly version: string
  readonly date: string
  readonly text: string
}

/** Parse `- **0.14.1**（2026-11-10）：text` lines; anything else in the file is header, not data. */
export function changesView(): { changes: readonly ChangeEntry[] } {
  let markdown: string
  try {
    markdown = readFileSync(packageFile('CHANGELOG.md'), 'utf8')
  } catch {
    // A package without its changelog is a packaging bug, not an empty history: the page says so rather than
    // rendering a quiet blank that reads as "nothing ever shipped".
    return { changes: [] }
  }
  const changes: ChangeEntry[] = []
  for (const match of markdown.matchAll(/^- \*\*(\d+\.\d+\.\d+)\*\*（(\d{4}-\d{2}-\d{2})）：(.+)$/gm)) {
    changes.push({ version: match[1]!, date: match[2]!, text: match[3]!.trim() })
  }
  return { changes }
}
