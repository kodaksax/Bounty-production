import { FastifyInstance, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { fileValidationService } from '../services/file-validation-service';
import { malwareScannerService } from '../services/malware-scanner-service';
import { storageService } from '../services/storage-service';
import { logger } from '../services/logger';
import { pool } from '../db/connection';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export async function registerDisputeRoutes(fastify: FastifyInstance) {
  fastify.post('/api/disputes/evidence-stage', {
    preHandler: authMiddleware,
  }, async (request: any, reply: FastifyReply) => {
    try {
      const body = request.body || {};
      const { filename, contentType, fileSize, type, description } = body;
      if (!filename || !type) {
        return reply.code(400).send({ error: 'filename and type are required' });
      }

      const evidenceId = uuidv4();
      const bucket = 'disputes';
      const storagePath = `disputes/${request.userId || 'anon'}/${evidenceId}-${filename}`;

      const sql = `INSERT INTO dispute_evidence (id, dispute_id, uploaded_by, type, content, description, mime_type, file_size, storage_bucket, storage_path, uploaded, upload_verified, staged_at)
        VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, false, false, now()) RETURNING id, storage_path`;
      const params = [evidenceId, request.userId, type, '', description || null, contentType || null, fileSize || null, bucket, storagePath];

      const res = await pool.query(sql, params);

      const uploadUrl = `/api/disputes/evidence-upload/${evidenceId}`;

      return reply.code(200).send({ evidenceId, uploadUrl, expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString() });
    } catch (err) {
      logger.error({ err }, 'Error staging dispute evidence');
      return reply.code(500).send({ error: 'Failed to stage evidence' });
    }
  });

  fastify.post('/api/disputes/evidence-upload/:id', {
    preHandler: authMiddleware,
  }, async (request: any, reply: FastifyReply) => {
    try {
      const evidenceId = request.params.id;
      const data = await (request as any).file();
      if (!data) return reply.code(400).send({ error: 'No file uploaded' });

      const buffer = await data.toBuffer();
      const fileName = data.filename;

      const validationResult = await fileValidationService.validate(buffer, fileName);
      if (!validationResult.isValid) return reply.code(400).send({ error: validationResult.error });

      const scanResult = await malwareScannerService.scanBuffer(buffer);
      if (!scanResult.isSafe) return reply.code(400).send({ error: 'Security Check Failed', details: scanResult.threats });

      const q = 'SELECT storage_bucket, storage_path, uploaded_by FROM dispute_evidence WHERE id = $1 LIMIT 1';
      const { rows } = await pool.query(q, [evidenceId]);
      if (!rows || rows.length === 0) return reply.code(404).send({ error: 'Evidence not found' });
      const row = rows[0];
      if (String(row.uploaded_by) !== String(request.userId)) {
        return reply.code(403).send({ error: 'Not allowed to upload this evidence' });
      }

      const bucket = row.storage_bucket || 'disputes';
      const path = row.storage_path || `disputes/${request.userId}/${evidenceId}-${fileName}`;

      const uploadResult = await storageService.uploadFile(bucket, path, buffer, validationResult.mimeType || 'application/octet-stream');
      if (uploadResult.error) {
        logger.error({ uploadResult }, 'Storage upload failed for dispute evidence');
        return reply.code(500).send({ error: 'Failed to save file to storage' });
      }

      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

      const updateSql = `UPDATE dispute_evidence SET uploaded = true, upload_verified = true, checksum = $1, mime_type = $2, file_size = $3, content = $4, confirmed_at = now() WHERE id = $5`;
      await pool.query(updateSql, [checksum, validationResult.mimeType || null, buffer.length, uploadResult.url || path, evidenceId]);

      return reply.code(200).send({ success: true, url: uploadResult.url || null });
    } catch (err) {
      logger.error({ err }, 'Error in evidence upload');
      return reply.code(500).send({ error: 'Evidence upload failed' });
    }
  });

  fastify.post('/api/disputes/commit', {
    preHandler: authMiddleware,
  }, async (request: any, reply: FastifyReply) => {
    const { evidenceIds, cancellationId, reason } = request.body || {};
    if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
      return reply.code(400).send({ error: 'evidenceIds is required' });
    }
    if (!cancellationId) return reply.code(400).send({ error: 'cancellationId is required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const cRes = await client.query('SELECT id, bounty_id FROM bounty_cancellations WHERE id = $1 FOR UPDATE', [cancellationId]);
      if (!cRes.rows || cRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Cancellation not found' });
      }
      const bountyId = cRes.rows[0].bounty_id;

      const evidenceRes = await client.query('SELECT id, uploaded FROM dispute_evidence WHERE id = ANY($1::uuid[]) FOR UPDATE', [evidenceIds]);
      const missing = evidenceIds.filter((id: string) => !evidenceRes.rows.some((r: any) => String(r.id) === String(id)));
      if (missing.length > 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Some evidence items not found', missing });
      }
      const notUploaded = evidenceRes.rows.filter((r: any) => !r.uploaded).map((r: any) => r.id);
      if (notUploaded.length > 0) {
        await client.query('ROLLBACK');
        return reply.code(422).send({ error: 'Some evidence items are not yet uploaded', notUploaded });
      }

      const existing = await client.query('SELECT id FROM bounty_disputes WHERE cancellation_id = $1 LIMIT 1', [cancellationId]);
      if (existing.rows && existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return reply.code(200).send({ disputeId: existing.rows[0].id, idempotent: true });
      }

      const insertSql = `INSERT INTO bounty_disputes (cancellation_id, bounty_id, initiator_id, reason, status, created_at)
        VALUES ($1, $2, $3, $4, 'open', now()) RETURNING id`;
      const insertRes = await client.query(insertSql, [cancellationId, bountyId, request.userId, reason || null]);
      const disputeId = insertRes.rows[0].id;

      await client.query('UPDATE dispute_evidence SET dispute_id = $1 WHERE id = ANY($2::uuid[])', [disputeId, evidenceIds]);

      await client.query('UPDATE bounty_cancellations SET status = $1 WHERE id = $2', ['disputed', cancellationId]);

      // Place a wallet hold on the poster's balance for the disputed bounty amount.
      // fn_open_dispute_hold is idempotent and a no-op for honor/zero-amount bounties.
      await client.query('SELECT fn_open_dispute_hold($1)', [disputeId]);

      await client.query('COMMIT');

      return reply.code(201).send({ disputeId });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err }, 'Error committing dispute');
      return reply.code(500).send({ error: 'Failed to commit dispute' });
    } finally {
      client.release();
    }
  });
}

export default { registerDisputeRoutes };
