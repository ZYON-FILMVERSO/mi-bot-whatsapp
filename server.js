    // --- ESCUCHAR MENSAJES ---
    sock.ev.on('messages.upsert', async (m) => {
        // 🛡️ TRY EXTERNO: Evita que el bot se cuelgue si recibe un mensaje corrupto
        try {
            console.log('📩 Evento messages.upsert recibido');
            const msg = m.messages[0];
            
            // Si no hay mensaje o es mío, salimos
            if (!msg.message || msg.key.fromMe) return;

            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            
            // 📌 Normalizamos el JID
            let sender = normalizarJid(msg.key.remoteJid);

            console.log(`📝 Texto: "${text}" | Remitente: ${sender}`);

            if (text && /IA|Zyon|bot/i.test(text)) {
                console.log(`🤖 Mensaje para la IA de ${sender}: ${text}`);
                try {
                    await sock.sendPresenceUpdate('composing', sender);
                    const aiResponse = await getAIResponse(text);
                    await sock.sendMessage(sender, { text: aiResponse });
                    console.log(`✅ Respuesta enviada a ${sender}`);
                } catch (innerError) {
                    console.error('❌ Error al procesar el mensaje (IA o envío):', innerError);
                    // Intentamos notificar el error al usuario
                    try {
                        await sock.sendMessage(sender, { text: "uy, me falló el cerebro :( mejor avísale a @Elvis28_ que revise los logs." });
                    } catch (sendError) {
                        console.error("❌ Tampoco pude enviar el mensaje de error al usuario:", sendError);
                    }
                }
            } else {
                console.log('⏭️ El mensaje no contiene palabras clave (IA, Zyon o bot)');
            }
        } catch (outerError) {
            // 🛡️ Este catch capturará el error de descifrado (pkmsg) y evitará que el bot se congele
            console.error('🔥 ERROR CRÍTICO EN EL MANEJADOR DE MENSAJES (Posible corrupción de sesión):', outerError);
        }
    });
