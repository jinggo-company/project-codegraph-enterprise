import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Dashboard — CodeGraph Enterprise',
  description: '团队级代码知识图谱管理平台',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-64 border-r bg-gray-50 hidden md:block">
            <div className="flex h-16 items-center border-b px-6">
              <span className="text-lg font-bold">CodeGraph</span>
            </div>
            <nav className="space-y-1 p-4">
              <SidebarLink href="/dashboard" label="概览" />
              <SidebarLink href="/dashboard/projects" label="项目管理" />
              <SidebarLink href="/dashboard/teams" label="团队管理" />
              <SidebarLink href="/dashboard/indexes" label="索引管理" />
              <SidebarLink href="/dashboard/audit" label="审计日志" />
              <SidebarLink href="/dashboard/billing" label="计费/订阅" />
              <SidebarLink href="/dashboard/settings" label="设置" />
            </nav>
          </aside>
          {/* Mobile header */}
          <div className="flex-1">
            <header className="flex h-16 items-center border-b px-4 md:hidden">
              <span className="text-lg font-bold">CodeGraph</span>
              <nav className="ml-auto flex gap-2">
                <MobileNavLink href="/dashboard" label="概览" />
                <MobileNavLink href="/dashboard/projects" label="项目" />
                <MobileNavLink href="/dashboard/teams" label="团队" />
              </nav>
            </header>
            <main className="p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}

function SidebarLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors">
      {label}
    </a>
  );
}

function MobileNavLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900">
      {label}
    </a>
  );
}
