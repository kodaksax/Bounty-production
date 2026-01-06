import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Convert a Zod schema to a Fastify-compatible JSON Schema (Draft-07).
 * Provide a stable name per schema to aid Ajv caching/debugging.
 */
export function toJsonSchema(schema: z.ZodTypeAny, name: string) {
  const json: any = (zodToJsonSchema as any)(schema, { name, target: 'jsonSchema7' });
  // Normalize any non-array "required" fields to satisfy Ajv
  function normalize(obj: any): void {
    if (!obj || typeof obj !== 'object') return;
    if ('required' in obj && !Array.isArray(obj.required)) {
      // Remove invalid required; Ajv expects an array of strings
      delete obj.required;
    }
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === 'object') normalize(val);
    }
  }
  normalize(json);
  return json;
}
