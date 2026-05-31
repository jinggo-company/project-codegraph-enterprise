'use client';

import { useEffect, useState } from 'react';
import { useAppStore, type Project } from '@/stores/appStore';
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
import Link from 'next/link';

// Mock data for UI testing
const MOCK_PROJECTS: Project[] = [
  {
    id: 'proj-001',
    name: 'codegraph-enterprise',
    gitUrl: 'https://github.com/jinggo-company/project-codegraph-enterprise',
    teamId: 'team-001',
    status: 'completed',
    lastIndexedAt: '2026-06-01T05:00:00Z',
    stats: { filesScanned: 1250, symbolsIndexed: 8432, callGraphEdges: 15620 },
  },
  {
    id: 'proj-002',
    name: 'company-os',
    gitUrl: 'https://github.com/jinggo-company/company-os',
    teamId: 'team-001',
    status: 'running',
    stats: { filesScanned: 800, symbolsIndexed: 0, callGraphEdges: 0 },
  },
  {
    id: 'proj-003',
    name: 'api-gateway',
    gitUrl: 'https://github.com/jinggo-company/api-gateway',
    teamId: 'team-002',
    status: 'queued',
  },
];

export default function DashboardPage() {
  const { projects, setProjects, subscription } = useAppStore();
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    setProjects(MOCK_PROJECTS);
  }, [setProjects]);

  // Simulate real-time status updates (UI-004)
  useEffect(() => {
    const timer = setInterval(() => {
      setPollCount((c) => c + 1);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const completedCount = projects.filter((p) => p.status === 'completed').length;
  const runningCount = projects.filter((p) => p.status === 'running').length;
  const totalSymbols = projects.reduce((sum, p) => sum + (p.stats?.symbolsIndexed ?? 0), 0);
  const totalEdges = projects.reduce((sum, p) => sum + (p.stats?.callGraphEdges ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">仪表板</h1>
        <Link href="/dashboard/projects">
          <Button>创建项目</Button>
        </Link>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>总项目数</CardDescription>
            <CardTitle className="text-3xl">{projects.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>索引完成</CardDescription>
            <CardTitle className="text-3xl text-green-600">{completedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>构建中</CardDescription>
            <CardTitle className="text-3xl text-blue-600">{runningCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>符号总数</CardDescription>
            <CardTitle className="text-3xl">{totalSymbols.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Subscription info */}
      <Card>
        <CardHeader>
          <CardTitle>当前套餐: {subscription.plan.toUpperCase()}</CardTitle>
          <CardDescription>
            已使用 {projects.length}/{subscription.projectLimit} 个项目额度
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-2 rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all"
              style={{ width: `${Math.min((projects.length / subscription.projectLimit) * 100, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Projects table */}
      <Card>
        <CardHeader>
          <CardTitle>项目列表</CardTitle>
          <CardDescription>索引状态实时更新 (poll count: {pollCount})</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>项目名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>符号数</TableHead>
                <TableHead>调用图边数</TableHead>
                <TableHead>最后更新</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">
                    <Link href={`/dashboard/projects?id=${project.id}`} className="hover:underline">
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={project.status} />
                  </TableCell>
                  <TableCell>{project.stats?.symbolsIndexed?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell>{project.stats?.callGraphEdges?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {project.lastIndexedAt
                      ? new Date(project.lastIndexedAt).toLocaleString('zh-CN')
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Link href={`/dashboard/projects?id=${project.id}`}>
                      <Button variant="ghost" size="sm">查看详情</Button>
                    </Link>
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
