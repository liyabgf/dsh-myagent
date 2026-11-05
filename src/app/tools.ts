/**
 * The tools this system registers on its two kinds of Session.
 *
 * A worker gets three tools — `myagent_report`, plus `myagent_note_ticket` and `myagent_read_artifact` for crossing to
 * another Ticket inside the same Work. Reporting is the one it must always use; the other two are optional and narrow,
 * and this header used to say "one tool", which was true for eleven rounds and then quietly stopped being true.
 * Reporting is the only thing a worker needs from the system; everything
 * else it does with the profile's own work tools. The main Session gets the management tools, so the operator can
 * send work, read state and answer a question in the conversation they are already in.
 */
import { z } from 'zod'
import { latestReport, ticketStage, type Engine, type Ticket } from '../core/index.ts'
import { UserError, type UserErrorCode } from '../core/errors.ts'
import type { Store } from './store.ts'
import { ticketSummary, ticketView } from './views.ts'

/** A tool as this system writes it: a zod schema for its arguments and what it does with them. */
export interface Tool<S extends z.ZodType = z.ZodType> {
  readonly name: string
  readonly description: string
  readonly schema: S
  readonly execute: (args: z.infer<S>, signal: AbortSignal) => Promise<unknown>
}

/** Widen one concrete tool definition to the erased shape a list of tools holds. */
export const tool = <S extends z.ZodType>(definition: Tool<S>): Tool => definition as unknown as Tool

/**
 * The registration shape `ctx.tools.register` takes: JSON Schema arguments, and a renderer that shows the answer as
 * JSON text, which is what a model reads and what a person can copy out of the transcript.
 */
export function definitionOf(definition: Tool): {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => { type: 'text'; text: string }[] }
  execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>
} {
  return {
    name: definition.name,
    description: definition.description,
    parameters: z.toJSONSchema(definition.schema),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }],
    },
    execute: (args, exec) => definition.execute(definition.schema.parse(args), exec.signal),
  }
}

export interface ToolsHost {
  readonly engine: Engine
  readonly store: Pick<Store, 'tickets' | 'decisions'>
  /** The accept mode now, so a tool can say why nothing executed. */
  acceptMode(): 'auto' | 'observe'
  /**
   * The attempt a worker's current turn was launched for, when it is a worker's turn at all.
   *
   * Recorded at launch rather than derived here: deriving it would mean asking which attempt is running, and that is
   * the very question a turn which outlived its attempt answers wrongly.
   */
  attempt(ticketId: string): string | undefined
  /**
   * Read one registered artifact of another Ticket for a worker, or answer why it may not.
   *
   * On the host rather than in the tool because it does IO and the Engine does not: the Engine authorizes and locates,
   * the Runtime resolves the path with the traversal guard the panel already uses and reads the file.
   */
  readArtifact(sourceTicketId: string, targetTicketId: string, path: string): Promise<ArtifactRead>
}

/**
 * What to do instead, for the two refusals that mean "there is no live Ticket behind this call".
 *
 * A refusal is a teaching moment, and these two taught nothing: `No Ticket has this id` sends its reader looking for
 * another id. The Session that hits them is as often as not one a person opened in the GUI and ran under the
 * `myagent-worker` preset — which is not an operator entry point at all, because work enters myagent through one of its
 * five Sources and never through a Session myagent did not launch. So the answer names the three ways in, and says the
 * thing the caller has just spent a turn discovering.
 *
 * Kept out of `errors.ts` on purpose: that wording is shared with the HTTP API's 400 and 404 bodies, where a paragraph
 * of guidance is noise the panel has to word around. Here the reader is a model that has to decide its next call.
 */
const NEXT_STEP: Partial<Record<UserErrorCode, string>> = {
  ticket_missing: 'A Session myagent did not launch has no Ticket of its own, so there is no id to report against. '
    + 'Work enters myagent one way only: the panel\'s 派活 tab, a message in the main Session (myagent-main), '
    + 'or a request file in the inbox directory. `myagent_list_tickets` shows the Tickets that exist.',
  ticket_ended: 'Ended work is not resumed; the new work needs a Ticket of its own. Dispatch it from the panel\'s '
    + '派活 tab, ask in the main Session (myagent-main), or drop a request file in the inbox directory.',
}

/** What a tool answers when the Engine refused: the fixed code and its wording, not a stack trace. */
function refusal(error: unknown): { error: string; code?: string; next?: string } {
  if (error instanceof UserError) {
    const next = NEXT_STEP[error.code]
    return { error: error.message, code: error.code, ...(next === undefined ? {} : { next }) }
  }
  return { error: error instanceof Error ? error.message : String(error) }
}

/** What a worker gets back when it asks to read another Ticket's artifact: the content, or the refusal. */
export type ArtifactRead =
  | { ok: true; content: string; size: number; at: string; note?: string }
  | { ok: false; error: string; code?: string }

// ------------------------------------------------------------------ Worker

