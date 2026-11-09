/**
 * The platform bridges, tested against the file contract rather than against a platform.
 *
 * A bridge cannot be tested against Telegram or Lark here — that needs credentials and a live account, which is why
 * every platform keeps an operator-acceptance step. What CAN be tested offline is everything that can be wrong
 * without a network: the bytes a bridge writes, whether the real chat Source accepts them, whether a re-delivered
 * event stays one message, and whether a reply is sent exactly once.
 *
 * The end-to-end half (bridge writes → the REAL `ChatSource` reads → a Trigger appears) lives in
 * `tests/chat.spec.ts`, next to the harness that builds a Source; the tests here cover the kit and the mapping.
 */
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
// @ts-expect-error -- the bridges are dependency-free `.mjs` so an operator can run them with no build step; they
// carry no type declarations, and duplicating their shapes in a `.d.ts` would be a second copy able to drift.
import { parse, scalar, stringify } from '../bridges/lib/frontmatter.mjs'
// @ts-expect-error -- see above
import { messageFileName, writeMessage } from '../bridges/lib/inbound.mjs'
// @ts-expect-error -- see above
import { chunkText, drainOut } from '../bridges/lib/outbound.mjs'
// @ts-expect-error -- 同上
import { formatRoute, parseRoute } from '../bridges/lib/route.mjs'
// @ts-expect-error -- see above
import { supervise } from '../bridges/lib/run.mjs'
// @ts-expect-error -- see above
import { cleanText, mapUpdate, mentionsBot } from '../bridges/telegram/transform.mjs'
// @ts-expect-error -- see above
import { cleanText as ddCleanText, mapEvent as ddMapEvent, replyWindowOpen } from '../bridges/dingtalk/transform.mjs'
// @ts-expect-error -- see above
import { contentText, mapEvent, mentionInfo, stripMentions } from '../bridges/lark/transform.mjs'
// @ts-expect-error -- see above
import { describeError } from '../bridges/lib/log.mjs'
import { readFileSync as read } from 'node:fs'

const directories: string[] = []
const directory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'myagent-bridge-'))
  directories.push(path)
  return path
}
afterAll(async () => { await Promise.all(directories.map(path => rm(path, { recursive: true, force: true }))) })

const ME = { id: 77, username: 'myagent_bot', first_name: 'myagent' }

/** 桥从 `out/` 读到的东西——`.mjs` 没有类型声明，所以在这里写清它的形状。 */
type Reply = { thread?: string; text: string; name: string }

