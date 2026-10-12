import { extractPngImageBytes, extractStCardFromPng, isPngFile } from './parser/png-reader.js';
import { sniffData } from './parser/sniffer.js';
import { convertSillyTavernCard } from './normalizer/card.js';
import { convertSillyTavernLorebook } from './normalizer/lorebook.js';
import { convertSillyTavernPreset } from './normalizer/preset.js';
import { convertSillyTavernChat } from './parser/chat.js';
export { extractPngImageBytes, extractStCardFromPng, isPngFile, sniffData, convertSillyTavernCard, convertSillyTavernLorebook, convertSillyTavernPreset, convertSillyTavernChat, };
export * from './types.js';
export declare const activate: (ctx: import("@loom-studio/extension-sdk").ExtensionActivationContext) => void | Promise<void>;
export default activate;
//# sourceMappingURL=index.d.ts.map