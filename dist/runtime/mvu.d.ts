import type { JsonObject } from '@loom-studio/shared';
import type { MvuInitialization, MvuResult } from './mvu-engine.js';
export type MvuWork = {
    kind: 'initialize';
    context: MvuInitialization;
} | {
    kind: 'update';
    text: string;
    value: JsonObject;
};
export declare function runMvu(input: MvuWork, signal: AbortSignal): Promise<MvuResult>;
//# sourceMappingURL=mvu.d.ts.map