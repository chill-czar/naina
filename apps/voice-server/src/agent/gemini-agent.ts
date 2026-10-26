import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { config } from '../config';
import {
  checkAvailability,
  createReservation,
  getReservationByReference,
  cancelReservation,
  getFolioByRoomNumber,
} from '@naina/hotel-pms-core';

// 1. Initialize the official Google Gen AI SDK
const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

// 2. Define the Spoken Persona & Voice Prompt Rules
export const NAINA_SYSTEM_INSTRUCTION = `
You are "Naina", the warm, professional, and efficient virtual front-desk concierge for The Grand Naina Luxury Hotel & Residences.

CRITICAL VOICE & SPEECH GUIDELINES:
1. Natural Spoken Dialogue: You are speaking aloud over a phone/voice call, NOT writing in a text chat.
2. No Markdown Formatting: NEVER use asterisks (*), markdown lists, bullet points, headers, or markdown tables.
3. Natural Numbers & Currency: Always speak prices naturally (e.g. say "one hundred and eighty-nine dollars", NOT "$189.00").
4. Concise & Conversational: Keep responses under 2 to 3 sentences whenever possible. Do not overwhelm the caller.
5. Confirmation Before Action: When booking, always confirm room type, dates, guest name, and total cost before finalizing.
6. Available Amenities: The hotel features an infinity rooftop pool, 24/7 fitness spa, luxury dining at The Grand Veranda, and valet parking.
7. Check-in is at 3:00 PM, and Check-out is at 11:00 AM.
`;

// 3. Declare Hotel Tools (Function Declarations for Gemini)
const checkAvailabilityTool: FunctionDeclaration = {
  name: 'checkAvailability',
  description: 'Check available room types, pricing, and counts for specific dates.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      checkInDate: {
        type: Type.STRING,
        description: 'Check-in date in YYYY-MM-DD format (e.g. 2026-11-01)',
      },
      checkOutDate: {
        type: Type.STRING,
        description: 'Check-out date in YYYY-MM-DD format (e.g. 2026-11-03)',
      },
      numberOfGuests: {
        type: Type.INTEGER,
        description: 'Number of guests staying',
      },
      roomTypeCode: {
        type: Type.STRING,
        description: 'Optional filter: DELUXE_KING, EXECUTIVE_SUITE, or STANDARD_QUEEN',
      },
    },
    required: ['checkInDate', 'checkOutDate'],
  },
};

const createReservationTool: FunctionDeclaration = {
  name: 'createReservation',
  description: 'Create a confirmed room reservation and generate a booking reference code.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      firstName: { type: Type.STRING, description: 'Guest first name' },
      lastName: { type: Type.STRING, description: 'Guest last name' },
      email: { type: Type.STRING, description: 'Guest email address' },
      phone: { type: Type.STRING, description: 'Guest contact phone number' },
      roomTypeId: { type: Type.STRING, description: 'The UUID of the selected room type' },
      checkInDate: { type: Type.STRING, description: 'Check-in date in YYYY-MM-DD format' },
      checkOutDate: { type: Type.STRING, description: 'Check-out date in YYYY-MM-DD format' },
      numberOfGuests: { type: Type.INTEGER, description: 'Number of guests' },
      specialRequests: { type: Type.STRING, description: 'Optional special requests' },
    },
    required: ['firstName', 'lastName', 'email', 'phone', 'roomTypeId', 'checkInDate', 'checkOutDate'],
  },
};

const getReservationTool: FunctionDeclaration = {
  name: 'getReservation',
  description: 'Lookup an existing reservation by booking reference code (e.g. NAINA-1234).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      bookingReference: {
        type: Type.STRING,
        description: 'Booking reference code',
      },
    },
    required: ['bookingReference'],
  },
};

const getFolioTool: FunctionDeclaration = {
  name: 'getFolioBalance',
  description: 'Get current billing folio, charges, and outstanding balance for a room number.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      roomNumber: {
        type: Type.STRING,
        description: 'The guest room number (e.g. 101, 201, 301)',
      },
    },
    required: ['roomNumber'],
  },
};

// 4. Tool Execution Dispatcher
async function executeTool(name: string, args: Record<string, any>): Promise<any> {
  console.log(`🛠️ [Tool Call] Executing ${name} with args:`, JSON.stringify(args));
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

// 5. Naina Agent Session Class
export class NainaAgent {
  private chatSession: any;

  constructor() {
    this.chatSession = ai.chats.create({
      model: config.gemini.model,
      config: {
        systemInstruction: NAINA_SYSTEM_INSTRUCTION,
        temperature: 0.7,
        tools: [{ functionDeclarations: [checkAvailabilityTool, createReservationTool, getReservationTool, getFolioTool] }],
      },
    });
  }

  /**
   * Process a user turn, automatically resolving any tool calls against PostgreSQL
   * and returning the final spoken text for Cartesia TTS.
   */
  async processUserMessage(userTranscript: string): Promise<string> {
    let response = await this.chatSession.sendMessage({ message: userTranscript });

    // Handle Function Calling Loop
    while (response.functionCalls && response.functionCalls.length > 0) {
      const functionResponses = [];
      for (const call of response.functionCalls) {
        const toolResult = await executeTool(call.name, call.args);
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: { result: toolResult },
          },
        });
      }

      // Return tool execution results back to Gemini wrapped in { message: ... }
      response = await this.chatSession.sendMessage({
        message: functionResponses,
      });
    }

    return response.text || '';
  }
}
