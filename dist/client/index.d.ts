import type { ClientExtensionModule } from '@loom-studio/extension-sdk';
declare const module: ClientExtensionModule;
type ScanItem = {
    kind: 'card' | 'chat' | 'preset' | 'world';
    file: File;
    path: string;
};
export declare function normalizeScanPath(path: string, hasDefaultUserRoot: boolean): string;
export declare function compatibleFileKind(path: string): ScanItem['kind'] | undefined;
export declare function fingerprint(value: unknown): string;
export default module;
//# sourceMappingURL=index.d.ts.map