# RAW Design — Guía Técnica: Herramientas y Por Qué Las Usamos

## Stack Tecnológico

```
React 19  +  TypeScript 5.8  +  Vite 6  +  Fabric.js 6.5
```

---

## 1. Vite — Entorno de Desarrollo y Bundler

**¿Qué es?**
Vite es una herramienta que sirve el código en el navegador durante el desarrollo y lo empaqueta para producción. Reemplaza a Webpack o Create React App.

**¿Por qué lo usamos?**
- **Hot Module Replacement (HMR) instantáneo**: cuando cambiás un archivo, el navegador actualiza solo ese módulo sin recargar toda la página. Esto es crítico cuando estás ajustando herramientas del editor, porque no perdés el estado del canvas.
- **Arranque inmediato**: no pre-bundlea todo el proyecto como Webpack, sirve los módulos nativos del navegador (ES Modules) directamente.
- **Configuración mínima**: el proyecto arranca con prácticamente cero configuración.

**Comando clave:**
```bash
npm run dev    # inicia el servidor de desarrollo en localhost:5173
npm run build  # compila TypeScript y bundlea para producción
```

---

## 2. React 19 — Librería de Interfaz de Usuario

**¿Qué es?**
React es una librería de JavaScript para construir interfaces de usuario mediante componentes. Cada componente es una función que recibe datos (`props`) y devuelve HTML.

**¿Por qué lo usamos?**
- **Componentes reutilizables**: el `Sidebar`, el `Toast`, el `ChromeBar`, etc. se escriben una vez y se usan donde se necesitan.
- **Estado reactivo**: cuando cambia el proyecto activo, la herramienta seleccionada, o el color del trazo, React re-renderiza automáticamente solo los componentes afectados.
- **Hooks para lógica compleja**: `useEffect`, `useRef`, `useState` permiten manejar el ciclo de vida del canvas sin clases ni boilerplate.

**Hooks que más usamos en el editor:**

| Hook | Para qué |
|------|----------|
| `useState` | Color activo, herramienta activa, grosor del trazo |
| `useEffect` | Inicializar el canvas de Fabric, agregar/quitar event listeners |
| `useRef` | Guardar referencias al canvas y al historial sin causar re-renders |

**Ejemplo del patrón que más usamos:**
```tsx
// El canvas vive en un ref para no re-renderizar el componente
const canvasRef = useRef<fabric.Canvas | null>(null)

useEffect(() => {
  const canvas = new fabric.Canvas('canvas-el')
  canvasRef.current = canvas
  return () => canvas.dispose() // cleanup al desmontar
}, [])
```

---

## 3. TypeScript — JavaScript con Tipos

**¿Qué es?**
TypeScript es JavaScript con un sistema de tipos estático. Se compila a JavaScript normal antes de correr en el navegador.

**¿Por qué lo usamos?**
- **Autocompletado e intellisense**: el editor te sugiere qué propiedades tiene un objeto. Con Fabric.js, que tiene una API muy grande, esto es indispensable.
- **Errores en tiempo de edición**: si intentás pasar un número donde se espera un string, TypeScript te lo dice antes de ejecutar el código.
- **Tipos personalizados para el dominio**: definimos tipos como `Tool`, `HistoryEntry`, y `AnchorHandle` que hacen el código más legible y seguro.

**Ejemplo de tipo que definimos:**
```typescript
type HistoryEntry =
  | { type: 'add';    obj: fabric.FabricObject }
  | { type: 'remove'; obj: fabric.FabricObject }
  | { type: 'erase';  removed: fabric.FabricObject[]; added: fabric.FabricObject[] }
  | { type: 'modify'; prev: fabric.FabricObject; next: fabric.FabricObject }
```
Este tipo garantiza que el sistema de undo/redo siempre reciba exactamente los datos que necesita según el tipo de acción.

---

## 4. Fabric.js 6 — Motor del Canvas

**¿Qué es?**
Fabric.js es una librería que extiende el Canvas HTML5 nativo con una capa de objetos: cada trazo, texto o forma es un objeto JavaScript que tiene posición, escala, rotación, eventos de mouse, etc.

