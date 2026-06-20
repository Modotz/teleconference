'use client';

import Link from 'next/link';
import { Video } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-3">
        <Video className="w-10 h-10 text-blue-500" />
        <h1 className="text-3xl sm:text-4xl font-bold">Teleconference</h1>
      </div>
      <p className="text-slate-400 text-sm sm:text-base text-center">
        Mediasoup + Next.js + PostgreSQL
      </p>
      <div className="flex gap-3 w-full max-w-xs">
        <Link
          href="/login"
          className="flex-1 text-center px-6 py-2.5 bg-blue-600 hover:bg-blue-700 rounded font-medium"
        >
          Login
        </Link>
        <Link
          href="/register"
          className="flex-1 text-center px-6 py-2.5 bg-slate-700 hover:bg-slate-600 rounded font-medium"
        >
          Register
        </Link>
      </div>
    </main>
  );
}
