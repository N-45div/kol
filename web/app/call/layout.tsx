import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Test call' };

export default function CallLayout({ children }: { children: ReactNode }) {
  return children;
}
