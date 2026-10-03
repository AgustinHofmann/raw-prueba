# -*- coding: utf-8 -*-
"""
Presentación del MVP de RAW Design. 10 minutos exactos.

Cada lámina lleva en las NOTAS DEL ORADOR el guion y cuánto dura, para poder
ensayar contra reloj. La suma de los tiempos da 10:00.

Identidad visual: la misma de la app (fondo casi negro, verde lima como único
acento, Cormorant Garamond para títulos y Montserrat para el resto).
"""
import os
from pptx import Presentation
from pptx.util import Cm, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
CAP  = os.path.join(AQUI, "capturas")
SALIDA = os.path.expanduser(r"~\Documents\RAW Design - MVP (10 min).pptx")

PW, PH = 33.867, 19.05        # 16:9
M = 2.0                        # margen

FONDO  = RGBColor(0x0B, 0x0C, 0x0F)
SUP    = RGBColor(0x16, 0x18, 0x1C)
TINTA  = RGBColor(0xF6, 0xF5, 0xF1)
TINTA2 = RGBColor(0xC5, 0xC4, 0xC0)
MUDO   = RGBColor(0x80, 0x83, 0x88)
LIMA   = RGBColor(0xBB, 0xEC, 0x4D)
LINEA  = RGBColor(0x2A, 0x2E, 0x33)

SERIF = "Cormorant Garamond"
SANS  = "Montserrat"


def fondo(s):
    r = s.shapes.add_shape(1, 0, 0, Cm(PW), Cm(PH))
    r.fill.solid(); r.fill.fore_color.rgb = FONDO
    r.line.fill.background(); r.shadow.inherit = False


