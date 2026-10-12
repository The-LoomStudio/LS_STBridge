// Read-only source-card probe. All Loom writes use a transient in-memory database.
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApplicationRuntime, createPromptProcessorRegistry, createStateContributionRegistry, createStateContentRegistry } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '../../../packages/data-engine/dist/index.js'
import { createSqliteDocumentStore } from '../../../packages/document-store/dist/index.js'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '../../../packages/application-data/dist/index.js'
import { registerStDataRuntime } from '../dist/runtime/register.js'
import { convertSillyTavernCard } from '../dist/normalizer/card.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const filename = resolve(process.argv[2] ?? `${root}/drafts/MagVarUpdate-beta/example/artifact/青空 理.png`)
const engine = createSqliteDataEngine({
  filename: ':memory:', createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString(),
})
const promptProcessors = createPromptProcessorRegistry()
const stateContributions = createStateContributionRegistry()
const stateContent = createStateContentRegistry()
registerStDataRuntime({
  prompt: { registerProcessor: processor => promptProcessors.register(processor) },
  state: {
    contribute: (contribution, options) => stateContributions.register({
      contribution, initialize: options?.initialize,
      packageId: 'sillytavern.importer', packageVersion: '0.1.0', moduleId: 'server', instanceId: 'upstream-probe',
    }),
    registerContentHandler: handler => stateContent.register(handler, {
      packageId: 'sillytavern.importer', target: { kind: 'global' },
    }),
  },
})
let providerCalls = 0
const text = '_.add("理.好感度", 5);'
const runtime = createApplicationRuntime({
  dataEngine: engine, documents: createSqliteDocumentStore({ engine }), agents: createAgentStore({ engine }),
  narratives: createNarrativeStore({ engine }), promptResources: createPromptResourceStore({ engine }),
  promptProcessors, stateContributions, stateContent,
  gateway: { invokeChat: async () => {
    providerCalls += 1
    return { provider: 'fixture', model: 'test', text, message: { role: 'assistant', content: text } }
  } },
})
try {
  await runtime.initialize()
  const converted = convertSillyTavernCard(await readFile(filename))
  const { card } = await runtime.importCardBundle({ artifact: converted.artifact })
  const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
  const preset = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'Upstream data probe' })).resource
  const profile = (await runtime.createProviderProfile({
    providerExtensionId: 'official.openai-compatible', displayName: 'Fixture', config: {}, enabledModelIds: ['test'],
  })).providerProfile
  await runtime.updateAgentPreset({ agentPresetId: preset.id, expectedVersion: preset.version,
    model: { providerProfileId: profile.id, modelId: 'test' } })
  const { session } = await runtime.createAgentSession({ agentPresetId: preset.id, timelineId: timeline.id })
  const target = { timelineId: timeline.id, branchId: branch.id }
  const value = async () => (await runtime.getStateSnapshot({ target: { scope: 'timeline', ...target } }))
    .snapshot.value.entities.stCompatibility.mvu.components.data.stat_data.理.好感度[0]
  const before = await value()
  const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: '继续', narrativeTarget: target })
  if (preview.messages.some(message => message.content?.includes('{{get_message_variable::')))
    throw new Error('MVU macro was not expanded')
  await runtime.invokeAgentTurn({ agentSessionId: session.id, input: '继续', narrativeTarget: target })
  const after = await value()
  if (before !== 0 || after !== 5) throw new Error('Unexpected upstream MVU state')
  console.log(JSON.stringify({
    sample: filename, before, after, providerCalls, promptMessages: preview.messages.length,
    unexpandedMvuMacros: 0, importDiagnostics: converted.diagnostics.length,
  }))
} finally { await engine.close() }
