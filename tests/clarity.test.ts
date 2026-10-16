import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  DEFAULT_PREFS,
  EMPTY_LEDGER,
  activityText,
  applyFont,
  codeBlocks,
  describeInput,
  drawnByMod,
  editorSettingsPath,
  editDelta,
  fillActivity,
  fillLedger,
  formatTokens,
  groupSummary,
  parseAttachments,
  parseTodos,
  planProgress,
  runStatus,
  summarizeTurn,
  readPrefs,
  recordEdit,
  resolvePalette,
  runCommand,
  splitBlocks,
  statusOf,
} from '../hooks/logic'

const call = (tool: string, extra: Partial<{ isRunning: boolean; isErrored: boolean }> = {}) => ({
  tool,
  input: { file_path: `/repo/src/${tool.toLowerCase()}.ts` },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  ...extra,
})

const VIEW = { columns: 120, rows: 40 }

// Stands in for Claude Code's own drawing of a component: a test's hooks sit in the
// builtin tier, which clarity redraws rather than decorates.
function engineDraws(on: On, component: 'ToolUse' | 'ToolResult' | 'ToolGroup' | 'UserMessage' | 'AbovePrompt' | 'CommandOutput', text: string) {
  // One matcher for several components: the union is wider than one matcher's type.
  on('ui.render', { component: component as 'ToolUse' }, ($, e) => $.ui.resolve(e).Text({ children: text }))
}

