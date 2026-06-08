'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// ─── Types ─────────────────────────────────────────────────────────────
interface IndexStats {
  filesScanned: number;
  symbolsIndexed: number;
  callGraphEdges: number;
  sqliteSizeBytes: number;
  durationMs: number;
  languages?: Record<string, number>;
}

interface IndexEntry {
  id: string;
  projectId: string;
  type: 'FULL' | 'INCREMENTAL' | 'CLEANUP';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  triggerSource: 'WEBHOOK' | 'MANUAL' | 'WATCHER' | 'SCHEDULE';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  error?: string;
  project: {
    id: string;
    name: string;
    gitUrl: string;
    team: { name: string };
  };
  stats: IndexStats | null;
}

interface IndexListResponse {
  data: IndexEntry[];
  total: number;
  page: number;
  limit: number;
}

// ─── API helper ────────────────────────────────────────────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function apiFetch(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ─── Chart data derived from real indexes ──────────────────────────────
function buildChartData(indexes: IndexEntry[]) {
  const dayMap = new Map<string, { files: number; symbols: number }>();
  for (const idx of indexes) {
    if (!idx.stats) continue;
    const day = new Date(idx.updatedAt).toLocaleDateString('zh-CN', { weekday: 'short' });
    const bucket = dayMap.get(day) ?? { files: 0, symbols: 0 };
    bucket.files += idx.stats.filesScanned;
    bucket.symbols += idx.stats.symbolsIndexed;
    dayMap.set(day, bucket);
  }
  return Array.from(dayMap.entries()).map(([name, v]) => ({ name, ...v }));
}

// ─── Language distribution for a given index ───────────────────────────
function LanguageBadge({ languages }: { languages?: Record<string, number> }) {
  if (!languages || Object.keys(languages).length === 0) return null;
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <div className="flex gap-1 flex-wrap">
      {entries.map(([lang, count]) => (
        <span
          key={lang}
          className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs text-slate-600 dark:text-slate-300"
        >
          {lang}: {count}
        </span>
      ))}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────
export default function IndexesPage() {
  const [indexes, setIndexes] = useState<IndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const limit = 20;
  const orgId = 'org-001'; // TODO: from session

  const fetchIndexes = async (p: number, status?: string) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (status) query.set('status', status);
      const res: IndexListResponse = await apiFetch(`/api/organizations/${orgId}/indexes?${query}`);
      setIndexes(res.data);
      setTotal(res.total);
      setPage(res.page);
    } catch (e) {
      console.error('Failed to fetch indexes:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchIndexes(1, filterStatus || undefined); }, [filterStatus]);

  // ─── Actions ─────────────────────────────────────────────────────────
  const handleRebuild = async (indexId: string) => {
    setActionLoading(indexId);
    try {
      await apiFetch(`/api/indexes/${indexId}/rebuild`, { method: 'POST' });
      fetchIndexes(page, filterStatus || undefined);
    } catch (e) {
      console.error('Rebuild failed:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (indexId: string) => {
    setActionLoading(indexId);
    try {
      await apiFetch(`/api/indexes/${indexId}/cancel`, { method: 'POST' });
      fetchIndexes(page, filterStatus || undefined);
    } catch (e) {
      console.error('Cancel failed:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const chartData = buildChartData(indexes);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">索引管理</h1>
        <div className="flex gap-2">
          {['', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'].map((s) => (
            <Button
              key={s}
              variant={filterStatus === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus(s)}
            >
              {s === '' ? '全部' : s === 'QUEUED' ? '排队' : s === 'RUNNING' ? '构建中' : s === 'COMPLETED' ? '完成' : '失败'}
            </Button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>索引趋势</CardTitle>
            <CardDescription>符号索引与文件扫描数量</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="symbols" fill="#3b82f6" name="符号数" />
                <Bar dataKey="files" fill="#22c55e" name="文件数" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Index table */}
      <Card>
        <CardHeader>
          <CardTitle>索引实例</CardTitle>
          <CardDescription>{total} 条索引记录</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>项目</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>文件数</TableHead>
                <TableHead>符号数</TableHead>
                <TableHead>语言分布</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">加载中…</TableCell></TableRow>
              ) : indexes.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">暂无索引记录</TableCell></TableRow>
              ) : (
                indexes.map((idx) => {
                  const statusMap: Record<string, 'completed' | 'running' | 'queued' | 'failed' | 'pending_index'> = {
                    QUEUED: 'queued', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed',
                  };
                  const status = statusMap[idx.status] ?? 'queued';
                  const duration = idx.stats?.durationMs
                    ? `${(idx.stats.durationMs / 1000).toFixed(1)}s`
                    : '—';
                  return (
                    <TableRow key={idx.id}>
                      <TableCell className="font-medium">{idx.project.name}</TableCell>
                      <TableCell>{idx.type === 'FULL' ? '全量' : idx.type === 'INCREMENTAL' ? '增量' : '清理'}</TableCell>
                      <TableCell><StatusBadge status={status} /></TableCell>
                      <TableCell>{idx.stats?.filesScanned?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell>{idx.stats?.symbolsIndexed?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell><LanguageBadge languages={idx.stats?.languages as Record<string, number> | undefined} /></TableCell>
                      <TableCell>{duration}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(idx.updatedAt).toLocaleString('zh-CN')}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {(idx.status === 'COMPLETED' || idx.status === 'FAILED') && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={actionLoading === idx.id}
                              onClick={() => handleRebuild(idx.id)}
                            >
                              {actionLoading === idx.id ? '…' : '重建'}
                            </Button>
                          )}
                          {(idx.status === 'QUEUED' || idx.status === 'RUNNING') && (
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={actionLoading === idx.id}
                              onClick={() => handleCancel(idx.id)}
                            >
                              {actionLoading === idx.id ? '…' : '取消'}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {/* Pagination */}
          {total > limit && (
            <div className="flex justify-between items-center mt-4">
              <span className="text-sm text-muted-foreground">
                第 {page} 页 / 共 {Math.ceil(total / limit)} 页
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => fetchIndexes(page - 1)}>
                  上一页
                </Button>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / limit)} onClick={() => fetchIndexes(page + 1)}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
