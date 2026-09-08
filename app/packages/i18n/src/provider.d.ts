import React from 'react';
import type { Locale, TxFunction } from './types';
export interface I18nContextValue {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (key: string, ...args: unknown[]) => string;
    tx: TxFunction;
}
interface I18nProviderProps {
    children: React.ReactNode;
}
export declare function I18nProvider({ children }: I18nProviderProps): import("react").JSX.Element;
export declare function useI18n(): I18nContextValue;
export {};
