// Shared types for CodeGraph Enterprise

/** Organization roles */
export type Role = 'owner' | 'admin' | 'developer' | 'viewer';

/** Index job types */
export type IndexJobType = 'full' | 'incremental' | 'cleanup';

/** Index job statuses */
export type IndexJobStatus = 'queued' | 'running' | 'completed' | 'failed';

/** Index job trigger sources */
export type TriggerSource = 'webhook' | 'manual' | 'watcher' | 'schedule';

export interface IndexJob {
  id: string;
  projectId: string;
  type: IndexJobType;
  status: IndexJobStatus;
  triggerSource: TriggerSource;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  stats?: IndexStats;
}

export interface IndexStats {
  filesScanned: number;
  symbolsIndexed: number;
  callGraphEdges: number;
  sqliteSizeBytes: number;
  durationMs: number;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
}

export interface Member {
  id: string;
  teamId: string;
  userId: string;
  role: Role;
  joinedAt: Date;
}

export interface Project {
  id: string;
  teamId: string;
  name: string;
  gitUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}
