// Drawing, from the surface's element table: no `$`, so the transcript, the menu's live
// preview, the band and the panel all draw from the same rows.
import type { ElementTable, RenderElement } from 'claude-code'

import type { Activity, Ledger, Prefs, TurnSummary } from '../types'
import { MARK, PANEL_TURNS, activityText, clip, formatClock, formatDuration, formatTokens, kindOf, planProgress, shortPath, toAscii } from './logic'
import type { Attachment, Block, Palette, Status } from './logic'

export type UI = ElementTable<'terminal'>

export type Look = { prefs: Prefs; colors: Palette; columns: number; isNarrow: boolean }

// The element table with every symbol clarity draws swapped for plain ASCII, and borders drawn
// in ASCII too. Everything clarity draws goes through the table, so this one wrap covers it all.
export function asciiUI(ui: UI): UI {
  const plain = (children: unknown): unknown =>
    typeof children === 'string' ? toAscii(children) : Array.isArray(children) ? children.map(plain) : children
  const table = { ...ui } as Record<string, unknown>
  table.Text = (props: Record<string, unknown>) => (ui.Text as (p: unknown) => RenderElement)({ ...props, children: plain(props.children) })
  table.Button = (props: Record<string, unknown>) =>
    (ui.Button as (p: unknown) => RenderElement)({
      ...props,
      children: plain(props.children),
      ...(typeof props.label === 'string' ? { label: toAscii(props.label) } : {}),
    })
  table.Box = (props: Record<string, unknown>) =>
    (ui.Box as (p: unknown) => RenderElement)(props.borderStyle === undefined ? props : { ...props, borderStyle: 'classic' })
  return table as unknown as UI
}

// A word on a coloured ground: dark text on the colour, or inverse where the theme has no hex.
export function badge(ui: UI, colors: Palette, text: string, tone: string): RenderElement {
  return colors.chipText === undefined ? (
    <ui.Text color={tone} inverse bold>
      {text}
    </ui.Text>
  ) : (
    <ui.Text backgroundColor={tone} color={colors.chipText} bold>
      {text}
    </ui.Text>
  )
}

export type Chip = { key: string; label: string; onPress: () => void; hotkey?: string; tone?: string }

// A button: bracketed in its colour, filling in under the pointer. Filled words with no
// brackets (badge) are labels, so nothing that only labels looks pressable.
export function chip(ui: UI, look: Look, c: Chip): RenderElement {
  const { colors } = look
  const tone = c.tone ?? colors.you
  const label = `[ ${c.label} ]`
  const face =
    // Under the pointer it lifts onto the bar's ground and brightens, staying in its colour.
    colors.barBg === undefined ? (
      <ui.Text color={tone} bold hover={{ color: colors.text, underline: true }}>
        {label}
      </ui.Text>
    ) : (
      <ui.Text color={tone} bold hover={{ backgroundColor: colors.accentBg, color: colors.text, underline: true }}>
        {label}
      </ui.Text>
    )
  // The keyed Box is what the pointer hovers, so the chip lights alone.
  return (
    <ui.Box key={`chip-${c.key}`}>
      {c.hotkey === undefined ? (
        <ui.Button key={c.key} plain onPress={c.onPress}>
          {face}
        </ui.Button>
      ) : (
        <ui.Button key={c.key} plain hotkey={c.hotkey} onPress={c.onPress}>
          {face}
        </ui.Button>
      )}
    </ui.Box>
  )
}

const ATTACHMENT_ICON: Record<Attachment['kind'], string> = { file: '▤', folder: '▸', image: '▣', paste: '≡' }

