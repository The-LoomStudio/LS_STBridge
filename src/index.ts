import { defineServerExtension } from '@loom-studio/extension-sdk'
import { isRecord, type JsonValue } from '@loom-studio/shared'
import { extractPngImageBytes, extractStCardFromPng, isPngFile } from './parser/png-reader.js'
import { sniffData } from './parser/sniffer.js'
import { convertSillyTavernCard } from './normalizer/card.js'
import { convertSillyTavernLorebook } from './normalizer/lorebook.js'
import { convertSillyTavernPreset } from './normalizer/preset.js'
import { convertSillyTavernChat } from './parser/chat.js'
import type { SillyTavernCard, SillyTavernLorebookData, SillyTavernPresetData } from './types.js'
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { registerStDataRuntime } from './runtime/register.js'

type MigrationSession = {
  createdAt: number
  files: Set<string>
  sources: Map<string, { kind: string; source: JsonValue }>
  chunks: Map<string, { kind: string; total: number; parts: Map<number, number[]> }>
  stagingDirectory: string
  scanController: AbortController
  scanTask?: Promise<void>
  totalBytes: number
  counts: { cards: number; chats: number; presets: number; worlds: number; unknown: number }
  scan: { status: 'pending' | 'scanning' | 'completed' | 'failed'; processed: number; total: number; currentPath: string; error?: string }
}

const migrationSessionTtlMs = 30 * 60 * 1000
const migrationMaxFiles = 20_000
const migrationMaxBytes = 4 * 1024 * 1024 * 1024
const migrationBatchBytes = 128 * 1024
const migrationMaxChunksPerFile = Math.ceil(migrationMaxBytes / migrationBatchBytes)

function sourceFileName(): string {
  return `${crypto.randomUUID()}.bin`
}

function compatibleMigrationKind(path: string): 'card' | 'chat' | 'preset' | 'world' | undefined {
  const lower = path.toLowerCase().replaceAll('\\', '/')
  if (/(^|\/)characters\/[^/]+\.(png|json)$/.test(lower)) return 'card'
  if (/(^|\/)chats\/[^/]+\/[^/]+\.jsonl$/.test(lower)) return 'chat'
  if (/(^|\/)worlds\/[^/]+\.json$/.test(lower)) return 'world'
  if (/(^|\/)openai settings\/[^/]+\.json$/.test(lower)) return 'preset'
  return undefined
}

async function scanDirectory(session: MigrationSession, inputDirectory: string, signal: AbortSignal): Promise<void> {
  try {
    signal.throwIfAborted()
    session.scan.status = 'scanning'
    const root = await realpath(resolve(inputDirectory))
    if (!(await stat(root)).isDirectory()) throw new Error('指定路径不是目录')
    const defaultUser = join(root, 'default-user')
    const scanRoot = await stat(defaultUser).then(value => value.isDirectory() ? defaultUser : root).catch(() => root)
    const paths: string[] = []
    const roots = ['characters', 'chats', 'worlds', 'OpenAI Settings']
    for (const child of roots) {
      signal.throwIfAborted()
      const directory = join(scanRoot, child)
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) } catch { continue }
      const queue = entries.map(entry => join(directory, entry.name))
      while (queue.length) {
        signal.throwIfAborted()
        const candidate = queue.shift()!
        const info = await stat(candidate)
        if (info.isDirectory() && child === 'chats') {
          for (const entry of await readdir(candidate, { withFileTypes: true })) queue.push(join(candidate, entry.name))
          continue
        }
        if (!info.isFile()) continue
        const relativePath = relative(scanRoot, candidate).split(sep).join('/')
        if (compatibleMigrationKind(relativePath)) paths.push(relativePath)
      }
    }
    session.scan.total = paths.length
    for (const path of paths) {
      signal.throwIfAborted()
      session.scan.currentPath = path
      const kind = compatibleMigrationKind(path)!
      const source = await readFile(join(scanRoot, path), { signal })
      signal.throwIfAborted()
      if (session.totalBytes + source.byteLength > migrationMaxBytes) throw new Error(`Migration exceeds ${migrationMaxBytes} bytes`)
      const filename = sourceFileName()
      await writeFile(join(session.stagingDirectory, filename), source, { mode: 0o600, signal })
      session.files.add(path)
      session.sources.set(path, { kind, source: filename })
      session.totalBytes += source.byteLength
      const key = kind === 'card' ? 'cards' : kind === 'chat' ? 'chats' : kind === 'preset' ? 'presets' : 'worlds'
      session.counts[key] += 1
      session.scan.processed += 1
    }
    session.scan.status = 'completed'
  } catch (error) {
    session.scan.status = 'failed'
    session.scan.error = error instanceof Error ? error.message : String(error)
  }
}

