import type { ExtensionActivationContext } from '@loom-studio/extension-sdk'
import type { StateContribution } from '@loom-studio/shared'
import { ejsProcessor } from './ejs.js'
import { mvuComponentPath, mvuContributionId } from './constants.js'
import { runMvu } from './mvu.js'

export const mvuContribution: StateContribution = {
  id: mvuContributionId,
  entityTypes: [{ id: 'sillytavern-importer-compatibility', collectionPath: 'entities.stCompatibility' }],
  entities: [{ typeId: 'sillytavern-importer-compatibility', entityId: 'mvu' }],
  templates: [{
    id: mvuContributionId, templateVersion: 1, componentKey: 'data',
    targetEntityTypeIds: ['sillytavern-importer-compatibility'],
    schema: {
      type: 'object', required: ['stat_data', 'schema', 'initialized_lorebooks'],
      properties: { stat_data: { type: 'object' }, schema: { type: 'object' }, initialized_lorebooks: { type: 'object' } },
    },
    initial: { stat_data: {}, schema: {}, initialized_lorebooks: {} },
  }],
  componentMounts: [{
    templateId: mvuContributionId, templateVersion: 1, componentKey: 'data',
    target: { kind: 'entity', entity: { typeId: 'sillytavern-importer-compatibility', entityId: 'mvu' } },
  }],
  bindings: [],
}

export function registerStDataRuntime(ctx: ExtensionActivationContext): void {
  ctx.prompt.registerProcessor(ejsProcessor)
  ctx.state.contribute(mvuContribution, {
    async initialize(context) {
      const result = await runMvu({ kind: 'initialize', context: {
        opening: context.opening, resources: context.resources,
      } }, context.signal)
      return { [mvuContributionId]: result.value }
    },
  })
  ctx.state.registerContentHandler({
    id: 'sillytavern.importer/mvu',
    contributionId: mvuContributionId,
    path: mvuComponentPath,
    async process(input) {
      if (!/_\.(?:set|insert|assign|remove|unset|delete|add)\(|<json_?patch>/i.test(input.text)) return undefined
      const result = await runMvu({ kind: 'update', text: input.text, value: input.value }, input.signal)
      return { value: result.value, diagnostics: result.diagnostics.map(item => ({
        message: `${item.command}: ${item.content}`,
      })) }
    },
  })
}
