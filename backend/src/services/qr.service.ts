import QRCode from 'qrcode';
import { storageService } from './storage.service';
import { logger } from '../utils/logger';

export class QRService {
  /**
   * Generate a QR code image from a URL.
   */
  async generateQRCode(
    data: string,
    options?: {
      width?: number;
      margin?: number;
      color?: { dark?: string; light?: string };
    },
  ): Promise<{ imageUrl: string; key: string }> {
    try {
      const qrBuffer = await QRCode.toBuffer(data, {
        type: 'png',
        width: options?.width || 400,
        margin: options?.margin || 2,
        color: {
          dark: options?.color?.dark || '#000000',
          light: options?.color?.light || '#ffffff',
        },
      });

      const { url, key } = await storageService.saveFile(qrBuffer, 'qrcode.png', 'qrcodes');

      logger.info({ data: data.substring(0, 50) }, 'QR code generated');
      return { imageUrl: url, key };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to generate QR code');
      throw new Error('QR code generation failed', { cause: error });
    }
  }

  /**
   * Generate a QR code as SVG string.
   */
  async generateQRCodeSVG(data: string): Promise<string> {
    try {
      const svgString = await QRCode.toString(data, {
        type: 'svg',
        width: 400,
        margin: 2,
      });
      return svgString;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to generate QR code SVG');
      throw new Error('QR code SVG generation failed', { cause: error });
    }
  }
}

export const qrService = new QRService();
