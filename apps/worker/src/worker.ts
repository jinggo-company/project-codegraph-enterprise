import { Worker, Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

const connection: ConnectionOptions = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null }
);

// Create queues
const buildQueue = new Queue("build-index", { connection });
const syncQueue = new Queue("sync-index", { connection });
const cleanupQueue = new Queue("cleanup-index", { connection });

// Worker: build-index
const buildWorker = new Worker(
  "build-index",
  async (job) => {
    console.log(`[build-index] Processing job ${job.id}: ${JSON.stringify(job.data)}`);
    // TODO: integrate with CodeGraph engine
    return { status: "placeholder" };
  },
  { connection }
);

// Worker: sync-index
const syncWorker = new Worker(
  "sync-index",
  async (job) => {
    console.log(`[sync-index] Processing job ${job.id}: ${JSON.stringify(job.data)}`);
    return { status: "placeholder" };
  },
  { connection }
);

// Worker: cleanup-index
const cleanupWorker = new Worker(
  "cleanup-index",
  async (job) => {
    console.log(`[cleanup-index] Processing job ${job.id}: ${JSON.stringify(job.data)}`);
    return { status: "placeholder" };
  },
  { connection }
);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down workers...");
  await Promise.all([
    buildWorker.close(),
    syncWorker.close(),
    cleanupWorker.close(),
  ]);
  await (connection as Redis).quit();
  process.exit(0);
});

console.log("CodeGraph Worker started, waiting for jobs...");
