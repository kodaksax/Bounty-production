// Minimal shims to satisfy TypeScript in this repo for Supabase/Deno functions
declare const Deno: {
  env: {
    get(key: string): string | undefined
  }
  serve(handler: (req: Request) => Promise<Response> | Response): void
}

declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export function createClient(url: string, key: string, opts?: any): any
}

declare module 'https://esm.sh/stripe@14?target=deno&no-check' {
  const Stripe: any
  export default Stripe
}

// Generic catch-all for other esm.sh imports used in functions (optional)
declare module 'https://esm.sh/*'
