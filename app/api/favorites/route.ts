// app/api/favorites/route.ts
export const runtime = 'nodejs';

import { supabaseAdmin, type Database } from '@/lib/supabaseAdmin';
import { NextRequest, NextResponse } from 'next/server';

type UUID = string;
type FavoriteRow = Database['public']['Tables']['favorites']['Row'];
type FavoriteInsert = Database['public']['Tables']['favorites']['Insert'];

async function getAuthUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) return { userId: null as UUID | null, error: 'Falta Authorization Bearer token' };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { userId: null as UUID | null, error: error?.message || 'Token inválido' };

  return { userId: data.user.id as UUID, error: null as string | null };
}

/** GET /api/favorites */
export async function GET(req: NextRequest) {
  const { userId, error } = await getAuthUser(req);
  if (!userId) return NextResponse.json({ error }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get('limit') ?? '50');
  const finalLimit = Number.isFinite(limit) ? limit : 50;

  const { data, error: qErr } = await supabaseAdmin
    .from('favorites') // <- sin genéricos
    .select('id,title,story,age_range,skill,tone,minutes,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(finalLimit);

  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  return NextResponse.json({ items: (data || []) as FavoriteRow[] }, { status: 200 });
}

/** POST /api/favorites */
export async function POST(req: NextRequest) {
  const { userId, error } = await getAuthUser(req);
  if (!userId) return NextResponse.json({ error }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { title, story, age_range, skill, tone, minutes } = (body ?? {}) as Partial<FavoriteInsert>;
  if (!title || !story) {
    return NextResponse.json({ error: 'Faltan title y story' }, { status: 400 });
  }

  const payload: FavoriteInsert = {
    user_id: userId,
    title,
    story,
    age_range: (age_range as FavoriteInsert['age_range']) || '',
    skill: skill || '',
    tone: tone || '',
    minutes: typeof minutes === 'number' ? minutes : null,
  };

  const { data, error: insErr } = await supabaseAdmin
    .from('favorites') // <- sin genéricos
    .insert(payload)
    .select('id,title,story,age_range,skill,tone,minutes,created_at')
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ item: data as FavoriteRow }, { status: 201 });
}

/** DELETE /api/favorites?id=<uuid> */
export async function DELETE(req: NextRequest) {
  const { userId, error } = await getAuthUser(req);
  if (!userId) return NextResponse.json({ error }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const { error: delErr } = await supabaseAdmin
    .from('favorites') // <- sin genéricos
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
