import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// npm needs a three-part version (1.0.0); users see major.minor (1.0).
const packageVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export const SOLAR_VERSION = packageVersion.replace(/\.0$/, "");

/** The commit this code was built from: dist/build-info.json after `npm run build`, else Git (for `npm run dev`). */
export const SOLAR_BUILD = buildCommit();

/** "1.0 build fb241f7", or "1.0" when the commit is unknown. */
export const SOLAR_VERSION_LABEL = SOLAR_BUILD ? `${SOLAR_VERSION} build ${SOLAR_BUILD}` : SOLAR_VERSION;

function buildCommit(): string | undefined {
  try {
    const commit = (JSON.parse(readFileSync(new URL("./build-info.json", import.meta.url), "utf8")) as { commit?: string }).commit;
    if (commit) return commit;
  } catch { /* Running from source; ask Git below. */ }
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
  } catch { return undefined; }
}
