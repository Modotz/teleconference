import './globals.css';
import type { Metadata, Viewport } from 'next';
import { APP_NAME } from '@/lib/config';

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} — video meetings in your browser`,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
