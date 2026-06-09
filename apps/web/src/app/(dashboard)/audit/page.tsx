'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MOCK_AUDIT_LOGS: AuditLog[] = [
  { id: 'a1', userId: 'u1', userName: '晶Q', action: 'CREATE_PROJECT', resource: 'codegraph-enterprise', timestamp: '2026-06-01T04:00:00Z', ip: '192.168.1.100' },
  { id: 'a2', userId: 'u2', userName: '全丞', action: 'BUILD_INDEX', resource: 'codegraph-enterprise', timestamp: '2026-06-01T04:05:00Z', ip: '192.168.1.101' },
  { id: 'a3', userId: 'u1', userName: '晶Q', action: 'ADD_MEMBER', resource: 'team-001 (Alice)', timestamp: '2026-06-01T03:00:00Z', ip: '192.168.1.100' },
  { id: 'a4', userId: 'u2', userName: '全丞', action: 'UPDATE_SUBSCRIPTION', resource: 'free → pro', timestamp: '2026-06-01T02:00:00Z', ip: '192.168.1.101' },
  { id: 'a5', userId: 'u1', userName: '晶Q', action: 'DELETE_PROJECT', resource: 'old-project', timestamp: '2026-05-31T23:00:00Z', ip: '192.168.1.100' },
  { id: 'a6', userId: 'system', userName: '系统', action: 'BUILD_INDEX_COMPLETED', resource: 'codegraph-enterprise', timestamp: '2026-06-01T04:10:00Z', ip: '' },
  { id: 'a7', userId: 'u2', userName: '全丞', action: 'QUERY_SYMBOL', resource: 'search:UserService.authenticate()', timestamp: '2026-06-01T05:00:00Z', ip: '192.168.1.101' },
  { id: 'a8', userId: 'u2', userName: '全丞', action: 'EXPORT_AUDIT_LOGS', resource: 'audit-logs.csv', timestamp: '2026-06-01T06:00:00Z', ip: '192.168.1.101' },
];

const ACTION_LABELS: Record<string, string> = {
  CREATE_PROJECT: '创建项目',
  BUILD_INDEX: '构建索引',
  BUILD_INDEX_COMPLETED: '索引构建完成',
  BUILD_INDEX_FAILED: '索引构建失败',
  BUILD_INDEX_CANCELLED: '索引构建已取消',
  ADD_MEMBER: '添加成员',
  REMOVE_MEMBER: '移除成员',
  UPDATE_SUBSCRIPTION: '更新订阅',
  DELETE_PROJECT: '删除项目',
  UPDATE_PROJECT: '更新项目',
  QUERY_CODE: '代码查询',
  QUERY_SYMBOL: '符号查询',
  QUERY_CALLERS: '调用者查询',
  QUERY_CALLEES: '被调用者查询',
  QUERY_IMPACT: '影响分析',
  QUERY_SEARCH: '跨项目搜索',
  EXPORT_AUDIT_LOGS: '导出审计日志',
  WEBHOOK_RECEIVED: '收到 Webhook',
  WEBHOOK_IGNORED: '忽略 Webhook',
  WEBHOOK_REJECTED: '拒绝 Webhook',
  PAYMENT_INITIATED: '发起支付',
  PAYMENT_COMPLETED: '支付完成',
  PLAN_UPGRADE: '套餐升级',
  PLAN_DOWNGRADE: '套餐降级',
  NOTIFICATION_SENT: '通知已发送',
};

const ALL_ACTIONS = Object.keys(ACTION_LABELS);

export default function AuditPage() {
  const { auditLogs, setAuditLogs } = useAppStore();
  const [filterAction, setFilterAction] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAuditLogs(MOCK_AUDIT_LOGS);
  }, [setAuditLogs]);

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filterAction) params.set('action', filterAction);
        params.set('format', format);
        window.open(`/api/organizations/current/audit-logs/export?${params.toString()}`, '_blank');
      } finally {
        setLoading(false);
      }
    },
    [filterAction],
  );

  const filtered = auditLogs.filter((log) => {
    if (filterAction && log.action !== filterAction) return false;
    if (filterSearch) {
      const s = filterSearch.toLowerCase();
      return (
        log.action.toLowerCase().includes(s) ||
        log.resource.toLowerCase().includes(s) ||
        log.userName.toLowerCase().includes(s)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">审计日志</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport('csv')} disabled={loading}>
            导出 CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('json')} disabled={loading}>
            导出 JSON
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Input
          placeholder="搜索操作 / 资源 / 用户..."
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          className="max-w-xs"
        />
        <select
          className="border rounded px-2 py-1 text-sm bg-background"
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
        >
          <option value="">全部操作</option>
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>操作历史</CardTitle>
          <CardDescription>
            所有操作记录 — 只读不可篡改 · {filtered.length} / {auditLogs.length} 条
          </CardDescription>
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
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    暂无匹配的审计日志
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(log.timestamp).toLocaleString('zh-CN')}
                    </TableCell>
                    <TableCell className="font-medium">{log.userName}</TableCell>
                    <TableCell>{ACTION_LABELS[log.action] ?? log.action}</TableCell>
                    <TableCell>{log.resource}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.ip || '—'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
