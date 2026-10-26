import { NainaAgent } from './agent/gemini-agent';

async function test() {
  console.log('🤖 Initializing Naina Agent with Gemini Flash...');
  const agent = new NainaAgent();

  const prompts = [
    'Hello! What time is check-in at the hotel?',
    'Do you have any rooms available from 2026-11-10 to 2026-11-12 for 2 guests?',
  ];

  for (const p of prompts) {
    console.log(`\n🗣️ Guest: "${p}"`);
    const reply = await agent.processUserMessage(p);
    console.log(`🎙️ Naina: "${reply}"`);
  }
}

test().catch(console.error);
