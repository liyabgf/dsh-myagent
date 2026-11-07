/**
 * The skills myagent contributes to the host's catalog, registered at runtime.
 *
 * Why runtime registration rather than files on disk: `skill-filesystem` discovers from project, custom and user
 * roots, and the only one a bundle could use is `customSkillDirs` — a string array in a static `cordis.patch.yml`
 * that cannot express "the directory this package was installed into", which is known only at runtime. A virtual
 * skill needs no path at all (`SkillSummary.path` is documented as "absent for virtual skills"), so the body lives
 * here and the problem does not exist. See `docs/v2/20-capability-and-asset-analysis.md` §3.5-§3.6.
 *
 * Why these three: two real runs each wrote their own `html2txt.py` from scratch (1675 and 2044 bytes, not
 * identical), one wrote `mk_news_manifest2.py` beside `mk_news_manifest.py` instead of fixing the first, and a
 * 69,814-byte chronology builder was discarded with its Ticket directory. The bodies below are distilled from the
 * scripts that survived real work, not written from imagination — rewriting them would lose the details that work
 * bought (`errors="replace"`, the `\\xa0` in the whitespace collapse, a skip DEPTH rather than a flag).
 *
 * Names are prefixed `myagent-` on purpose. `SkillRegistration` has no `rank` field (that belongs to
 * `SkillCandidate`), so the registry assigns `RUNTIME_RANK = 250`, and lower ranks win duplicate names — a runtime
 * skill called `html-to-text` would silently shadow a host built-in of the same name, with neither side reporting
 * anything.
 */

/** The slice of the host's skill registry this module uses, so it can be tested without a whole plugin context. */
export interface SkillsPort {
  register(skill: {
    name: string
    description: string
    whenToUse?: string
    source: string
    content: string
  }): () => void
}

/**
 * HTML → readable text.
 *
 * Distilled from `examples/real-run-1-collect/scripts/html2txt.py` and
 * `examples/real-run-2-compare/scripts/html2txt.py`: two workers, on two unrelated assignments (a news brief and a
 * legal chronology), each wrote this from scratch. Taking the union of what each did well is the whole point — the
 * table handling only exists in the first, the wider block set only in the second.
 */
const HTML_TO_TEXT = `# HTML → readable text (stdlib only)

Turn a saved page into text you can actually read, quote and grep. No dependencies: \`html.parser\` is in the
standard library, so this runs anywhere Python 3 does — which matters when you are fetching three hundred pages in
a directory you do not control.

## The program

\`\`\`python
#!/usr/bin/env python3
"""Convert saved HTML to readable plain text (stdlib only).

Usage: python3 html2txt.py IN.html [OUT.txt]
Keeps table cell separation with ' | ' and row breaks, so a data table stays a data table.
"""
import re, sys
from html.parser import HTMLParser

# What never carries prose. Both real runs had this set; the first also dropped header/aside/select/figure/picture,
# which is worth keeping — navigation and cookie furniture is the bulk of what makes extracted text unreadable.
SKIP = {"script", "style", "noscript", "svg", "head", "nav", "header", "footer",
        "aside", "form", "button", "select", "figure", "picture"}

# What starts a new line. The second real run's set is the wider one (it adds blockquote, pre, ul, ol, table,
# h5, h6 and treats td/th as blocks); the first kept td/th separate so cells stay separable. Both are here.
BLOCK = {"p", "div", "li", "tr", "br", "section", "article", "blockquote", "pre", "ul", "ol", "table",
         "h1", "h2", "h3", "h4", "h5", "h6"}
CELL = {"td", "th"}
HEADING = {"h1", "h2", "h3", "h4"}


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)   # &amp; and friends arrive already decoded
        self.out = []
        self.skip = 0        # A DEPTH, not a flag: nested skipped elements must not leak, and the first one to
                             # close must not re-open the prose of an outer one that is still open.

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
        elif tag in CELL:
            self.out.append(" | ")
        elif tag in BLOCK:
            self.out.append("\\n")
            if tag in HEADING:
                self.out.append("\\n")   # a blank line before a heading is what makes the outline greppable

    def handle_endtag(self, tag):
        if tag in SKIP and self.skip:
            self.skip -= 1
        elif tag in BLOCK or tag in CELL:
            self.out.append("\\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def main():
    src = sys.argv[1]
    parser = Text()
    # errors="replace" is not a convenience: one undecodable byte in a 2 MB filing otherwise loses the whole file,
    # and a page you cannot read is a source you cannot cite.
    parser.feed(open(src, encoding="utf-8", errors="replace").read())
    text = "".join(parser.out)
    text = re.sub(r"[ \\t\\xa0]+", " ", text)   # \\xa0 is the non-breaking space; without it, "collapsed" text
    text = re.sub(r" *\\n *", "\\n", text)      # still has runs of what look like spaces and defeat every split()
    text = re.sub(r"\\n{3,}", "\\n\\n", text)
    text = text.strip() + "\\n"
    if len(sys.argv) > 2:
        open(sys.argv[2], "w", encoding="utf-8").write(text)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
\`\`\`

## What it is good for, and what it is not

- **Good for**: filings, judgments, press releases, documentation — anything where the prose is the payload and the
  markup is noise. A table survives as \` | \` separated cells, which is enough to read and to re-split.
- **Not good for**: recovering exact layout, or for pages whose content is built by JavaScript. If \`len(text)\` is
  suspiciously small for the size of the HTML, the prose was never in the document — say so in your report rather
  than quoting an empty page as a source.
- **Keep the original.** Extracted text is a reading aid; the citation points at the URL and the saved file. Both
  real runs kept \`raw/\` beside \`txt/\` for exactly this reason, and the registry listed both.

## Where this came from

Distilled from two scripts that two workers wrote independently, on unrelated assignments, without being able to see
each other's work: \`examples/real-run-1-collect/scripts/html2txt.py\` (a news brief) and
\`examples/real-run-2-compare/scripts/html2txt.py\` (a legal chronology). The table handling is only in the first,
the wider block set only in the second, and the details that are easy to drop — \`errors="replace"\`, the \`\\xa0\`
in the whitespace collapse, a skip **depth** rather than a flag — are in both. **That is why this exists: the details
were paid for twice already.** If you improve it, say so in your report so the next Ticket inherits the improvement
instead of paying a third time.
`

