export type ToolDetail = 'summary' | 'full'
export type PaletteChoice = 'auto' | 'dark' | 'contrast' | 'colorblind' | 'theme'
export type PaletteName = Exclude<PaletteChoice, 'auto'>
export type Alerts = 'off' | 'notify' | 'sound' | 'both'
export type PanelChoice = 'auto' | 'off'
/** The editor terminal's font: clarity's readable sizes, or left as the person has it. */
export type FontChoice = 'leave' | 'readable' | 'large'
/** Symbols as drawn: unicode, or plain ASCII for terminals and fonts without them. */
export type IconChoice = 'unicode' | 'ascii'

export type Prefs = {
  /** The mod draws at all; off hands every row back to the engine. */
  isOn: boolean
  /** Focus hides notices and successful tool output entirely. */
  isFocus: boolean
  tools: ToolDetail
  palette: PaletteChoice
  alerts: Alerts
  /** The status band above the prompt. */
  band: boolean
  /** auto opens the session panel beside the transcript once the terminal is wide enough. */
  panel: PanelChoice
  /** The widest a reply's prose runs, in columns; 0 for the full width. (Was `width`, whose
   *  100-column default read too long: renamed so stored prefs take the new default.) */
  measure: number
  copy: boolean
  font: FontChoice
  icons: IconChoice
}

export type Env = {
  /** The person's /config theme, which `auto` follows. */
  theme: string
}

export type Phase = 'idle' | 'thinking' | 'writing' | 'tool' | 'waiting' | 'compacting'

/** What the main loop is doing now, for the band and the spinner. */
export type Activity = {
  phase: Phase
  tool: string
  detail: string
  /** When the turn began, ms. */
  since: number
  /** Tokens the model has written this turn: estimated as it streams, exact at each step's end. */
  tokens: number
}

export type FileChange = { added: number; removed: number; edits: number }
export type ToolError = { tool: string; detail: string; text: string }

/** One item of the plan Claude keeps with TodoWrite. */
export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }

/** One finished tool call, for the panel's Recent list. */
export type RecentAction = { at: number; tool: string; detail: string; isOk: boolean }

/** What one turn did, for the card that closes a long turn. */
export type TurnSummary = { tools: number; files: number; added: number; removed: number; failed: number }

/** Tool calls made back to back, with no text between them: drawn as one strip until opened. */
export type ToolRun = { ids: string[]; tools: string[]; running: number; failed: number }

/** Where one call sits in its run; the run is keyed by its first call's id. */
export type RunPlace = { run: string; index: number }

/** What this session has done, for the panel and the band. */
export type Ledger = {
  /** Each prompt's first line, for the panel; `prompts` holds them whole, for copying. */
  turns: string[]
  prompts: string[]
  files: Record<string, FileChange>
  errors: ToolError[]
  lastReply: string
  /** Percent of the context window in use, when known. */
  context: number | null
  /** What the session has cost so far, in US dollars, when known. */
  cost: number | null
  /** The plan usage limit nearest to running out, when Claude Code reports one. */
  limit: { percent: number; resetsAt: string | null } | null
  /** Why the last turn stopped, when it died on an error (a usage limit, the context limit). */
  stopped: string | null
  todos: Todo[]
  recent: RecentAction[]
  /** Subagents running now. */
  agents: number
  /** Each long turn's summary, by its duration in ms (what the turn's closing row carries). */
  summaries: Record<string, TurnSummary>
}

declare module 'claude-code' {
  interface PluginState {
    clarity: {
      prefs: Prefs
      env: Env
      activity: Activity
      ledger: Ledger
      /** The clock, ticked each second while a turn runs, so the band's timer redraws. */
      tick: number
      /** Each tool row (or run, by its first id) the person clicked open, by tool_use_id. */
      expanded: StateFamily<boolean>
      runs: StateFamily<ToolRun | null>
      places: StateFamily<RunPlace | null>
    }
  }
}
