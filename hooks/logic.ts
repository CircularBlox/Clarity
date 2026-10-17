// Pure helpers: no `$`, so tests import them directly.
import type { Activity, Alerts, FileChange, FontChoice, IconChoice, Ledger, PaletteChoice, PaletteName, PanelChoice, Prefs, Todo, ToolRun, TurnSummary } from '../types'

// What a tool does, for its colour: reading, searching, running, writing, the web, delegating.
export type Kind = 'read' | 'search' | 'run' | 'write' | 'web' | 'agent' | 'other'

export type Palette = {
  kinds: Record<Kind, string>
  text: string
  muted: string
  you: string
  youBg: string | undefined
  claude: string
  tool: string
  ok: string
  error: string
  warn: string
  rule: string
  accentBg: string | undefined
  /** Dark text on a coloured chip; undefined draws chips inverse instead. */
  chipText: string | undefined
  /** The toolbar's background. */
  barBg: string | undefined
}

// Hex chosen for at least 7:1 (text) and 4.5:1 (accents) against a near-black background.
const DARK: Palette = {
  kinds: { read: '#82AAFF', search: '#C3A6FF', run: '#FFB86C', write: '#A6E3A1', web: '#7DCFFF', agent: '#FF9AC1', other: '#A3ACBD' },
  text: '#E6E9EF',
  muted: '#A3ACBD',
  you: '#82AAFF',
  youBg: '#1B2233',
  claude: '#F0A875',
  tool: '#7FD6C2',
  ok: '#A6E3A1',
  error: '#FF8A9B',
  warn: '#F2C97D',
  rule: '#4A5263',
  accentBg: '#262B38',
  chipText: '#10131A',
  barBg: '#1F2430',
}

// As bright as a terminal goes: white text, saturated accents, no mid-greys.
const CONTRAST: Palette = {
  kinds: { read: '#5FB3FF', search: '#D69CFF', run: '#FFA640', write: '#7CFF7C', web: '#4DF0F0', agent: '#FF7AC8', other: '#D0D4DC' },
  text: '#FFFFFF',
  muted: '#D0D4DC',
  you: '#5FB3FF',
  youBg: '#0B2340',
  claude: '#FFB454',
  tool: '#4DF0D0',
  ok: '#7CFF7C',
  error: '#FF5C7A',
  warn: '#FFE066',
  rule: '#8A93A6',
  accentBg: '#1E2533',
  chipText: '#000000',
  barBg: '#141922',
}

// Okabe–Ito hues: told apart with any common colour-vision deficiency.
const COLORBLIND: Palette = {
  kinds: { read: '#56B4E9', search: '#CC79A7', run: '#E69F00', write: '#009E73', web: '#F0E442', agent: '#D55E00', other: '#B5B5B5' },
  text: '#EDEDED',
  muted: '#B5B5B5',
  you: '#56B4E9',
  youBg: '#13283A',
  claude: '#E69F00',
  tool: '#CC79A7',
  ok: '#009E73',
  error: '#D55E00',
  warn: '#F0E442',
  rule: '#5A5A5A',
  accentBg: '#262626',
  chipText: '#111111',
  barBg: '#1E1E1E',
}

// Theme keys only, so a light (or any custom) theme stays legible.
const THEME: Palette = {
  kinds: { read: 'suggestion', search: 'remember', run: 'warning', write: 'success', web: 'ide', agent: 'claude', other: 'inactive' },
  text: 'text',
  muted: 'inactive',
  you: 'suggestion',
  youBg: undefined,
  claude: 'claude',
  tool: 'permission',
  ok: 'success',
  error: 'error',
  warn: 'warning',
  rule: 'subtle',
  accentBg: undefined,
  chipText: undefined,
  barBg: undefined,
}

export const palettes: Record<PaletteName, Palette> = { dark: DARK, contrast: CONTRAST, colorblind: COLORBLIND, theme: THEME }

export function resolvePalette(choice: PaletteChoice, theme: string): PaletteName {
  if (choice !== 'auto') return choice
  // auto: our hex only where the person's theme is a dark one.
  return theme.startsWith('dark') ? 'dark' : 'theme'
}

type TraceLink = { readonly plugin: string; readonly tier: string }

const KINDS: Record<string, Kind> = {
  Read: 'read',
  NotebookRead: 'read',
  LSP: 'read',
  Grep: 'search',
  Glob: 'search',
  ToolSearch: 'search',
  Bash: 'run',
  Monitor: 'run',
  Edit: 'write',
  MultiEdit: 'write',
  Write: 'write',
  NotebookEdit: 'write',
  TodoWrite: 'write',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Skill: 'agent',
  Workflow: 'agent',
}

