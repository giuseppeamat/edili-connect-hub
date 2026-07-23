/**
 * Base URL pubblica dell'app (usata per link condivisibili tipo inviti).
 * Priorità: VITE_PUBLIC_APP_URL -> URL pubblicato Lovable.
 */
const DEFAULT_PUBLIC_APP_URL = "https://edili-connect-hub.lovable.app";

export function getPublicAppUrl(): string {
  const fromEnv = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;
  const raw = (fromEnv && fromEnv.trim()) || DEFAULT_PUBLIC_APP_URL;
  return raw.replace(/\/+$/, "");
}
