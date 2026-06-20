/**
 * Resolves the backend base URL.
 *
 * By default it is DERIVED from the page you opened — so the exact same build
 * works on `http://localhost:3000` and `https://<lan-ip>:3000` with zero env
 * changes when your IP changes:
 *
 *   page http://localhost:3000      → backend http://localhost:4000
 *   page https://10.11.14.216:3000  → backend https://10.11.14.216:4000
 *
 * Set NEXT_PUBLIC_API_URL to override (e.g. backend on a separate host).
 * Set NEXT_PUBLIC_API_PORT to change the backend port (default 4000).
 */
export function getServerBase(): string {
  const override = process.env.NEXT_PUBLIC_API_URL;
  if (override) return override;

  const port = process.env.NEXT_PUBLIC_API_PORT || '4000';

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  // SSR fallback — real requests happen client-side, so this is rarely used.
  return `http://localhost:${port}`;
}
