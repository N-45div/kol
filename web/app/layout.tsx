import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://kol-verified-payer-calls.vercel.app'),
  title: { default: 'Kol — Verified payer calls', template: '%s · Kol' },
  description: 'Evidence-backed healthcare claim follow-up powered by CALL-E.',
  openGraph: {
    title: 'Kol — Verified payer calls',
    description: 'Prove the question, destination, answer fields, and IVR route before a claim record changes.',
    type: 'website',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
