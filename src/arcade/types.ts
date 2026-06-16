import type { ArcadeEvent } from '../types.js';

export interface UploadUrlRequest {
  readonly contentType: string;
}

export interface UploadUrlResponse {
  readonly success: boolean;
  readonly uploadUrl: string;
  readonly uploadId: string;
}

export interface CreateArcadeRequest {
  readonly title: string;
  readonly description?: string;
  readonly uploadId: string;
  readonly events: readonly ArcadeEvent[];
}

export interface CreateArcadeResponse {
  readonly success: boolean;
  readonly arcadeId: string;
}

export type UpdateArcadeRequest = CreateArcadeRequest;
