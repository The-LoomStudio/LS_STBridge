import type { JsonObject } from '@loom-studio/shared';
export type SillyTavernChatMessage = {
    name?: string;
    is_user?: boolean;
    is_system?: boolean;
    mes?: string;
    send_date?: string | number;
};
export type SillyTavernChatConversion = {
    title: string;
    messages: Array<{
        role: 'user' | 'assistant';
        content: string;
        createdAt?: string;
    }>;
    metadata?: JsonObject;
};
export declare function convertSillyTavernChat(source: string | Uint8Array): SillyTavernChatConversion;
//# sourceMappingURL=chat.d.ts.map