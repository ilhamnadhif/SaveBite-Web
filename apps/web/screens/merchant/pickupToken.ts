/**
 * Pickup token extraction for the merchant scanner, ported from
 * `_ScanQrScreenState._extractPickupToken` in `scan_qr_screen.dart`.
 *
 * The Dart code leans on `Uri.tryParse`, so the parts of Dart's URI parser it
 * observes (scheme detection, `hasScheme`, `queryParameters['token']`,
 * `pathSegments.last`, and which inputs make `tryParse` return null) are
 * reproduced here. The token only ever comes from a decoded QR (or the E2E
 * staging input); nothing on screen feeds it.
 */

/** Dart `String.trim()`: JavaScript `trim()` plus U+0085 (NEL). */
export function dartTrim(value: string): string {
  return value.replace(/^[\s\u0085]+|[\s\u0085]+$/g, "");
}

/**
 * Returns the pickup token carried by a scanned QR value, or null when the
 * value is not a SaveBite pickup voucher.
 */
export function extractPickupToken(raw: string): string | null {
  if (raw.length < 6 || raw.length > 512 || /\s/.test(raw)) return null;
  let uri: ParsedUri | null;
  try {
    uri = parseUri(raw);
  } catch {
    // `Uri.tryParse` returned null.
    uri = null;
  }
  if (uri === null) return raw;
  try {
    const queryToken = uri.query === null ? undefined : queryParameters(uri.query).get("token");
    if (queryToken !== undefined && queryToken.length >= 6 && queryToken.length <= 512) return queryToken;
    if (uri.scheme === "savebite") {
      const segments = pathSegments(uri.path);
      const candidate = segments[segments.length - 1];
      if (candidate !== undefined && candidate.length >= 6) return candidate;
    }
    return null;
  } catch {
    // Dart throws on malformed percent-encoding (invalid UTF-8) while reading
    // the query or path; such a QR is not a voucher either.
    return null;
  }
}

// ── Dart `Uri` subset ─────────────────────────────────────────────────────

type ParsedUri = { scheme: string; query: string | null; path: string };

/** Thrown where Dart's `Uri.parse` throws a `FormatException`. */
class UriFormatError extends Error {}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;

/** A URI with a scheme, null when the input has none (a relative reference). */
function parseUri(raw: string): ParsedUri | null {
  if (/^data:/i.test(raw)) return parseDataUri(raw);
  // The first `:` before any `/`, `\`, `?` or `#` ends the scheme.
  const special = /[:/\\?#]/.exec(raw);
  if (!special || special[0] !== ":") return null;
  const scheme = raw.slice(0, special.index);
  if (!scheme || !SCHEME.test(scheme)) throw new UriFormatError();

  let rest = raw.slice(special.index + 1);
  const hash = rest.indexOf("#");
  if (hash >= 0) rest = rest.slice(0, hash);
  const questionMark = rest.indexOf("?");
  const query = questionMark >= 0 ? rest.slice(questionMark + 1) : null;
  let hierPart = questionMark >= 0 ? rest.slice(0, questionMark) : rest;

  let hasAuthority = false;
  if (/^[/\\]{2}/.test(hierPart)) {
    hasAuthority = true;
    const end = hierPart.slice(2).search(/[/\\]/);
    const authority = end >= 0 ? hierPart.slice(2, 2 + end) : hierPart.slice(2);
    if (!validAuthority(authority)) throw new UriFormatError();
    hierPart = end >= 0 ? hierPart.slice(2 + end) : "";
  }
  return { scheme: scheme.toLowerCase(), query, path: normalizePath(hierPart, hasAuthority) };
}

/** `[userinfo "@"] host [":" port]` with the checks Dart's parser makes. */
function validAuthority(authority: string): boolean {
  // An `@` inside `[...]` belongs to the IP literal, not to the user info.
  const at = authority.indexOf("@");
  const bracket = authority.indexOf("[");
  const hasUserInfo = at >= 0 && (bracket < 0 || at < bracket);
  if (hasUserInfo && authority.slice(0, at).includes("]")) return false;
  const hostPort = hasUserInfo ? authority.slice(at + 1) : authority;
  let port: string | null = null;
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close < 0 || !validIpLiteral(hostPort.slice(1, close))) return false;
    const after = hostPort.slice(close + 1);
    if (after) {
      if (!after.startsWith(":")) return false;
      port = after.slice(1);
    }
  } else {
    const colon = hostPort.indexOf(":");
    const host = colon >= 0 ? hostPort.slice(0, colon) : hostPort;
    if (/[[\]@]/.test(host)) return false;
    if (colon >= 0) port = hostPort.slice(colon + 1);
  }
  // Dart reads a non-trivial port with `int.tryParse` (sign and 0x allowed).
  return port === null || port === "" || /^[+-]?(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.test(port);
}

/** `IPv6address [ "%" ZoneID ]` or `IPvFuture` inside `[...]`. */
function validIpLiteral(literal: string): boolean {
  if (literal.startsWith("v")) return /^v[0-9A-Fa-f]+\.[A-Za-z0-9\-._~!$&'()*+,;=:]+$/.test(literal);
  const zone = literal.indexOf("%");
  if (zone < 0) return validIpv6(literal);
  // Dart escapes any zone character; only a broken `%` escape is an error.
  const id = literal.slice(zone + 1).replace(/^25/, "");
  return !/%(?![0-9A-Fa-f]{2})/.test(id) && validIpv6(literal.slice(0, zone));
}

const IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);

