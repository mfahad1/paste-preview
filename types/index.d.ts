export type Shot = {
  /** Absolute path of the PNG the terminal draws. */
  file: string
  /** The placeholder the prompt shows for it, such as "[Image #7]". */
  label: string
  columns: number
  rows: number
}

declare module 'claude-code' {
  interface PluginState {
    'paste-preview': { shots: Shaped<Record<string, Shot>> }
  }
}
