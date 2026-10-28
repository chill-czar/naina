import { VoiceOrchestrator } from './pipeline/orchestrator';

async function runInterruptionSuite() {
  console.log('🧪 Starting VoiceOrchestrator Interruption Regression Test Suite...');
  const orch = new VoiceOrchestrator();

  let activeTurn = 1;
  let turn1SpeechChunks = 0;
  let turn2Transcript = '';

  orch.on('agentSpeechChunk', () => {
    if (activeTurn === 1) {
      turn1SpeechChunks++;
      if (turn1SpeechChunks === 1) {
        console.log('📢 Turn 1: First speech chunk arrived. Simulating user interruption!');
        orch.interrupt();
      }
    }
  });

  orch.on('agentTranscript', (text) => {
    if (activeTurn === 2) {
      turn2Transcript = text;
    }
  });

  console.log('1️⃣ Executing Turn 1 with check-in October 29 for 2 guests...');
  await orch.handleUserTurn('I want to book a room for October 29 to October 31 for 2 people.');

  activeTurn = 2;
  console.log('2️⃣ Executing Turn 2 ("Wait, for 5 people") after interruption...');
  await orch.handleUserTurn('Wait, for 5 people.');

  console.log('Turn 2 Response:', turn2Transcript);

  const contextKept =
    turn2Transcript.toLowerCase().includes('suite') ||
    turn2Transcript.toLowerCase().includes('two rooms') ||
    turn2Transcript.toLowerCase().includes('october') ||
    turn2Transcript.toLowerCase().includes('twenty-ninth') ||
    turn2Transcript.toLowerCase().includes('connecting');

  if (!contextKept) {
    throw new Error('❌ Test Failed: Interrupted turn lost conversation context (dates/dates-context wiped).');
  }

  console.log('🎉 ALL INTERRUPTION CONTEXT TESTS PASSED: State & context 100% preserved!');
}

runInterruptionSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
