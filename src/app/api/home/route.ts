import { NextResponse } from 'next/server';

import { getHome } from '@/lib/homeCache';

export const runtime = 'edge';

export async function GET() {
  const data = await getHome(process.env as any);
  return NextResponse.json(data, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}
