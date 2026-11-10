import type { Metadata } from 'next';
import '@fontsource-variable/manrope';
import './globals.css';
import Shell from '@/components/Shell';

export const metadata: Metadata = { title: 'FundHaus', description: 'FundHaus broker console' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
