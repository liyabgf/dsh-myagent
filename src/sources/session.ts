/**
 * The session Source: the operator talking to the main Session.
 *
 * There is nothing to poll — the main Session's tools call `Engine.createTicket`, and the gate applies to that
 * Trigger exactly as it does to a schedule or a file. This Source exists so the panel can show the channel, so the
 * settings can turn it off, and so a second chat Source later has a shape to follow.
 */
import type { HealthEntry } from '../app/health.ts'
import type { Source, SourceHost, SourceKind, SourceStatus } from './kind.ts'

export class SessionSource implements Source {
  readonly id = 'session'
  readonly kind = 'session' as const
  private healthEntry?: HealthEntry
  private get health(): HealthEntry { return this.healthEntry ??= this.host.health.entry('source:session') }
  private last: SourceStatus = { ok: true }

  constructor(private readonly host: SourceHost) {}

  start(): void {
    const enabled = this.host.settings().sources.session.enabled
    this.last = { ok: true, detail: enabled ? undefined : 'disabled' }
    this.health.record(enabled ? 'the main Session takes requests' : 'disabled')
  }

  stop(): void { /* nothing runs */ }

  status(): SourceStatus {
    const enabled = this.host.settings().sources.session.enabled
    return { ok: true, detail: enabled ? undefined : 'disabled' }
  }
}

export const sessionKind: SourceKind = { name: 'session', create: (host: SourceHost): Source => new SessionSource(host) }