**¿Por qué lo usamos?**
- **Sin Fabric**: el canvas HTML5 nativo solo tiene operaciones de píxeles. No podés seleccionar, mover ni modificar lo que ya dibujaste.
- **Con Fabric**: cada trazo es un objeto `fabric.Path` con propiedades editables. Podés hacer `canvas.getObjects()`, filtrar, remover, modificar y volver a renderizar.
- **Sistema de transformaciones**: Fabric maneja automáticamente la posición, escala, rotación y el origen de cada objeto. Esto es lo que permite hacer zoom al canvas y que todo se vea bien.

**Conceptos clave de Fabric que usamos:**

| Concepto | Qué hace en el proyecto |
|----------|------------------------|
| `fabric.Canvas` | El canvas principal, maneja el render y los eventos de mouse |
| `fabric.Path` | Cada trazo dibujado. Guarda el path SVG (M, C, L, Z) |
| `fabric.Point` | Un punto en coordenadas del canvas |
| `e.scenePoint` | Coordenadas del mouse en el espacio de la escena (no de la pantalla) |
| `calcTransformMatrix()` | Matriz de transformación de un objeto: posición + escala + rotación |
| `getBoundingRect()` | El rectángulo que envuelve un objeto, en coordenadas de escena |
| `clipPath` | Limita el área de render de un objeto a una forma determinada |

---

## 5. SVG Path Format — El Lenguaje de los Trazos

**¿Qué es?**
Los paths SVG son strings de texto que describen formas geométricas. Fabric los usa internamente para guardar cada trazo.

**Comandos que usamos:**

| Comando | Significado |
|---------|-------------|
| `M x y` | **Move to**: mover al punto (x, y) sin dibujar |
| `L x y` | **Line to**: línea recta hasta (x, y) |
| `C cx1 cy1 cx2 cy2 x y` | **Cubic bezier**: curva con dos puntos de control |
| `Z` | **Close path**: cerrar el path conectando con el M inicial |

**Ejemplo de un trazo curvo:**
```
M 100 200 C 120 150 180 150 200 200
```
Esto es una curva que empieza en (100, 200), tiene dos puntos de control (120,150) y (180,150), y termina en (200, 200).

---

## 6. Curvas Bezier — La Matemática Detrás de los Trazos

**¿Qué son?**
Una curva bezier cúbica pasa por un punto inicial y uno final, y tiene dos "puntos de control" que atraen la curva sin que esta los toque, como un imán. Son el estándar en diseño vectorial (Illustrator, Figma, Inkscape los usan).

**La fórmula:**
```
B(t) = (1-t)³·P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3
```
Donde `t` va de 0 a 1, P0 y P3 son los extremos, P1 y P2 son los controles.

**En el código** (`cubicAt`):
```typescript
function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3
}
```
Esta función evalúa la curva en un punto `t`. La usamos para muestrear puntos sobre una curva (útil para la goma de borrar y para detectar si el mouse está cerca de un trazo).

**De Casteljau (split de bezier):**
Cuando necesitamos "cortar" una curva en un punto `t`, usamos el algoritmo de De Casteljau: interpolamos repetidamente entre los puntos de control para encontrar los dos sub-segmentos que componen la curva original.

---

## 7. Algoritmos Implementados

### 7.1 Catmull-Rom a Bezier (herramienta lápiz)

**Problema:** El usuario dibuja puntos con el mouse a mano alzada. Si los conectamos con líneas rectas, el trazo queda anguloso. Si usamos bezier directamente, es difícil calcular los puntos de control.

**Solución:** Usamos el algoritmo Catmull-Rom centripetal (alpha=0.5). Dado un conjunto de puntos, calcula automáticamente los puntos de control bezier que producen una curva suave que pasa por todos los puntos.

**Variante centripetal:** No produce bucles ni sobrepasamientos en esquinas agudas. Es la variante usada por Illustrator y Figma.

```typescript
// Dado: [P0, P1, P2, P3] puntos del mouse
// Calcula: cp1 y cp2 (puntos de control bezier entre P1 y P2)
const tx = d1 * ((p1.x - p0.x)/d0 - (p2.x - p0.x)/(d0+d1) + (p2.x - p1.x)/d1)
cp1x = p1.x + tx / 3
```

