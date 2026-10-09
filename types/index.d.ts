export type Row = {
  tools: number
  lastTool: string
  files: Record<string, number>
  input: number
  output: number
  cached: number
}

declare module 'claude-code' {
  interface PluginState {
    'dev-radar': {
      rows: Record<string, Row>
      unchecked: number
      tick: number
    }
  }
}
