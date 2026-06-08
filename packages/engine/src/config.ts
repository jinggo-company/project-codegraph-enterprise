import path from 'node:path';

/** Resolve the SQLite index file path for a given project */
export function getIndexFilePath(indexDir: string, projectId: string): string {
  return path.join(indexDir, projectId, 'index.db');
}
