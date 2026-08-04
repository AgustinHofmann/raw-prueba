import { createClient } from '@supabase/supabase-js'

// Credenciales del proyecto Supabase.
//
// La anon key es pública por diseño (viaja al navegador igual): la seguridad
// real la da el RLS de la base, no esconder esta clave. Ver supabase/setup.sql.
//
// Se leen del .env para que cambiar de proyecto (o tener uno de dev y otro de
// prod) sea editar un archivo y no tocar el código.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Fallar fuerte y claro: sin esto, la app arranca y recién al intentar entrar
// tira un "Failed to fetch" que no dice nada. Mejor un mensaje que explique qué
// falta y dónde conseguirlo.
if (!url || !key) {
  throw new Error(
    '[RAW Design] Faltan las credenciales de Supabase.\n' +
    'Creá un archivo .env en la raíz del proyecto con:\n' +
    '  VITE_SUPABASE_URL=https://<tu-proyecto>.supabase.co\n' +
    '  VITE_SUPABASE_ANON_KEY=<tu-anon-key>\n' +
    'Las dos las sacás de Supabase → Project Settings → API. ' +
    'Después reiniciá el servidor de desarrollo (Vite lee el .env al arrancar).'
  )
}

export const supabase = createClient(url, key)
