/** Fixed refusals: a refusal a person or an agent can cause, worded the same way everywhere it surfaces. */

/** Every code the Engine and the management API may refuse with. */
export const USER_ERRORS = {
  ticket_missing: 'No Ticket has this id',
  ticket_ended: 'This Ticket has ended; new work needs a new Ticket',
  ticket_not_running: 'No Assignment of this Ticket is running',
  assignment_stale: 'Another Assignment took this Ticket over',
  retry_refused: 'This Ticket does not wait for a person, so there is nothing to retry',
  stop_refused: 'This Ticket has already ended',
  trigger_missing: 'No Trigger has this id',
  input_missing: 'No such input on this Ticket',
  project_missing: 'No Project has this id',
  work_missing: 'No Work has this id',
  // Not "the Ticket is busy" but "an authorization is still in force": a running attempt has a Session mid-turn and a
  // directory it owns, so deleting the record under it would leave that Session writing where nobody is accountable.
  ticket_not_stopped: 'That Ticket has not ended; stop it before deleting it',
  empty_name: 'A name cannot be empty',
  collaboration_refused: 'Only Tickets in the same Work can hand something to each other',
  empty_text: 'There is nothing to hand over: the text is empty',
  artifact_missing: 'No artifact of that Ticket is registered under this path',
  // A separate code from `artifact_missing`, because the two have different causes and different remedies: one means
  // nobody claimed that file, the other means there is nowhere to read it from. Sharing one message made a real
  // failure undiagnosable from the outside — which is the whole point of an error code.
  artifact_unreachable: 'That Ticket has no directory to read the artifact from',
  decision_missing: 'No decision has that id',
  dependency_cycle: 'That would make a Ticket wait for itself, directly or through others',
  // A reply whose `replyTo` names a Source that cannot take it: switched off between the request and the answer, or one
  // that only ever produces. Deliberately separate from a Ticket whose Trigger carries no `replyTo` at all — that case
  // is not an error, it does nothing and stays observable — because this one says an address WAS written down and
  // nothing is there to receive it, which is a different fact with a different remedy.
  // Was "No Source of that kind is running to take a reply back", which described a different situation from the one
  // that actually throws it: the Source IS running, and the channel it would reply to is gone or disabled. An error
  // message that misdescribes its own cause sends whoever reads it looking in the wrong place — the same defect class
  // as a refusal detail that said a Source was not enabled while it was.
  reply_unroutable: 'That reply has nowhere to go: its channel is gone or disabled',
  // A separate code from `reply_unroutable`, and the wording is the one `reply_unroutable` used to carry: the address
  // is fine, but nothing is running that could take it. Two causes, two remedies, so two messages — errors.ts's own
  // rule, which is exactly why the dispatcher could not reuse the code above.
  reply_unreceivable: 'No Source is running that can take this reply back',
} as const satisfies Record<string, string>

export type UserErrorCode = keyof typeof USER_ERRORS

/**
 * A refusal with a fixed code and the values its wording needs.
 * The management API answers it with 400, or 404 for `*_missing`, and the panel words the code in its own language.
 */
export class UserError extends Error {
  constructor(readonly code: UserErrorCode, readonly values: Record<string, unknown> = {}) {
    super(USER_ERRORS[code])
    this.name = 'UserError'
  }
  /** Whether this code names something that is absent, which the API answers with 404. */
  get missing(): boolean { return this.code.endsWith('_missing') }
}
