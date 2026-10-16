import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { Activity, Env, FontChoice, Ledger, Prefs, RunPlace, ToolRun } from '../types'
import {
  ALERTS,
  ASKS,
  FONTS,
  DEFAULT_PREFS,
  EDITS,
  FOLD_PROMPT,
  FOLD_REPLY,
  EMPTY_LEDGER,
  IDLE,
  KEEP_RESULT,
  NARROW,
  PALETTES,
  PANELS,
  WIDTHS,
  activityText,
  applyFont,
  clip,
  describeInput,
  drawnByMod,
  editDelta,
  editedPath,
  editorSettingsPath,
  nearestLimit,
  fillActivity,
  fillLedger,
  firstLine,
  foldText,
  groupTools,
  lineCount,
  palettes,
  parseAttachments,
  parseTodos,
  readPrefs,
  recordEdit,
  resolvePalette,
  runCommand,
  runStatus,
  splitBlocks,
  statusOf,
  summarizeTurn,
} from './logic'
import type { Status, TurnSnapshot } from './logic'
import {
  badge,
  band,
  card,
  failHeader,
  attachmentCards,
  awayCard,
  menu,
  openedRow,
  panel,
  questionBanner,
  replyBlocks,
  replyBox,
  toolLine,
  turnRule,
  userRow,
} from './rows'
import type { Chip, Look, MenuSection, ToolParts, UI } from './rows'

const prefsAtom = atom({ plugin: 'clarity', key: 'prefs' } as const, DEFAULT_PREFS)
const envAtom = atom({ plugin: 'clarity', key: 'env' } as const, { theme: 'dark' } as Env)
const tickAtom = atom({ plugin: 'clarity', key: 'tick' } as const, 0)
const activityAtom = atom({ plugin: 'clarity', key: 'activity' } as const, IDLE)
const ledgerAtom = atom({ plugin: 'clarity', key: 'ledger' } as const, EMPTY_LEDGER)
const expandedAtom = atom({ plugin: 'clarity', key: 'expanded' } as const, false)
const runsAtom = atom({ plugin: 'clarity', key: 'runs' } as const, null as ToolRun | null)
const placesAtom = atom({ plugin: 'clarity', key: 'places' } as const, null as RunPlace | null)

// Every read and write of the session's state goes through these, which fill in fields an
// older clarity never wrote.
async function readLedger($: EngineInterface): Promise<Ledger> {
  return fillLedger(await read($, ledgerAtom))
}

function editLedger($: EngineInterface, fn: (ledger: Ledger) => Ledger) {
  return update($, ledgerAtom, raw => fn(fillLedger(raw)))
}

async function readActivity($: EngineInterface): Promise<Activity> {
  return fillActivity(await read($, activityAtom))
}

function editActivity($: EngineInterface, fn: (activity: Activity) => Activity) {
  return update($, activityAtom, raw => fn(fillActivity(raw)))
}

const STORE_KEY = 'prefs'
const MENU = 'clarity-menu'
const PANEL = 'clarity-session'
// Below this many columns a docked pane is squeezing the transcript.
const CRAMPED = 70
// A turn longer than this raises the "done" alert.
const LONG_TURN_MS = 45_000
// A reply block at least this many lines tall gets a copy button.
const COPY_LINES = 4

let hasWarnedCramped = false
// Ticks the band's timer while a turn runs.
let ticker: ReturnType<EngineInterface['clock']['every']> | undefined
// The run the next tool call joins: set by a call, ended by any text the model writes.
let currentRun: string | null = null
// Tool calls this session, and the session as the running turn found it.
let toolCount = 0
let turnStart: TurnSnapshot | null = null

// What a render hook needs, or null when clarity should hand the row back.
async function look($: EngineInterface, e: RenderInput): Promise<Look | null> {
  if (e.surface !== 'terminal') return null
  const prefs = await read($, prefsAtom)
  if (!prefs.isOn) return null
  const env = await read($, envAtom)
  const columns = e.viewport?.columns ?? 100
  if (columns < CRAMPED && !hasWarnedCramped) {
    hasWarnedCramped = true
    $.ui.toast(
      `clarity: only ${columns} columns to draw in. Move the terminal into the editor area, or close a side pane, for easier reading.`,
    )
  }
  return { prefs, colors: palettes[resolvePalette(prefs.palette, env.theme)], columns, isNarrow: columns < NARROW }
}