describe('logic', () => {
  test('a group reads as tool names with counts', async () => {
    expect(groupSummary([call('Read'), call('Grep'), call('Read')])).toBe('Read ×2 · Grep')
  })

  test('status prefers running, then error', async () => {
    expect(statusOf([call('Read'), call('Bash', { isErrored: true })])).toBe('error')
    expect(statusOf([call('Read', { isRunning: true }), call('Bash', { isErrored: true })])).toBe('running')
    expect(statusOf([call('Read')])).toBe('ok')
  })

  test('a call is described by its file, command or pattern', async () => {
    expect(describeInput('Read', { file_path: '/a/b/c/file.ts' })).toBe('c/file.ts')
    expect(describeInput('Bash', { command: 'npm test\necho done' })).toBe('npm test')
    expect(describeInput('Grep', { pattern: 'TODO', path: '/repo' })).toBe('TODO')
  })

  test('a row another mod drew is told apart from Claude Code’s own', async () => {
    expect(drawnByMod([{ plugin: 'some-mod', tier: 'user' }])).toBe('some-mod')
    expect(drawnByMod([{ plugin: 'some-mod', tier: 'user' }, { plugin: 'engine', tier: 'core' }])).toBe(null)
    expect(drawnByMod([{ plugin: 'engine', tier: 'core' }])).toBe(null)
    expect(drawnByMod([])).toBe(null)
  })

  test('the spinner and band say what is happening', async () => {
    expect(activityText({ phase: 'tool', tool: 'Bash', detail: 'npm test', since: 0, tokens: 0 })).toBe('Running npm test')
    expect(activityText({ phase: 'tool', tool: 'Edit', detail: 'src/app.ts', since: 0, tokens: 0 })).toBe('Editing src/app.ts')
    expect(activityText({ phase: 'waiting', tool: 'AskUserQuestion', detail: '', since: 0, tokens: 0 })).toBe('Waiting for you')
    expect(activityText({ phase: 'tool', tool: 'mcp__x', detail: '', since: 0, tokens: 0 })).toBe('Using mcp__x')
  })

  test('tokens read the way the stock spinner writes them', async () => {
    expect(formatTokens(640)).toBe('640')
    expect(formatTokens(8_480)).toBe('8.5k')
    expect(formatTokens(23_400)).toBe('23k')
    expect(activityText({ phase: 'writing', tool: '', detail: '', since: 0, tokens: 0 })).toBe('Writing')
  })

  test('the plan is read from TodoWrite, and the step in progress counted', async () => {
    const todos = parseTodos({
      todos: [
        { content: 'Read the server', status: 'completed', activeForm: 'Reading the server' },
        { content: 'Add the limiter', status: 'in_progress', activeForm: 'Adding the limiter' },
        { content: 'Run tests', status: 'pending', activeForm: 'Running tests' },
        { content: 'bad', status: 'weird' },
      ],
    })
    expect(todos?.length).toBe(3)
    expect(planProgress(todos ?? [])).toEqual({ at: 2, of: 3, doing: 'Adding the limiter' })
    expect(parseTodos({ nope: 1 })).toBe(null)
  })

  test('a turn summary is what changed between its start and end', async () => {
    const before = { tools: 4, errors: 1, files: { '/a.ts': { added: 2, removed: 0, edits: 1 } } }
    const after = { tools: 9, errors: 2, files: { '/a.ts': { added: 5, removed: 1, edits: 2 }, '/b.ts': { added: 3, removed: 0, edits: 1 } } }
    expect(summarizeTurn(before, after)).toEqual({ tools: 5, files: 2, added: 6, removed: 1, failed: 1 })
    expect(runStatus({ ids: ['a', 'b'], tools: ['Bash', 'Edit'], running: 0, failed: 1 })).toBe('error')
    expect(runStatus({ ids: ['a', 'b'], tools: ['Bash', 'Edit'], running: 1, failed: 1 })).toBe('running')
  })

  test('state an older clarity wrote is filled in, never trusted as whole', async () => {
    const old = { turns: ['hi'], files: {}, errors: [], lastReply: '', context: 41 }
    const ledger = fillLedger(old)
    expect(ledger.turns).toEqual(['hi'])
    expect(ledger.context).toBe(41)
    expect(ledger.recent).toEqual([])
    expect(ledger.summaries).toEqual({})
    expect(ledger.agents).toBe(0)
    expect(fillLedger(null)).toEqual(EMPTY_LEDGER)
    expect(fillActivity({ phase: 'tool', tool: 'Bash', detail: 'ls' })).toEqual({ phase: 'tool', tool: 'Bash', detail: 'ls', since: 0, tokens: 0 })
  })

  test('the font setting writes its keys, and leave takes out only those', async () => {
    const mine = '{\n    "git.autofetch": true,\n    "terminal.integrated.fontSize": 11\n}\n'
    const set = applyFont(mine, 'readable')
    if ('error' in set) throw new Error(set.error)
    const written = JSON.parse(set.text)
    expect(written['git.autofetch']).toBe(true)
    expect(written['terminal.integrated.fontSize']).toBe(13)
    expect(written['terminal.integrated.fontFamily']).toContain('JetBrains Mono')
    const again = applyFont(set.text, 'readable')
    expect('isChanged' in again && again.isChanged).toBe(false)
    const back = applyFont(set.text, 'leave')
    if ('error' in back) throw new Error(back.error)
    expect(JSON.parse(back.text)).toEqual({ 'git.autofetch': true })
    expect(applyFont('{ // mine\n}', 'large')).toEqual({ error: 'the settings file has comments or trailing commas' })
  })

  test('the editor is found from the terminal it runs in', async () => {
    const cursor = { home: '/Users/me', termProgram: 'vscode', askpass: '/Applications/Cursor.app/x.js', platform: 'mac' as const }
    expect(editorSettingsPath(cursor)).toBe('/Users/me/Library/Application Support/Cursor/User/settings.json')
    expect(editorSettingsPath({ ...cursor, askpass: '/Applications/Visual Studio Code.app/x.js' })).toBe('/Users/me/Library/Application Support/Code/User/settings.json')
    expect(editorSettingsPath({ ...cursor, home: '/home/me', platform: 'linux' })).toBe('/home/me/.config/Cursor/User/settings.json')
    expect(editorSettingsPath({ ...cursor, termProgram: 'iTerm.app' })).toBe(null)
  })

  test('a prompt’s files, folders, images and pasted text are found', async () => {
    const found = parseAttachments('look at @src/hooks/rows.tsx and @docs/ then [Image #1] and [Pasted text #2 +40 lines], mail me@x.com')
    expect(found).toEqual([
      { kind: 'file', name: 'rows.tsx', detail: 'src/hooks' },
      { kind: 'folder', name: 'docs', detail: '' },
      { kind: 'image', name: 'Image 1', detail: '' },
      { kind: 'paste', name: 'Pasted text 2', detail: '40 lines' },
    ])
    expect(parseAttachments('@"my file.md" twice @"my file.md"')).toEqual([{ kind: 'file', name: 'my file.md', detail: '' }])
  })

  test('edits add up per file', async () => {
    const delta = editDelta('Edit', { file_path: '/r/a.ts', old_string: 'a\nb', new_string: 'a\nb\nc' })
    expect(delta).toEqual({ added: 3, removed: 2 })
    const once = recordEdit(EMPTY_LEDGER, '/r/a.ts', delta)
    const twice = recordEdit(once, '/r/a.ts', { added: 1, removed: 0 })
    expect(twice.files['/r/a.ts']).toEqual({ added: 4, removed: 2, edits: 2 })
    expect(editDelta('Write', { content: 'x\ny' })).toEqual({ added: 2, removed: 0 })
  })

  test('code blocks are found for the copy button', async () => {
    expect(codeBlocks('hi\n```ts\nconst a = 1\n```\nand\n```\nb\n```')).toBe('const a = 1\n\nb')
    expect(codeBlocks('no code')).toBe('')
  })

  test('a reply splits into paragraphs and code blocks, lists kept whole', async () => {
    const blocks = splitBlocks('First para\nstill first.\n\n- a\n- b\n\n```ts\nconst x = 1\n\nconst y = 2\n```\nAfter.')
    expect(blocks.map(b => b.kind)).toEqual(['prose', 'prose', 'code', 'prose'])
    expect(blocks[0]?.text).toBe('First para\nstill first.')
    expect(blocks[1]?.text).toBe('- a\n- b')
    const code = blocks[2]
    expect(code?.kind === 'code' ? [code.lang, code.body] : null).toEqual(['ts', 'const x = 1\n\nconst y = 2'])
  })

  test('auto palette follows the theme', async () => {
    expect(resolvePalette('auto', 'dark')).toBe('dark')
    expect(resolvePalette('auto', 'light')).toBe('theme')
    expect(resolvePalette('colorblind', 'light')).toBe('colorblind')
  })

  test('stored prefs are read safely, old ones filled in', async () => {
    expect(readPrefs({ isOn: false, tools: 'full' })).toEqual({ ...DEFAULT_PREFS, isOn: false, tools: 'full' })
    expect(readPrefs({ palette: 'neon', measure: 7 })).toEqual(DEFAULT_PREFS)
  })

  test('/clarity words and the bare menu', async () => {
    expect(runCommand('', DEFAULT_PREFS).open).toBe('menu')
    expect(runCommand('panel', DEFAULT_PREFS).open).toBe('panel')
    expect(runCommand('off', DEFAULT_PREFS).prefs.isOn).toBe(false)
    expect(runCommand('focus', DEFAULT_PREFS).prefs.isFocus).toBe(true)
    expect(runCommand('tools full', DEFAULT_PREFS).prefs.tools).toBe('full')
  })
})

