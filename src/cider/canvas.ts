import type { AnyCanvas, AnyCanvasContext } from "./types";

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function getCanvasContext(canvas: AnyCanvas, options?: CanvasRenderingContext2DSettings): AnyCanvasContext {
  const context = canvas.getContext("2d", options) as AnyCanvasContext | null;
  if (!context) {
    throw new Error("Could not initialize canvas");
  }
  return context;
}

export async function canvasToPngBlob(canvas: AnyCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Could not encode canvas as PNG"));
    }, "image/png");
  });
}

export async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });
    } catch {
      throw new Error("Could not decode PNG image");
    }
  }

  return loadImageElement(file);
}

export function closeBitmap(image: ImageBitmap | HTMLImageElement | undefined): void {
  if (image && "close" in image && typeof image.close === "function") {
    image.close();
  }
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.addEventListener(
      "load",
      () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not decode PNG image"));
      },
      { once: true },
    );

    image.src = objectUrl;
  });
}
