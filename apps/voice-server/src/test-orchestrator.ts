import { VoiceOrchestrator } from './pipeline/orchestrator';

async function testOrchestrator() {
  console.log('Testing VoiceOrchestrator Pipeline...');
  const orchestrator = new VoiceOrchestrator();

  let audioChunksReceived = 0;
  let totalBytes = 0;

  orchestrator.on('stateChange', (state) => {
    console.log(`[orchestrator state] ${state}`);
  });

  orchestrator.on('agentSpeechChunk', (chunk: Uint8Array) => {
    audioChunksReceived++;
    totalBytes += chunk.length;
  });

  orchestrator.on('bargeIn', () => {
    console.log('[orchestrator] barge-in triggered');
  });

  orchestrator.startSession();

  console.log('\nGuest: "What are your check-in and check-out times?"');
  await orchestrator.handleUserTurn('What are your check-in and check-out times?');

  console.log(`Received ${audioChunksReceived} audio chunks (${totalBytes} bytes)`);
  orchestrator.endSession();
}


testOrchestrator().catch(console.error);
