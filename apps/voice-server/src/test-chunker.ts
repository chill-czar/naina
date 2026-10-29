import assert from 'assert';
import { SentenceChunker } from './pipeline/sentence-chunker';

async function testSentenceChunker() {
  console.log('🧪 Starting SentenceChunker TDD Verification Suite...\n');

  // Test 1: Standard sentence boundaries (. ! ?)
  console.log('1️⃣ Testing terminal punctuation splitting (. ! ?)...');
  const chunker1 = new SentenceChunker();
  const tokenStream1 = ['Good ', 'morning! ', 'How ', 'can ', 'I ', 'assist ', 'you ', 'today?'];
  const outputSentences1: string[] = [];

  for (const token of tokenStream1) {
    const chunk = chunker1.addToken(token);
    if (chunk) {
      outputSentences1.push(chunk);
    }
  }
  const remaining1 = chunker1.flush();
  if (remaining1) {
    outputSentences1.push(remaining1);
  }

  assert.deepStrictEqual(outputSentences1, [
    'Good morning!',
    'How can I assist you today?',
  ]);
  console.log('  ✅ Successfully split into 2 sentences at "!" and "?":', outputSentences1);

  // Test 2: Irregular and split tokens (e.g. "con", "cierge.")
  console.log('\n2️⃣ Testing split syllables across token boundaries...');
  const chunker2 = new SentenceChunker();
  const tokenStream2 = ['I ', 'am ', 'Nai', 'na, ', 'your ', 'con', 'cierge. ', 'Wel', 'come!'];
  const outputSentences2: string[] = [];

  for (const token of tokenStream2) {
    const chunk = chunker2.addToken(token);
    if (chunk) {
      outputSentences2.push(chunk);
    }
  }
  const remaining2 = chunker2.flush();
  if (remaining2) {
    outputSentences2.push(remaining2);
  }

  // "I am Naina," has >= 3 words, so comma can act as a natural speech clause boundary
  assert.ok(outputSentences2.length >= 2, 'Should split on punctuation');
  assert.ok(outputSentences2.join(' ').includes('concierge'), 'Should correctly reconstruct split word "concierge"');
  console.log('  ✅ Word reconstruction and clause splitting verified:', outputSentences2);

  // Test 3: Flush trailing text without terminal punctuation
  console.log('\n3️⃣ Testing stream completion flush without terminal punctuation...');
  const chunker3 = new SentenceChunker();
  const tokenStream3 = ['We ', 'have ', 'two ', 'deluxe ', 'ocean ', 'suites'];
  const outputSentences3: string[] = [];

  for (const token of tokenStream3) {
    const chunk = chunker3.addToken(token);
    if (chunk) outputSentences3.push(chunk);
  }
  const remaining3 = chunker3.flush();
  if (remaining3) outputSentences3.push(remaining3);

  assert.deepStrictEqual(outputSentences3, ['We have two deluxe ocean suites']);
  console.log('  ✅ Stream flush successfully emitted incomplete trailing text:', outputSentences3);

  // Test 4: Async generator streaming helper
  console.log('\n4️⃣ Testing Async Generator streaming wrapper...');
  async function* mockTokenGenerator() {
    yield 'Certainly! ';
    yield 'Let ';
    yield 'me ';
    yield 'check ';
    yield 'the ';
    yield 'availability ';
    yield 'for ';
    yield 'you. ';
    yield 'One ';
    yield 'moment.';
  }

  const chunker4 = new SentenceChunker();
  const streamedChunks: string[] = [];
  for await (const sentence of chunker4.chunkStream(mockTokenGenerator())) {
    streamedChunks.push(sentence);
  }

  assert.strictEqual(streamedChunks.length, 3);
  assert.strictEqual(streamedChunks[0], 'Certainly!');
  assert.strictEqual(streamedChunks[1], 'Let me check the availability for you.');
  assert.strictEqual(streamedChunks[2], 'One moment.');
  console.log('  ✅ Async generator yielded 3 sentences cleanly:', streamedChunks);

  // Test 5: 2-word first-clause fast path
  console.log('\n5️⃣ Testing 2-word first-clause fast-path splitting...');
  const chunker5 = new SentenceChunker();
  const tokenStream5 = ['Sure ', 'thing, ', 'let ', 'me ', 'check ', 'that ', 'right ', 'away.'];
  const outputSentences5: string[] = [];
  for (const token of tokenStream5) {
    const chunk = chunker5.addToken(token);
    if (chunk) outputSentences5.push(chunk);
  }
  const remaining5 = chunker5.flush();
  if (remaining5) outputSentences5.push(remaining5);

  assert.strictEqual(outputSentences5[0], 'Sure thing,');
  assert.strictEqual(outputSentences5[1], 'let me check that right away.');
  console.log('  ✅ 2-word first-clause fast-path emitted immediately:', outputSentences5);

  console.log('\n🎉 ALL SENTENCE CHUNKER TESTS PASSED SUCCESSFULLY!\n');
}

testSentenceChunker().catch((err) => {
  console.error('❌ SentenceChunker test failed:', err);
  process.exit(1);
});
