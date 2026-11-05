/**
 * Reading a Ticket's directory, for the panel.
 *
 * The point is that an operator never has to open a terminal to find out whether anything came out of a run: the files
 * are listed, a text file is shown, and anything else is handed over as a download. Everything here is bounded, because
 * a worker's directory is whatever a model decided to create — it may hold a dependency tree, a cache, or a very large
 * file, and the panel asks for this on a timer.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'

/** Directories that are never what the operator is looking for: dependencies and caches a worker may have made. */
const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache', '.ruff_cache'])
/** How many entries one listing returns, and how deep it goes. A worker that made more than this has a story of its own. */
const MAX_ENTRIES = 500
const MAX_DEPTH = 6
/** The largest file the panel will fetch at all; past this the operator opens it where it is. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024
/** Extensions shown inline as text. Everything else is offered as a download, because guessing a binary is a mess. */
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.csv', '.tsv', '.log', '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.htm',
  '.css', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.sql', '.xml', '.svg', '.tex', '.r', '.jl',
])

export interface FileEntry {
  /** The path relative to the Ticket's directory, which is what the report's `files` list uses. */
  readonly path: string
  readonly directory: boolean
  readonly size: number
  readonly mtime?: string
  readonly text: boolean
}

export interface FileListing {
  readonly files: readonly FileEntry[]
  /** True when the listing stopped early, so the panel says "at least this many" rather than lying about a total. */
  readonly truncated: boolean
  readonly count: number
}

/** Whether a file of this name and size is worth showing inline. */
export function isTextFile(name: string, size: number): boolean {
  return TEXT_EXTENSIONS.has(extname(name).toLowerCase()) && size <= MAX_FILE_BYTES
}

/**
 * Resolve a path a person asked for inside `root`, refusing anything that reaches outside it.
 *
 * The panel only ever sends what the listing gave it, but the route is reachable by anything that can make a
 * same-origin request, and a `../` in a query string is the ordinary way a file route becomes a way out of a directory.
 * @returns the absolute path, or `undefined` when it is not inside `root`.
 */
export function resolveInside(root: string, requested: string): string | undefined {
  const absolute = resolve(root, requested)
  const base = resolve(root)
  return absolute === base || absolute.startsWith(base + sep) ? absolute : undefined
}

/** List a Ticket's directory, sorted by path, bounded by {@link MAX_ENTRIES} and {@link MAX_DEPTH}. */
export async function listFiles(root: string): Promise<FileListing> {
  const files: FileEntry[] = []
  let truncated = false
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) { truncated = true; return }
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    entries.sort((one, other) => one.name.localeCompare(other.name))
    for (const entry of entries) {
      if (files.length >= MAX_ENTRIES) { truncated = true; return }
      if (SKIP.has(entry.name) || entry.name === '.DS_Store') continue
      const absolute = join(directory, entry.name)
      const path = relative(root, absolute)
      if (entry.isDirectory()) {
        files.push({ path, directory: true, size: 0, text: false })
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      let info
      try { info = await stat(absolute) } catch { continue }
      files.push({
        path, directory: false, size: info.size, text: isTextFile(entry.name, info.size),
        mtime: new Date(info.mtimeMs).toISOString(),
      })
    }
  }
  await walk(root, 1)
  return { files, truncated, count: files.filter(file => !file.directory).length }
}

/** One file's bytes as base64, which the panel turns into text or a download. */
export async function readForPanel(absolute: string): Promise<{ base64: string; size: number; mtime: string }> {
  const info = await stat(absolute)
  const bytes = await readFile(absolute)
  return { base64: bytes.toString('base64'), size: info.size, mtime: new Date(info.mtimeMs).toISOString() }
}
