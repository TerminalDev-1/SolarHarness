import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// npm needs a three-part version (2.0.0); users see major.minor (2.0).
const packageVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export const SOLAR_VERSION = packageVersion.replace(/\.0$/, "");

/** The release name shown after the version. Change it only with a version bump. */
export const SOLAR_RELEASE_NAME = "New Beginning";

/** The commit this code was built from: dist/build-info.json after `npm run build`, else Git (for `npm run dev`). */
export const SOLAR_BUILD = buildCommit();

/** "2.0 New Beginning build fb241f7", or "2.0 New Beginning" when the commit is unknown. */
export const SOLAR_VERSION_LABEL = SOLAR_BUILD ? `${SOLAR_VERSION} ${SOLAR_RELEASE_NAME} build ${SOLAR_BUILD}` : `${SOLAR_VERSION} ${SOLAR_RELEASE_NAME}`;

function buildCommit(): string | undefined {
  try {
    const commit = (JSON.parse(readFileSync(new URL("./build-info.json", import.meta.url), "utf8")) as { commit?: string }).commit;
    if (commit) return commit;
  } catch { /* Running from source; ask Git below. */ }
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
  } catch { return undefined; }
}