function elements($: EngineInterface, e: RenderInput): UI {
  // look() has already returned null off the terminal.
  return $.ui.resolve(e) as unknown as UI
}

// Writes the prefs, keeps them for later sessions and redraws every row clarity draws.
async function savePrefs($: EngineInterface, prefs: Prefs) {
  await update($, prefsAtom, () => prefs)
  await $.store.set(STORE_KEY, prefs)
  $.ui.invalidate('ui.render')
}

// The settings button: opens the menu, or closes it when it is already showing.
async function toggleMenu($: EngineInterface) {
  const isOpen = (await $.ui.panes()).some(pane => pane.id === MENU && pane.isShown)
  if (isOpen) await $.ui.close({ id: MENU }).catch(() => undefined)
  else await openMenu($)
}

function openMenu($: EngineInterface) {
  return $.ui.open({ id: MENU, title: 'clarity', focus: true, closeOnEscape: true, rows: 52 })
}

// Unasked (at start) it waits for room; asked (a press, a command) it opens at any width and
// comes to the front, so the button never seems to do nothing.
function openPanel($: EngineInterface, isAsked = true) {
  return isAsked ? $.ui.open({ id: PANEL, title: 'Session', focus: true }) : $.ui.open({ id: PANEL, title: 'Session' })
}

// The terminal's own clipboard first; where it refuses (Cursor's terminal often does), the
// Mac's pasteboard.
function copyText($: EngineInterface, e: RenderInput, text: string) {
  void (async () => {
    const result = await $.ui.copy({ text, surface: e.surface }).catch(() => ({ isCopied: false }))
    if (result.isCopied) return $.ui.toast('Copied')
    const fallback = await $.process.run(['pbcopy'], { stdin: text }).catch(() => null)
    $.ui.toast(fallback !== null && fallback.exitCode === 0 ? 'Copied' : 'Could not copy here')
  })()
}

// Sets the font of the editor this terminal runs in (Cursor, VS Code) to the person's choice.
// Asked (a pick in the menu), it says what it did; at session start it only keeps the editor
// in step, quietly unless something needs saying.
async function syncFont($: EngineInterface, choice: FontChoice, isAsked: boolean) {
  const home = await $.env.get('HOME')
  const path = editorSettingsPath({
    home,
    termProgram: await $.env.get('TERM_PROGRAM'),
    askpass: await $.env.get('VSCODE_GIT_ASKPASS_MAIN'),
    platform: home?.startsWith('/Users/') ? 'mac' : home?.startsWith('/home/') ? 'linux' : 'other',
  })
  if (path === null) {
    if (isAsked) $.ui.toast('clarity: this terminal is not Cursor or VS Code, so set its font in its own settings.')
    return
  }
  const before = await $.fs.read(path).catch(() => '')
  const edit = applyFont(typeof before === 'string' ? before : '', choice)
  if ('error' in edit) {
    if (isAsked) $.ui.toast(`clarity: left the font alone: ${edit.error}.`)
    return
  }
  if (!edit.isChanged) {
    if (isAsked) $.ui.toast(choice === 'leave' ? 'clarity: the font is yours again.' : 'clarity: the font is already set.')
    return
  }
  await $.fs.write(path, edit.text)
  if (choice === 'leave') {
    if (isAsked) $.ui.toast('clarity: took its font settings out; your editor\'s own font is back.')
    return
  }
  const fonts = home === undefined ? '' : (await $.process.run(['ls', `${home}/Library/Fonts`]).catch(() => null))?.stdout ?? ''
  const hasFont = /JetBrainsMono/i.test(fonts)
  $.ui.toast(
    hasFont
      ? 'clarity: terminal font set. Quit and reopen the editor if any letters look out of line.'
      : 'clarity: font set, using Menlo until JetBrains Mono is installed: brew install --cask font-jetbrains-mono',
  )
}

async function alert($: EngineInterface, text: string) {
  const { alerts } = await read($, prefsAtom)
  if (alerts === 'notify' || alerts === 'both') {
    await $.ui.notify(text, { title: 'Claude Code' }).catch(() => undefined)
  }
  if (alerts === 'sound' || alerts === 'both') {
    await $.audio.play({ asset: 'assets/chime.wav' }).catch(() => undefined)
  }
}