describe('transcript', () => {
  test('the prompt row is a labelled block', async ($, on) => {
    engineDraws(on, 'UserMessage', 'engine prompt')
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'UserMessage',
      viewport: VIEW,
      props: { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: false },
    })
    expect(await ui.find({ text: / you / })).toBeDefined()
    expect(await ui.find({ text: /fix the bug/ })).toBeDefined()
    expect(await ui.find({ text: /engine prompt/ })).toBeUndefined()
    await ui.unmount()
  })

  test('files a prompt brings along each get a framed card under it', async ($, on) => {
    engineDraws(on, 'UserMessage', 'engine prompt')
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'UserMessage',
      viewport: VIEW,
      props: { text: 'fix @src/app.ts using [Image #1]', origin: { kind: 'composer' }, isExpanded: false },
    })
    expect(await ui.find({ text: /▤ app\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /▣ Image 1/ })).toBeDefined()
    await ui.unmount()
  })

  test('a reply sits in a framed box with its code boxed apart', async ($, on) => {
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => $.ui.resolve(e).Text({ children: 'engine reply' }))
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'AssistantMessage',
      viewport: VIEW,
      props: { text: 'Here it is:\n\n```ts\nlimit(60)\n```\n\nDone.', isFirstOfReply: true },
    })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
    expect(await ui.find({ text: /● claude/ })).toBeDefined()
    expect(await ui.find({ text: / ts / })).toBeDefined()
    expect(await ui.find({ key: 'copy-code-1' })).toBeDefined()
    expect(await ui.find({ text: /engine reply/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a tool row is one line, and a click opens it in place', async ($, on) => {
    mock.store(on)
    engineDraws(on, 'ToolUse', 'engine row')
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'ToolUse',
      viewport: VIEW,
      props: { tool_use_id: 't1', tool: 'Read', input: { file_path: '/repo/src/app.ts' }, isRunning: false, isErrored: false, isInterrupted: false },
    })
    expect(await ui.find({ text: /▸ +Read +src\/app\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /engine row/ })).toBeUndefined()
    await ui.press({ key: 'row' })
    expect(await ui.find({ text: /▾ +Read/ })).toBeDefined()
    expect(await ui.find({ text: /engine row/ })).toBeDefined()
    await ui.press({ key: 'row' })
    expect(await ui.find({ text: /engine row/ })).toBeUndefined()
    await ui.unmount()
  })

  test('calls made back to back fold into one strip until it is opened', async ($, on) => {
    mock.store(on)
    mock.clock(on)
    on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }) as never)
    engineDraws(on, 'ToolUse', 'engine row')
    await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'r1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm run lint', tool_use_id: 'r2' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'a\nb', tool_use_id: 'r3' } as never)
    const row = (id: string, tool: string, input: unknown) =>
      $.ui.mount({
        plugin: 'clarity',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: id,
        viewport: VIEW,
        props: { tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false },
      })
    const first = await row('r1', 'Bash', { command: 'npm test' })
    expect(await first.find({ text: /3 tools/ })).toBeDefined()
    expect(await first.find({ text: /Bash ×2 +Edit/ })).toBeDefined()
    const third = await row('r3', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'a\nb' })
    expect(await third.find({ text: /Edit/ })).toBeUndefined()
    await first.press({ key: 'row' })
    expect(await third.find({ text: /\+2 +−1 +src\/a\.ts/ })).toBeDefined()
    await first.unmount()
    await third.unmount()
  })

  test('a failed call gets a red header over its full row', async ($, on) => {
    engineDraws(on, 'ToolUse', 'engine row')
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'ToolUse',
      viewport: VIEW,
      props: { tool_use_id: 't2', tool: 'Bash', input: { command: 'npm test' }, isRunning: false, isErrored: true, isInterrupted: false },
    })
    expect(await ui.find({ text: /✗ Bash failed · npm test/ })).toBeDefined()
    expect(await ui.find({ text: /engine row/ })).toBeDefined()
    await ui.unmount()
  })

  test('a folded group draws one line naming its tools', async ($, on) => {
    engineDraws(on, 'ToolGroup', 'engine group')
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'ToolGroup',
      viewport: VIEW,
      props: { calls: [call('Read'), call('Read'), call('Grep')], isActive: false, isExpanded: false },
    })
    expect(await ui.find({ text: /Read ×2 +Grep/ })).toBeDefined()
    await ui.unmount()
  })

  test('a narrow terminal drops the indent, never the label', async ($, on) => {
    engineDraws(on, 'ToolUse', 'engine row')
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'ToolUse',
      viewport: { columns: 50, rows: 40 },
      props: { tool_use_id: 't3', tool: 'Read', input: { file_path: '/repo/src/app.ts' }, isRunning: false, isErrored: false, isInterrupted: false },
    })
    expect(await ui.find({ text: /^▸ +Read/ })).toBeDefined()
    await ui.unmount()
  })

  test('a question gets a banner above it', async ($, on) => {
    // The dialog itself is the engine's node, which a tree must hold exactly once.
    on('ui.render', { component: 'AskUserQuestion' }, () => ({ type: 'engine' as const, ref: 0 }))
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'AskUserQuestion',
      viewport: VIEW,
      props: { tool: 'AskUserQuestion', questions: [] },
    })
    expect(await ui.find({ text: /Claude needs your answer/ })).toBeDefined()
    await ui.unmount()
  })

  test('command output sits in a titled card', async ($, on) => {
    engineDraws(on, 'CommandOutput', 'engine output')
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'CommandOutput',
      viewport: VIEW,
      props: { command: 'cost', args: '', text: 'Total: $0.42', isErrored: false },
    })
    expect(await ui.find({ text: /\/cost/ })).toBeDefined()
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
    await ui.unmount()
  })
})

