import { chmodSync } from "node:fs";

chmodSync("dist/src/index.js", 0o755);
