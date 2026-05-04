import { Plugin } from '@opencode-ai/plugin';

declare function isAllowed(sessionID: string): boolean;
declare function lockToSession(sessionID: string): void;
declare function runStartupReplay(input: Parameters<Plugin>[0]): Promise<void>;
declare const _default: {
    id: string;
    server: Plugin;
};

/**
 * Test-only handles into the plugin's module-level state. NOT a public API.
 * Tests use these to reset state between cases and to drive the replay
 * synchronously without waiting for the 5 s startup timeout.
 */
declare const __test: {
    reset(): void;
    getAllowedSessionIds(): Set<string> | null;
    isAllowed: typeof isAllowed;
    lockToSession: typeof lockToSession;
    runStartupReplay: typeof runStartupReplay;
};

export { __test, _default as default };
