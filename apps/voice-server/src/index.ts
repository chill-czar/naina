import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AccessToken } from 'livekit-server-sdk';
import { config } from './config';
import { VoiceOrchestrator } from './pipeline/orchestrator';
import { checkAvailability } from '@naina/hotel-pms-core';

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/health' || url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'Naina Voice Server',
        geminiModel: config.gemini.model,
        cartesiaTts: config.cartesia.ttsModel,
        cartesiaStt: config.cartesia.sttModel,
      })
    );
    return;
  }

  if (url.pathname === '/api/token' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const roomName = data.roomName || 'naina-concierge-room';
        const participantName = data.participantName || `guest-${Math.floor(1000 + Math.random() * 9000)}`;

        if (!config.livekit.apiKey || !config.livekit.apiSecret) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'LiveKit API credentials not configured in .env' }));
          return;
        }

        const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
          identity: participantName,
          name: participantName,
        });

        at.addGrant({
          roomJoin: true,
          room: roomName,
          canPublish: true,
          canSubscribe: true,
        });

        const token = await at.toJwt();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            token,
            url: config.livekit.url,
            roomName,
            participantName,
          })
        );
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.pathname === '/api/rooms') {
    try {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const rooms = await checkAvailability({
        checkInDate: url.searchParams.get('checkInDate') || today,
        checkOutDate: url.searchParams.get('checkOutDate') || tomorrow,
        numberOfGuests: parseInt(url.searchParams.get('guests') || '2', 10),
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rooms }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

const wss = new WebSocketServer({ server, path: '/ws/voice' });

wss.on('connection', (ws: WebSocket, req) => {
  console.log(`[ws] client connected from ${req.socket.remoteAddress}`);

  const orchestrator = new VoiceOrchestrator();

  orchestrator.on('stateChange', (state) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'state', state }));
    }
  });

  orchestrator.on('userTranscript', (text, isFinal) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'transcript', role: 'user', text, isFinal }));
    }
  });

  orchestrator.on('agentTranscript', (text) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'transcript', role: 'agent', text, isFinal: true }));
    }
  });

  orchestrator.on('agentSpeechChunk', (chunk: Uint8Array) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    }
  });

  orchestrator.on('bargeIn', () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'barge_in' }));
    }
  });

  orchestrator.on('error', (err) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: err.message || 'Pipeline error' }));
    }
  });

  orchestrator.startSession();

  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      orchestrator.handleIncomingAudio(data as Buffer);
    } else {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text_input' && msg.text) {
          console.log(`[text_input] ${msg.text}`);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'transcript', role: 'user', text: msg.text, isFinal: true }));
          }
          await orchestrator.handleUserTurn(msg.text);
        } else if (msg.type === 'interrupt') {
          console.log('[interrupt] manual client interrupt');
          orchestrator.interrupt();
        }
      } catch (e) {
        console.error('Failed to parse text message:', e);
      }
    }
  });

  ws.on('close', () => {
    console.log('[ws] client disconnected');
    orchestrator.endSession();
  });

  ws.on('error', (err) => {
    console.error('[ws error]', err);
    orchestrator.endSession();
  });
});

server.listen(config.port, () => {
  console.log(`Naina Voice Server listening on http://localhost:${config.port}`);
});

