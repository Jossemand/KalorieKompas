// Skalerer billeder ned og gemmer dem som JPEG før upload – telefonbilleder fylder ofte flere MB
const MAX_SIZE = 1280;
const QUALITY = 0.82;

export async function prepareImage(file){
  if (!file.type.startsWith("image/")) throw new Error("Filen er ikke et billede");

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error("Billedformatet understøttes ikke – vælg et JPEG- eller PNG-billede");
    }

    // Moderne browsere drejer selv billedet efter kameraets EXIF-orientering
    const scale = Math.min(1, MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // gennemsigtige PNG'er får hvid baggrund i stedet for sort
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) throw new Error("Billedet kunne ikke behandles");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