/** The worker's one tool: classify its own work, which is how it speaks to the system. */
export function workerTools(host: ToolsHost, ticket: Ticket): Tool[] {
  const ticketId = ticket.id
  return [tool({
    name: 'myagent_report',
    description: 'Report the state of this Ticket\'s work. Call it before your turn ends. `state` classifies the work: '
      + 'progress (working, for the record), waiting (turn ended with work you cannot do now), ready (done; this ends the Ticket), '
      + 'blocked (you need one decision from a person; put exactly one concrete question in `question`), '
      + 'failed (you cannot finish; say what failed and what would close it), dropped (the request needed no work; this ends the Ticket). '
      + 'On ready, list the files you produced in `files`, relative to your directory.',
    schema: z.object({
      state: z.enum(['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped']),
      summary: z.string().trim().min(1).max(20000).describe('What you did and what came of it, in plain sentences. Name the files that matter.'),
      question: z.string().trim().max(2000).optional().describe('One concrete question for a person, with the options you see and the one you would pick. Required for blocked.'),
      files: z.array(z.string().trim().max(500)).max(200).optional().describe('Files you produced, relative to your directory. For ready.'),
    }).strict(),
    execute: async args => {
      const updated = host.engine.report(ticketId, {
        state: args.state, summary: args.summary, question: args.question, files: args.files,
      }, host.attempt(ticketId))
      return {
        ticket_id: ticketId, state: args.state, stage: ticketStage(updated),
        ended: updated.ended !== undefined,
        // DSH refuses a tool result whose JSON is not lossless, and `{ outcome: undefined }` is exactly that: every
        // non-terminal report came back to the worker as a tool error while the report itself had landed, so the
        // worker believed reporting had failed and retried it. Present the key only when there is something to say.
        ...(updated.ended === undefined ? {} : {
          outcome: updated.ended.outcome,
          // A Ticket that ended takes no further report, so say so here rather than at the next call.
          note: 'This Ticket has ended; this Session\'s tools are now denied.',
        }),
      }
    },
  }), tool({
    name: 'myagent_read_artifact',
    description: 'Read a file another Ticket produced, when both of you belong to the same Work. '
      + 'Only files that Ticket registered as artifacts are readable — not whatever else happens to be in its directory, '
      + 'because the registry is what a report claimed and what a person can audit. '
      + 'Ask for the path as it was registered, relative to that Ticket\'s directory. Text only.',
    schema: z.object({
      ticket_id: z.string().trim().min(1).describe('The other Ticket, by its full id.'),
      path: z.string().trim().min(1).max(500).describe('The artifact path, relative to that Ticket\'s directory.'),
    }).strict(),
    execute: async args => {
      const read = await host.readArtifact(ticketId, args.ticket_id, args.path)
      return read.ok
        ? { ticket_id: args.ticket_id, path: args.path, size: read.size, at: read.at, content: read.content }
        : { error: read.error, ...(read.code === undefined ? {} : { code: read.code }) }
    },
  }), tool({
    name: 'myagent_note_ticket',
    description: 'Hand a fact to another Ticket in the same Work: a number, a path, something your side decided that its '
      + 'side needs. It arrives there as an Input written by you, through the Engine, so both Tickets keep a record of '
      + 'who told whom what. A Ticket in another Work, or in no Work, refuses it, and so does one that has ended. '
      + 'This is not how to ask for new work: it adds a fact to work somebody already authorized.',
    schema: z.object({
      ticket_id: z.string().trim().min(1).describe('The other Ticket, by its full id.'),
      text: z.string().trim().min(1).max(8000).describe('The fact, in plain sentences. Say what it is for.'),
    }).strict(),
    execute: async args => {
      try {
        const updated = host.engine.noteFromWorker(ticketId, args.ticket_id, args.text)
        const input = updated.inputs.at(-1)!
        // `delivered` false is not a failure: the fact is recorded and waits for the other Ticket's next launch.
        return { ticket_id: args.ticket_id, input_id: input.id, delivered: input.deliveredAt !== undefined }
      } catch (error) { return refusal(error) }
    },
  })]
}

// ------------------------------------------------------------ Main Session