/**
 * The source registry: how to make a body of fetched material checkable.
 *
 * Distilled from `examples/real-run-1-collect/scripts/mk_registry.py` and `scripts/fetch.py`, which together produced
 * `sources/registry.md` — 279 entries, each with its URL, HTTP status, byte count, fetch time and local copy. This is
 * the one whose value is not the code: a registry is what turns "I read some pages" into "every claim here can be
 * checked against a named source retrieved at a named time". The second real run built the same thing again, in a
 * different shape, for a different subject.
 */
const SOURCE_REGISTRY = `# Making fetched material checkable: the manifest and the registry

Two artefacts, written at two different moments, and the difference in timing is the whole method.

**A manifest, appended as you fetch.** One row per URL, written the moment it is captured — not at the end.

    name,url,http_code,bytes,content_type,final_url,fetched_at_utc,local_path

- **Append while fetching**, and write the header only if the file is new. A run that dies halfway still leaves a
  record of everything it did get, so the next run resumes instead of restarting.
- **Record the final URL, not just the one you asked for.** Redirects are where citations rot: the address you
  fetched and the address a reader can open are often not the same string.
- **Record the status and the byte count even for failures.** A row saying 404 with 0 bytes is information; a missing
  row is indistinguishable from "never tried".
- **Record the fetch time in UTC.** "As of" is part of any claim about a live page, and a local timestamp is
  ambiguous to everyone else.
- **Sanitise the local filename** — replace every character outside [A-Za-z0-9._-] with an underscore and cap the
  length — so a name containing a slash or a space cannot escape the directory.

**Declare yourself where a site asks for it.** Both real runs used a desktop browser User-Agent for general pages,
but a *declared research* User-Agent (independent research, with a contact address) for sec.gov. Impersonating a
browser at a registry that publishes an access policy is the wrong trade: it risks being blocked, and it misstates
what you are.

**A registry, built from the manifest afterwards.** Group by registrable domain (strip a leading www.), and:

- **Separate captured from failed, and print both counts** — "captured 274, failed or not archived 5". A registry
  that lists only successes silently hides the gaps, and the gaps are exactly what a reader needs to know about.
- **Separate primary from secondary.** Primary means the party's own filings, orders, press releases and
  documentation; secondary means commentary about them. A chronology built only from secondary sources is a summary
  of other people's summaries.
- **Say at the top what each record contains and where the copies live** (raw HTML in one directory, extracted text
  in another), so a reader can go from any claim to the bytes it came from without asking you.

## Why this is worth doing even when nobody asks

The two real runs differed in subject, in language and in method, and both built this. That is the evidence it is
not overhead: it is what made each run's output survivable — the second run could read the first run's registry and
merge with it, which is how one Ticket's corrections reached another's conclusions at all.
`

/**
 * Polite, resumable batch fetching: the parameters below were measured, not chosen.
 *
 * Distilled from `examples/real-run-1-collect/scripts/fetch.py` and
 * `examples/real-run-2-compare/scripts/fetch_legal.py`, which between them pulled several hundred documents from
 * filing registries, courts and press rooms without being blocked. The numbers are the point of this skill: each one
 * is a value a real run survived, and a from-imagination rewrite would have to guess them.
 */
