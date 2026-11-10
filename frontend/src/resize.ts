// 업로드 전 사진 축소. 실패하거나 이득이 없으면 원본을 그대로 돌려준다.

const MAX_EDGE = 2000 // 서버가 분석에 쓰는 1568px 보다 여유 있게
const QUALITY = 0.85

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

export async function shrinkImage(file: File): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    // <img> 로 그리면 브라우저가 EXIF 회전을 적용해 준다
    const img = await loadImage(url)
    const w = img.naturalWidth
    const h = img.naturalHeight
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
    if (scale === 1 && file.type === 'image/jpeg') return file // 이미 충분히 작음

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob || blob.size >= file.size) return file

    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
