import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

function makeOpenclaudeAlias(
  name: string,
  model: string,
  label: string,
): Command {
  return {
    type: 'local-jsx',
    name,
    description: `Switch model to ${label} (${model})`,
    get immediate() {
      return shouldInferenceConfigCommandBeImmediate()
    },
    load: async () => {
      const modelModule = await import('../model/model.js')
      const call: LocalJSXCommandCall = async (onDone, context, _args) =>
        modelModule.call(onDone, context, model)
      return { ...modelModule, call }
    },
  } satisfies Command
}

export const openclaudeQwen30b = makeOpenclaudeAlias(
  'openclaude',
  'qwen3-30b-abliterated-q6:latest',
  'qwen3-30b-abliterated',
)
export const openclaudeDolphin = makeOpenclaudeAlias(
  'openclaude-dolphin',
  'dolphin3:8b',
  'Dolphin 3 8B',
)
export const openclaudeWrn = makeOpenclaudeAlias(
  'openclaude-wrn',
  'whiterabbitneo-33b-v1.5:latest',
  'WhiteRabbitNeo 33B v1.5',
)
export const openclaudeOllama7b = makeOpenclaudeAlias(
  'openclaude-ollama7b',
  'qwen2.5-coder:7b',
  'Qwen2.5-Coder 7B',
)
