// Sync index job handler — incremental index sync
import { Job } from 'bullmq';
import { prisma } from '@codegraph/db';
import {
  cloneRepository,
  fetchRepository,
  runIncrementalIndex,
  cleanupTemp,
  type IndexResult,
} from '../runners/codegraph-runner.js';
import { uploadSnapshot } from '../lib/storage.js';

export interface SyncIndexJobData {
  jobId: string;
  projectId: string;
  indexId: string | null;
  type: string;
  trigger: string;
}

export async function handleSyncIndex(job: Job): Promise<IndexResult> {
  const data = job.data as SyncIndexJobData;
  const { projectId, indexId } = data;

  console.log(`[sync-index] Starting incremental sync for project ${projectId}, index ${indexId}`);

  // 1. Fetch project info
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  // 2. Find latest completed index for merge base
  const latestIndex = await prisma.index.findFirst({
    where: { projectId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    include: { stats: true },
  });

  // 3. Update index status to RUNNING
  if (indexId) {
    await prisma.index.update({
      where: { id: indexId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  // 4. Update job status
  await prisma.indexJob.updateMany({
    where: { id: data.jobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  let tmpDir: string | null = null;

  try {
    // 5. Clone repository
    const cloneResult = await cloneRepository(project.gitUrl, project.branch);
    tmpDir = cloneResult.repoDir.replace(/\/repo$/, '');
    const commitHash = cloneResult.commitHash;

    console.log(`[sync-index] Repo at commit: ${commitHash}`);

    // 6. Run incremental index
    const existingIndexDir = latestIndex
      ? `/tmp/codegraph-index-${projectId}-latest`
      : undefined;

    const sinceCommit = latestIndex?.stats
      ? (await prisma.indexStats.findFirst({
          where: { indexId: latestIndex.id },
        }))?.id ?? 'HEAD'
      : 'HEAD';

    // For now, use clone result dir for incremental
    const indexResult = await runIncrementalIndex(
      cloneResult.repoDir,
      existingIndexDir ?? `/tmp/codegraph-index-${projectId}`,
      sinceCommit,
    );

    console.log(`[sync-index] Incremental index complete: ${JSON.stringify(indexResult.stats)}`);

    // 7. Upload snapshot to MinIO
    const { storageKey, sizeBytes } = await uploadSnapshot(
      projectId,
      indexId ?? indexResult.indexDir,
      indexResult.sqlitePath,
    );

    // 8. Save snapshot record
    if (indexId) {
      await prisma.snapshot.create({
        data: {
          indexId,
          storageKey,
          sizeBytes: BigInt(sizeBytes),
        },
      });
    }

    // 9. Save sync log
    if (indexId) {
      await prisma.syncLog.create({
        data: {
          indexId,
          filesChanged: indexResult.stats.filesScanned,
          durationMs: indexResult.stats.durationMs,
        },
      });
    }

    // 10. Update index stats (merge or create)
    if (indexId) {
      const existingStats = latestIndex?.stats;
      await prisma.indexStats.upsert({
        where: { indexId },
        create: {
          indexId,
          filesScanned: indexResult.stats.filesScanned,
          symbolsIndexed: indexResult.stats.symbolsIndexed,
          callGraphEdges: indexResult.stats.callGraphEdges,
          sqliteSizeBytes: BigInt(indexResult.stats.sqliteSizeBytes),
          durationMs: indexResult.stats.durationMs,
        },
        update: {
          filesScanned: existingStats
            ? existingStats.filesScanned + indexResult.stats.filesScanned
            : indexResult.stats.filesScanned,
          symbolsIndexed: existingStats
            ? existingStats.symbolsIndexed + indexResult.stats.symbolsIndexed
            : indexResult.stats.symbolsIndexed,
          callGraphEdges: existingStats
            ? existingStats.callGraphEdges + indexResult.stats.callGraphEdges
            : indexResult.stats.callGraphEdges,
          sqliteSizeBytes: BigInt(indexResult.stats.sqliteSizeBytes),
          durationMs: indexResult.stats.durationMs,
        },
      });
    }

    // 11. Update index status to COMPLETED
    if (indexId) {
      await prisma.index.update({
        where: { id: indexId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
    }

    // 12. Update project status
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'READY' },
    });

    // 13. Update job status
    await prisma.indexJob.updateMany({
      where: { id: data.jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    console.log(`[sync-index] Job ${data.jobId} completed successfully`);

    return indexResult;
  } catch (error: any) {
    if (indexId) {
      await prisma.index.update({
        where: { id: indexId },
        data: { status: 'FAILED', error: error.message },
      }).catch(() => {});
    }

    await prisma.indexJob.updateMany({
      where: { id: data.jobId },
      data: {
        status: 'FAILED',
        error: error.message,
        retries: { increment: 1 },
      },
    }).catch(() => {});

    throw error;
  } finally {
    if (tmpDir) {
      await cleanupTemp(tmpDir);
    }
  }
}
