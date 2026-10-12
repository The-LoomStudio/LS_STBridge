import type { TextTransformRuleDraft } from '@loom-studio/application-runtime';
import type { JsonValue } from '@loom-studio/shared';
export type SillyTavernRegexScript = {
    id?: string;
    scriptName?: string;
    findRegex?: string;
    replaceString?: string;
    trimStrings?: string[];
    placement?: number[] | string[];
    disabled?: boolean;
    markdownOnly?: boolean;
    promptOnly?: boolean;
    minDepth?: number;
    maxDepth?: number;
};
export declare function convertSillyTavernRegexScripts(value: JsonValue | undefined): Array<Omit<TextTransformRuleDraft, 'owner'>>;
export declare function diagnoseSillyTavernRegexScripts(value: JsonValue | undefined): string[];
//# sourceMappingURL=regex.d.ts.map