import type { Command } from '../../commands.js'

const provider = {
  type: 'local-jsx',
  name: 'provider',
  description: 'Manage provider logins and profiles',
  load: () => import('./provider.js'),
} satisfies Command

export default provider
