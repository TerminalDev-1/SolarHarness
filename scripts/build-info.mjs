// Records the commit the build came from, so the header can show "v1.0 build <commit>".
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let commit;
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch { /* Not a Git checkout: the header shows the version alone. */ }
writeFileSync(new URL("../dist/build-info.json", import.meta.url), `${JSON.stringify({ commit })}\n`);
