const MAX_DIMENSION = 1920
const JPEG_QUALITY = 0.82
const COMPRESSIBLE = /^image\/(jpeg|png|webp)$/

/**
 * Telefon fotoğraflarını yüklemeden önce küçültür (genelde 4-8 MB → 300-600 KB).
 * Depolama alanını (ücretsiz planda sınırlı) korur ve mobil veride hızlı yükleme sağlar.
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

const RESIZABLE = /^image\/(jpeg|png|webp|gif)$/

/** Resmi en uzun kenarı `maxDimension` olacak şekilde JPEG'e çevirir (önizleme, profil fotoğrafı). Resim değilse null. */
export async function resizeImage(file: File, maxDimension: number, quality: number): Promise<Blob | null> {
  if (!RESIZABLE.test(file.type)) return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // Saydam PNG'ler JPEG'de siyah çıkmasın
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  } catch {
    return null
  }
}
