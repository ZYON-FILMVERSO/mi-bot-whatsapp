const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs'); // Para manejar archivos

// Importamos nuestra IA
const { getAIResponse } = require('./modules/ai');

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(express.static('public'));
app.use(express.json());

// --- LIMPIEZA AUTOMÁTICA DE SESIÓN (para que el código funcione siempre) ---
const SESSION_DIR = 'auth_info_baileys';
if (fs.existsSync(SESSION_DIR)) {
    console.log('🗑️ Eliminando sesión anterior para evitar conflictos...');
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    console.log('✅ Sesión eliminada correctamente');
}

// --- Variables del bot ---
let lastQR = null;
let lastPairingCode = null;
let sock = null;

// --- Función para iniciar WhatsApp ---
async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['FILMVERSO-ZYON', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    // Eventos de conexión
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('🔑 Nuevo QR generado');
            lastQR = qr;
            lastPairingCode = null;
        }
        if (connection === 'open') {
            console.log('✅ Bot conectado exitosamente a WhatsApp');
            lastQR = null;
            lastPairingCode = null;
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Conexión cerrada, reconectando...', shouldReconnect);
            if (shouldReconnect) {
                startSock();
            } else {
                console.log('❌ Sesión cerrada. Elimina la carpeta auth_info_baileys y reinicia.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- ESCUCHAR MENSAJES (MEJORADO) ---
    sock.ev.on('messages.upsert', async (m) => {
        console.log('🔥🔥🔥 ¡EVENTO messages.upsert DISPARADO! 🔥🔥🔥');
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const sender = msg.key.remoteJid;
        const senderNumber = sender.split('@')[0] || sender;
        const isGroup = sender.endsWith('@g.us');

        console.log(`📨 Mensaje recibido de ${senderNumber}: "${text}" (Grupo: ${isGroup})`);

        // --- FILTRO: Solo responde si es una pregunta o contiene palabras clave ---
        const isQuestion = /¿|\?|quién|qué|cuándo|dónde|por qué|para qué|cómo|cuánto|IA|Zyon|bot|ZYON|Bot/i.test(text);
        if (!isQuestion) {
            console.log('⏭️ No es pregunta o no tiene palabras clave, ignorando');
            return;
        }

        console.log(`🤖 Procesando pregunta de ${senderNumber}: ${text}`);

        try {
            await sock.sendPresenceUpdate('composing', sender);
            const aiResponse = await getAIResponse(text, senderNumber, isGroup);
            await sock.sendMessage(sender, {
                text: aiResponse,
                contextInfo: {
                    quotedMessage: msg.message,
                    mentionedJid: [sender]
                }
            });
            console.log(`✅ Respuesta enviada a ${senderNumber}`);
        } catch (error) {
            console.error('❌ Error al procesar el mensaje:', error);
        }
    });

    return sock;
}

// Iniciar el bot
startSock();

// --- ENDPOINTS PARA LA WEB ---
app.get('/api/qr', async (req, res) => {
    if (!lastQR) {
        return res.status(404).json({ error: 'No hay QR disponible. Espera a que se genere.' });
    }
    try {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.json({ qr: qrImage });
    } catch (error) {
        console.error('Error al generar QR:', error);
        res.status(500).json({ error: 'Error al generar el código QR' });
    }
});

app.post('/api/pair', express.json(), async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.status(400).json({ error: 'El número de teléfono es requerido' });
    }
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    if (cleanNumber.length < 10) {
        return res.status(400).json({ error: 'Número de teléfono inválido' });
    }
    try {
        if (!sock) {
            sock = await startSock();
        }
        const code = await sock.requestPairingCode(cleanNumber);
        console.log(`📱 CÓDIGO DE VINCULACIÓN PARA ${cleanNumber}: ${code}`);
        lastPairingCode = code;
        lastQR = null;
        res.json({ pairingCode: code });
    } catch (error) {
        console.error('Error al generar código de vinculación:', error);
        res.status(500).json({ error: 'Error al generar el código de vinculación' });
    }
});

app.get('/api/status', (req, res) => {
    const isConnected = sock?.authState?.creds?.registered || false;
    res.json({
        connected: isConnected,
        hasQR: !!lastQR,
        hasPairingCode: !!lastPairingCode
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
    console.log('📱 Conectando a WhatsApp...');
});
