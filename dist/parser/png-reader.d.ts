import type { SillyTavernCard } from '../types.js';
export declare function isPngFile(source: Uint8Array): boolean;
export type PngChunk = {
    type: string;
    data: Buffer;
    raw: Buffer;
};
export declare function readPngChunks(source: Uint8Array): PngChunk[];
export declare function extractPngImageBytes(source: Uint8Array): Uint8Array;
export declare function extractStCardFromPng(source: Uint8Array): {
    card: SillyTavernCard;
    format: 'st.card.v2' | 'st.card.v3';
    rawJson: string;
} | null;
//# sourceMappingURL=png-reader.d.ts.map