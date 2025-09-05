// lib/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js';

/**
 * Tipos de tu base. Amplía aquí las demás tablas si quieres.
 */
export type Database = {
  public: {
    Tables: {
      favorites: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          story: string;
          age_range: '2-5' | '6-10' | string;
          skill: string;
          tone: string;
          minutes: number | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          title: string;
          story: string;
          age_range: '2-5' | '6-10' | string;
          skill: string;
          tone: string;
          minutes?: number | null;
        };
        Update: Partial<{
          user_id: string;
          title: string;
          story: string;
          age_range: '2-5' | '6-10' | string;
          skill: string;
          tone: string;
          minutes: number | null;
        }>;
        Relationships: [
          {
            foreignKeyName: 'favorites_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  '';

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  '';

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL no está definido en las env vars de Vercel.');
}
if (!serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY no está definido en las env vars de Vercel.');
}

/** Cliente ADMIN (server-side). */
export const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
