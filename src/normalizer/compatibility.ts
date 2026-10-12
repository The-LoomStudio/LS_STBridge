import type { PromptResourceNode } from '@loom-studio/application-runtime'
import { ejsProcessorId } from '../runtime/constants.js'

export function markEjsResources(root: PromptResourceNode): void {
  const entries: PromptResourceNode[] = []
  const visit = (node: PromptResourceNode) => {
    if (node.kind === 'entry') entries.push(node)
    node.children?.forEach(visit)
  }
  visit(root)
  const usesEjs = entries.some(node => /<%|^@@|\{\{get_message_variable::/m.test(node.body ?? '') || node.label.includes('[Preprocessing]'))
  for (const node of entries) {
    if (usesEjs || node.label.toLowerCase().includes('[initvar]'))
      node.capabilities = { ...node.capabilities, processorId: ejsProcessorId }
  }
}
