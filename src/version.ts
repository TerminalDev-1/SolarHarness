import { readFileSync } from "node:fs";

// npm needs a three-part version (1.0.0); users see major.minor (1.0).
const packageVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export const SOLAR_VERSION = packageVersion.replace(/\.0$/, "");
