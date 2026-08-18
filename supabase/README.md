# Base de datos — RAW Design

Postgres administrado por [Supabase](https://supabase.com). Proyecto activo: **`adiyzzqajvcbtovfdird`**.

## Cómo se aplica

**Una sola fuente de verdad: `migrations/`.** Se corren en orden numérico, pegando cada
archivo en Supabase → SQL Editor. Todas son idempotentes (`if not exists`, `create or
replace`, `drop … if exists`), así que volver a correr una que ya se aplicó no rompe nada.

```
migrations/0001_initial_schema.sql    projects + folders
migrations/0002_add_user_id.sql       user_id (dueño de cada fila)
migrations/0003_profiles_and_rls.sql  profiles (nickname) + RLS por operación
migrations/0004_add_techpack.sql      projects.techpack_json (ficha técnica)
migrations/0005_hardening.sql         integridad + privilegio mínimo
```

- **Base nueva y vacía:** correr las cinco en orden. El resultado es el mismo esquema final.
- **Base existente:** correr solo las pendientes.

> Antes había además un `setup.sql` que duplicaba todo el esquema "para base nueva".
> Se eliminó: era una segunda fuente de verdad que se desincronizó (tenía
> `techpack_json` y los `revoke`, pero nunca se corrió, así que la base real no los
> tenía y la ficha técnica no se guardaba). Con las migraciones numeradas eso no
> puede volver a pasar.

Para tener todo junto en un solo pegado:

```bash
cat supabase/migrations/*.sql > /tmp/raw-design-full.sql
```

## Estado aplicado en `adiyzzqajvcbtovfdird`

| Migración | Estado |
|---|---|
| 0001, 0002, 0003 | aplicadas |
| 0004, 0005 | **pendientes** |

Se verifica con la query del final de `0005_hardening.sql`: las tres tablas deben dar
`rls_activo = true`, `perm_authent` 4/4/3 y **`perm_anon = 0`**.

Comprobación desde afuera, con la anon key y sin sesión (debe dar 401/403, no 200):

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://adiyzzqajvcbtovfdird.supabase.co/rest/v1/projects?select=id&limit=1" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

## Modelo

- **`folders`** — carpetas para organizar proyectos. Una por usuario.
- **`projects`** — las prendas. `canvas_json` (lienzo del editor) y `techpack_json`
  (ficha técnica) son documentos pesados que se cargan de forma lazy: la lista de la
  biblioteca no los baja.
- **`profiles`** — el nickname público de cada usuario. `id` **es** el `auth.users.id`:
  un usuario = un perfil, y si se borra la cuenta el perfil cae en cascada.

Las tres tablas están aisladas por usuario con RLS (`auth.uid() = user_id`), salvo la
lectura de `profiles`, que es visible entre usuarios logueados a propósito: el nickname
es el nombre público dentro de la app.

## Contraseñas

No están en estas tablas y no deben estarlo. Las guarda Supabase Auth con bcrypt + salt
en el esquema privado `auth`, al que la anon key no llega. Nunca pasan por nuestro
esquema ni por el frontend. Implementar un manejo propio sería **menos** seguro.

## Configuración que no vive en SQL

Estas van en el dashboard, no en las migraciones:

- **Auth → Providers → Email → Confirm email**: debe estar **activado**. El alta de
  cuenta de la app dice "Revisá tu email para confirmar tu cuenta"; con la confirmación
  desactivada ese mensaje es falso y además se puede abrir una cuenta con el email de
  otra persona.
- **Auth → Providers**: dejar habilitados solo los que la app ofrece (email y Google).
- **Auth → Passwords**: subir el mínimo a 8 caracteres y activar la protección contra
  contraseñas filtradas (HaveIBeenPwned).
