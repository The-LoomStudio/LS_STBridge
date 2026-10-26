import _ from 'lodash'
import { isRecord, type JsonObject } from '@loom-studio/shared'
import type { ExtensionStateInitializationContext } from '@loom-studio/extension-sdk'
import { correctlyMerge, parseString } from './vendor/mvu/common.js'
import { cleanUpMetadata, generateSchema } from './vendor/mvu/schema.js'
import { extractCommands, parseCommandValue, pathFix, trimQuotesAndBackslashes, updateVariables } from './vendor/mvu/update_variables.js'
import type { MvuData } from './vendor/mvu/variable_def.js'
import { isJsonPatch } from './mvu-adapter.js'

export type MvuDiagnostic = { command: string; content: string }
export type MvuResult = { value: JsonObject; diagnostics: MvuDiagnostic[] }
export type MvuInitialization = Pick<ExtensionStateInitializationContext, 'opening' | 'resources'>
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor'])

function assertData(value: unknown, seen = new Set<object>(), optionalFields = false): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || !value || seen.has(value)) throw new Error('MVU requires finite, acyclic JSON data')
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error('MVU State cannot store non-JSON objects')
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    if (unsafeKeys.has(key)) throw new Error(`MVU forbids prototype path: ${key}`)
    if (child === undefined && optionalFields && !Array.isArray(value)) continue
    assertData(child, seen, optionalFields)
  }
  seen.delete(value)
}

function parseInitial(text: string): JsonObject {
  const unwrapped = text.trim().replace(/^<initvar>\s*([\s\S]*?)\s*<\/initvar>$/i, '$1')
    .replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1')
  const value: unknown = parseString(unwrapped)
  assertData(value)
  if (!isRecord(value)) throw new Error('MVU initvar must contain an object')
  return value as JsonObject
}

export function initializeMvuData(input: MvuInitialization): MvuResult {
  if (input.resources.filter(resource => resource.metadata?.stPrimaryWorldbook === true).length > 1)
    throw new Error('MVU initialization requires one primary character worldbook, not multiple primary sources')
  let statData: JsonObject = {}
  const initialized: JsonObject = {}
  let openingOverride = false
  for (const match of input.opening.matchAll(/<initvar>([\s\S]*?)<\/initvar>/gi)) {
    statData = correctlyMerge(statData, parseInitial(match[1]!))
    openingOverride = true
  }
  for (const resource of input.resources) {
    // A selected opening replaces only its character's primary worldbook.
    // Resource IDs preserve identity when different books share the same display name.
    initialized[resource.id] = []
    if (openingOverride && resource.metadata?.stPrimaryWorldbook === true) continue
    let merged: JsonObject = {}
    for (const entry of resource.entries) {
      if (!entry.label.toLowerCase().includes('[initvar]')) continue
      // Prompt disabled is intentionally unrelated to initialization eligibility.
      merged = correctlyMerge(merged, parseInitial(entry.content))
    }
    statData = { ...merged, ...statData }
  }
  const schema = generateSchema(structuredClone(statData))
  if (schema.type !== 'object') throw new Error('MVU root schema must be an object')
  const meta = statData.$meta
  if (isRecord(meta)) {
    for (const key of ['strictTemplate', 'concatTemplateArray', 'strictSet'] as const) {
      if (Object.hasOwn(meta, key)) Object.assign(schema, { [key]: meta[key] })
    }
  }
  cleanUpMetadata(statData)
  return { value: jsonData({ stat_data: statData, schema, initialized_lorebooks: initialized }), diagnostics: [] }
}

function jsonData(value: unknown): JsonObject {
  // Upstream schemas have optional undefined fields; State stores JSON, not JS objects.
  assertData(value, new Set(), true)
  const result = JSON.parse(JSON.stringify(value)) as JsonObject
  assertData(result)
  return result
}

export async function updateMvuData(text: string, current: JsonObject): Promise<MvuResult> {
  assertData(current)
  if (!isRecord(current.stat_data) || !isRecord(current.schema) || !isRecord(current.initialized_lorebooks))
    throw new Error('MVU State has not been initialized')
  // Validate patch blocks before the upstream parser, which otherwise ignores malformed blocks.
  for (const match of text.matchAll(/<(json_?patch)>([\s\S]*?)<\/\1>/gi)) {
    const patch: unknown = parseString(match[2]!.trim().replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1'))
    assertData(patch)
    if (!isJsonPatch(patch)) throw new Error('Invalid MVU JSONPatch block')
    for (const operation of patch as Array<Record<string, unknown>>) {
      if (!['add', 'insert', 'remove', 'replace', 'move', 'delta'].includes(String(operation.op)))
        throw new Error(`Unsupported MVU JSONPatch operation: ${String(operation.op)}`)
      for (const key of ['path', 'from', 'to']) {
        if (typeof operation[key] === 'string') assertPath(operation[key] as string)
      }
    }
  }
  const commands = extractCommands(text)
  for (const command of commands) {
    assertPath(command.args[0]!)
    for (const argument of command.args.slice(1)) {
      const value: unknown = parseCommandValue(argument)
      assertData(value)
      if (typeof value === 'string' && unsafeKeys.has(value)) throw new Error(`Unsafe MVU key: ${value}`)
    }
  }
  if (!commands.length) return { value: structuredClone(current), diagnostics: [] }
  const variables = structuredClone(current) as MvuData
  const diagnostics: MvuDiagnostic[] = []
  await updateVariables(text, variables, diagnostics)
  return { value: jsonData(variables), diagnostics }
}

function assertPath(path: string): void {
  path = trimQuotesAndBackslashes(path)
  const segments = [..._.toPath(pathFix(path)), ...path.split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))]
  if (segments.some(segment => unsafeKeys.has(segment))) throw new Error(`Unsafe MVU path: ${path}`)
}
