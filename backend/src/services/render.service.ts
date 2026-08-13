import { logger } from '../utils/logger';
import { config } from '../config';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { escapeFilterPath, runFfmpeg } from './ffmpeg.helper';

interface RenderOptions {
  slides: Array<{
    imagePath: string;
    caption: string;
    durationSeconds: number;
  }>;
  audioPath: string | null;
  outputFileName: string;
}

export class RenderService {
  /**
   * Render a video from slides + audio using FFmpeg.
   * Creates a temporary directory, builds the FFmpeg command, and generates MP4.
   */
  async renderVideo(options: RenderOptions): Promise<{ videoUrl: string; durationMs: number }> {
    const { slides, audioPath, outputFileName } = options;
    const tempDir = path.resolve(config.storage.path, 'temp', uuidv4());
    const outputPath = path.resolve(config.storage.path, 'videos', outputFileName);

    await fs.mkdir(tempDir, { recursive: true });

    try {
      // Prepare slides with temporary files
      const slideFiles = await this.prepareSlides(slides, tempDir);

      // Create FFmpeg concat file
      const concatFile = path.join(tempDir, 'slides.txt');
      const concatContent = slideFiles
        .map((file) => `file '${file.replace(/\\/g, '/')}'`)
        .join('\n');
      await fs.writeFile(concatFile, concatContent);

      const duration = slides.reduce((sum, s) => sum + s.durationSeconds, 0);

      // Argument array, not a command string: nothing here goes through a shell,
      // so no value needs quoting or escaping.
      const args = [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatFile,
        ...(audioPath ? ['-i', audioPath] : []),
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-r',
        '30',
        '-pix_fmt',
        'yuv420p',
        ...(audioPath ? ['-c:a', 'aac', '-b:a', '128k', '-shortest'] : []),
        '-movflags',
        '+faststart',
        outputPath,
      ];

      logger.info({ duration, hasAudio: Boolean(audioPath) }, 'Rendering video with FFmpeg');

      await runFfmpeg(args, {
        timeout: 300000, // 5 min timeout
        onProgress: (progress, log) => {
          logger.debug({ progress, log }, 'FFmpeg render progress');
        },
      });

      const videoUrl = `/uploads/videos/${outputFileName}`;
      logger.info({ videoUrl, duration }, 'Video rendered successfully');

      return { videoUrl, durationMs: duration * 1000 };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Video rendering failed');
      throw new Error(`Video rendering failed: ${error.message}`, { cause: error });
    } finally {
      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Generate a short preview (first 3-4 slides).
   *
   * Honours the caller's `outputFileName` so re-previewing a story overwrites its
   * own file instead of leaving a new one behind on every click.
   */
  async renderPreview(options: RenderOptions): Promise<{ videoUrl: string }> {
    const result = await this.renderVideo({
      ...options,
      slides: options.slides.slice(0, 4),
      outputFileName: options.outputFileName || `preview-${uuidv4()}.mp4`,
    });

    return { videoUrl: result.videoUrl };
  }

  /**
   * Prepare slides: resize images and create individual video files for each slide.
   */
  private async prepareSlides(
    slides: Array<{ imagePath: string; caption: string; durationSeconds: number }>,
    tempDir: string,
  ): Promise<string[]> {
    const slideFiles: string[] = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const index = i.toString().padStart(3, '0');
      const outputFile = path.join(tempDir, `slide_${index}.mp4`);
      const caption = (slide.caption || '').replace(/\r?\n/g, ' ').trim();

      const args = ['-y', '-loop', '1', '-i', slide.imagePath];

      if (caption) {
        // The caption goes into a file and `drawtext` reads it from there. This is
        // the crux of the fix: user text never appears in the argument list or in
        // the filtergraph, so there is no syntax for it to break out of — neither
        // shell metacharacters nor filtergraph separators like ':' can matter.
        const captionFile = `caption_${index}.txt`;
        await fs.writeFile(path.join(tempDir, captionFile), caption, 'utf8');

        // Only our own values are interpolated below, all of them numeric or from
        // configuration. `cwd` is tempDir, so the textfile is a bare filename and
        // needs no path escaping at all.
        const fontFile = config.ffmpeg.fontFile
          ? `:fontfile=${escapeFilterPath(config.ffmpeg.fontFile)}`
          : '';

        args.push(
          '-vf',
          `drawtext=textfile=${captionFile}${fontFile}` +
            ':fontsize=28:fontcolor=white:box=1:boxcolor=black@0.4' +
            ':boxborderw=10:x=(w-text_w)/2:y=h-text_h-50',
        );
      }

      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-t',
        String(slide.durationSeconds),
        '-r',
        '30',
        '-pix_fmt',
        'yuv420p',
        '-s',
        '1920x1080',
        outputFile,
      );

      // cwd lets drawtext reference the caption file by name.
      await runFfmpeg(args, { timeout: 120000, cwd: tempDir });

      slideFiles.push(outputFile);
    }

    return slideFiles;
  }
}

export const renderService = new RenderService();
