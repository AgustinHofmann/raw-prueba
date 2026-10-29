# Archivos de marca

Todos los SVG tienen las **letras convertidas a trazos**. Los originales de los
que salen (`public/favicon.svg`, `public/icon-maskable.svg`) llevan el texto
vivo, así que en una máquina sin la tipografía instalada se ven con otra letra —
y un logo no puede depender de eso.

## ⚠️ La marca usa DOS tipografías

No es un error de estos archivos, viene así del producto:

| Dónde | Tipografía | De dónde sale |
|---|---|---|
| **Ícono** (pestaña, barra de tareas, app) | **Georgia** bold itálica | `public/favicon.svg` lo pide explícitamente |
| **Logotipo largo R.AW** (barra de la web) | **Instrument Serif** itálica | `--display` en `src/index.css` |

Si se ponen los dos juntos en una pieza, la R no es la misma. Vale la pena
unificarlo en algún momento; mientras tanto, cada archivo respeta lo que
realmente se ve en su lugar.

## Qué es cada archivo

### Ícono — Georgia (lo que se ve en la barra de tareas)

| Archivo | Para qué |
|---|---|
| `logo-raw-icono-georgia.svg` | 32 px, copia exacta del favicon |
| `logo-raw-icono-georgia-512.svg` | El mismo a 512: para donde 32 px se vea pixelado |

### Redes

| Archivo | Para qué |
|---|---|
| `instagram-A-r-mas-chica.svg` | Foto de perfil, marca al 46 % del cuadro |
| `instagram-B-mas-aire.svg` | Lo mismo con más aire, 34 % |

Las dos van **a sangre, sin esquinas redondeadas**: Instagram recorta en
círculo, así que las esquinas se pierden igual y una baldosa redondeada adentro
del círculo se lee como un recorte mal hecho. Y la marca va más chica que en el
ícono: el encuadre de 32 px está pensado para una pestaña, y en una foto de
perfil queda apretado contra el borde.

### Logotipo largo — Instrument Serif (lo que se ve en la web)

| Archivo | Para qué |
|---|---|
| `logo-raw-design.svg` | `R.AW` sobre transparente, letras oscuras |
| `logo-raw-design-fondo-oscuro.svg` | Lo mismo en claro, para fondos oscuros |
| `logo-raw-completo-fondo.svg` | `R.AW` + "RAW DESIGN" sobre la caja `#1b1d22` |
| `logo-raw-isotipo.svg` · `-fondo-oscuro.svg` | Solo la R y el punto, sin caja |
| `logo-raw-icono.svg` | La R y el punto dentro de una baldosa |

## Volver a generarlos

```bash
npm i opentype.js
node generar-icono.mjs       # ícono Georgia (32 y 512)
node generar-instagram.mjs   # fotos de perfil
node generar-logo-web.mjs    # logotipo con la tipografía de la web
node generar-logo.mjs        # logotipo e isotipo sin caja
```

Los scripts leen las tipografías de `.agents/skills/ui-styling/canvas-fonts/`
(Instrument Serif, Outfit) y de `C:/Windows/Fonts` (Georgia). Si se cambia uno,
conviene regenerar los que comparten proporciones para que no se vayan
separando de a poco.

## La regla del acento

El verde es `#dfff57` en el ícono y `#bbec4d` en la app (`--accent`). Son dos
verdes distintos y **también viene así del producto**. Ver
`docs/landing-brief/02-identidad-visual.md`.
