declare module 'cors' {
  import { RequestHandler } from 'express';
  function cors(options?: any): RequestHandler;
  export = cors;
}

declare module 'localtunnel' {
  interface TunnelOptions {
    port: number;
    subdomain?: string;
    host?: string;
  }
  interface Tunnel {
    url: string;
    close(): void;
    on(event: string, fn: (...args: any[]) => void): void;
  }
  function localtunnel(options: TunnelOptions): Promise<Tunnel>;
  export = localtunnel;
}

declare module 'untun' {
  export interface TunnelOptions {
    port: number;
    url?: string;
    acceptCloudflareNotice?: boolean;
    hostname?: string;
  }
  export interface Tunnel {
    getURL(): Promise<string>;
    close(): Promise<void>;
  }
  export function startTunnel(options: TunnelOptions): Promise<Tunnel>;
}
