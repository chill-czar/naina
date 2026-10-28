import { NainaAgent } from './agent/gemini-agent';

async function testStream() {
  console.log('Testing NainaAgent Streaming...\n');
  const agent = new NainaAgent();

  console.log('--- Test 1: Simple Question (Streaming Tokens) ---');
  let firstTokenTime = 0;
  const startTime = performance.now();

  for await (const event of agent.processUserMessageStream('What time is check-in and check-out?')) {
    if (event.type === 'token') {
      if (!firstTokenTime) {
        firstTokenTime = performance.now();
        console.log(`\n⚡ Time to First Token (TTFT): ${Math.round(firstTokenTime - startTime)}ms`);
        process.stdout.write('Tokens: ');
      }
      process.stdout.write(event.text);
    } else if (event.type === 'done') {
      console.log(`\n\nFull response: "${event.fullText}"`);
    }
  }

  console.log('\n--- Test 2: Tool Execution (Availability Query) ---');
  const t2Start = performance.now();
  let t2FirstToken = 0;

  for await (const event of agent.processUserMessageStream(
    'Do you have any rooms available from 2026-11-10 to 2026-11-12 for 2 guests?'
  )) {
    if (event.type === 'tool_call') {
      console.log(`🛠️ Tool Executed: ${event.name} (${event.durationMs}ms)`);
    } else if (event.type === 'token') {
      if (!t2FirstToken) {
        t2FirstToken = performance.now();
        console.log(`⚡ Time to First Token post-tool: ${Math.round(t2FirstToken - t2Start)}ms`);
        process.stdout.write('Tokens: ');
      }
      process.stdout.write(event.text);
    } else if (event.type === 'done') {
      console.log(`\n\nFull response: "${event.fullText}"`);
    }
  }

  console.log('\n🎉 Streaming test completed successfully!');
}

testStream().catch(console.error);
