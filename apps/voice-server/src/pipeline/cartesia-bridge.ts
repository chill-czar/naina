import { Cartesia } from '@cartesia/cartesia-js';
import { config } from '../config';

export const cartesia = new Cartesia({
  apiKey: config.cartesia.apiKey,
});

export async function* synthesizeSpeechStream(text: string): AsyncGenerator<Uint8Array> {
  if (!text.trim()) return;

  let response: any;
  try {
    response = await cartesia.tts.generate({
      model_id: config.cartesia.ttsModel,
      transcript: text,
      voice: {
        mode: 'id',
        id: config.cartesia.voiceId,
      },
      output_format: {
        container: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: 24000,
      },
    });
  } catch (err: any) {
    if (err?.status === 402 || err?.message?.includes('402')) {
      throw new Error('Cartesia credit limit reached (HTTP 402 Payment Required). Please upgrade your subscription or add credits at https://play.cartesia.ai/subscription');
    }
    throw err;
  }

  if (!response?.body) {
    throw new Error('No audio body stream returned from Cartesia TTS');
  }

  const reader = response.body.getReader();
  let leftover: Uint8Array | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        let chunk = value;
        if (leftover && leftover.length > 0) {
          const merged = new Uint8Array(leftover.length + chunk.length);
          merged.set(leftover, 0);
          merged.set(chunk, leftover.length);
          chunk = merged;
          leftover = null;
        }

        // 16-bit PCM sample alignment
        const odd = chunk.length % 2;
        if (odd !== 0) {
          leftover = chunk.slice(chunk.length - odd);
          chunk = chunk.subarray(0, chunk.length - odd);
        }

        if (chunk.length > 0) {
          yield chunk;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createSTTStream(sampleRate = 16000) {
  return cartesia.stt.autoFinalize.websocket({
    model: config.cartesia.sttModel,
    encoding: 'pcm_s16le',
    sample_rate: sampleRate,
    turn_end_timeout_ms: 640,
  });
}