async function refreshContext($: EngineInterface) {
  try {
    const usage = await $.session.usage()
    const percent = usage.context.percent ?? (usage.context.tokens !== undefined ? (usage.context.tokens / usage.context.window) * 100 : null)
    await editLedger($, ledger => ({ ...ledger, context: percent, cost: usage.cost?.usd ?? ledger.cost, limit: nearestLimit(usage.rateLimits) }))
  } catch {
    // No usage to read here (a test, a headless run): the band leaves context out.
  }
}

type RunView = { run: ToolRun; place: RunPlace; isOpen: boolean; toggle: () => void }

// The run a row belongs to, when it is one of several calls made back to back.
async function runOf($: EngineInterface, id: string | undefined): Promise<RunView | null> {
  if (id === undefined) return null
  const place = await read($, memberOf(placesAtom, { requestId: id }))
  if (place === null) return null
  const run = await read($, memberOf(runsAtom, { requestId: place.run }))
  if (run === null || run.ids.length < 2) return null
  const open = memberOf(expandedAtom, { requestId: place.run })
  return { run, place, isOpen: await read($, open), toggle: () => void update($, open, v => !v) }
}

// ` 5 tools  [Bash ×2] [Edit] [Read ×2]  ✓ `: a run as one strip.
function runLine(ui: UI, look: Look, view: RunView): RenderElement {
  return toolLine(
    ui,
    look,
    {
      tools: groupTools(view.run.tools.map(tool => ({ tool }))),
      detail: `${view.run.ids.length} tools`,
      status: runStatus(view.run),
      isOpen: view.isOpen,
    },
    view.toggle,
  )
}

// A row in a run: the first draws the run's strip, the rest stay folded into it until it is
// opened; a failure always shows.
function inRun(ui: UI, look: Look, view: RunView, own: RenderElement, failure: RenderElement | null): RenderElement {
  const { Box } = ui
  if (!view.isOpen) {
    if (view.place.index > 0) return failure ?? <Box />
    return failure === null ? (
      runLine(ui, look, view)
    ) : (
      <Box flexDirection="column">
        {runLine(ui, look, view)}
        {failure}
      </Box>
    )
  }
  return view.place.index === 0 ? (
    <Box flexDirection="column">
      {runLine(ui, look, view)}
      {indent(ui, look, own)}
    </Box>
  ) : (
    indent(ui, look, own)
  )
}

function indent(ui: UI, look: Look, body: RenderElement): RenderElement {
  return <ui.Box paddingLeft={look.isNarrow ? 0 : 2}>{body}</ui.Box>
}

