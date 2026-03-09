declare module 'node-fetch' {
  interface RequestInit {
    headers?: Record<string, string>;
    body?: unknown;
  }

  interface Response {
    ok: boolean;
    status: number;
    json(): Promise<any>;
    text(): Promise<string>;
  }

  function fetch(url: string, init?: RequestInit): Promise<Response>;
  export default fetch;
}
