import PDFDocument from 'pdfkit';
import { storageService } from './storage.service';
import { logger } from '../utils/logger';

interface PDFSlide {
  imageUrl: string;
  imagePath: string;
  caption: string;
  orderIndex: number;
}

interface PDFOptions {
  title: string;
  templateName: string;
  slides: PDFSlide[];
  qrCodePath?: string;
}

export class PDFService {
  /**
   * Generate a PDF album from story slides.
   */
  async generatePDFAlbum(options: PDFOptions): Promise<{ pdfUrl: string; key: string }> {
    const { title, templateName, slides, qrCodePath } = options;

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      info: {
        Title: title,
        Author: 'Family Cinema',
        Subject: templateName,
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk) => buffers.push(chunk));

    return new Promise((resolve, reject) => {
      doc.on('end', async () => {
        try {
          const pdfBuffer = Buffer.concat(buffers);
          const { url, key } = await storageService.saveFile(
            pdfBuffer,
            `${title.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.pdf`,
            'pdfs'
          );
          logger.info({ pdfUrl: url }, 'PDF album generated');
          resolve({ pdfUrl: url, key });
        } catch (error: any) {
          reject(error);
        }
      });

      doc.on('error', reject);

      // Title page
      doc.fontSize(36).font('Helvetica-Bold');
      doc.text(title, { align: 'center' });
      doc.moveDown();
      doc.fontSize(20).font('Helvetica');
      doc.text(templateName, { align: 'center' });
      doc.addPage();

      // Slides
      for (const slide of slides) {
        try {
          if (slide.imagePath) {
            // Add image to PDF
            const imgWidth = 600;
            const imgHeight = 400;
            const pageWidth = doc.page.width;
            const x = (pageWidth - imgWidth) / 2;

            doc.image(slide.imagePath, x, 50, {
              width: imgWidth,
              height: imgHeight,
              fit: [imgWidth, imgHeight],
              align: 'center',
              valign: 'center',
            });

            // Add caption
            doc.moveDown(8);
            doc.fontSize(16).font('Helvetica');
            doc.text(
              `${slide.orderIndex + 1}. ${slide.caption}`,
              { align: 'center', width: pageWidth - 100 }
            );
          }
        } catch (error: any) {
          logger.warn({ error: error.message }, 'Failed to add image to PDF');
          doc.text(`[Фото ${slide.orderIndex + 1}]`, { align: 'center' });
          doc.text(slide.caption, { align: 'center' });
        }

        // Add new page if not last
        if (slide.orderIndex < slides.length - 1) {
          doc.addPage();
        }
      }

      // QR code page
      if (qrCodePath) {
        doc.addPage();
        doc.fontSize(24).font('Helvetica-Bold');
        doc.text('Смотреть видео', { align: 'center' });
        doc.moveDown(2);
        try {
          doc.image(qrCodePath, {
            fit: [200, 200],
            align: 'center',
            valign: 'center',
          });
        } catch (error: any) {
          logger.warn('Failed to add QR code to PDF');
        }
      }

      doc.end();
    });
  }
}

export const pdfService = new PDFService();