describe('the message file the bridge writes', () => {
  it('writes the exact front matter the Source parses, with the body as the request text', () => {
    expect(stringify({ from: 'U01', id: '5-12', thread: '9', title: '周报群' }, 'Sort out this week.')).toBe(
      '---\nfrom: U01\nid: 5-12\nthread: 9\ntitle: 周报群\n---\nSort out this week.\n')
  })

  it('omits absent fields instead of writing empty ones — an empty `from` would read as "asserts no identity"', () => {
    const text: string = stringify({ from: 'U01', id: '', thread: undefined, title: null }, 'hi')
    expect(text).toBe('---\nfrom: U01\n---\nhi\n')
  })

  it('sanitizes rather than escapes, because the Source strips quotes but does NOT unescape backslashes', () => {
    // A newline would split the value across two head lines and the tail would be dropped by the parser.
    expect(scalar('line one\nline two')).toBe('line one line two')
    // The parser strips ONE leading and ONE trailing quote, so a value that already has them is wrapped in the
    // other kind and survives intact.
    expect(parse(`---\ntitle: ${scalar('"周报"')}\n---\nx`).fields.title).toBe('"周报"')
    expect(parse(`---\ntitle: ${scalar("it's here")}\n---\nx`).fields.title).toBe("it's here")
    // A value carrying BOTH quote kinds cannot be wrapped losslessly; losing a quote is cosmetic, splitting a field is not.
    expect(parse(`---\ntitle: ${scalar(`say "hi" it's fine`)}\n---\nx`).fields.title).not.toContain('\n')
  })

  it('survives a value that looks like front matter syntax — a colon, a hash, a fence', () => {
    const text = stringify({ from: 'U01', title: 're: #3 --- 紧急' }, 'body: with a colon')
    const back = parse(text)
    expect(back.fields.from).toBe('U01')
    expect(back.fields.title).toBe('re: #3 --- 紧急')
    expect(back.body).toBe('body: with a colon')
  })

  it('reads back what it wrote, field for field', () => {
    const fields = { from: 'U01ABCDEF', id: '998877-12', thread: 't-9', title: 'weekly alerts' }
    expect(parse(stringify(fields, 'Sort out this week\u2019s alerts.')).fields).toEqual(fields)
  })
})

describe('writing a message into a channel directory', () => {
  it('names the file after the message identity alone, so a re-delivery is the same bytes and not a second message', async () => {
    const dir = await directory()
    const message = { directory: dir, from: 'U01', id: '5-12', thread: '9', title: '周报群', body: '整理周报' }
    const first = await writeMessage(message)
    const second = await writeMessage({ ...message, body: '整理周报' })
    expect(first).toBe(second)
    expect(messageFileName('5-12')).toBe('msg-5-12.md')
    // One file, not two: the S31 lesson, on the bridge side this time.
    expect((await readdir(dir)).filter(name => name.endsWith('.md'))).toEqual(['msg-5-12.md'])
  })

  it('never leaves a temporary that the Source could read as a message', async () => {
    const dir = await directory()
    await writeMessage({ directory: dir, from: 'U01', id: '5-13', body: 'x' })
    const names = await readdir(dir)
    // The Source skips dotfiles and non-`.md` names; the temporary is both, and it is renamed away in any case.
    expect(names.filter(name => name.startsWith('.tmp-'))).toEqual([])
    expect(names).toEqual(['msg-5-13.md'])
  })

  it('makes a file name that is safe on a filesystem and can never start with a dot', () => {
    // 斜杠先被换成短横、再剥掉前导点，所以开头是两个短横：路径分隔符没了，`.` 也当不了首字符。
    expect(messageFileName('../../etc/passwd')).toBe('msg--..-etc-passwd.md')
    expect(messageFileName('.hidden')).toBe('msg-hidden.md')
    expect(messageFileName('')).toBe('msg-unnamed.md')
  })
})

describe('consuming the replies myagent owes back', () => {
  const dropReply = async (dir: string, name: string, text: string): Promise<void> => {
    await mkdir(join(dir, 'out'), { recursive: true })
    await writeFile(join(dir, 'out', name), text, 'utf8')
  }

  it('hands the thread and the text to the sender, and only then moves the file out of the way', async () => {
    const dir = await directory()
    await dropReply(dir, 'reply-aaa.md', '---\nthread: 9\n---\n已经查完了。')
    const sent: Reply[] = []
    const tally = await drainOut({ directory: dir, send: async (reply: Reply) => { sent.push(reply) } })
    expect(sent).toEqual([{ thread: '9', text: '已经查完了。', name: 'reply-aaa.md' }])
    expect(tally).toMatchObject({ sent: 1, failed: 0 })
    expect(await readdir(join(dir, 'out'))).toEqual(['sent'])
    expect(await readdir(join(dir, 'out', 'sent'))).toEqual(['reply-aaa.md'])
  })

  it('leaves the file in place when sending fails, so the next drain tries again — at-least-once, never at-most-once', async () => {
    const dir = await directory()
    await dropReply(dir, 'reply-bbb.md', 'still here')
    const first = await drainOut({ directory: dir, send: async () => { throw new Error('rate limited') } })
    expect(first).toMatchObject({ sent: 0, failed: 1 })
    expect(await readdir(join(dir, 'out'))).toContain('reply-bbb.md')
    // And the retry succeeds, sending the same text once.
    const sent: string[] = []
    const second = await drainOut({ directory: dir, send: async (reply: Reply) => { sent.push(reply.text) } })
    expect(second).toMatchObject({ sent: 1, failed: 0 })
    expect(sent).toEqual(['still here'])
  })

  it('does not post the same reply twice when myagent retries a delivery it already made', async () => {
    const dir = await directory()
    await dropReply(dir, 'reply-ccc.md', 'done')
    const sent: string[] = []
    await drainOut({ directory: dir, send: async (reply: Reply) => { sent.push(reply.text) } })
    // myagent's retry writes the same bytes under the same name; the bridge has already delivered it.
    await dropReply(dir, 'reply-ccc.md', 'done')
    const tally = await drainOut({ directory: dir, send: async (reply: Reply) => { sent.push(reply.text) } })
    expect(sent).toEqual(['done'])
    expect(tally.skipped).toBe(1)
  })

  it('reads a reply with no front matter as having no thread, which is what deliver writes when there is none', async () => {
    const dir = await directory()
    await dropReply(dir, 'reply-ddd.md', 'plain answer')
    const sent: Reply[] = []
    await drainOut({ directory: dir, send: async (reply: Reply) => { sent.push(reply) } })
    expect(sent).toEqual([{ thread: undefined, text: 'plain answer', name: 'reply-ddd.md' }])
  })

  it('treats a missing out/ as "nothing owed yet", not as an error', async () => {
    const dir = await directory()
    const tally = await drainOut({ directory: dir, send: async () => { throw new Error('must not be called') } })
    expect(tally).toEqual({ sent: 0, failed: 0, skipped: 0 })
  })

  it('ignores subdirectories and dotfiles, so its own bookkeeping is never sent to a chat room', async () => {
    const dir = await directory()
    await dropReply(dir, 'reply-eee.md', 'real')
    await mkdir(join(dir, 'out', 'sent'), { recursive: true })
    await writeFile(join(dir, 'out', '.tmp-nope'), 'temporary', 'utf8')
    await writeFile(join(dir, 'out', 'notes.txt'), 'not a reply', 'utf8')
    const sent: string[] = []
    await drainOut({ directory: dir, send: async (reply: Reply) => { sent.push(reply.text) } })
    expect(sent).toEqual(['real'])
  })
})

describe('a reply too long for the door it was sent through', () => {
  /**
   * Telegram refuses anything over 4096 UTF-16 code units. Because a reply file is archived only AFTER the platform
   * accepts it, a reply that can never be accepted is retried forever — and myagent's own `send` effect already
   * succeeded when it wrote the file, so the panel says "delivered" while the room says nothing. That is the third
   * shape of the silence this system exists to prevent, and a research report is exactly the answer that hits it.
   */
  /** The pieces with their markers taken off, as an array: how they are rejoined depends on how they were cut. */
  const bodies = (pieces: string[]): string[] => pieces.map(piece => piece.replace(/^【\d+\/\d+】 /, ''))
  /** Split on line boundaries, so the newlines that were separators come back as separators. */
  const strip = (pieces: string[]): string => bodies(pieces).join('\n')

  it('leaves a reply that fits completely alone — no marker, no split, byte-identical', () => {
    expect(chunkText('已经查完了。', 4096)).toEqual(['已经查完了。'])
    expect(chunkText('x'.repeat(4096), 4096)).toHaveLength(1)
    // And a platform that passes no limit keeps today's behaviour, which is the right default for one whose limit
    // has not been verified: guessing would split replies for no reason.
    expect(chunkText('x'.repeat(9000), 0)).toHaveLength(1)
  })

  it('splits on line boundaries, stays inside the limit, and gives the payload back losslessly', () => {
    const text = Array.from({ length: 400 }, (_, i) => `第 ${i} 行：中国 AI 产业资本网络的一条事实。`).join('\n')
    const pieces = chunkText(text, 200)
    expect(pieces.length).toBeGreaterThan(1)
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(200)
    // Every piece says where it sits, so five messages arriving in a row read as one answer rather than noise.
    expect(pieces[0]!.startsWith('【1/')).toBe(true)
    expect(pieces.at(-1)!.startsWith(`【${pieces.length}/${pieces.length}】 `)).toBe(true)
    // The property that matters: nothing was lost, reordered or paraphrased on the way through.
    expect(strip(pieces)).toBe(text)
  })

  it('hard-cuts one over-long line, and never through a surrogate pair', () => {
    const text = `${'研'.repeat(500)}\n${'😀'.repeat(300)}`
    const pieces = chunkText(text, 120)
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(120)
      // A piece that starts or ends on half a pair would render as a replacement character: the emoji was written
      // whole, so it must arrive whole.
      const body = piece.replace(/^【\d+\/\d+】 /, '')
      expect(body.charCodeAt(0) >= 0xdc00 && body.charCodeAt(0) <= 0xdfff, '一片不能以低代理项开头').toBe(false)
      const last = body.charCodeAt(body.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff, '一片不能以高代理项结尾').toBe(false)
    }
    // A WEAKER invariant than the line-packed case above, and the difference is worth stating rather than hiding:
    // packing on line boundaries is lossless (`join('\n')` puts the text back exactly), but a hard cut has to place a
    // message boundary in the middle of a line, and there is no way to tell the reader "these two messages were one
    // line". So what is guaranteed here is that no character was lost, added or reordered — not that the newlines are
    // where they were.
    expect(bodies(pieces).join('').replace(/\n/g, '')).toBe(text.replace(/\n/g, ''))
  })

  it('sends the pieces in order and archives only after the last one was accepted', async () => {
    const dir = await directory()
    await mkdir(join(dir, 'out'), { recursive: true })
    const text = Array.from({ length: 60 }, (_, i) => `行 ${i}：一条需要送回去的事实。`).join('\n')
    await writeFile(join(dir, 'out', 'reply-long.md'), `---\nthread: 9\n---\n${text}`, 'utf8')
    const sent: string[] = []
    const tally = await drainOut({
      directory: dir, limit: 120,
      send: async (reply: { text: string }) => { sent.push(reply.text) },
    })
    expect(tally).toMatchObject({ sent: 1, failed: 0 })
    expect(sent.length).toBeGreaterThan(1)
    expect(strip(sent)).toBe(text)
    expect(await readdir(join(dir, 'out'))).toEqual(['sent'])
    expect(await readdir(join(dir, 'out', 'sent'))).toEqual(['reply-long.md'])
  })

  /**
   * The reason a resume marker exists: without it, a failure on piece three of five re-posts pieces one and two to the
   * room on the next drain — the operator's colleagues would read the same half-answer twice, and the second copy
   * looks like a correction rather than a retry.
   */
  it('resumes from the piece that failed instead of posting the first half of an answer twice', async () => {
    const dir = await directory()
    await mkdir(join(dir, 'out'), { recursive: true })
    const text = Array.from({ length: 60 }, (_, i) => `行 ${i}：一条需要送回去的事实。`).join('\n')
    await writeFile(join(dir, 'out', 'reply-part.md'), text, 'utf8')

    const seen: string[] = []
    let attempts = 0
    const first = await drainOut({
      directory: dir, limit: 120,
      send: async (reply: { text: string }) => {
        attempts += 1
        seen.push(reply.text)
        if (attempts === 2) throw new Error('message is too long')
      },
    })
    expect(first).toMatchObject({ sent: 0, failed: 1 })
    expect(await readdir(join(dir, 'out'))).toContain('reply-part.md')
    const pieces = chunkText(text, 120)
    expect(seen).toHaveLength(2)
    // Where it got to is recorded, and it is not a reply file (dot-prefixed, so the drain never reads it as one).
    expect(await readFile(join(dir, 'out', '.reply-part.md.progress'), 'utf8')).toBe('1')

    const second: string[] = []
    const retry = await drainOut({ directory: dir, limit: 120, send: async (reply: { text: string }) => { second.push(reply.text) } })
    expect(retry).toMatchObject({ sent: 1, failed: 0 })
    // Resumed at piece 2 — piece 1 was NOT sent again.
    expect(second).toEqual(pieces.slice(1))
    expect([...seen, ...second]).toHaveLength(pieces.length + 1)
    // The marker is cleaned up once the whole answer is out.
    expect(await readdir(join(dir, 'out'))).toEqual(['sent'])
  })
})

describe('outbound file attachments and message receipts in drainOut (Pkg 2)', () => {
  it('delivers verified files via sendFile, records messageId -> ticketId via onSent, and skips symlinked files', async () => {
    const dir = await directory()
    await mkdir(join(dir, 'out'), { recursive: true })
    const realFile = join(dir, 'report.csv')
    await writeFile(realFile, 'a,b\n1,2\n', 'utf8')
    const symFile = join(dir, 'sym.csv')
    const { symlink } = await import('node:fs/promises')
    await symlink(realFile, symFile)

    await writeFile(
      join(dir, 'out', 'reply-with-files.md'),
      `---\nthread: group:-100200\nticket: ticket-888\nfiles: ${realFile}, ${symFile}\n---\n报告正文`,
      'utf8',
    )
    const sentFiles: string[] = []
    const receipts: { messageId: string; ticketId: string; thread?: string }[] = []
    const tally = await drainOut({
      directory: dir,
      send: async () => ({ messageId: '-100200-99' }),
      sendFile: async ({ filePath }: { filePath: string }) => { sentFiles.push(filePath) },
      onSent: async (r: { messageId: string; ticketId: string; thread?: string }) => { receipts.push(r) },
    })
    expect(tally).toMatchObject({ sent: 1, failed: 0 })
    expect(sentFiles).toEqual([realFile])
    expect(receipts).toEqual([{ messageId: '-100200-99', ticketId: 'ticket-888', thread: 'group:-100200' }])
  })
})

describe('the Telegram mapping', () => {
  const groupMessage = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    message_id: 12, from: { id: 555, first_name: '李', last_name: '杨' },
    chat: { id: -100200, type: 'supergroup', title: '周报群' }, text: '整理周报', ...over,
  })

  it('identifies a message by chat AND message id, because message_id alone repeats across chats', () => {
    const a = mapUpdate({ message: groupMessage() }, ME, { mode: 'all' })
    const b = mapUpdate({ message: groupMessage({ chat: { id: -999, type: 'supergroup', title: '别的群' } }) }, ME, { mode: 'all' })
    expect(a.message.id).toBe('-100200-12')
    expect(b.message.id).toBe('-999-12')
    expect(a.message.id).not.toBe(b.message.id)
  })

  it('takes the platform user id as the identity to be mapped, and never invents one', () => {
    expect(mapUpdate({ message: groupMessage() }, ME, { mode: 'all' }).message.from).toBe('555')
    // No `from` means no person: a channel broadcast. Holding it would leave a file nobody can ever map.
    const anonymous = mapUpdate({ message: groupMessage({ from: undefined }) }, ME, { mode: 'all' })
    expect(anonymous.skip).toBe('no-sender')
  })

  it('recognizes an @mention from entities, not from a substring, and strips the handle from the request', () => {
    const text = '@myagent_bot 整理周报'
    const update = { message: groupMessage({ text, entities: [{ offset: 0, length: 12, type: 'mention' }] }) }
    expect(mentionsBot(update.message, ME)).toBe(true)
    expect(mapUpdate(update, ME).message.body).toBe('整理周报')
    // A plain occurrence of the name in prose is not an address to the bot.
    expect(mentionsBot(groupMessage({ text: 'someone mentioned myagent_bot once' }), ME)).toBe(false)
  })

  it('recognizes /command@bot as addressed to this bot, and not /command for another', () => {
    const mine = groupMessage({ text: '/start@myagent_bot', entities: [{ offset: 0, length: 18, type: 'bot_command' }] })
    const theirs = groupMessage({ text: '/start@other_bot', entities: [{ offset: 0, length: 16, type: 'bot_command' }] })
    expect(mentionsBot(mine, ME)).toBe(true)
    expect(mentionsBot(theirs, ME)).toBe(false)
    expect(cleanText(mine, ME)).toBe('')
  })

  it('applies the mode: mentions forwards DMs and addressed group messages, dm only DMs, all everything', () => {
    const dm = { message: groupMessage({ chat: { id: 555, type: 'private' }, text: '私下问一句' }) }
    const quiet = { message: groupMessage({ text: '群里闲聊' }) }
    expect(mapUpdate(dm, ME, { mode: 'mentions' }).message).toBeDefined()
    expect(mapUpdate(quiet, ME, { mode: 'mentions' }).skip).toBe('not-mentioned')
    expect(mapUpdate(dm, ME, { mode: 'dm' }).message).toBeDefined()
    expect(mapUpdate(quiet, ME, { mode: 'dm' }).skip).toBe('not-a-dm')
    expect(mapUpdate(quiet, ME, { mode: 'all' }).message).toBeDefined()
  })

  it('always encodes a canonical conversation route into thread (dm / group / topic), eliminating defaultChat misrouting', () => {
    // 【产品变更】旧断言：expect(mapped.message.thread).toBe('9')
    // 改动理由：原先普通群聊与私聊的 thread 均为 undefined，导致出站依赖 .bridge-state.json 的 defaultChat，
    // 一旦操作者在私聊发过消息，所有群聊任务的通知都会串进私聊。现在统一编码为 dm:<chatId> / group:<chatId> / topic:<chatId>:<threadId>。
    const topic = mapUpdate({ message: groupMessage({ message_thread_id: 9 }) }, ME, { mode: 'all' })
    expect(topic.message.thread).toBe('topic:-100200:9')
    expect(parseRoute(topic.message.thread)).toEqual({ kind: 'topic', chatId: '-100200', threadId: '9' })

    const group = mapUpdate({ message: groupMessage() }, ME, { mode: 'all' })
    expect(group.message.thread).toBe('group:-100200')
    expect(parseRoute(group.message.thread, { defaultChat: '<telegram-user-id>' })).toEqual({ kind: 'group', chatId: '-100200' })
    expect(parseRoute('group:-999888', { defaultChat: '<telegram-user-id>' })?.chatId).toBe('-999888')

    const dm = mapUpdate({ message: groupMessage({ chat: { id: 555, type: 'private' } }) }, ME)
    expect(dm.message.thread).toBe('dm:555')
    expect(parseRoute(dm.message.thread)).toEqual({ kind: 'dm', chatId: '555' })

    // Legacy bare thread id fallback remains supported
    expect(parseRoute('9', { replyRoutes: { '9': '-100200' } })).toEqual({ kind: 'legacy', chatId: '-100200', threadId: '9' })
  })

  it('labels Telegram anonymous group admins (1087968824 / GroupAnonymousBot) with author_signature or group title, never literal "Group"', () => {
    const anon = groupMessage({
      from: { id: 1087968824, first_name: 'Group', username: 'GroupAnonymousBot' },
      sender_chat: { id: -100200, title: '回收站', type: 'supergroup' },
      text: '研究中国 AI 产业资本结构',
    })
    const mapped = mapUpdate({ message: anon }, ME, { mode: 'all' })
    expect(mapped.message.title).toBe('回收站（匿名管理员）：研究中国 AI 产业资本结构')
    expect(mapped.message.title.startsWith('Group：')).toBe(false)

    const signed = mapUpdate({ message: { ...anon, author_signature: '架构师' } }, ME, { mode: 'all' })
    expect(signed.message.title).toBe('架构师：研究中国 AI 产业资本结构')
  })

  it('titles a message with the sender and a summary of the request, never the group name', () => {
    // 【产品变更】旧断言：
    //   expect(mapUpdate({ message: groupMessage() }, ME, { mode: 'all' }).message.title).toBe('周报群')
    //   expect(dm.message.title).toBe('李 杨')
    // 改动理由：操作者明确要求「任务名不应该是群名，而是发起者+任务内容的简要」。
    // 用群名当标题会让同一个群里的所有任务都叫「回收站」/「周报群」，不仅任务列表里分不清是谁要做什么，
    // 还会让 executor 按 slug(title) 建出来的工作目录全都叫 `回收站-<id>`。
    expect(mapUpdate({ message: groupMessage() }, ME, { mode: 'all' }).message.title).toBe('李 杨：整理周报')
    const dm = mapUpdate({ message: groupMessage({ chat: { id: 555, type: 'private' } }) }, ME)  // 私聊不受 mentions 限制
    expect(dm.message.title).toBe('李 杨：整理周报')
    // 多行且带 Markdown 标题的请求，跳过空行与 `#` 前缀取第一行有效内容，超长截断加省略号。
    const longBody = `# 标题行\n\n${'做一次完整的自主研究任务'.repeat(6)}`
    const longMapped = mapUpdate({ message: groupMessage({ text: longBody }) }, ME, { mode: 'all' })
    expect(longMapped.message.title.startsWith('李 杨：标题行')).toBe(true)
    const overline = mapUpdate({ message: groupMessage({ text: '研'.repeat(80) }) }, ME, { mode: 'all' })
    expect(overline.message.title).toBe(`李 杨：${'研'.repeat(48)}…`)
  })

  it('honours a chat allow list and skips the bot’s own messages', () => {
    expect(mapUpdate({ message: groupMessage() }, ME, { mode: 'all', chatAllowList: ['-1'] }).skip).toBe('chat-not-allowed')
    expect(mapUpdate({ message: groupMessage({ from: { id: 77, first_name: 'myagent' } }) }, ME, { mode: 'all' }).skip).toBe('own-message')
  })

  it('skips a message with nothing to ask — a sticker, or a mention with no words after it', () => {
    expect(mapUpdate({ message: groupMessage({ text: undefined, sticker: {} }) }, ME, { mode: 'all' }).skip).toBe('no-text')
    const only = { message: groupMessage({ text: '@myagent_bot', entities: [{ offset: 0, length: 12, type: 'mention' }] }) }
    expect(mapUpdate(only, ME).skip).toBe('no-text')
  })
})

