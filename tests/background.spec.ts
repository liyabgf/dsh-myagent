/**
 * Stopping what a worker leaves running behind it.
 *
 * A turn is not the work: shell jobs and subagents outlive the turn that started them, so a stop that only cancels the
 * turn leaves work running under an authorization that was withdrawn. These cases pin what a stop actually reaches, and
 * that one thing refusing to die does not leave the rest running.
 */
import { describe, expect, it } from 'vitest'
import { killJobs, stopBackground, stopSubagents, until } from '../src/app/background.ts'
import { stubHost } from './helpers/host.ts'

describe('until', () => {
  it('gives the value of work that finishes in time', async () => {
    expect(await until(Promise.resolve('done'), undefined, 1000)).toBe('done')
  })

  it('gives false once the signal aborts, and never resolves the abandoned work into a caller', async () => {
    const controller = new AbortController()
    const pending = until(new Promise(resolve => setTimeout(() => resolve('late'), 500)), controller.signal)
    controller.abort()
    expect(await pending).toBe(false)
  })

  it('gives false once the bound passes, so a shutdown is not held up by work that will not end', async () => {
    expect(await until(new Promise(resolve => setTimeout(() => resolve('late'), 500)), undefined, 10)).toBe(false)
  })

  it('refuses to start work whose signal already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await until(Promise.resolve('done'), controller.signal)).toBe(false)
  })
})

describe('killing a Session\'s shell jobs', () => {
  it('does nothing on a profile without the jobs service', async () => {
    const host = stubHost()
    await expect(killJobs(host.ctx, 'worker-1', 'the Ticket ended')).resolves.toBeUndefined()
    expect(host.services.log).toEqual([])
  })

  it('kills the jobs this Session owns that still run, and no others', async () => {
    const host = stubHost({
      services: true,
      jobs: [
        { id: 'job-own', owner: 'worker-1' },
        { id: 'job-stopping', owner: 'worker-1', status: 'stopping' },
        { id: 'job-settled', owner: 'worker-1', status: 'settled' },
        { id: 'job-other', owner: 'worker-2' },
      ],
    })
    await killJobs(host.ctx, 'worker-1', 'the Ticket ended')
    expect(host.services.log.filter(item => item.startsWith('kill'))).toEqual(['kill:job-own', 'kill:job-stopping'])
    expect(host.services.jobs.find(job => job.id === 'job-own')).toMatchObject({ status: 'killed', killedWith: 'the Ticket ended' })
    expect(host.services.jobs.find(job => job.id === 'job-settled')).toMatchObject({ status: 'settled' })
    expect(host.services.jobs.find(job => job.id === 'job-other')).toMatchObject({ status: 'running' })
  })

  it('waits for each end before killing, so the worker is not woken to hear about a job it no longer owns', async () => {
    const host = stubHost({ services: true, jobs: [{ id: 'job-1', owner: 'worker-1' }, { id: 'job-2', owner: 'worker-1' }] })
    await killJobs(host.ctx, 'worker-1', 'stopped')
    // Every wait is asked for before the first kill lands.
    expect(host.services.log.slice(0, 2)).toEqual(['wait:job-1', 'wait:job-2'])
    expect(host.services.log.slice(2)).toEqual(['kill:job-1', 'kill:job-2'])
  })

  it('treats a job that ended on its own between listing and killing as stopped, not as a failure', async () => {
    // 【误报修正】那次健康误报的形状：一个任务带着十个后台 job 收尾，逐个完成，每个先于 kill 完成
    // 的 job 都把 kill 变成 AggregateError——"它已经停了"被报成"停不掉"。这条与下面 failKills 那条
    // 互为对方变异的第二把锁：不核实（全记失败）这条红；什么都不记（吞掉所有失败）那条红。
    const host = stubHost({
      services: true,
      jobs: [{ id: 'job-vanished', owner: 'worker-1' }, { id: 'job-live', owner: 'worker-1' }],
    })
    host.services.vanishKills.push('job-vanished')
    await expect(killJobs(host.ctx, 'worker-1', 'stopped')).resolves.toBeUndefined()
    // 消失的那个尝试过 kill（证据在日志里），活着的那个真的被杀掉。
    expect(host.services.log).toContain('kill:job-vanished')
    expect(host.services.jobs.find(job => job.id === 'job-live')).toMatchObject({ status: 'killed' })
  })

  it('kills the rest when one job will not die, and reports the failure', async () => {
    const host = stubHost({ services: true, jobs: [{ id: 'job-bad', owner: 'worker-1' }, { id: 'job-good', owner: 'worker-1' }] })
    host.services.failKills.push('job-bad')
    await expect(killJobs(host.ctx, 'worker-1', 'stopped')).rejects.toThrow(/Killing the shell jobs of worker-1 failed/)
    expect(host.services.jobs.find(job => job.id === 'job-good')).toMatchObject({ status: 'killed' })
  })
})

