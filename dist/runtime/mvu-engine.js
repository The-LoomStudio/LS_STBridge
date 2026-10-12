import _ from 'lodash';
import { isRecord } from '@loom-studio/shared';
import { correctlyMerge, parseString } from './vendor/mvu/common.js';
import { cleanUpMetadata, generateSchema } from './vendor/mvu/schema.js';
import { extractCommands, parseCommandValue, pathFix, trimQuotesAndBackslashes, updateVariables } from './vendor/mvu/update_variables.js';
import { isJsonPatch } from './mvu-adapter.js';
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
function assertData(value, seen = new Set(), optionalFields = false) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number' && Number.isFinite(value))
        return;
    if (typeof value !== 'object' || !value || seen.has(value))
        throw new Error('MVU requires finite, acyclic JSON data');
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw new Error('MVU State cannot store non-JSON objects');
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        if (unsafeKeys.has(key))
            throw new Error(`MVU forbids prototype path: ${key}`);
        if (child === undefined && optionalFields && !Array.isArray(value))
            continue;
        assertData(child, seen, optionalFields);
    }
    seen.delete(value);
}
function parseInitial(text) {
    const unwrapped = text.trim().replace(/^<initvar>\s*([\s\S]*?)\s*<\/initvar>$/i, '$1')
        .replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1');
    const value = parseString(unwrapped);
    assertData(value);
    if (!isRecord(value))
        throw new Error('MVU initvar must contain an object');
    return value;
}
export function initializeMvuData(input) {
    if (input.resources.filter(resource => resource.metadata?.stPrimaryWorldbook === true).length > 1)
        throw new Error('MVU initialization requires one primary character worldbook, not multiple primary sources');
    let statData = {};
    const initialized = {};
    let openingOverride = false;
    for (const opening of input.opening) {
        for (const match of opening.matchAll(/<initvar>([\s\S]*?)<\/initvar>/gi)) {
            statData = correctlyMerge(statData, parseInitial(match[1]));
            openingOverride = true;
        }
    }
    for (const resource of input.resources) {
        // A selected opening replaces only its character's primary worldbook.
        // Resource IDs preserve identity when different books share the same display name.
        initialized[resource.id] = [];
        if (openingOverride && resource.metadata?.stPrimaryWorldbook === true)
            continue;
        let merged = {};
        for (const entry of resource.entries) {
            if (!entry.label.toLowerCase().includes('[initvar]'))
                continue;
            // Prompt disabled is intentionally unrelated to initialization eligibility.
            merged = correctlyMerge(merged, parseInitial(entry.content));
        }
        statData = { ...merged, ...statData };
    }
    const schema = generateSchema(structuredClone(statData));
    if (schema.type !== 'object')
        throw new Error('MVU root schema must be an object');
    const meta = statData.$meta;
    if (isRecord(meta)) {
        for (const key of ['strictTemplate', 'concatTemplateArray', 'strictSet']) {
            if (Object.hasOwn(meta, key))
                Object.assign(schema, { [key]: meta[key] });
        }
    }
    cleanUpMetadata(statData);
    return { value: jsonData({ stat_data: statData, schema, initialized_lorebooks: initialized }), diagnostics: [] };
}
function jsonData(value) {
    // Upstream schemas have optional undefined fields; State stores JSON, not JS objects.
    assertData(value, new Set(), true);
    const result = JSON.parse(JSON.stringify(value));
    assertData(result);
    return result;
}
export async function updateMvuData(text, current) {
    assertData(current);
    if (!isRecord(current.stat_data) || !isRecord(current.schema) || !isRecord(current.initialized_lorebooks))
        throw new Error('MVU State has not been initialized');
    // Validate patch blocks before the upstream parser, which otherwise ignores malformed blocks.
    for (const match of text.matchAll(/<(json_?patch)>([\s\S]*?)<\/\1>/gi)) {
        const patch = parseString(match[2].trim().replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1'));
        assertData(patch);
        if (!isJsonPatch(patch))
            throw new Error('Invalid MVU JSONPatch block');
        for (const operation of patch) {
            if (!['add', 'insert', 'remove', 'replace', 'move', 'delta'].includes(String(operation.op)))
                throw new Error(`Unsupported MVU JSONPatch operation: ${String(operation.op)}`);
            for (const key of ['path', 'from', 'to']) {
                if (typeof operation[key] === 'string')
                    assertPath(operation[key]);
            }
        }
    }
    const commands = extractCommands(text);
    for (const command of commands) {
        assertPath(command.args[0]);
        for (const argument of command.args.slice(1)) {
            const value = parseCommandValue(argument);
            assertData(value);
            if (typeof value === 'string' && unsafeKeys.has(value))
                throw new Error(`Unsafe MVU key: ${value}`);
        }
    }
    if (!commands.length)
        return { value: structuredClone(current), diagnostics: [] };
    const variables = structuredClone(current);
    const diagnostics = [];
    await updateVariables(text, variables, diagnostics);
    return { value: jsonData(variables), diagnostics };
}
function assertPath(path) {
    path = trimQuotesAndBackslashes(path);
    const segments = [..._.toPath(pathFix(path)), ...path.split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))];
    if (segments.some(segment => unsafeKeys.has(segment)))
        throw new Error(`Unsafe MVU path: ${path}`);
}
//# sourceMappingURL=mvu-engine.js.map