'use client';

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

const MOCK_INDEXES = [
  { id: 'idx-001', projectId: 'proj-001', projectName: 'codegraph-enterprise', status: 'completed' as const, type: 'full', createdAt: '2026-06-01T04:00:00Z', stats: { filesScanned: 1250, symbolsIndexed: 8432, callGraphEdges: 15620 } },
  { id: 'idx-002', projectId: 'proj-002', projectName: 'company-os', status: 'running' as const, type: 'full', createdAt: '2026-06-01T05:30:00Z', stats: { filesScanned: 800, symbolsIndexed: 0, callGraphEdges: 0 } },
  { id: 'idx-003', projectId: 'proj-003', projectName: 'api-gateway', status: 'queued' as const, type: 'incremental', createdAt: '2026-06-01T05:45:00Z' },
];

const CHART_DATA = [
  { name: 'Mon', symbols: 5000, files: 800 },
  { name: 'Tue', symbols: 6200, files: 950 },
  { name: 'Wed', symbols: 7800, files: 1100 },
  { name: 'Thu', symbols: 8432, files: 1250 },
  { name: 'Fri', symbols: 9000, files: 1400 },
];

export default function IndexesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">索引管理</h1>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>索引趋势</CardTitle>
          <CardDescription>本周符号索引与文件扫描数量</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={CHART_DATA}>
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

      {/* Index table */}
      <Card>
        <CardHeader>
          <CardTitle>索引实例</CardTitle>
          <CardDescription>所有项目的索引状态</CardDescription>
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
                <TableHead>创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MOCK_INDEXES.map((idx) => (
                <TableRow key={idx.id}>
                  <TableCell className="font-medium">{idx.projectName}</TableCell>
                  <TableCell>{idx.type === 'full' ? '全量' : '增量'}</TableCell>
                  <TableCell><StatusBadge status={idx.status} /></TableCell>
                  <TableCell>{idx.stats?.filesScanned?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell>{idx.stats?.symbolsIndexed?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(idx.createdAt).toLocaleString('zh-CN')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
