// Build index job handler — full index build
import { Job } from 'bullmq';
import { prisma } from '@codegraph/db';
import {
  cloneRepository,
  runCodeGraphIndex,
  cleanupTemp,
  type IndexResult,
} from '../runners/codegraph-runner.js';
import { uploadSnapshot } from '../lib/storage.js';

export interface BuildIndexJobData {
  jobId: string;
  projectId: string;
  indexId: string | null;
  type: string;
  trigger: string;
}

export async function handleBuildIndex(job: Job): Promise<IndexResult> {
  const data = job.data as BuildIndexJobData;
  const { projectId, indexId } = data;

  console.log(`[build-index] Starting full index build for project ${projectId}, index ${indexId}`);

  // 1. Fetch project info
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  // 2. Update index status to RUNNING
  if (indexId) {
    await prisma.index.update({
      where: { id: indexId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
  }

  // 3. Update job status
  await prisma.indexJob.updateMany({
    where: { id: data.jobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  let tmpDir: string | null = null;

  try {
    // 4. Clone repository
    const cloneResult = await cloneRepository(
      project.gitUrl,
      project.branch,
    );
    tmpDir = cloneResult.repoDir.replace(/\/repo$/, ''); // get parent temp dir

    console.log(`[build-index] Cloned repo, commit: ${cloneResult.commitHash}`);

    // 5. Run CodeGraph indexer
    const indexResult = await runCodeGraphIndex(cloneResult.repoDir);

    console.log(`[build-index] Index complete: ${JSON.stringify(indexResult.stats)}`);

    // 6. Upload snapshot to MinIO
    const { storageKey, sizeBytes } = await uploadSnapshot(
      projectId,
      indexId ?? indexResult.indexDir,
      indexResult.sqlitePath,
    );

    console.log(`[build-index] Snapshot uploaded: ${storageKey} (${sizeBytes} bytes)`);

    // 7. Save snapshot record
    if (indexId) {
      await prisma.snapshot.create({
        data: {
          indexId,
          storageKey,
          sizeBytes: BigInt(sizeBytes),
        },
      });
    }

    // 8. Save index stats
    if (indexId) {
      await prisma.indexStats.create({
        data: {
          indexId,
          filesScanned: indexResult.stats.filesScanned,
          symbolsIndexed: indexResult.stats.symbolsIndexed,
          callGraphEdges: indexResult.stats.callGraphEdges,
          sqliteSizeBytes: BigInt(indexResult.stats.sqliteSizeBytes),
          durationMs: indexResult.stats.durationMs,
        },
      });
    }

    // 9. Update index status to COMPLETED
    if (indexId) {
      await prisma.index.update({
        where: { id: indexId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
    }

    // 10. Update project status
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'READY' },
    });

    // 11. Update job status
    await prisma.indexJob.updateMany({
      where: { id: data.jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // 12. Write audit log for build completion
    const team = await prisma.team.findUnique({ where: { id: project.teamId }, include: { organization: true } });
    if (team) {
      await prisma.auditLog.create({
        data: {
          organizationId: team.organizationId,
          userId: 'system',
          action: 'BUILD_INDEX_COMPLETED',
          entityType: 'index',
          entityId: indexId ?? undefined,
          details: {
            projectId,
            type: data.type,
            trigger: data.trigger,
            filesScanned: indexResult.stats.filesScanned,
            symbolsIndexed: indexResult.stats.symbolsIndexed,
            durationMs: indexResult.stats.durationMs,
          },
        },
      });
    }

    console.log(`[build-index] Job ${data.jobId} completed successfully`);

    return indexResult;
  } catch (buildError: any) {
    // Update index status to FAILED
    if (indexId) {
      await prisma.index.update({
        where: { id: indexId },
        data: {
          status: 'FAILED',
          error: buildError.message,
        },
      }).catch(() => {});
    }

    // Update job status
    await prisma.indexJob.updateMany({
      where: { id: data.jobId },
      data: {
        status: 'FAILED',
        error: buildError.message,
        retries: { increment: 1 },
      },
    }).catch(() => {});

    // Write audit log for build failure
    try {
      const project = await prisma.project.findUnique({ where: { id: projectId }, include: { team: { include: { organization: true } } } });
      if (project?.team?.organizationId) {
        await prisma.auditLog.create({
          data: {
            organizationId: project.team.organizationId,
            userId: 'system',
            action: 'BUILD_INDEX_FAILED',
            entityType: 'index',
            entityId: indexId ?? undefined,
            details: { projectId, type: data.type, trigger: data.trigger, error: buildError?.message ?? 'unknown' },
          },
        });
      }
    } catch (auditErr) {
      console.error('[build-index] Failed to write audit log:', auditErr);
    }

    throw buildError;
  } finally {

    // 13. Cleanup temp files
    if (tmpDir) {
      await cleanupTemp(tmpDir);
    }
  }
}
