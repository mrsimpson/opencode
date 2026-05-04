/**
 * opencode dev-server ESM patch
 * 1. net.Server.prototype.listen → bind 0.0.0.0 (Vite binds to localhost/::1 by default on Alpine)
 * 2. ESM load hook → replace Vite's isHostAllowedWithoutCache to always return true
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';

// ── 1. CJS net patch ─────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const net = require('net');
const origListen = net.Server.prototype.listen;
net.Server.prototype.listen = function(...args) {
  if (!args.length) return origListen.apply(this, args);
  const first = args[0];
  if (typeof first === 'number') {
    const host = args[1];
    if (host === undefined || host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      const rest = typeof args[1] === 'function' ? args.slice(1) : args.slice(2);
      return origListen.call(this, first, '0.0.0.0', ...rest);
    }
  }
  if (first && typeof first === 'object' && first.port != null) {
    const host = first.host;
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      args[0] = { ...first, host: '0.0.0.0' };
    }
  }
  return origListen.apply(this, args);
};

// ── 2. ESM load hook: patch Vite's host check ────────────────────────────
// The hook is registered as a separate module so it runs in the loader thread.
const HOOK = `
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.includes('/vite/') && !url.includes('/vite@')) return result;
  // Convert source to string
  const src = typeof result.source === 'string'
    ? result.source
    : result.source instanceof Uint8Array
      ? Buffer.from(result.source).toString('utf8')
      : null;
  if (!src || !src.includes('isHostAllowedWithoutCache')) return result;
  // Replace the function to always return true
  const patched = src.replace(
    'function isHostAllowedWithoutCache(',
    'function _origIsHostAllowed_disabled('
  ) + '\\nfunction isHostAllowedWithoutCache(){return true;}';
  return { ...result, source: patched };
}
`;

register('data:text/javascript,' + encodeURIComponent(HOOK), import.meta.url);
