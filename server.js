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

// --- Configuraciones para administración de grupos ---
const mutedUsers = new Map(); // Guarda usuarios muteados
const antiLinkGroups = new Set(); // Guarda grupos con Antilink activado

// 📌 Función para arreglar el JID (el error del @lid)
const normalizarJid = (jid) => {
    if (!jid) return jid;
    if (jid.endsWith('@lid')) {
        return jid.replace('@lid', '@s.whatsapp.net');
    }
    return jid;
};

// 📌 Función para convertir tiempos (ej: 5m, 10h) a milisegundos
const parseTime = (timeStr) => {
    const match = timeStr.match(/^(\d+)([mh])$/);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2];
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return null;
};

// --- Función para iniciar WhatsApp ---
async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['FILMVERSO-ZYON', 'Chrome', '1.0.0']
    });

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
                setTimeout(() => startSock(), 5000);
            } else {
                console.log('❌ Sesión cerrada. Elimina la carpeta auth_info_baileys y reinicia.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- ESCUCHAR MENSAJES ---
    sock.ev.on('messages.upsert', async (m) => {
        try {
            console.log('📩 Evento messages.upsert recibido');
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const sender = normalizarJid(msg.key.remoteJid);
            const isGroup = sender.endsWith('@g.us');

            console.log(`📝 Texto: "${text}" | Remitente: ${sender}`);

            // --- Lógica específica para grupos ---
            if (isGroup) {
                // 1. VERIFICAR SI EL USUARIO ESTÁ MUTEADO
                const muteKey = `${sender}_${msg.key.participant}`;
                if (mutedUsers.has(muteKey)) {
                    const muteData = mutedUsers.get(muteKey);
                    if (Date.now() > muteData.expiresAt) {
                        mutedUsers.delete(muteKey);
                        await sock.sendMessage(sender, { text: `✅ @${msg.key.participant.split('@')[0]} ha sido desmuteado automáticamente.`, mentions: [msg.key.participant] });
                    } else {
                        await sock.sendMessage(sender, { delete: msg.key });
                        await sock.sendMessage(sender, { text: `🚫 Estás muteado. Debes esperar.` });
                        return;
                    }
                }

                // 2. VERIFICAR ANTILINK
                if (antiLinkGroups.has(sender)) {
                    const urlRegex = /(https?:\/\/[^\s]+)/gi;
                    if (urlRegex.test(text)) {
                        await sock.sendMessage(sender, { delete: msg.key });
                        await sock.sendMessage(sender, { text: `🚫 ¡Prohibido enviar enlaces!` });
                        return;
                    }
                }

                // 3. COMANDOS DE ADMINISTRACIÓN (SIN PREFIJO)
                // Dividimos el texto para identificar la primera palabra
                const parts = text.trim().split(/\s+/);
                const command = parts[0].toLowerCase();
                
                // Lista de comandos permitidos sin prefijo
                const adminCommands = ['mute', 'unmute', 'delete', 'eliminar', 'antilink'];

                if (adminCommands.includes(command)) {
                    // Verificar si el bot es admin
                    const groupMeta = await sock.groupMetadata(sender);
                    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    const isBotAdmin = groupMeta.participants.find(p => p.id === botJid)?.admin === 'admin';

                    if (!isBotAdmin) {
                        await sock.sendMessage(sender, { text: '❌ No soy administrador de este grupo.' });
                        return;
                    }

                    // Obtener objetivo (por mención o respuesta)
                    let targetJid = null;
                    let targetFromReply = null;
                    if (msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
                        targetFromReply = msg.message.extendedTextMessage.contextInfo.participant;
                    }
                    const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                    if (mentionedJid && mentionedJid.length > 0) {
                        targetJid = mentionedJid[0];
                    } else if (targetFromReply) {
                        targetJid = targetFromReply;
                    }

                    // -- EJECUTAR COMANDOS --
                    if (command === 'antilink') {
                        const subCommand = parts[1]?.toLowerCase();
                        if (subCommand === 'on') {
                            antiLinkGroups.add(sender);
                            await sock.sendMessage(sender, { text: '✅ Antilink activado.' });
                        } else if (subCommand === 'off') {
                            antiLinkGroups.delete(sender);
                            await sock.sendMessage(sender, { text: '✅ Antilink desactivado.' });
                        } else {
                            await sock.sendMessage(sender, { text: '❌ Usa: `antilink on` o `antilink off`' });
                        }
                    } 
                    else if (command === 'delete' || command === 'eliminar') {
                        const quotedMsgKey = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
                        if (!quotedMsgKey) {
                            await sock.sendMessage(sender, { text: '❌ Responde al mensaje que quieres eliminar.' });
                            return;
                        }
                        const quotedParticipant = msg.message.extendedTextMessage.contextInfo.participant;
                        const messageToDelete = {
                            key: { remoteJid: sender, fromMe: false, id: quotedMsgKey, participant: quotedParticipant }
                        };
                        await sock.sendMessage(sender, { delete: messageToDelete.key });
                        await sock.sendMessage(sender, { text: `✅ Mensaje eliminado.` });
                    } 
                    else if (command === 'mute' || command === 'unmute') {
                        if (!targetJid) {
                            await sock.sendMessage(sender, { text: '❌ Menciona al usuario (@usuario) o responde a su mensaje.' });
                            return;
                        }

                        const muteKeyTarget = `${sender}_${targetJid}`;

                        if (command === 'unmute') {
                            if (mutedUsers.has(muteKeyTarget)) {
                                mutedUsers.delete(muteKeyTarget);
                                await sock.sendMessage(sender, { text: `🔊 @${targetJid.split('@')[0]} desmuteado.`, mentions: [targetJid] });
                            } else {
                                await sock.sendMessage(sender, { text: `ℹ️ @${targetJid.split('@')[0]} no está muteado.`, mentions: [targetJid] });
                            }
                        } else { // Comando mute
                            // Detectar el tiempo (puede estar en parts[1] o parts[2])
                            let timeStr = null;
                            for (let i = 1; i < parts.length; i++) {
                                if (parseTime(parts[i])) {
                                    timeStr = parts[i];
                                    break;
                                }
                            }

                            let duration, durationText;
                            if (timeStr) {
                                duration = parseTime(timeStr);
                                durationText = timeStr;
                            } else {
                                duration = Infinity;
                                durationText = 'indefinidamente';
                            }

                            mutedUsers.set(muteKeyTarget, { expiresAt: duration === Infinity ? Infinity : Date.now() + duration });
                            await sock.sendMessage(sender, { text: `🔇 @${targetJid.split('@')[0]} muteado por ${durationText}.`, mentions: [targetJid] });
                        }
                    }
                    return; // Salimos del evento para no activar la IA
                }
            }

            // --- Lógica de la IA (Se ejecuta si NO es un comando de admin) ---
            if (text && /IA|Zyon|bot/i.test(text)) {
                console.log(`🤖 Mensaje para la IA de ${sender}: ${text}`);
                try {
                    await sock.sendPresenceUpdate('composing', sender);
                    const aiResponse = await getAIResponse(text);
                    await sock.sendMessage(sender, { text: aiResponse });
                    console.log(`✅ Respuesta enviada a ${sender}`);
                } catch (innerError) {
                    console.error('❌ Error al procesar el mensaje (IA o envío):', innerError);
                    try {
                        await sock.sendMessage(sender, { text: "uy, me falló el cerebro :( mejor avísale a @Elvis28_ que revise los logs." });
                    } catch (sendError) {
                        console.error("❌ Tampoco pude enviar el mensaje de error al usuario:", sendError);
                    }
                }
            } else if (!isGroup) {
                console.log('⏭️ El mensaje no contiene palabras clave (IA, Zyon o bot)');
            }

        } catch (outerError) {
            console.error('🔥 ERROR CRÍTICO EN EL MANEJADOR DE MENSAJES:', outerError);
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
