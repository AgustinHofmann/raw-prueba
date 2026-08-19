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

/**
 * Si hay nube o no.
 *
 * Antes, sin credenciales, este archivo cortaba con un throw y la app quedaba en
 * NEGRO: ni siquiera se dibujaba la pantalla de login. Eso convertía un archivo
 * de configuración faltante en "el programa no arranca".
 *
 * Ahora no corta. El programa funciona igual sin nube —los proyectos viven en el
 * navegador— y lo único que se pierde es guardar en la cuenta y verlos desde
 * otra computadora. Quien decide qué hacer con esto es lib/repo.ts.
 */
export const cloudEnabled = Boolean(url && key)

if (!cloudEnabled) {
  console.warn(
    '[RAW Design] Sin credenciales de Supabase: modo sin conexión.\n' +
    'Los proyectos se guardan solo en este navegador. Para usar tu cuenta, creá\n' +
    'un .env en la raíz con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (Supabase\n' +
    '→ Project Settings → API) y reiniciá el servidor.',
  )
}

// Con credenciales o sin ellas siempre hay un cliente, para que el resto del
// código no tenga que preguntarse si existe. Sin credenciales apunta a un
// dominio inválido: nunca se lo llama, porque cloudEnabled es false.
export const supabase = createClient(
  url ?? 'https://sin-conexion.invalid',
  key ?? 'sin-conexion',
)