def txt(s, x, y, w, h, texto, fuente, tam, color, align=PP_ALIGN.LEFT,
        inter=1.15, italic=False, esp=0):
    tb = s.shapes.add_textbox(Cm(x), Cm(y), Cm(w), Cm(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, ln in enumerate(texto.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align; p.line_spacing = inter
        if esp: p.space_after = Pt(esp)
        r = p.add_run(); r.text = ln
        r.font.name = fuente; r.font.size = Pt(tam)
        r.font.color.rgb = color; r.font.italic = italic
    return tb


def viñetas(s, x, y, w, items, tam=15, color=TINTA2):
    """
    Lista con un guion lima adelante.

    El alto de cada item se ESTIMA: python-pptx no mide texto, y con un avance
    fijo los renglones largos se montaban unos sobre otros.
    """
    INTER = 1.35
    ancho_txt = w - 0.8
    # ancho medio de un caracter de Montserrat, en cm, para este cuerpo
    char_cm = tam * 0.0353 * 0.52
    por_linea = max(12, int(ancho_txt / char_cm))
    alto_linea = tam * 0.0353 * INTER
    yy = y
    for it in items:
        lineas = max(1, -(-len(it) // por_linea))      # division hacia arriba
        alto = lineas * alto_linea
        txt(s, x, yy, 0.6, alto_linea, "—", SANS, tam, LIMA)
        txt(s, x + 0.8, yy, ancho_txt, alto + 0.3, it, SANS, tam, color, inter=INTER)
        yy += alto + 0.46
    return yy


def img(s, nombre, x, y, w=None, h=None, borde=True):
    ruta = os.path.join(CAP, nombre)
    if not os.path.exists(ruta): return None
    with Image.open(ruta) as im:
        ar = im.size[0] / float(im.size[1])
    if w and not h: h = w / ar
    if h and not w: w = h * ar
    p = s.shapes.add_picture(ruta, Cm(x), Cm(y), Cm(w), Cm(h))
    if borde:
        p.line.color.rgb = LINEA; p.line.width = Pt(1)
    return p


def eyebrow(s, texto):
    txt(s, M, 1.5, 20, 0.6, texto.upper(), SANS, 10, MUDO)


def notas(s, guion):
    s.notes_slide.notes_text_frame.text = guion


def crono(s, t):
    txt(s, PW - M - 4, PH - 1.5, 4, 0.6, t, SANS, 10, MUDO, PP_ALIGN.RIGHT)


prs = Presentation()
prs.slide_width, prs.slide_height = Cm(PW), Cm(PH)
B = prs.slide_layouts[6]
nueva = lambda: prs.slides.add_slide(B)

# ══ 1 · PITCH (1:00) ═════════════════════════════════════════════════════════

s = nueva(); fondo(s)
txt(s, M, 5.6, 20, 4.5, "Una prenda\nno es un dibujo.", SERIF, 62, TINTA, inter=0.95, italic=True)
txt(s, M, 11.0, 17, 2.2,
    "Diseñá ropa por medidas reales, no estirando figuras.", SANS, 16, TINTA2, inter=1.4)
txt(s, M, 15.4, 20, 1, "RAW  DESIGN   ·   MVP", SANS, 11, LIMA)
img(s, "hook.png", 19.6, 4.2, w=12.2)
crono(s, "0:20")
notas(s, """[0:20] HOOK

Arrancar con la frase y una pausa.

"Si abrís Illustrator y querés que una remera sea más larga, la estirás. Y al
estirarla, también se ensancha. Porque para el programa no es una remera: es un
dibujo."

Pausa.

"Nosotros hicimos la herramienta donde una prenda es una prenda."

No leer la lámina. La frase se dice mirando al público.""")

s = nueva(); fondo(s)
eyebrow(s, "El pitch")
txt(s, M, 2.9, 22, 2, "El problema, en una línea", SERIF, 34, TINTA, italic=True)
txt(s, M, 5.6, 13.5, 6,
    "Diseñar indumentaria se hace hoy con programas\nde dibujo general, que no saben nada de ropa.",
    SANS, 15, TINTA2, inter=1.45)
txt(s, M, 9.4, 13.5, 2, "NUESTRA SOLUCIÓN", SANS, 10, LIMA)
txt(s, M, 10.3, 13.5, 5,
    "Un editor donde la prenda se edita por medidas\nen centímetros y se rehace sola.",
    SANS, 15, TINTA2, inter=1.45)
txt(s, 18.4, 9.4, 13.5, 2, "EL VALOR", SANS, 10, LIMA)
txt(s, 18.4, 10.3, 13.5, 5,
    "Lo que ves en pantalla es lo que sale del taller.\nY la ficha técnica sale del mismo archivo.",
    SANS, 15, TINTA2, inter=1.45)
ln = s.shapes.add_shape(1, Cm(M), Cm(8.7), Cm(PW - 2 * M), Cm(0.03))
ln.fill.solid(); ln.fill.fore_color.rgb = LINEA; ln.line.fill.background(); ln.shadow.inherit = False
crono(s, "0:40")
notas(s, """[0:40] PROBLEMA · SOLUCIÓN · VALOR  (total pitch: 1:00)

"Hoy un diseñador de indumentaria trabaja con Illustrator o Photoshop, que son
programas de dibujo general. No saben qué es una manga ni qué es un ruedo."

"RAW Design parte de la prenda. Elegís remera, chomba o pantalón, y la editás
escribiendo medidas en centímetros. La prenda se rehace, no se estira."

"El valor está en dos cosas: lo que ves en pantalla es lo que va a salir del
taller, y la ficha técnica para producción sale del mismo archivo donde
diseñaste."

Ritmo rápido. Esta lámina son tres frases, no más.""")

# ══ 2 · PRODUCTO (6:40) ══════════════════════════════════════════════════════

s = nueva(); fondo(s)
eyebrow(s, "Producto")
txt(s, M, 2.9, 22, 2, "El equipo", SERIF, 34, TINTA, italic=True)
cols = [
    ("Ramiro", "Diseño visual e identidad de marca.\nWireframes y los mockups de las prendas."),
    ("Agustín", "Desarrollo completo del front.\nEl editor, las herramientas y las pantallas."),
    ("Aaron", "Base de datos y persistencia.\nEl esquema y la sincronización."),
]
for i, (n, d) in enumerate(cols):
    x = M + i * 10.0
    c = s.shapes.add_shape(1, Cm(x), Cm(6.0), Cm(9.0), Cm(6.4))
    c.fill.solid(); c.fill.fore_color.rgb = SUP
    c.line.color.rgb = LINEA; c.line.width = Pt(1); c.shadow.inherit = False
    txt(s, x + 0.9, 6.9, 7.2, 1.2, n, SERIF, 26, LIMA, italic=True)
    txt(s, x + 0.9, 8.6, 7.2, 3.4, d, SANS, 13, TINTA2, inter=1.45)
txt(s, M, 13.6, 28, 1.6,
    "Tres personas, cada una en lo suyo. Trabajamos sobre el mismo repositorio\ncon ramas separadas.",
    SANS, 13, MUDO, inter=1.4)
crono(s, "0:40")
notas(s, """[0:40] EQUIPO

Presentar a los tres rápido, sin detenerse.

"Ramiro hizo la identidad visual y los mockups de las prendas. Agustín el
desarrollo del editor. Aaron la base de datos y la sincronización."

"Somos tres y trabajamos sobre el mismo repositorio, cada uno en su rama."

No entrar en detalle acá: el detalle viene en las próximas láminas.""")

s = nueva(); fondo(s)
eyebrow(s, "Producto")
txt(s, M, 2.9, 24, 2, "Los tres problemas que resolvemos", SERIF, 34, TINTA, italic=True)
tres = [
    ("Se deforma", "Alargar la remera también la ensancha.\nPorque para el programa es un dibujo."),
    ("La tela no está a escala", "El estampado queda del tamaño que quedó.\nLo que ves no es lo que va a salir."),
    ("La ficha se arma dos veces", "El diseño en un archivo, las medidas en otro,\ny todo copiado a mano."),
]
for i, (t, d) in enumerate(tres):
    x = M + i * 10.0
    txt(s, x, 6.4, 1.2, 1, "0" + str(i + 1), SANS, 11, LIMA)
    txt(s, x, 7.5, 8.6, 1.6, t, SERIF, 27, TINTA, italic=True)
    txt(s, x, 10.0, 8.6, 3.6, d, SANS, 13.5, TINTA2, inter=1.5)
crono(s, "0:50")
notas(s, """[0:50] EL PROBLEMA EN DETALLE

Uno por uno, con una frase cada uno.

1. "Se deforma. En un programa de dibujo, si alargás la remera, también se
   ensancha. Es una sola figura escalada."

2. "La tela no está a escala. Ponés un estampado y queda del tamaño que quedó.
   Una raya que en pantalla mide un centímetro, en la tela real puede medir
   tres."

3. "La ficha técnica se arma dos veces. El diseño está en un archivo, las
   medidas en una planilla aparte, y hay que copiar todo a mano al documento
   que se manda al taller."

"Las tres las resolvimos. Se las muestro."

Esta lámina prepara las tres que siguen: una por problema.""")

s = nueva(); fondo(s)
eyebrow(s, "Funcionalidad core · 1")
txt(s, M, 2.9, 24, 2, "La prenda se rehace, no se estira", SERIF, 34, TINTA, italic=True)
img(s, "medidas-70.png", M, 6.4, w=14.4)
img(s, "medidas-92.png", M + 15.1, 6.4, w=14.4)
txt(s, M, 15.3, 14.4, 1.2, "LARGO 70 cm", SANS, 11, LIMA)
txt(s, M + 15.1, 15.3, 14.4, 1.2, "LARGO 92 cm", SANS, 11, LIMA)
txt(s, M, 16.5, 29.8, 1.6,
    "Misma prenda, 22 cm más larga. El ancho de pecho, el cuello y las mangas quedaron idénticos.",
    SANS, 14, TINTA2, inter=1.4)
crono(s, "1:20")
notas(s, """[1:20] LA FUNCIÓN ESTRELLA — dedicarle tiempo, es LO nuestro

"Estas dos son la misma remera. A la de la derecha le cambié UNA medida: el
largo, de 70 a 92 centímetros."

Señalar el ancho.

"Miren el ancho de pecho, el cuello y las mangas. Son idénticos. 60, 18 y 18.
En un programa de dibujo, estirarla para alargarla la habría ensanchado igual."

"Esto funciona en las tres prendas: remera, chomba y pantalón. Cada medida mueve
lo suyo y nada más: el largo alarga, el pecho ensancha, la manga se alarga
colgando del hombro."

"Por debajo no escalamos la imagen: movemos los puntos del dibujo según las
medidas. La prenda se vuelve a construir cada vez."

Si hay demo en vivo, es ACÁ: mover el número y que se vea.""")

s = nueva(); fondo(s)
eyebrow(s, "Funcionalidad core · 2")
txt(s, M, 2.9, 24, 2, "Telas a escala real", SERIF, 34, TINTA, italic=True)
img(s, "desgaste.png", 16.4, 5.4, w=15.4)
viñetas(s, M, 6.2, 13.4, [
    "Decís cuánto mide la muestra de tela en centímetros y se dibuja a esa escala sobre la prenda.",
    "Estampados que se recolorean, telas reales que vienen con el programa, y las que importa el diseñador.",
    "Encima van los efectos: desgaste, grunge y vintage. Se suman al color o al estampado, no lo reemplazan.",
])
txt(s, M, 14.6, 13.4, 1.6, "Denim + desgaste = jean gastado.", SANS, 13, LIMA, inter=1.4)
crono(s, "1:00")
notas(s, """[1:00] TELAS

"Segundo problema: la escala. Acá vos declarás cuánto mide la muestra de tela en
centímetros, y el programa la dibuja a esa escala sobre la prenda. Una raya de
un centímetro se ve de un centímetro."

"Hay tres tipos de tela conviviendo en una sola lista: estampados que genera el
programa y se pueden recolorear, telas reales que vienen incluidas, y las que
sube el diseñador sacándole una foto a un género."

"Y encima de la tela van los efectos, que no la reemplazan: se suman. Este es
denim con desgaste, que da un jean gastado. El desgaste no es un filtro: sigue
la trama del tejido, el color se va en manchones y el hilo se pela donde ya está
desteñido."

Mostrar la imagen mientras se habla.""")

s = nueva(); fondo(s)
eyebrow(s, "Funcionalidad core · 3")
txt(s, M, 2.9, 26, 2, "Los detalles de confección", SERIF, 34, TINTA, italic=True)
cajas = [
    ("Bordado", "bordado.png", "Convierte un texto o un vector en hilo:\npuntadas cortas, brillo y sombra, relieve."),
    ("Cierre", "cierre.png", "Un pincel que estampa cadena metálica,\ncomo los packs de Procreate."),
    ("Calco", "calco.png", "Importás un logo y sale vectorizado,\nlimpio y sin fondo."),
]
for i, (t, im, d) in enumerate(cajas):
    x = M + i * 10.0
    img(s, im, x, 5.9, w=9.0, h=5.6)
    txt(s, x, 12.0, 8.8, 1.2, t, SERIF, 25, LIMA, italic=True)
    txt(s, x, 13.7, 8.8, 2.6, d, SANS, 12.5, TINTA2, inter=1.45)
crono(s, "0:50")
notas(s, """[0:50] DETALLES DE CONFECCIÓN

Rápido, una frase por cosa.

"Bordado: agarrás un texto o un logo y lo convierte en hilo de verdad. Puntada
por puntada, con brillo y sombra, porque el hilo es un cilindro."

"Cierre: es un pincel que estampa, como los packs de Procreate. Dibujás el
recorrido y aparece la cadena metálica siguiendo la curva."

"Calco: importás el logo de una marca en PNG y sale vectorizado, limpio y sin
fondo, listo para bordarlo o estamparlo."

No detenerse en ninguno. Son el 'y además'.""")

s = nueva(); fondo(s)
eyebrow(s, "Funcionalidad core · 4")
txt(s, M, 2.9, 26, 2, "De la idea al taller, sin salir de acá", SERIF, 34, TINTA, italic=True)
img(s, "ficha-tecnica.png", 13.0, 5.2, w=18.8)
viñetas(s, M, 6.2, 10.4, [
    "La ficha sale del mismo proyecto donde diseñaste.",
    "Hojas A4: diseño, especificaciones, tabla de medidas y materiales.",
    "Anotaciones con flechas y llamadas sobre la prenda.",
    "Se exporta a PDF para mandar al taller.",
])
crono(s, "0:50")
notas(s, """[0:50] FICHA TÉCNICA

"Tercer problema resuelto: la ficha no se arma aparte."

"Del mismo proyecto en el que venías diseñando sale la ficha técnica. Son hojas
A4: el diseño con frente y espalda, las especificaciones, la tabla de medidas y
la lista de materiales."

"Sobre las imágenes podés anotar con flechas y llamadas numeradas, que es como
se le explica al taller dónde va cada cosa."

"Y se exporta a PDF."

Señalar el botón Exportar PDF de la captura.""")

s = nueva(); fondo(s)
eyebrow(s, "Producto")
txt(s, M, 3.4, 26, 2.6, "Y funciona sin internet", SERIF, 36, TINTA, italic=True)
txt(s, M, 7.4, 26, 4,
    "Guarda primero en tu computadora y sube a la nube cuando puede.\n"
    "Si se corta la conexión, seguís trabajando y no perdés nada.\n"
    "Con cuenta, los proyectos aparecen en cualquier dispositivo.",
    SANS, 16, TINTA2, inter=1.6)
txt(s, M, 13.6, 26, 1.4, "Se abre en el navegador. No hay que instalar nada.", SANS, 14, LIMA)
crono(s, "0:30")
notas(s, """[0:30] SIN INTERNET

Corto, es tranquilidad y no espectáculo.

"Una decisión de fondo: el programa guarda primero en tu computadora y sube a la
nube cuando puede. Si se corta internet seguís trabajando y no perdés nada."

"Y si tenés cuenta, los proyectos te aparecen en cualquier dispositivo."

"Se abre en el navegador, no hay que instalar nada."

Acá termina Producto: van 7:40 de los 10.""")

# ══ 3 · TÉCNICO (1:20) ═══════════════════════════════════════════════════════

s = nueva(); fondo(s)
eyebrow(s, "Técnico")
txt(s, M, 2.7, 26, 2, "Arquitectura y stack", SERIF, 34, TINTA, italic=True)

txt(s, M, 6.0, 13.5, 1, "STACK", SANS, 10, LIMA)
viñetas(s, M, 7.0, 13.5, [
    "React 19 + TypeScript + Vite",
    "Fabric.js — el motor del lienzo",
    "Supabase — base de datos y cuentas",
    "IndexedDB — la base local del navegador",
    "Vercel — publicación",
], tam=14)

txt(s, 17.8, 6.0, 14, 1, "LAS DOS DECISIONES QUE DEFINEN TODO", SANS, 10, LIMA)
txt(s, 17.8, 7.1, 14, 2.6,
    "1 · El navegador manda.\nTodo se guarda primero en la máquina y después sube.\nNo hay backend propio.",
    SANS, 13.5, TINTA2, inter=1.45)
txt(s, 17.8, 11.0, 14, 2.6,
    "2 · La prenda es paramétrica.\nNo es una imagen: cada pieza se redibuja moviendo\nsus puntos según las medidas.",
    SANS, 13.5, TINTA2, inter=1.45)
crono(s, "1:20")
notas(s, """[1:20] TÉCNICO — una sola lámina, sin entrar en detalle

"Del lado técnico, muy rápido."

"Es una aplicación web: React con TypeScript, y el lienzo del editor está hecho
con Fabric.js. La base de datos y las cuentas son Supabase, y está publicado en
Vercel."

"Pero lo que define la arquitectura son dos decisiones."

"La primera: el navegador manda. Todo se guarda primero en la máquina del
diseñador y después sube a la nube. Por eso funciona sin internet. No tenemos
backend propio."

"La segunda: la prenda es paramétrica. No es una imagen que escalamos: cada
pieza se vuelve a dibujar moviendo sus puntos según las medidas. Es lo que hace
posible todo lo que les mostré."

Si el jurado pregunta, ahí se profundiza. No adelantarse.""")

# ══ 4 · PROYECCIÓN (1:00) ════════════════════════════════════════════════════

s = nueva(); fondo(s)
eyebrow(s, "Proyección")
txt(s, M, 2.9, 26, 2, "Qué sigue", SERIF, 34, TINTA, italic=True)
txt(s, M, 6.0, 13.5, 1, "PRÓXIMO", SANS, 10, LIMA)
viñetas(s, M, 7.0, 13.5, [
    "Dividir la prenda en zonas de color, con una línea.",
    "Más avíos: tiradores, botones, elásticos.",
    "Ajustar medidas arrastrando también en pantalón y chomba.",
], tam=14)
txt(s, 17.8, 6.0, 14, 1, "MÁS ADELANTE", SANS, 10, MUDO)
viñetas(s, 17.8, 7.0, 14, [
    "Más prendas: buzo, campera, vestido.",
    "Compartir un proyecto con el taller por link.",
    "Salir a diseñadores reales y medir si les sirve.",
], tam=14, color=MUDO)
crono(s, "0:50")
notas(s, """[0:50] PROYECCIÓN

"Lo próximo que estamos haciendo: poder dividir la prenda en zonas de color
trazando una línea, para hacer color blocking. Más avíos: tiradores, botones,
elásticos. Y poder ajustar las medidas arrastrando sobre el pantalón y la
chomba, que hoy solo se puede en la remera."

"Más adelante: más prendas, poder compartirle el proyecto al taller con un link,
y sobre todo salir a diseñadores reales y medir si de verdad les resuelve el
trabajo."

Honestidad: es un MVP, no un producto terminado.""")

s = nueva(); fondo(s)
txt(s, M, 6.8, 26, 3.4, "Una prenda\nno es un dibujo.", SERIF, 50, TINTA, inter=0.98, italic=True)
ln = s.shapes.add_shape(1, Cm(M), Cm(11.6), Cm(5.0), Cm(0.04))
ln.fill.solid(); ln.fill.fore_color.rgb = LIMA; ln.line.fill.background(); ln.shadow.inherit = False
txt(s, M, 12.6, 26, 1.4, "raw-prueba.vercel.app", SANS, 15, LIMA)
txt(s, M, 14.4, 26, 1.2, "Gracias.", SANS, 14, MUDO)
crono(s, "0:10")
notas(s, """[0:10] CIERRE

"Volvemos al principio: una prenda no es un dibujo. Está en línea, se puede
probar sin cuenta."

"Gracias."

Dejar la lámina en pantalla para las preguntas.

═══ TOTAL: 10:00 ═══
Pitch 1:00 · Producto 6:40 · Técnico 1:20 · Proyección 1:00""")

prs.save(SALIDA)
print(SALIDA)
print("laminas:", len(prs.slides._sldIdLst))
