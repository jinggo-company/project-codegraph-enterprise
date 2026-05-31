'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function ProjectsPage() {
  const { projects, setProjects, subscription } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', gitUrl: '' });

  const handleCreate = () => {
    if (projects.length >= subscription.projectLimit) {
      alert('已达到项目数量上限，请升级套餐');
      return;
    }
    const project = {
      id: `proj-${Date.now()}`,
      name: newProject.name,
      gitUrl: newProject.gitUrl,
      teamId: 'team-001',
      status: 'pending_index' as const,
    };
    setProjects([...projects, project]);
    setShowCreate(false);
    setNewProject({ name: '', gitUrl: '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">项目管理</h1>
        <Button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? '取消' : '创建项目'}
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle>创建新项目</CardTitle>
            <CardDescription>绑定 Git 仓库以开始索引</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">项目名称</label>
              <Input
                placeholder="my-project"
                value={newProject.name}
                onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Git 仓库 URL</label>
              <Input
                placeholder="https://github.com/org/repo"
                value={newProject.gitUrl}
                onChange={(e) => setNewProject({ ...newProject, gitUrl: e.target.value })}
              />
            </div>
            <Button onClick={handleCreate}>创建并触发索引</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>Git URL</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-xs">{p.gitUrl}</TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">构建索引</Button>
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
