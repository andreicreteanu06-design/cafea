import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Row } from '../types'

const PANE = 'dev-radar'
const MAIN = 'main'
const CHECK =
  /\b(test|vitest|jest|pytest|tsc|eslint|ruff|mypy|clippy|lint|typecheck|build)\b/
const empty = (): Row => ({
  tools: 0,
  lastTool: '',
  files: {},
  input: 0,
  output: 0,
  cached: 0,
})

const rows = atom({ plugin: 'dev-radar', key: 'rows' } as const, {})
const unchecked = atom({ plugin: 'dev-radar', key: 'unchecked' } as const, 0)
const tick = atom({ plugin: 'dev-radar', key: 'tick' } as const, 0)

const short = (path: string) => path.split('/').slice(-2).join('/')
const kilo = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

function touch(
  $: Parameters<typeof update>[0],
  id: string,
  change: (row: Row) => Row,
) {
  return update($, rows, all => ({ ...all, [id]: change(all[id] ?? empty()) }))
}

export const register: Register = on => {
  const seen = new Set<string>()
  let isBusy = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'radar',
      description: 'Deschide panoul cu subagenți, fișiere editate și tokeni',
    })
    void $.ui.open({ id: PANE, title: 'Radar' })
    $.clock.every(3000, () => {
      if (isBusy) void update($, tick, n => n + 1)
    })

    return next(e)
  })

  on('command.run', { command: 'radar' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Radar' })

    return { text: 'Panoul Radar este deschis.' }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    isBusy = true

    // Citire repetată a aceluiași fișier, fără nicio editare între ele:
    // doar avertizăm (nu blocăm), ca să nu stricăm fluxul.
    if (e.tool === 'Read' && e.offset === undefined && e.limit === undefined) {
      const key = `${id}:${e.file_path}`
      if (seen.has(key)) {
        $.ui.toast(`Re-citești tot ${short(e.file_path)}: costă tokeni degeaba.`)
      }
      seen.add(key)
    }

    if (e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit') {
      const path = 'file_path' in e ? e.file_path : e.notebook_path
      seen.delete(`${id}:${path}`)
      await touch($, id, row => ({
        ...row,
        files: { ...row.files, [path]: (row.files[path] ?? 0) + 1 },
      }))
      await update($, unchecked, n => n + 1)
    }

    if (e.tool === 'Bash' && CHECK.test(e.command)) {
      await update($, unchecked, () => 0)
    }

    await touch($, id, row => ({ ...row, tools: row.tools + 1, lastTool: e.tool }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const u = e.usage
    if (u) {
      await touch($, id, row => ({
        ...row,
        input: row.input + u.input_tokens + u.cache_creation_input_tokens,
        output: row.output + u.output_tokens,
        cached: row.cached + u.cache_read_input_tokens,
      }))
    }
    if (id === MAIN) isBusy = false
    await update($, tick, n => n + 1)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const all = await read($, rows)
    const agents = await $.agent.list()
    await read($, tick)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)

    const ids = [MAIN, ...agents.map(a => a.id)].filter(
      (id, i, list) => list.indexOf(id) === i,
    )

    return (
      <Box flexDirection="column">
        {ids.slice(0, room).map(id => {
          const info = agents.find(a => a.id === id)
          const row = all[id] ?? empty()
          const files = Object.entries(row.files)
          const title =
            id === MAIN ? 'sesiune principală' : `${info?.type ?? 'agent'}: ${info?.description ?? id}`
          const state = id === MAIN ? '' : ` [${info?.status ?? '?'}]`

          return (
            <Box key={id} flexDirection="column" marginBottom={1}>
              <Text bold>
                {title}
                {state}
              </Text>
              <Text dimColor>
                {row.tools} unelte (ultima: {row.lastTool || '-'}) · in {kilo(row.input)} · out{' '}
                {kilo(row.output)} · cache {kilo(row.cached)}
              </Text>
              {files.length === 0 && <Text dimColor>  nu a editat nimic</Text>}
              {files.slice(-5).map(([path, n]) => (
                <Text key={path}>
                  {'  ✎ '}
                  {short(path)}
                  {n > 1 ? ` ×${n}` : ''}
                </Text>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await read($, tick)
    const { context, cost } = await $.session.usage()
    const pending = await read($, unchecked)
    const { Box, Text } = $.ui.resolve(e)
    const percent = context.percent ?? 0
    const hint = percent >= 70 ? ' → rulează /compact sau /clear' : ''

    return (
      <Box>
        <Text dimColor={percent < 70}>
          ctx {percent}%{hint}
          {cost ? ` · $${cost.usd.toFixed(2)}` : ''}
        </Text>
        {pending > 0 && (
          <Text color="yellow">
            {' · '}
            {pending} editări nerulate prin test/lint
          </Text>
        )}
      </Box>
    )
  })
}
