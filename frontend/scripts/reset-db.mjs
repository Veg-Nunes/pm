import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "..", "backend", "data");

rmSync(dataDir, { recursive: true, force: true });

console.log(`Removed ${dataDir}`);
