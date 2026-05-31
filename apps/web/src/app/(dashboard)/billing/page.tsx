'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
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

const PLANS = [
  { name: 'free', price: '¥0/月', projects: 3, maxSymbols: 10000, features: ['基础索引', '社区支持'] },
  { name: 'pro', price: '¥99/月', projects: 20, maxSymbols: 500000, features: ['全量索引', '优先支持', '审计日志', '团队协作'] },
  { name: 'enterprise', price: '联系销售', projects: -1, maxSymbols: -1, features: ['无限索引', '专属支持', 'SLA', '私有部署'] },
];

const MOCK_INVOICES = [
  { id: 'INV-001', date: '2026-06-01', plan: 'pro', amount: '¥99.00', status: 'paid' },
  { id: 'INV-002', date: '2026-05-01', plan: 'pro', amount: '¥99.00', status: 'paid' },
];

export default function BillingPage() {
  const { subscription, setSubscription } = useAppStore();
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'pro' | 'enterprise'>(subscription.plan);

  const handleUpgrade = (plan: 'free' | 'pro' | 'enterprise') => {
    setSubscription({ ...subscription, plan, status: 'active' });
    setSelectedPlan(plan);
    alert(`已切换到 ${plan} 套餐（模拟支付流程）`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">计费与订阅</h1>
      </div>

      {/* Current plan */}
      <Card>
        <CardHeader>
          <CardTitle>当前套餐</CardTitle>
          <CardDescription>
            状态: {subscription.status === 'active' ? '已激活' : '已过期'} | 到期: {subscription.expiresAt ?? '无期限'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-2xl font-bold capitalize">
          {subscription.plan} — {subscription.projectLimit === -1 ? '无限' : subscription.projectLimit} 个项目
        </CardContent>
      </Card>

      {/* Plan selection */}
      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <Card key={plan.name} className={selectedPlan === plan.name ? 'border-primary ring-2 ring-primary' : ''}>
            <CardHeader>
              <CardTitle className="capitalize">{plan.name}</CardTitle>
              <CardDescription>{plan.price}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">
                项目数: {plan.projects === -1 ? '无限' : plan.projects}
              </p>
              <p className="text-sm">
                最大符号: {plan.maxSymbols === -1 ? '无限' : plan.maxSymbols.toLocaleString()}
              </p>
              <ul className="text-sm space-y-1">
                {plan.features.map((f) => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
              {selectedPlan !== plan.name && (
                <Button className="w-full mt-4" onClick={() => handleUpgrade(plan.name as 'free' | 'pro' | 'enterprise')}>
                  {plan.name === 'enterprise' ? '联系销售' : '升级'}
                </Button>
              )}
              {selectedPlan === plan.name && (
                <Button variant="outline" className="w-full mt-4" disabled>
                  当前套餐
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Invoice history */}
      <Card>
        <CardHeader>
          <CardTitle>账单历史</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>账单号</TableHead>
                <TableHead>日期</TableHead>
                <TableHead>套餐</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MOCK_INVOICES.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{inv.id}</TableCell>
                  <TableCell>{inv.date}</TableCell>
                  <TableCell className="capitalize">{inv.plan}</TableCell>
                  <TableCell>{inv.amount}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                      {inv.status === 'paid' ? '已支付' : inv.status}
                    </span>
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
