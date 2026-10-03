import { startTunnel } from 'untun';
import localtunnel from 'localtunnel';

export interface TunnelResult {
  url: string;
  provider: 'cloudflare' | 'localtunnel';
  close: () => Promise<void>;
}

export async function createPublicTunnel(port: number): Promise<TunnelResult> {
  // Try Cloudflare Quick Tunnel first (untun)
  try {
    const tunnel = await startTunnel({
      port,
      acceptCloudflareNotice: true,
    });

    if (tunnel) {
      const url = await tunnel.getURL();
      if (url && url.startsWith('http')) {
        return {
          url: url.replace(/\/$/, ''),
          provider: 'cloudflare',
          close: async () => {
            await tunnel.close();
          },
        };
      }
    }
  } catch (err: any) {
    // Cloudflare tunnel failed, fallback to localtunnel
  }

  // Fallback to localtunnel
  try {
    const lt = await localtunnel({ port });
    return {
      url: lt.url.replace(/\/$/, ''),
      provider: 'localtunnel',
      close: async () => {
        lt.close();
      },
    };
  } catch (err: any) {
    throw new Error(`Failed to create public tunnel: ${err.message}`);
  }
}
