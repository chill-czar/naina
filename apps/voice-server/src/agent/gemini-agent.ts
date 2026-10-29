import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { config } from '../config';
import {
  checkAvailability,
  createReservation,
  getReservationByReference,
  getFolioByRoomNumber,
} from '@naina/hotel-pms-core';

const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

export const NAINA_SYSTEM_INSTRUCTION = `You are "Naina", front-desk concierge for The Grand Naina Luxury Hotel.
RULES:
1. Spoken voice dialogue only: NEVER use asterisks (*), markdown formatting, bullets, or tables.
2. Currency: Speak naturally (e.g. say "one hundred eighty-nine dollars").
3. Concise: 1 to 2 sentences per turn. Never overwhelm caller.
4. Booking: Confirm room type, dates, guest name, and total cost before finalizing.
5. Check-in is at 3:00 PM, Check-out is at 11:00 AM.
6. Present tool results directly without repeating introductory chatter.`;

const checkAvailabilityTool: FunctionDeclaration = {
  name: 'checkAvailability',
  description: 'Check available rooms, pricing, and counts for dates.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      checkInDate: { type: Type.STRING, description: 'YYYY-MM-DD' },
      checkOutDate: { type: Type.STRING, description: 'YYYY-MM-DD' },
      numberOfGuests: { type: Type.INTEGER, description: 'Guest count' },
      roomTypeCode: { type: Type.STRING, description: 'DELUXE_KING, EXECUTIVE_SUITE, or STANDARD_QUEEN' },
    },
    required: ['checkInDate', 'checkOutDate'],
  },
};

const createReservationTool: FunctionDeclaration = {
  name: 'createReservation',
  description: 'Create confirmed room booking.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      firstName: { type: Type.STRING, description: 'First name' },
      lastName: { type: Type.STRING, description: 'Last name' },
      email: { type: Type.STRING, description: 'Email' },
      phone: { type: Type.STRING, description: 'Phone' },
      roomTypeId: { type: Type.STRING, description: 'Room type UUID' },
      checkInDate: { type: Type.STRING, description: 'YYYY-MM-DD' },
      checkOutDate: { type: Type.STRING, description: 'YYYY-MM-DD' },
      numberOfGuests: { type: Type.INTEGER, description: 'Guest count' },
      specialRequests: { type: Type.STRING, description: 'Requests' },
    },
    required: ['firstName', 'lastName', 'email', 'phone', 'roomTypeId', 'checkInDate', 'checkOutDate'],
  },
};

const getReservationTool: FunctionDeclaration = {
  name: 'getReservation',
  description: 'Lookup existing reservation by booking reference (e.g. NAINA-1234).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      bookingReference: { type: Type.STRING, description: 'Booking code' },
    },
    required: ['bookingReference'],
  },
};

const getFolioTool: FunctionDeclaration = {
  name: 'getFolioBalance',
  description: 'Get current billing folio and balance for a room number.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      roomNumber: { type: Type.STRING, description: 'Room number (e.g. 101)' },
    },
    required: ['roomNumber'],
  },
};

function getToolFillerPhrase(toolName: string): string {
  switch (toolName) {
    case 'checkAvailability':
      return 'Let me check available rooms for those dates right away.';
    case 'createReservation':
      return 'I am preparing your reservation confirmation now. One moment please.';
    case 'getReservation':
      return 'Let me pull up your reservation details.';
    case 'getFolioBalance':
      return 'Let me look up your current room charges and folio balance.';
    default:
      return 'One moment please, let me check that for you.';
  }
}

