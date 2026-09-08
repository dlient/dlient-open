import React from 'react';
import type { RenderOptions } from './types';
export declare function interpolate(text: string, values: Record<string, unknown>): string;
export declare function renderRichText(text: string, options: RenderOptions): React.ReactNode;
