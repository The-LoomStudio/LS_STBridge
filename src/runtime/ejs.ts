import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { newQuickJSWASMModule, newVariant, RELEASE_SYNC } from 'quickjs-emscripten'
import type {
  ExtensionPromptEntry, ExtensionPromptEntryPatch, ExtensionPromptProcessor,
  ExtensionPromptProcessingContext,
} from '@loom-studio/extension-sdk'
import { ejsProcessorId, mvuComponentPath } from './constants.js'

const require = createRequire(import.meta.url)
const sourceBuild = import.meta.url.endsWith('.ts')
const librarySources = Promise.all([
  readFile(sourceBuild ? require.resolve('ejs/ejs.js') : new URL('../assets/ejs.js', import.meta.url), 'utf8'),
  readFile(sourceBuild ? require.resolve('lodash/lodash.js') : new URL('../assets/lodash.js', import.meta.url), 'utf8'),
])
let quickJs: ReturnType<typeof newQuickJSWASMModule> | undefined
function getEngine() {
  return quickJs ??= newQuickJSWASMModule(newVariant(RELEASE_SYNC, {
    wasmBinary: async () => {
      const path = sourceBuild
        ? createRequire(require.resolve('quickjs-emscripten')).resolve('@jitl/quickjs-wasmfile-release-sync/wasm')
        : new URL('../assets/quickjs.wasm', import.meta.url)
      return Uint8Array.from(await readFile(path)).buffer
    },
  }))
}

export const ejsProcessor: ExtensionPromptProcessor = {
  id: ejsProcessorId,
  async create(context) {
    context.signal.throwIfAborted()
    const sources = await librarySources
    const module = await getEngine()
    const runtime = module.newRuntime()
    runtime.setMemoryLimit(64 * 1024 * 1024)
    runtime.setMaxStackSize(512 * 1024)
    let deadline = Date.now() + 2_000
    runtime.setInterruptHandler(() => context.signal.aborted || Date.now() > deadline)
    const vm = runtime.newContext()
    let disposed = false
    const evaluate = (code: string): unknown => {
      context.signal.throwIfAborted()
      const result = vm.evalCode(code, 'stbridge-ejs.js')
      if (result.error) {
        const error = vm.dump(result.error)
        result.error.dispose()
        throw new Error(`EJS: ${error.message ?? String(error)}`)
      }
      const value = vm.dump(result.value)
      result.value.dispose()
      return value
    }
    try {
      for (const source of sources) evaluate(source)
      evaluate(guestEnvironment(context))
    } catch (error) {
      vm.dispose()
      runtime.dispose()
      throw error
    }
    const render = async (content: string, label: string): Promise<string> => {
      if (content.length > 256_000) throw new Error(`EJS template exceeds 256 KB: ${label}`)
      deadline = Date.now() + 2_000
      evaluate(`globalThis.__result = undefined; globalThis.__error = undefined;
        Promise.resolve(ejs.render(${JSON.stringify(content)}, {}, {
          async: true, client: true, _with: true, outputFunctionName: 'print',
          filename: ${JSON.stringify(label)}
        })).then(value => { globalThis.__result = __expandMvuMacros(String(value)) })
          .catch(error => { globalThis.__error = String(error) }); undefined;`)
      for (;;) {
        context.signal.throwIfAborted()
        if (Date.now() > deadline) throw new Error(`EJS deadline exceeded: ${label}`)
        const error = evaluate('globalThis.__error')
        if (error !== undefined) throw new Error(`EJS ${label}: ${String(error)}`)
        const result = evaluate('globalThis.__result')
        if (typeof result === 'string') {
          if (result.length > 1_000_000) throw new Error(`EJS output exceeds 1 MB: ${label}`)
          return result
        }
        const jobs = runtime.executePendingJobs(100)
        if (jobs.error) {
          const error = vm.dump(jobs.error)
          jobs.error.dispose()
          throw new Error(`EJS ${label}: ${error.message ?? String(error)}`)
        }
        if (!jobs.value) throw new Error(`EJS has an unresolved external promise: ${label}`)
        // Allow lifecycle cancellation between bounded guest job batches.
        await new Promise<void>(resolve => setImmediate(resolve))
      }
    }
    const prepared = new Map<string, string>()
    return {
      async prepare(entries) {
        evaluate(`globalThis.__entries = ${JSON.stringify(entries)};
          globalThis.__activations = {}; globalThis.__preparing = true;`)
        const patches: ExtensionPromptEntryPatch[] = []
        const excluded = new Set<string>()
        for (const entry of entries) {
          const { content, directives } = splitDirectives(entry)
          if (entry.label.toLowerCase().includes('[initvar]')) {
            patches.push({ id: entry.id, active: false })
            excluded.add(entry.id)
            continue
          }
          for (const condition of directives.filter(item => item.name === 'if')) {
            if (await render(`<%- !!(${condition.argument}) %>`, `${entry.label}: @@if`) === 'false') {
              excluded.add(entry.id)
              break
            }
          }
          if (excluded.has(entry.id)) {
            patches.push({ id: entry.id, active: false })
            continue
          }
          const preprocessing = entry.label.includes('[Preprocessing]') || directives.some(item => item.name === 'preprocessing')
          if (preprocessing) {
            prepared.set(entry.id, await render(content, entry.label))
            patches.push({ id: entry.id, content: prepared.get(entry.id) })
          } else patches.push({ id: entry.id, content })
          if (directives.some(item => item.name === 'activate')) patches.push({ id: entry.id, active: true })
          if (directives.some(item => item.name === 'dont_activate')) patches.push({ id: entry.id, active: false })
        }
        const activations = evaluate('globalThis.__activations') as Record<string, boolean>
        // Explicit activation does not bypass an author's false @@if condition.
        for (const [id, active] of Object.entries(activations)) {
          if (!excluded.has(id)) patches.push({ id, active })
        }
        evaluate('globalThis.__preparing = false')
        return patches
      },
      async render(entry) {
        return prepared.get(entry.id) ?? await render(entry.content, entry.label)
      },
      dispose() {
        if (disposed) return
        disposed = true
        vm.dispose()
        runtime.dispose()
      },
    }
  },
}

