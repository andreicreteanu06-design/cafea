import { expect, test } from 'claude-code/testing'

import { register } from './register'

test('nu blochează uneltele: Bash trece prin mod', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }))
  register(on, {})

  const bash = await $.tool.call({ tool: 'Bash', command: 'npm run test' })

  expect(bash.deny).toBeUndefined()
})
