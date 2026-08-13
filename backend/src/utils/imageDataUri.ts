import fs from 'fs/promises';

/**
 * Reads a slide image and returns it as a base64 data URI, embeddable directly
 * in a vision-capable chat message. Every slide image is normalised to JPEG by
 * `sharp` at upload time (`story.controller.ts` `create()`), so the mime type
 * is fixed rather than sniffed from the file.
 */
export async function toImageDataUri(absolutePath: string): Promise<string> {
  const buffer = await fs.readFile(absolutePath);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}
