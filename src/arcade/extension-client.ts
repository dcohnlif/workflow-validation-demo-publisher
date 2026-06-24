/**
 * Client for Arcade's internal extension API endpoints.
 * Uses cookie-based auth (same as the Chrome extension).
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import * as logger from '../util/logger.js';
import type { ArcadeAuth } from './auth.js';
import { ensureValidAuth } from './auth.js';

const BASE_URL = 'https://app.arcade.software';

export interface UploadUrlResponse {
  readonly publicUrl: string;
  readonly uploadUrl: string;
  readonly contentType: string;
}

export interface PageContext {
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly width: number;
  readonly height: number;
  readonly language: string | null;
}

export interface ImageStepRequest {
  readonly flowId: string;
  readonly assetId: string;
  readonly url: string;       // publicUrl from upload
  readonly x?: number;        // normalized 0-1
  readonly y?: number;        // normalized 0-1
  readonly useAI: boolean;
  readonly hasHTML: boolean;
  readonly pageContext?: PageContext;
}

export interface ImageStepResponse {
  readonly aspectRatio?: number;
  readonly blurhash?: string;
  readonly size?: { readonly width: number; readonly height: number };
}

export interface DemoEndRequest {
  readonly flowId: string;
  readonly capturedEvents: readonly CapturedEvent[];
  readonly screenshots: Record<string, { dataUrl: string; blurhash?: string; size?: { width: number; height: number } }>;
  readonly tabs: Record<string, unknown>;
  readonly videoTimestampWindows: readonly [number, number][];
  readonly pageContexts: Record<string, unknown>;
  readonly clickContexts: Record<string, unknown>;
  readonly capturedHTML: Record<string, unknown>;
  readonly links: Record<string, unknown>;
  readonly endedAt: number;
  readonly useAI: boolean;
  readonly hasHTML: boolean;
  readonly videoBlobUrl?: string;
}

export interface CapturedEvent {
  readonly type: 'click' | 'scroll' | 'keypress' | 'input' | 'drag';
  readonly clickId?: string;
  readonly timeMs: number;
  readonly tabId?: number;
  readonly frameId?: number;
  readonly frameX?: number;
  readonly frameY?: number;
  readonly pageContext?: PageContext;
}

export class ExtensionClient {
  private auth: ArcadeAuth;

  constructor(auth: ArcadeAuth) {
    this.auth = auth;
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    this.auth = await ensureValidAuth(this.auth);

    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.auth.cookie,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${path} failed: ${response.status} ${text}`);
    }

    return await response.json() as T;
  }

  async demoStart(name: string): Promise<string> {
    const data = await this.request<{ id: string }>('/api/extension/demo-start', {
      chromeExtensionVersion: '1.9.10',
      name,
      useAI: false,
    });
    logger.info('Demo started', { flowId: data.id });
    return data.id;
  }

  async getUploadUrl(flowId: string, type: 'image' | 'video'): Promise<UploadUrlResponse> {
    return this.request<UploadUrlResponse>('/api/extension/upload-url', {
      flowId,
      type,
    });
  }

  async uploadFile(uploadUrl: string, contentType: string, filePath: string): Promise<void> {
    this.auth = await ensureValidAuth(this.auth);

    const fileSize = (await stat(filePath)).size;
    const fileStream = createReadStream(filePath);
    const webStream = (await import('node:stream')).Readable.toWeb(fileStream) as ReadableStream;

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
      },
      body: webStream,
      duplex: 'half' as const,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`File upload failed: ${response.status} ${text}`);
    }
  }

  async registerImageStep(req: ImageStepRequest): Promise<ImageStepResponse> {
    return this.request<ImageStepResponse>('/api/extension/image', req);
  }

  async createMuxAsset(publicUrl: string, flowId: string): Promise<void> {
    await this.request<unknown>('/api/mux/create-asset', {
      source: 'extension-record-demo',
      sourceUrl: publicUrl,
      uploadId: flowId,
      flowId,
    });
    logger.info('Mux asset created', { flowId });
  }

  async demoEnd(req: DemoEndRequest): Promise<unknown> {
    return this.request<unknown>('/api/extension/demo-end', req);
  }

  async demoStatus(flowId: string, status: string, description = ''): Promise<void> {
    await this.request<unknown>('/api/extension/demo-status', {
      id: flowId,
      status,
      description,
    });
  }
}
