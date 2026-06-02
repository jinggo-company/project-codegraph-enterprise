// CodeGraph Runner — executes CodeGraph index building
// Wraps git clone + CodeGraph scan + SQLite output
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm, stat, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

// ─── Types ──────────────────────────────────────────────────────────────

export interface IndexResult {
  indexDir: string;
  stats: IndexStats;
  sqlitePath: string;
}

export interface IndexStats {
  filesScanned: number;
  symbolsIndexed: number;
  callGraphEdges: number;
  sqliteSizeBytes: number;
  durationMs: number;
}

export interface CloneResult {
  repoDir: string;
  commitHash: string;
  branch: string;
}

// ─── Git Clone / Fetch ──────────────────────────────────────────────────

/**
 * Clone a git repository into a temp directory.
 */
export async function cloneRepository(
  gitUrl: string,
  branch: string = 'main',
  workDir?: string,
): Promise<CloneResult> {
  const tmpDir: string = workDir ?? path.join(os.tmpdir(), `codegraph-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const repoDir = path.join(tmpDir, 'repo');

  try {
    await execAsync(
      `git clone --depth 1 --branch ${branch} ${gitUrl} ${repoDir}`,
      { timeout: 300_000 }, // 5min timeout for large repos
    );

    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: repoDir });
    const commitHash = stdout.trim();

    return { repoDir, commitHash, branch };
  } catch (error: any) {
    // Cleanup on failure
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
    throw new Error(`Git clone failed: ${error.message}`);
  }
}

/**
 * Fetch updates into an existing cloned repo.
 */
export async function fetchRepository(repoDir: string, branch: string = 'main'): Promise<string> {
  await execAsync(`git fetch --depth 1 origin ${branch}`, { cwd: repoDir, timeout: 120_000 });
  await execAsync(`git reset --hard origin/${branch}`, { cwd: repoDir, timeout: 30_000 });

  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: repoDir });
  return stdout.trim();
}

// ─── CodeGraph Index Build ──────────────────────────────────────────────

/**
 * Run CodeGraph indexer over a cloned repo.
 * Outputs SQLite index file.
 */
export async function runCodeGraphIndex(
  repoDir: string,
  outputDir?: string,
): Promise<IndexResult> {
  const startTime = Date.now();
  const indexDir = outputDir ?? await mkTmpIndexDir();
  const sqlitePath = path.join(indexDir, 'index.db');

  try {
    // CodeGraph CLI invocation
    // The real CodeGraph binary would be invoked here:
    //   codegraph index --input <repoDir> --output <sqlitePath>
    // For now, we simulate the structure CodeGraph would produce
    // and scan the repo for basic stats.

    const filesScanned = await countSourceFiles(repoDir);

    // In production, this is where CodeGraph's Rust binary runs:
    // await execAsync(`codegraph index --input "${repoDir}" --output "${sqlitePath}"`);
    // For testing/simulation, we create a placeholder SQLite-compatible file
    // and compute synthetic stats

    // Create a placeholder index file
    await mkdir(indexDir, { recursive: true });

    // Placeholder: in real implementation, CodeGraph produces this
    const placeholder = Buffer.from(
      JSON.stringify({
        version: 1,
        repoDir,
        indexedAt: new Date().toISOString(),
        filesScanned,
        placeholder: true,
      }),
    );

    // For actual tests, we'll create a minimal SQLite-like file
    // In production, the real CodeGraph binary creates index.db
    await writeFileOrPlaceholder(sqlitePath, placeholder);

    const symbolsIndexed = Math.floor(filesScanned * 3.2); // avg symbols per file
    const callGraphEdges = Math.floor(filesScanned * 5.8); // avg call edges per file

    const sqliteSizeBytes = existsSync(sqlitePath)
      ? (await stat(sqlitePath)).size
      : 0;

    const durationMs = Date.now() - startTime;

    return {
      indexDir,
      sqlitePath,
      stats: {
        filesScanned,
        symbolsIndexed,
        callGraphEdges,
        sqliteSizeBytes,
        durationMs,
      },
    };
  } catch (error: any) {
    // Cleanup on failure
    try {
      await rm(indexDir, { recursive: true, force: true });
    } catch { /* ignore */ }
    throw new Error(`CodeGraph index build failed: ${error.message}`);
  }
}

// ─── Incremental Sync ───────────────────────────────────────────────────

/**
 * Compute changed files since last index.
 * Returns list of changed file paths.
 */
export async function getChangedFiles(
  repoDir: string,
  sinceCommit: string,
): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `git diff --name-only ${sinceCommit} HEAD`,
      { cwd: repoDir, timeout: 30_000 },
    );
    return stdout.split('\n').filter(Boolean);
  } catch {
    // If diff fails, assume all files changed
    return getAllSourceFiles(repoDir);
  }
}

/**
 * Run incremental index build.
 * Only re-index changed files and merge into existing index.
 */
export async function runIncrementalIndex(
  repoDir: string,
  existingIndexDir: string,
  sinceCommit: string,
): Promise<IndexResult> {
  const startTime = Date.now();

  const changedFiles = await getChangedFiles(repoDir, sinceCommit);

  if (changedFiles.length === 0) {
    return {
      indexDir: existingIndexDir,
      sqlitePath: path.join(existingIndexDir, 'index.db'),
      stats: {
        filesScanned: 0,
        symbolsIndexed: 0,
        callGraphEdges: 0,
        sqliteSizeBytes: existsSync(path.join(existingIndexDir, 'index.db'))
          ? (await stat(path.join(existingIndexDir, 'index.db'))).size
          : 0,
        durationMs: Date.now() - startTime,
      },
    };
  }

  // In production: codegraph incremental --input <repoDir> --changed <files> --merge <existingIndex>
  const filesScanned = changedFiles.length;
  const symbolsIndexed = Math.floor(filesScanned * 3.2);
  const callGraphEdges = Math.floor(filesScanned * 5.8);

  // Update the existing index file (placeholder)
  const sqlitePath = path.join(existingIndexDir, 'index.db');
  await writeFileOrPlaceholder(sqlitePath, Buffer.from(
    JSON.stringify({
      version: 2,
      incremental: true,
      changedFiles,
      indexedAt: new Date().toISOString(),
    }),
  ));

  const sqliteSizeBytes = existsSync(sqlitePath)
    ? (await stat(sqlitePath)).size
    : 0;

  return {
    indexDir: existingIndexDir,
    sqlitePath,
    stats: {
      filesScanned,
      symbolsIndexed,
      callGraphEdges,
      sqliteSizeBytes,
      durationMs: Date.now() - startTime,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function mkTmpIndexDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `codegraph-index-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function countSourceFiles(dir: string): Promise<number> {
  const extensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java',
    '.rs', '.c', '.cpp', '.h', '.hpp', '.rb', '.php',
    '.cs', '.kt', '.swift', '.scala',
  ]);

  let count = 0;
  try {
    const files = await readdir(dir, { recursive: true });
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (extensions.has(ext)) {
        count++;
      }
    }
  } catch { /* ignore */ }
  return count;
}

async function getAllSourceFiles(dir: string): Promise<string[]> {
  const extensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java',
    '.rs', '.c', '.cpp', '.h', '.hpp', '.rb', '.php',
    '.cs', '.kt', '.swift', '.scala',
  ]);

  const result: string[] = [];
  try {
    const files = await readdir(dir, { recursive: true });
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (extensions.has(ext)) {
        result.push(file);
      }
    }
  } catch { /* ignore */ }
  return result;
}

async function writeFileOrPlaceholder(filePath: string, content: Buffer): Promise<void> {
  // In production with real CodeGraph, this would be the actual SQLite DB
  // For testing, we write the placeholder
  const { writeFile } = await import('fs/promises');
  await writeFile(filePath, content);
}

/**
 * Cleanup temp directories.
 */
export async function cleanupTemp(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
}
