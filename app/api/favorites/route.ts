import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, storyId, timestamp } = {
      userId: body.userId || body.user_id,
      storyId: body.storyId || body.story_id,
      timestamp: body.timestamp || body.created_at,
    };

    // Validar los datos requeridos
    if (!userId || !storyId) {
      return NextResponse.json({ error: 'userId and storyId are required' }, { status: 400 });
    }

    // Consultar el cuento completo desde la tabla stories
    const { data: storyData, error: storyError } = await supabase
      .from('stories')
      .select('*')
      .eq('id', storyId)
      .single();

    if (storyError && storyError.code !== 'PGRST116') {
      // Error inesperado al verificar la historia
      throw storyError;
    }

    // Insertar la historia en la tabla stories solo si no existe
    const { data: existingStory, error: storyCheckError } = await supabase
      .from('stories')
      .select('*')
      .eq('id', storyId)
      .single();

    if (storyCheckError && storyCheckError.code !== 'PGRST116') {
      // Error inesperado al verificar la historia
      throw storyCheckError;
    }

    if (!existingStory) {
      const { error: storyInsertError } = await supabase
        .from('stories')
        .insert({
          id: storyId,
          user_id: userId,
          title: body.title,
          body: body.body,
          created_at: timestamp || new Date().toISOString(),
        });

      if (storyInsertError) {
        throw storyInsertError;
      }
    }

    // Insertar en la tabla favorites
    const { data, error } = await supabase
      .from('favorites')
      .insert({
        user_id: userId,
        story_id: storyId,
        created_at: timestamp || new Date().toISOString(),
      });

    if (error) {
      throw error;
    }

    return NextResponse.json({ message: 'Favorite added successfully', data }, { status: 201 });
  } catch (error) {
    console.error('Error adding favorite:', error);
    return NextResponse.json({ error: 'Failed to add favorite' }, { status: 500 });
  }
}
