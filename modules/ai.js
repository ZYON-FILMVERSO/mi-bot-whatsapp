const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const path = require('path');

// Importamos nuestra IA desde la carpeta modules
const { getAIResponse } = require('./modules/ai');

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(express.static('public'));
app.use(express.json());

// --- Variables del bot ---
let lastQR = null;
let lastPairingCode = null;
let sock = null;

// --- Función para iniciar WhatsApp ---
async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['FILMVERSO-ZYON', 'Chrome', '1.0.0']
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
        console.log('📩 Evento messages.upsert recibido');
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const sender = msg.key.remoteJid;
        const senderNumber = sender.split('@')[0] || sender;
        
        // Detectar si es un grupo (termina en @g.us)
        const isGroup = sender.endsWith('@g.us');
        const groupName = isGroup ? msg.pushName || 'grupo' : 'privado';

        console.log(`📝 Texto: "${text}" | Remitente: ${senderNumber} | Grupo: ${isGroup}`);

        // --- FILTRO: Solo responde si es una pregunta o contiene palabras clave ---
        const isQuestion = /¿|\?|quién|qué|cuándo|dónde|por qué|para qué|cómo|cuánto|IA|Zyon|bot|ZYON|Bot/i.test(text);
        
        if (!isQuestion) {
            console.log('⏭️ No es una pregunta o no contiene palabras clave, ignorando');
            return;
        }

        console.log(`🤖 Procesando pregunta de ${senderNumber}: ${text}`);

        try {
            // Indicar que está escribiendo
            await sock.sendPresenceUpdate('composing', sender);
            
            // Obtener respuesta de la IA (con número y si es grupo)
            const aiResponse = await getAIResponse(text, senderNumber, isGroup);
            
            // Enviar respuesta USANDO LA FUNCIÓN "RESPONDER" DE WHATSAPP
            await sock.sendMessage(sender, {
                text: aiResponse,
                contextInfo: {
                    quotedMessage: msg.message,
                    mentionedJid: [sender] // Menciona al usuario
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
        console.log(`📱 Código de vinculación para ${cleanNumber}: ${code}`);
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
