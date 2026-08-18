-- ============================================================================
-- 0006 — mockup_id: entra `chomba`, se conserva `hoodie` por historial
-- ============================================================================
-- Ejecutar en Supabase → SQL Editor, DESPUÉS de 0005.
-- Idempotente: se puede correr más de una vez sin romper nada.
--
-- Por qué: la 0005 ató mockup_id a ('tshirt','hoodie','pants'), que era el tipo
-- del front en ese momento. En el mismo día, el commit afdd426 cambió el tipo a
-- ('tshirt','chomba','pants'): entró la chomba y se fue el buzo.
--
-- Sin este ajuste el CHECK rompe DOS cosas:
--   1. crear/guardar una chomba → falla, el valor no está permitido;
--   2. guardar los proyectos `hoodie` que YA existen → también falla. Un CHECK
--      NOT VALID no revalida las filas viejas, pero sí se aplica cuando esa fila
--      se ACTUALIZA. O sea que el buzo guardado quedaría de solo lectura.
--
-- De ahí que la lista tenga los tres valores actuales MÁS `hoodie`: la base
-- describe lo que puede existir (incluido el pasado), no solo lo que se dibuja
-- hoy. El día que no quede ningún buzo, se saca en otra migración.
-- ============================================================================

alter table public.projects drop constraint if exists projects_mockup_id_valido;

do $$ begin
  alter table public.projects add constraint projects_mockup_id_valido
    check (mockup_id in ('tshirt', 'chomba', 'pants', 'hoodie')) not valid;
exception when duplicate_object then null; end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ────────────────────────────────────────────────────────────────────────────
-- `definicion` tiene que listar los cuatro valores, y `en_uso` muestra qué hay
-- realmente guardado (si aparece algo que no está en la lista, hay que sumarlo).
select
  (select pg_get_constraintdef(oid) from pg_constraint
    where conname = 'projects_mockup_id_valido')                    as definicion,
  (select string_agg(distinct mockup_id, ', ') from public.projects) as en_uso;
