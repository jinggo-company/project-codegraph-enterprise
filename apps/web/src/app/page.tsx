'use client';

import { redirect } from 'next/navigation';
import { useAppStore } from '@/stores/appStore';

export default function HomePage() {
  const { isAuthenticated } = useAppStore();
  if (!isAuthenticated) {
    redirect('/login');
  }
  redirect('/dashboard');
}
