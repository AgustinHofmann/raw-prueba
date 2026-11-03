# Identidad visual

Todo esto está sacado del CSS real de la app (`src/index.css`), no es una
propuesta. La landing tiene que verse como una continuación del producto: si
alguien entra desde la landing, no debería sentir que cambió de marca.

## Colores

El sistema se define en **oklch** (es la fuente de verdad). Al lado va el hex
equivalente, para usar en Figma o donde haga falta.

### Tema oscuro — es el principal, la landing va acá

| Token | oklch | hex | Para qué |
|---|---|---|---|
| `--bg` | `oklch(0.155 0.006 260)` | `#0b0c0f` | Fondo de la página |
| `--bg-2` | `oklch(0.185 0.006 260)` | `#111315` | Fondo de zonas hundidas |
| `--surface` | `oklch(0.215 0.006 260)` | `#181a1c` | Tarjetas, paneles |
| `--surface-2` | `oklch(0.255 0.007 260)` | `#212326` | Tarjeta sobre tarjeta |
| `--line` | `oklch(0.32 0.008 260)` | `#303337` | Bordes |
| `--line-soft` | `oklch(0.27 0.007 260)` | `#24272a` | Separadores suaves |
| `--fg` | `oklch(0.97 0.005 90)` | `#f6f5f1` | Texto principal |
| `--fg-2` | `oklch(0.82 0.006 90)` | `#c5c4c0` | Texto secundario |
| `--muted` | `oklch(0.58 0.008 260)` | `#777a7f` | Texto apagado |
| **`--accent`** | `oklch(0.88 0.19 125)` | **`#bbec4d`** | **El color de la marca** |
| `--accent-2` | `oklch(0.78 0.20 125)` | `#9acc00` | Acento al pasar el mouse |
| `--accent-ink` | `oklch(0.18 0.04 125)` | `#0e1402` | Texto SOBRE el acento |
| `--danger` | `oklch(0.68 0.22 25)` | `#ff4c4d` | Errores, borrar |

Los grises **no son neutros**: tienen una gota de azul (hue 260) y los textos
una gota de cálido (hue 90). Es lo que hace que no se vea como un dark mode
genérico. Conviene respetarlo.

### Tema claro — por si la landing necesita una sección clara

`--bg` `#f9fafb` · `--bg-2` `#eff0f2` · `--surface` `#ffffff` ·
`--surface-2` `#e6e8eb` · `--line` `#cfd1d5` · `--fg` `#181b1f` ·
`--fg-2` `#44484e` · `--muted` `#6e7278`. El acento **no cambia**.

### La regla del acento

`#bbec4d` es un verde lima que grita. En la app se usa **muy poco**: la
herramienta activa, un botón principal, un dato clave. Todo lo demás es gris.
Ese contraste es la identidad. Si la landing lo usa en todos lados, se pierde.

**Encima del acento el texto va en `--accent-ink` (`#0e1402`), nunca blanco**:
sobre ese verde el blanco no tiene contraste suficiente.

## Tipografías

| Token | Familia | Para qué |
|---|---|---|
| `--display` | **Instrument Serif**, Georgia, serif | Títulos. Casi siempre en **itálica** |
| `--ui` | **Geist**, system-ui, Segoe UI, sans-serif | Toda la interfaz y los textos |
| `--mono` | **JetBrains Mono**, ui-monospace, Menlo | Códigos de color, medidas, datos |

Las tres son gratuitas (Google Fonts / Vercel). La combinación **serif itálica
para el título + sans para el resto** es la firma de la marca: se ve en el
logotipo (`R.AW`), en los títulos de pantalla (*"Tu archivo."*, *"Bienvenido de
vuelta"*) y en el lema.

El título principal de la app usa `clamp(44px, 7vw, 100px)` con
`letter-spacing: -0.025em`. Los títulos grandes van **apretados**.

Las etiquetas chiquitas (`.label`) van en mayúsculas, 10 px, con
`letter-spacing: 0.16em` y color `--muted`.

## Formas y profundidad

**Radios:** `4px` · `6px` · **`10px` (el normal)** · `16px` · `24px`

**Sombras:**
- `--shadow-sm`: `0 2px 8px rgb(0 0 0 / 0.25)`
- `--shadow`: `0 8px 30px rgb(0 0 0 / 0.4)`
- `--shadow-lg`: `0 30px 80px rgb(0 0 0 / 0.5)`

Sobre fondo oscuro las sombras casi no se ven: la profundidad la dan los bordes
(`--line`) y el escalón de superficies (`--bg` → `--surface` → `--surface-2`).

**Espaciado:** `4 · 8 · 12 · 16 · 24 px`.

## Movimiento

- Curva normal: `cubic-bezier(0.2, 0.8, 0.2, 1)` — arranca rápido y frena suave.
- Curva con rebote: `cubic-bezier(0.34, 1.56, 0.64, 1)`, solo para algo que aparece.
- Duración: **0.15 s** para respuestas al mouse, **0.2–0.3 s** para lo que entra.

La app tiene una animación `rise` (entra desde abajo con opacidad) que encadena
los elementos con retardos de ~0.14 s, y botones "magnéticos" que se corren unos
píxeles hacia el cursor. Es un movimiento **corto y contenido**, no decorativo.

## El logotipo

En la app es texto: **`R.AW`** en Instrument Serif itálica, con el punto del
medio en color de acento y un poco de espacio entre letras.

Desde el 2026-10-28 también hay archivo, en `docs/brand/`:

| Archivo | Para qué |
|---|---|
| `logo-raw-design.svg` | El principal. Letras en `#0b0c0f`, para fondos claros |
| `logo-raw-design-fondo-oscuro.svg` | Letras en `#f6f5f1`, para fondos oscuros |
| `logo-raw-isotipo.svg` | **La marca corta: la R y el punto.** Para cuando `R.AW` entero no entra o no se lee |
| `logo-raw-isotipo-fondo-oscuro.svg` | El isotipo para fondos oscuros |
| `logo-raw-icono.svg` | El isotipo dentro de una baldosa redondeada: ícono de app / avatar |

El isotipo **no es un dibujo aparte**: es el mismo logotipo recortado, con las
mismas proporciones. Si se cambia uno hay que regenerar los dos.

Las letras están **convertidas a trazos**, no son texto: se ven igual en
cualquier máquina sin tener Instrument Serif instalada. El fondo es
transparente y el cuadrado va en el acento `#bbec4d` en los dos.

Se generan con el script de `docs/brand/` a partir de
`InstrumentSerif-Italic.ttf`, respetando las proporciones reales del componente
`src/components/Logo.tsx` (cuadrado y separación = 0.18 em, tracking -0.02 em).

### ⚠️ El favicon de la app no sigue esto

`public/favicon.svg` se dibujó antes y **se aparta de la marca en tres cosas**:
usa Georgia en vez de Instrument Serif (y como va en `<text>`, cada máquina lo
dibuja distinto), el verde es `#dfff57` en vez del acento `#bbec4d`, y el fondo
es `#1b1d22` en vez de `#0b0c0f`.

No se tocó todavía a propósito: la R de Instrument Serif es fina y a 16 px se
lee **peor** que la Georgia negrita que hay ahora. Reemplazarlo pide antes
resolver esa legibilidad (una R más pesada, o soltar la serif solo para el
favicon). Mientras tanto, `logo-raw-icono.svg` es el ícono correcto para todo
lo que no sea una pestaña del navegador.