/**
 * The Lark/Feishu mapping. Event shapes are the ones the official SDK's normalizer reads
 * (`larksuite/node-sdk`, `channel/normalize/index.ts`): `content` is a JSON STRING, mentions arrive as `@_user_N`
 * placeholders plus a `mentions` array, and there are three different sender ids.
 */
describe('the Lark mapping', () => {
  const BOT = { botOpenId: 'ou_bot' }
  // 测与 @ 无关的行为时要用 all：**未 @ 的群消息在解析正文之前就被过滤掉**（这是有意的——闲聊不该白花一次解析），
  // 所以默认的 mentions 模式下这些用例根本走不到被断言的那一步（第一版就是这么红了 4 条）。
  const ALL = { botOpenId: 'ou_bot', mode: 'all' as const }
  const textEvent = (over: Record<string, unknown> = {}, sender: Record<string, unknown> = { open_id: 'ou_alice' }) => ({
    sender: { sender_id: sender },
    message: {
      message_id: 'om_abc123', chat_id: 'oc_room', chat_type: 'group', message_type: 'text',
      content: JSON.stringify({ text: '整理本周的周报' }), create_time: '1776838695000', ...over,
    },
  })

  it('parses content as a JSON string — the single most common way a Lark bridge produces empty requests', () => {
    expect(contentText('text', JSON.stringify({ text: '你好' }))).toBe('你好')
    // An object instead of a string is what a bridge that guessed the shape would pass in.
    expect(contentText('text', { text: '你好' } as unknown as string)).toBe('')
  })

  it('flattens a rich-text post into title plus lines, because a request may arrive as a post', () => {
    const post = JSON.stringify({
      title: '本周告警',
      content: [[{ tag: 'text', text: '第一条 ' }, { tag: 'at', user_id: 'ou_x' }], [{ tag: 'a', text: '看这个链接' }]],
    })
    expect(contentText('post', post)).toBe('本周告警\n第一条 \n看这个链接')
  })

  it('takes the sender open_id and keeps taking it — three ids for one person must not become three identities', () => {
    expect(mapEvent(textEvent(), ALL).message.from).toBe('ou_alice')
    // open_id wins even when the other two are present, so the mapping key never changes shape mid-life.
    const all = mapEvent(textEvent({}, { open_id: 'ou_alice', union_id: 'on_alice', user_id: 'u_alice' }), ALL)
    expect(all.message.from).toBe('ou_alice')
    // And when there is no open_id at all, the fallback is deterministic rather than whichever key arrived first.
    expect(mapEvent(textEvent({}, { user_id: 'u_bob' }), ALL).message.from).toBe('u_bob')
    expect(mapEvent(textEvent({}, {}), ALL).skip).toBe('no-sender')
  })

  it('uses root_id as the topic thread and encodes canonical group/dm/topic routes', () => {
    // 【产品变更】旧断言：
    //   expect(mapEvent(textEvent({ root_id: 'om_root', parent_id: 'om_parent', thread_id: 'omt_1' }), ALL).message.thread).toBe('om_root')
    //   expect(mapEvent(textEvent({ thread_id: 'omt_1', parent_id: 'om_parent' }), ALL).message.thread).toBe('omt_1')
    //   expect(mapEvent(textEvent({ parent_id: 'om_parent' }), ALL).message.thread).toBeUndefined()
    // 改动理由：统一会话路由接口（bridges/lib/route.mjs），任何入站消息都携带自包含的会话坐标，消灭无 thread 时的跨群串线。
    expect(mapEvent(textEvent({ root_id: 'om_root', parent_id: 'om_parent', thread_id: 'omt_1' }), ALL).message.thread).toBe('topic:oc_room:om_root')
    expect(mapEvent(textEvent({ thread_id: 'omt_1', parent_id: 'om_parent' }), ALL).message.thread).toBe('topic:oc_room:omt_1')
    expect(mapEvent(textEvent({ parent_id: 'om_parent' }), ALL).message.thread).toBe('group:oc_room')
  })

  it('detects a mention of THIS bot from the mentions array, and strips the placeholder from the request', () => {
    const event = textEvent({
      content: JSON.stringify({ text: '@_user_1 整理本周的周报' }),
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot', union_id: 'on_bot' }, name: 'myagent' }],
    })
    expect(mentionInfo(event.message, 'ou_bot').mentionedBot).toBe(true)
    expect(mapEvent(event, BOT).message.body).toBe('整理本周的周报')
    // A mention of somebody else is not a request to the bot.
    const other = textEvent({
      content: JSON.stringify({ text: '@_user_1 你看一下' }),
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_carol' }, name: 'Carol' }],
    })
    expect(mapEvent(other, BOT).skip).toBe('not-mentioned')
  })

  it('still sees @all when Feishu omits the mentions array, which the SDK records as frequent', () => {
    const event = textEvent({ content: JSON.stringify({ text: '@_all 今天有人值班吗' }) })
    expect(mentionInfo(event.message, 'ou_bot').mentionAll).toBe(true)
    expect(mapEvent(event, BOT).message.body).toBe('今天有人值班吗')
  })

  it('is permissive when the bot open_id could not be read, and says so rather than filtering silently', () => {
    const event = textEvent({
      content: JSON.stringify({ text: '@_user_1 别人的事' }),
      mentions: [{ key: '@_user_1', id: { open_id: 'ou_carol' } }],
    })
    // No botOpenId: any mention counts. The bridge logs that the filter is loose.
    expect(mapEvent(event, { mode: 'mentions' }).message).toBeDefined()
  })

  it('treats a p2p chat as addressed, and applies the mode filter to groups', () => {
    const dm = textEvent({ chat_type: 'p2p', chat_id: 'ou_alice' })
    expect(mapEvent(dm, BOT).message.isDirect).toBe(true)
    expect(mapEvent(textEvent(), BOT).skip).toBe('not-mentioned')
    expect(mapEvent(textEvent(), { ...BOT, mode: 'all' }).message).toBeDefined()
    expect(mapEvent(dm, { ...BOT, mode: 'dm' }).message).toBeDefined()
    expect(mapEvent(textEvent({ chat_type: 'group' }), { ...BOT, mode: 'dm' }).skip).toBe('not-a-dm')
  })

  it('skips what has no words to act on, and names the type so the operator can tell a sticker from a bug', () => {
    expect(mapEvent(textEvent({ message_type: 'image', content: JSON.stringify({ image_key: 'img_1' }) }), ALL).skip)
      .toBe('no-text:image')
    expect(mapEvent(textEvent({ content: '{not json' }), ALL).skip).toBe('no-text:text')
    expect(mapEvent(textEvent({ content: JSON.stringify({ text: '@_user_1' }), mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' } }] }), ALL).skip)
      .toBe('no-text:text')
  })

  it('identifies a message by its own id, which in Lark is globally unique and needs no chat prefix', () => {
    // Telegram's message_id repeats across chats and had to be prefixed; Lark's `om_...` does not, and prefixing it
    // would make the same message a different identity in two channels for no reason.
    expect(mapEvent(textEvent(), ALL).message.id).toBe('om_abc123')
    expect(mapEvent(textEvent({ chat_id: 'oc_other' }), ALL).message.id).toBe('om_abc123')
  })

  it('honours a chat allow list and skips the bot talking to itself', () => {
    expect(mapEvent(textEvent(), { ...BOT, chatAllowList: ['oc_elsewhere'] }).skip).toBe('chat-not-allowed')
    expect(mapEvent(textEvent({}, { open_id: 'ou_bot' }), { ...BOT, mode: 'all' }).skip).toBe('own-message')
  })

  it('keeps mention placeholders out of the request text in every form', () => {
    expect(stripMentions('@_user_1 @_user_2 看看  @_all')).toBe('看看')
  })
})

describe('the bridge docs cannot drift from the bridge code', () => {
  /**
   * An operator's only source of truth for "what do I set" is the README, and the only source of truth for what is
   * actually read is the code. Those two drift silently, and the failure looks like a broken bridge rather than a
   * stale table: the operator sets a variable that nothing reads, or misses one that is required.
   *
   * So they are compared here, in both directions. This is the third layer of the same idea used elsewhere in this
   * project (the panel placeholder vs `DEFAULT_SCOPE`, the route table vs the walkthrough): when one fact lives in
   * two files, a test has to own the comparison.
   */
  const platforms = ['telegram', 'lark'] as const
  const shared = ['MYAGENT_CHANNEL_DIR', 'MYAGENT_REPLY_KEEP_DAYS', 'BRIDGE_LOG_LEVEL']

  for (const platform of platforms) {
    it(`every variable ${platform} reads is documented, and every documented one is read`, () => {
      const code = read(`bridges/${platform}/bridge.mjs`, 'utf8')
      const doc = read(`bridges/${platform}/README.md`, 'utf8')
      const inCode = new Set([...code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(m => m[1]!))
      // The README has TWO variable tables and the split is the point: one lists what the BRIDGE reads (compared
      // against the code below), the other lists what NODE reads (`NODE_EXTRA_CA_CERTS`, `PATH`) which the bridge's
      // own code never mentions — an operator still has to set them, and the daemon is exactly where they go missing.
      // Comparing the whole document against the code would call that second table a lie, so it is scoped here, and
      // the split itself is asserted: a variable in the wrong table fails.
      const parts = doc.split('### 不是桥读')
      const bridgePart = parts[0] ?? ''
      const nodePart = parts[1] ?? ''
      const inDoc = new Set([...bridgePart.matchAll(/^\| `([A-Z][A-Z0-9_]*)`/gm)].map(m => m[1]!))
      const nodeLevel = [...nodePart.matchAll(/^\| `([A-Z][A-Z0-9_]*)`/gm)].map(m => m[1]!)
      expect(nodeLevel.length, '"node 读的"那张表不见了').toBeGreaterThan(0)
      expect(nodeLevel.filter(name => inCode.has(name)), '这些是桥自己读的，不该在 node 那张表里').toEqual([])
      expect(inCode.size, '桥没有读任何环境变量？').toBeGreaterThan(0)
      // 集合相等是主断言，两条方向性断言只为了让失败信息说清是哪一边漂了。
      // 0.8 强形式量出"文档写了但代码不读"那条是**唯一守卫**（删掉它，多写一个没人读的变量就无人发现），
      // 所以补了这条：它守的是同一个事实的更强形式，删掉任何一条方向性断言它都还在。
      expect([...inDoc].sort(), 'README 的环境变量表与代码读的必须完全一致').toEqual([...inCode].sort())
      expect([...inCode].filter(name => !inDoc.has(name)), '代码读了但文档没写').toEqual([])
      expect([...inDoc].filter(name => !inCode.has(name)), '文档写了但代码不读').toEqual([])
    })

    it(`${platform} documents the variables it shares with the kit, and the required ones as required`, () => {
      const doc = read(`bridges/${platform}/README.md`, 'utf8')
      for (const name of shared) expect(doc, name).toContain(`\`${name}\``)
      // A required variable must be marked as such: an operator who cannot tell which lines to fill in cannot start.
      const required = [...doc.matchAll(/^\| `([A-Z][A-Z0-9_]*)` \| ✅/gm)].map(m => m[1]!)
      expect(required).toContain('MYAGENT_CHANNEL_DIR')
      expect(required.length).toBeGreaterThanOrEqual(2)
    })
  }

  it('the contract README states the numbers an operator will otherwise report as bugs', () => {
    const doc = read('bridges/README.md', 'utf8')
    // Each of these is a real constant in the code; documenting them is what turns "it did nothing for a second"
    // from a bug report into a known behaviour.
    expect(doc).toContain('512 KiB')          // MAX_BYTES
    expect(doc).toContain('SETTLE_MS')        // the one-second window
    expect(doc).toContain('reply_unroutable') // an address was written and nothing is there to receive it
    expect(doc).toContain('7 天')             // MYAGENT_REPLY_KEEP_DAYS default
    expect(doc).toContain('60 秒')            // the backoff ceiling in run.mjs
  })
})

describe('a failure says why, not just that it failed', () => {
  /**
   * Node's `fetch` reports "fetch failed" and puts the reason on `.cause`. Logging only the message produced a
   * daemon that could not be diagnosed from its own log: the same bridge worked in a terminal and failed under
   * launchd, and the two looked identical. The cause (`SELF_SIGNED_CERT_IN_CHAIN`) was the whole answer.
   */
  it('lifts the cause and its code out of a wrapped fetch failure', () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }),
    })
    expect(describeError(wrapped)).toEqual({
      message: 'fetch failed', name: 'TypeError',
      cause: 'self-signed certificate in certificate chain', causeCode: 'SELF_SIGNED_CERT_IN_CHAIN',
    })
  })

  it('walks one more level, because undici nests, and keeps a plain error plain', () => {
    const deep = Object.assign(new Error('outer'), {
      cause: Object.assign(new Error('middle'), { cause: Object.assign(new Error('inner'), { code: 'ENOTFOUND' }) }),
    })
    expect(describeError(deep)).toMatchObject({ message: 'outer', cause: 'middle', rootCause: 'inner', rootCauseCode: 'ENOTFOUND' })
    expect(describeError(new Error('just this'))).toEqual({ message: 'just this' })
    expect(describeError('a string')).toEqual({ message: 'a string' })
    expect(describeError(undefined)).toEqual({ message: 'undefined' })
  })
})

