// Small helper to race a promise against a timeout.
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)) as Promise<T>,
  ])
}

export default withTimeout
