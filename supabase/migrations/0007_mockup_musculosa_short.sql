-- ============================================================================
-- 0007 — mockup_id: entran `musculosa` y `short`
-- ============================================================================
-- Ejecutar en Supabase → SQL Editor, DESPUÉS de 0006.
-- Idempotente: se puede correr más de una vez sin romper nada.
--
-- Por qué: el commit 565d9c3 sumó la musculosa y el short a la app, pero el
-- CHECK de la 0006 seguía aceptando solo ('tshirt','chomba','pants','hoodie').
-- La base rechazaba cada guardado de esas dos prendas y el front lo tomaba
-- como "sin conexión, se reintenta después": el proyecto quedaba para siempre
-- solo en el navegador donde se hizo, sin llegar nunca a la cuenta. Abrirlo
-- desde otra computadora era imposible y nadie se enteraba.
--
-- Se conserva `hoodie` por lo mismo que en la 0006: un CHECK NOT VALID se
-- aplica cuando una fila vieja se actualiza, y sin el valor el buzo guardado
-- quedaría de solo lectura.
-- ============================================================================

alter table public.projects drop constraint if exists projects_mockup_id_valido;

do $$ begin
  alter table public.projects add constraint projects_mockup_id_valido
    check (mockup_id in ('tshirt', 'chomba', 'pants', 'musculosa', 'short', 'hoodie')) not valid;
exception when duplicate_object then null; end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ────────────────────────────────────────────────────────────────────────────
-- `definicion` tiene que listar los seis valores, y `en_uso` muestra qué hay
-- realmente guardado (si aparece algo que no está en la lista, hay que sumarlo).
select
  (select pg_get_constraintdef(oid) from pg_constraint
    where conname = 'projects_mockup_id_valido')                    as definicion,
  (select string_agg(distinct mockup_id, ', ') from public.projects) as en_uso;
