/* Minimal Supabase mock helpers for tests
   Provides a chainable `.from(table)` builder with methods commonly used in tests:
   - .select(), .insert(payload), .update(payload)
   - .eq(col, val), .in(col, vals), .single()
   Also exports `createFromMockFactory(behaviors)` which returns a function suitable
   for `jest.mock` implementations: `(supabase.from as jest.Mock).mockImplementation(...)`.

   Usage example in tests:
   import { createFromMockFactory, makeThrowingFrom, supabaseError } from '../__tests__/supabase-mock';
   (supabase.from as jest.Mock).mockImplementation(createFromMockFactory({
     profiles: { insert: { result: { id: 'u1' } } },
   }));
*/

type SupabaseResult = { data: any; error: any };

export function supabaseError(code: string | number, message = 'Supabase error') {
  return { code: String(code), message };
}

type TableBehavior = {
  // select may be an array of rows, a function returning rows, or
  // an object containing { result, error } to simulate errors or shaped results
  select?: any[] | (() => any[]) | { result?: any[]; error?: any };
  insert?: { result?: any; error?: any };
  update?: { result?: any; error?: any };
  delete?: { result?: any; error?: any };
};

type Behaviors = Record<string, TableBehavior>;

function buildResult(data: any, error: any): SupabaseResult {
  return { data: data ?? null, error: error ?? null };
}

function makeBuilder(table: string, behaviors: Behaviors, filters: any[] = []) {
  const state: { op?: string; payload?: any } = {};

  const run = async (op?: string) => {
    const behavior = behaviors[table] || {};
    const effectiveOp = op || state.op || 'select'
    const opBehavior = (behavior as any)[effectiveOp];

    if (opBehavior && opBehavior.error) {
      return buildResult(null, opBehavior.error);
    }

    if (effectiveOp === 'select') {
      const sel = behavior.select;
      if (sel && typeof (sel as any).error !== 'undefined') {
        return buildResult(null, (sel as any).error);
      }
      const rows = typeof sel === 'function' ? sel() : (Array.isArray(sel) ? sel : (sel && (sel as any).result) ?? []);
      return buildResult(rows, null);
    }

    if (effectiveOp === 'insert') {
      if (opBehavior && opBehavior.result !== undefined) return buildResult(opBehavior.result, null);
      return buildResult(state.payload ?? null, null);
    }

    if (effectiveOp === 'update') {
      if (opBehavior && opBehavior.result !== undefined) return buildResult(opBehavior.result, null);
      return buildResult(state.payload ?? null, null);
    }

    return buildResult(null, null);
  };

  const builder: any = {
    select(_: any) { state.op = 'select'; return builder; },
    insert(payload: any) { state.op = 'insert'; state.payload = payload; return builder; },
    update(payload: any) { state.op = 'update'; state.payload = payload; return builder; },
    delete() { state.op = 'delete'; return builder; },
    eq(_col: string, _val: any) { filters.push({ type: 'eq', col: _col, val: _val }); return builder; },
    in(_col: string, _vals: any[]) { filters.push({ type: 'in', col: _col, vals: _vals }); return builder; },
    single() { return (async () => {
      const res = await run();
      // if data is array, return first element for single
      const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
      return buildResult(data, res.error);
    })(); },

    // Make the builder thenable so `await builder` behaves like the real
    // Supabase client (which returns a thenable query). This ensures unit
    // tests that `await` the query directly receive `{ data, error }`.
    then(onFulfilled: any, onRejected: any) {
      return (async () => run())().then(onFulfilled, onRejected)
    },
  };

  return builder;
}

export function createFromMockFactory(behaviors: Behaviors = {}) {
  return (table: string) => makeBuilder(table, behaviors, []);
}

export function makeThrowingFrom(err: Error) {
  return () => { throw err; };
}

// Minimal supabase stub used by tests when needed
export function createSupabaseMock(behaviors: Behaviors = {}) {
  return {
    supabase: {
      auth: { getSession: jest.fn() },
      from: jest.fn().mockImplementation(createFromMockFactory(behaviors)),
    },
  } as any;
}
