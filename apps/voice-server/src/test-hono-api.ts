import { app } from './index';

async function runHonoApiTests() {
  console.log('=== Starting Hono API Integration Tests ===\n');
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

  // 1. Health Endpoint Test
  console.log('[Test 1] Health Endpoint: GET /health and /api/health');
  const resHealth = await app.request('/health');
  assert(resHealth.status === 200, 'GET /health returned HTTP 200');
  const healthJson = await resHealth.json();
  assert(healthJson.status === 'ok', 'GET /health body has status: ok');
  assert(healthJson.service.includes('Hono'), 'Service indicates Hono framework');

  // 2. Token Generation Endpoint Test
  console.log('\n[Test 2] LiveKit Token Endpoint: POST /api/token');
  const resToken = await app.request('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomName: 'test-hono-suite-room',
      participantName: 'test-guest-42',
    }),
  });
  assert(resToken.status === 200, 'POST /api/token returned HTTP 200');
  const tokenJson = await resToken.json();
  assert(typeof tokenJson.token === 'string' && tokenJson.token.length > 20, 'LiveKit JWT token returned');
  assert(tokenJson.roomName === 'test-hono-suite-room', 'Room name matches request');
  assert(tokenJson.participantName === 'test-guest-42', 'Participant name matches request');

  // 3. Telemetry Endpoint Test
  console.log('\n[Test 3] Telemetry Endpoint: GET /api/telemetry');
  const resTelemetry = await app.request('/api/telemetry');
  assert(resTelemetry.status === 200, 'GET /api/telemetry returned HTTP 200');
  const telemetryJson = await resTelemetry.json();
  assert(Array.isArray(telemetryJson.turns), 'Telemetry returns turns array');

  // 4. PMS Rooms Availability Endpoint Test
  console.log('\n[Test 4] Rooms Availability Endpoint: GET /api/rooms');
  const resRooms = await app.request('/api/rooms?checkInDate=2026-11-01&checkOutDate=2026-11-04&guests=2');
  assert(resRooms.status === 200, 'GET /api/rooms returned HTTP 200');
  const roomsJson = await resRooms.json();
  assert(Array.isArray(roomsJson.rooms) && roomsJson.rooms.length > 0, 'Rooms availability returned non-empty list');
  console.log(`      Found ${roomsJson.rooms.length} available room types in PMS.`);

  // 5. Session State Persistence & Room Hold Test
  console.log('\n[Test 5] Call Session Persistence & Room Hold: /api/session/:id');
  const testSessionId = `test_hono_session_${Date.now()}`;

  // Save session state
  const resSaveSession = await app.request(`/api/session/${testSessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guestPhone: '+1-555-0199',
      collectedEntities: {
        guestName: 'Sarah Connor',
        roomType: 'DELUXE_KING',
      },
    }),
  });
  assert(resSaveSession.status === 200, 'POST /api/session/:id returned HTTP 200');
  const savedJson = await resSaveSession.json();
  assert(savedJson.success === true, 'Session save reported success');

  // Query saved session
  const resGetSession = await app.request(`/api/session/${testSessionId}`);
  assert(resGetSession.status === 200, 'GET /api/session/:id returned HTTP 200');
  const getJson = await resGetSession.json();
  assert(getJson.session.id === testSessionId, 'Retrieved session ID matches');
  assert(getJson.session.guestPhone === '+1-555-0199', 'Retrieved guest phone matches');
  assert(getJson.session.collectedEntities.guestName === 'Sarah Connor', 'Retrieved collected entity matches');

  // Test 5-minute atomic room hold
  const resHold = await app.request(`/api/session/${testSessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'hold',
      roomTypeId: 'DELUXE_KING',
      checkInDate: '2026-11-10',
      checkOutDate: '2026-11-12',
    }),
  });
  assert(resHold.status === 200, 'POST /api/session/:id (hold) returned HTTP 200');
  const holdJson = await resHold.json();
  assert(holdJson.success === true && holdJson.hold.holdId.startsWith('hold_'), '5-minute room hold successfully created');
  console.log(`      Hold created: ${holdJson.hold.holdId}, expires at ${holdJson.hold.expiresAt}`);

  console.log(`\n=== Test Results: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runHonoApiTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
