declare module '@novnc/novnc' {
  export default class RFB {
    constructor(
      target: HTMLElement,
      url: string,
      options?: { credentials?: { password?: string } },
    );
    viewOnly: boolean;
    scaleViewport: boolean;
    disconnect(): void;
    addEventListener(event: string, listener: (...args: any[]) => void): void;
  }
}
