function getFetch(): typeof fetch {
  // Use reader.fetch if available, otherwise fallback to global fetch
  return window.nekori! && window.nekori!.fetch
    ? window.nekori!.fetch.bind(window.nekori!)
    : fetch;
}

export async function nativeFetchBytes(
  url: string,
  headers?: Record<string, string>,
): Promise<{ status: number; bytes: Uint8Array }> {
  const r = await getFetch()(url, { credentials: 'include', headers });
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
}

export async function nativeFetch(
  url: string,
  headers?: Record<string, string>,
): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  const fetchFn = getFetch();
  // eslint-disable-next-line
  const init: RequestInit = { credentials: 'include', headers };

  const r = await fetchFn(url, init);
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => {
    h[k.toLowerCase()] = v;
  });

  const text = await r.text();
  return { status: r.status, text, headers: h };
}
