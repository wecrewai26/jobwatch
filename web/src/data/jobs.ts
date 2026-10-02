export type JobStatus = "running" | "queued" | "succeeded" | "failed" | "cancelled";

export type Job = {
  id: string;
  name: string;
  status: JobStatus;
  queue: string;
  worker: string;
  service: string;
  env: "prod" | "staging" | "dev";
  cpuPct: number;
  memMb: number;
  memLimitMb: number;
  durationSec: number;
  retries: number;
  startedAt: number;
  image: string;
  sparkCpu: number[];
  sparkMem: number[];
};

const NAMES = [
  "invoice-reconcile",
  "email-digest",
  "ml-feature-build",
  "video-transcode",
  "webhook-retry",
  "csv-import",
  "report-pdf",
  "cache-warm",
  "search-reindex",
  "billing-settle",
  "image-optimize",
  "audit-export",
  "slack-notify",
  "db-vacuum",
  "geo-enrich",
  "session-prune",
];

const QUEUES = ["default", "critical", "batch", "media", "mail"];
const WORKERS = ["wrk-a1", "wrk-a2", "wrk-b1", "wrk-b2", "wrk-c1", "wrk-edge-1"];
const SERVICES = ["billing", "media", "notifications", "search", "analytics", "ops"];
const IMAGES = [
  "ghcr.io/jobwatch/worker:1.4.2",
  "ghcr.io/jobwatch/worker:1.4.1",
  "ghcr.io/jobwatch/ffmpeg:0.9.0",
  "ghcr.io/jobwatch/python-ml:2.1.0",
];

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function spark(seed: number, points = 24): number[] {
  const out: number[] = [];
  let v = 20 + hash(seed) * 40;
  for (let i = 0; i < points; i++) {
    v = Math.max(2, Math.min(98, v + (hash(seed + i) - 0.48) * 18));
    out.push(Math.round(v));
  }
  return out;
}

const STATUSES: JobStatus[] = [
  "running",
  "running",
  "running",
  "queued",
  "queued",
  "succeeded",
  "succeeded",
  "succeeded",
  "failed",
  "cancelled",
];

export function generateJobs(count = 48): Job[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const status = STATUSES[Math.floor(hash(i + 1) * STATUSES.length)]!;
    const memLimitMb = [256, 512, 1024, 2048][Math.floor(hash(i + 7) * 4)]!;
    const cpuPct =
      status === "queued" || status === "cancelled"
        ? 0
        : Math.round(8 + hash(i + 3) * (status === "running" ? 85 : 40));
    const memMb =
      status === "queued"
        ? 0
        : Math.round(memLimitMb * (0.12 + hash(i + 5) * 0.7));

    return {
      id: `job_${(100000 + i).toString(36)}`,
      name: NAMES[i % NAMES.length]!,
      status,
      queue: QUEUES[Math.floor(hash(i + 11) * QUEUES.length)]!,
      worker: WORKERS[Math.floor(hash(i + 13) * WORKERS.length)]!,
      service: SERVICES[Math.floor(hash(i + 17) * SERVICES.length)]!,
      env: (["prod", "staging", "dev"] as const)[Math.floor(hash(i + 19) * 3)]!,
      cpuPct,
      memMb,
      memLimitMb,
      durationSec:
        status === "queued"
          ? 0
          : Math.round(12 + hash(i + 23) * (status === "running" ? 900 : 400)),
      retries: Math.floor(hash(i + 29) * (status === "failed" ? 4 : 2)),
      startedAt: now - Math.round(hash(i + 31) * 3_600_000),
      image: IMAGES[Math.floor(hash(i + 37) * IMAGES.length)]!,
      sparkCpu: spark(i * 3 + 1),
      sparkMem: spark(i * 3 + 2),
    };
  });
}

export function tickJob(job: Job, t: number): Job {
  if (job.status !== "running") return job;

  const drift = (hash(t + job.id.length) - 0.5) * 8;
  const cpuPct = Math.max(4, Math.min(99, Math.round(job.cpuPct + drift)));
  const memDrift = (hash(t * 2 + job.name.length) - 0.5) * 12;
  const memMb = Math.max(
    32,
    Math.min(job.memLimitMb, Math.round(job.memMb + memDrift)),
  );

  return {
    ...job,
    cpuPct,
    memMb,
    durationSec: job.durationSec + 2,
    sparkCpu: [...job.sparkCpu.slice(1), cpuPct],
    sparkMem: [
      ...job.sparkMem.slice(1),
      Math.round((memMb / job.memLimitMb) * 100),
    ],
  };
}

export const LOG_LINES: Record<JobStatus, string[]> = {
  running: [
    "worker claimed job from queue",
    "loading runtime config",
    "connected to postgres pool (8)",
    "processing batch 1/12",
    "checkpoint written",
    "processing batch 2/12",
    "heartbeat ok",
  ],
  queued: [
    "enqueued by scheduler",
    "waiting for free worker slot",
    "priority score recalculated",
  ],
  succeeded: [
    "final batch committed",
    "artifacts uploaded to object store",
    "ack sent to broker",
    "job marked succeeded",
  ],
  failed: [
    "attempt 2 started",
    "timeout waiting on upstream API",
    "retry backoff 30s",
    "ERROR: MaxRetriesExceeded",
  ],
  cancelled: [
    "cancel signal received",
    "rolling back partial writes",
    "job marked cancelled",
  ],
};

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

export function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
