/**
 * A tiny event bridge between the API client (plain module) and the React auth
 * provider.
 *
 * The API client cannot import React context, so when a request comes back 401
 * it notifies this module, and the provider decides what to do: clear state,
 * show "session expired" and navigate to /login.
 */
type UnauthorizedHandler = () => void;

let handler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(next: UnauthorizedHandler | null): void {
  handler = next;
}

export function notifyUnauthorized(): void {
  handler?.();
}
