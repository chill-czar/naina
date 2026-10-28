/**
 * Sentence and Clause Boundary Chunker
 *
 * Buffers streaming LLM tokens and yields complete, natural speech sentences/clauses
 * to Text-to-Speech (TTS) as soon as punctuation boundaries are reached.
 */
export class SentenceChunker {
  private buffer = '';
  private minWordsForCommaSplit: number;

  constructor(options?: { minWordsForCommaSplit?: number }) {
    this.minWordsForCommaSplit = options?.minWordsForCommaSplit ?? 3;
  }

  /**
   * Adds an incoming token and returns a complete sentence/clause if a boundary is reached,
   * or null if more tokens are required.
   */
  public addToken(token: string): string | null {
    this.buffer += token;

    // Check for terminal punctuation (. ! ?) followed by whitespace or end
    // Avoid splitting on decimals (e.g. 3.5) or common honorifics
    const terminalMatch = this.buffer.match(/([.!?]+)(?:\s+|$)/);
    if (terminalMatch && terminalMatch.index !== undefined) {
      const matchEnd = terminalMatch.index + terminalMatch[0].length;
      const candidate = this.buffer.slice(0, matchEnd).trim();

      // Avoid splitting on common abbreviations: Mr., Ms., Dr., etc.
      if (!candidate.match(/\b(Mr|Mrs|Ms|Dr|vs|etc)\.$/i)) {
        this.buffer = this.buffer.slice(matchEnd);
        return candidate;
      }
    }

    // Check for comma or colon/semicolon clause boundary if enough words exist
    const words = this.buffer.trim().split(/\s+/);
    if (words.length >= this.minWordsForCommaSplit) {
      const clauseMatch = this.buffer.match(/([,;:]+)\s+/);
      if (clauseMatch && clauseMatch.index !== undefined) {
        const matchEnd = clauseMatch.index + clauseMatch[0].length;
        const candidate = this.buffer.slice(0, matchEnd).trim();
        this.buffer = this.buffer.slice(matchEnd);
        return candidate;
      }
    }

    return null;
  }

  /**
   * Flushes any remaining incomplete text in the buffer when the stream concludes.
   */
  public flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining.length > 0 ? remaining : null;
  }

  /**
   * Helper generator to stream sentences directly from an async token stream.
   */
  public async *chunkStream(
    tokenStream: AsyncIterable<string>,
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    this.buffer = '';

    for await (const token of tokenStream) {
      if (signal?.aborted) {
        this.buffer = '';
        return;
      }

      const sentence = this.addToken(token);
      if (sentence) {
        yield sentence;
      }
    }

    if (signal?.aborted) {
      this.buffer = '';
      return;
    }

    const trailing = this.flush();
    if (trailing) {
      yield trailing;
    }
  }
}
