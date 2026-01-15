import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config';
import { logger } from './logger';

export class FileValidationService {
    /**
     * Validates a file buffer against size and type constraints
     * @param buffer The file content as a Buffer
     * @param fileName Optional file name for logging
     */
    async validate(buffer: Buffer, fileName?: string): Promise<{
        isValid: boolean;
        error?: string;
        mimeType?: string;
        extension?: string;
    }> {
        // Check file size
        if (buffer.length > config.storage.maxFileSize) {
            const maxSizeMB = Math.round(config.storage.maxFileSize / (1024 * 1024));
            return {
                isValid: false,
                error: `File size exceeds the limit of ${maxSizeMB}MB`,
            };
        }

        // Detect file type from magic bytes
        const type = await fileTypeFromBuffer(buffer);

        if (!type) {
            // Fallback for plain text files if allowed
            const isPlainText = buffer.slice(0, 100).every(b => b >= 32 || b === 10 || b === 13 || b === 9);
            if (isPlainText && config.storage.allowedMimeTypes.includes('text/plain')) {
                return {
                    isValid: true,
                    mimeType: 'text/plain',
                    extension: 'txt',
                };
            }
            return {
                isValid: false,
                error: 'Could not determine file type. File may be corrupt or of unknown format.',
            };
        }

        // Check if mime type is allowed
        if (!config.storage.allowedMimeTypes.includes(type.mime)) {
            logger.warn(`Rejected file with unsupported MIME type: ${type.mime} (${fileName || 'unknown'})`);
            return {
                isValid: false,
                error: `File type ${type.mime} is not supported.`,
            };
        }

        return {
            isValid: true,
            mimeType: type.mime,
            extension: type.ext,
        };
    }
}

export const fileValidationService = new FileValidationService();
