// Next 16 client instrumentation (node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/instrumentation-client.md): this file runs after the HTML
// loads and BEFORE React hydrates, which is exactly when we want the global
// error hooks installed — a crash during hydration is the one that leaves a
// student staring at a blank screen with nothing in any log.
//
// Keep it lightweight (Next warns above 16 ms) and keep it defensive: an error
// in the error reporter is the worst kind of error. Everything is wrapped, and
// `report()` itself never throws.

import { report } from "@/lib/client/telemetry";

/** Just enough of a stack to find the code: the TOP frame's file:line, with the
 * origin stripped. No query strings, no full URLs, no user data — a stack in an
 * anonymous log is a fingerprint if you let it be one. */
function topFrame(stack: unknown): string | undefined {
  if (typeof stack !== "string") return undefined;
  for (const line of stack.split("\n")) {
    // Matches "at fn (https://host/_next/static/chunks/x.js:12:34)" and the
    // bare "https://host/....js:12:34" form Safari/Firefox produce.
    const m = /((?:https?:\/\/|\/)[^\s()]+?):(\d+):(\d+)/.exec(line);
    if (!m) continue;
    let file = m[1];
    try {
      // Path only — the host is our own and says nothing useful.
      file = new URL(file, "http://x").pathname;
    } catch {
      // already a path
    }
    return `${file.slice(-120)}:${m[2]}`;
  }
  return undefined;
}

function message(v: unknown): string {
  if (v instanceof Error) return String(v.message ?? "").slice(0, 200);
  if (typeof v === "string") return v.slice(0, 200);
  return "non-error throw";
}

try {
  window.addEventListener("error", (e: ErrorEvent) => {
    report("js_error", {
      message: message(e.error ?? e.message),
      at: topFrame(e.error instanceof Error ? e.error.stack : undefined),
    });
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason;
    report("js_error", {
      message: message(reason),
      at: topFrame(reason instanceof Error ? reason.stack : undefined),
      rejection: true,
    });
  });
} catch {
  // No window (an exotic runtime), or listeners refused. Nothing to do — the
  // app must not care whether its telemetry got installed.
}
