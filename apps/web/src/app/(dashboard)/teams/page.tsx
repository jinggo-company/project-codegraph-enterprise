'use client';

import { useEffect } from 'react';
import { useAppStore, type TeamMember } from '@/stores/appStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const MOCK_MEMBERS: TeamMember[] = [
  { id: 'u1', name: '晶Q', email: 'jingq@example.com', role: 'owner' },
  { id: 'u2', name: '全丞', email: 'quanchen@example.com', role: 'admin' },
  { id: 'u3', name: 'Alice', email: 'alice@example.com', role: 'developer' },
  { id: 'u4', name: 'Bob', email: 'bob@example.com', role: 'viewer' },
];

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  developer: 'Developer',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-800',
  admin: 'bg-blue-100 text-blue-800',
  developer: 'bg-green-100 text-green-800',
  viewer: 'bg-gray-100 text-gray-800',
};

export default function TeamsPage() {
  const { members, setMembers } = useAppStore();

  useEffect(() => {
    setMembers(MOCK_MEMBERS);
  }, [setMembers]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">团队管理</h1>
        <Button>邀请成员</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>团队成员</CardTitle>
          <CardDescription>共 {members.length} 名成员</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>姓名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_COLORS[m.role]}`}>
                      {ROLE_LABELS[m.role]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">编辑角色</Button>
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
