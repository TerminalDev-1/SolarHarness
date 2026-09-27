// Launches the app with the scripted demo Solar; --screenshots saves views to screenshots/ and exits.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env, SOLAR_DESKTOP_DEMO: "1" };
if (process.argv.includes("--screenshots")) env.SOLAR_DESKTOP_SCREENSHOTS = fileURLToPath(new URL("../screenshots", import.meta.url));
spawn(electron, ["."], { cwd: root, env, stdio: "inherit" }).on("close", code => { process.exitCode = code ?? 0; });
