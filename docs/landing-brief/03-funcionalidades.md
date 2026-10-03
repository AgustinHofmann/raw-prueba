# Funcionalidades reales

Todo lo de acá **anda hoy** en https://raw-prueba.vercel.app. Están ordenadas por
cuánto sirven para vender el producto: las tres primeras son las que valen una
sección propia en la landing.

---

## 1. La prenda se edita por medidas (⭐ la función estrella)

Las tres prendas —**remera, chomba y pantalón**— se editan escribiendo medidas en
centímetros. La prenda **se rehace**, no se estira: alargar el largo total no
ensancha el pecho, ensanchar el pecho no alarga la manga.

- **Remera:** largo total, ancho de pecho, ancho de cintura, ancho y profundidad
  de cuello, largo y ancho de manga.
- **Chomba:** largo total, ancho de pecho, ancho de cintura, ancho de cuello,
  largo y ancho de manga.
- **Pantalón:** largo total, cintura, cadera, rodilla, ruedo.

En la remera además se pueden **arrastrar tiradores sobre el dibujo** para ajustar
a ojo, y la medida se actualiza sola.

> **Para la landing:** es lo único que ningún programa de dibujo hace. Si hay una
> sola sección con animación, va acá: un número que cambia y la prenda
> respondiendo. Captura: `capturas/05-editor-medidas.png`.

---

## 2. Telas a escala real

Una sola lista con todo: estampados que genera el programa (rayas, denim), telas
de verdad que vienen con la app (tartanes, animal print, camuflaje) y las que
importa el diseñador (una foto o un escaneo de tela).

Lo importante: **se declara cuánto mide la muestra en centímetros** y se dibuja a
esa escala sobre la prenda. Una raya de 1 cm se ve de 1 cm. Los estampados
generados además se recolorean: se elige el color principal y el resto de la
paleta lo acompaña.

**Encima de la tela van los efectos**, que no la reemplazan sino que se suman:

- **Desgaste** — la tela pierde color en manchones y el hilo se pela siguiendo la
  trama. Denim + desgaste = jean gastado.
- **Grunge** — suciedad y manchas.
- **Vintage** — tono envejecido y desvaído.

> **Para la landing:** el antes/después de denim con desgaste es muy vendedor.
> Capturas: `capturas/06-telas.png` y `capturas/07-denim-desgaste.png`.

---

## 3. Ficha técnica para el taller

Del mismo proyecto sale la ficha: **hojas A4 apaisadas**, una por propósito.

- **Diseño** — vistas de frente y espalda.
- **Especificaciones** — construcción y materiales principales.
- **Tabla de medidas** — puntos de medición y el plano acotado.
- **Materiales (BOM)** — la lista de insumos.
- Se pueden agregar **Colorways** y **Notas**, y reordenar las hojas arrastrando.

Sobre las imágenes se anota con **flechas, líneas guía, globos y llamadas
numeradas**, ancladas a la prenda. Se exporta a PDF para mandar al taller.

> **Para la landing:** es el cierre del circuito. El mensaje es "de la idea al
> taller sin salir de acá".

---

## 4. Bordado

Convierte un vector o un texto en **bordado**: puntadas cortas en una sola
dirección (se elige cuál), con brillo y sombra porque el hilo es un cilindro,
uniones trabadas y relieve sobre la tela. Toma el color del objeto como color del
hilo.

---

## 5. Calco de imagen

Se importa un logo en PNG y sale **vectorizado**: la imagen se limpia antes
(aplana la transparencia, la agranda si es chica y pega cada píxel al color más
cercano de la paleta real), así un logo de un solo color con detalles finos sale
limpio y sin fondo.

---

## 6. Las herramientas de dibujo

Sobre la prenda se dibuja con: **selección, lápiz** (trazo libre que se suaviza),
**pluma** (curvas bezier), **curva, texto, formas** (rectángulo, redondeado,
elipse, línea, polígono, estrella), **balde de relleno**, **goma**, **gotero** y
**sello de símbolos**. Más mano y lupa para moverse por el lienzo.

El **gotero tiene lupa**: al pasar el mouse muestra los píxeles agrandados y
marca exactamente cuál se va a tomar, así se puede apuntar a un color preciso.

Además: **capas**, agrupar, y **recorte a la prenda** (lo que se dibuja se corta
contra la silueta, o no, según se prefiera).

---

## 7. Funciona sin internet

Guarda **primero en la computadora** y sube a la nube cuando puede. Si se corta la
conexión se sigue trabajando y no se pierde nada. Con cuenta, los proyectos
aparecen en cualquier dispositivo.

> **Para la landing:** vale una línea, no una sección. Es tranquilidad, no
> espectáculo.

---

## 8. Lo demás

- Proyectos organizados en **carpetas**, con buscador y selección múltiple.
- **Tipografías**: las del sistema, las de Google y las propias (se importa el
  archivo).
- **Tres temas**: oscuro, claro y gris tipo Illustrator.
- Exportar el diseño como imagen.
- Se puede **entrar sin cuenta** para probar.
