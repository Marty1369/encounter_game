import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Player app uses the anon key and ONLY calls RPCs (no direct table access — RLS denies it).
export const supabase = createClient(url, anon, { auth: { persistSession: false } });

// Public Storage URL for a media file. Filenames may contain spaces/diacritics -> encode.
export const assetUrl = (file: string) =>
  `${url}/storage/v1/object/public/game-assets/${encodeURIComponent(file)}`;
