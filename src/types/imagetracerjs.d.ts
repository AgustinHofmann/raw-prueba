// imagetracerjs no publica tipos propios. Declaramos la superficie mínima que
// usamos (vectorizar un ImageData a SVG) para no tener que apagar el chequeo
// de tipos con un `any` suelto o `skipLibCheck`.
declare module 'imagetracerjs' {
  interface ImageTracerOptions {
    numberofcolors?: number
    ltres?: number
    qtres?: number
    pathomit?: number
    strokewidth?: number
    scale?: number
    blurradius?: number
    blurdelta?: number
    [option: string]: number | string | boolean | undefined
  }

  const ImageTracer: {
    imagedataToSVG(imageData: ImageData, options?: ImageTracerOptions | string): string
  }

  export default ImageTracer
}
