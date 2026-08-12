import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

/**
 * Actual duration of a media file, in seconds, via ffprobe.
 *
 * Needed to synchronise slides with narration: the caption duration must equal
 * the length of its spoken line, otherwise speech is cut off mid-sentence or the
 * slide sits in silence. Arguments are passed as an array (no shell), so paths
 * with spaces are safe.
 */
export async function probeDurationSeconds(filePath: string): Promise<number> {
  const probePath = config.ffmpeg.probePath || 'ffprobe';

  const { stdout } = await execFileAsync(
    probePath,
    [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { timeout: 15000 }
  );

  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe returned an unusable duration for ${filePath}: "${stdout.trim()}"`);
  }

  return seconds;
}

/**
 * Concatenate audio files into one track, re-encoding to AAC.
 *
 * Re-encoding rather than `-c copy` is deliberate: stream copy across separately
 * encoded MP3 files produces gaps and broken timestamps.
 */
export async function concatAudioFiles(inputPaths: string[], outputPath: string): Promise<void> {
  if (inputPaths.length === 0) {
    throw new Error('concatAudioFiles called with no inputs');
  }

  const ffmpegPath = config.ffmpeg.path || 'ffmpeg';
  const fs = await import('fs/promises');
  const path = await import('path');

  // The concat demuxer reads a list file; single quotes in paths must be escaped.
  const listPath = `${outputPath}.concat.txt`;
  const listBody = inputPaths
    .map((p) => `file '${path.resolve(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(listPath, listBody, 'utf8');

  try {
    await execFileAsync(
      ffmpegPath,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath,
       '-c:a', 'aac', '-b:a', '128k', outputPath],
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
    );
  } finally {
    await fs.rm(listPath, { force: true }).catch(() => {});
  }
}

/**
 * Escape a filesystem path for use *inside* an FFmpeg filtergraph.
 *
 * Filtergraph syntax is not shell syntax: `:` separates filter options and `\`
 * escapes, so a Windows path like `C:\fonts\x.ttf` would be misparsed. Forward
 * slashes are accepted on every platform, so normalise then escape the colon.
 * Only ever used on paths this service controls — never on user text.
 */
export function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

/**
 * Run FFmpeg with an argument array and progress streaming from stderr.
 *
 * Arguments are passed as an array with `shell: false` — deliberately. The previous
 * implementation concatenated a command string and ran it through a shell, which
 * made every value interpolated into it (notably slide captions, which users
 * control through `PUT /stories/:id/slides`) a path to arbitrary command
 * execution. With no shell there is nothing to escape and nothing to inject:
 * each array element reaches FFmpeg as one literal argument, spaces and all.
 *
 * @param options.cwd resolve relative paths against this directory, which lets
 *   callers reference files by bare filename and avoid filtergraph path escaping.
 */
export function runFfmpeg(
  args: string[],
  options: {
    timeout?: number;
    cwd?: string;
    onProgress?: (progress: number, log: string) => void;
  } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const cmd = config.ffmpeg.path || 'ffmpeg';

    logger.info({ cmd, args }, 'Starting FFmpeg process');

    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      cwd: options.cwd,
    });

    let stdout = '';
    let stderr = '';
    let progress = 0;
    let startTime = Date.now();

    const timeoutMs = options.timeout || 300000;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`FFmpeg timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
    });

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;

      // Log progress to console/logger for monitoring
      if (chunk.includes('time=')) {
        const timeMatch = chunk.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseFloat(timeMatch[3]);
          const elapsedSeconds = hours * 3600 + minutes * 60 + seconds;
          const elapsedMs = Date.now() - startTime;
          const rate = elapsedMs > 0 ? elapsedSeconds / (elapsedMs / 1000) : 1;
          progress = Math.min(Math.round((elapsedSeconds / (elapsedSeconds + 30)) * 100), 99);

          if (options.onProgress) {
            options.onProgress(progress, chunk.trim());
          }

          logger.debug({ progress, elapsedSeconds, rate }, 'FFmpeg progress');
        }
      }

      // Log the last few lines of stderr for debugging
      const lines = chunk.trim().split('\n');
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1].trim();
        if (lastLine && lastLine.length > 0) {
          logger.debug({ line: lastLine }, 'FFmpeg stderr');
        }
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        logger.info({ progress }, 'FFmpeg process completed successfully');
        resolve({ stdout, stderr });
      } else {
        logger.error({ code, stderr: stderr.slice(-1000) }, 'FFmpeg process exited with error');
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      logger.error({ error: err.message }, 'FFmpeg process error');
      reject(err);
    });
  });
}
