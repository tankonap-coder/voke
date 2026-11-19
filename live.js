try { require('dotenv').config(); } catch (e) {}
const { Client } = require('discord.js-selfbot-v13');
const http = require('http');
const https = require('https');

const TOKEN = process.env.DISCORD_TOKEN || '';
const GUILD_ID = process.env.GUILD_ID || '';
const CHANNEL_ID = process.env.CHANNEL_ID || '';
const BACKUP_CHANNEL_ID = process.env.BACKUP_CHANNEL_ID || '';

// ── 1. HTTP Server Keep-Alive & Chống ngủ (Render) ──
const PORT = parseInt(process.env.PORT || '8081', 10);

http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'alive', uptime: process.uptime() }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(PORT, () => console.log(`[HTTP] Server keep-alive đang chạy trên cổng ${PORT}`));

// Tự động nhận diện URL Public của Render
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (EXTERNAL_URL) {
  console.log(`[+] Đã nhận diện URL Public của Render: ${EXTERNAL_URL}`);
} else {
  console.log(`[-] Lưu ý: Không tìm thấy RENDER_EXTERNAL_URL (chỉ chạy nội bộ).`);
}

// Cơ chế tự ping chống ngủ (Chạy mỗi 3 phút / lần = 180000 ms)
setInterval(() => {
  // Ping nội bộ
  http.get(`http://127.0.0.1:${PORT}/health`, () => {}).on('error', () => {});

  // Ping trực tiếp vào URL Public của Render để giữ service luôn tỉnh táo
  if (EXTERNAL_URL) {
    https.get(`${EXTERNAL_URL}/health`, () => {}).on('error', () => {});
  }
}, 180000);

// ── 2. Discord Selfbot Setup ──
const client = new Client({ checkUpdate: false });

function log(msg, type = 'INFO') {
  console.log(`[${new Date().toISOString()}] [${type}] ${msg}`);
}

async function resolveChannelId() {
  if (CHANNEL_ID && client.channels.cache.has(CHANNEL_ID)) return CHANNEL_ID;
  if (BACKUP_CHANNEL_ID && client.channels.cache.has(BACKUP_CHANNEL_ID)) return BACKUP_CHANNEL_ID;
  
  try {
    const ch = await client.channels.fetch(CHANNEL_ID);
    if (ch) return ch.id;
  } catch (e) {}

  return CHANNEL_ID; 
}

async function startFakeLive() {
  const targetChannelId = await resolveChannelId();
  if (!GUILD_ID || !targetChannelId) return;

  // Bước 1: Gửi Voice State Update (Opcode 4)
  client.ws.broadcast({
    op: 4,
    d: {
      guild_id: GUILD_ID,
      channel_id: targetChannelId,
      self_mute: false,
      self_deaf: true
    }
  });

  // Chờ 500ms để Gateway Discord cập nhật Voice State
  setTimeout(() => {
    // Bước 2: Gửi Stream Create (Opcode 18) để bật Badge TRỰC TIẾP
    client.ws.broadcast({
      op: 18,
      d: {
        type: 'guild',
        guild_id: GUILD_ID,
        channel_id: targetChannelId,
        preferred_region: null
      }
    });
  }, 500);
}

client.on('ready', async () => {
  log(`Logged in as: ${client.user.tag} (${client.user.id})`);
  
  // Gửi tín hiệu kích hoạt lần đầu
  await startFakeLive();

  // Duy trì gửi tín hiệu định kỳ ngầm mỗi 10 giây để giữ trạng thái Live ổn định
  setInterval(async () => {
    await startFakeLive();
  }, 10000);
});

// 3. Tự động vào lại kênh ngay lập tức nếu bị out
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.id === client.user.id) {
    if (oldState.channelId && !newState.channelId) {
      log('Đã bị out khỏi kênh! Đang tự động vào lại...', 'WARN');
      setTimeout(() => {
        startFakeLive();
      }, 1000);
    }
  }
});

client.on('error', (e) => log(`Client error: ${e.message}`, 'ERROR'));

client.login(TOKEN).catch((e) => {
  log(`Login failed: ${e.message}`, 'ERROR');
  process.exit(1);
});
