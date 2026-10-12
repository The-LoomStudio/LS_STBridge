import { ejsProcessorId } from '../runtime/constants.js';
export function markEjsResources(root) {
    const entries = [];
    const visit = (node) => {
        if (node.kind === 'entry')
            entries.push(node);
        node.children?.forEach(visit);
    };
    visit(root);
    const usesEjs = entries.some(node => /<%|^@@|\{\{get_message_variable::/m.test(node.body ?? '') || node.label.includes('[Preprocessing]'));
    for (const node of entries) {
        if (usesEjs || node.label.toLowerCase().includes('[initvar]'))
            node.capabilities = { ...node.capabilities, processorId: ejsProcessorId };
    }
}
//# sourceMappingURL=compatibility.js.map