export function kindOf(tool: string): Kind {
  return KINDS[tool] ?? (tool.startsWith('mcp__') ? 'web' : 'other')
}

// The tools of a folded group as labels with counts, in first-seen order: `Read ×2`, `Grep`.
export function groupTools(calls: readonly { tool: string }[]): { tool: string; label: string }[] {
  const counts = new Map<string, number>()
  for (const call of calls) counts.set(call.tool, (counts.get(call.tool) ?? 0) + 1)
  return [...counts].map(([tool, n]) => ({ tool, label: n > 1 ? `${tool} ×${n}` : tool }))
}

// The tiers of plugins a person or their admin installs; `builtin` and
// `core` are Claude Code's own drawing, which clarity replaces rather than decorates.
const MOD_TIERS = new Set(['user', 'prepend', 'append'])

// The mod that drew a row beneath clarity, or null when Claude Code drew it (or nothing did).
// A trace ends at the link that answered itself, so its last entry is the one that drew.
export function drawnByMod(trace: readonly TraceLink[]): string | null {
  const last = trace[trace.length - 1]
  if (last === undefined || !MOD_TIERS.has(last.tier)) return null
  return last.plugin
}

// Below this the indents go; labels always stay, they are what tells rows apart.
export const NARROW = 60

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.slice(-2).join('/') || path
}

