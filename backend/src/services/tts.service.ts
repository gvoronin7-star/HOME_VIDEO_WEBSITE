import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { logger } from '../utils/logger';
import { config } from '../config';
import { concatAudioFiles, probeDurationSeconds } from './ffmpeg.helper';

interface TTSOptions {
  text: string;
  voice: 'male' | 'female';
  emotion?: string;
}

export interface SlideNarration {
  /** Index of the slide this line belongs to. */
  orderIndex: number;
  /** Absolute path of the synthesised audio for this slide. */
  audioPath: string;
  /** Measured length of the line — the slide must be shown for exactly this long. */
  durationSeconds: number;
}

export interface SlideNarrationResult {
  slides: SlideNarration[];
  /** Single track for the video render, or null when nothing could be synthesised. */
  audioPath: string | null;
  totalDurationSeconds: number;
  /** False when a silent placeholder was produced instead of real speech. */
  isSpeech: boolean;
}

/** Per-request input limit of the OpenAI-compatible speech endpoint. */
const MAX_INPUT_CHARS = 4096;

/**
 * Voices offered by the endpoint, mapped from the product's own vocabulary
 * (gender + mood) so callers never deal with provider-specific names.
 */
const VOICE_MAP: Record<string, string> = {
  // Story tones (warm / ironic / solemn) and voice-profile moods (warm / calm)
  // are both routed here, so every value either side can produce is covered.
  'female:warm': 'nova',
  'female:calm': 'shimmer',
  'female:solemn': 'sage',
  'female:ironic': 'coral',
  'male:warm': 'onyx',
  'male:calm': 'echo',
  'male:solemn': 'ash',
  'male:ironic': 'fable',
};

const VOICE_FALLBACK: Record<'male' | 'female', string> = {
  female: 'nova',
  male: 'onyx',
};

/** Delivery hints. Honoured by gpt-4o-mini-tts; ignored by tts-1 / tts-1-hd. */
const INSTRUCTION_MAP: Record<string, string> = {
  warm: 'Читай тепло и доверительно, как близкому человеку. Спокойный темп, живые интонации, без пафоса.',
  calm: 'Читай спокойно и размеренно, негромко, с мягкими интонациями.',
  solemn: 'Читай торжественно и с достоинством, чуть медленнее обычного, выделяя важные слова.',
  ironic: 'Читай с лёгкой доброй иронией и улыбкой в голосе, не переигрывая.',
};

export class TTSService {
  private client: OpenAI | null = null;

  constructor() {
    if (config.tts.service === 'openai' && config.openai.apiKey) {
      this.client = new OpenAI({
        apiKey: config.openai.apiKey,
        // Empty baseUrl => official OpenAI. ProxyAPI and other OpenAI-compatible
        // gateways only need this one setting.
        ...(config.openai.baseUrl ? { baseURL: config.openai.baseUrl } : {}),
        // Two retries per line, multiplied across every slide, turns one failing
        // story into dozens of requests. A failed line degrades to silence for
        // that slide instead, which is both cheaper and more predictable.
        maxRetries: 1,
      });
      logger.info(
        { model: config.tts.model, endpoint: config.openai.baseUrl || 'api.openai.com' },
        'TTS: speech synthesis enabled',
      );
    } else {
      logger.warn(
        { service: config.tts.service, hasKey: Boolean(config.openai.apiKey) },
        'TTS: no API key configured — video will be rendered with a SILENT track',
      );
    }
  }

