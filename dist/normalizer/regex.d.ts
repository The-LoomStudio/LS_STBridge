import type { TextTransformRuleDraft } from '@loom-studio/application-runtime';
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
export declare function convertSillyTavernRegexScripts(value: unknown): Array<Omit<TextTransformRuleDraft, 'owner'>>;
export declare function diagnoseSillyTavernRegexScripts(value: unknown): string[];
//# sourceMappingURL=regex.d.ts.map