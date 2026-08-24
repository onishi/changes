const encoder = new TextEncoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function stringToBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

export function base64UrlToString(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

export function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hmacSha256(
  secret: string,
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function timingSafeEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    sha256(left),
    sha256(right),
  ]);
  return crypto.subtle.timingSafeEqual(
    encoder.encode(leftHash),
    encoder.encode(rightHash),
  );
}

export function encodeCursor(value: Record<string, string>): string {
  return stringToBase64Url(JSON.stringify(value));
}

export function decodeCursor(value: string): unknown {
  return JSON.parse(base64UrlToString(value));
}