describe('the bridge heartbeat (G-2)', () => {
  it('supervise touches <directory>/.heartbeat on every iteration, and keeps it fresh', async () => {
    const dir = await directory()
    const heartbeat = join(dir, '.heartbeat')
    const calls = { count: 0 }
    const { start, stop } = supervise({
      name: 'test', poll: async () => { calls.count += 1; stop('one iteration is enough') },
      log: {}, intervalMs: 10, heartbeatFile: heartbeat,
    })
    await start()
    // 一轮之后文件已存在，且 mtime 就是"刚刚"。
    const info = await stat(heartbeat)
    expect(info.mtimeMs).toBeGreaterThan(Date.now() - 60_000)
    expect(calls.count).toBeGreaterThanOrEqual(1)
    // 第二轮只是刷新 mtime，不新建内容。
    const before = (await readFile(heartbeat, 'utf8')).trim().split('\n').at(-1)
    expect(before).toBe('bridge heartbeat: mtime says alive')
  })

  it('a heartbeat is not a dependency: a poll that throws still touches it, a missing path is only logged', async () => {
    const dir = await directory()
    const heartbeat = join(dir, '.heartbeat')
    const { start, stop } = supervise({
      name: 'test', poll: async () => { stop('enough'); throw new Error('platform down') },
      log: {}, intervalMs: 10, heartbeatFile: heartbeat,
    })
    await start()
    // 轮次失败也 touch——"进程活着但一直报错"正是 myagent 应当能看见的状态，不能只在成功时说活着。
    expect((await stat(heartbeat)).mtimeMs).toBeGreaterThan(Date.now() - 60_000)
  })
})

