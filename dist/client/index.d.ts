import type { ClientExtensionModule } from '@loom-studio/extension-sdk';
declare const module: ClientExtensionModule;
export declare function normalizeScanPath(path: string, hasDefaultUserRoot: boolean): string;
export declare function compatibleFileKind(path: string): 'card' | 'chat' | 'preset' | 'world' | undefined;
export declare function fingerprint(value: unknown): string;
export default module;
//# sourceMappingURL=index.d.ts.map