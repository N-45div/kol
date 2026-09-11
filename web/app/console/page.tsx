import type { Metadata } from 'next';
import KolApp from '../kol-app';

export const metadata: Metadata = { title: 'Evidence console' };

export default function ConsolePage() {
  return <KolApp />;
}
