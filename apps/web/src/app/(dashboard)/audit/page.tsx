'use client';

import { useEffect } from 'react';
import { useAppStore, type AuditLog } from '@/stores/appStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const MOCK_AUDIT_LOGS: AuditLog[] = [
  { id: 'a1', userId: 'u1', userName: '晶Q', action: 'CREATE_PROJECT', resource: 'codegraph-enterprise', timestamp: '2026-06-01T04:00:00Z', ip: '192.168.1.100' },
  { id: 'a2', userId: 'u2', userName: '全丞', action: 'BUILD_INDEX', resource: 'codegraph-enterprise', timestamp: '2026-06-01T04:05:00Z', ip: '192.168.1.101' },
  { id: 'a3', userId: 'u1', userName: '晶Q', action: 'ADD_MEMBER', resource: 'team-001 (Alice)', timestamp: '2026-06-01T03:00:00Z', ip: '192.168.1.100' },
  { id: 'a4', userId: 'u2', userName: '全丞', action: 'UPDATE_SUBSCRIPTION', resource: 'free → pro', timestamp: '2026-06-01T02:00:00Z', ip: '192.168.1.101' },
  { id: 'a5', userId: 'u1', userName: '晶Q', action: 'DELETE_PROJECT', resource: 'old-project', timestamp: '2026-05-31T23:00:00Z', ip: '192.168.1.100' },
];

const ACTION_LABELS: Record<string, string> = {
  CREATE_PROJECT: '创建项目',
  BUILD_INDEX: '构建索引',
  ADD_MEMBER: '添加成员',
  REMOVE_MEMBER: '移除成员',
  UPDATE_SUBSCRIPTION: '更新订阅',
  DELETE_PROJECT: '删除项目',
  UPDATE_PROJECT: '更新项目',
};

export default function AuditPage() {
  const { auditLogs, setAuditLogs } = useAppStore();

  useEffect(() => {
    setAuditLogs(MOCK_AUDIT_LOGS);
  }, [setAuditLogs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">审计日志</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>操作历史</CardTitle>
          <CardDescription>所有操作记录 — 只读不可篡改</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>用户</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>资源</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(log.timestamp).toLocaleString('zh-CN')}
                  </TableCell>
                  <TableCell className="font-medium">{log.userName}</TableCell>
                  <TableCell>{ACTION_LABELS[log.action] ?? log.action}</TableCell>
                  <TableCell>{log.resource}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{log.ip ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