// What a prompt brought along, each in a small frame of its own, as files sit under a message
// on claude.ai: the icon and name, then where it is or how long.
export function attachmentCards(ui: UI, look: Look, attachments: readonly Attachment[]): RenderElement | null {
  if (attachments.length === 0) return null
  const { Box, Text } = ui
  const { colors } = look
  const tone = (a: Attachment) =>
    a.kind === 'image' ? colors.kinds.web : a.kind === 'paste' ? colors.kinds.search : a.kind === 'folder' ? colors.kinds.write : colors.kinds.read
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {attachments.map(a => (
        <Box borderStyle="round" borderColor={tone(a)} paddingX={1}>
          <Text wrap="truncate">
            <Text color={tone(a)} bold>
              {ATTACHMENT_ICON[a.kind]} {clip(a.name, 28)}
            </Text>
            {a.detail !== '' && <Text color={colors.muted}> {clip(a.detail, 24)}</Text>}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// The person's prompt: a rounded box in their colour, labelled, with what it brought along.
export function userRow(ui: UI, look: Look, text: string, attachments: readonly Attachment[] = [], more?: Chip): RenderElement {
  const { Box, Text } = ui
  const { colors } = look
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={colors.you} paddingX={1} width={replyWidth(look) + (look.isNarrow ? 0 : 1)}>
      {badge(ui, colors, ' you ', colors.you)}
      <Text color={colors.text}>{text}</Text>
      {more !== undefined && chip(ui, look, { ...more, tone: copyTone(colors) })}
      {attachmentCards(ui, look, attachments)}
    </Box>
  )
}

export function claudeHeader(ui: UI, look: Look): RenderElement {
  return badge(ui, look.colors, ' ● claude ', look.colors.claude)
}

// The width a reply's box takes: the person's line width plus the frame, never past the screen.
function replyWidth(look: Look): number {
  const room = Math.max(24, look.columns - (look.isNarrow ? 0 : 2))
  return look.prefs.measure > 0 ? Math.min(room, look.prefs.measure + 4) : room
}

function copyTone(colors: Palette): string {
  return colors.rule === 'subtle' ? 'inactive' : colors.muted
}

// One block of a reply in a soft frame: the `claude` badge on the first, copy chips at the foot.
// `isOwnBody` false: the body holds Claude Code's own drawing, which may not sit under a sized Box.
export function replyBox(ui: UI, look: Look, isFirst: boolean, body: RenderElement, chips: readonly Chip[], isOwnBody = true): RenderElement {
  const { Box } = ui
  const frame = {
    flexDirection: 'column' as const,
    marginTop: isFirst ? 1 : 0,
    marginLeft: look.isNarrow ? 0 : 1,
    borderStyle: 'round',
    borderColor: look.colors.rule,
    paddingX: 1,
  }
  return (
    <Box {...frame} {...(isOwnBody ? { width: replyWidth(look) } : {})}>
      {isFirst && claudeHeader(ui, look)}
      {body}
      {chips.length > 0 && (
        <Box flexDirection="row" gap={1}>
          {chips.map(c => chip(ui, look, { ...c, tone: copyTone(look.colors) }))}
        </Box>
      )}
    </Box>
  )
}

// A reply's paragraphs with a line of room between them, and each code block in its own
// frame with its language and a copy chip.
export function replyBlocks(ui: UI, look: Look, blocks: readonly Block[], onCopy?: (code: string) => void): RenderElement {
  const { Box, Markdown } = ui
  const { colors } = look
  return (
    <Box flexDirection="column">
      {blocks.map((block, i) =>
        block.kind === 'prose' ? (
          <Box marginTop={i === 0 ? 0 : 1}>
            <Markdown text={block.text} />
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={i === 0 ? 0 : 1} borderStyle="single" borderColor={colors.rule} paddingX={1}>
            <Box flexDirection="row" justifyContent="space-between">
              {badge(ui, colors, ` ${block.lang === '' ? 'code' : block.lang} `, colors.tool)}
              {onCopy !== undefined && chip(ui, look, { key: `copy-code-${i}`, label: '⧉ copy', tone: copyTone(colors), onPress: () => onCopy(block.body) })}
            </Box>
            <Markdown text={block.text} />
          </Box>
        ),
      )}
    </Box>
  )
}

export type ToolParts = {
  tools: readonly { tool: string; label: string }[]
  detail: string
  status: Status
  isOpen?: boolean
  /** An edit's lines in and out, drawn green and red before its file. */
  delta?: { added: number; removed: number }
}

function markColor(colors: Palette, status: Status): string {
  return status === 'error' ? colors.error : status === 'running' ? colors.warn : status === 'interrupted' ? colors.muted : colors.ok
}

function badgesWidth(parts: ToolParts): number {
  return parts.tools.reduce((n, t) => n + t.label.length + 3, 0)
}

// `▸ [Read ×2] [Grep] detail ✓`: each tool a badge in the colour of what it does.
function toolFace(ui: UI, look: Look, parts: ToolParts, room: number): RenderElement[] {
  const { Text } = ui
  const { colors } = look
  const badges = parts.tools.flatMap((t, i) => [
    ...(i === 0 ? [] : [<Text> </Text>]),
    badge(ui, colors, ` ${t.label} `, parts.status === 'error' ? colors.error : colors.kinds[kindOf(t.tool)]),
  ])
  const delta = parts.delta
  return [
    <Text color={colors.muted}>{parts.isOpen === true ? '▾ ' : '▸ '}</Text>,
    ...badges,
    ...(delta === undefined
      ? []
      : [
          <Text color={colors.ok} bold>
            {' '}+{delta.added}
          </Text>,
          <Text color={colors.error} bold>
            {' '}−{delta.removed}
          </Text>,
        ]),
    <Text color={colors.text}> {clip(parts.detail, room)} </Text>,
    <Text color={markColor(colors, parts.status)} bold>
      {MARK[parts.status]}
    </Text>,
  ]
}

// A tool row on a tinted strip; a press opens or folds it where it stands.
export function toolLine(ui: UI, look: Look, parts: ToolParts, onPress?: () => void): RenderElement {
  const { Box, Button, Text } = ui
  const face = toolFace(ui, look, parts, look.columns - badgesWidth(parts) - 12)
  return (
    <Box marginLeft={look.isNarrow ? 0 : 2} paddingX={1} backgroundColor={look.colors.accentBg}>
      {onPress === undefined ? (
        <Text wrap="truncate">{face}</Text>
      ) : (
        <Button key="row" plain onPress={onPress}>
          {face}
        </Button>
      )}
    </Box>
  )
}

// An opened row: a box in the tool colour, its line to fold it, the full row inside.
export function openedRow(ui: UI, look: Look, parts: ToolParts, onFold: () => void, body: RenderElement): RenderElement {
  const { Box, Button } = ui
  return (
    <Box
      flexDirection="column"
      marginLeft={look.isNarrow ? 0 : 2}
      borderStyle="round"
      borderColor={look.colors.kinds[kindOf(parts.tools[0]?.tool ?? '')]}
      paddingX={1}
    >
      <Button key="row" plain onPress={onFold}>
        {toolFace(ui, look, { ...parts, isOpen: true }, look.columns - badgesWidth(parts) - 14)}
      </Button>
      {body}
    </Box>
  )
}

// A failure: a red box with what failed on top and the full row inside.
export function failHeader(ui: UI, look: Look, tool: string, detail: string, body: RenderElement): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" marginLeft={look.isNarrow ? 0 : 2} borderStyle="round" borderColor={look.colors.error} paddingX={1}>
      <Text color={look.colors.error} bold wrap="truncate">
        ✗ {tool} failed{detail === '' ? '' : ` · ${clip(detail, look.columns - tool.length - 18)}`}
      </Text>
      {body}
    </Box>
  )
}

// The end of a turn: a rule with the time, so turns read as blocks.
export function turnRule(ui: UI, look: Look, durationMs: number): RenderElement {
  const label = ` ${formatDuration(durationMs)} `
  const right = Math.max(0, Math.max(12, look.columns - 2) - 2 - label.length)
  return (
    <ui.Box>
      <ui.Text color={look.colors.rule}>{'━━' + label + '━'.repeat(right)}</ui.Text>
    </ui.Box>
  )
}

// A slash command's output in a titled card.
export function card(ui: UI, look: Look, title: string, body: RenderElement, isErrored: boolean): RenderElement {
  const tone = isErrored ? look.colors.error : look.colors.claude
  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor={tone} paddingX={1}>
      {badge(ui, look.colors, ` ${title} `, tone)}
      {body}
    </ui.Box>
  )
}

