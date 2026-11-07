const MIN_GZIP_BYTES = 1024;

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }
  if (!current.split(",").some((entry) => entry.trim().toLowerCase() === value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}

export function jsonResponse(
  _request: Request,
  data: unknown,
  init: ResponseInit = {},
): Response {
  const body = JSON.stringify(data);
  const isLargeEnough = Buffer.byteLength(body) >= MIN_GZIP_BYTES;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  if (isLargeEnough) {
    appendVary(headers, "Accept-Encoding");
  }

  // Next strips Content-Encoding when adapting Web Responses to Node HTTP.
  // Keep this body decoded; Next's HTTP layer negotiates and applies compression.
  return new Response(body, { ...init, headers });
}
