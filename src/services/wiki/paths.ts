import { join } from 'path'
import { resolveProjectStateDirname } from '../../utils/productStateDir.js'
import type { WikiPaths } from './types.js'

export const WIKI_DIRNAME = 'wiki'

export function getWikiPaths(cwd: string): WikiPaths {
  // Prefer `.limitless/wiki`, but keep reading an existing `.openclaude/wiki`
  // so a project's wiki survives the rename without a move.
  const root = join(cwd, resolveProjectStateDirname(cwd), WIKI_DIRNAME)

  return {
    root,
    pagesDir: join(root, 'pages'),
    sourcesDir: join(root, 'sources'),
    schemaFile: join(root, 'schema.md'),
    indexFile: join(root, 'index.md'),
    logFile: join(root, 'log.md'),
  }
}
