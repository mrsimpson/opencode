/**
 * bind-all-interfaces.cjs
 *
 * Patches net.Server.prototype.listen so that any server started by Node.js
 * that would bind to a loopback address (localhost / 127.0.0.1 / ::1) or
 * no address at all binds to 0.0.0.0 instead.
 *
 * Why: Kubernetes injects "::1 localhost" into /etc/hosts.  On Alpine (musl
 * libc) getaddrinfo("localhost") returns ::1 before 127.0.0.1, so dev servers
 * like Vite end up bound to the IPv6 loopback which is not reachable from
 * other pods.  0.0.0.0 listens on all interfaces including the pod's cluster
 * IP, which is what the opencode-router uses to forward traffic.
 *
 * Loaded via NODE_OPTIONS=--require /etc/bind-all-interfaces.cjs
 * CJS require works for all Node processes regardless of ESM/CJS module type.
 */

"use strict";

const net = require("net");
const orig = net.Server.prototype.listen;

net.Server.prototype.listen = function (...args) {
  if (args.length === 0) return orig.apply(this, args);

  const first = args[0];

  // listen(port) or listen(port, host, ...) form
  if (typeof first === "number" || typeof first === "string" && /^\d+$/.test(first)) {
    const host = args[1];
    if (typeof host !== "string" || isLoopback(host)) {
      // Remove the host argument (or insert 0.0.0.0 in its place)
      const rest = typeof host === "string" ? args.slice(2) : args.slice(1);
      return orig.call(this, first, "0.0.0.0", ...rest);
    }
  }

  // listen({ port, host, ... }) options-object form
  if (first && typeof first === "object" && !Array.isArray(first) && first.port != null) {
    if (!first.host || isLoopback(first.host)) {
      args[0] = { ...first, host: "0.0.0.0" };
    }
  }

  return orig.apply(this, args);
};

function isLoopback(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "::";
}
