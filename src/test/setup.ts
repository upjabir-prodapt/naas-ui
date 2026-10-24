import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/*
 * Node 25+ ships its own `localStorage` / `sessionStorage` globals, which are
 * `undefined` unless node runs with --localstorage-file, and they shadow
 * jsdom's in Vitest. Point them back at jsdom's so code that reads storage at
 * render time (the shell's sidebar state, a vertical's saved preferences)
 * behaves as it does in a browser.
 * A no-op on Node 24, where those globals do not exist.
 */
const { jsdom } = globalThis as unknown as { jsdom?: { window: Window } };
if (jsdom) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    if (globalThis[key] === undefined) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        get: () => jsdom.window[key],
      });
    }
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
