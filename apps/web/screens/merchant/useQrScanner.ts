"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type jsQR from "jsqr";

/**
 * Browser replacement for the `mobile_scanner` controller used by the pickup
 * scanner (`MobileScannerController(detectionSpeed: noDuplicates, formats:
 * [qrCode], facing: back)`). The rear camera streams into a `<video>`, frames
 * are decoded with the native `BarcodeDetector` when it supports QR codes and
 * with `jsqr` otherwise, and the state mirrors `MobileScannerState`
 * (`isInitialized`, `isRunning`, `error`, `torchState`).
 */

/** `MobileScannerErrorCode`, as the web implementation of mobile_scanner maps it. */
export type ScannerErrorCode = "permissionDenied" | "unsupported" | "genericError";

/** `TorchState` (the web only knows a torch when the track exposes one). */
export type TorchState = "unavailable" | "off" | "on";

export type ScannerState = {
  readonly isInitialized: boolean;
  readonly isRunning: boolean;
  readonly error: ScannerErrorCode | null;
  readonly torchState: TorchState;
  /** The preview is mirrored for a user-facing camera, like mobile_scanner on the web. */
  readonly mirrored: boolean;
};

export type ScannerCallbacks = {
  /** `onDetect`: raw values of the QR codes in a frame (never empty). */
  onDetect: (values: string[]) => void;
  /** `onDetectError`: decoding a frame failed. */
  onDetectError: () => void;
};

export type QrScanner = {
  videoRef: RefObject<HTMLVideoElement | null>;
  state: ScannerState;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggleTorch: () => Promise<void>;
};

const INITIAL_STATE: ScannerState = {
  isInitialized: false,
  isRunning: false,
  error: null,
  torchState: "unavailable",
  mirrored: false,
};

/** Minimum time between two decoded frames. */
const DETECTION_INTERVAL_MS = 100;
/** jsQR works on a downscaled frame so slow phones keep up. */
const MAX_DECODE_SIZE = 960;
/** Wait before retrying a decoder that failed to load (e.g. offline chunk). */
const DETECTOR_RETRY_MS = 2000;

/**
 * Starts the camera when the calling screen mounts (`autoStart`) and always
 * releases it on unmount.
 */
