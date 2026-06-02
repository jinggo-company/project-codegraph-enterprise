// MinIO storage helper for worker — re-exported from api/lib/storage or standalone
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
 */
export async function uploadSnapshot(
  projectId: string,
  indexId: string,
  filePath: string,
  contentType: string = 'application/octet-stream',
): Promise<{ storageKey: string; sizeBytes: number }> {
  const storageKey = `${projectId}/${indexId}/index.db`;

  const { stat: fsStat } = await import('fs/promises');
  const fileStat = await fsStat(filePath);

  await minioClient.fPutObject(BUCKET_NAME, storageKey, filePath, {
    'Content-Type': contentType,
  });

  const stat = await minioClient.statObject(BUCKET_NAME, storageKey);
  return { storageKey, sizeBytes: stat.size };
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

export { minioClient, BUCKET_NAME };
