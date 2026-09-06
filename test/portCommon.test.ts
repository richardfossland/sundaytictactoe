import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LIB_PATH = path.join(process.cwd(), "scripts/lib/port-common.sh");

/**
 * Runs port::extract_port_pr_refs (from scripts/lib/port-common.sh) against
 * one commit-message line, via a real `bash` subshell — this is a thin shell
 * function, not a TS module, so the only faithful way to test it is to
 * actually source and invoke it, the same way port-status.sh does.
 */
function extractPortPrRefs(line: string): number[] {
  const out = execFileSync(
    "bash",
    [
      "-c",
      `source "$1" && port::extract_port_pr_refs`,
      "bash",
      LIB_PATH,
    ],
    { input: `${line}\n`, encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

describe("port::extract_port_pr_refs", () => {
  it("reads a combined slash-separated squash-merge title, not the trailing squash PR number", () => {
    expect(
      extractPortPrRefs(
        "feat: full results + print + fair-play markers, shared Modal + dialog semantics, a11y sweep, MnkBoard a11y (port of chess #103/#104/#107) (#57)",
      ),
    ).toEqual([103, 104, 107]);
  });

  it("reads a single-PR squash-merge title, not the trailing squash PR number", () => {
    expect(
      extractPortPrRefs(
        "feat(host): reinstate an absent player from the next round; honest late-join copy; rounds warning (port of chess #108) (#56)",
      ),
    ).toEqual([108]);
  });

  it("still reads the original body-line convention, including a combined mention", () => {
    expect(extractPortPrRefs("Port of sundaychess#66 and #70")).toEqual([
      66, 70,
    ]);
  });

  it("ignores an unrelated squash-merge PR number with no port mention", () => {
    expect(extractPortPrRefs("chore: bump chess.js (#12)")).toEqual([]);
  });
});
