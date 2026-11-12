export async function fetchBounded(url: string, init: RequestInit = {}, maxBytes = 2_000_000, timeoutMs = 12_000): Promise<Uint8Array> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Upstream response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty upstream response');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) throw new Error('Upstream response too large'); chunks.push(value); } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function fetchJson(url: string, init: RequestInit = {}, maxBytes?: number, timeoutMs?: number): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await fetchBounded(url, init, maxBytes, timeoutMs)));
}
export function serverUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Configure an HTTPS endpoint without credentials in the URL');
  return url.toString().replace(/\/$/, '');
}
