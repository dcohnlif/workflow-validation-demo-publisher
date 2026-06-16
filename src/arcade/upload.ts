import * as logger from '../util/logger.js';
import type { ArcadeClient } from './client.js';

export async function uploadWorkflowVideo(
  client: ArcadeClient,
  videoPath: string,
): Promise<string> {
  logger.info('Generating upload URL...');
  const { uploadUrl, uploadId } = await client.generateUploadUrl('video/webm');

  logger.info('Uploading video...', { videoPath, uploadId });
  await client.uploadVideo(uploadUrl, videoPath);

  logger.info('Video uploaded successfully', { uploadId });
  return uploadId;
}