  /** True when real speech can be produced. */
  get isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Synthesise one line per slide and measure each line's real length.
   *
   * Narration is produced per slide rather than as one blob so that each slide's
   * display duration can be set to the length of its own line. Without this the
   * caption duration comes from the template (a fixed 3-5s) while the speech is
   * an unrelated length — the voice gets cut off or the slide sits in silence.
   */
  async synthesizeSlides(
    slides: Array<{ orderIndex: number; caption: string; durationSeconds: number }>,
    voice: 'male' | 'female',
    emotion?: string,
  ): Promise<SlideNarrationResult> {
    const narrations: SlideNarration[] = [];

    if (!this.isAvailable) {
      // Not an error: the constructor already reported the missing key once.
      // Keep the template timings and let the caller see isSpeech === false.
      logger.info(
        { slides: slides.length },
        'TTS: synthesis unavailable — producing a silent track for every slide',
      );
    }

    for (const slide of slides) {
      const caption = (slide.caption || '').trim();

      if (!caption || !this.isAvailable) {
        // Nothing to say, or nothing to say it with — hold the slide in silence.
        const silence = await this.writeSilence(slide.durationSeconds);
        narrations.push({
          orderIndex: slide.orderIndex,
          audioPath: silence,
          durationSeconds: slide.durationSeconds,
        });
        continue;
      }

      let audioPath: string;
      try {
        audioPath = await this.synthesizeToFile(caption, voice, emotion);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(
          { orderIndex: slide.orderIndex, error: message },
          'TTS: slide synthesis failed, substituting silence for this slide',
        );
        const silence = await this.writeSilence(slide.durationSeconds);
        narrations.push({
          orderIndex: slide.orderIndex,
          audioPath: silence,
          durationSeconds: slide.durationSeconds,
        });
        continue;
      }

      // Measuring is a separate failure from synthesising. If ffprobe is missing
      // the speech is still perfectly good — estimate its length rather than
      // throwing away audio we already paid for.
      let seconds: number;
      try {
        seconds = await probeDurationSeconds(audioPath);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        seconds = this.estimateDurationSeconds(caption);
        logger.warn(
          { orderIndex: slide.orderIndex, error: message, estimatedSeconds: seconds },
          'TTS: could not measure audio (is ffprobe installed?) — keeping speech, using an estimate',
        );
      }

      narrations.push({
        orderIndex: slide.orderIndex,
        audioPath,
        // The narration must never be clipped, so its length is the lower bound —
        // plus a breath so slides do not cut over each other. The slide's own
        // duration acts as a *minimum* hold time, which is what makes manual
        // duration edits meaningful: "show this photo longer" is honoured, while
        // "show it for 2s" cannot truncate a 7-second line.
        durationSeconds: Math.max(Math.ceil(seconds + 0.4), 2, slide.durationSeconds),
      });
    }

    if (narrations.length === 0) {
      return { slides: [], audioPath: null, totalDurationSeconds: 0, isSpeech: false };
    }

    narrations.sort((a, b) => a.orderIndex - b.orderIndex);
    const totalDurationSeconds = narrations.reduce((sum, n) => sum + n.durationSeconds, 0);

    // One track for the render step, in slide order.
    const trackPath = path.join(this.audioDir(), `story-track-${crypto.randomUUID()}.m4a`);

    try {
      await concatAudioFiles(
        narrations.map((n) => n.audioPath),
        trackPath,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'TTS: failed to concatenate narration track');
      return { slides: narrations, audioPath: null, totalDurationSeconds, isSpeech: false };
    }

    return {
      slides: narrations,
      audioPath: trackPath,
      totalDurationSeconds,
      isSpeech: this.isAvailable,
    };
  }

  /**
   * Single-shot synthesis. Kept for callers that need one file for a whole text;
   * prefer `synthesizeSlides` in the render pipeline.
   */
  async synthesizeSpeech(options: TTSOptions): Promise<{ audioUrl: string; durationMs: number }> {
    const { text, voice, emotion } = options;

    if (!this.client) {
      const durationMs = Math.max(text.length * 60, 2000);
      const filePath = await this.writeSilence(durationMs / 1000);
      return { audioUrl: `/uploads/audio/${path.basename(filePath)}`, durationMs };
    }

    const filePath = await this.synthesizeToFile(text, voice, emotion);
    const durationSeconds = await probeDurationSeconds(filePath).catch(() =>
      this.estimateDurationSeconds(text),
    );

    return {
      audioUrl: `/uploads/audio/${path.basename(filePath)}`,
      durationMs: Math.round(durationSeconds * 1000),
    };
  }

