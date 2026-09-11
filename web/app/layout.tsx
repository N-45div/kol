import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Kol — Verified payer calls', template: '%s · Kol' },
  description: 'Evidence-backed healthcare claim follow-up powered by CALL-E.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
