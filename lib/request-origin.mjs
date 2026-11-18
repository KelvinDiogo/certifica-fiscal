// Next.js may synthesize req.nextUrl using the bind address behind a proxy.
// Compare the browser Origin with the HTTP Host, never with that internal URL.
export function sameOrigin(origin, host) {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.origin === origin &&
      url.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}
