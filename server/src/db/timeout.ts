/**
 * Bounded database operation wrapper.
 *
 * Guarantees that any pending query or pool acquisition is aborted if it exceeds
 * timeoutMs (default 5,000ms), throwing an error with code 'ETIMEDOUT'.
 *
 * The HTTP error-handler maps 'ETIMEDOUT' to a structured 503 Service Unavailable,
 * preventing hung queries from tying up connections and exceeding the frontend's
 * 8-second request budget.
 */
export async function withDbTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 5_000,
  operationName = 'Database operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${operationName} timed out after ${timeoutMs}ms`);
      (error as { code?: string }).code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