### 7.2 Ramer-Douglas-Peucker (simplificación de trazos)

**Problema:** Al dibujar a mano, el mouse genera cientos de puntos. Guardar todos hace el archivo pesado y el canvas lento.

**Solución:** El algoritmo RDP elimina puntos que están "casi en línea recta" con sus vecinos, manteniendo la forma visual pero con muchos menos puntos.

**Cómo funciona:**
1. Toma el primer y último punto del trazo y traza una línea entre ellos.
2. Encuentra el punto más alejado de esa línea.
3. Si está más lejos que un umbral (epsilon), se queda. Si no, se elimina.
4. Repite recursivamente en cada sub-segmento.

**Epsilon en el proyecto:** `1.5` píxeles — mantiene la fidelidad visual sin datos innecesarios.

### 7.3 Muestreo para la Goma de Borrar

**Problema:** "¿El círculo de la goma toca esta curva bezier?" No tiene solución algebraica simple para curvas cúbicas.

**Solución:** Muestrear la curva en 48 puntos equidistantes en `t`, y verificar si alguno está dentro del radio. Para la erasure misma: clasificar los 48 puntos como "dentro del círculo" o "fuera", agrupar los consecutivos "fuera" y reconstruirlos como nuevas curvas con Catmull-Rom.

---

## 8. Persistencia — localStorage

**¿Qué usamos?**
`localStorage`: almacenamiento del navegador que persiste entre sesiones, sin base de datos externa.

**¿Cómo lo usamos?**
```typescript
// Guardar
localStorage.setItem('raw-projects', JSON.stringify(projects))

// Cargar
const raw = JSON.parse(localStorage.getItem('raw-projects') ?? '[]')
```

El canvas de Fabric se serializa con `canvas.toJSON()` (genera un JSON con todos los objetos, sus propiedades y paths) y se deserializa con `canvas.loadFromJSON()`.

La miniatura del proyecto se genera con `canvas.toDataURL()`, que exporta el canvas como una imagen PNG en base64.

---

## 9. Google Fonts API

**¿Qué es?**
Una API de Google que sirve fuentes tipográficas gratuitas. Se integra mediante `@font-face` CSS dinámico.

**¿Cómo lo usamos?**
```typescript
// Cargamos la fuente dinámicamente
const link = document.createElement('link')
link.href = `https://fonts.googleapis.com/css2?family=${name}`
document.head.appendChild(link)

// Luego la usamos en Fabric
textObj.fontFamily = 'Roboto'
```

---

## 10. Coordenadas en Fabric.js — Un Detalle Importante

Fabric usa **dos sistemas de coordenadas** que hay que distinguir:

| Sistema | Qué es | Cuándo se usa |
|---------|--------|---------------|
| **Local** | Relativo al origen del objeto | Las coordenadas internas del SVG path (`path.path`) |
| **Escena (scene)** | Relativo al canvas, con zoom y pan aplicados | `e.scenePoint` del mouse, `getBoundingRect()` |

Para convertir de local a escena usamos:
```typescript
function localToCanvas(obj, lx, ly): fabric.Point {
  const po  = obj.pathOffset   // offset interno de Fabric para normalizar paths
  const mat = obj.calcTransformMatrix()  // posición + escala + rotación
  return fabric.util.transformPoint({ x: lx - po.x, y: ly - po.y }, mat)
}
```
Esto es crítico para la herramienta pluma (anchor editing) y para la goma de borrar.

---

## Resumen Visual

```
Usuario dibuja con el mouse
        ↓
Eventos de Fabric.js (mouse:move, mouse:down, mouse:up)
        ↓
Herramienta activa procesa el evento
  - Lápiz: acumula puntos → RDP → Catmull-Rom → fabric.Path
  - Pluma: bezier manual con anchors y handles
  - Goma: muestrea paths → clasifica puntos → reconstruye
        ↓
fabric.Canvas renderiza el resultado
        ↓
Al guardar: canvas.toJSON() → localStorage
Al cargar:  localStorage → canvas.loadFromJSON()
```
