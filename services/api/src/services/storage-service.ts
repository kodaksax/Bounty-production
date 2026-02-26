import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from './logger';

export class StorageService {
    private supabase;

    constructor() {
        this.supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
    }

    /**
     * Uploads a file buffer to a Supabase bucket
     */
    async uploadFile(
        bucket: string,
        path: string,
        buffer: Buffer,
        contentType: string
    ): Promise<{
        url?: string;
        error?: string;
    }> {
        try {
            const { data, error } = await this.supabase
                .storage
                .from(bucket)
                .upload(path, buffer, {
                    contentType,
                    upsert: true
                });

            if (error) {
                logger.error(`Supabase upload error: ${error.message} (bucket: ${bucket}, path: ${path})`);
                return { error: error.message };
            }

            // Get public URL
            const { data: publicUrlData } = this.supabase
                .storage
                .from(bucket)
                .getPublicUrl(data.path);

            const publicUrl = config.storage.cdnUrl
                ? (() => {
                    try {
                        const urlObj = new URL(publicUrlData.publicUrl);
                        const cdnUrlObj = new URL(config.storage.cdnUrl);
                        urlObj.protocol = cdnUrlObj.protocol;
                        urlObj.host = cdnUrlObj.host;
                        return urlObj.toString();
                    } catch {
                        // If URL parsing fails for any reason, fall back to the original public URL
                        return publicUrlData.publicUrl;
                    }
                })()
                : publicUrlData.publicUrl;

            return {
                url: publicUrl
            };
        } catch (error) {
            logger.error(`Storage service error: ${error instanceof Error ? error.message : String(error)}`);
            return { error: 'Internal storage service error' };
        }
    }
}

export const storageService = new StorageService();
