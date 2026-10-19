// Shrinks photos before upload: max 1600 px, JPEG ~80%. Keeps AI requests small and fast.
const MAX_SIDE = 1600;

export async function prepareImage(blob) {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
    return out ?? blob;
  } catch {
    return blob; // unsupported format: send as is (server accepts jpeg/png/webp)
  }
}
