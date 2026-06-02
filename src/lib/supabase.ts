import { createClient } from '@supabase/supabase-js'

// La anon key es pública por diseño — la seguridad viene del RLS en la base de datos.
// El .env sobreescribe estos valores si existe (útil para tener proyectos separados de dev/prod).
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://adiyzzqajvcbtovfdird.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkaXl6enFhanZjYnRvdmZkaXJkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODU2NjQsImV4cCI6MjA5NTM2MTY2NH0.EdKYcorxLJDQcN691pr2X8fAPw_Ze5Bry_UUu2bb9iY'

export const supabase = createClient(url, key)