const PANE_PROPS = (title: string) => ({
  title,
  isFocused: true,
  bodyColumns: 70,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 28 },
  view: {},
})

describe('menu, band and panel', () => {
  test('the menu shows every choice; a click picks one, a number steps through', async ($, on) => {
    mock.store(on)
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'clarity-menu',
      viewport: VIEW,
      props: PANE_PROPS('clarity'),
    })
    // The current choice is the filled chip.
    const isFilled = async (key: string) => JSON.stringify((await ui.find({ key }))?.children ?? []).includes('backgroundColor')
    expect(await isFilled('focus-off')).toBe(true)
    expect(await isFilled('focus-on')).toBe(false)
    await ui.press({ key: 'focus-on' })
    expect(await isFilled('focus-on')).toBe(true)

    await ui.press({ key: 'palette-colorblind' })
    expect(await isFilled('palette-colorblind')).toBe(true)

    await ui.press({ key: 'cycle-width' })
    expect(await isFilled('width-100')).toBe(true)

    for (const section of ['General', 'Look', 'Layout', 'Behaviour', 'Preview']) {
      expect(await ui.find({ text: new RegExp(section) })).toBeDefined()
    }
    expect(await ui.find({ text: /How wide replies get before they wrap/ })).toBeDefined()
    expect(await ui.find({ text: /Turn it off for regular Claude Code\./ })).toBeDefined()
    expect(await isFilled('font-leave')).toBe(true)
    expect(await ui.find({ key: 'font-readable' })).toBeDefined()
    expect(await ui.find({ text: /Esc to close · \/clarity panel to open the session panel/ })).toBeDefined()
    expect(await ui.find({ text: /click a choice/ })).toBeUndefined()
    // The one mention of other mods is the advice to turn them off.
    expect(await ui.find({ text: /works best on its own/ })).toBeDefined()
    // The live preview draws the sample turn in the current look.
    expect(await ui.find({ text: /add rate limiting/ })).toBeDefined()
    await ui.unmount()
  })

  test('the band says what is happening and opens the panel', async ($, on) => {
    engineDraws(on, 'AbovePrompt', 'engine band')
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: VIEW,
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    })
    expect(await ui.find({ text: /Ready/ })).toBeDefined()
    expect(await ui.find({ key: 'panel' })).toBeDefined()
    expect(await ui.find({ key: 'menu' })).toBeDefined()
    await ui.unmount()
  })

  test('the band still draws over state an older clarity wrote', async ($, on) => {
    engineDraws(on, 'AbovePrompt', '')
    const old = { turns: [], files: { '/a.ts': { added: 1, removed: 0, edits: 1 } }, errors: [], lastReply: 'hi', context: 41 }
    on('state.get', { plugin: 'clarity', key: 'ledger' }, () => ({ value: { value: old as never, version: 3 } }))
    on('state.get', { plugin: 'clarity', key: 'activity' }, () => ({ value: { value: { phase: 'thinking', tool: '', detail: '' } as never, version: 3 } }))
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: VIEW,
      props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 110, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    })
    expect(await ui.find({ text: /Thinking/ })).toBeDefined()
    expect(await ui.find({ text: /context 41%/ })).toBeDefined()
    expect(await ui.find({ key: 'menu' })).toBeDefined()
    await ui.unmount()
  })

  test('a squeezed band drops whole facts, never cuts one', async ($, on) => {
    engineDraws(on, 'AbovePrompt', '')
    const ledger = { ...EMPTY_LEDGER, files: { '/r/a.ts': { added: 3, removed: 1, edits: 1 } }, errors: [{ tool: 'Bash', detail: 'npm test', text: '' }], context: 36 }
    on('state.get', { plugin: 'clarity', key: 'ledger' }, () => ({ value: { value: ledger, version: 1 } }))
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: { columns: 70, rows: 40 },
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 68, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    })
    expect(await ui.find({ text: /1 failed/ })).toBeDefined()
    expect(await ui.find({ text: /\w…/ })).toBeUndefined()
    expect(await ui.find({ key: 'menu' })).toBeDefined()
    await ui.unmount()
  })

  test('while a turn runs the band shows its timer, and the stock spinner steps aside', async ($, on) => {
    engineDraws(on, 'AbovePrompt', '')
    on('state.get', { plugin: 'clarity', key: 'activity' }, () => ({ value: { value: { phase: 'tool' as const, tool: 'Bash', detail: 'npm test', since: 1_000, tokens: 2_500 }, version: 1 } }))
    on('state.get', { plugin: 'clarity', key: 'tick' }, () => ({ value: { value: 13_000, version: 1 } }))
    const band = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: VIEW,
      props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 110, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    })
    expect(await band.find({ text: /Running npm test · 12s · ↓ 2\.5k tokens/ })).toBeDefined()
    await band.unmount()
    const spinner = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'Spinner',
      viewport: VIEW,
      props: { word: 'Thinking', message: null, suffix: '…', mode: 'tool-use' },
    })
    expect(await spinner.find({ text: /Thinking/ })).toBeUndefined()
    await spinner.unmount()
  })

  test('the panel shows the plan, the recent calls, and turns you can copy', async ($, on) => {
    const ledger = {
      ...EMPTY_LEDGER,
      turns: ['add rate limiting', 'now the tests'],
      prompts: ['add rate limiting', 'now the tests'],
      todos: [
        { content: 'Read the server', status: 'completed' as const, activeForm: 'Reading the server' },
        { content: 'Add the limiter', status: 'in_progress' as const, activeForm: 'Adding the limiter' },
      ],
      recent: [{ at: Date.UTC(2026, 9, 15, 17, 7), tool: 'Bash', detail: 'npm test', isOk: true }],
    }
    on('state.get', { plugin: 'clarity', key: 'ledger' }, () => ({ value: { value: ledger, version: 1 } }))
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'clarity-session',
      viewport: VIEW,
      props: PANE_PROPS('Session'),
    })
    expect(await ui.find({ text: /Plan/ })).toBeDefined()
    expect(await ui.find({ text: /▸ +Adding the limiter/ })).toBeDefined()
    expect(await ui.find({ key: 'copy-turn-2' })).toBeDefined()
    expect(await ui.find({ text: /Recent/ })).toBeDefined()
    expect(await ui.find({ text: /npm test/ })).toBeDefined()
    await ui.unmount()
  })

  test('a long turn closes with what it did while you were away', async ($, on) => {
    on('ui.render', { component: 'TurnDuration' }, ($, e) => $.ui.resolve(e).Text({ children: '' }))
    const ledger = { ...EMPTY_LEDGER, summaries: { '130000': { tools: 12, files: 3, added: 40, removed: 12, failed: 1 } } }
    on('state.get', { plugin: 'clarity', key: 'ledger' }, () => ({ value: { value: ledger, version: 1 } }))
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'TurnDuration',
      viewport: VIEW,
      props: { word: 'Baked', durationMs: 130000 },
    })
    expect(await ui.find({ text: /While you were away/ })).toBeDefined()
    expect(await ui.find({ text: /12 tool calls/ })).toBeDefined()
    expect(await ui.find({ text: /3 files changed \(\+40 −12\)/ })).toBeDefined()
    expect(await ui.find({ text: /1 failed/ })).toBeDefined()
    await ui.unmount()
  })

  test('the session panel starts empty and says so', async $ => {
    const ui = await $.ui.mount({
      plugin: 'clarity',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'clarity-session',
      viewport: VIEW,
      props: PANE_PROPS('Session'),
    })
    expect(await ui.find({ text: /Your prompts/ })).toBeDefined()
    expect(await ui.find({ text: /Nothing asked yet/ })).toBeDefined()
    expect(await ui.find({ text: /No files changed yet/ })).toBeDefined()
    await ui.unmount()
  })
})
