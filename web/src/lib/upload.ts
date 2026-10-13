const MAX_DIMENSION = 1920
const JPEG_QUALITY = 0.82
const COMPRESSIBLE = /^image\/(jpeg|png|webp)$/

/**
 * Telefon fotoğraflarını yüklemeden önce küçültür (genelde 4-8 MB → 300-600 KB).
 * Sunucu diskini korur ve mobil veride hızlı yükleme sağlar.
 */
export async function compressImage(file: File): Promise<File> {
  if (!COMPRESSIBLE.test(file.type) || file.size < 400 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/** Kayıt verisini (ekler dahil) PocketBase'in beklediği FormData'ya çevirir. */
export async function toFormData(data: Record<string, unknown>, files: File[] = [], fileField = 'attachments'): Promise<FormData> {
  const fd = new FormData()
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length === 0) fd.append(key, '')
      value.forEach((v) => fd.append(key, String(v)))
    } else if (typeof value === 'boolean') {
      fd.append(key, value ? 'true' : 'false')
    } else {
      fd.append(key, value === null ? '' : String(value))
    }
  }
  const compressed = await Promise.all(files.map(compressImage))
  // "+" soneki mevcut eklerin üzerine yazmadan yenilerini ekler.
  compressed.forEach((f) => fd.append(`${fileField}+`, f))
  return fd
}
