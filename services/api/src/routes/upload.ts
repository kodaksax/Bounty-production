import { FastifyInstance, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedRequest, authMiddleware } from '../middleware/auth';
import { fileValidationService } from '../services/file-validation-service';
import { logger } from '../services/logger';
import { malwareScannerService } from '../services/malware-scanner-service';
import { storageService } from '../services/storage-service';

export async function registerUploadRoutes(fastify: FastifyInstance) {
    fastify.post('/api/upload', {
        preHandler: authMiddleware,
    }, async (request: AuthenticatedRequest, reply: FastifyReply) => {
        try {
            const data = await (request as any).file();
            if (!data) {
                return reply.code(400).send({ error: 'No file uploaded' });
            }

            const buffer = await data.toBuffer();
            const fileName = data.filename;
            const bucket = (request.query as any).bucket || 'attachments';

            logger.info(`Processing upload request: ${fileName} to bucket: ${bucket}`);

            // 1. Validate file size and type (magic bytes)
            const validationResult = await fileValidationService.validate(buffer, fileName);
            if (!validationResult.isValid) {
                return reply.code(400).send({ error: validationResult.error });
            }

            // 2. Malware Scanning
            const scanResult = await malwareScannerService.scanBuffer(buffer);
            if (!scanResult.isSafe) {
                return reply.code(400).send({
                    error: 'Security Check Failed',
                    details: scanResult.threats
                });
            }

            // 3. Upload to Storage
            // Generate a unique path: folder/uuid-filename
            const folder = bucket === 'profiles' ? 'avatars' : 'general';
            const storagePath = `${folder}/${uuidv4()}-${fileName}`;

            const uploadResult = await storageService.uploadFile(
                bucket,
                storagePath,
                buffer,
                validationResult.mimeType || 'application/octet-stream'
            );

            if (uploadResult.error) {
                return reply.code(500).send({ error: 'Failed to save file to storage' });
            }

            return {
                success: true,
                url: uploadResult.url,
                metadata: {
                    name: fileName,
                    size: buffer.length,
                    type: validationResult.mimeType,
                    path: storagePath
                }
            };
        } catch (error) {
            logger.error({ error }, 'Upload route error:');
            return reply.code(500).send({ error: 'Internal server error during upload' });
        }
    });
}
