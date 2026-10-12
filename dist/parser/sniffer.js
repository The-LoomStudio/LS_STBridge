import { extractStCardFromPng, isPngFile } from './png-reader.js';
import { convertSillyTavernChat } from './chat.js';
export function sniffData(source) {
    if (source instanceof Uint8Array || Buffer.isBuffer(source)) {
        if (isPngFile(source)) {
            const stCard = extractStCardFromPng(source);
            if (stCard) {
                const name = stCard.card.data?.name
                    ?? stCard.card.name
                    ?? 'Unknown ST Card';
                return {
                    detected: true,
                    format: 'st.card.png',
                    summary: `SillyTavern PNG Card (${stCard.format}): ${name}`,
                    details: {
                        format: stCard.format,
                        name,
                    },
                };
            }
            return {
                detected: false,
                format: 'unknown',
            };
        }
        try {
            const text = Buffer.from(source).toString('utf8').trim();
            if (looksLikeChat(text)) {
                const chat = convertSillyTavernChat(text);
                return { detected: true, format: 'st.chat.jsonl', summary: `SillyTavern Chat: ${chat.title} (${chat.messages.length} messages)` };
            }
            if (text.startsWith('{') && text.endsWith('}')) {
                return sniffJsonObject(JSON.parse(text));
            }
        }
        catch {
            return { detected: false, format: 'unknown' };
        }
    }
    if (typeof source === 'string') {
        const trimmed = source.trim();
        if (looksLikeChat(trimmed)) {
            try {
                const chat = convertSillyTavernChat(trimmed);
                return { detected: true, format: 'st.chat.jsonl', summary: `SillyTavern Chat: ${chat.title} (${chat.messages.length} messages)` };
            }
            catch {
                return { detected: false, format: 'unknown' };
            }
        }
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                return sniffJsonObject(JSON.parse(trimmed));
            }
            catch {
                return { detected: false, format: 'unknown' };
            }
        }
    }
    if (typeof source === 'object' && source !== null) {
        return sniffJsonObject(source);
    }
    return { detected: false, format: 'unknown' };
}
function looksLikeChat(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    return lines.length > 1 && lines.some(line => line.includes('"chat_metadata"') || line.includes('"mes"'));
}
function sniffJsonObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { detected: false, format: 'unknown' };
    }
    const record = value;
    // 1. Check ST Card V3 / V2
    if (record.spec === 'chara_card_v3'
        || record.spec === 'chara_card_v2'
        || (record.data && typeof record.data === 'object' && ('first_mes' in record.data || 'character_book' in record.data))
        || ('first_mes' in record && 'description' in record && 'name' in record)) {
        const card = record;
        const name = card.data?.name ?? card.name ?? 'Unnamed Card';
        return {
            detected: true,
            format: 'st.card.json',
            summary: `SillyTavern Card JSON: ${name}`,
            details: {
                spec: card.spec ?? 'v2_compatible',
                name,
            },
        };
    }
    // 2. Check ST Lorebook / Worldbook
    if ('entries' in record && typeof record.entries === 'object' && record.entries !== null) {
        const entries = record.entries;
        const firstEntry = Array.isArray(entries) ? entries[0] : Object.values(entries)[0];
        if (firstEntry === undefined
            || (typeof firstEntry === 'object' && firstEntry !== null && ('keys' in firstEntry || 'content' in firstEntry || 'keysearch_case' in firstEntry))) {
            const lorebook = record;
            const count = Array.isArray(entries) ? entries.length : Object.keys(entries).length;
            return {
                detected: true,
                format: 'st.lorebook.json',
                summary: `SillyTavern Lorebook: ${lorebook.name ?? 'Unnamed'} (${count} entries)`,
                details: {
                    name: lorebook.name,
                    entryCount: count,
                },
            };
        }
    }
    // 3. Check ST Preset
    if (Array.isArray(record.prompts) && record.prompts.length > 0) {
        const firstPrompt = record.prompts[0];
        if (firstPrompt && (('identifier' in firstPrompt && 'role' in firstPrompt) || 'system_prompt' in firstPrompt || 'marker' in firstPrompt)) {
            const preset = record;
            return {
                detected: true,
                format: 'st.preset.json',
                summary: `SillyTavern Preset with ${preset.prompts?.length ?? 0} prompts`,
                details: {
                    promptCount: preset.prompts?.length ?? 0,
                },
            };
        }
    }
    return {
        detected: false,
        format: 'unknown',
    };
}
//# sourceMappingURL=sniffer.js.map