export function questionBanner(ui: UI, look: Look, body: RenderElement): RenderElement {
  return (
    <ui.Box flexDirection="column" borderStyle="double" borderColor={look.colors.warn} paddingX={1}>
      {badge(ui, look.colors, ' ❯ Claude needs your answer ', look.colors.warn)}
      {body}
    </ui.Box>
  )
}

// The close of a long turn: what it did while you looked away.
export function awayCard(ui: UI, look: Look, durationMs: number, summary: TurnSummary): RenderElement {
  const { Box, Text } = ui
  const { colors } = look
  const facts: { text: string; tone: string }[] = [
    { text: `${summary.tools} tool call${summary.tools === 1 ? '' : 's'}`, tone: colors.tool },
    ...(summary.files > 0 ? [{ text: `${summary.files} file${summary.files === 1 ? '' : 's'} changed (+${summary.added} −${summary.removed})`, tone: colors.kinds.write }] : []),
    ...(summary.failed > 0 ? [{ text: `${summary.failed} failed`, tone: colors.error }] : []),
  ]
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={look.isNarrow ? 0 : 1} borderStyle="round" borderColor={colors.claude} paddingX={1}>
      <Text>
        {badge(ui, colors, ' While you were away ', colors.claude)}
        <Text color={colors.muted}> {formatDuration(durationMs)}</Text>
      </Text>
      <Text wrap="wrap">
        {facts.map((f, i) => (
          <Text>
            {i === 0 ? '' : <Text color={colors.rule}> · </Text>}
            <Text color={f.tone} bold>
              {f.text}
            </Text>
          </Text>
        ))}
      </Text>
    </Box>
  )
}

