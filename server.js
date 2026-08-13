// --- ESCUCHAR MENSAJES (con logs de depuración) ---
sock.ev.on('messages.upsert', async (m) => {
    console.log('📩 Evento messages.upsert recibido'); // LOG 1: Verifica que el evento se dispara
    
    const msg = m.messages[0];
    console.log('📨 Mensaje recibido:', JSON.stringify(msg, null, 2)); // LOG 2: Muestra el mensaje completo
    
    if (!msg.message) {
        console.log('⚠️ El mensaje no tiene contenido (msg.message es null)');
        return;
    }
    
    if (msg.key.fromMe) {
        console.log('⏭️ El mensaje fue enviado por el propio bot, ignorando');
        return;
    }

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const sender = msg.key.remoteJid;
    
    console.log(`📝 Texto: "${text}" | Remitente: ${sender}`); // LOG 3: Muestra el texto y el remitente

    // Detectar palabras clave: IA, Zyon, bot (sin importar mayúsculas)
    if (text && /IA|Zyon|bot/i.test(text)) {
        console.log(`🤖 Mensaje para la IA de ${sender}: ${text}`);
        
        try {
            // Indicar que está escribiendo
            await sock.sendPresenceUpdate('composing', sender);
            console.log('✍️ Estado "escribiendo" enviado');

            // Obtener respuesta de la IA
            const aiResponse = await getAIResponse(text);
            console.log(`💬 Respuesta generada: "${aiResponse}"`);

            // Enviar respuesta
            await sock.sendMessage(sender, { text: aiResponse });
            console.log(`✅ Respuesta enviada a ${sender}`);
        } catch (error) {
            console.error('❌ Error al procesar el mensaje:', error);
        }
    } else {
        console.log('⏭️ El mensaje no contiene palabras clave (IA, Zyon o bot)');
    }
});