async function executeTool(name: string, args: Record<string, any>): Promise<any> {
  console.log('[tool]', name, args);
  switch (name) {
    case 'checkAvailability':
      return await checkAvailability(args as any);
    case 'createReservation':
      return await createReservation(args as any);
    case 'getReservation':
      return await getReservationByReference(args.bookingReference);
    case 'getFolioBalance':
      return await getFolioByRoomNumber(args.roomNumber);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export interface AgentResponseResult {
  text: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, any>;
    durationMs: number;
  }>;
  totalToolDurationMs: number;
}

export type AgentStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'filler'; text: string }
  | {
      type: 'tool_call';
      name: string;
      args: Record<string, any>;
      durationMs: number;
    }
  | {
      type: 'done';
      fullText: string;
      toolCalls: Array<{ name: string; args: Record<string, any>; durationMs: number }>;
      totalToolDurationMs: number;
    };

export class NainaAgent {
  private chatSession: any;

  constructor(initialHistory?: any[]) {
    this.chatSession = ai.chats.create({
      model: config.gemini.model,
      history: initialHistory && initialHistory.length > 0 ? initialHistory : undefined,
      config: {
        systemInstruction: NAINA_SYSTEM_INSTRUCTION,
        temperature: 0.3,
        thinkingConfig: {
          thinkingBudget: 0,
        },
        tools: [{ functionDeclarations: [checkAvailabilityTool, createReservationTool, getReservationTool, getFolioTool] }],
      },
    });
  }

  public async getHistory(): Promise<any[]> {
    try {
      return await this.chatSession.getHistory();
    } catch {
      return [];
    }
  }

  async *processUserMessageStream(
    userTranscript: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentStreamEvent> {
    const toolCalls: Array<{ name: string; args: Record<string, any>; durationMs: number }> = [];
    let totalToolDurationMs = 0;
    let fullText = '';

    let currentMessage: any = userTranscript;

    while (!signal?.aborted) {
      const stream = await this.chatSession.sendMessageStream({ message: currentMessage });
      const pendingFunctionCalls: any[] = [];

      for await (const chunk of stream) {
        if (signal?.aborted) return;

        if (chunk.functionCalls && chunk.functionCalls.length > 0) {
          pendingFunctionCalls.push(...chunk.functionCalls);
        }

        if (chunk.text) {
          fullText += chunk.text;
          yield { type: 'token', text: chunk.text };
        }
      }

      if (pendingFunctionCalls.length === 0) {
        break;
      }

      // Immediately yield conversational filler so audio starts playing while tool executes!
      const firstCallName = pendingFunctionCalls[0]?.name;
      const fillerPhrase = getToolFillerPhrase(firstCallName);
      yield { type: 'filler', text: fillerPhrase };

      // Execute tool calls in background while caller listens to filler
      const functionResponses = [];
      for (const call of pendingFunctionCalls) {
        if (signal?.aborted) return;
        const tStart = performance.now();
        const toolResult = await executeTool(call.name, call.args);
        const duration = Math.round(performance.now() - tStart);

        const callRecord = {
          name: call.name,
          args: call.args,
          durationMs: duration,
        };
        toolCalls.push(callRecord);
        totalToolDurationMs += duration;

        yield {
          type: 'tool_call',
          name: call.name,
          args: call.args,
          durationMs: duration,
        };

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: { result: toolResult },
          },
        });
      }

      currentMessage = functionResponses;
    }

    yield {
      type: 'done',
      fullText,
      toolCalls,
      totalToolDurationMs,
    };
  }

  async processUserMessage(userTranscript: string): Promise<AgentResponseResult> {
    let fullText = '';
    const toolCalls: Array<{ name: string; args: Record<string, any>; durationMs: number }> = [];
    let totalToolDurationMs = 0;

    for await (const event of this.processUserMessageStream(userTranscript)) {
      if (event.type === 'token') {
        fullText += event.text;
      } else if (event.type === 'tool_call') {
        toolCalls.push({
          name: event.name,
          args: event.args,
          durationMs: event.durationMs,
        });
        totalToolDurationMs += event.durationMs;
      } else if (event.type === 'done') {
        fullText = event.fullText;
        return {
          text: fullText,
          toolCalls: event.toolCalls,
          totalToolDurationMs: event.totalToolDurationMs,
        };
      }
    }

    return {
      text: fullText,
      toolCalls,
      totalToolDurationMs,
    };
  }
}

