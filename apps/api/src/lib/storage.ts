// MinIO/S3 snapshot storage
import { Client } from 'minio';

// Singleton MinIO client
let _minioClient: Client | null = null;

export function getMinioClient(): Client {
  if (!_minioClient) {
    _minioClient = new Client({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    });
  }
  return _minioClient;
}

/**
 * Upload an index snapshot file to MinIO.
 * @param orgId Organization ID (namespace)
 * @param projectId Project ID
 * @param indexId Index ID
 * @param filePath Path to local SQLite/DB file
 * @returns storage key in MinIO
 */
export async function uploadSnapshot(
  orgId: string,
  projectId: string,
  indexId: string,
  filePath: string
): Promise<{ storageKey: string; sizeBytes: number }> {
  const client = getMinioClient();
  const bucket = process.env.MINIO_BUCKET ?? 'codegraph-indexes';

  // Ensure bucket exists
  const exists = await client.bucketExists(bucket);
  if (!exists) {
    await client.makeBucket(bucket, 'us-east-1');
  }

  const storageKey = `${orgId}/${projectId}/${indexId}.sqlite`;
  await client.fPutObject(bucket, storageKey, filePath);

  const stat = await client.statObject(bucket, storageKey);
  return { storageKey, sizeBytes: stat.size };
}

/**
 * Download an index snapshot to a local file.
 * @returns local file path
 */
export async function downloadSnapshot(
  indexId: string,
  localPath: string
): Promise<void> {
  const client = getMinioClient();
  const bucket = process.env.MINIO_BUCKET ?? 'codegraph-indexes';

  // We need to find the storage key from the key metadata
  // In production, store a mapping in DB. For now use convention.
  // The caller should provide full storageKey; this is a helper.
}

/**
 * List all snapshots for a project.
 */
export async function listProjectSnapshots(
  orgId: string,
  projectId: string
): Promise<{ storageKey: string; sizeBytes: number; lastModified: Date }[]> {
  const client = getMinioClient();
  const bucket = process.env.MINIO_BUCKET ?? 'codegraph-indexes';

  const results: { storageKey: string; sizeBytes: number; lastModified: Date }[] = [];
  const stream = client.listObjects(bucket, `${orgId}/${projectId}/`, true);

  for await (const obj of stream) {
    results.push({
      storageKey: obj.name!,
      sizeBytes: obj.size ?? 0,
      lastModified: obj.lastModified ?? new Date(),
    });
  }

  return results;
}

/**
 * Delete an index snapshot.
 */
export async function deleteSnapshot(storageKey: string): Promise<void> {
  const client = getMinioClient();
  const bucket = process.env.MINIO_BUCKET ?? 'codegraph-indexes';
  await client.removeObject(bucket, storageKey);
}