describe('the DingTalk mapping (Stream-mode robot message)', () => {
  /** One robot message as the SDK's `DWClientDownStream.data` (parsed) carries it — fields per RobotTextMessage. */
  const robot = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    conversationId: 'cidA', chatbotUserId: 'bot-1', msgId: 'msg-9',
    senderNick: '张三', senderStaffId: 'staff-9', conversationType: '1',
    msgtype: 'text', text: { content: '整理周报' },
    sessionWebhook: 'https://oapi.example/hook', sessionWebhookExpiredTime: 0,
    ...over,
  })
  const ALL = {} as { mode?: 'mentions' | 'dm' | 'all'; chatAllowList?: string[] }

  it('maps a single chat: staff id is the identity, nick names the task, webhook rides along', () => {
    const { message } = ddMapEvent(robot(), ALL) as { message: Record<string, unknown> }
    expect(message.from).toBe('staff-9')
    expect(message.id).toBe('cidA-msg-9')   // 前缀拼接：不在两个会话间赌 msgId 的唯一性范围
    expect(message.body).toBe('整理周报')
    expect(String(message.title)).toContain('张三')
    expect(String(message.title)).toContain('整理周报')
    expect(message.thread).toContain('dm:cidA')
    expect(message.sessionWebhook).toBe('https://oapi.example/hook')
    expect(message.isDirect).toBe(true)
  })

  it('maps a group message and strips its leading bot-mention; a DM keeps a leading @ intact', () => {
    const group = ddMapEvent(robot({ conversationType: '2', text: { content: '@myagent 整理周报' } }), ALL)
    expect((group as { message: { body: string } }).message.body).toBe('整理周报')
    // 单聊不剥："@审批人 请过一下"里的 @ 是正文，不是给自己的名字。
    const dm = ddMapEvent(robot({ text: { content: '@审批人 请过一下' } }), ALL)
    expect((dm as { message: { body: string } }).message.body).toBe('@审批人 请过一下')
    // 群消息剩不下正文（只有 @ 它自己）按无文本跳过，不写空请求。
    expect(ddMapEvent(robot({ conversationType: '2', text: { content: '@myagent' } }), ALL).skip).toBe('no-text:empty-after-clean')
  })

  it('skips what a bridge must not forward: non-text, no sender, the bot itself, disallowed chats, wrong mode', () => {
    expect(ddMapEvent(robot({ msgtype: 'picture' }), ALL).skip).toBe('no-text:picture')
    // 第二把锁：另一种非文本类型同样被挡（M1 强形式删掉上一条后由它接手）。
    expect(ddMapEvent(robot({ msgtype: 'audio' }), ALL).skip).toBe('no-text:audio')
    expect(ddMapEvent(robot({ senderStaffId: '', senderId: '' }), ALL).skip).toBe('no-sender')
    // senderId 是兜底：staff 字段缺席时用它，而不是把消息丢掉（两个键是同一个人的两种口径，混用才是错）。
    const fallback = ddMapEvent(robot({ senderStaffId: '', senderId: 'uid-9' }), ALL) as { message: { from: string } }
    expect(fallback.message.from).toBe('uid-9')
    expect(ddMapEvent(robot({ senderStaffId: 'bot-1' }), ALL).skip).toBe('own-message')
    expect(ddMapEvent(robot(), { chatAllowList: ['cidB'] }).skip).toBe('chat-not-allowed')
    expect(ddMapEvent(robot({ conversationType: '2' }), { mode: 'dm' }).skip).toBe('not-a-dm')
  })

  it('the reply window: expiry in the future is open, past is closed, absent is left to the POST to decide', () => {
    expect(replyWindowOpen({ sessionWebhookExpiredTime: Date.now() + 60_000 }).open).toBe(true)
    const closed = replyWindowOpen({ sessionWebhookExpiredTime: Date.now() - 1_000 })
    expect(closed.open).toBe(false)
    expect(closed.expiryAt).toEqual(expect.any(String))
    expect(replyWindowOpen({}).open).toBe(true)
    expect(replyWindowOpen({}).expiryAt).toBeUndefined()
  })
})
