declare module 'https://deno.land/std@0.203.0/http/server.ts' {
  export type ServeHandler = (req: Request) => Response | Promise<Response>;

  export interface ServeInit {
    port?: number;
    hostname?: string;
    signal?: AbortSignal;
    onError?(error: unknown): Response | Promise<Response>;
  }

  export function serve(handler: ServeHandler, options?: ServeInit): Promise<void>;
}