  // ===== Internals =====

  private audioDir(): string {
    return path.resolve(config.storage.path, 'audio');
  }

  /**
   * Fallback length estimate when the file cannot be probed.
   * Russian narration at a calm pace runs roughly 14 characters per second.
   */
  private estimateDurationSeconds(text: string): number {
    return Math.max(text.length / 14, 1.5);
  }

  private resolveVoice(voice: 'male' | 'female', emotion?: string): string {
    const key = `${voice}:${(emotion || 'warm').toLowerCase()}`;
    return VOICE_MAP[key] || VOICE_FALLBACK[voice];
  }

  /**
   * Synthesise text to a file, reusing an existing one when the same text, voice
   * and model were requested before. Caching matters on a demo: regenerating a
   * story otherwise pays the provider again for identical lines.
   */
  private async synthesizeToFile(
    text: string,
    voice: 'male' | 'female',
    emotion?: string,
  ): Promise<string> {
    if (!this.client) throw new Error('TTS client is not configured');

    let input = text;
    if (input.length > MAX_INPUT_CHARS) {
      logger.warn(
        { length: input.length, limit: MAX_INPUT_CHARS },
        'TTS: input exceeds the provider limit, truncating',
      );
      input = input.slice(0, MAX_INPUT_CHARS);
    }

    const resolvedVoice = this.resolveVoice(voice, emotion);
    const format = config.tts.format;
    const hash = crypto
      .createHash('sha256')
      .update(`${config.tts.model}|${resolvedVoice}|${emotion || ''}|${input}`)
      .digest('hex')
      .slice(0, 32);

    await fs.mkdir(this.audioDir(), { recursive: true });
    const filePath = path.join(this.audioDir(), `tts-${hash}.${format}`);

    try {
      const existing = await fs.stat(filePath);
      if (existing.size > 0) {
        logger.debug({ hash }, 'TTS: reusing cached audio');
        return filePath;
      }
    } catch {
      // Not cached yet — synthesise below.
    }

    const instructions = INSTRUCTION_MAP[(emotion || 'warm').toLowerCase()];
    const supportsInstructions = config.tts.model.includes('gpt-4o');

    const response = await this.client.audio.speech.create({
      model: config.tts.model,
      voice: resolvedVoice,
      input,
      response_format: format,
      ...(supportsInstructions && instructions ? { instructions } : {}),
    } as Parameters<OpenAI['audio']['speech']['create']>[0]);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error('Speech endpoint returned an empty body');
    }

    await fs.writeFile(filePath, buffer);
    logger.info(
      { voice: resolvedVoice, chars: input.length, bytes: buffer.length },
      'TTS: line synthesised',
    );

    return filePath;
  }

  /** Write a silent placeholder of the given length and return its path. */
  private async writeSilence(durationSeconds: number): Promise<string> {
    const seconds = Math.max(durationSeconds, 1);
    const buffer = this.generateSilentAudio(seconds * 1000);

    await fs.mkdir(this.audioDir(), { recursive: true });
    const filePath = path.join(this.audioDir(), `silence-${seconds}s.wav`);
    await fs.writeFile(filePath, buffer);

    return filePath;
  }

  /** Minimal PCM WAV of silence — placeholder when synthesis is unavailable. */
  private generateSilentAudio(durationMs: number): Buffer {
    const sampleRate = 22050;
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = Math.floor((sampleRate * durationMs) / 1000);
    const dataSize = numSamples * numChannels * (bitsPerSample / 8);

    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
    buffer.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
  }

  /** Split long text on sentence boundaries to fit the per-request limit. */
  splitTextIntoChunks(text: string, maxChunkSize: number = MAX_INPUT_CHARS): string[] {
    const chunks: string[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    let currentChunk = '';
    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}

export const ttsService = new TTSService();
