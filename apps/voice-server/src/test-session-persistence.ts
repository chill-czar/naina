import { saveCallSession, getCallSession, createRoomHold } from '@naina/hotel-pms-core';
import { NainaAgent } from './agent/gemini-agent';
import { VoiceOrchestrator } from './pipeline/orchestrator';

async function runSessionPersistenceTests() {
  console.log('=== Starting Session Persistence & Resumption Tests ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${desc}`);
      failed++;
    }
  }

  const simulatedRoomId = `room_resumption_test_${Date.now()}`;

  // 1. Save Initial Session & Room Hold
  console.log('[Test 1] Create initial session state with room hold');
  const hold = await createRoomHold({
    sessionId: simulatedRoomId,
    guestPhone: '+1-555-8822',
    roomTypeId: 'DELUXE_KING',
    checkInDate: '2026-11-05',
    checkOutDate: '2026-11-08',
  });
  assert(typeof hold.holdId === 'string' && hold.holdId.startsWith('hold_'), 'Hold ID generated');

  // Verify stored session
  const storedSession = await getCallSession(simulatedRoomId);
  assert(storedSession !== null, 'Session successfully retrieved from storage');
  assert(storedSession?.state === 'HOLD_PENDING', 'Session state is HOLD_PENDING');
  assert(storedSession?.activeHoldId === hold.holdId, 'Active hold ID matches in session');
  assert(storedSession?.collectedEntities?.roomTypeId === 'DELUXE_KING', 'Collected entity roomTypeId matches');

  // 2. Simulate Dialogue History Generation and Saving
  console.log('\n[Test 2] Simulate dialogue history persistence across turns');
  const mockHistory: Array<{ role: 'user' | 'model'; parts: any[] }> = [
    {
      role: 'user',
      parts: [{ text: 'Hello, do you have a Deluxe King for November 5th to 8th?' }],
    },
    {
      role: 'model',
      parts: [
        {
          text: 'Yes! We have a Deluxe King available from November 5th to 8th at two hundred and forty-nine dollars per night. Would you like me to hold that for you?',
        },
      ],
    },
  ];

  await saveCallSession({
    id: simulatedRoomId,
    turnsHistory: mockHistory,
    turnCount: 1,
    state: 'ACTIVE',
  });

  const sessionWithHistory = await getCallSession(simulatedRoomId);
  assert(sessionWithHistory?.turnsHistory.length === 2, 'Dialogue history stored with 2 turns');

  // 3. Simulate Abrupt Socket Disconnect and Worker Re-hydration
  console.log('\n[Test 3] Simulate drop and rehydration in new VoiceOrchestrator worker');
  // Re-hydrate in a fresh orchestrator instance
  const rehydratedOrchestrator = new VoiceOrchestrator({
    sessionId: simulatedRoomId,
    initialHistory: sessionWithHistory?.turnsHistory,
  });

  assert(rehydratedOrchestrator.getSessionId() === simulatedRoomId, 'Worker initialized with matching sessionId');
  const hydratedHistory = await rehydratedOrchestrator.getSessionHistory();
  assert(hydratedHistory.length === 2, 'Worker agent successfully hydrated with 2 turns of past context');
  assert(
    hydratedHistory[0].parts[0].text.includes('Deluxe King for November 5th to 8th'),
    'First turn user query preserved verbatim'
  );

  console.log(`\n=== Test Results: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSessionPersistenceTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
