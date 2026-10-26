import path from 'path';
import * as dotenv from 'dotenv';

// Load .env from local directory or monorepo root
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  cartesia: {
    apiKey: process.env.CARTESIA_API_KEY || '',
    voiceId: process.env.CARTESIA_VOICE_ID || 'a0e99841-438c-4a64-b679-ae501e7d6091', // default friendly concierge voice
    sttModel: 'ink-2',
    ttsModel: 'sonic',
  },
  livekit: {
    url: process.env.LIVEKIT_URL || '',
    apiKey: process.env.LIVEKIT_API_KEY || '',
    apiSecret: process.env.LIVEKIT_API_SECRET || '',
  },
};
