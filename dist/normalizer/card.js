import { randomUUID } from 'node:crypto';
import { extractPngImageBytes, extractStCardFromPng, isPngFile } from '../parser/png-reader.js';
import { convertSillyTavernLorebook } from './lorebook.js';
import { convertSillyTavernRegexScripts, diagnoseSillyTavernRegexScripts } from './regex.js';
import { markEjsResources } from './compatibility.js';
import { mvuContributionId } from '../runtime/constants.js';
export function convertSillyTavernCard(source) {
    let card;
    let avatarBytes;
    let sourceFormat;
    if (source instanceof Uint8Array || Buffer.isBuffer(source)) {
        if (isPngFile(source)) {
            const extracted = extractStCardFromPng(source);
            if (!extracted) {
                throw new Error('PNG does not contain a SillyTavern character chunk (ccv3 or chara)');
            }
            card = extracted.card;
            sourceFormat = extracted.format;
            avatarBytes = extractPngImageBytes(source);
        }
        else {
            const text = Buffer.from(source).toString('utf8');
            card = JSON.parse(text);
            sourceFormat = card.spec === 'chara_card_v3' ? 'st.card.v3' : 'st.card.v2';
        }
    }
    else {
        card = source;
        sourceFormat = card.spec === 'chara_card_v3' ? 'st.card.v3' : 'st.card.v2';
    }
    const data = card.data ?? card;
    const name = data.name?.trim() || 'SillyTavern Character';
    const systemPrompt = data.system_prompt?.trim() || '';
    const firstMes = data.first_mes?.trim() || '';
    const greetings = firstMes ? [firstMes, ...(data.alternate_greetings ?? [])] : data.alternate_greetings ?? [];
    const fullDescription = [
        data.description?.trim(),
        data.personality?.trim() ? `[Character Personality]\n${data.personality.trim()}` : '',
        data.scenario?.trim() ? `[Scenario]\n${data.scenario.trim()}` : '',
    ].filter(Boolean).join('\n\n');
    const contextAssets = [];
    // The embedded book has one authoring source: the Lore resource tree.
    const book = data.character_book ?? card.character_book;
    if (book && book.entries && (Array.isArray(book.entries) ? book.entries.length > 0 : Object.keys(book.entries).length > 0)) {
        const bookName = book.name?.trim() || `${name} 世界书`;
        const lorebookConversion = convertSillyTavernLorebook(book, bookName);
        if (lorebookConversion.artifact.rootNode) {
            contextAssets.push(lorebookConversion.artifact.rootNode);
        }
    }
    // 2. Process post-history instructions and extensions depth_prompt into contextAssets
    const postSessionEntries = [];
    const postHistory = data.post_history_instructions?.trim();
    if (postHistory) {
        postSessionEntries.push({
            id: `st-post-history-${randomUUID().slice(0, 8)}`,
            label: 'Post-History Instructions',
            kind: 'entry',
            category: 'preset',
            enabled: true,
            body: postHistory,
            capabilities: {
                targetAnchorId: '@chat.session.post',
                activation: { kind: 'always' },
            },
        });
    }
    const depthExtension = data.extensions?.depth_prompt;
    if (depthExtension && typeof depthExtension.prompt === 'string' && depthExtension.prompt.trim()) {
        postSessionEntries.push({
            id: `st-depth-prompt-${randomUUID().slice(0, 8)}`,
            label: 'Depth Prompt Extension',
            kind: 'entry',
            category: 'preset',
            enabled: true,
            body: depthExtension.prompt.trim(),
            capabilities: {
                targetAnchorId: '@chat.session.post',
                localDepth: typeof depthExtension.depth === 'number' ? depthExtension.depth : 0,
                activation: { kind: 'always' },
            },
        });
    }
    if (postSessionEntries.length > 0) {
        contextAssets.push({
            id: `st-post-session-module-${randomUUID().slice(0, 8)}`,
            label: 'SillyTavern Post-Session & Depth Prompts',
            kind: 'module',
            category: 'preset',
            enabled: true,
            capabilities: {
                targetAnchorId: '@chat.session.post',
            },
            children: postSessionEntries,
        });
    }
    const artifactId = `card-st-${randomUUID()}`;
    contextAssets.forEach(markEjsResources);
    const hasMvu = greetings.some(text => /<initvar>/i.test(text))
        || contextAssets.some(root => root.children?.some(entry => entry.label.toLowerCase().includes('[initvar]')));
    if (hasMvu && contextAssets[0]?.category === 'lore') {
        contextAssets[0].extra = { ...contextAssets[0].extra, stPrimaryWorldbook: true };
    }
    const metadata = {
        importer: 'sillytavern.importer',
        originalFormat: sourceFormat,
        importedAt: new Date().toISOString(),
    };
    if (data.creator)
        metadata.stCreator = data.creator;
    if (data.character_version)
        metadata.stVersion = data.character_version;
    if (data.tags && Array.isArray(data.tags))
        metadata.stTags = data.tags;
    const artifact = {
        schemaVersion: 4,
        artifactId,
        displayName: name,
        description: fullDescription || undefined,
        card: {
            name,
            ...(hasMvu ? { stateContributionIds: [mvuContributionId] } : {}),
            userName: undefined,
            description: fullDescription || undefined,
            preset: systemPrompt ? { system: systemPrompt } : undefined,
            opening: greetings.length ? {
                id: randomUUID(), content: greetings[0],
                ...(greetings.length > 1 ? {
                    alternatives: greetings.slice(1).map(content => ({ id: randomUUID(), content })),
                } : {}),
            } : undefined,
        },
        contextAssets,
        textTransformRules: convertSillyTavernRegexScripts(data.extensions?.regex_scripts ?? data.extensions?.custom_regex_rules),
        metadata,
    };
    return {
        artifact,
        avatarBytes,
        sourceFormat,
        diagnostics: diagnoseSillyTavernRegexScripts(data.extensions?.regex_scripts ?? data.extensions?.custom_regex_rules),
    };
}
//# sourceMappingURL=card.js.map