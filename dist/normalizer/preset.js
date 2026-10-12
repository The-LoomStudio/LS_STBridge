import { randomUUID } from 'node:crypto';
import { markEjsResources } from './compatibility.js';
import { convertSillyTavernRegexScripts, diagnoseSillyTavernRegexScripts } from './regex.js';
export function convertSillyTavernPreset(source, defaultName) {
    let preset;
    if (source instanceof Uint8Array || Buffer.isBuffer(source)) {
        const text = Buffer.from(source).toString('utf8');
        preset = JSON.parse(text);
    }
    else if (typeof source === 'string') {
        preset = JSON.parse(source);
    }
    else {
        preset = source;
    }
    const rawPrompts = Array.isArray(preset.prompts) ? preset.prompts : [];
    const name = (typeof preset.name === 'string' && preset.name.trim())
        || (typeof preset.preset_name === 'string' && preset.preset_name.trim())
        || defaultName?.trim()
        || 'SillyTavern Preset';
    const promptMap = new Map();
    for (const p of rawPrompts) {
        if (p && p.identifier) {
            promptMap.set(p.identifier, p);
        }
    }
    // 1. 查找最优 prompt_order 分组（若有多组，优先选取包含自定义条目或长度最大的生效组）
    let orderItems = [];
    if (Array.isArray(preset.prompt_order) && preset.prompt_order.length > 0) {
        const sortedGroups = [...preset.prompt_order].sort((a, b) => {
            const aLen = Array.isArray(a.order) ? a.order.length : 0;
            const bLen = Array.isArray(b.order) ? b.order.length : 0;
            return bLen - aLen;
        });
        const bestGroup = sortedGroups[0];
        if (bestGroup && Array.isArray(bestGroup.order)) {
            orderItems = bestGroup.order;
        }
    }
    const orderedEntries = [];
    if (orderItems.length > 0) {
        for (const item of orderItems) {
            if (!item || !item.identifier)
                continue;
            const prompt = promptMap.get(item.identifier) ?? { identifier: item.identifier, name: item.identifier };
            orderedEntries.push({
                prompt,
                identifier: item.identifier,
                enabled: item.enabled !== undefined ? item.enabled : (prompt.enabled !== false),
            });
        }
    }
    else {
        for (const p of rawPrompts) {
            if (!p)
                continue;
            const id = p.identifier || randomUUID().slice(0, 8);
            orderedEntries.push({
                prompt: p,
                identifier: id,
                enabled: p.enabled !== false,
            });
        }
    }
    // 2. 识别 Chat History 真实分界线（仅以 identifier/name 识别，绝不匹配 marker）
    let chatHistoryIndex = -1;
    for (const [index, entry] of orderedEntries.entries()) {
        if (entry.identifier === 'chatHistory' || entry.prompt.name === 'Chat History' || entry.prompt.identifier === 'chatHistory') {
            chatHistoryIndex = index;
            break;
        }
    }
    const preChatEntries = [];
    const postChatEntries = [];
    for (const [index, entry] of orderedEntries.entries()) {
        if (entry.identifier === 'chatHistory' || entry.prompt.name === 'Chat History' || entry.prompt.identifier === 'chatHistory') {
            continue;
        }
        if (chatHistoryIndex >= 0) {
            if (index < chatHistoryIndex) {
                preChatEntries.push(entry);
            }
            else {
                postChatEntries.push(entry);
            }
        }
        else {
            if (entry.prompt.injection_position === 'after_char' || entry.prompt.injection_position === 1) {
                postChatEntries.push(entry);
            }
            else {
                preChatEntries.push(entry);
            }
        }
    }
    // 3. 将有序条目按连续相同的 Role 聚合成 Message Block，赋予自然正序递增 localDepth，并将内置 Marker 原位转为虚拟锚点
    const anchorState = {
        hasStableAnchor: false,
        hasLowerAnchor: false,
    };
    function toPromptResourceNode(entry, targetAnchorId, localDepth) {
        const identifier = entry.identifier;
        const name = entry.prompt.name?.trim() || '';
        const isMarker = Boolean(entry.prompt.marker);
        const content = entry.prompt.content?.trim() || '';
        // 1. ST 前置世界书 Marker -> 映射为 @lore.stable 虚拟锚点
        if (identifier === 'worldInfoBefore' || name === 'World Info (before)') {
            anchorState.hasStableAnchor = true;
            return {
                id: `preset-virtual-setting-stable-${randomUUID().slice(0, 8)}`,
                label: '@lore.stable',
                meta: 'preset.virtual',
                category: 'preset',
                kind: 'virtual',
                capabilities: {
                    targetAnchorId: '@lore.stable',
                    localDepth,
                },
            };
        }
        // 2. ST 后置世界书 Marker -> 映射为 @lore.lower 虚拟锚点
        if (identifier === 'worldInfoAfter' || name === 'World Info (after)') {
            anchorState.hasLowerAnchor = true;
            return {
                id: `preset-virtual-setting-lower-${randomUUID().slice(0, 8)}`,
                label: '@lore.lower',
                meta: 'preset.virtual',
                category: 'preset',
                kind: 'virtual',
                capabilities: {
                    targetAnchorId: '@lore.lower',
                    localDepth,
                },
            };
        }
        // 3. ST 对话范例 Marker -> 如果无内容映射为 @chat.examples
        if (identifier === 'dialogueExamples' || name === 'Chat Examples') {
            if (!content) {
                return {
                    id: `preset-virtual-examples-${randomUUID().slice(0, 8)}`,
                    label: '@chat.examples',
                    meta: 'preset.virtual',
                    category: 'preset',
                    kind: 'virtual',
                    capabilities: {
                        targetAnchorId: '@chat.examples',
                        localDepth,
                    },
                };
            }
        }
        // 4. ST 角色Lore Marker 占位符（charDescription / scenario 等）：若此前未出现过 @lore.stable，充当首选定位点
        if (['charDescription', 'charPersonality', 'scenario', 'personaDescription'].includes(identifier)) {
            if (!content) {
                if (!anchorState.hasStableAnchor) {
                    anchorState.hasStableAnchor = true;
                    return {
                        id: `preset-virtual-setting-stable-${randomUUID().slice(0, 8)}`,
                        label: '@lore.stable',
                        meta: 'preset.virtual',
                        category: 'preset',
                        kind: 'virtual',
                        capabilities: {
                            targetAnchorId: '@lore.stable',
                            localDepth,
                        },
                    };
                }
                return null;
            }
        }
        // 其他纯 marker 且无具体内容时跳过
        if (!content && isMarker)
            return null;
        const label = name || identifier || 'Prompt';
        const role = entry.prompt.role ?? 'system';
        return {
            id: `st-preset-node-${identifier || randomUUID().slice(0, 8)}`,
            label,
            kind: 'entry',
            category: 'preset',
            enabled: entry.enabled,
            body: content,
            capabilities: {
                targetAnchorId,
                localDepth,
                roleHint: role,
                activation: { kind: 'always' },
                lifecycle: { lifecycle: 'always' },
            },
        };
    }
    function groupEntriesByRole(entries, targetAnchorId) {
        const groups = [];
        let currentGroup = null;
        let localDepthCounter = 10;
        for (const entry of entries) {
            const node = toPromptResourceNode(entry, targetAnchorId, localDepthCounter);
            if (!node)
                continue;
            localDepthCounter += 10;
            if (node.kind === 'virtual') {
                // 虚拟节点融入当前所在的 Message 块；若尚未有组，默认初始化 system 组
                if (!currentGroup) {
                    currentGroup = { role: 'system', nodes: [node] };
                    groups.push(currentGroup);
                }
                else {
                    currentGroup.nodes.push(node);
                }
                continue;
            }
            const role = node.capabilities?.roleHint || 'system';
            if (!currentGroup || currentGroup.role !== role) {
                currentGroup = { role, nodes: [node] };
                groups.push(currentGroup);
            }
            else {
                currentGroup.nodes.push(node);
            }
        }
        return groups;
    }
    const messageBlocks = [];
    // Pre-Chat 阶段
    const preChatGroups = groupEntriesByRole(preChatEntries, '@preset.system');
    // Loom Studio 特有扩展能力保底虚拟节点
    const baseSystemVirtualNodes = [
        {
            id: `preset-virtual-preset-system-${randomUUID().slice(0, 8)}`,
            label: '@preset.system',
            meta: 'preset.virtual',
            category: 'preset',
            kind: 'virtual',
            capabilities: { targetAnchorId: '@preset.system' },
        },
        {
            id: `preset-virtual-tools-${randomUUID().slice(0, 8)}`,
            label: '@chat.tools',
            meta: 'preset.virtual',
            category: 'preset',
            kind: 'virtual',
            capabilities: { targetAnchorId: '@chat.tools' },
        },
        {
            id: `preset-virtual-fresh-tail-${randomUUID().slice(0, 8)}`,
            label: '@fresh.tail',
            meta: 'preset.virtual',
            category: 'preset',
            kind: 'virtual',
            capabilities: { targetAnchorId: '@fresh.tail' },
        },
    ];
    // 若在条目中未曾原位匹配到 @lore.stable，则作为保底追加
    if (!anchorState.hasStableAnchor) {
        baseSystemVirtualNodes.splice(1, 0, {
            id: `preset-virtual-setting-stable-${randomUUID().slice(0, 8)}`,
            label: '@lore.stable',
            meta: 'preset.virtual',
            category: 'preset',
            kind: 'virtual',
            capabilities: { targetAnchorId: '@lore.stable' },
        });
        anchorState.hasStableAnchor = true;
    }
    let attachedSystemAnchors = false;
    for (const group of preChatGroups) {
        if (group.role === 'system' && !attachedSystemAnchors) {
            messageBlocks.push({
                id: `preset-msg-system-${randomUUID().slice(0, 8)}`,
                label: 'System Message',
                meta: 'message.system',
                category: 'preset',
                kind: 'message',
                capabilities: { roleHint: 'system' },
                children: [...group.nodes, ...baseSystemVirtualNodes],
            });
            attachedSystemAnchors = true;
        }
        else {
            const label = group.role === 'user' ? 'User Message' : (group.role === 'assistant' ? 'Assistant Message' : 'System Message');
            messageBlocks.push({
                id: `preset-msg-${group.role}-${randomUUID().slice(0, 8)}`,
                label,
                meta: `message.${group.role}`,
                category: 'preset',
                kind: 'message',
                capabilities: { roleHint: group.role },
                children: group.nodes,
            });
        }
    }
    if (!attachedSystemAnchors) {
        messageBlocks.unshift({
            id: `preset-msg-system-${randomUUID().slice(0, 8)}`,
            label: 'System Message',
            meta: 'message.system',
            category: 'preset',
            kind: 'message',
            capabilities: { roleHint: 'system' },
            children: baseSystemVirtualNodes,
        });
    }
    // Session Message
    messageBlocks.push({
        id: `preset-msg-session-${randomUUID().slice(0, 8)}`,
        label: 'Session Message',
        meta: 'message.system',
        category: 'preset',
        kind: 'message',
        capabilities: { roleHint: 'system' },
        children: [
            {
                id: `preset-virtual-session-${randomUUID().slice(0, 8)}`,
                label: '@chat.session',
                meta: 'preset.virtual',
                category: 'preset',
                kind: 'virtual',
                capabilities: { targetAnchorId: '@chat.session' },
            },
        ],
    });
    // Post-Session 阶段
    const basePostVirtualNodes = [];
    if (!anchorState.hasLowerAnchor) {
        basePostVirtualNodes.push({
            id: `preset-virtual-setting-lower-${randomUUID().slice(0, 8)}`,
            label: '@lore.lower',
            meta: 'preset.virtual',
            category: 'preset',
            kind: 'virtual',
            capabilities: { targetAnchorId: '@lore.lower' },
        });
    }
    basePostVirtualNodes.push({
        id: `preset-virtual-post-session-${randomUUID().slice(0, 8)}`,
        label: '@chat.session.post',
        meta: 'preset.virtual',
        category: 'preset',
        kind: 'virtual',
        capabilities: { targetAnchorId: '@chat.session.post' },
    });
    const postChatGroups = groupEntriesByRole(postChatEntries, '@chat.session.post');
    let attachedPostAnchors = false;
    for (const group of postChatGroups) {
        if (group.role === 'system' && !attachedPostAnchors) {
            messageBlocks.push({
                id: `preset-msg-post-session-${randomUUID().slice(0, 8)}`,
                label: 'Post Session Message',
                meta: 'message.system',
                category: 'preset',
                kind: 'message',
                capabilities: { roleHint: 'system' },
                children: [...basePostVirtualNodes, ...group.nodes],
            });
            attachedPostAnchors = true;
        }
        else {
            if (!attachedPostAnchors) {
                messageBlocks.push({
                    id: `preset-msg-post-session-${randomUUID().slice(0, 8)}`,
                    label: 'Post Session Message',
                    meta: 'message.system',
                    category: 'preset',
                    kind: 'message',
                    capabilities: { roleHint: 'system' },
                    children: basePostVirtualNodes,
                });
                attachedPostAnchors = true;
            }
            const label = group.role === 'user' ? 'Post-Session User Message' : (group.role === 'assistant' ? 'Post-Session Assistant Message' : 'Post-Session System Message');
            messageBlocks.push({
                id: `preset-msg-post-${group.role}-${randomUUID().slice(0, 8)}`,
                label,
                meta: `message.${group.role}`,
                category: 'preset',
                kind: 'message',
                capabilities: { roleHint: group.role },
                children: group.nodes,
            });
        }
    }
    if (!attachedPostAnchors) {
        messageBlocks.push({
            id: `preset-msg-post-session-${randomUUID().slice(0, 8)}`,
            label: 'Post Session Message',
            meta: 'message.system',
            category: 'preset',
            kind: 'message',
            capabilities: { roleHint: 'system' },
            children: basePostVirtualNodes,
        });
    }
    // User Input Message
    messageBlocks.push({
        id: `preset-msg-user-${randomUUID().slice(0, 8)}`,
        label: 'User Input Message',
        meta: 'message.user',
        category: 'preset',
        kind: 'message',
        capabilities: { roleHint: 'user' },
        children: [
            {
                id: `preset-virtual-input-${randomUUID().slice(0, 8)}`,
                label: '@chat.input',
                meta: 'preset.virtual',
                category: 'preset',
                kind: 'virtual',
                capabilities: { targetAnchorId: '@chat.input' },
            },
        ],
    });
    const artifact = {
        format: 'loom.promptResource',
        schemaVersion: 1,
        resourceKind: 'preset',
        rootNode: {
            id: `preset-root-${randomUUID().slice(0, 8)}`,
            label: name,
            kind: 'module',
            category: 'preset',
            enabled: true,
            children: messageBlocks,
        },
        textTransformRules: convertSillyTavernRegexScripts(preset.extensions?.regex_scripts
            ?? preset.extensions?.custom_regex_rules
            ?? preset.regex_scripts
            ?? preset.custom_regex_rules),
    };
    const regexValue = preset.extensions?.regex_scripts
        ?? preset.extensions?.custom_regex_rules
        ?? preset.regex_scripts
        ?? preset.custom_regex_rules;
    markEjsResources(artifact.rootNode);
    return { artifact, diagnostics: diagnoseSillyTavernRegexScripts(regexValue) };
}
//# sourceMappingURL=preset.js.map