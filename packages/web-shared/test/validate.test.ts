import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  parseCoordinate,
  parseRupiahAmount,
  requiredText,
  safeStorageName,
  storageObjectPath,
  validateImageFile,
  verifyImageSignature,
} from "../src/validate";

function makeFile(name: string, type: string, bytes: number, header?: number[]): File {
  const body = header ?? [0xff, 0xd8, 0xff, 0xe0];
  const size = bytes === 0 ? 0 : Math.max(bytes, body.length);
  const buffer = new Uint8Array(size);
  buffer.set(body.slice(0, size), 0);
  return new File([buffer], name, { type });
}

describe("validateImageFile", () => {
  it("accepts a normal photo", () => {
    expect(validateImageFile(makeFile("bag.jpg", "image/jpeg", 2048))).toEqual({
      ok: true,
      type: "image/jpeg",
    });
  });

  it("rejects a file over the size cap", () => {
    const result = validateImageFile(makeFile("huge.png", "image/png", MAX_IMAGE_BYTES + 1));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/5 MB/);
  });

  it("rejects a non-image such as an SVG or an HTML polyglot", () => {
    for (const type of ["image/png", "image/svg+xml", "text/html", "application/pdf", "application/x-msdownload"]) {
      expect(validateImageFile(makeFile("x", type, 100)).ok).toBe(false);
    }
  });

  it("rejects an empty file", () => {
    expect(validateImageFile(makeFile("empty.jpg", "image/jpeg", 0)).ok).toBe(false);
  });

  it("rejects a missing file", () => {
    expect(validateImageFile(null).ok).toBe(false);
    expect(validateImageFile(undefined).ok).toBe(false);
  });
});

describe("verifyImageSignature", () => {
  it("accepts real JPEG / WebP headers and rejects PNG", async () => {
    const jpeg = makeFile("a.jpg", "image/jpeg", 64, [0xff, 0xd8, 0xff, 0xe0]);
    expect((await verifyImageSignature(jpeg)).ok).toBe(true);

    const png = makeFile("a.png", "image/png", 64, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect((await verifyImageSignature(png)).ok).toBe(false);

    const webp = makeFile("a.webp", "image/webp", 64, [
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect((await verifyImageSignature(webp)).ok).toBe(true);
  });

  it("rejects a script disguised as a PNG", async () => {
    const evil = makeFile("evil.png", "image/png", 64, [
      0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e, 0, 0, 0, 0,
    ]);
    const result = await verifyImageSignature(evil);
    expect(result.ok).toBe(false);
  });

  it("rejects a content-type that disagrees with the bytes", async () => {
    // A JPEG renamed to .png: served from a public bucket, this would be an
    // XSS vector if the bucket trusted the extension.
    const mismatched = makeFile("sneaky.png", "image/png", 64, [0xff, 0xd8, 0xff, 0xe0]);
    const result = await verifyImageSignature(mismatched);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/tidak cocok/);
  });
});

describe("safeStorageName", () => {
  it("keeps a normal filename intact", () => {
    expect(safeStorageName("bakery-box-1.jpg")).toBe("bakery-box-1.jpg");
  });

  it("replaces path separators and spaces", () => {
    expect(safeStorageName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeStorageName("my photo (1).png")).toBe("my-photo-1-.png");
  });

  it("never returns a traversal-only or empty name", () => {
    for (const input of ["..", "../..", "/", "///", ".", "   ", "", null, undefined]) {
      const result = safeStorageName(input);
      expect(result === undefined || !/^\.+$/.test(result)).toBe(true);
    }
  });

  it("strips control characters", () => {
    const name = safeStorageName(`a${String.fromCharCode(0)}b${String.fromCharCode(127)}c.jpg`);
    expect(name).toBe("abc.jpg");
  });

  it("caps the length", () => {
    expect(safeStorageName(`${"a".repeat(500)}.jpg`)!.length).toBeLessThanOrEqual(80);
  });
});

describe("storageObjectPath", () => {
  it("scopes the object to the owner and never produces an empty segment", () => {
    const path = storageObjectPath(
      "0d9f8c1e-1111-2222-3333-444455556666",
      makeFile("bag.jpg", "image/jpeg", 100),
      "bag",
    );
    expect(path.startsWith("0d9f8c1e-1111-2222-3333-444455556666/")).toBe(true);
    expect(path).toContain("bag-");
    expect(path.endsWith("bag.jpg")).toBe(true);
    expect(path.split("/")).toHaveLength(2);
  });

  it("survives a hostile filename", () => {
    const path = storageObjectPath("owner", makeFile("../../../evil", "image/jpeg", 10), "logo");
    expect(path.split("/").length).toBe(2);
    expect(path).not.toContain("..");
  });

  it("falls back to a generated name when the filename is unusable", () => {
    const path = storageObjectPath("owner", makeFile("..", "image/jpeg", 10));
    expect(path.endsWith(".jpeg")).toBe(true);
  });
});

describe("parseCoordinate", () => {
  it("parses valid coordinates", () => {
    expect(parseCoordinate("-6.2000", "lat")).toBe(-6.2);
    expect(parseCoordinate("106.8167", "lng")).toBe(106.8167);
    expect(parseCoordinate(0, "lat")).toBe(0);
  });

  it("accepts a comma decimal separator", () => {
    expect(parseCoordinate("-6,2", "lat")).toBe(-6.2);
  });

  it("rejects out-of-range and unparseable values", () => {
    expect(parseCoordinate("91", "lat")).toBeNull();
    expect(parseCoordinate("-91", "lat")).toBeNull();
    expect(parseCoordinate("181", "lng")).toBeNull();
    expect(parseCoordinate("abc", "lat")).toBeNull();
    expect(parseCoordinate(Number.NaN, "lat")).toBeNull();
    expect(parseCoordinate(Number.POSITIVE_INFINITY, "lat")).toBeNull();
  });

  it("treats empty as not provided", () => {
    expect(parseCoordinate("", "lat")).toBeNull();
    expect(parseCoordinate(null, "lat")).toBeNull();
    expect(parseCoordinate(undefined, "lat")).toBeNull();
  });
});

describe("parseRupiahAmount", () => {
  it("parses and rounds", () => {
    expect(parseRupiahAmount("15000")).toBe(15000);
    expect(parseRupiahAmount("15.000")).toBe(15000);
    expect(parseRupiahAmount("Rp 25.500")).toBe(25500);
    expect(parseRupiahAmount(12000.4)).toBe(12000);
  });

  it("rejects zero, negatives and garbage", () => {
    expect(parseRupiahAmount("0")).toBeNull();
    // Regression: stripping non-digits used to turn "-5" into 5.
    expect(parseRupiahAmount("-5")).toBeNull();
    expect(parseRupiahAmount("1e6")).toBeNull();
    expect(parseRupiahAmount("abc")).toBeNull();
    expect(parseRupiahAmount("")).toBeNull();
    expect(parseRupiahAmount(-100)).toBeNull();
  });
});

describe("requiredText", () => {
  it("trims and caps", () => {
    expect(requiredText("  Bakery  ", 100)).toBe("Bakery");
    expect(requiredText("x".repeat(200), 10)).toHaveLength(10);
  });

  it("rejects blank input", () => {
    expect(requiredText("   ", 10)).toBeUndefined();
    expect(requiredText(null, 10)).toBeUndefined();
  });
});
