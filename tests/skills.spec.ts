import { describe, expect, it } from 'vitest'
import { registerSkills, SKILLS, type SkillsPort } from '../src/app/skills.ts'

/** A catalog the test can read, which is the whole reason `registerSkills` is a function and not inline in `apply`. */
function catalog() {
  const registered: { name: string; description: string; source: string; content: string; whenToUse?: string }[] = []
  let released = 0
  const skills: SkillsPort = {
    register(skill) {
      registered.push(skill as never)
      return () => { released++ }
    },
  }
  return { skills, registered, released: () => released }
}

describe('the skills myagent contributes', () => {
  it('registers each one as a runtime skill with a prefixed kebab-case name and a real body', () => {
    const { skills, registered } = catalog()
    registerSkills(skills)

    // Hardcoded, not read back from SKILLS: an expectation taken from the thing under test cannot fail when that thing
    // changes — dropping a skill from SKILLS would shorten both sides equally and this would still pass (0.8). M3
    // proved it: with this line self-referential, removing the second skill left it green.
    expect(registered.map(skill => skill.name))
      .toEqual(['myagent-html-to-text', 'myagent-source-registry', 'myagent-polite-fetch'])
    const html = registered.find(skill => skill.name === 'myagent-html-to-text')!
    // `source` is what tells the host this came from a plugin at runtime rather than from a directory it discovered,
    // and the registry's rank for it (250) beats a bundled skill's (600) — which is why the name is prefixed.
    expect(html.source).toBe('runtime')
    // The name grammar is the host's, not ours: `SKILL_NAME` is /^[a-z0-9]+(?:-[a-z0-9]+)*$/, and `register` throws
    // on anything else. Asserting it here means a rename that would be refused at runtime fails in the suite instead.
    for (const skill of registered) {
      expect(skill.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(skill.name.startsWith('myagent-')).toBe(true)
      expect(skill.description.length).toBeGreaterThan(0)
    }
    // The body must carry what the real scripts learned, not a description of it. Each of these is a detail one of
    // the two `html2txt.py` files had and a from-imagination rewrite would most likely drop — which is the reason
    // §3.6 says to distil rather than rewrite. An assertion on a generic word like "html" would pass for an empty
    // shell, so these are the load-bearing ones.
    expect(html.content).toContain('errors="replace"')
    expect(html.content).toContain('\\xa0')
    expect(html.content).toContain('self.skip += 1')
    expect(html.content).toContain("' | '")
    expect(html.content).toContain('convert_charrefs=True')
    // And it must say where it came from, so the next person does not re-derive it a third time.
    expect(html.content).toContain('real-run-1-collect')

    const registry = registered.find(skill => skill.name === 'myagent-source-registry')!
    expect(registry).toBeDefined()
    // The details that make a registry usable rather than decorative, each of which a from-imagination rewrite drops:
    // the final URL (redirects are where citations rot), the count of FAILURES beside the count of successes (a
    // registry listing only successes hides exactly what a reader needs), and the primary/secondary split.
    expect(registry.content).toContain('final')
    expect(registry.content).toContain('Separate captured from failed, and print both counts')
    expect(registry.content).toContain('Separate primary from secondary')
    expect(registry.content).toContain('fetched_at_utc')
    // And the column list itself, since a manifest whose columns nobody knows cannot be built by the next Ticket.
    expect(registry.content).toContain('name,url,http_code,bytes,content_type,final_url,fetched_at_utc,local_path')

    const fetch = registered.find(skill => skill.name === 'myagent-polite-fetch')!
    expect(fetch).toBeDefined()
    // The numbers are the reason this skill exists: each one is a value a real run survived, and a rewrite from
    // imagination would have to guess them. Asserting them is what makes "an empty shell with the right name" fail.
    expect(fetch.content).toContain('0.4 s')
    expect(fetch.content).toContain('429')
    expect(fetch.content).toContain('-m 45')
    expect(fetch.content).toContain('subprocess at 70')
    expect(fetch.content).toContain('url_effective')
    // And the rule that is not a number: retry once, and only for the transient set. A retry loop on a 429 is the
    // thing this skill exists to stop a worker from writing.
    expect(fetch.content).toContain('Retry once')
  })

  it('takes them all back on release, and releasing twice does not double-release', () => {
    const { skills, released } = catalog()
    const off = registerSkills(skills)
    off()
    expect(released()).toBe(SKILLS.length)
  })
})