function meter(percent: number, cells: number): { full: string; empty: string } {
  const full = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells)
  return { full: '█'.repeat(full), empty: '░'.repeat(cells - full) }
}

// Green with room to spare, yellow past half, red near the end.
function levelColor(colors: Palette, percent: number): string {
  return percent >= 80 ? colors.error : percent >= 50 ? colors.warn : colors.ok
}

function phaseColor(colors: Palette, activity: Activity): string {
  if (activity.phase === 'waiting' || activity.phase === 'compacting') return colors.warn
  if (activity.phase === 'idle') return colors.ok
  return activity.phase === 'tool' ? colors.kinds[kindOf(activity.tool)] : colors.claude
}

function phaseBadge(ui: UI, colors: Palette, activity: Activity): RenderElement {
  return badge(ui, colors, activity.phase === 'idle' ? ' ✓ ' : activity.phase === 'waiting' ? ' ❯ ' : ' ● ', phaseColor(colors, activity))
}

export type BandActions = { panel: () => void; menu: () => void; copy?: () => void }

// The toolbar above the prompt: what Claude is doing, what changed, context, and chips.
export type TurnStats = { elapsedMs: number; tokens: number; tip: string | null }

export function band(ui: UI, look: Look, activity: Activity, ledger: Ledger, width: number, stats: TurnStats, actions: BandActions): RenderElement {
  const { Box, Text } = ui
  const { colors } = look
  const files = Object.keys(ledger.files).length
  // In order of what matters most when room is short.
  const plan = planProgress(ledger.todos)
  // A plan usage limit shows once it passes 80%, with when it resets.
  const limit = ledger.limit !== null && ledger.limit.percent >= 80 ? ledger.limit : null
  const resets = limit?.resetsAt != null && !Number.isNaN(Date.parse(limit.resetsAt)) ? ` · resets ${formatClock(Date.parse(limit.resetsAt))}` : ''
  const wanted: { text: string; tone: string }[] = [
    ...(limit !== null ? [{ text: `limit ${Math.round(limit.percent)}%${resets}`, tone: limit.percent >= 95 ? colors.error : colors.warn }] : []),
    ...(ledger.errors.length > 0 ? [{ text: `${ledger.errors.length} failed`, tone: colors.error }] : []),
    ...(plan !== null ? [{ text: `task ${plan.at}/${plan.of}`, tone: colors.claude }] : []),
    ...(ledger.agents > 0 ? [{ text: `${ledger.agents} agent${ledger.agents === 1 ? '' : 's'}`, tone: colors.kinds.agent }] : []),
    ...(ledger.context !== null ? [{ text: `context ${Math.round(ledger.context)}%`, tone: levelColor(colors, ledger.context) }] : []),
    ...(files > 0 ? [{ text: `${files} file${files === 1 ? '' : 's'} changed`, tone: colors.kinds.write }] : []),
  ]
  // No hotkeys here: the terminal prints them as `c:` before each chip, which crowds the bar.
  const chips: Chip[] = [
    ...(actions.copy === undefined ? [] : [{ key: 'copy', label: '⧉ copy reply', onPress: actions.copy }]),
    { key: 'panel', label: '▤ session', onPress: actions.panel },
    { key: 'menu', label: '☰ settings', onPress: actions.menu },
  ]
  // Each button is `[ label ]` (four more than its label) with a column between, after a gap of two.
  const chipsWidth = chips.reduce((n, c) => n + c.label.length + 5, 0) + 2
  // While a turn runs: what it is doing, how long, and how much it has written, as the
  // stock spinner says it (`Thinking · 1m 42s · ↓ 8.5k tokens`).
  const running = activity.phase === 'idle' ? [] : [
    ...(stats.elapsedMs >= 1000 ? [formatDuration(stats.elapsedMs)] : []),
    ...(stats.tokens > 0 ? [`↓ ${formatTokens(stats.tokens)} tokens`] : []),
  ]
  // A turn that died on an error says so, in red, until the next one starts.
  const isStopped = activity.phase === 'idle' && ledger.stopped !== null
  const doingParts = isStopped ? [`Stopped: ${ledger.stopped}`] : [activityText(activity), ...running]
  const doing = doingParts.join(' · ')
  // The status comes first: it keeps up to 48 columns (enough for the step, its time and its
  // tokens) before any fact gets a place; each fact then shows whole or not at all.
  let room = width - 2 - chipsWidth - 4 - Math.min(doing.length, 48)
  const facts = wanted.filter(f => {
    const cost = f.text.length + 3
    if (cost > room) return false
    room -= cost
    return true
  })
  const statusRoom = Math.max(8, width - 2 - chipsWidth - 4 - facts.reduce((n, f) => n + f.text.length + 3, 0))
  // Short of room, the status sheds its tokens, then its time, whole; only the step itself is cut.
  let shown = doingParts
  while (shown.length > 1 && shown.join(' · ').length > statusRoom) shown = shown.slice(0, -1)
  const status = clip(shown.join(' · '), statusRoom)
  const tone = isStopped ? colors.error : phaseColor(colors, activity)
  const line = (
    <Box flexDirection="row" justifyContent="space-between" width={width} paddingX={1} backgroundColor={colors.barBg}>
      {/* The status gives way first; the chips keep their size so they never wrap. */}
      <Box flexShrink={1} overflow="hidden">
      <Text wrap="truncate">
        {isStopped ? badge(ui, colors, ' ✗ ', colors.error) : phaseBadge(ui, colors, activity)}
        <Text color={tone} bold>
          {' '}
          {status}
        </Text>
        {facts.map(f => (
          <Text>
            <Text color={colors.rule}> │ </Text>
            <Text color={f.tone} bold>
              {f.text}
            </Text>
          </Text>
        ))}
      </Text>
      </Box>
      <Box flexDirection="row" gap={1} marginLeft={2} flexShrink={0}>
        {chips.map(c => chip(ui, look, c))}
      </Box>
    </Box>
  )
  // During a long turn, a tip under the bar, one at a time.
  return activity.phase === 'idle' || stats.tip === null ? (
    line
  ) : (
    <Box flexDirection="column">
      {line}
      <Box paddingX={1}>
        <Text color={colors.muted} italic wrap="truncate">
          Tip: {stats.tip}
        </Text>
      </Box>
    </Box>
  )
}

