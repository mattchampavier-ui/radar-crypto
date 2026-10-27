/** Compression dans le téléphone avant envoi (section 9.1) : 1 600 px max, JPEG. */
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  if ('close' in bitmap) bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Compression impossible'))), 'image/jpeg', quality),
  )
}

/** Miniature 3:4 recadrée au centre, pour les listes. */
export async function makeThumb(file: Blob, width = 240): Promise<Blob> {
  const bitmap = await loadBitmap(file)
  const height = Math.round((width * 4) / 3)
  const ratio = width / height
  let sw = bitmap.width, sh = bitmap.height
  if (sw / sh > ratio) sw = sh * ratio
  else sh = sw / ratio
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, width, height)
  if ('close' in bitmap) bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Miniature impossible'))), 'image/jpeg', 0.75),
  )
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // Respecte l'orientation EXIF des photos iPhone.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* repli ci-dessous */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