describe('releasing a worker\'s subagents', () => {
  it('does nothing on a profile without the subagents service', async () => {
    const host = stubHost()
    const agent = host.spawn('worker-1', 'running')
    await expect(stopSubagents(host.ctx, agent as never)).resolves.toBeUndefined()
    expect(agent.cancelled).toBe(0)
  })

  it('treats a subagent that ended on its own between listing and draining as released, not as a failure', async () => {
    // 【误报修正的同族】生产实捕：killJobs 的核实修复上线后，同一条红线从另一半（stopSubagents）
    // 又冒出来——孩子在 list 与 drain 之间自己结束，drain 扑空抛错，"已经停了"被报成"停不掉"。
    // 这条与 failDrains 那条互为对方变异的第二把锁：不核实（全记失败）这条红；吞掉所有失败那条红。
    const host = stubHost({ services: true, children: { 'worker-1': ['child-self-ended'] } })
    host.spawn('child-self-ended')
    const agent = host.spawn('worker-1')
    host.services.vanishDrains.push('child-self-ended')
    await expect(stopSubagents(host.ctx, agent as never)).resolves.toBeUndefined()
    // 试过 drain（日志为证），且没有谁被记为失败。
    expect(host.services.log).toContain('drain:child-self-ended')
  })

  it('releases the children that still exist, and skips the ones already gone', async () => {
    const host = stubHost({ services: true, children: { 'worker-1': ['child-live', 'child-gone'] } })
    host.spawn('child-live')
    const agent = host.spawn('worker-1')
    await stopSubagents(host.ctx, agent as never)
    expect(host.services.log).toEqual(['drain:child-live'])
  })

  it('does nothing when no child is left, and leaves the turn alone', async () => {
    const host = stubHost({ services: true, children: { 'worker-1': ['child-gone'] } })
    const agent = host.spawn('worker-1', 'running')
    await stopSubagents(host.ctx, agent as never)
    expect(host.services.log).toEqual([])
    expect(agent.cancelled).toBe(0)
  })

  it('cancels the turn after a release, because DSH wakes the worker with each child\'s end', async () => {
    const host = stubHost({ services: true, children: { 'worker-1': ['child-live'] } })
    host.spawn('child-live')
    const agent = host.spawn('worker-1', 'running')
    await stopSubagents(host.ctx, agent as never, true)
    expect(host.services.log).toEqual(['drain:child-live'])
    expect(agent.cancelled).toBe(1)
  })

  it('cancels the turn even when the release itself fails', async () => {
    const host = stubHost({ services: true, children: { 'worker-1': ['child-live'] } })
    host.spawn('child-live')
    host.services.failDrains.push('child-live')
    const agent = host.spawn('worker-1', 'running')
    await expect(stopSubagents(host.ctx, agent as never)).rejects.toThrow(/will not release/)
    expect(agent.cancelled).toBe(1)
  })
})

describe('stopping everything in the background', () => {
  it('reaches both the jobs and the subagents of one Session', async () => {
    const host = stubHost({ services: true, jobs: [{ id: 'job-1', owner: 'worker-1' }], children: { 'worker-1': ['child-1'] } })
    host.spawn('child-1')
    host.spawn('worker-1')
    await stopBackground(host.ctx, 'worker-1', 'the Ticket ended')
    expect(host.services.log).toEqual(['wait:job-1', 'kill:job-1', 'drain:child-1'])
  })

  it('stops the jobs of a Session that is not loaded, which is all there is to stop', async () => {
    const host = stubHost({ services: true, jobs: [{ id: 'job-1', owner: 'worker-1' }] })
    await stopBackground(host.ctx, 'worker-1', 'the Ticket ended')
    expect(host.services.log).toEqual(['wait:job-1', 'kill:job-1'])
  })

  it('reports both failures together rather than stopping at the first', async () => {
    const host = stubHost({ services: true, jobs: [{ id: 'job-1', owner: 'worker-1' }], children: { 'worker-1': ['child-1'] } })
    host.spawn('child-1')
    host.spawn('worker-1')
    host.services.failKills.push('job-1')
    host.services.failDrains.push('child-1')
    await expect(stopBackground(host.ctx, 'worker-1', 'stopped')).rejects.toThrow(/Stopping the background work of worker-1 failed/)
    // Both were attempted, so neither was left running because the other refused.
    expect(host.services.log).toEqual(['wait:job-1', 'kill:job-1', 'drain:child-1'])
  })
})
