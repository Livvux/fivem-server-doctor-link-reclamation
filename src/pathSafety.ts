import fs from "node:fs";
import path from "node:path";
import type { DoctorConfig } from "./types.js";

export function rootsFor(config: DoctorConfig): string[] {
  return [config.txdata, config.serverCfg && path.dirname(config.serverCfg), config.resources]
    .filter((root): root is string => Boolean(root))
    .map((root) => path.resolve(root));
}

export function isUnderRoots(filePath: string, roots: string[]): boolean {
  const resolved = path.resolve(filePath);
  return roots.some((root) => {
    const rel = path.relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
