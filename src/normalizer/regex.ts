import type { TextTransformPhase, TextTransformRuleDraft } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'

export type SillyTavernRegexScript = {
  id?: string
  scriptName?: string
  findRegex?: string
  replaceString?: string
  trimStrings?: string[]
  placement?: number[] | string[]
  disabled?: boolean
  markdownOnly?: boolean
  promptOnly?: boolean
  minDepth?: number
  maxDepth?: number
}

export function convertSillyTavernRegexScripts(
  value: JsonValue | undefined,
): Array<Omit<TextTransformRuleDraft, 'owner'>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const script = raw as unknown as SillyTavernRegexScript
    if (typeof script.findRegex !== 'string' || !script.findRegex) return []
    const parsed = parseRegex(script.findRegex)
    const phases = phasesForScript(script)
    if (phases.length === 0) return []
    const minDepth = Number.isInteger(script.minDepth) && script.minDepth! >= 0 ? script.minDepth : undefined
    const maxDepth = Number.isInteger(script.maxDepth) && script.maxDepth! >= (minDepth ?? 0) ? script.maxDepth : undefined
    return [{
      name: script.scriptName?.trim() || `SillyTavern Regex ${index + 1}`,
      enabled: script.disabled !== true,
      orderIndex: index,
      matcher: { kind: 'regex', pattern: parsed.pattern, flags: parsed.flags },
      effect: { kind: 'replace', replacement: (script.replaceString ?? '').replaceAll('{{match}}', '$0') },
      targets: ['narrative', 'agent-session'],
      phases,
      ...(minDepth !== undefined || maxDepth !== undefined ? { range: { minDepth, maxDepth } } : {}),
    }]
  })
}

export function diagnoseSillyTavernRegexScripts(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const script = raw as unknown as SillyTavernRegexScript & { runOnEdit?: boolean }
    const name = script.scriptName?.trim() || `Regex ${index + 1}`
    return [
      ...(Array.isArray(script.trimStrings) && script.trimStrings.length > 0
        ? [`${name}: trimStrings 无法在声明式 replacement 中逐捕获组等价映射`]
        : []),
      ...(script.runOnEdit === true ? [`${name}: runOnEdit 被忽略，Loom 当前没有独立编辑阶段`] : []),
    ]
  })
}

function phasesForScript(script: SillyTavernRegexScript): TextTransformPhase[] {
  if (script.promptOnly || script.markdownOnly) return [
    ...(script.promptOnly ? ['prompt' as const] : []),
    ...(script.markdownOnly ? ['display' as const] : []),
  ]
  if (!Array.isArray(script.placement) || script.placement.length === 0) return ['prompt', 'display']
  const placement = new Set(script.placement.map(value => String(value)))
  const hasPromptPlacement = placement.has('1') || placement.has('2') || placement.has('USER_INPUT') || placement.has('AI_OUTPUT')
  const hasDisplayPlacement = placement.has('0') || placement.has('2') || placement.has('MD_DISPLAY') || placement.has('AI_OUTPUT')
  return [
    ...(hasPromptPlacement ? ['prompt' as const] : []),
    ...(hasDisplayPlacement ? ['display' as const] : []),
  ]
}

function parseRegex(value: string): { pattern: string; flags: string } {
  if (value.startsWith('/')) {
    const end = value.lastIndexOf('/')
    if (end > 0) return { pattern: value.slice(1, end), flags: value.slice(end + 1).trim() || 'g' }
  }
  return { pattern: value, flags: 'g' }
}
