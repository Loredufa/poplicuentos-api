import { NextRequest, NextResponse } from 'next/server';
import { admin, type FavoriteRow } from '../../../supabaseAdmin';


const COLS =
  'id,title,story,age_range,skill,tone,minutes,created_at,user_id';

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? '50');

  const { data, error } = await admin
    .from('favorites')
    .select(COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Number.isFinite(limit) ? limit : 50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // data ya es FavoriteRow[] porque el cliente está tipado con Database
  return NextResponse.json({ favorites: data as FavoriteRow[] }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();

  const payload = {
    user_id: userId,
    title: body.title ?? body.meta?.title ?? 'Mi cuento',
    story: body.story,
    age_range: body.age_range,
    skill: body.skill,
    tone: body.tone,
    minutes: Number(body.minutes ?? 4),
  };

  const { data, error } = await admin
    .from('favorites')
    .insert(payload)
    .select(COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ favorite: data as FavoriteRow }, { status: 201 });
}