export function useQrScanner(callbacks: ScannerCallbacks): QrScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const controllerRef = useRef<QrScannerController | null>(null);
  const [state, setState] = useState<ScannerState>(INITIAL_STATE);

  useEffect(() => {
    const controller = new QrScannerController(() => videoRef.current, setState, callbacksRef);
    controllerRef.current = controller;
    void controller.start();
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  const start = useCallback(() => controllerRef.current?.start() ?? Promise.resolve(), []);
  const stop = useCallback(() => controllerRef.current?.stop() ?? Promise.resolve(), []);
  const toggleTorch = useCallback(() => controllerRef.current?.toggleTorch() ?? Promise.resolve(), []);

  return { videoRef, state, start, stop, toggleTorch };
}

type FrameDetector = (video: HTMLVideoElement) => Promise<string[]>;

class QrScannerController {
  private state: ScannerState = INITIAL_STATE;
  private stream: MediaStream | null = null;
  private starting = false;
  private stopRequested = false;
  private disposed = false;
  private frame: number | null = null;
  private torchTimer: ReturnType<typeof setTimeout> | null = null;
  private detecting = false;
  private lastDetection = Number.NEGATIVE_INFINITY;
  /** `DetectionSpeed.noDuplicates`: the last non-empty set of values. */
  private lastScanned: string[] | null = null;
  private detector: Promise<FrameDetector> | null = null;
  private detectorRetryAt = 0;

  constructor(
    private readonly video: () => HTMLVideoElement | null,
    private readonly publish: (state: ScannerState) => void,
    private readonly callbacks: { readonly current: ScannerCallbacks },
  ) {}

  /** `controller.start()`: no-op while running; a start in flight continues. */
  async start(): Promise<void> {
    if (this.disposed || this.state.isRunning) return;
    if (this.starting) {
      this.stopRequested = false;
      return;
    }
    this.starting = true;
    this.stopRequested = false;
    // `copyWith(isStarting: true)` clears the previous error.
    if (this.state.error !== null) this.update({ error: null });

    let stream: MediaStream;
    try {
      stream = await openCamera();
    } catch (error) {
      this.starting = false;
      this.update({ isInitialized: true, isRunning: false, error: cameraErrorCode(error), torchState: "unavailable" });
      return;
    }

    const video = this.video();
    if (this.disposed || this.stopRequested || !video) {
      stopTracks(stream);
      this.starting = false;
      if (this.stopRequested) this.update({ isInitialized: true });
      else this.update({ isInitialized: true, isRunning: false, error: "genericError", torchState: "unavailable" });
      return;
    }

    try {
      video.muted = true;
      video.srcObject = stream;
      await video.play();
    } catch {
      stopTracks(stream);
      if (video.srcObject === stream) video.srcObject = null;
      this.starting = false;
      if (this.stopRequested) this.update({ isInitialized: true });
      else this.update({ isInitialized: true, isRunning: false, error: "genericError", torchState: "unavailable" });
      return;
    }

    this.starting = false;
    if (this.disposed || this.stopRequested) {
      stopTracks(stream);
      if (video.srcObject === stream) video.srcObject = null;
      this.update({ isInitialized: true });
      return;
    }

    this.stream = stream;
    this.lastScanned = null;
    const track = stream.getVideoTracks()[0];
    this.update({
      isInitialized: true,
      isRunning: true,
      error: null,
      torchState: supportsTorch(track) ? "off" : "unavailable",
      mirrored: isUserFacing(track),
    });
    if (this.state.torchState === "unavailable") {
      // Some phones only report the torch once frames are flowing.
      this.torchTimer = setTimeout(() => {
        this.torchTimer = null;
        if (this.stream === stream && this.state.isRunning && this.state.torchState === "unavailable" && supportsTorch(track)) {
          this.update({ torchState: "off" });
        }
      }, 600);
    }
    this.scheduleDetection();
  }

  /** `controller.stop()`: releases the camera; the torch goes off with it. */
  async stop(): Promise<void> {
    if (this.starting) this.stopRequested = true;
    this.cancelTimers();
    this.lastScanned = null;
    const video = this.video();
    if (this.stream) {
      stopTracks(this.stream);
      if (video && video.srcObject === this.stream) video.srcObject = null;
      this.stream = null;
    }
    if (this.state.isRunning) {
      this.update({ isRunning: false, torchState: this.state.torchState === "unavailable" ? "unavailable" : "off" });
    }
  }

  /** `controller.toggleTorch()`. */
  async toggleTorch(): Promise<void> {
    const stream = this.stream;
    const track = stream?.getVideoTracks()[0];
    if (!track || this.state.torchState === "unavailable") return;
    const on = this.state.torchState !== "on";
    const advanced: TorchConstraintSet[] = [{ torch: on }];
    try {
      await track.applyConstraints({ advanced });
    } catch {
      return;
    }
    if (this.stream === stream && this.state.isRunning) this.update({ torchState: on ? "on" : "off" });
  }

  dispose() {
    this.disposed = true;
    void this.stop();
  }

  private update(patch: Partial<ScannerState>) {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.publish(this.state);
  }

  private cancelTimers() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.torchTimer !== null) clearTimeout(this.torchTimer);
    this.torchTimer = null;
  }

  private scheduleDetection() {
    if (this.frame !== null) return;
    const tick = (time: number) => {
      this.frame = null;
      if (this.disposed || !this.state.isRunning || !this.stream) return;
      if (!this.detecting && time - this.lastDetection >= DETECTION_INTERVAL_MS) {
        this.lastDetection = time;
        this.detecting = true;
        void this.detectFrame().finally(() => {
          this.detecting = false;
        });
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private async detectFrame() {
    const video = this.video();
    const stream = this.stream;
    if (!video || !stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
    let values: string[];
    try {
      values = await (await this.frameDetector())(video);
    } catch {
      if (this.stream === stream && this.state.isRunning) this.callbacks.current.onDetectError();
      return;
    }
    // A frame decoded after the camera stopped belongs to an old session.
    if (this.disposed || this.stream !== stream || !this.state.isRunning) return;
    const sorted = [...values].sort();
    if (this.lastScanned !== null && sameValues(sorted, this.lastScanned)) return;
    if (sorted.length) this.lastScanned = sorted;
    if (values.length) this.callbacks.current.onDetect(values);
  }

  private frameDetector(): Promise<FrameDetector> {
    if (!this.detector) {
      if (Date.now() < this.detectorRetryAt) return Promise.reject(new Error("QR decoder unavailable"));
      this.detector = createDetector();
      void this.detector.catch(() => {
        this.detector = null;
        this.detectorRetryAt = Date.now() + DETECTOR_RETRY_MS;
      });
    }
    return this.detector;
  }
}

// ── Camera ────────────────────────────────────────────────────────────────

class CameraUnsupportedError extends Error {}

type TorchConstraintSet = MediaTrackConstraintSet & { torch?: boolean };
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean | boolean[] };

/** Rear camera (`CameraFacing.back`), as mobile_scanner requests it on the web. */
async function openCamera(): Promise<MediaStream> {
  const devices = typeof window !== "undefined" && window.isSecureContext ? window.navigator.mediaDevices : undefined;
  if (!devices || typeof devices.getUserMedia !== "function") throw new CameraUnsupportedError();
  const supported = typeof devices.getSupportedConstraints === "function" ? devices.getSupportedConstraints() : null;
  const video: MediaTrackConstraints | boolean = supported?.facingMode ? { facingMode: { ideal: "environment" } } : true;
  return devices.getUserMedia({ video, audio: false });
}

/** mobile_scanner (web): NotAllowedError → denied, NotFound/NotSupported → unsupported. */
function cameraErrorCode(error: unknown): ScannerErrorCode {
  if (error instanceof CameraUnsupportedError) return "unsupported";
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "permissionDenied";
  if (name === "NotFoundError" || name === "NotSupportedError") return "unsupported";
  return "genericError";
}

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function supportsTorch(track: MediaStreamTrack | undefined): boolean {
  if (!track || typeof track.getCapabilities !== "function") return false;
  try {
    const torch = (track.getCapabilities() as TorchCapabilities).torch;
    return torch === true || (Array.isArray(torch) && torch.includes(true));
  } catch {
    return false;
  }
}

/** mobile_scanner flips the web preview for a user-facing (or FaceTime) camera. */
function isUserFacing(track: MediaStreamTrack | undefined): boolean {
  if (!track) return false;
  const settings = typeof track.getSettings === "function" ? track.getSettings() : null;
  if (settings?.facingMode === "user") return true;
  return track.label.includes("FaceTime");
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// ── Decoders ──────────────────────────────────────────────────────────────

type BarcodeDetectorInstance = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type BarcodeDetectorClass = {
  new (options: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

/** Native `BarcodeDetector` when it reads QR codes, otherwise jsQR. */
async function createDetector(): Promise<FrameDetector> {
  const native = await nativeDetector();
  if (!native) return jsQrDetector();
  let fallback: Promise<FrameDetector> | null = null;
  return async (video) => {
    if (fallback) return (await fallback)(video);
    try {
      return await native(video);
    } catch (error) {
      // Some platforms expose the API without a working detection service.
      if (error instanceof DOMException && error.name === "NotSupportedError") {
        fallback = jsQrDetector();
        return (await fallback)(video);
      }
      throw error;
    }
  };
}

async function nativeDetector(): Promise<FrameDetector | null> {
  const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (typeof Detector !== "function") return null;
  try {
    const formats = typeof Detector.getSupportedFormats === "function" ? await Detector.getSupportedFormats() : null;
    if (formats && !formats.includes("qr_code")) return null;
    const detector = new Detector({ formats: ["qr_code"] });
    return async (video) => (await detector.detect(video)).map((barcode) => barcode.rawValue);
  } catch {
    return null;
  }
}

type JsQr = typeof jsQR;

async function jsQrDetector(): Promise<FrameDetector> {
  const decode = pickFunction(await import("jsqr"));
  if (!decode) throw new Error("jsQR unavailable");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas unavailable");
  return async (video) => {
    const scale = Math.min(1, MAX_DECODE_SIZE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    const code = decode(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "dontInvert" });
    return code ? [code.data] : [];
  };
}

/** The jsqr bundle is CommonJS; bundlers expose it as `default` (sometimes twice). */
function pickFunction(value: unknown, depth = 0): JsQr | null {
  if (typeof value === "function") return value as JsQr;
  if (depth < 2 && typeof value === "object" && value !== null && "default" in value) {
    return pickFunction((value as { default: unknown }).default, depth + 1);
  }
  return null;
}
