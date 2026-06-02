// Cleanup index job handler — remove expired indexes
import { Job } from 'bullmq';
import { prisma } from '@codegraph/db';
import { deleteIndexSnapshots } from '../lib/storage.js';

export interface CleanupIndexJobData {
  jobId: string;
  projectId: string;
  indexId: string | null;
  type: string;
  trigger: string;
}

export async function handleCleanupIndex(job: Job): Promise<void> {
  const data = job.data as CleanupIndexJobData;
  const { projectId, indexId } = data;

  console.log(`[cleanup-index] Starting cleanup for project ${projectId}, index ${indexId}`);

  // 1. Find expired/completed indexes to clean
  // Strategy: keep the 3 most recent completed indexes, delete older ones
  const indexesToKeep = parseInt(process.env.INDEX_RETENTION_COUNT ?? '3', 10);

  const allCompleted = await prisma.index.findMany({
    where: {
      projectId,
      status: 'COMPLETED',
      // Don't delete the index being cleaned up itself
      ...(indexId ? { NOT: { id: indexId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { snapshots: true, stats: true },
  });

  const toDelete = allCompleted.slice(indexesToKeep);

  console.log(`[cleanup-index] Found ${allCompleted.length} completed indexes, deleting ${toDelete.length}`);

  for (const index of toDelete) {
    try {
      // Delete MinIO snapshots
      for (const snapshot of index.snapshots) {
        await deleteIndexSnapshots(projectId, index.id);
        await prisma.snapshot.delete({
          where: { id: snapshot.id },
        }).catch(() => {});
      }

      // Delete stats
      await prisma.indexStats.delete({
        where: { indexId: index.id },
      }).catch(() => {});

      // Delete sync logs
      const syncLogs = await prisma.syncLog.findMany({
        where: { indexId: index.id },
      });
      for (const log of syncLogs) {
        await prisma.syncLog.delete({
          where: { id: log.id },
        }).catch(() => {});
      }

      // Delete index record
      await prisma.index.delete({
        where: { id: index.id },
      });

      console.log(`[cleanup-index] Deleted index ${index.id}`);
    } catch (error: any) {
      console.error(`[cleanup-index] Failed to delete index ${index.id}: ${error.message}`);
    }
  }

  // Update job status
  await prisma.indexJob.updateMany({
    where: { id: data.jobId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
    },
  });

  console.log(`[cleanup-index] Job ${data.jobId} completed. Cleaned up ${toDelete.length} indexes`);
}
