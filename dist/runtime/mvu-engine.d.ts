import { type JsonObject } from '@loom-studio/shared';
import type { ExtensionStateInitializationContext } from '@loom-studio/extension-sdk';
export type MvuDiagnostic = {
    command: string;
    content: string;
};
export type MvuResult = {
    value: JsonObject;
    diagnostics: MvuDiagnostic[];
};
export type MvuInitialization = Pick<ExtensionStateInitializationContext, 'opening' | 'resources'>;
export declare function initializeMvuData(input: MvuInitialization): MvuResult;
export declare function updateMvuData(text: string, current: JsonObject): Promise<MvuResult>;
//# sourceMappingURL=mvu-engine.d.ts.map