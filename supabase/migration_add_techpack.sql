-- Agregar el documento editable de ficha técnica (Tech Pack) a projects.
-- Ejecutar en Supabase → SQL Editor.
-- Nullable + "if not exists": las filas existentes quedan en NULL (sin ficha), sin downtime.
alter table projects add column if not exists techpack_json text;
