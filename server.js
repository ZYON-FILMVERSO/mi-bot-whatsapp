const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Middleware para servir archivos estáticos (HTML, CSS, JS)
app.use(express.static('public'));

// Variable para almacenar el último QR o código de vinculación generado
let lastQR = null;
let lastPairingCode = null;
let phoneNumberForPairing = null;

// Función principal para iniciar el socket de WhatsApp
async function startSock() {
    // Cargar o crear el estado de autenticación
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // No lo imprimimos en consola, lo mostraremos en la web
        browser: ['FILMVERSO-ZYON', 'Chrome', '1.0.0']
    });

    // Escuchar eventos de actualización de la conexión
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Si se genera un QR, lo guardamos para mostrarlo en la web
        if (qr) {
            console.log('🔑 Nuevo QR generado');
            lastQR = qr;
            // Limpiar el código de vinculación anterior si existe
            lastPairingCode = null;
        }

        // Si la conexión se abre, estamos listos
        if (connection === 'open') {
            console.log('✅ Bot conectado exitosamente a WhatsApp');
            // Limpiar QR y código de vinculación porque ya no son necesarios
            lastQR = null;
            lastPairingCode = null;
        }

        // Si la conexión se cierra, intentamos reconectar
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

    // Guardar las credenciales cuando se actualicen
    sock.ev.on('creds.update', saveCreds);

    return sock;
}

// Iniciar el bot
let sock = null;
startSock().then(s => { sock = s; });

// --- ENDPOINTS DE LA API ---

// Endpoint para obtener el QR en formato imagen
app.get('/api/qr', async (req, res) => {
    if (!lastQR) {
        return res.status(404).json({ error: 'No hay QR disponible. Espera a que se genere.' });
    }
    try {
        // Generar la imagen del QR en formato data URL
        const qrImage = await QRCode.toDataURL(lastQR);
        res.json({ qr: qrImage });
    } catch (error) {
        console.error('Error al generar QR:', error);
        res.status(500).json({ error: 'Error al generar el código QR' });
    }
});

// Endpoint para solicitar un código de vinculación (Pairing Code)
app.post('/api/pair', express.json(), async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.status(400).json({ error: 'El número de teléfono es requerido' });
    }

    // Limpiar el número (solo dígitos)
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    if (cleanNumber.length < 10) {
        return res.status(400).json({ error: 'Número de teléfono inválido' });
    }

    try {
        // Si no hay socket, intentamos crearlo
        if (!sock) {
            sock = await startSock();
        }

        // Solicitar el código de vinculación
        const code = await sock.requestPairingCode(cleanNumber);
        console.log(`📱 Código de vinculación para ${cleanNumber}: ${code}`);
        
        // Guardar el código para mostrarlo
        lastPairingCode = code;
        // Limpiar QR anterior
        lastQR = null;
        
        res.json({ pairingCode: code });
    } catch (error) {
        console.error('Error al generar código de vinculación:', error);
        res.status(500).json({ error: 'Error al generar el código de vinculación' });
    }
});

// Endpoint para verificar el estado de la conexión
app.get('/api/status', (req, res) => {
    const isConnected = sock?.authState?.creds?.registered || false;
    res.json({ 
        connected: isConnected,
        hasQR: !!lastQR,
        hasPairingCode: !!lastPairingCode
    });
});

// Servir la página principal (opcional, si quieres que sirva el HTML desde el backend)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
    console.log('📱 Conectando a WhatsApp...');
});