export const register: Register = on => {
  hasWarnedCramped = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clarity',
      description: 'Readable transcript: opens the clarity menu (or: panel, on, off, focus, tools, status)',
      argumentHint: '[panel | on | off | focus | tools summary | tools full | status]',
    })
    const prefs = readPrefs(await $.store.get(STORE_KEY))
    // An older clarity pinned a status line; nothing here sets one now.
    $.ui.status(undefined)
    let theme = 'dark'
    try {
      const value = (await $.config.list()).find(row => row.key === 'theme')?.value
      if (typeof value === 'string') theme = value
    } catch {
      // No /config here: the dark default stands.
    }
    await update($, prefsAtom, () => prefs)
    await update($, envAtom, () => ({ theme }))
    await refreshContext($)
    // Opened unasked, the pane waits until the terminal is wide enough to dock it.
    if (prefs.isOn && prefs.panel === 'auto') void openPanel($, false)
    if (prefs.font !== 'leave') void syncFont($, prefs.font, false).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'clarity' }, async ($, e) => {
    const result = runCommand(e.args, await read($, prefsAtom))
    if (result.open === 'menu') {
      await openMenu($)
      return {}
    }
    if (result.open === 'panel') {
      await openPanel($)
      return {}
    }
    await savePrefs($, result.prefs)
    return { text: result.text }
  })

  // --- What the session is doing, for the band, the panel, the spinner and the alerts ---

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' && e.command === undefined && e.isMeta !== true && e.text.trim() !== '') {
      const text = firstLine(e.text, 200)
      const whole = e.text.slice(0, 4000)
      await editLedger($, ledger => ({
        ...ledger,
        turns: [...ledger.turns, text].slice(-200),
        prompts: [...ledger.prompts, whole].slice(-200),
      }))
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await editActivity($, (): Activity => ({ phase: 'thinking', tool: '', detail: '', since: now, tokens: 0 }))
      await update($, tickAtom, () => now)
      const ledger = await readLedger($)
      turnStart = { tools: toolCount, errors: ledger.errors.length, files: ledger.files }
      currentRun = null
      ticker?.cancel()
      ticker = $.clock.every(1000, () => void $.clock.now().then(t => update($, tickAtom, () => t)))
    }
    return next(e)
  })

  // The model's output as it streams: whether it is thinking or writing, and how many tokens
  // so far (four characters a token while it streams, the exact count when each step ends).
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    const isMain = e.agentId === undefined
    const base = isMain ? await readActivity($).then(a => a.tokens, () => 0) : 0
    let chars = 0
    let shown = 0
    let phase: Activity['phase'] = 'thinking'
    for (;;) {
      const step = await stream.next()
      if (step.done === true) return step.value
      const chunk = step.value
      // Counting never stands in the stream's way: a failure here leaves the chunk to pass.
      try {
        if (isMain && chunk.kind === 'text') currentRun = null
        if (isMain && (chunk.kind === 'text' || chunk.kind === 'thinking')) {
          chars += chunk.text.length
          const now: Activity['phase'] = chunk.kind === 'text' ? 'writing' : 'thinking'
          const estimate = Math.round(chars / 4)
          if (estimate - shown >= 40 || now !== phase) {
            shown = estimate
            phase = now
            await editActivity($, (a): Activity => ({ ...a, phase: a.phase === 'tool' || a.phase === 'waiting' ? a.phase : now, tokens: base + estimate }))
          }
        } else if (isMain && chunk.kind === 'stop' && chunk.usage !== null) {
          const exact = base + chunk.usage.output_tokens
          await editActivity($, (a): Activity => ({ ...a, tokens: exact }))
        }
      } catch {
        // The band's count is a nicety; the model's output is not.
      }
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const tool = String(e.tool)
    const id = e.tool_use_id
    let runId: string | null = null
    if (isMain) {
      const isAsk = ASKS.has(tool)
      await editActivity($, (a): Activity => ({ ...a, phase: isAsk ? 'waiting' : 'tool', tool, detail: describeInput(tool, e) }))
      if (isAsk) void alert($, 'Claude needs your answer')
      if (id !== undefined) {
        // Calls with no text between them join one run, keyed by its first call.
        runId = currentRun ?? id
        currentRun = runId
        const run = (await read($, memberOf(runsAtom, { requestId: runId }))) ?? { ids: [], tools: [], running: 0, failed: 0 }
        const joined: ToolRun = { ...run, ids: [...run.ids, id], tools: [...run.tools, tool], running: run.running + 1 }
        await update($, memberOf(runsAtom, { requestId: runId }), () => joined)
        await update($, memberOf(placesAtom, { requestId: id }), () => ({ run: runId ?? id, index: joined.ids.length - 1 }))
      }
      const todos = tool === 'TodoWrite' ? parseTodos(e) : null
      await editLedger($, ledger => ({
        ...ledger,
        ...(todos === null ? {} : { todos }),
        agents: ledger.agents + (tool === 'Agent' ? 1 : 0),
      }))
    }
    const ran = await next(e)
    toolCount += 1
    const isError = ran.deny === undefined && ran.isError === true
    if (ran.deny === undefined) {
      const path = editedPath(e)
      if (isError) {
        const failure = { tool, detail: describeInput(tool, e), text: firstLine(ran.text) }
        await editLedger($, ledger => ({ ...ledger, errors: [...ledger.errors, failure].slice(-50) }))
      } else if (EDITS.has(tool) && path !== undefined) {
        await editLedger($, ledger => recordEdit(ledger, path, editDelta(tool, e)))
      }
    }
    if (isMain) {
      if (runId !== null) {
        const finished = runId
        await update($, memberOf(runsAtom, { requestId: finished }), run =>
          run === null ? null : { ...run, running: Math.max(0, run.running - 1), failed: run.failed + (isError ? 1 : 0) },
        )
      }
      const at = await $.clock.now()
      const action = { at, tool, detail: describeInput(tool, e), isOk: !isError && ran.deny === undefined }
      await editLedger($, ledger => ({
        ...ledger,
        recent: [...ledger.recent, action].slice(-8),
        agents: Math.max(0, ledger.agents - (tool === 'Agent' ? 1 : 0)),
      }))
      await editActivity($, (a): Activity => ({ ...a, phase: 'thinking', tool: '', detail: '' }))
    }
    return ran
  })

  // Compaction: the band says it is happening and for how long, and a toast says what it freed.
  // A compaction worked out ahead of time, in the background, is left alone.
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute') return next(e)
    const now = await $.clock.now()
    const before = (await readLedger($)).context
    await editActivity($, (): Activity => ({ phase: 'compacting', tool: '', detail: '', since: now, tokens: 0 }))
    await update($, tickAtom, () => now)
    ticker?.cancel()
    ticker = $.clock.every(1000, () => void $.clock.now().then(t => update($, tickAtom, () => t)))
    try {
      return await next(e)
    } finally {
      ticker?.cancel()
      ticker = undefined
      await editActivity($, () => IDLE)
      await refreshContext($)
      const after = (await readLedger($)).context
      const took = Math.round(((await $.clock.now()) - now) / 1000)
      const freed = before !== null && after !== null ? ` · context ${Math.round(before)}% → ${Math.round(after)}%` : ''
      $.ui.toast(`clarity: compacted in ${took}s${freed}`)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const reply = 'answer' in e ? e.answer : ''
      ticker?.cancel()
      ticker = undefined
      await editActivity($, () => IDLE)
      const durationMs = 'durationMs' in e ? e.durationMs : 0
      const before = turnStart
      turnStart = null
      await editLedger($, (ledger): Ledger => {
        const summary = before !== null && durationMs > LONG_TURN_MS ? summarizeTurn(before, { tools: toolCount, errors: ledger.errors.length, files: ledger.files }) : null
        const kept = Object.entries(ledger.summaries).slice(-49)
        return {
          ...ledger,
          lastReply: reply,
          summaries: summary === null ? ledger.summaries : Object.fromEntries([...kept, [String(durationMs), summary]]),
        }
      })
      await refreshContext($)
      if ('durationMs' in e && e.durationMs > LONG_TURN_MS) void alert($, `Done: ${firstLine(reply, 100) || 'the turn finished'}`)
    }
    return result
  })

  // --- Panes: the menu and the session panel ---

  on('ui.render', { component: 'Pane', requestId: MENU }, async ($, e) => {
    const ui = $.ui.resolve(e)
    if (e.surface !== 'terminal') return <ui.Text>Open the clarity menu in the terminal.</ui.Text>
    const prefs = await read($, prefsAtom)
    const env = await read($, envAtom)
    const l: Look = {
      prefs,
      colors: palettes[resolvePalette(prefs.palette, env.theme)],
      columns: e.props.bodyColumns,
      isNarrow: e.props.bodyColumns < NARROW,
    }
    const save = (change: Partial<Prefs>) => void savePrefs($, { ...prefs, ...change })
    const onOff = [
      { value: 'on', label: 'on' },
      { value: 'off', label: 'off' },
    ]
    const flag = (v: boolean) => (v ? 'on' : 'off')
    const choices = (values: readonly (string | number)[], label = (v: string | number) => String(v)) =>
      values.map(v => ({ value: String(v), label: label(v) }))
    const sections: MenuSection[] = [
      {
        title: 'General',
        tone: l.colors.claude,
        settings: [
          { key: 'on', hotkey: '1', label: 'clarity', hint: 'Turn it off for regular Claude Code.', options: onOff, current: flag(prefs.isOn), pick: v => save({ isOn: v === 'on' }) },
          { key: 'focus', hotkey: '2', label: 'focus', hint: 'Hides startup notices and tool output that worked.', options: onOff, current: flag(prefs.isFocus), pick: v => save({ isOn: true, isFocus: v === 'on' }) },
        ],
      },
      {
        title: 'Look',
        tone: l.colors.you,
        settings: [
          { key: 'palette', hotkey: '3', label: 'colours', hint: 'Auto matches your Claude Code theme.', options: choices(PALETTES), current: prefs.palette, pick: v => save({ palette: v as Prefs['palette'] }) },
          { key: 'width', hotkey: '4', label: 'line width', hint: 'How wide replies get before they wrap.', options: choices([...WIDTHS].sort((a, b) => (a || 999) - (b || 999)), v => (v === 0 ? 'full' : String(v))), current: String(prefs.measure), pick: v => save({ measure: Number(v) }) },
          {
            key: 'font',
            hotkey: 'f',
            label: 'terminal font',
            hint: 'Sets the editor terminal to JetBrains Mono, readable or large.',
            options: FONTS.map(f => ({ value: f, label: f })),
            current: prefs.font,
            pick: v => {
              const font = v as FontChoice
              save({ font })
              void syncFont($, font, true).catch(() => $.ui.toast('clarity: could not change the font here.'))
            },
          },
          {
            key: 'tools',
            hotkey: '5',
            label: 'tool rows',
            hint: 'Click any tool row to see its full output.',
            options: [
              { value: 'summary', label: 'one line' },
              { value: 'full', label: 'full' },
            ],
            current: prefs.tools,
            pick: v => save({ tools: v === 'full' ? 'full' : 'summary' }),
          },
        ],
      },
      {
        title: 'Layout',
        tone: l.colors.kinds.write,
        settings: [
          { key: 'band', hotkey: '6', label: 'status band', hint: 'The bar just above where you type.', options: onOff, current: flag(prefs.band), pick: v => save({ band: v === 'on' }) },
          {
            key: 'panel',
            hotkey: '7',
            label: 'session panel',
            hint: "Opens beside the chat when there's room.",
            options: [...choices(PANELS), { value: 'open', label: '▤ open now' }],
            current: prefs.panel,
            pick: v => {
              if (v === 'open') {
                void openPanel($)
                return
              }
              save({ panel: v === 'off' ? 'off' : 'auto' })
              if (v === 'auto') void openPanel($)
              else void $.ui.close({ id: PANEL }).catch(() => undefined)
            },
          },
        ],
      },
      {
        title: 'Behaviour',
        tone: l.colors.warn,
        settings: [
          { key: 'alerts', hotkey: '8', label: 'alerts', hint: 'A ping when Claude needs you or finishes a long task.', options: choices(ALERTS), current: prefs.alerts, pick: v => save({ alerts: v as Prefs['alerts'] }) },
          { key: 'copy', hotkey: '9', label: 'copy buttons', hint: 'Copy buttons under code and long replies.', options: onOff, current: flag(prefs.copy), pick: v => save({ copy: v === 'on' }) },
        ],
      },
    ]
    return menu(elements($, e), l, sections, [
      'Esc to close · /clarity panel to open the session panel',
      'Tip: clarity works best on its own. Turn off other mods that restyle the transcript (like skins) in /plugin.',
    ])
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const ui = $.ui.resolve(e)
    if (e.surface !== 'terminal') return <ui.Text>The session panel draws in the terminal.</ui.Text>
    const prefs = await read($, prefsAtom)
    const env = await read($, envAtom)
    const l: Look = { prefs, colors: palettes[resolvePalette(prefs.palette, env.theme)], columns: e.props.bodyColumns, isNarrow: false }
    const ledger = await readLedger($)
    return panel(elements($, e), l, await readActivity($), ledger, e.props.bodyColumns, {
      copyTurn: i => copyText($, e, ledger.prompts[i] ?? ledger.turns[i] ?? ''),
    })
  })

  // --- The band above the prompt ---

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const prefs = await read($, prefsAtom)
    if (!prefs.isOn || !prefs.band) return next(e)
    const below = await next(e)
    const env = await read($, envAtom)
    const l: Look = { prefs, colors: palettes[resolvePalette(prefs.palette, env.theme)], columns: e.props.bodyColumns, isNarrow: false }
    const ui = elements($, e)
    const ledger = await readLedger($)
    const activity = await readActivity($)
    const elapsed = activity.phase === 'idle' || activity.since === 0 ? 0 : Math.max(0, (await read($, tickAtom)) - activity.since)
    const ours = band(ui, l, activity, ledger, e.props.bodyColumns, { elapsedMs: elapsed, tokens: activity.tokens }, {
      panel: () => void openPanel($),
      menu: () => void toggleMenu($),
      copy: prefs.copy && ledger.lastReply !== '' ? () => copyText($, e, ledger.lastReply) : undefined,
    })
    // Another mod's band keeps its place under ours.
    return drawnByMod(next.trace) !== null && below !== undefined && below !== null ? (
      <ui.Box flexDirection="column">
        {ours}
        {below}
      </ui.Box>
    ) : (
      ours
    )
  })

  // --- The transcript ---

  // The person's prompt: a labelled, tinted block. Over another mod's row, the label alone.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null || e.props.origin.kind !== 'composer') return next(e)
    const below = await next(e)
    const ui = elements($, e)
    if (drawnByMod(next.trace) !== null) {
      return (
        <ui.Box flexDirection="column" marginTop={1}>
          {badge(ui, l.colors, ' you ', l.colors.you)}
          {below}
          {attachmentCards(ui, l, parseAttachments(e.props.text))}
        </ui.Box>
      )
    }
    // A long prompt (a paste, say) folds to its first lines until opened.
    const fold = foldText(e.props.text, FOLD_PROMPT)
    const open = memberOf(expandedAtom, e)
    const isOpen = fold !== null && (await read($, open))
    const more: Chip | undefined =
      fold === null
        ? undefined
        : { key: 'fold', label: isOpen ? '▴ show less' : `▾ show ${fold.hidden} more lines`, onPress: () => void update($, open, v => !v) }
    return userRow(ui, l, fold === null || isOpen ? e.props.text : fold.head, parseAttachments(e.props.text), more)
  })

  // A reply: each block in a soft frame, paragraphs spaced, code in its own copyable box.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null || e.props.isSummary === true) return next(e)
    const below = await next(e)
    const ui = elements($, e)
    const byMod = drawnByMod(next.trace) !== null
    const text = e.props.text
    const onCopy = l.prefs.copy ? (code: string) => copyText($, e, code) : undefined
    // A long reply folds to its first lines until opened (clarity's own drawing only).
    const fold = byMod ? null : foldText(text, FOLD_REPLY)
    const open = memberOf(expandedAtom, e)
    const isOpen = fold !== null && (await read($, open))
    const chips: Chip[] = [
      ...(fold === null
        ? []
        : [{ key: 'fold', label: isOpen ? '▴ show less' : `▾ show ${fold.hidden} more lines`, onPress: () => void update($, open, v => !v) }]),
      ...(l.prefs.copy && text.split('\n').length >= COPY_LINES
        ? [{ key: 'copy-reply', label: '⧉ copy reply', onPress: () => copyText($, e, text) }]
        : []),
    ]
    // Another mod sizes its own tables and cards to the width: leave it the whole of it.
    const boxLook = byMod ? { ...l, prefs: { ...l.prefs, measure: 0 } } : l
    const shown = fold === null || isOpen ? text : fold.head
    const body = byMod ? below : replyBlocks(ui, l, splitBlocks(shown), onCopy)
    return replyBox(ui, boxLook, e.props.isFirstOfReply, body, chips, !byMod)
  })

  // One tool call: one clickable line (an edit's line counts on it); a failure gets a red box.
  // Calls made back to back fold into one strip for the run until it is opened.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null) return next(e)
    const p = e.props
    const below = await next(e)
    const ui = elements($, e)
    if (drawnByMod(next.trace) !== null) return indent(ui, l, below)
    const detail = describeInput(p.tool, p.input)
    const failure = p.isErrored && !p.isInterrupted ? failHeader(ui, l, p.tool, detail, below) : null
    if (l.prefs.tools === 'full') return failure ?? below
    const open = memberOf(expandedAtom, e)
    const isOpen = await read($, open)
    const status: Status = p.isRunning ? 'running' : p.isInterrupted ? 'interrupted' : 'ok'
    const delta = EDITS.has(p.tool) ? editDelta(p.tool, p.input) : undefined
    const parts: ToolParts = { tools: [{ tool: p.tool, label: p.tool }], detail, status, ...(delta === undefined ? {} : { delta }) }
    const toggle = () => void update($, open, v => !v)
    const own = failure ?? (isOpen ? openedRow(ui, l, parts, toggle, below) : toolLine(ui, l, parts, toggle))
    const view = await runOf($, p.tool_use_id)
    return view === null ? own : inRun(ui, l, view, own, failure)
  })

  // A tool's output: shown when opened, for edits and errors; a line count for shell output.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null) return next(e)
    const p = e.props
    const below = await next(e)
    const ui = elements($, e)
    if (drawnByMod(next.trace) !== null) return indent(ui, l, below)
    if (l.prefs.tools === 'full' || p.isErrored) return below
    const view = await runOf($, p.tool_use_id)
    if (view !== null && !view.isOpen) return <ui.Box />
    if (KEEP_RESULT.has(p.tool)) return below
    if (await read($, memberOf(expandedAtom, e))) return indent(ui, l, below)
    if (p.tool !== 'Bash' || l.prefs.isFocus) return <ui.Box />
    const lines = lineCount(p.output)
    return (
      <ui.Box paddingLeft={l.isNarrow ? 2 : 4}>
        <ui.Text color={l.colors.muted}>{lines === 0 ? '⎿ no output' : `⎿ ${lines} line${lines === 1 ? '' : 's'} of output · click the row to see it`}</ui.Text>
      </ui.Box>
    )
  })

  // A folded run of reads and searches: one clickable line of tool names.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null || e.props.isExpanded) return next(e)
    const ui = elements($, e)
    if (l.prefs.tools === 'full') {
      const below = await next(e)
      return drawnByMod(next.trace) !== null ? indent(ui, l, below) : below
    }
    const calls = e.props.calls
    const status = statusOf(calls)
    const open = memberOf(expandedAtom, e)
    const isOpen = await read($, open)
    const first = calls[0]
    const parts: ToolParts = {
      tools: groupTools(calls),
      detail: calls.length === 1 && first !== undefined ? describeInput(first.tool, first.input) : '',
      status,
    }
    const toggle = () => void update($, open, v => !v)
    const view = await runOf($, first?.tool_use_id)
    if (isOpen || status === 'error') {
      const below = await next({ ...e, props: { ...e.props, isExpanded: true } })
      if (drawnByMod(next.trace) !== null) return indent(ui, l, below)
      const own = openedRow(ui, l, parts, toggle, below)
      return view === null ? own : inRun(ui, l, view, own, status === 'error' ? own : null)
    }
    const below = await next(e)
    if (drawnByMod(next.trace) !== null) return indent(ui, l, below)
    const own = toolLine(ui, l, parts, toggle)
    return view === null ? own : inRun(ui, l, view, own, null)
  })

  // The end of a turn: a rule, so turns read as blocks. Under another mod's footer, the rule alone.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null) return next(e)
    const below = await next(e)
    const ui = elements($, e)
    // A long turn closes with what it did, for whoever looked away while it ran.
    const summary = (await readLedger($)).summaries[String(e.props.durationMs)]
    const away = summary === undefined || summary.tools === 0 ? null : awayCard(ui, l, e.props.durationMs, summary)
    if (drawnByMod(next.trace) !== null) {
      return (
        <ui.Box flexDirection="column" marginBottom={1}>
          {away}
          {below}
          <ui.Text color={l.colors.rule}>{'─'.repeat(Math.max(10, l.columns - 2))}</ui.Text>
        </ui.Box>
      )
    }
    return away === null ? (
      turnRule(ui, l, e.props.durationMs)
    ) : (
      <ui.Box flexDirection="column">
        {away}
        {turnRule(ui, l, e.props.durationMs)}
      </ui.Box>
    )
  })

  // A slash command's output in a titled card.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null || e.props.text.trim() === '') return next(e)
    const below = await next(e)
    if (drawnByMod(next.trace) !== null) return below
    const ui = elements($, e)
    const title = `/${e.props.command}${e.props.args === '' ? '' : ` ${clip(e.props.args, 40)}`}`
    return card(ui, l, title, <ui.Markdown text={e.props.text} />, e.props.isErrored)
  })

  // A question for the person: a banner so it is never missed.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null) return next(e)
    return questionBanner(elements($, e), l, await next(e))
  })

  // While the band is on it is the one status line, with its own timer: the stock spinner
  // steps aside. With the band off, the spinner says what is happening.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null) return next(e)
    // Claude Code's own messages (compacting, retrying) always show; only the word steps aside.
    if (e.props.message !== null) return next(e)
    if (l.prefs.band) return elements($, e).Box({})
    const activity = await readActivity($)
    if (activity.phase !== 'tool' && activity.phase !== 'waiting') return next(e)
    return next({ ...e, props: { ...e.props, message: clip(activityText(activity), Math.max(20, l.columns - 40)) } })
  })

  // Startup notices: one short dim line, or none in focus mode.
  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    const l = await look($, e)
    if (l === null) return next(e)
    const ui = elements($, e)
    if (l.prefs.isFocus) return <ui.Box />
    const command = e.props.command === null ? '' : `  ${e.props.command}`
    return (
      <ui.Text color={l.colors.muted} wrap="truncate">
        · {e.props.text}
        {command}
      </ui.Text>
    )
  })
}