const POLITE_FETCH = `# Batch fetching that survives both the sites and a crash

Fetch through curl with a machine-readable report line, and write the manifest row the moment each page lands.

## The parameters, and why each is what it is

- **Space requests about 0.4 s apart.** Both real runs used this and neither was blocked. The point of a delay is not
  politeness in the abstract: a burst looks like a scraper and a steady trickle looks like a reader, and the second
  is what a small filing registry will tolerate all day.
- **Retry once, after 2 s, and only for the transient set: 000 (curl could not connect), 429, 500, 502, 503.** One
  retry catches a dropped connection; a retry loop on a 429 is a denial of service with extra steps. If it fails
  twice, write the row and move on — the manifest records the failure, which is worth more than a third attempt.
- **Two timeouts, and the outer must be larger: curl -m 45, and the subprocess at 70.** The inner bounds the
  transfer; the outer bounds the whole call including DNS and connection setup, and is what stops a hung host from
  hanging the run. With them equal the outer fires first and you learn nothing from the inner.
- **Write the manifest row, then flush, before printing progress.** A run that dies halfway keeps the record of
  everything it did get, which is exactly what makes the next run a resume instead of a restart.
- **Choose the file extension from the content type, not from the URL.** An RSS feed served as text/xml is not an
  .html file, and a JSON endpoint with no extension in its URL is not either.
- **A transfer succeeded only if the code starts with 2 AND the size is above zero.** A 200 with an empty body is a
  failure wearing a success's status.

## The curl line that worked

    curl -sS -L -m 45 --compressed -A <UA> -H "Accept-Language: en-US,en;q=0.9" \\
         -o <file> -w "%{http_code}\\t%{size_download}\\t%{content_type}\\t%{url_effective}" <URL>

- **-L follows redirects, and the last -w field is where you actually landed.** Record that URL in the manifest, not
  the one you asked for: it is the string a reader can open.
- **--compressed** halves the time and the bytes for the same document.
- One line per fetch to stderr (code, size, name, path), so progress is visible in a log without parsing the manifest.
- Where a site publishes an access policy, use the User-Agent it asks for rather than a browser string — see
  myagent-source-registry.

## Read the two halves together

This skill and myagent-source-registry are one method split in two: fetching appends the row, the registry reads it
back. Doing the first without the second leaves a directory of files and no way to answer "which page said that".
`

/** Every skill this bundle contributes, in the order a worker is most likely to need them. */
export const SKILLS = [
  {
    name: 'myagent-html-to-text',
    description: 'Convert saved HTML into readable plain text with the Python standard library alone, keeping table cells separable and dropping navigation, script and style.',
    whenToUse: 'After fetching pages to disk, before reading or quoting them; and whenever a page needs to become text you can grep, split or cite.',
    content: HTML_TO_TEXT,
  },
  {
    name: 'myagent-source-registry',
    description: 'Record every fetched source in a manifest as you fetch it, then build a registry that separates captured from failed and primary from secondary, so each claim can be checked against a named source retrieved at a named time.',
    whenToUse: 'Whenever work depends on more than a couple of external sources, and especially before writing conclusions another Ticket or a person will have to verify.',
    content: SOURCE_REGISTRY,
  },
  {
    name: 'myagent-polite-fetch',
    description: 'Batch-fetch hundreds of pages without being blocked and without losing the record when the run dies: the spacing, retry set and two-layer timeouts that two real runs survived with, plus the curl line that produced them.',
    whenToUse: 'Before fetching more than a handful of pages, and always before writing a fetching loop from scratch — a burst looks like a scraper and a steady trickle looks like a reader.',
    content: POLITE_FETCH,
  },
] as const

/**
 * Contribute myagent's skills to the host's catalog, and return the function that takes them back.
 *
 * A single exported function rather than inline registration in `apply`, so a test can hand it a two-method fake and
 * assert what was registered — otherwise the only way to observe it is to mount the whole bundle, and an assertion
 * nobody can write is an assertion nobody writes.
 */
export interface DynamicSkillsSource {
  skills(): readonly { name: string; title: string; description: string; content: string; enabled: boolean }[]
  onChange(listener: () => void): () => void
}

export function registerSkills(skills: SkillsPort, dynamic?: DynamicSkillsSource): () => void {
  const builtInRelease = SKILLS.map(skill => skills.register({ ...skill, source: 'runtime' }))
  let dynamicRelease: (() => void)[] = []
  const syncDynamic = (): void => {
    for (const off of [...dynamicRelease].reverse()) {
      try { off() } catch { /* ignore */ }
    }
    dynamicRelease = []
    if (dynamic === undefined) return
    for (const item of dynamic.skills()) {
      if (!item.enabled) continue
      try {
        dynamicRelease.push(skills.register({
          name: item.name,
          description: `${item.title} — ${item.description}`,
          whenToUse: item.description,
          source: 'runtime',
          content: item.content,
        }))
      } catch {
        // If a skill name is already registered or invalid, skip without breaking built-in skills.
      }
    }
  }
  syncDynamic()
  const unsub = dynamic?.onChange(syncDynamic)
  return () => {
    unsub?.()
    for (const off of [...dynamicRelease].reverse()) {
      try { off() } catch { /* ignore */ }
    }
    for (const off of [...builtInRelease].reverse()) off()
  }
}
