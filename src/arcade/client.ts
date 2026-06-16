import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import * as logger from '../util/logger.js';
import type { ArcadeConfig } from '../types.js';
import type {
  UploadUrlRequest,
  UploadUrlResponse,
  CreateArcadeRequest,
  CreateArcadeResponse,
} from './types.js';

export class ArcadeClient {
  private readonly config: ArcadeConfig;

  constructor(config: ArcadeConfig) {
    this.config = config;
  }

  async generateUploadUrl(contentType: string): Promise<UploadUrlResponse> {
    const body: UploadUrlRequest = { contentType };

    if (this.config.dryRun) {
      logger.info('DRY RUN: generate-upload-url', { body });
      return { success: true, uploadUrl: 'https://dry-run.example.com/upload', uploadId: 'dry-run-upload-id' };
    }

    const response = await fetch(`${this.config.baseUrl}/generate-upload-url`, {
      method: 'POST',
      headers: {
        'authorization': this.config.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate upload URL: ${response.status} ${response.statusText}`);
    }

    return await response.json() as UploadUrlResponse;
  }

  async uploadVideo(uploadUrl: string, filePath: string): Promise<void> {
    if (this.config.dryRun) {
      logger.info('DRY RUN: upload video', { uploadUrl, filePath });
      return;
    }

    const fileStream = createReadStream(filePath);
    const webStream = Readable.toWeb(fileStream) as ReadableStream;

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'video/webm' },
      body: webStream,
      duplex: 'half',
    });

    if (!response.ok) {
      throw new Error(`Failed to upload video: ${response.status} ${response.statusText}`);
    }
  }

  async createArcade(request: CreateArcadeRequest): Promise<CreateArcadeResponse> {
    if (this.config.dryRun) {
      logger.info('DRY RUN: create arcade', { request });
      return { success: true, arcadeId: 'dry-run-arcade-id' };
    }

    const response = await fetch(`${this.config.baseUrl}/arcades`, {
      method: 'POST',
      headers: {
        'authorization': this.config.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Failed to create arcade: ${response.status} ${response.statusText}`);
    }

    return await response.json() as CreateArcadeResponse;
  }

  async updateArcade(arcadeId: string, request: CreateArcadeRequest): Promise<CreateArcadeResponse> {
    if (this.config.dryRun) {
      logger.info('DRY RUN: update arcade', { arcadeId, request });
      return { success: true, arcadeId };
    }

    const response = await fetch(`${this.config.baseUrl}/arcades/${arcadeId}`, {
      method: 'PUT',
      headers: {
        'authorization': this.config.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Failed to update arcade: ${response.status} ${response.statusText}`);
    }

    return await response.json() as CreateArcadeResponse;
  }
}