function field(input: unknown, key: string): string | undefined {
  if (input === null || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function shortPath(path: string): string {
  return basename(path)
}

// The one fact that identifies a call: its file, command, pattern or target.
export function describeInput(tool: string, input: unknown): string {
  const path = field(input, 'file_path') ?? field(input, 'notebook_path') ?? field(input, 'path')
  if (path !== undefined && tool !== 'Grep' && tool !== 'Glob') return basename(path)
  const first =
    field(input, 'command') ??
    field(input, 'pattern') ??
    field(input, 'query') ??
    field(input, 'url') ??
    field(input, 'description') ??
    field(input, 'skill') ??
    field(input, 'prompt')
  if (first !== undefined) return first.split('\n')[0] ?? ''
  if (input !== null && typeof input === 'object') {
    for (const value of Object.values(input)) {
      if (typeof value === 'string' && value.length > 0) return value.split('\n')[0] ?? ''
    }
  }
  return ''
}

export function editedPath(input: unknown): string | undefined {
  return field(input, 'file_path') ?? field(input, 'notebook_path')
}

const VERBS: Record<string, string> = {
  Bash: 'Running',
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing',
  Grep: 'Searching for',
  Glob: 'Finding',
  WebFetch: 'Fetching',
  WebSearch: 'Searching the web for',
  Agent: 'Delegating:',
  Skill: 'Using skill',
  TodoWrite: 'Updating the plan',
}

// `Running npm test`, `Editing src/app.ts`: what the spinner and the band say.
export function activityText(activity: Activity): string {
  switch (activity.phase) {
    case 'idle':
      return 'Ready'
    case 'thinking':
      return 'Thinking'
    case 'writing':
      return 'Writing'
    case 'compacting':
      return 'Compacting the conversation'
    case 'waiting':
      return 'Waiting for you'
    case 'tool': {
      const verb = VERBS[activity.tool] ?? `Using ${activity.tool}`
      return activity.detail === '' ? verb : `${verb} ${activity.detail}`
    }
  }
}

// Tools that stop and wait on the person.
export const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode'])

export const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

function countLines(text: string | undefined): number {
  return text === undefined || text === '' ? 0 : text.split('\n').length
}

// Lines in and out of one edit, from its input (an estimate: a rewrite counts whole).
export function editDelta(tool: string, input: unknown): { added: number; removed: number } {
  if (tool === 'Write') return { added: countLines(field(input, 'content')), removed: 0 }
  if (tool === 'MultiEdit' && input !== null && typeof input === 'object') {
    const edits = (input as { edits?: unknown }).edits
    if (Array.isArray(edits)) {
      return edits.reduce(
        (sum: { added: number; removed: number }, one: unknown) => ({
          added: sum.added + countLines(field(one, 'new_string')),
          removed: sum.removed + countLines(field(one, 'old_string')),
        }),
        { added: 0, removed: 0 },
      )
    }
  }
  return {
    added: countLines(field(input, 'new_string') ?? field(input, 'new_source')),
    removed: countLines(field(input, 'old_string')),
  }
}

export function recordEdit(ledger: Ledger, path: string, delta: { added: number; removed: number }): Ledger {
  const before = ledger.files[path] ?? { added: 0, removed: 0, edits: 0 }
  return {
    ...ledger,
    files: {
      ...ledger.files,
      [path]: { added: before.added + delta.added, removed: before.removed + delta.removed, edits: before.edits + 1 },
    },
  }
}

export function firstLine(text: unknown, room = 120): string {
  const s = typeof text === 'string' ? text : ''
  return clip((s.split('\n').find(line => line.trim() !== '') ?? '').trim(), room)
}

export type Attachment = { kind: 'file' | 'folder' | 'image' | 'paste'; name: string; detail: string }

// What a prompt brings along, read from its text: `@path` mentions (a trailing slash is a
// folder), pasted images (`[Image #1]`) and pasted text (`[Pasted text #1 +40 lines]`).
export function parseAttachments(text: string): Attachment[] {
  const found: Attachment[] = []
  const seen = new Set<string>()
  const add = (a: Attachment) => {
    const id = `${a.kind}:${a.name}:${a.detail}`
    if (!seen.has(id)) {
      seen.add(id)
      found.push(a)
    }
  }
  for (const m of text.matchAll(/(?:^|\s)@(?:"([^"]+)"|([^\s@]+))/g)) {
    const path = (m[1] ?? m[2] ?? '').replace(/[.,;:!?)]+$/, '')
    if (path === '') continue
    const isFolder = path.endsWith('/')
    const parts = path.replace(/\/$/, '').split('/')
    const name = parts.pop() ?? path
    add({ kind: isFolder ? 'folder' : 'file', name, detail: parts.slice(-2).join('/') })
  }
  for (const m of text.matchAll(/\[Image #(\d+)\]/g)) add({ kind: 'image', name: `Image ${m[1]}`, detail: '' })
  for (const m of text.matchAll(/\[Pasted text #(\d+)(?: \+(\d+) lines?)?\]/g)) {
    add({ kind: 'paste', name: `Pasted text ${m[1]}`, detail: m[2] === undefined ? '' : `${m[2]} lines` })
  }
  return found
}

export type Block = { kind: 'prose'; text: string } | { kind: 'code'; text: string; lang: string; body: string }

// A reply cut into paragraphs and fenced code blocks, so each can sit apart with room around it.
// A list or table stays whole: only a blank line ends a prose block.
export function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let prose: string[] = []
  const flush = () => {
    const text = prose.join('\n').trim()
    if (text !== '') blocks.push({ kind: 'prose', text })
    prose = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = /^(\s*)(```+|~~~+)(.*)$/.exec(line)
    if (fence !== null) {
      flush()
      const mark = fence[2] ?? '```'
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !(lines[j] ?? '').trim().startsWith(mark)) body.push(lines[j++] ?? '')
      const lang = (fence[3] ?? '').trim()
      blocks.push({ kind: 'code', lang, body: body.join('\n'), text: [line, ...body, mark].join('\n') })
      i = j
      continue
    }
    if (line.trim() === '') flush()
    else prose.push(line)
  }
  flush()
  return blocks
}

// Every fenced code block's body, joined, for the copy-code button.
export function codeBlocks(markdown: string): string {
  const blocks: string[] = []
  const re = /```[^\n]*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) blocks.push((m[1] ?? '').replace(/\n$/, ''))
  return blocks.join('\n\n')
}

export function clip(text: string, room: number): string {
  if (room <= 1) return ''
  return text.length <= room ? text : `${text.slice(0, room - 1)}…`
}

type CallLike = { tool: string; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

// `Read ×2 · Grep · Bash`, in first-seen order.
export function groupSummary(calls: readonly CallLike[]): string {
  const counts = new Map<string, number>()
  for (const call of calls) counts.set(call.tool, (counts.get(call.tool) ?? 0) + 1)
  return [...counts].map(([tool, n]) => (n > 1 ? `${tool} ×${n}` : tool)).join(' · ')
}

export type Status = 'running' | 'error' | 'interrupted' | 'ok'

export function statusOf(calls: readonly CallLike[]): Status {
  if (calls.some(call => call.isRunning)) return 'running'
  if (calls.some(call => call.isErrored)) return 'error'
  if (calls.some(call => call.isInterrupted)) return 'interrupted'
  return 'ok'
}

export const MARK: Record<Status, string> = { running: '…', error: '✗', interrupted: '⊘', ok: '✓' }

// Tools whose result is the point (a diff, a plan): their result stays in summary mode.
export const KEEP_RESULT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ExitPlanMode', 'TodoWrite', 'AskUserQuestion'])

export function lineCount(output: unknown): number {
  const text =
    typeof output === 'string'
      ? output
      : output !== null && typeof output === 'object'
        ? [field(output, 'stdout'), field(output, 'stderr')].filter(Boolean).join('\n')
        : ''
  return text.length === 0 ? 0 : text.trimEnd().split('\n').length
}

// `8.5k`, as the stock spinner counts tokens.
export function formatTokens(n: number): string {
  return n < 1000 ? String(Math.round(n)) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function nextOf<T extends string | number>(list: readonly T[], current: T): T {
  const at = list.indexOf(current)
  return list[(at + 1) % list.length] ?? list[0]!
}

export const PALETTES: readonly PaletteChoice[] = ['auto', 'dark', 'contrast', 'colorblind', 'theme']
export const ALERTS: readonly Alerts[] = ['notify', 'sound', 'both', 'off']
export const PANELS: readonly PanelChoice[] = ['auto', 'off']
// 80 is a comfortable reading measure; the menu cycles from it.
export const WIDTHS: readonly number[] = [80, 70, 100, 120, 0]
export const FONTS: readonly FontChoice[] = ['leave', 'readable', 'large']
export const ICONS: readonly IconChoice[] = ['unicode', 'ascii']

// The editor terminal settings each font choice writes. JetBrains Mono first, Menlo where it
// is not installed; ligatures off so `!=` and `->` read as typed.
const FONT_KEYS: Record<Exclude<FontChoice, 'leave'>, Record<string, unknown>> = {
  readable: {
    'terminal.integrated.fontFamily': "'JetBrains Mono', Menlo, monospace",
    'terminal.integrated.fontSize': 13,
    'terminal.integrated.lineHeight': 1.3,
    'terminal.integrated.fontWeightBold': 'bold',
    'terminal.integrated.fontLigatures.enabled': false,
    'terminal.integrated.smoothScrolling': true,
  },
  large: {
    'terminal.integrated.fontFamily': "'JetBrains Mono', Menlo, monospace",
    'terminal.integrated.fontSize': 14,
    'terminal.integrated.lineHeight': 1.35,
    'terminal.integrated.fontWeightBold': 'bold',
    'terminal.integrated.fontLigatures.enabled': false,
    'terminal.integrated.smoothScrolling': true,
  },
}
const FONT_KEY_NAMES = Object.keys(FONT_KEYS.readable)

// Where the editor that hosts this terminal keeps its settings, from its environment.
export function editorSettingsPath(env: { home?: string; termProgram?: string; askpass?: string; platform: 'mac' | 'linux' | 'other' }): string | null {
  if (env.home === undefined || env.termProgram !== 'vscode' || env.platform === 'other') return null
  const app = (env.askpass ?? '').includes('Cursor') ? 'Cursor' : 'Code'
  return env.platform === 'mac' ? `${env.home}/Library/Application Support/${app}/User/settings.json` : `${env.home}/.config/${app}/User/settings.json`
}

export type FontEdit = { text: string; isChanged: boolean } | { error: string }

// The editor's settings with clarity's font keys set (or, for `leave`, taken out). A file with
// comments or trailing commas is not plain JSON: it is left alone rather than rewritten.
export function applyFont(settingsText: string, choice: FontChoice): FontEdit {
  let settings: Record<string, unknown>
  try {
    const parsed: unknown = settingsText.trim() === '' ? {} : JSON.parse(settingsText)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'the settings file is not a JSON object' }
    settings = parsed as Record<string, unknown>
  } catch {
    return { error: 'the settings file has comments or trailing commas' }
  }
  const next: Record<string, unknown> = { ...settings }
  if (choice === 'leave') for (const key of FONT_KEY_NAMES) delete next[key]
  else Object.assign(next, FONT_KEYS[choice])
  const isChanged = JSON.stringify(next) !== JSON.stringify(settings)
  return { text: `${JSON.stringify(next, null, 4)}\n`, isChanged }
}

export type CommandResult = { prefs: Prefs; text: string; open?: 'menu' | 'panel' }

const HELP = '/clarity opens the menu · /clarity panel · on | off | focus | tools summary | tools full | status'

export function runCommand(args: string, prefs: Prefs): CommandResult {
  const [word, arg] = args.trim().toLowerCase().split(/\s+/)
  const verb = word || 'menu'
  switch (verb) {
    case 'menu':
      return { prefs, text: '', open: 'menu' }
    case 'panel':
      return { prefs, text: '', open: 'panel' }
    case 'on':
      return { prefs: { ...prefs, isOn: true }, text: 'on.' }
    case 'off':
      return { prefs: { ...prefs, isOn: false }, text: 'off: Claude Code draws everything as usual. /clarity on brings it back.' }
    case 'focus': {
      const isFocus = arg === 'on' ? true : arg === 'off' ? false : !prefs.isFocus
      return {
        prefs: { ...prefs, isOn: true, isFocus },
        text: isFocus ? 'Focus on: notices and successful tool output are hidden.' : 'Focus off.',
      }
    }
    case 'tools': {
      const tools = arg === 'full' ? 'full' : arg === 'summary' ? 'summary' : prefs.tools === 'full' ? 'summary' : 'full'
      return {
        prefs: { ...prefs, tools },
        text: tools === 'full' ? 'Tool rows are drawn in full.' : 'Tool rows are one line each; click one to open it.',
      }
    }
    case 'status':
      return { prefs, text: status(prefs) }
    default:
      return { prefs, text: HELP }
  }
}

export function status(prefs: Prefs): string {
  if (!prefs.isOn) return `off. ${HELP}`
  return `on · colours ${prefs.palette} · tools ${prefs.tools} · focus ${prefs.isFocus ? 'on' : 'off'} · band ${prefs.band ? 'on' : 'off'} · alerts ${prefs.alerts}. ${HELP}`
}

export const COMPANIONS = ['lively', 'face', 'off'] as const

export const DEFAULT_PREFS: Prefs = {
  isOn: true,
  isFocus: false,
  tools: 'summary',
  palette: 'auto',
  alerts: 'notify',
  band: true,
  panel: 'auto',
  measure: 80,
  copy: true,
  font: 'leave',
  icons: 'unicode',
  companion: 'lively',
}

function oneOf<T>(list: readonly T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback
}

export function readPrefs(stored: unknown): Prefs {
  if (stored === null || typeof stored !== 'object') return DEFAULT_PREFS
  const s = stored as Partial<Record<keyof Prefs, unknown>>
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    isOn: bool(s.isOn, DEFAULT_PREFS.isOn),
    isFocus: bool(s.isFocus, DEFAULT_PREFS.isFocus),
    tools: oneOf(['summary', 'full'] as const, s.tools, DEFAULT_PREFS.tools),
    palette: oneOf(PALETTES, s.palette, DEFAULT_PREFS.palette),
    alerts: oneOf(ALERTS, s.alerts, DEFAULT_PREFS.alerts),
    band: bool(s.band, DEFAULT_PREFS.band),
    panel: oneOf(PANELS, s.panel, DEFAULT_PREFS.panel),
    measure: oneOf(WIDTHS, s.measure, DEFAULT_PREFS.measure),
    copy: bool(s.copy, DEFAULT_PREFS.copy),
    font: oneOf(FONTS, s.font, DEFAULT_PREFS.font),
    icons: oneOf(ICONS, s.icons, DEFAULT_PREFS.icons),
    // An early beta kept this as on or off.
    companion: s.companion === true ? 'lively' : s.companion === false ? 'off' : oneOf(COMPANIONS, s.companion, DEFAULT_PREFS.companion),
  }
}

export const EMPTY_LEDGER: Ledger = {
  turns: [],
  prompts: [],
  files: {},
  errors: [],
  lastReply: '',
  context: null,
  cost: null,
  limit: null,
  stopped: null,
  todos: [],
  recent: [],
  agents: 0,
  summaries: {},
}

// Claude's plan, from a TodoWrite call's input; anything malformed is left out.
export function parseTodos(input: unknown): Todo[] | null {
  const todos = input !== null && typeof input === 'object' ? (input as { todos?: unknown }).todos : undefined
  if (!Array.isArray(todos)) return null
  return todos.flatMap((t: unknown): Todo[] => {
    const content = field(t, 'content')
    const status = field(t, 'status')
    if (content === undefined || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) return []
    return [{ content, status, activeForm: field(t, 'activeForm') ?? content }]
  })
}

// `task 2/5`: the step Claude is on, counted from one.
export function planProgress(todos: readonly Todo[]): { at: number; of: number; doing: string } | null {
  const doing = todos.findIndex(t => t.status === 'in_progress')
  if (todos.length === 0 || doing < 0) return null
  return { at: doing + 1, of: todos.length, doing: todos[doing]?.activeForm ?? '' }
}

export type TurnSnapshot = { tools: number; errors: number; files: Record<string, FileChange> }

// What a turn did: the difference between the session before it and after it.
export function summarizeTurn(before: TurnSnapshot, after: TurnSnapshot): TurnSummary {
  let files = 0
  let added = 0
  let removed = 0
  for (const [path, change] of Object.entries(after.files)) {
    const was = before.files[path] ?? { added: 0, removed: 0, edits: 0 }
    if (change.edits > was.edits) files += 1
    added += change.added - was.added
    removed += change.removed - was.removed
  }
  return { tools: after.tools - before.tools, files, added, removed, failed: after.errors - before.errors }
}

export function runStatus(run: ToolRun): Status {
  return run.running > 0 ? 'running' : run.failed > 0 ? 'error' : 'ok'
}

// `5:07 pm`, for the Recent list.
export function formatClock(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
export const IDLE: Activity = { phase: 'idle', tool: '', detail: '', since: 0, tokens: 0 }

// State an earlier version of clarity wrote lacks the fields added since; a hot reload keeps
// it. Reading through these fills in what is missing, so old state never breaks a hook.
export function fillLedger(raw: unknown): Ledger {
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Ledger, unknown>>
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const record = <T>(v: unknown): Record<string, T> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {})
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    turns: list(r.turns),
    prompts: list(r.prompts),
    files: record(r.files),
    errors: list(r.errors),
    lastReply: typeof r.lastReply === 'string' ? r.lastReply : '',
    context: num(r.context),
    cost: num(r.cost),
    limit: readLimit(r.limit),
    stopped: typeof r.stopped === 'string' ? r.stopped : null,
    todos: list(r.todos),
    recent: list(r.recent),
    agents: num(r.agents) ?? 0,
    summaries: record(r.summaries),
  }
}

function readLimit(v: unknown): Ledger['limit'] {
  if (v === null || typeof v !== 'object') return null
  const r = v as { percent?: unknown; resetsAt?: unknown }
  if (typeof r.percent !== 'number') return null
  return { percent: r.percent, resetsAt: typeof r.resetsAt === 'string' ? r.resetsAt : null }
}

// The limit nearest to running out, from Claude Code's report of the plan's limits.
export function nearestLimit(limits: readonly { percentUsed: number; resetsAt?: string }[]): Ledger['limit'] {
  const top = [...limits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  return top === undefined ? null : { percent: top.percentUsed, resetsAt: top.resetsAt ?? null }
}

// Text over this many lines folds to its first lines until opened.
export const FOLD_REPLY = 30
export const FOLD_PROMPT = 12
export const FOLD_SHOWN = 12

// The first `shown` lines of a long text, with a code fence it cut open closed again so the
// rest still draws as prose. Null when the text is short enough to show whole.
export function foldText(text: string, over: number, shown = FOLD_SHOWN): { head: string; hidden: number } | null {
  const lines = text.split('\n')
  if (lines.length <= over) return null
  const kept = lines.slice(0, shown)
  const fences = kept.filter(line => /^\s*(```|~~~)/.test(line)).length
  return { head: kept.join('\n') + (fences % 2 === 1 ? '\n```' : ''), hidden: lines.length - shown }
}

export function fillActivity(raw: unknown): Activity {
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Partial<Activity>
  const phases = ['idle', 'thinking', 'writing', 'tool', 'waiting', 'compacting'] as const
  return {
    phase: phases.includes(r.phase as never) ? (r.phase as Activity['phase']) : 'idle',
    tool: typeof r.tool === 'string' ? r.tool : '',
    detail: typeof r.detail === 'string' ? r.detail : '',
    since: typeof r.since === 'number' ? r.since : 0,
    tokens: typeof r.tokens === 'number' ? r.tokens : 0,
  }
}

// Every symbol clarity draws, and its plain ASCII stand-in for terminals or fonts without it.
const ASCII: Record<string, string> = {
  '▸': '>', '▾': 'v', '▴': '^', '✓': '+', '✗': 'x', '●': '*', '⧉': '#', '▤': '#', '☰': '=',
  '━': '=', '─': '-', '│': '|', '↓': 'v', '…': '...', '⊘': '-', '▣': '#', '≡': '=', '○': 'o',
  '❯': '>', '▮': '|', '█': '#', '░': '.', '·': '-', '−': '-', '→': '->', '×': 'x', '⎿': '\\',
  '•': 'o', '‿': '_', '♥': '*', '♡': '.', '☁': '~', '☀': 'O', '☾': 'C', '⋆': '*', '♪': '~',
}
const ASCII_RE = new RegExp(`[${Object.keys(ASCII).join('')}]`, 'g')

export function toAscii(text: string): string {
  return text.replace(ASCII_RE, ch => ASCII[ch] ?? ch)
}

// Short tips the band shows, one at a time, while a turn runs long. Claude Code's own tips are
// not readable by a mod, so these are clarity's.
export const TIPS = [
  'Esc stops Claude at any point.',
  'Type @ in your prompt to add a file.',
  '/compact frees context when it runs high.',
  'Shift+Tab switches modes, like plan mode.',
  'Ctrl+O shows every tool call in full.',
  'Click a tool strip to open it.',
  '/clarity panel shows the plan and changed files.',
  '/clarity opens the settings.',
]

// The tip for this moment: a new one every 10 seconds, none in the first 6.
export function tipAt(elapsedMs: number): string | null {
  if (elapsedMs < 6000) return null
  return TIPS[Math.floor((elapsedMs - 6000) / 10_000) % TIPS.length] ?? null
}

// How long the panel's prompt list is before it folds.
export const PANEL_TURNS = 8

// The companion: a small face in the band that shows how things are going. Each face has two
// frames, swapped once a second while a turn runs, so it looks around, waves or works.
const FACES = {
  sleeping: ['(-.-)zz', '(-.-)zz'],
  content: ['(^‿^)', '(^‿^)'],
  thinking: ['(•.• )', '( •.•)'],
  writing: ['(•‿•)_', '(•‿•)/'],
  working: ['\\(•.•)', '(•.•)/'],
  waiting: ['(•.•)?', '(-.-)?'],
  tidying: ['(˘.˘)~', '(˘.˘) '],
  worried: ['(•.•;)', '(;•.•)'],
  stopped: ['(×_×)', '(×_×)'],
} as const

export type Mood = keyof typeof FACES

// What the companion feels: work and waiting first, then worry near a usage limit,
// and once idle for a while, sleep.
export function moodOf(activity: Activity, ledger: Ledger, isResting: boolean): Mood {
  const limit = ledger.limit?.percent ?? 0
  if (activity.phase === 'idle') {
    if (ledger.stopped !== null || limit >= 100) return 'stopped'
    return isResting ? 'sleeping' : 'content'
  }
  if (activity.phase === 'waiting') return 'waiting'
  if (activity.phase === 'compacting') return 'tidying'
  if (limit >= 80) return 'worried'
  if (activity.phase === 'thinking') return 'thinking'
  return activity.phase === 'tool' ? 'working' : 'writing'
}

export function faceOf(mood: Mood, frame: number): string {
  return FACES[mood][Math.abs(frame) % 2] ?? FACES[mood][0]
}

// After this long without a turn, the companion falls asleep.
export const REST_MS = 5 * 60_000

// What is left of a usage limit, as five hearts.
export function hearts(percentUsed: number): { full: string; empty: string } {
  const full = Math.max(0, Math.min(5, Math.ceil((100 - percentUsed) / 20)))
  return { full: '♥'.repeat(full), empty: '♡'.repeat(5 - full) }
}

// The panel's sky: clouds by day, stars by night, and the sun or moon at the end. The clouds
// drift a column a second while a turn runs, and the stars twinkle.
export function sky(width: number, hour: number, frame: number): { clouds: string; body: string } {
  const isNight = hour < 6 || hour >= 19
  const span = Math.max(4, width - 3)
  const row = Array.from({ length: span }, () => ' ')
  if (isNight) {
    for (let i = 0; i * 7 + 2 < span; i++) {
      const at = (i * 7 + 2 + (i % 2) * 3) % span
      row[at] = (i + frame) % 3 === 0 ? '⋆' : '·'
    }
  } else {
    const shapes = ['☁☁', '☁', '☁☁☁']
    shapes.forEach((shape, i) => {
      const start = (((Math.floor((i * span) / shapes.length) + frame) % span) + span) % span
      ;[...shape].forEach((ch, j) => {
        if (ch !== ' ') row[(start + j) % span] = ch
      })
    })
  }
  return { clouds: row.join(''), body: isNight ? '☾' : '☀' }
}

export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'good morning'
  if (hour >= 12 && hour < 17) return 'good afternoon'
  if (hour >= 17 && hour < 23) return 'good evening'
  return 'up late'
}

// Pip, the sprout who lives on clarity's boxes. It is drawn as pixel art: each grid is 8 pixels
// wide and 6 tall, and each terminal cell holds two pixels, one above the other (▀ ▄ █), so
// Pip stands 3 rows tall. `#` is its body, `e` its eyes, `b` its cheeks, `l` its leaf, `w` a
// drop of sweat and `.` nothing.
export type Pixel = 'body' | 'eye' | 'cheek' | 'leaf' | 'drop'
export type PipCell = { ch: string; fg: Pixel | null; bg: Pixel | null }
export type PipPose = { rows: PipCell[][]; x: number; bubble: string }

const PIXELS: Record<string, Pixel> = { '#': 'body', e: 'eye', b: 'cheek', l: 'leaf', w: 'drop' }

const PIP = {
  standing: ['...ll...', '..####..', '.#e##e#.', '.#b##b#.', '..####..', '..#..#..'],
  stepping: ['...ll...', '..####..', '.#e##e#.', '.#b##b#.', '..####..', '.#....#.'],
  lookLeft: ['...ll...', '..####..', '.#e#e##.', '.#b##b#.', '..####..', '..#..#..'],
  lookRight: ['...ll...', '..####..', '.##e#e#.', '.#b##b#.', '..####..', '..#..#..'],
  blinking: ['...ll...', '..####..', '.######.', '.#b##b#.', '..####..', '..#..#..'],
  cheering: ['...ll...', '#.####.#', '##e##e##', '.#b##b#.', '..####..', '........'],
  worried: ['...ll...', '..####.w', '.#e##e#.', '.#b##b#.', '..####..', '..#..#..'],
  worried2: ['...ll...', '..####..', '.#e##e#w', '.#b##b#.', '..####..', '..#..#..'],
  sleeping: ['........', '........', '...ll...', '..####..', '.######.', '.#b##b#.'],
  belly: ['..#..#..', '..####..', '.#b##b#.', '.#e##e#.', '..####..', '...ll...'],
} as const

export type PipFace = keyof typeof PIP

// Pairs the pixel rows into cells. A cell with two different pixels draws the top one as the
// glyph and the bottom one as its background.
export function pipCells(grid: readonly string[], drop = 0): PipCell[][] {
  const px = [...Array.from({ length: drop }, () => '........'), ...grid].slice(0, 6)
  const cells: PipCell[][] = []
  for (let y = 0; y < 6; y += 2) {
    const top = px[y] ?? '........'
    const bottom = px[y + 1] ?? '........'
    const row: PipCell[] = []
    for (let x = 0; x < 8; x++) {
      const t = PIXELS[top[x] ?? '.'] ?? null
      const b = PIXELS[bottom[x] ?? '.'] ?? null
      if (t === null && b === null) row.push({ ch: ' ', fg: null, bg: null })
      else if (t === b) row.push({ ch: '█', fg: t, bg: null })
      else if (b === null) row.push({ ch: '▀', fg: t, bg: null })
      else if (t === null) row.push({ ch: '▄', fg: b, bg: null })
      else row.push({ ch: '▀', fg: t, bg: b })
    }
    cells.push(row)
  }
  return cells
}

// Where Pip is and what it does, for a mood, the second it is, and the room it has to walk in.
// It paces while Claude works, hops when Claude waits on you, and stays put otherwise; the
// spot it stopped at is where it rests, since the last tick keeps it there.
export function pipPose(mood: Mood, frame: number, span: number): PipPose {
  const room = Math.max(1, span - 9)
  const lap = frame % (2 * room)
  const paced = lap < room ? lap : 2 * room - lap
  const isRight = lap < room
  const at = (face: PipFace, x: number, bubble = '', drop = 0): PipPose => ({ rows: pipCells(PIP[face], drop), x, bubble })
  const odd = frame % 2 === 1
  switch (mood) {
    case 'working':
      return at(odd ? 'stepping' : isRight ? 'lookRight' : 'lookLeft', paced)
    case 'writing':
      return at(odd ? 'stepping' : 'standing', paced, odd ? '·' : '')
    case 'tidying':
      return at(odd ? 'stepping' : 'standing', paced, '~')
    case 'thinking':
      return at(odd ? 'lookRight' : 'lookLeft', paced, odd ? '°' : 'o')
    case 'waiting':
      return at(odd ? 'cheering' : 'standing', paced, '?', odd ? 0 : 1)
    case 'worried':
      return at(odd ? 'worried2' : 'worried', paced)
    case 'stopped':
      return at('belly', paced, '×')
    case 'content':
      return at(odd ? 'blinking' : 'cheering', paced, '♪')
    case 'sleeping':
      return at('sleeping', paced, odd ? 'z' : 'zz')
  }
}
