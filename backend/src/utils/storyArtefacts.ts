/**
 * Every file a story owns, as storage keys or public URLs.
 *
 * Shared by the delete endpoint and the retention job so the two can never drift:
 * a new artefact added in one place would otherwise be forgotten in the other and
 * silently accumulate on disk. `storageService.deleteFile` accepts either form.
 */
export function collectStoryArtefacts(story: {
  id: string;
  videoUrl?: string | null;
  pdfUrl?: string | null;
  qrCodeUrl?: string | null;
  slides?: Array<{ imageKey?: string | null }> | null;
}): { required: string[]; optional: string[] } {
  const required = [
    ...(story.slides || []).map((slide) => slide.imageKey),
    story.videoUrl,
    story.pdfUrl,
    story.qrCodeUrl,
  ].filter((value): value is string => Boolean(value));

  // A preview exists only if the user asked for one, so its absence is normal and
  // must not be reported as a missing file.
  const optional = [`videos/preview-${story.id}.mp4`];

  return { required, optional };
}
