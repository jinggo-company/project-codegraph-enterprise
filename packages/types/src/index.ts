// Shared types for CodeGraph Enterprise

// ─── Auth ───

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerified: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthAccount {
  id: string;
  userId: string;
  provider: string;
  providerId: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  role: Role;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Auth Tokens ───

export interface JwtPayload {
  sub: string;        // user id
  email: string;
  role: Role;
  iat: number;
  exp: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ─── Organization & Teams ───

/** Organization roles */
export type Role = 'owner' | 'admin' | 'developer' | 'viewer';

export interface Organization {
  id: string;
  name: string;
  slug: string;
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

// ─── Projects ───

export type ProjectStatus = 'PENDING_INDEX' | 'INDEXING' | 'READY' | 'FAILED' | 'DELETED';

export interface Project {
  id: string;
  teamId: string;
  name: string;
  gitUrl: string;
  branch: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Indexes ───

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

// ─── Audit ───

export interface AuditLog {
  id: string;
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

// ─── API Responses ───

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── DTOs ───

export interface CreateOrganizationDto {
  name: string;
  slug: string;
}

export interface CreateTeamDto {
  name: string;
}

export interface AddMemberDto {
  userId: string;
  role: Role;
}

export interface CreateProjectDto {
  name: string;
  gitUrl: string;
  branch?: string;
}

export interface UpdateProjectDto {
  name?: string;
  gitUrl?: string;
  branch?: string;
}

// ─── Role Hierarchy ───

export const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 4,
  admin: 3,
  developer: 2,
  viewer: 1,
};

/** Roles required for specific actions */
export const PERMISSIONS: Record<string, Role[]> = {
  'org:create': ['owner', 'admin', 'developer', 'viewer'],
  'org:update': ['owner', 'admin'],
  'org:delete': ['owner'],
  'team:create': ['owner', 'admin'],
  'team:update': ['owner', 'admin'],
  'team:delete': ['owner', 'admin'],
  'member:add': ['owner', 'admin'],
  'member:remove': ['owner', 'admin'],
  'project:create': ['owner', 'admin', 'developer'],
  'project:update': ['owner', 'admin', 'developer'],
  'project:delete': ['owner', 'admin'],
  'index:build': ['owner', 'admin', 'developer'],
  'index:view': ['owner', 'admin', 'developer', 'viewer'],
};
