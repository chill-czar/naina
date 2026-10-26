import { config } from './config';

async function main() {
  console.log('🎙️ Starting Naina Voice AI Server...');
  console.log(`📡 Port: ${config.port}`);
  console.log(`🤖 Gemini Model: ${config.gemini.model}`);
  console.log(`🗣️ Cartesia STT: ${config.cartesia.sttModel} | TTS: ${config.cartesia.ttsModel}`);
  console.log(`⚡ LiveKit Endpoint: ${config.livekit.url || '(not configured yet)'}`);

  console.log('✅ Naina Voice Server initialized successfully!');
}

main().catch((err) => {
  console.error('❌ Server startup error:', err);
  process.exit(1);
});
