declare module 'node-fetch' {
  export interface RequestInit {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  }

  export interface Response {
    ok: boolean;
    status: number;
    statusText: string;
    headers?: Record<string, string>;
    json<T = any>(): Promise<T>;
    text(): Promise<string>;
  }

  export default function fetch(
    url: string,
    init?: RequestInit
  ): Promise<Response>;
}
