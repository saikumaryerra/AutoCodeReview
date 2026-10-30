import axios from 'axios';

/**
 * Extracts a user-facing message from a failed API call: the server's
 * `{ error }` body when present, else the transport error, else `fallback`.
 */
export function getApiErrorMessage(err: Error, fallback: string): string {
  if (axios.isAxiosError<{ error?: string }>(err)) {
    return err.response?.data?.error ?? err.message ?? fallback;
  }
  return err.message || fallback;
}
