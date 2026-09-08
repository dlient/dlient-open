import type { ReactNode } from 'react';
export type Locale = 'zh-CN' | 'en-US';
export type MessageValue = string | ((...args: any[]) => string);
export interface TranslationMap {
}
export type RenderCallback = (children: string) => ReactNode;
export interface RenderOptions {
    [key: string]: unknown | RenderCallback;
}
export type TxFunction = (key: string, options?: RenderOptions) => ReactNode;
export type ResourceBundle = Record<Locale, Record<string, MessageValue>>;
export type Resources = Record<string, ResourceBundle>;