function splitDirectives(entry: ExtensionPromptEntry) {
  const directives: Array<{ name: string; argument: string }> = []
  const content = entry.content.replace(/^@@(\w+)(?:[ \t]+([^\r\n]*))?[ \t]*\r?$/gm, (_line, name: string, argument = '') => {
    if (!['if', 'preprocessing', 'activate', 'dont_activate'].includes(name))
      throw new Error(`Unsupported EJS worldbook directive @@${name}: ${entry.label}`)
    directives.push({ name, argument })
    return ''
  })
  return { content, directives }
}

function guestEnvironment(context: ExtensionPromptProcessingContext): string {
  const path = mvuComponentPath.slice(1).split('/')
  return `
    globalThis.__timeline = ${JSON.stringify(context.timeline?.value ?? null)};
    globalThis.__mvu = __timeline && _.get(__timeline, ${JSON.stringify(path)});
    const unsupported = name => { throw Error(name + ' is outside STBridge data-layer compatibility') };
    globalThis.getvar = globalThis.getVariable = function(path, options = {}) {
      if (typeof options !== 'object' || options === null) unsupported('getvar options');
      if (options.withMsg !== undefined || options.message_id !== undefined
        || options.swipe_id !== undefined || (options.scope && !['cache', 'message'].includes(options.scope)))
        unsupported('historical/global/local getvar');
      if (!__mvu) throw Error('MVU State is unavailable for this build');
      let value = path == null ? __mvu : _.get(__mvu, path, options.defaults);
      if (options.index != null) value = _.get(typeof value === 'string' ? JSON.parse(value) : value, options.index, options.defaults);
      return options.clone ? _.cloneDeep(value) : value;
    };
    globalThis.Mvu = { getMvuData(options = {}) {
      if (options.type && options.type !== 'message'
        || options.message_id != null && options.message_id !== 'latest' && options.message_id !== -1
        || options.script_id !== undefined || options.swipe_id !== undefined)
        unsupported('historical Mvu.getMvuData');
      return getvar(null);
    }};
    globalThis.getVariables = function(options = {}) {
      if (options.type && options.type !== 'message'
        || options.message_id != null && options.message_id !== 'latest' && options.message_id !== -1
        || options.script_id !== undefined || options.swipe_id !== undefined)
        unsupported('historical getVariables');
      return getvar(null);
    };
    globalThis.setvar = globalThis.setVariable = () => unsupported('persistent EJS writes');
    globalThis.__expandMvuMacros = text => text.replace(/\\{\\{get_message_variable::([^{}]+)\\}\\}/g, (_, path) => {
      if (path.includes('::')) unsupported('historical message-variable macro');
      const value = getvar(path.trim());
      return value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    });
    globalThis.activewi = globalThis.activateWorldInfo = async function(world, uid, force) {
      if (!__preparing) throw Error('activewi must run in an EJS preprocessing entry');
      if (typeof uid === 'boolean' || uid === undefined) { force = uid; uid = world; world = undefined; }
      if (force !== true) unsupported('non-forced activewi / ST recursive activation scan');
      const matches = __entries.filter(entry => entry.kind === 'lore'
        && (world === undefined || (world instanceof RegExp ? world.test(entry.sourceLabel) : String(world) === entry.sourceLabel))
        && (uid instanceof RegExp ? uid.test(entry.label)
          : typeof uid === 'number' ? entry.metadata?.stUid === uid
          : entry.label === String(uid) || entry.sourceNodeId === String(uid)));
      if (matches.length > 1) throw Error('Ambiguous worldbook entry: ' + String(uid));
      const entry = matches[0];
      if (!entry) return null;
      if (entry.label.toLowerCase().includes('[initvar]')) throw Error('initvar is not a prompt entry');
      __activations[entry.id] = true;
      return { world: entry.sourceLabel, uid: entry.metadata?.stUid, comment: entry.label, content: entry.content };
    };
  `
}
