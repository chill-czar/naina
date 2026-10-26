import { synthesizeSpeechStream } from './pipeline/cartesia-bridge';
import * as fs from 'fs';
import * as path from 'path';

async function testTTS() {
  console.log('Testing Cartesia Sonic Speech Synthesis...');
  const testPhrase = 'Welcome to The Grand Naina Luxury Hotel. How may I assist you with your stay today?';

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const startTime = Date.now();
  let firstChunkTime = 0;

  for await (const chunk of synthesizeSpeechStream(testPhrase)) {
    if (chunks.length === 0) {
      firstChunkTime = Date.now() - startTime;
    }
    chunks.push(chunk);
    totalBytes += chunk.length;
  }

  console.log(`Time to First Audio Byte (TTFB): ${firstChunkTime}ms`);
  console.log(`Total Audio Chunks: ${chunks.length} (${totalBytes} bytes received)`);

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const outputPath = path.resolve(process.cwd(), 'test-output.pcm');
  fs.writeFileSync(outputPath, buffer);
  console.log(`Saved audio file to: ${outputPath}`);
}


testTTS().catch(console.error);
