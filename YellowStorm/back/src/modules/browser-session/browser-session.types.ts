export type NavAction =
  | { kind: 'goto'; url: string }
  | { kind: 'back' }
  | { kind: 'forward' }
  | { kind: 'reload' };

export type MouseButton = 'left' | 'right' | 'middle';

export type InputEvent =
  | { kind: 'mouse'; type: 'move' | 'down' | 'up'; x: number; y: number; button?: MouseButton }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: 'key'; type: 'down' | 'up'; key: string; text?: string };

export interface NavigatedEvent {
  url: string;
  title: string;
}

/** One live browser page, abstracted so the service is testable without Chromium. */
export interface EngineSession {
  onFrame(cb: (jpegBase64: string) => void): void;
  onNavigated(cb: (nav: NavigatedEvent) => void): void;
  dispatchInput(event: InputEvent): Promise<void>;
  navigate(action: NavAction): Promise<void>;
  currentUrl(): string;
  close(): Promise<void>;
}

export interface BrowserEngine {
  launchSession(startUrl: string): Promise<EngineSession>;
}

export const BROWSER_ENGINE = Symbol('BROWSER_ENGINE');

export type UrlSafetyFn = (url: string) => Promise<void>;
export const URL_SAFETY = Symbol('URL_SAFETY');

/** Emitted to the client over the socket. */
export type ClientEvent =
  | { event: 'frame'; payload: { data: string } }
  | { event: 'navigated'; payload: NavigatedEvent }
  | { event: 'blocked'; payload: { url: string; reason: string } }
  | { event: 'closed'; payload: { reason: string } };
