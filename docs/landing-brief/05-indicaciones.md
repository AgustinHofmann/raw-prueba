# Indicaciones y restricciones

## Lo que la landing tiene que lograr

Que un diseñador de indumentaria entienda **en diez segundos** qué es, y que el
botón para entrar esté siempre cerca. El objetivo único es que entre a probarlo:
no hay planes que vender ni mails que juntar.

Un solo llamado a la acción en toda la página: **`Entrar al estudio →`**,
apuntando a `https://raw-prueba.vercel.app`.

## Qué hacer

- **Que se vea el producto.** Capturas reales, grandes, no ilustraciones ni
  mockups de laptop flotando en un degradé.
- **Mostrar el movimiento donde importa.** La sección de medidas pide una
  animación: un número que cambia y la prenda que responde. Es la única función
  que no se entiende con una foto.
- **Fondo oscuro**, como la app.
- **El acento con cuentagotas.** El verde `#bbec4d` solo en el botón principal y
  en uno o dos datos. Es el contraste lo que lo hace funcionar.
- **Serif itálica para los títulos**, sans para todo lo demás.
- **Que funcione en el teléfono.** El público mira links desde el celular, aunque
  después use la app en la computadora.

## Qué NO hacer

- **No inventar funciones.** Todo lo que se muestre tiene que estar en
  `03-funcionalidades.md`. Si algo no está ahí, no existe.
- **No inventar números.** Nada de "+5.000 diseñadores" ni "10.000 prendas
  creadas": el producto es nuevo y no los tiene. La app ya sacó unos contadores
  falsos por esto mismo.
- **No poner testimonios ni logos de clientes.** No hay.
- **No poner precios ni planes.** Hoy es gratis.
- **No usar degradés de colores ni glassmorphism.** La app es plana, de
  superficies y bordes. Un degradé multicolor la haría ver de otra marca.
- **No usar emojis** como iconografía. La app usa íconos de línea.
- **No escribir en neutro ni en español de España.** Es de vos y rioplatense.
- **No llenar de acento.** Si el verde está en cinco lugares de la misma pantalla,
  ya se rompió.

## Restricciones técnicas

- **Una sola página**, HTML + CSS. Sin framework: la landing es independiente de
  la app (la app es React, pero la landing no necesita serlo).
- **Que cargue rápido.** Las capturas del brief son PNG pesados: hay que
  comprimirlas o pasarlas a WebP antes de publicar.
- **Las tipografías son gratuitas**: Instrument Serif y JetBrains Mono están en
  Google Fonts; Geist es de Vercel (también gratis). Cargar solo los pesos que se
  usen.
- **Los colores en oklch** con hex de respaldo, igual que la app.
- Si se publica en Vercel, va como **proyecto aparte** del de la app.

## Accesibilidad

- **Texto sobre el acento en `#0e1402`, nunca blanco.** Sobre ese verde el blanco
  no llega al contraste mínimo.
- El texto apagado (`--muted`, `#777a7f`) sobre el fondo (`#0b0c0f`) sirve para
  etiquetas chicas, **no para párrafos largos**: para leer, usar `--fg-2`
  (`#c5c4c0`).
- Las animaciones tienen que respetar `prefers-reduced-motion`.

## Cosas que conviene preguntar antes de maquetar

1. **¿Hay logo en archivo?** Ramiro hizo la identidad; en la app el logotipo es
   texto (`R.AW`). Si hay un SVG, usarlo.
2. **¿Va en español solo, o también en inglés?** El lema ya está en inglés.
3. **¿Se nombra al equipo?** Hay tres personas detrás; puede ir en el pie o no ir.