function validIpv6(address: string): boolean {
  const halves = address.split("::");
  if (halves.length > 2) return false;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const parts = [...head, ...tail];
  // An embedded IPv4 address may only be the very last part of the address.
  const ipv4Index = halves.length === 2 && !tail.length ? -1 : parts.length - 1;
  let count = 0;
  for (const [index, group] of parts.entries()) {
    if (index === ipv4Index && group.includes(".")) {
      if (!IPV4.test(group)) return false;
      count += 2;
    } else if (/^[0-9A-Fa-f]{1,4}$/.test(group)) {
      count += 1;
    } else {
      return false;
    }
  }
  return halves.length === 2 ? count < 8 : count === 8;
}

/**
 * `data:` URIs get Dart's special `UriData` parsing: a MIME type with one
 * `/`, `;name=value` parameters, an optional final `base64`, then `,`. The
 * query is everything after the first `?`.
 */
function parseDataUri(raw: string): ParsedUri {
  const text = raw.slice(5);
  let index = 0;
  let slash = -1;
  for (; index < text.length; index++) {
    const char = text[index];
    if (char === "," || char === ";") break;
    if (char === "/") {
      if (slash >= 0) throw new UriFormatError();
      slash = index;
    }
  }
  if (slash < 0 && index > 0) throw new UriFormatError();
  let base64 = false;
  while (text[index] !== ",") {
    const parameterStart = index;
    index++;
    let equals = -1;
    for (; index < text.length; index++) {
      const char = text[index];
      if (char === "=") {
        if (equals < 0) equals = index;
      } else if (char === ";" || char === ",") {
        break;
      }
    }
    if (equals >= 0) continue;
    if (text[index] !== "," || index !== parameterStart + 7 || !text.startsWith("base64", parameterStart + 1)) {
      throw new UriFormatError();
    }
    base64 = true;
    break;
  }
  // The MIME type and parameters are not escaped, so a `#`, `[` or `]` there
  // is an invalid character when Dart builds the URI.
  if (/[#[\]]/.test(text.slice(0, index))) throw new UriFormatError();
  if (base64 && !validBase64(text.slice(index + 1))) throw new UriFormatError();
  const questionMark = raw.indexOf("?", 5);
  return { scheme: "data", query: questionMark >= 0 ? raw.slice(questionMark + 1) : null, path: "" };
}

/** Dart `base64.normalize` acceptance (standard or URL-safe alphabet). */
function validBase64(data: string): boolean {
  const decoded = data.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  const match = /^([A-Za-z0-9+/_-]*)(=*)$/.exec(decoded);
  if (!match) return false;
  const length = match[1].length;
  const padding = match[2].length;
  if (padding === 0) return length % 4 !== 1;
  return padding <= 2 && (length + padding) % 4 === 0;
}

const isUnreserved = (code: number) =>
  (code >= 0x30 && code <= 0x39) ||
  (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a) ||
  code === 0x2d ||
  code === 0x2e ||
  code === 0x5f ||
  code === 0x7e;

/**
 * Dart's component normalization as far as decoding can observe it: escapes
 * of unreserved characters become the character, and a `%` that does not
 * start a valid escape becomes `%25`.
 */
function normalizePercent(text: string): string {
  return text.replace(/%([0-9A-Fa-f]{2})?/g, (match, hex: string | undefined) => {
    if (hex === undefined) return "%25";
    const code = Number.parseInt(hex, 16);
    return isUnreserved(code) ? String.fromCharCode(code) : match;
  });
}

function normalizePath(path: string, hasAuthority: boolean): string {
  let result = normalizePercent(path).replace(/\\/g, "/");
  if (result && hasAuthority && !result.startsWith("/")) result = `/${result}`;
  return removeDotSegments(result);
}

/** Dart `_Uri._removeDotSegments` (RFC 3986, leading `..` dropped). */
function removeDotSegments(path: string): string {
  if (!path.startsWith(".") && !path.includes("/.")) return path;
  const output: string[] = [];
  let appendSlash = false;
  for (const segment of path.split("/")) {
    appendSlash = false;
    if (segment === "..") {
      if (output.length) {
        output.pop();
        if (!output.length) output.push("");
      }
      appendSlash = true;
    } else if (segment === ".") {
      appendSlash = true;
    } else {
      output.push(segment);
    }
  }
  if (appendSlash) output.push("");
  return output.join("/");
}

const utf8 = { encoder: new TextEncoder(), decoder: new TextDecoder("utf-8", { fatal: true }) };

/** `Uri.decodeComponent` / `decodeQueryComponent` of a normalized component. */
function decode(component: string, plusToSpace: boolean): string {
  const text = normalizePercent(component);
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 0x25) {
      bytes.push(Number.parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else if (plusToSpace && code === 0x2b) {
      bytes.push(0x20);
    } else if (code < 0x80) {
      bytes.push(code);
    } else {
      const point = text.codePointAt(index) ?? code;
      // A lone surrogate encodes to bytes Dart's UTF-8 decoder rejects.
      if (point >= 0xd800 && point <= 0xdfff) throw new UriFormatError();
      if (point > 0xffff) index++;
      bytes.push(...utf8.encoder.encode(String.fromCodePoint(point)));
    }
  }
  return utf8.decoder.decode(new Uint8Array(bytes));
}

/** `Uri.queryParameters`: every pair is decoded; a later key wins. */
function queryParameters(query: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const element of query.split("&")) {
    const index = element.indexOf("=");
    if (index === -1) {
      if (element !== "") map.set(decode(element, true), "");
    } else if (index !== 0) {
      map.set(decode(element.slice(0, index), true), decode(element.slice(index + 1), true));
    }
  }
  return map;
}

/** `Uri.pathSegments`. */
function pathSegments(path: string): string[] {
  const value = path.startsWith("/") ? path.slice(1) : path;
  if (!value) return [];
  return value.split("/").map((segment) => decode(segment, false));
}
