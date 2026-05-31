import { Card } from '@/components/ui/card';

export function StatusBadge({ status }: { status: 'completed' | 'running' | 'queued' | 'failed' | 'pending_index' }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 animate-pulse',
    queued: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    pending_index: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  };
  const labels: Record<string, string> = {
    completed: '已完成',
    running: '构建中',
    queued: '排队中',
    failed: '失败',
    pending_index: '待索引',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
