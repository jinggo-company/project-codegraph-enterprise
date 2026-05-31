// MinIO storage helper for index snapshots
import { Client } from 'minio';

const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'codegraph',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'codegraph-secret',
});

const BUCKET_NAME = process.env.MINIO_BUCKET ?? 'codegraph-indexes';

/**
 * Ensure the bucket exists (creates if not).
 */
export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(BUCKET_NAME);
  if (!exists) {
    await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
  }
}

/**
 * Upload a file to MinIO.
 * Returns the storage key (object path).
 */
export async function uploadSnapshot(
  projectId: string,
  indexId: string,
  filePath: string,
  contentType: string = 'application/octet-stream',
): Promise<{ storageKey: string; sizeBytes: number }> {
  const storageKey = `${projectId}/${indexId}/index.db`;

  await minioClient.fPutObject(BUCKET_NAME, storageKey, filePath, {
    'Content-Type': contentType,
  });

  // fPutObject doesn't return size, get it from the file
  const stat = await minioClient.statObject(BUCKET_NAME, storageKey);
  return { storageKey, sizeBytes: stat.size };
}

/**
 * Upload from a buffer/stream.
 */
export async function uploadSnapshotBuffer(
  projectId: string,
  indexId: string,
  buffer: Buffer,
  contentType: string = 'application/octet-stream',
): Promise<{ storageKey: string; sizeBytes: number }> {
  const storageKey = `${projectId}/${indexId}/index.db`;
  const sizeBytes = buffer.length;

  await minioClient.putObject(BUCKET_NAME, storageKey, buffer, sizeBytes, {
    'Content-Type': contentType,
  });

  return { storageKey, sizeBytes };
}

/**
 * Download a snapshot file from MinIO.
 */
export async function downloadSnapshot(
  projectId: string,
  indexId: string,
  destPath: string,
): Promise<void> {
  const storageKey = `${projectId}/${indexId}/index.db`;
  await minioClient.fGetObject(BUCKET_NAME, storageKey, destPath);
}

/**
 * Delete all snapshot files for an index.
 */
export async function deleteIndexSnapshots(
  projectId: string,
  indexId: string,
): Promise<void> {
  const prefix = `${projectId}/${indexId}/`;

  const stream = minioClient.listObjects(BUCKET_NAME, prefix, true);
  const objects: string[] = [];

  for await (const obj of stream) {
    objects.push(obj.name);
  }

  if (objects.length > 0) {
    await minioClient.removeObjects(BUCKET_NAME, objects);
  }
}

/**
 * Get the size of a stored snapshot.
 */
export async function getSnapshotSize(
  projectId: string,
  indexId: string,
): Promise<number> {
  const storageKey = `${projectId}/${indexId}/index.db`;
  const stat = await minioClient.statObject(BUCKET_NAME, storageKey);
  return stat.size;
}

/**
 * Generate a presigned URL for direct download.
 */
export async function generateDownloadUrl(
  projectId: string,
  indexId: string,
  expirySeconds: number = 3600,
): Promise<string> {
  const storageKey = `${projectId}/${indexId}/index.db`;
  return minioClient.presignedGetObject(
    BUCKET_NAME,
    storageKey,
    expirySeconds,
  );
}

export { minioClient, BUCKET_NAME };
