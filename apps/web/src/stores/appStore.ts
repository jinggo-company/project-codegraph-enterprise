import { create } from 'zustand';

export type Project = {
  id: string;
  name: string;
  gitUrl: string;
  teamId: string;
  status: 'pending_index' | 'queued' | 'running' | 'completed' | 'failed';
  lastIndexedAt?: string;
  stats?: {
    filesScanned: number;
    symbolsIndexed: number;
    callGraphEdges: number;
  };
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'developer' | 'viewer';
  avatar?: string;
};

export type AuditLog = {
  id: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  timestamp: string;
  ip?: string;
};

export type Subscription = {
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'expired' | 'past_due';
  expiresAt?: string;
  projectLimit: number;
};

interface AppState {
  // Auth
  isAuthenticated: boolean;
  user: { name: string; email: string } | null;
  setAuth: (auth: { name: string; email: string }) => void;
  logout: () => void;

  // Projects
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  updateProjectStatus: (id: string, status: Project['status']) => void;

  // Teams
  members: TeamMember[];
  setMembers: (members: TeamMember[]) => void;

  // Audit
  auditLogs: AuditLog[];
  setAuditLogs: (logs: AuditLog[]) => void;

  // Billing
  subscription: Subscription;
  setSubscription: (sub: Subscription) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isAuthenticated: false,
  user: null,
  setAuth: (auth) => set({ isAuthenticated: true, user: auth }),
  logout: () => set({ isAuthenticated: false, user: null }),

  projects: [],
  setProjects: (projects) => set({ projects }),
  updateProjectStatus: (id, status) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, status } : p)),
    })),

  members: [],
  setMembers: (members) => set({ members }),

  auditLogs: [],
  setAuditLogs: (logs) => set({ auditLogs: logs }),

  subscription: { plan: 'free', status: 'active', projectLimit: 3 },
  setSubscription: (sub) => set({ subscription: sub }),
}));
