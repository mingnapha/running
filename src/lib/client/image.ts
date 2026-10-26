"use client";

/**
 * บีบอัดรูปบนมือถือก่อนอัปโหลด: ย่อด้านยาวไม่เกิน 1600px แล้ว encode ใหม่เป็น WebP
 * การวาดลง canvas แล้ว encode ใหม่ = ตัด EXIF ทั้งหมด (รวมพิกัด GPS) ออกโดยอัตโนมัติ
 */
export const MAX_EDGE = 1600;
const TARGET_BYTES = 900 * 1024;

export async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) return file; // เบราว์เซอร์อ่านไม่ได้ (เช่น HEIC บางรุ่น) → ส่งไฟล์เดิม server ตรวจชนิด/ขนาดอีกที

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    // Safari เก่าไม่รองรับ WebP → ได้ PNG กลับมา ใช้ JPEG แทน
    const usable = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (usable && (usable.size <= TARGET_BYTES || quality === 0.55)) {
      const ext = usable.type === "image/webp" ? "webp" : "jpg";
      return new File([usable], `evidence.${ext}`, { type: usable.type });
    }
  }
  return file;
}
