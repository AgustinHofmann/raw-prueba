# RAW — Tech Pack Mode: Design & Build Document

> **Estado de implementación (v2 — rediseño multipágina apaisado):**
> Tras el feedback ("ficha horizontal multipágina para fábrica, UI menos cargada"), se rehízo el modelo de **secciones apiladas (1 hoja vertical)** a **páginas A4 apaisadas**, una por propósito.
> - **Modelo:** `TechPackDoc.pages: TechPackPage[]` (`design | specs | measures | materials | colorways | notes`), `meta` reducido a lo relevante para fábrica (para quién, tela principal, talle base, rango — sin drop/temporada), imágenes por rol (`front/back/specs/measures`) para separar anotaciones por página.
> - **UI:** íconos Lucide (`lucide-react`), riel de páginas reordenable con `@dnd-kit`, una **única** barra de anotaciones flotante compacta (en vez de 2 filas de botones), zoom, barra superior limpia.
> - **Páginas por defecto:** Diseño (frente/espalda) · Especificaciones (vista + construcción + materiales principales) · Tabla de medidas (POM + flat acotado) · Materiales (BOM). Agregables: Colorways, Notas.
> - **Anotaciones** (`AnnotationLayer`): flechas, líneas guía, callouts numerados, burbujas; ancladas en coords normalizadas (0..1), punta y caja arrastrables, categorías, sólido/punteado, eliminar.
> - **Export PDF:** `window.print()` con `@page A4 landscape` y salto por página (`break-after: page`); cada página imprime en su propia hoja; el zoom no afecta la impresión.
>
> Typecheck sin errores nuevos (quedan los 26 pre-existentes de `EditorScreen`/`NewProjectModal`); Vite transforma todo (lucide + dnd-kit incluidos). **Paso manual pendiente:** correr `supabase/migrations/0004_add_techpack.sql` en Supabase → SQL Editor para que la ficha persista.
>
> _Nota: el diseño original abajo describe la v1 (secciones verticales); se conserva como referencia. La v2 reemplaza §1–§2 por el modelo de páginas descrito arriba._



**Scope:** A full, editable, professional Tech Pack workspace that opens as an internal application tab (not a browser tab), runs in parallel with the garment editor, and lets a designer document a remera / hoodie / pantalón for factories — editable sections, BOM, measurements, image place/replace/scale/move, reorderable blocks, and garment-anchored visual annotations (arrows, leader lines, numbered callouts, detail bubbles).

**Verified codebase baseline:** `Route` is `'onboard' | 'home' | 'library' | 'export' | 'editor'` (`src/App.tsx:20`); tabs are `Project[]` (`src/App.tsx:31`); `mockupId: 'tshirt' | 'hoodie' | 'pants'` (`src/types/project.ts:3`); `TechPackMeasures` already lives in `src/components/TechPackSheet.tsx:3-7`; the sheet's `bom`/`notes` are ephemeral `useState` (`TechPackSheet.tsx:28-29`); persistence is hand-mapped camelCase↔snake_case in `src/lib/db.ts`, with `canvas_json` lazy-loaded.

---

## 1. Tech Pack content spec

The editor ships a **garment-typed default template**. On open, RAW picks the template variant from `project.mockupId` (`tshirt` → Remera, `hoodie` → Buzo, `pants` → Pantalón) and auto-fills everything it already knows. Sections are reorderable blocks (§2); every field is editable; "Auto" fields are pre-populated from the active `Project` and stay live-synced when the project is renamed/recolored.

Legend: **[A]** = auto-filled from Project · **[B]** = blank/manual · **[A→B]** = seeded from Project, freely editable.

### 1.1 Cover / Resumen de estilo (`cover`)
Image-forward header: garment snapshot thumbnail + metadata table.

| Field | Source |
|---|---|
| Style No. (`RAW-{id6}`) | **[A]** (already computed `TechPackSheet.tsx:31`) |
| Nombre de estilo | **[A]** `project.name` |
| Tipo de prenda (Remera/Buzo/Pantalón) | **[A]** from `mockupId` |
| Temporada / Drop / Colección | **[B]** |
| Marca / logo | **[A→B]** ("RAW" default) |
| Género / fit (slim/regular/oversize) | **[B]** |
| Versión / revisión + fecha actualización | **[A]** date seeded from `project.createdAt`/`updatedAt`, version `[B]` |
| Diseñador / contacto técnico | **[A]** `designer` prop |
| Fábrica / proveedor | **[B]** |
| Talle base + rango de talles | **[A→B]** default base `M`, range `S–XL` |
| Estado (desarrollo/muestra/producción) | **[B]** dropdown |
| Snapshot frente | **[A]** cropped garment PNG from `openTechPack` (`EditorScreen.tsx:3561`) |

