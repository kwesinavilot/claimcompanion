import sharp from 'sharp';
export interface QualityResult { usable: boolean; issues: string[]; width?: number; height?: number; brightness?: number; laplacian_variance?: number }
export async function quality(bytes: Buffer): Promise<QualityResult> {
  try {
    const image = sharp(bytes, { limitInputPixels: 24000000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) return { usable: false, issues: ['Use a single JPEG, PNG or WebP photo.'] };
    const { data, info } = await image.rotate().flatten({ background: '#ffffff' }).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let total = 0, glare = 0;
    for (const value of data) { total += value; if (value >= 250) glare++; }
    const brightness = total / data.length;
    let sum = 0, squares = 0, count = 0;
    for (let y = 1; y < info.height - 1; y++) for (let x = 1; x < info.width - 1; x++) {
      const i = y * info.width + x;
      const value = data[i - 1] + data[i + 1] + data[i - info.width] + data[i + info.width] - 4 * data[i];
      sum += value; squares += value * value; count++;
    }
    const variance = count ? squares / count - (sum / count) ** 2 : 0;
    const issues: string[] = [];
    if ((metadata.width ?? 0) < 320 || (metadata.height ?? 0) < 240) issues.push('Photo is too small. Retake at a higher resolution.');
    if (brightness < 25) issues.push('Photo is too dark. Retake in better light.');
    if (brightness > 240 || glare / data.length > 0.85) issues.push('Photo is washed out. Retake without glare.');
    if (variance < 15) issues.push('Photo has too little sharp detail. Hold the camera steady and retake.');
    return { usable: !issues.length, issues, width: metadata.width, height: metadata.height, brightness: Math.round(brightness), laplacian_variance: Math.round(variance) };
  } catch { return { usable: false, issues: ['This photo could not be read. Retake or choose a JPEG, PNG or WebP photo.'] }; }
}
export function analysisImage(bytes: Buffer) { return sharp(bytes, { limitInputPixels: 24000000 }).rotate().flatten({ background: '#ffffff' }).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); }