export {
  extractPngImageBytes,
  extractStCardFromPng,
  isPngFile,
  sniffData,
  convertSillyTavernCard,
  convertSillyTavernLorebook,
  convertSillyTavernPreset,
  convertSillyTavernChat,
}

export * from './types.js'

export const activate = defineServerExtension({
  activate: ctx => {
    registerStDataRuntime(ctx)
    const migrationSessions = new Map<string, MigrationSession>()
    async function expireMigrationSession(sessionId: string, session: MigrationSession): Promise<void> {
      session.scanController.abort()
      await session.scanTask
      await rm(session.stagingDirectory, { recursive: true, force: true })
      migrationSessions.delete(sessionId)
    }

    ctx.rpc.register('sillytavern.importer.migration.start', async params => {
      const now = Date.now()
      for (const [sessionId, session] of migrationSessions) {
        if (now - session.createdAt > migrationSessionTtlMs) {
          await expireMigrationSession(sessionId, session)
        }
      }
      const id = `st-migration-${crypto.randomUUID()}`
      const stagingDirectory = await mkdtemp(join(tmpdir(), 'loom-st-migration-'))
      migrationSessions.set(id, {
        createdAt: now,
        files: new Set(),
        sources: new Map(),
        chunks: new Map(),
        stagingDirectory,
        scanController: new AbortController(),
        totalBytes: 0,
        counts: { cards: 0, chats: 0, presets: 0, worlds: 0, unknown: 0 },
        scan: { status: 'pending', processed: 0, total: 0, currentPath: '' },
      })
      if (isRecord(params) && typeof params.directory === 'string' && params.directory.trim()) {
        const session = migrationSessions.get(id)!
        session.scanTask = scanDirectory(session, params.directory.trim(), AbortSignal.any([
          ctx.lifecycle.signal, session.scanController.signal,
        ]))
        return { sessionId: id, mode: 'server' } as unknown as JsonValue
      }
      // Keep JSON/Base64 RPC requests well below the local HTTP body limit.
      return { sessionId: id, batchBytes: migrationBatchBytes } as unknown as JsonValue
    })
    ctx.rpc.register('sillytavern.importer.migration.appendBatch', async params => {
      if (!isRecord(params) || typeof params.sessionId !== 'string' || !Array.isArray(params.files)) {
        throw new Error('migration.appendBatch requires sessionId and files')
      }
      const session = migrationSessions.get(params.sessionId)
      if (!session || Date.now() - session.createdAt > migrationSessionTtlMs) {
        if (session) await expireMigrationSession(params.sessionId, session)
        throw new Error('Migration session expired')
      }
      const newPaths = new Set(params.files.flatMap(value => (
        isRecord(value) && typeof value.path === 'string' && !session.files.has(value.path) ? [value.path] : []
      )))
      if (session.files.size + newPaths.size > migrationMaxFiles) {
        throw new Error(`Migration exceeds ${migrationMaxFiles} files`)
      }
      const batchBytes = params.files.reduce<number>((total, value) => (
        total + (isRecord(value) && typeof value.chunk === 'string'
          ? Buffer.byteLength(Buffer.from(value.chunk, 'base64'))
          : isRecord(value) && typeof value.source === 'string' ? Buffer.byteLength(value.source, 'utf8')
            : isRecord(value) && Array.isArray(value.source) ? value.source.length : 0)
      ), 0)
      if (session.totalBytes + batchBytes > migrationMaxBytes) {
        throw new Error(`Migration exceeds ${migrationMaxBytes} bytes`)
      }
      for (const value of params.files) {
        if (!isRecord(value) || typeof value.path !== 'string') {
          throw new Error('Invalid migration file descriptor')
        }
        const path = normalizeMigrationPath(value.path)
        const pathKind = compatibleMigrationKind(path)
        if (!pathKind) throw new Error(`Migration path is unsupported: ${path}`)
        const kind = value.kind === undefined ? pathKind : typeof value.kind === 'string' ? value.kind : undefined
        if (!kind || kind !== pathKind) throw new Error(`Migration file kind does not match path: ${path}`)
        const decodedChunk = decodeMigrationChunk(value.chunk, path)
        const chunkIndex = typeof value.chunkIndex === 'number' ? value.chunkIndex : undefined
        const chunkCount = typeof value.chunkCount === 'number' ? value.chunkCount : undefined
        if (decodedChunk === undefined && value.source === undefined) {
          throw new Error(`Migration file source is missing: ${path}`)
        }
        if (value.source !== undefined && typeof value.source !== 'string' && !Array.isArray(value.source)) {
          throw new Error(`Migration file source is invalid: ${path}`)
        }
        if (decodedChunk !== undefined) {
          if (chunkIndex === undefined || chunkCount === undefined
            || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkCount)
            || chunkCount < 1 || chunkCount > migrationMaxChunksPerFile
            || chunkIndex < 0 || chunkIndex >= chunkCount) {
            throw new Error(`Migration chunk bounds are invalid: ${path}`)
          }
          const existing = session.chunks.get(path)
          if (existing && (existing.total !== chunkCount || existing.kind !== kind)) {
            throw new Error(`Migration chunk metadata changed: ${path}`)
          }
          if (existing?.parts.has(chunkIndex)) throw new Error(`Duplicate migration chunk: ${path}#${chunkIndex}`)
        }
        const detected = value.source !== undefined
          ? sniffData(Array.isArray(value.source) ? new Uint8Array(value.source as number[]) : value.source)
          : undefined
        const detectedKind = detected?.format.includes('card') ? 'card'
          : detected?.format.includes('chat') ? 'chat'
            : detected?.format.includes('preset') ? 'preset'
              : detected?.format.includes('lorebook') ? 'world' : undefined
        if (detectedKind && detectedKind !== kind) throw new Error(`Migration data kind does not match path: ${path}`)
        const firstChunk = !session.files.has(path)
        if (firstChunk) session.files.add(path)
        session.totalBytes += decodedChunk !== undefined
          ? decodedChunk.length
          : typeof value.source === 'string'
            ? Buffer.byteLength(value.source, 'utf8')
            : (value.source as number[]).length
        if (decodedChunk !== undefined) {
          const entry = session.chunks.get(path) ?? { kind, total: chunkCount as number, parts: new Map<number, number[]>() }
          entry.parts.set(chunkIndex as number, decodedChunk)
          session.chunks.set(path, entry)
          if (entry.parts.size === entry.total) {
            const source = [...entry.parts.entries()].sort(([a], [b]) => a - b).flatMap(([, part]) => part)
            const filename = sourceFileName()
            await writeFile(join(session.stagingDirectory, filename), Buffer.from(source), { mode: 0o600 })
            session.sources.set(path, {
              kind,
              source: filename,
            })
            session.chunks.delete(path)
          }
        } else if (value.source !== undefined) {
          const source = typeof value.source === 'string' ? Buffer.from(value.source) : Buffer.from(value.source as number[])
          const filename = sourceFileName()
          await writeFile(join(session.stagingDirectory, filename), source, { mode: 0o600 })
          session.sources.set(path, { kind, source: filename })
        }
        const key = kind === 'card' ? 'cards'
          : kind === 'chat' ? 'chats'
            : kind === 'preset' ? 'presets'
              : kind === 'world' ? 'worlds' : 'unknown'
        if (firstChunk) session.counts[key] += 1
      }
      return { accepted: params.files.length, counts: session.counts } as unknown as JsonValue
    })
    ctx.rpc.register('sillytavern.importer.migration.inspect', async params => {
      if (!isRecord(params) || typeof params.sessionId !== 'string') throw new Error('migration.inspect requires sessionId')
      const session = migrationSessions.get(params.sessionId)
      if (!session) throw new Error('Migration session not found')
      if (Date.now() - session.createdAt > migrationSessionTtlMs) {
        await expireMigrationSession(params.sessionId, session)
        throw new Error('Migration session expired')
      }
      return { counts: session.counts, files: session.files.size, bytes: session.totalBytes, scan: session.scan } as unknown as JsonValue
    })
    ctx.rpc.register('sillytavern.importer.migration.commit', async params => {
      if (!isRecord(params) || typeof params.sessionId !== 'string') throw new Error('migration.commit requires sessionId')
      const session = migrationSessions.get(params.sessionId)
      if (!session) throw new Error('Migration session not found')
      if (session.chunks.size > 0) throw new Error('Migration is incomplete: some files are still uploading')
      const cards = new Map<string, string>()
      const worlds = new Map<string, string>()
      let imported = 0
      for (const [, item] of session.sources) {
        if (item.kind === 'world') {
          const source = (await readFile(join(session.stagingDirectory, String(item.source)))).toString('utf8')
          const artifact = convertSillyTavernLorebook(source as string | SillyTavernLorebookData).artifact
          const key = semanticFingerprint(artifact.rootNode)
          if (!worlds.has(key)) {
            const created = await ctx.rpc.call<{ resource: { id: string } }>('application.importPromptResource', { artifact })
            worlds.set(key, created.resource.id)
            imported += 1
          }
        }
      }
      for (const [path, item] of session.sources) {
        if (item.kind === 'card') {
          const source = await readFile(join(session.stagingDirectory, String(item.source)))
          const artifact = convertSillyTavernCard(
            source,
          ).artifact
          const sharedIds: string[] = []
          artifact.contextAssets = artifact.contextAssets.filter(asset => {
            if (asset.category !== 'lore') return true
            const key = semanticFingerprint(asset)
            const worldId = worlds.get(key)
            if (!worldId) return true
            sharedIds.push(worldId)
            return false
          })
          const created = await ctx.rpc.call<{ card: { id: string; promptResourceIds?: string[] } }>('application.importCardBundle', { artifact })
          if (sharedIds.length) await ctx.rpc.call('application.updateCardPromptResources', {
            cardId: created.card.id,
            promptResourceIds: [...new Set([...(created.card.promptResourceIds ?? []), ...sharedIds])],
            externalPromptResourceIds: sharedIds,
          })
          cards.set(characterKeyFromPath(path), created.card.id)
          imported += 1
        } else if (item.kind === 'preset') {
          const source = (await readFile(join(session.stagingDirectory, String(item.source)))).toString('utf8')
          await ctx.rpc.call('application.importPromptResource', {
            artifact: convertSillyTavernPreset(JSON.parse(source) as SillyTavernPresetData).artifact,
          })
          imported += 1
        }
      }
      for (const [path, item] of session.sources) {
        if (item.kind !== 'chat') continue
        const key = characterKeyFromPath(path)
        const cardId = cards.get(key)
        if (!cardId) continue
        const source = (await readFile(join(session.stagingDirectory, String(item.source)))).toString('utf8')
        const chat = convertSillyTavernChat(source)
        await ctx.rpc.call('application.createNarrativeTimeline', { cardId, title: chat.title, openingNodes: chat.messages })
        imported += 1
      }
      await expireMigrationSession(params.sessionId, session)
      return { imported } as unknown as JsonValue
    })
    ctx.rpc.register('sillytavern.importer.migration.cancel', async params => {
      if (isRecord(params) && typeof params.sessionId === 'string') {
        const session = migrationSessions.get(params.sessionId)
        if (session) await expireMigrationSession(params.sessionId, session)
      }
      return { cancelled: true } as unknown as JsonValue
    })
    ctx.rpc.register('sillytavern.importer.convertPromptResource', params => {
      if (!isRecord(params)) throw new Error('Params must be an object')
      const sniff = sniffData(params.source)
      const name = typeof params.name === 'string' ? params.name : undefined
      if (sniff.detected && sniff.format === 'st.lorebook.json') {
        return { artifact: convertSillyTavernLorebook(params.source as SillyTavernLorebookData, name).artifact } as unknown as JsonValue
      }
      if (sniff.detected && sniff.format === 'st.preset.json') {
        const result = convertSillyTavernPreset(params.source as SillyTavernPresetData, name)
        return { artifact: result.artifact, diagnostics: result.diagnostics } as unknown as JsonValue
      }
      throw new Error('Unsupported SillyTavern Prompt Resource format')
    })
    // 1. Sniff method
    ctx.rpc.register('sillytavern.importer.sniff', params => {
      if (!isRecord(params)) return { detected: false, format: 'unknown' }
      const source = params.source
      if (typeof source === 'string') {
        return sniffData(source)
      }
      if (Array.isArray(source)) {
        return sniffData(new Uint8Array(source as number[]))
      }
      if (isRecord(source)) {
        return sniffData(source)
      }
      return { detected: false, format: 'unknown' }
    })

    // 2. Convert Card
    ctx.rpc.register('sillytavern.importer.convertCard', params => {
      if (!isRecord(params)) throw new Error('Params must be an object')
      let source: Uint8Array | SillyTavernCard
      if (typeof params.base64 === 'string') {
        source = Buffer.from(params.base64, 'base64')
      } else if (Array.isArray(params.bytes)) {
        source = new Uint8Array(params.bytes as number[])
      } else if (isRecord(params.card)) {
        source = params.card as unknown as SillyTavernCard
      } else {
        throw new Error('convertCard requires base64, bytes, or card param')
      }
      const result = convertSillyTavernCard(source)
      return {
        artifact: result.artifact,
        sourceFormat: result.sourceFormat,
        avatarBase64: result.avatarBytes ? Buffer.from(result.avatarBytes).toString('base64') : undefined,
        diagnostics: result.diagnostics,
      } as unknown as JsonValue
    })

    // 3. Convert Lorebook
    ctx.rpc.register('sillytavern.importer.convertLorebook', params => {
      if (!isRecord(params)) throw new Error('Params must be an object')
      let source: string | SillyTavernLorebookData
      if (typeof params.json === 'string') {
        source = params.json
      } else if (isRecord(params.lorebook)) {
        source = params.lorebook as unknown as SillyTavernLorebookData
      } else {
        throw new Error('convertLorebook requires json or lorebook param')
      }
      const result = convertSillyTavernLorebook(source)
      return {
        artifact: result.artifact,
      } as unknown as JsonValue
    })

    // 4. Convert Preset
    ctx.rpc.register('sillytavern.importer.convertPreset', params => {
      if (!isRecord(params)) throw new Error('Params must be an object')
      let source: string | SillyTavernPresetData
      if (typeof params.json === 'string') {
        source = params.json
      } else if (isRecord(params.preset)) {
        source = params.preset as unknown as SillyTavernPresetData
      } else {
        throw new Error('convertPreset requires json or preset param')
      }
      const result = convertSillyTavernPreset(source, typeof params.name === 'string' ? params.name : undefined)
      return {
        artifact: result.artifact,
      } as unknown as JsonValue
    })

    ctx.rpc.register('sillytavern.importer.convertChat', params => {
      if (!isRecord(params)) throw new Error('Params must be an object')
      const source = typeof params.jsonl === 'string'
        ? params.jsonl
        : Array.isArray(params.bytes) ? new Uint8Array(params.bytes as number[]) : undefined
      if (source === undefined) throw new Error('convertChat requires jsonl or bytes')
      return convertSillyTavernChat(source) as unknown as JsonValue
    })

    ctx.lifecycle.onDispose(async () => {
      const results = await Promise.allSettled([...migrationSessions].map(([sessionId, session]) =>
        expireMigrationSession(sessionId, session)))
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      if (errors.length) throw new AggregateError(errors, 'SillyTavern migration cleanup failed')
      ctx.diagnostics.report({
        severity: 'info',
        code: 'sillytavern.importer.disposed',
        message: 'SillyTavern Importer Extension disposed',
      })
    })
  },
}).activate

function normalizeMigrationPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error(`Migration path is invalid: ${path}`)
  }
  const segments = normalized.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Migration path is invalid: ${path}`)
  }
  if (!compatibleMigrationKind(normalized)) {
    throw new Error(`Migration path is unsupported: ${path}`)
  }
  return normalized
}

function decodeMigrationChunk(value: unknown, path: string): number[] | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
      throw new Error(`Migration chunk encoding is invalid: ${path}`)
    }
    return Array.from(Buffer.from(value, 'base64'))
  }
  if (!Array.isArray(value) || !value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error(`Migration chunk bytes are invalid: ${path}`)
  }
  return value as number[]
}

function characterKeyFromPath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const match = normalized.match(/(?:^|\/)(?:characters|chats)\/([^/]+)/i)
  return match?.[1]?.replace(/\.(?:png|jsonl?)$/i, '').toLowerCase() ?? ''
}

function semanticFingerprint(value: unknown): string {
  return JSON.stringify(canonicalizeSemanticValue(value))
}

function canonicalizeSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSemanticValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'artifactId', 'createdAt', 'updatedAt', 'importedAt'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalizeSemanticValue(nested)]))
}

export default activate
