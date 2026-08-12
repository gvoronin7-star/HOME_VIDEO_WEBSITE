import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeJpeg } from './helpers/testApp';

/**
 * Finding S1: a slide caption reaching a shell meant remote code execution, and
 * captions are user input (`PUT /api/stories/:id/slides`).
 *
 * `child_process.spawn` is replaced so the two things that matter can be asserted
 * directly: that no shell is involved, and that caption text never appears in the
 * argument list. The module must be mocked rather than spied on — the helper binds
 * `spawn` with a named import at load time, which a property spy would not affect.
 */

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{
    cmd: string;
    args: string[];
    shell: unknown;
    cwd?: string;
    captionFile: string | null;
  }>,
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const { EventEmitter } = await import('events');
  const nodeFs = await import('fs');
  const nodePath = await import('path');

  return {
    ...actual,
    spawn: (cmd: string, args: string[], options: any) => {
      const cwd = options?.cwd;

      // Read the caption file now: renderVideo removes the temp directory in a
      // `finally` block, well before assertions run.
      let captionFile: string | null = null;
      const vfIndex = Array.isArray(args) ? args.indexOf('-vf') : -1;
      if (vfIndex !== -1 && cwd) {
        const match = /textfile=([^:]+)/.exec(String(args[vfIndex + 1]));
        if (match) {
          try {
            captionFile = nodeFs.readFileSync(nodePath.join(cwd, match[1]), 'utf8');
          } catch (error) {
            captionFile = `READ-FAILED: ${(error as Error).message}`;
          }
        }
      }

      calls.push({
        cmd,
        args: Array.isArray(args) ? [...args] : args,
        shell: options?.shell,
        cwd,
        captionFile,
      });

      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};

      setImmediate(() => {
        child.stderr.emit('data', Buffer.from('frame=1 time=00:00:01.00 bitrate=1\n'));
        const output = Array.isArray(args) ? args[args.length - 1] : null;
        if (output) {
          try {
            nodeFs.mkdirSync(nodePath.dirname(output), { recursive: true });
            nodeFs.writeFileSync(output, 'video');
          } catch {
            // Not fatal for these assertions.
          }
        }
        child.emit('close', 0);
      });

      return child;
    },
  };
});

/** Payloads that were each fatal, or at least corrupting, before the fix. */
const PAYLOADS = [
  'Обычный текст без сюрпризов.',
  `x'; touch /tmp/pwned; echo `,
  '$(touch /tmp/pwned)',
  '`touch /tmp/pwned`',
  'a && touch /tmp/pwned',
  'a | touch /tmp/pwned',
  'двоеточия: тут: и там:',
  `кавычки 'одинарные' и "двойные"`,
  'обратные\\слэши\\внутри',
  'проценты %{eif:1:d} подстановка',
  'многоточие… тире — пробелы',
];

let renderService: any;
let imagePath: string;

beforeAll(async () => {
  renderService = (await import('../src/services/render.service')).renderService;

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'family-cinema-render-'));
  // A space in the path: this used to split into two arguments (finding C2).
  imagePath = path.join(workDir, 'photo with space.jpg');
  fs.writeFileSync(imagePath, await makeJpeg());

  await renderService.renderVideo({
    slides: PAYLOADS.map((caption) => ({ imagePath, caption, durationSeconds: 3 })),
    audioPath: null,
    outputFileName: 'injection-test.mp4',
  });
});

describe('FFmpeg invocation (S1, C2)', () => {
  it('never uses a shell', () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.shell).toBeFalsy();
    }
  });

  it('always passes arguments as an array', () => {
    for (const call of calls) {
      expect(Array.isArray(call.args)).toBe(true);
    }
  });

  it('runs one process per slide plus the concat pass', () => {
    expect(calls).toHaveLength(PAYLOADS.length + 1);
  });

  it('never places caption text in the argument list', () => {
    const leaks: string[] = [];

    for (const call of calls.slice(0, PAYLOADS.length)) {
      for (const arg of call.args) {
        for (const payload of PAYLOADS) {
          if (String(arg).includes(payload)) leaks.push(`${payload} -> ${arg}`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });

  it('hands the caption to drawtext through a file, referenced by bare name', () => {
    for (const call of calls.slice(0, PAYLOADS.length)) {
      const filter = String(call.args[call.args.indexOf('-vf') + 1]);
      // A bare filename means no filtergraph path escaping is needed at all.
      expect(filter).toMatch(/^drawtext=textfile=caption_\d{3}\.txt/);
    }
  });

  it('preserves every caption verbatim in its file', () => {
    const normalise = (value: string) => value.replace(/\r?\n/g, ' ').trim();

    calls.slice(0, PAYLOADS.length).forEach((call, index) => {
      expect(call.captionFile).toBe(normalise(PAYLOADS[index]));
    });
  });

  it('keeps a path containing a space as a single argument (C2)', () => {
    const first = calls[0];
    expect(first.args[first.args.indexOf('-i') + 1]).toBe(imagePath);
  });

  it('renders no drawtext filter when the caption is empty', async () => {
    calls.length = 0;

    await renderService.renderVideo({
      slides: [{ imagePath, caption: '', durationSeconds: 2 }],
      audioPath: null,
      outputFileName: 'no-caption.mp4',
    });

    expect(calls[0].args).not.toContain('-vf');
  });

  it('renders only the first four slides in a preview (F3)', async () => {
    calls.length = 0;

    await renderService.renderPreview({
      slides: Array.from({ length: 9 }, (_, index) => ({
        imagePath,
        caption: `Кадр ${index + 1}`,
        durationSeconds: 2,
      })),
      audioPath: null,
      outputFileName: 'preview-limit.mp4',
    });

    // Four slide passes plus one concat.
    expect(calls).toHaveLength(5);
  });
});
