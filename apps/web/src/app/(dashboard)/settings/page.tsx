'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/stores/appStore';

export default function SettingsPage() {
  const { user } = useAppStore();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">设置</h1>

      <Card>
        <CardHeader>
          <CardTitle>账户信息</CardTitle>
          <CardDescription>管理你的个人资料</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">姓名</label>
            <Input defaultValue={user?.name ?? ''} />
          </div>
          <div>
            <label className="text-sm font-medium">邮箱</label>
            <Input defaultValue={user?.email ?? ''} disabled />
          </div>
          <Button>保存更改</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>管理 MCP Server 认证密钥</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono">
              sk-xxxx-xxxx-xxxx-xxxx
            </code>
            <Button variant="outline" size="sm">复制</Button>
            <Button variant="destructive" size="sm">撤销</Button>
          </div>
          <Button>创建新 Key</Button>
        </CardContent>
      </Card>
    </div>
  );
}