### 1.2 Dibujos técnicos / Flats (`flats`)
Front/back/side/interior placeholders + detail-zoom slots.

| Field | Source |
|---|---|
| Flat frente | **[A]** garment snapshot |
| Flat espalda / lateral / interior | **[A→B]** empty image slots, drag-to-fill (replace pattern) |
| Vistas de detalle (cuello, puño, bolsillo, ruedo) | **[B]** image slots |
| Callouts de construcción sobre el flat | **[B]** annotation layer (§2.6) |

### 1.3 Detalles de construcción (`construction`)
Enlarged flat + numbered-callout list (the keyed-legend pattern from research).

| Column | Source |
|---|---|
| # callout | **[B]** auto-numbered |
| Zona / placement | **[B]** |
| Tipo de puntada + densidad (SPI) | **[B]** with stitch-helper picker (`1/4" 2 NDL CVR ST` / ISO #406) |
| Tipo de costura + margen (S/A) | **[B]** |
| Hilo (color/Pantone) | **[A→B]** seeds from `project.colors` |
| Refuerzos (bartack/remache) | **[B]** |
| Notas de acabado (overlock/ribb) | **[A→B]** Remera/Buzo default "cuello ribb 1x1; costuras overlock" |

### 1.4 Materiales / BOM (`bom`)
Spreadsheet-style table, grouped by category, with per-row swatch. Replaces the free-text `bom` textarea (`TechPackSheet.tsx:29`) with structured rows (legacy text migrates into a "Notas" row).

Columns: **Item #** [B] · **Categoría** [B] (Tela/Trim/Hilo/Etiqueta/Packaging) · **Descripción** [B] · **Placement** [B] · **Composición** [B] · **Color/Pantone (DTM)** [A→B from `project.colors` as swatches] · **Proveedor/SKU** [B] · **Ancho** [B] · **Consumo** [B] · **UOM** [B, locked dropdown: u/cm/m] · **Costo unit./total** [B] · **Notas** [B].

Default seed rows (per garment type): Remera → `Tela principal — jersey algodón 180 GSM`, `Hilo — poliéster tono a tono`, `Etiqueta de marca — tejida`, `Etiqueta de cuidado`; Buzo adds `Rib puño/cintura`, `Cordón`, `Frisa`; Pantalón adds `Elástico/cintura`, `Cierre #4`, `Botón/remache`.

### 1.5 Medidas / POM + Spec (`measures`)
The current 7-row measures table (`MEAS_ROWS`, `TechPackSheet.tsx:9-17`) becomes the POM library, extended with HTM, tolerance and graded columns.

| Column | Source |
|---|---|
| Código POM (A,B,C…) | **[A]** (already coded A–G) |
| Punto de medida | **[A]** existing labels (Largo total, Ancho pecho…) |
| Cómo medir (HTM) | **[A→B]** default method text per POM |
| Tipo (Full/½) | **[A→B]** chest/waist default ½ |
| Talle base (M) | **[A]** from parametric `measures` when `isTee`; else **[B]** |
| Tolerancia ± | **[A→B]** defaults: cuerpo ±1 cm, detalles ±0.5 cm |
| Talles graduados S/M/L/XL | **[A→B]** generated from base + grade rule (default 2.5 cm body, 1.3 cm sleeve) |

Garment variants extend the POM set: **Remera** = the 7 base POMs; **Buzo** = base + capucha alto/ancho/abertura, bolsillo canguro, rib puño/cintura, largo cierre; **Pantalón** = cintura, cadera/asiento, tiro delantero/trasero, muslo, rodilla, boca de pierna, entrepierna, costado. Right side renders the garment image with leader-line POM callouts keyed to the code column.

> Note: `measures` is only auto-populated when the editor's parametric tee handles are active (`isTee`, `EditorScreen.tsx:885`). For hoodie/pants it arrives `null` and the base column is blank.

### 1.6 Colorways (`colorways`)
Grid of colored flats + swatch legend. **[A]** one colorway auto-built per entry in `project.colors`; **[A→B]** color name + Pantone/TPX per component; **[B]** método (estampa/teñido), color-blocking placement, checkpoints (lab dip).

### 1.7 Artwork / Gráfica (`artwork`)
Flat with artwork in position + spec table. Fields: archivo + versión [B], dimensiones al escala (w×h) [B], placement (offset desde HPS/CF) [B], técnica (serigrafía/DTG/sublimación/bordado/transfer) [B], colores/Pantone + # pantallas [B]; bordado adds tipo de puntada/densidad/hilo [B].

### 1.8 Etiquetas & branding (`labels`)
Label artwork + placement diagram. Etiqueta marca (placement CB cuello) [B], cuidado (contenido fibra + símbolos + origen) [A→B seeds composition from BOM], talle [B], hangtag + método [B].

### 1.9 Packaging & terminación (`packaging`)
Método de plegado + dims [B], polybag (tipo/gauge) [B], hangtag attach [B], código de barras placement [B], unidades por caja / pack ratio [B].

### 1.10 Notas / Observaciones (`notes`)
Free rich-text block. **[A→B]** seeded from current default notes string (`TechPackSheet.tsx:28`).

### 1.11 Historial de revisiones (`revisions`) — optional, default off
Chronological log: versión [B], fecha [A on add], autor [A=`designer`], motivo [B], estado [B].

**Default visible-section order for a new tech pack:** cover → flats → construction → bom → measures → colorways → notes. (artwork, labels, packaging, revisions available from an "Agregar sección" menu.)

---

## 2. UX & interaction design

### 2.1 Entering the mode
`File ▸ Ficha técnica` already exists end-to-end: `ChromeBar.tsx:256` (`onTechPack`) → `App.tsx:215` → `editorActionsRef.current.techpack()` → `EditorScreen.tsx` `openTechPack` (`:3561`). Today it opens a fixed modal; we re-target it to **open a parallel internal tab** for the active project. The menu item stays editor-gated (`isEditor`, `ChromeBar.tsx:36`). Re-invoking it when a Tech Pack tab is already open re-focuses it and refreshes the garment snapshot.

### 2.2 Tab model & navigation (ChromeBar)
A project can now own **two tabs**: its editor tab and its tech-pack tab, rendered side by side in `ChromeBar`. The tech-pack tab is visually distinct: a 📄 glyph, a muted `TP` suffix, and a differently-tinted active underline so the two tabs of one project read as distinct. Clicking either switches the workspace instantly. Closing the editor tab leaves the tech-pack tab live and vice-versa; deleting the project purges both. A persistent header button **← Volver al editor** mirrors clicking the editor tab.

### 2.3 Screen layout (`TechPackScreen`)
Three-zone layout filling the content area (absolute, `inset:0`, scrollable — **not** `position:fixed`):

- **Left rail — Secciones/Outline:** vertical list of section blocks; drag to reorder; toggle visibility; "＋ Agregar sección" menu; click scrolls to the section.
- **Center — A4 document canvas:** the live, paginated tech-pack sheet (reuses `#techpack-print` body, §5), zoomable, multi-page A4. This is where inline editing happens.
- **Right — Inspector:** context panel for the current selection — BOM row fields / annotation props / image replace-scale-fit. When a callout is selected, also the **callout list ↔ canvas** two-way panel (§2.6).
- **Top toolbar (`no-print`):** Volver al editor · Agregar sección · Insertar imagen · Annotation tools (Flecha / Línea guía / Callout numerado / Burbuja de detalle) · Zoom · 🖨 Exportar PDF (`window.print()`) · Cerrar pestaña.

### 2.4 Editing text inline
Section text and table cells are native DOM editables (`textarea`/`contentEditable`) — the existing pattern (`TechPackSheet.tsx:135-142`). Prints as crisp selectable vector text. No Fabric IText on the page.

### 2.5 Blocks: add, reorder, images
- **Add/reorder blocks:** DOM drag-reorder of the section array in the left rail (interaction modeled on `reorderLayerTo`/`moveLayer`, `EditorScreen.tsx:3880-3906`, but against a section array). Each reorder pushes a `reorderBlock` undo entry.
- **Insert / replace / scale / move images:** image slots accept drag-drop, paste, or file pick. **Replace-in-place** preserves transform — the model used by `removeBackground` (`EditorScreen.tsx:2876-2910`). Scale via corner handles; move within multi-image sections by drag. Garment snapshot supplied by `openTechPack` (`:3561`).

### 2.6 Annotations (the headline interaction)
Annotations live in an **absolutely-positioned SVG overlay scoped to each garment image**, with each annotation's tip stored in **normalized image coordinates (0–1)** so it tracks the zone and survives image replacement. Mirrors RAW's garment-space anchor pattern (`TEE_HANDLES` projection, `EditorScreen.tsx:890-929`, `1068-1082`).

Anchored-callout model:
- **Create:** pick a tool, click the garment point (anchor/terminus), drag out the leader, a text field appears — type in place.
- **Note + leader move together:** dragging the text box moves it while the leader stretches to keep the pinned anchor connected; dragging the anchor re-pins the tip. Whole callout moves as a unit too.
- **Numbered callouts ↔ list:** numbered markers on the flat mirror the right-rail list; editing list text edits the marker; drag-reorder auto-renumbers.
- **Leader styles:** solid = seam, dashed = topstitch; straight or curved (45° snap reused from `Line`, `:2549-2574`); leader width 0 = text-only floating note.
- **Color categories:** construction / material / measurement tint, CAPS default.
- **Detail bubbles:** a marquee/circle on the flat spawns a magnified detail box linked to the source zone.
- All vector → prints sharp. Every create/move/edit/delete pushes an `annotation` undo entry.

POM callouts (§1.5) are a specialized annotation bound to a POM row code — same overlay machinery, keyed label.

---

## 3. Architecture & data model

### 3.1 DOM blocks + SVG annotation overlay (NOT a second Fabric canvas)
**Decision: hybrid — DOM document for the page, SVG overlay for annotations. One Fabric canvas only (the existing designer).** Reasons: PDF via `window.print()` needs crisp vector text + real pagination (Fabric rasterizes); reorderable sections + BOM/POM tables are document-flow problems; editable text/tables are already native DOM; the garment is already a flat PNG; two live Fabric canvases double event wiring/history/HMR patching for little gain.

Annotations reuse the **concepts** (normalized-coord anchoring, overlay projection, leader-line + 45° snap) as SVG `<line>`/`<path>`+marker, circles, and positioned divs.

### 3.2 Tab-model refactor (discriminated union)
Replace `openTabs: Project[]` with a discriminated `Tab` union; reuse `route` as the second axis of tab identity.

```ts
export type Tab =
  | { kind: 'editor';   project: Project }
  | { kind: 'techpack'; project: Project; snapshot: string; measures: TechPackMeasures | null }
export const tabKey = (t: Tab) => `${t.kind}:${t.project.id}`
```

`App.tsx`: `Route += 'techpack'`; `openTabs: Tab[]`; adapt `openProject` (push `{kind:'editor'}`); add `openTechPackTab(snapshot, measures)` (find-or-refresh techpack tab, `go('techpack')`); add `activateTab(t)` (`setActive(t.project); go(t.kind)`); `closeTab` keyed by `tabKey`; `handleDelete` purges both tabs; `handleSave`/`handleRename` map `t.project.id===updated.id ? {...t, project:updated} : t`; keep `EditorScreen` mounted-but-hidden under the techpack overlay so undo/unsaved survive switching.

`ChromeBar.tsx`: `Route += 'techpack'`; props `openTabs: Tab[]`, `onTabClick:(t:Tab)=>void`, `onTabClose:(t:Tab)=>void`; active predicate `activeProject?.id===t.project.id && route===t.kind`; techpack visual treatment; `isEditor` still gates File menu.

`EditorScreen.tsx`: add prop `onOpenTechPack(snapshot, measures)`; in `openTechPack` keep snapshot logic, replace `setTechPackImg(img)` with `onOpenTechPack(img, isTee ? measures : null)`; remove dead `techPackImg` state + modal render.

### 3.3 Persistence (column, not table)
**Decision: add one `techpack_json text` column on `projects`** — mirrors `canvas_json`, 1:1 with project, lowest friction. Include it in the light `fetchProjects` select (few hundred bytes, no lazy fetch).

```ts
// types/project.ts
techpackJson: string | null
export interface TechPack {
  sections: TechPackSection[]
  bomRows: BomRow[]
  poms: PomRow[]
  annotations: Annotation[]   // { id, imageSlotId, tipX, tipY (0–1), textBox, leaderStyle, category, text, number }
  notes: string
  measures: TechPackMeasures | null
  version: number
}
// db.ts mappers
techpackJson: row.techpack_json as string | null,   // rowToProject
techpack_json: p.techpackJson ?? null,              // projectToRow
```
Extend `fetchProjects` select with `,techpack_json`. No new db functions — `upsertProject` writes the whole row.

**⚠ Manual Supabase migration required** (`supabase/migrations/0004_add_techpack.sql`):
```sql
alter table projects add column if not exists techpack_json text;
```
Nullable + `if not exists` → existing rows backfill to `NULL`, no downtime. TS/db changes are inert until the column exists.

---

## 4. Phased implementation plan

Each phase keeps the app working and ends with `npx tsc --noEmit` green.

- **Phase 1 — Smallest end-to-end slice:** File ▸ Ficha técnica opens a parallel internal tab rendering the template (existing sheet content), editable in-memory, with Volver/Cerrar. Files: `types/project.ts` (`Tab`+`tabKey`), `App.tsx` (route/tabs refactor + render), `ChromeBar.tsx` (Tab[] props + techpack tab visual), `EditorScreen.tsx` (`onOpenTechPack`, re-target `openTechPack`, remove modal), `TechPackSheet.tsx` (extract `TechPackSheetBody`), new `TechPackScreen.tsx`.
- **Phase 2 — Persistence:** `techpackJson` + `TechPack` types, db mapper lines + select, migration SQL, wire read/write of `activeProject.techpackJson`.
- **Phase 3 — Structured sections & reordering:** section-array renderer, left-rail outline, DOM drag-reorder, add/remove/visibility, garment-typed default template.
- **Phase 4 — Structured BOM + POM tables:** editable grouped BOM table + POM table with HTM/tolerance/graded + grade-rule generation; garment-variant POM sets.
- **Phase 5 — Images:** image-slot component (drag-drop/paste/pick, replace-in-place, scale handles, fit); multi-image sections.
- **Phase 6 — Annotation overlay (headline):** SVG overlay, normalized anchors, create/drag/edit, numbered callout↔list, leader styles + categories, detail bubbles, undo, POM-bound callouts.
- **Phase 7 — Polish:** remaining sections (artwork/labels/packaging/revisions), inspector refinements, print page-break tuning, zoom.

---

## 5. Reuse map & risks

### Reuse directly
| Capability | Source |
|---|---|
| Cropped garment snapshot | `openTechPack` `EditorScreen.tsx:3561-3579` |
| A4 print sheet + `window.print()`→PDF | `TechPackSheet.tsx` + print CSS `src/index.css` |
| Editable text/tables (native DOM) | `TechPackSheet.tsx:91-108, 135-142` |
| Replace-image-in-place (transform-preserving) | `removeBackground` `:2876-2910` |
| Image place/scale defaults, paste | `handlePlaceImage` `:2851`, `onPaste` `:3504` |
| Normalized garment-space anchor + overlay projection | `TEE_HANDLES` `:890-929`, `after:render` `:1068-1082` |
| Leader line + 45° snap | shape tool `Line` `:2549-2574` |
| Reorder interaction reference | `reorderLayerTo`/`moveLayer` `:3880-3906` |
| Undo/redo convention | `HistoryEntry` `:26-36`, keydown engine `:3282-3537` |
| Tab/route plumbing, File menu wiring | `App.tsx` + `ChromeBar.tsx:256` |
| DB mapper pattern, `upsertProject` | `src/lib/db.ts` |

### Build new
`TechPackScreen.tsx` (3-zone workspace); section-array model + outline + DOM drag-reorder; structured BOM & POM tables with grade-rule generation; image-slot component (DOM); **SVG annotation overlay + entity** (the only genuinely new subsystem); `Tab` union; `techpack_json` column + types.

### Top risks & edge-cases
1. **Snapshot freshness:** TP tab holds an open-time snapshot; re-running File ▸ Ficha técnica refreshes it. Normalized-coord annotations survive the refresh.
2. **Unsaved canvas state when switching:** mitigated by keeping `EditorScreen` mounted-hidden under the TP overlay.
3. **Two tabs per project:** identity must be `tabKey` (`kind:id`), not `project.id`; `handleDelete` purges both.
4. **Migration gating:** techpack save/load no-ops until the user runs the `ALTER TABLE`; make failure visible (toast).
5. **`measures` null for hoodie/pants:** base POM column blank unless parametric tee active; degrade gracefully.
6. **Payload growth:** images as data URLs in `techpackJson` bloat the row + eager select; revisit lazy-load/Storage if heavy.
7. **Print pagination:** multi-section A4 needs `break-inside: avoid` per block; overlay must not clip.
8. **HMR/module patching:** editor patches Fabric defaults (`:716-743`); keep one canvas to avoid doubling fragility.
9. **Live sync:** rename/recolor must reach TP tab via `{...t, project:updated}` or swatches go stale.