/** The management tools of the operator's front desk. */
export function mainTools(host: ToolsHost): Tool[] {
  return [
    tool({
      name: 'myagent_create_ticket',
      description: 'Open a Ticket for work that needs its own directory and time: a worker Session runs it unattended and reports back. '
        + 'Write `request` as you would write to a colleague who cannot ask you anything — what to produce, where it goes, what done looks like. '
        + 'The request passes the same gate as a schedule or an inbox file, so in observe mode it is recorded and not executed.',
      schema: z.object({
        title: z.string().trim().min(1).max(200).describe('A short title the panel and the worker\'s Session name show.'),
        request: z.string().trim().min(1).max(20000).describe('The work, complete enough to run unattended.'),
        scope: z.string().trim().max(2000).optional().describe('How far this work may go. Omit it for the default: work in the Ticket\'s own directory.'),
        sender: z.string().trim().max(120).optional().describe('Who asks, when it is not the operator. Must be on the allowed list.'),
        attachments: z.array(z.string().trim().min(1).max(4000)).max(20).optional()
          .describe('Absolute paths of files this work needs — a document, a spreadsheet, an image the operator attached or named. '
            + 'They are copied into the Ticket\'s own directory before the worker starts, so list only what the work actually reads. '
            + 'A path that cannot be read fails the Ticket rather than starting it without its input.'),
      }).strict(),
      execute: async args => {
        try {
          const result = host.engine.createTicket({
            title: args.title, text: args.request, scope: args.scope, sender: args.sender, attachments: args.attachments,
          })
          const decision = result.disposition.state === 'accepted' || result.disposition.state === 'ignored' || result.disposition.state === 'observed'
            ? host.engine.decisionOf(result.disposition.decisionId) : undefined
          return {
            stored: result.stored, disposition: result.disposition.state, ticket_id: result.ticketId,
            accept_mode: host.acceptMode(),
            ...(decision === undefined ? {} : { reason: decision.reason, detail: decision.detail }),
            ...(result.disposition.state === 'observed'
              ? { note: 'The accept mode is observe: this request is recorded and nothing executed. Set acceptMode to auto to run it.' } : {}),
          }
        } catch (error) { return refusal(error) }
      },
    }),
    tool({
      name: 'myagent_list_tickets',
      description: 'List Tickets, newest first. Use it before answering any question about what the system is doing; never guess a state.',
      schema: z.object({
        state: z.enum(['open', 'ended', 'attention', 'all']).default('open').describe('attention means waiting for a person.'),
        limit: z.number().int().min(1).max(100).default(20),
      }).strict(),
      execute: async args => {
        const tickets = host.store.tickets.page(args.state, 0, args.limit)
        return { count: tickets.length, state: args.state, tickets: tickets.map(ticketSummary) }
      },
    }),
    tool({
      name: 'myagent_ticket_status',
      description: 'Read one Ticket in full: its mandate and scope, its Assignments, every report, what it waits for, and what it produced.',
      schema: z.object({ ticket_id: z.string().trim().min(1).describe('The Ticket id, which myagent_list_tickets shows.') }).strict(),
      execute: async args => {
        try {
          const ticket = host.engine.require(args.ticket_id)
          const report = latestReport(ticket)
          return { ...ticketView(ticket), latest_report: report }
        } catch (error) { return refusal(error) }
      },
    }),
    tool({
      name: 'myagent_answer_ticket',
      description: 'Answer a Ticket that waits for a person. It clears the question and delivers your text to the worker, which continues in the same directory.',
      schema: z.object({
        ticket_id: z.string().trim().min(1),
        text: z.string().trim().min(1).max(20000).describe('The answer, complete enough to work from: the decision and what follows from it.'),
      }).strict(),
      execute: async args => {
        try {
          const ticket = host.engine.answer(args.ticket_id, args.text)
          return { ticket_id: ticket.id, stage: ticketStage(ticket), waits_for_person: ticket.attention !== undefined }
        } catch (error) { return refusal(error) }
      },
    }),
    tool({
      name: 'myagent_note_ticket',
      description: 'Give a working Ticket a fact — a path, a correction, a constraint — without ending or restarting it. It grants nothing: the scope is unchanged.',
      schema: z.object({ ticket_id: z.string().trim().min(1), text: z.string().trim().min(1).max(20000) }).strict(),
      execute: async args => {
        try {
          const ticket = host.engine.note(args.ticket_id, args.text)
          return { ticket_id: ticket.id, stage: ticketStage(ticket), delivered_to: latestAssignmentState(ticket) }
        } catch (error) { return refusal(error) }
      },
    }),
    tool({
      name: 'myagent_stop_ticket',
      description: 'Stop a Ticket for good: it withdraws the authorization, cancels the worker\'s turn and stops its background work. Ask the operator first unless they asked for the stop.',
      schema: z.object({
        ticket_id: z.string().trim().min(1),
        reason: z.string().trim().max(500).optional().describe('One sentence recorded on the Ticket, which the panel shows.'),
      }).strict(),
      execute: async args => {
        try {
          const ticket = host.engine.stopTicket(args.ticket_id, args.reason ?? 'A person stopped this Ticket')
          return { ticket_id: ticket.id, stage: ticketStage(ticket), outcome: ticket.ended?.outcome }
        } catch (error) { return refusal(error) }
      },
    }),
    tool({
      name: 'myagent_retry_ticket',
      description: 'Continue a Ticket that waits for a person after a failed or blocked report, or whose delivery failed: it ends the stalled Assignment and starts a fresh one in the same directory.',
      schema: z.object({ ticket_id: z.string().trim().min(1) }).strict(),
      execute: async args => {
        try {
          const ticket = host.engine.retryTicket(args.ticket_id)
          return { ticket_id: ticket.id, stage: ticketStage(ticket), assignments: ticket.assignments.length }
        } catch (error) { return refusal(error) }
      },
    }),
  ]
}

function latestAssignmentState(ticket: Ticket): string {
  return ticket.assignments.at(-1)?.state ?? 'none'
}
