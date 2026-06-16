import { promises as fs } from "node:fs";
import path from "node:path";

export function resolveFromCwd(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

export async function readTextFile(filePath: string): Promise<string> {
  const absolutePath = resolveFromCwd(filePath);

  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read file "${filePath}": ${formatError(error)}`);
  }
}

export async function readBinaryFile(filePath: string): Promise<Buffer> {
  const absolutePath = resolveFromCwd(filePath);

  try {
    return await fs.readFile(absolutePath);
  } catch (error) {
    throw new Error(`Could not read file "${filePath}": ${formatError(error)}`);
  }
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  const absolutePath = resolveFromCwd(filePath);
  await ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, content, "utf8");
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(resolveFromCwd(filePath));
    return true;
  } catch {
    return false;
  }
}

export async function deleteFileIfExists(filePath: string): Promise<boolean> {
  if (!(await fileExists(filePath))) {
    return false;
  }

  await fs.unlink(resolveFromCwd(filePath));
  return true;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
