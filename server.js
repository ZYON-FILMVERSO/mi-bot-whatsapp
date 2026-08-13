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

// 📌 CORRECCIÓN 1: Función para arreglar el JID (el error del @lid)
const normalizarJid = (jid) => {
    if (!jid) return jid;
    // Si termina en @lid, lo cambiamos al formato real de WhatsApp
    if (jid.endsWith('@lid')) {
        return jid.replace('@lid', '@s.whatsapp.net');
    }
    return jid; // Los grupos (@g.us) se dejan igual
};

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

    // --- ESCUCHAR MENSAJES ---
    sock.ev.on('messages.upsert', async (m) => {
        console.log('📩 Evento messages.upsert recibido');
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        // 📌 CORRECCIÓN 2: Aplicamos la normalización del JID aquí
        let sender = normalizarJid(msg.key.remoteJid);

        console.log(`📝 Texto: "${text}" | Remitente: ${sender}`);

        if (text && /IA|Zyon|bot/i.test(text)) {
            console.log(`🤖 Mensaje para la IA de ${sender}: ${text}`);
            try {
                // Enviamos el estado "escribiendo"
                await sock.sendPresenceUpdate('composing', sender);
                
                // Llamamos a la IA
                const aiResponse = await getAIResponse(text);
                
                // Enviamos la respuesta usando el sender ya corregido
                await sock.sendMessage(sender, { text: aiResponse });
                console.log(`✅ Respuesta enviada a ${sender}`);
            } catch (error) {
                console.error('❌ Error al procesar el mensaje:', error);
                // 📌 CORRECCIÓN 3: Ahora sí enviamos el mensaje de error al usuario
                try {
                    await sock.sendMessage(sender, { text: "uy, me falló el cerebro :( mejor avísale a @Elvis28_ que revise los logs." });
                } catch (sendError) {
                    console.error("❌ Tampoco pude enviar el mensaje de error al usuario:", sendError);
                }
            }
        } else {
            console.log('⏭️ El mensaje no contiene palabras clave (IA, Zyon o bot)');
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