// The sidebar: what is happening, the turns so far, what changed, what failed.
export type PanelActions = { copyTurn: (index: number) => void; toggleTurns: () => void; isAllTurns: boolean }

export function panel(ui: UI, look: Look, activity: Activity, ledger: Ledger, width: number, actions: PanelActions): RenderElement {
  const { Box, Button, Text } = ui
  const { colors } = look
  const heading = (title: string, count: number | string, tone: string) => (
    <Box marginTop={1} paddingX={1} backgroundColor={colors.barBg} width={width} justifyContent="space-between">
      {badge(ui, colors, ` ${title} `, tone)}
      <Text color={colors.muted}>{count}</Text>
    </Box>
  )
  const empty = (text: string) => (
    <Text color={colors.muted} italic>
      {text}
    </Text>
  )
  const files = Object.entries(ledger.files)
  const biggest = Math.max(1, ...files.map(([, c]) => c.added + c.removed))
  const turns = ledger.turns.slice(actions.isAllTurns ? -50 : -PANEL_TURNS)
  const firstTurn = ledger.turns.length - turns.length + 1
  const isFolded = ledger.turns.length > PANEL_TURNS
  const cells = Math.max(6, Math.min(20, width - 20))
  const level = ledger.context === null ? null : meter(ledger.context, cells)
  const done = ledger.todos.filter(t => t.status === 'completed').length
  return (
    <Box flexDirection="column" width={width}>
      {/* Now: what Claude is doing, and how full the context is. */}
      <Box flexDirection="column" borderStyle="round" borderColor={phaseColor(colors, activity)} paddingX={1}>
        <Text wrap="truncate">
          {phaseBadge(ui, colors, activity)}
          <Text color={phaseColor(colors, activity)} bold>
            {' '}
            {activityText(activity)}
          </Text>
        </Text>
        {ledger.context !== null && level !== null && (
          <Text>
            <Text color={colors.muted}>context </Text>
            <Text color={levelColor(colors, ledger.context)}>{level.full}</Text>
            <Text color={colors.rule}>{level.empty}</Text>
            <Text color={levelColor(colors, ledger.context)} bold>
              {' '}
              {Math.round(ledger.context)}%
            </Text>
            {ledger.cost !== null && <Text color={colors.muted}>  ${ledger.cost.toFixed(2)}</Text>}
          </Text>
        )}
      </Box>
      {ledger.todos.length > 0 && heading('Plan', `${done} of ${ledger.todos.length} done`, colors.claude)}
      {ledger.todos.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {ledger.todos.slice(0, 10).map(t => (
            <Text wrap="truncate">
              {t.status === 'completed' ? (
                <Text color={colors.ok}>✓ </Text>
              ) : t.status === 'in_progress' ? (
                <Text color={colors.claude} bold>
                  ▸{' '}
                </Text>
              ) : (
                <Text color={colors.rule}>○ </Text>
              )}
              <Text color={t.status === 'in_progress' ? colors.text : colors.muted} bold={t.status === 'in_progress'} strikethrough={t.status === 'completed'}>
                {t.status === 'in_progress' ? t.activeForm : t.content}
              </Text>
            </Text>
          ))}
        </Box>
      )}
      {heading('Changed', files.length === 1 ? '1 file' : `${files.length} files`, colors.kinds.write)}
      <Box flexDirection="column" paddingX={1}>
        {files.length === 0 && empty('No files changed yet.')}
        {files.slice(-12).map(([path, change]) => {
          const share = Math.max(1, Math.round(((change.added + change.removed) / biggest) * 5))
          const greens = Math.round((change.added / Math.max(1, change.added + change.removed)) * share)
          return (
            <Text wrap="truncate">
              <Text color={colors.ok}>{'▮'.repeat(greens)}</Text>
              <Text color={colors.error}>{'▮'.repeat(share - greens)}</Text>
              <Text>{' '.repeat(6 - share)}</Text>
              <Text color={colors.text} bold>
                {shortPath(path)}
              </Text>
              <Text color={colors.ok}> +{change.added}</Text>
              <Text color={colors.error}> −{change.removed}</Text>
            </Text>
          )
        })}
      </Box>
      {ledger.errors.length > 0 && heading('Failed', ledger.errors.length, colors.error)}
      {ledger.errors.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {ledger.errors.slice(-5).map(err => (
            <Text wrap="truncate">
              <Text color={colors.error} bold>
                ✗ {err.tool}
              </Text>
              <Text color={colors.muted}> {err.detail || err.text}</Text>
            </Text>
          ))}
        </Box>
      )}
      {ledger.recent.length > 0 && heading('Recent', 'latest first', colors.tool)}
      {ledger.recent.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {ledger.recent
            .slice(-6)
            .reverse()
            .map(r => (
              <Text wrap="truncate">
                <Text color={colors.rule}>{formatClock(r.at).padStart(8)}  </Text>
                <Text color={r.isOk ? colors.kinds[kindOf(r.tool)] : colors.error} bold>
                  {r.tool}
                </Text>
                <Text color={colors.muted}> {r.detail}</Text>
              </Text>
            ))}
        </Box>
      )}
      {heading('Your prompts', turns.length === 0 ? '' : 'click to copy', colors.you)}
      <Box flexDirection="column" paddingX={1}>
        {turns.length === 0 && empty('Nothing asked yet.')}
        {turns.map((text, i) => {
          const n = firstTurn + i
          const isLatest = i === turns.length - 1
          return (
            <Box key={`turn-${n}`}>
              <Button key={`copy-turn-${n}`} plain onPress={() => actions.copyTurn(n - 1)}>
                <Text color={isLatest ? colors.you : colors.rule} bold>
                  {String(n).padStart(2)}
                </Text>
                <Text color={isLatest ? colors.text : colors.muted} hover={{ color: colors.you, underline: true }}>
                  {'  '}
                  {clip(text, Math.max(8, width - 8))}
                </Text>
              </Button>
            </Box>
          )
        })}
        {isFolded &&
          chip(ui, look, {
            key: 'all-turns',
            label: actions.isAllTurns ? '▴ show fewer' : `▾ show all ${Math.min(ledger.turns.length, 50)}`,
            tone: copyTone(colors),
            onPress: actions.toggleTurns,
          })}
      </Box>
    </Box>
  )
}

