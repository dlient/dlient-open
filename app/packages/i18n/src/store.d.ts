import type { Locale, ResourceBundle, Resources } from './types';
interface Snapshot {
    locale: Locale;
    resources: Resources;
}
declare class I18nStore {
    private locale;
    private resources;
    private snapshot;
    private listeners;
    constructor();
    private readStorage;
    subscribe: (cb: () => void) => () => void;
    getSnapshot: () => Snapshot;
    getLocale: () => Locale;
    setLocale(locale: Locale): void;
    addResourceBundle(ns: string, res: ResourceBundle): void;
    removeResourceBundle(ns: string): void;
    private commit;
    private emit;
}
export declare const store: I18nStore;
export declare function addResourceBundle(ns: string, res: ResourceBundle): void;
export declare function removeResourceBundle(ns: string): void;
export {};
