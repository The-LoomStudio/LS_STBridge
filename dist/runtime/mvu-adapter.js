import { isRecord } from '@loom-studio/shared';
// Diagnostic keys are retained without importing the upstream UI/i18n runtime.
export function tr(key, values) {
    return values ? `${key}: ${JSON.stringify(values)}` : key;
}
// Authored initialization macros are expanded by the platform before this boundary.
// Model output is data and does not gain access to the ST macro or script host.
export function substitudeMacros(text) { return text; }
export function isJsonPatch(value) {
    return Array.isArray(value) && value.every(item => isRecord(item)
        && typeof item.op === 'string'
        && (typeof item.path === 'string' || item.op === 'move' && typeof item.to === 'string'));
}
//# sourceMappingURL=mvu-adapter.js.map