export type MenuOption = { value: string; label: string }

// One setting: its label (a press, or its number key, steps to the next choice) and every
// choice as a chip, the current one filled.
export type MenuSetting = {
  key: string
  hotkey: string
  label: string
  hint: string
  options: readonly MenuOption[]
  current: string
  pick: (value: string) => void
}

export type MenuSection = { title: string; tone: string; settings: readonly MenuSetting[] }

const LABEL_WIDTH = 17

function optionChip(ui: UI, look: Look, key: string, label: string, isCurrent: boolean, onPress: () => void): RenderElement {
  const { colors } = look
  const text = ` ${label} `
  const face = isCurrent ? (
    badge(ui, colors, text, colors.you)
  ) : (
    <ui.Text color={colors.muted} hover={{ color: colors.text, bold: true }}>
      {text}
    </ui.Text>
  )
  return (
    <ui.Box key={`opt-${key}`}>
      <ui.Button key={key} plain onPress={onPress}>
        {face}
      </ui.Button>
    </ui.Box>
  )
}

function settingRow(ui: UI, look: Look, setting: MenuSetting): RenderElement {
  const { Box, Button, Text } = ui
  const { colors } = look
  const at = Math.max(0, setting.options.findIndex(o => o.value === setting.current))
  const next = setting.options[(at + 1) % setting.options.length]
  return (
    <Box key={`set-${setting.key}`} flexDirection="column">
      <Box flexDirection="row">
        <Box key={`label-${setting.key}`} width={LABEL_WIDTH} flexShrink={0}>
          <Button key={`cycle-${setting.key}`} plain hotkey={setting.hotkey} onPress={() => next !== undefined && setting.pick(next.value)}>
            <Text color={colors.text} bold hover={{ color: colors.you }}>
              {setting.label}
            </Text>
          </Button>
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          {setting.options.map(o => optionChip(ui, look, `${setting.key}-${o.value}`, o.label, o.value === setting.current, () => setting.pick(o.value)))}
        </Box>
      </Box>
      {/* The description sits on its own line under the choices, dim and set in. */}
      {setting.hint !== '' && (
        <Box paddingLeft={LABEL_WIDTH}>
          <Text color={colors.muted} italic wrap="wrap">
            {setting.hint}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export function menu(ui: UI, look: Look, sections: readonly MenuSection[], footer: readonly string[]): RenderElement {
  const { Box, Text } = ui
  const { colors } = look
  return (
    <Box flexDirection="column">
      <Box paddingX={1} backgroundColor={colors.barBg}>
        {badge(ui, colors, ' clarity ', colors.claude)}
        <Text color={colors.muted}> settings</Text>
      </Box>
      {sections.map(section => (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          {badge(ui, colors, ` ${section.title} `, section.tone)}
          {section.settings.map((setting, i) => (
            <Box key={`gap-${setting.key}`} marginTop={i === 0 ? 0 : 1}>
              {settingRow(ui, look, setting)}
            </Box>
          ))}
        </Box>
      ))}
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        {footer.map(line => (
          <Text color={colors.muted} wrap="wrap">
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        {badge(ui, colors, ' Preview ', colors.rule === 'subtle' ? 'inactive' : colors.muted)}
        {preview(ui, { ...look, columns: Math.min(look.columns - 4, 64) })}
      </Box>
    </Box>
  )
}

// A sample turn in the current look, so a change in the menu shows at once.
export function preview(ui: UI, look: Look): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={look.colors.rule} paddingX={1}>
      {userRow(ui, look, 'add rate limiting to the api')}
      {replyBox(ui, look, true, <Text color={look.colors.text}>I'll check the server first.</Text>, [])}
      {toolLine(ui, look, { tools: [{ tool: 'Read', label: 'Read ×2' }, { tool: 'Grep', label: 'Grep' }], detail: '', status: 'ok' })}
      {toolLine(ui, look, { tools: [{ tool: 'Bash', label: 'Bash' }], detail: 'npm test', status: 'ok' })}
      {toolLine(ui, look, { tools: [{ tool: 'Edit', label: 'Edit' }], detail: 'src/server.ts', status: 'running' })}
      {turnRule(ui, look, 42000)}
    </Box>
  )
}
