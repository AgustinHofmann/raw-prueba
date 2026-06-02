# RAW Design — Presentación del Bimestre

## ¿Qué es RAW Design?

RAW Design es una aplicación web de diseño vectorial y bocetado digital, similar en concepto a Figma o Adobe Illustrator, pero pensada como herramienta liviana y de código propio. Permite crear proyectos con un canvas de dibujo interactivo, aplicar múltiples herramientas de trazado, gestionar proyectos con carpetas y exportar el resultado.

---

## Integrantes y Roles Reales

| Integrante | Rol principal |
|------------|---------------|
| **Ramiro** | Diseño visual, identidad de marca, wireframes y bocetos del primer mockup |
| **Agustín** | Desarrollo frontend completo: lógica de la aplicación, herramientas del editor, pantallas, componentes de UI |
| **Aaron** | Base de datos y persistencia de datos de proyectos |

---

## Sprints del Bimestre

### Sprint 1 — Fundación y Diseño Visual

**Objetivo:** Sentar las bases del proyecto: definir qué se va a construir, cómo se va a ver, y tener un esqueleto funcional.

**Ramiro**
- Diseño del logo y la identidad visual de RAW Design
- Wireframes y pantallas de UI (Home, Editor, Onboarding)
- Bocetado del primer mockup funcional del editor

**Aaron**
- Diseño del esquema de base de datos para proyectos y carpetas
- Definición de la estructura de datos (campos de proyecto: id, nombre, miniatura, canvas JSON, fechas)

**Agustín**
- Setup inicial del proyecto con Vite + React 19 + TypeScript
- Estructura de navegación por rutas (`onboard → home → editor → export`)
- Pantalla de Onboarding y pantalla Home en versión inicial
- Integración de Fabric.js como motor de canvas

---

### Sprint 2 — Editor Básico y Herramientas Iniciales

**Objetivo:** Tener un editor funcional con las herramientas más esenciales: dibujar, seleccionar y deshacer.

**Ramiro**
- Refinamiento visual de componentes y pantallas según el mockup
- Ajustes de tipografía, colores y espaciado

**Aaron**
- Persistencia de proyectos: guardar y cargar estado del canvas desde la base de datos
- Serialización del canvas en formato JSON para almacenamiento

**Agustín**
- Herramienta **Lápiz** (dibujo libre con suavizado Catmull-Rom y reducción de puntos RDP)
- Herramienta **Selección** (mover, escalar, rotar objetos del canvas)
- Sistema de **historial** (undo/redo) para todas las acciones del editor
- Panel lateral de propiedades (color de trazo, grosor, relleno)

---

### Sprint 3 — Herramientas Avanzadas y Pantallas Completas

**Objetivo:** Construir las herramientas de trazado vectorial más complejas y completar el flujo de la app.

**Aaron**
- Gestión de múltiples proyectos: crear, renombrar, eliminar
- Estructura de carpetas para organizar proyectos
- Importación de proyectos existentes

**Agustín**
- Herramienta **Pluma (Pen)**: creación de paths bezier con control de anchors, curvas suaves y vértices angulares; cursores contextuales (agregar/eliminar punto)
- Herramienta **Curvatura**: edición suave de curvas con preservación de corners y auto-suavizado entre segmentos
- Herramienta **Relleno**: aplicar color de fill a paths cerrados
- Herramienta **Texto**: insertar y editar texto en el canvas con fuentes del sistema, Google Fonts y fuentes personalizadas importadas por el usuario
- Pantalla de **Exportación** del canvas
- Sistema de **pestañas** de proyectos abiertos (como en Figma)
- Sistema de **fuentes**: integración con Google Fonts API, fuentes del sistema, y carga de fuentes propias

---

### Sprint 4 — Pulido, Animaciones y Goma de Borrar

**Objetivo:** Terminar las funcionalidades pendientes, pulir la experiencia de usuario y añadir detalles visuales.

**Ramiro**
- Revisión y ajustes finales de diseño visual
- Validación de la experiencia de usuario en las pantallas principales

**Aaron**
- Ajustes finales de persistencia y rendimiento de base de datos
- Revisión de integridad de datos guardados

**Agustín**
- Herramienta **Goma de Borrar** por radio: borrado parcial de trazos mediante muestreo denso de curvas bezier, con previsualización circular del radio ajustable con el grosor
- **Anchor editing**: edición directa de puntos de control en trazos ya dibujados (mover anchors con drag)
- Cursores personalizados SVG para cada herramienta (pluma, curva, agregar/eliminar punto)
- Animaciones de UI: transiciones de página, efecto Spotlight, componente EasterEgg, TiltCard magnético, CountUp animado
- Guardado automático con miniatura del canvas como preview del proyecto
- Toast notifications para feedback de acciones (guardado, eliminación)
- Soporte de clips (clip paths) para limitar el área de dibujo al formato del proyecto

---

## Funcionalidades Clave Entregadas

- **7 herramientas de edición**: selección, lápiz, pluma, curvatura, goma, relleno, texto
- **Historial ilimitado** de deshacer/rehacer
- **Gestión de proyectos**: crear, renombrar, eliminar, carpetas, importar
- **Sistema de fuentes**: sistema, Google Fonts, fuentes del usuario
- **Exportación** del canvas
- **Pestañas** de proyectos múltiples abiertos simultáneamente
- **Guardado automático** con previsualización en miniatura
- **UI animada** con transiciones y efectos visuales

---

## Estado Actual

La aplicación está en versión funcional. El editor permite crear ilustraciones vectoriales completas con herramientas de nivel profesional. La persistencia de datos mantiene los proyectos entre sesiones. El flujo completo (onboarding → home → editor → exportar) está operativo.
