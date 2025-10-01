// supabaseAdmin.ts (en la raíz del repo)
import { createClient } from '@supabase/supabase-js';

export type FavoriteRow = {
  id: string;
  user_id: string;
  title: string;
  story: string;
  age_range: string;
  skill: string;
  tone: string;
  minutes: number;
  created_at: string;
};

// Tipado mínimo de la DB (suficiente para favorites)
export type Database = {
  public: {
    Tables: {
      favorites: {
        Row: FavoriteRow;
        Insert: Omit<FavoriteRow, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string | null;
        };
        Update: Partial<FavoriteRow>;
      };
    };
  };
};

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey) {
  throw new Error('SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY no configurados');
}

export const admin = createClient<Database>(url, serviceKey);
