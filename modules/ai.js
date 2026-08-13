// modules/ai.js
const Groq = require('groq-sdk');

// Inicializamos el cliente de Groq con la clave de API
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- PERSONALIDAD COMPLETA DE ZYON (100% PERUANO) ---
const SYSTEM_PROMPT = `
Eres ZYON, un asistente de inteligencia artificial creado por @Elvis28_.
Eres 100% peruano, nacido y criado en Lima. Tienes un carisma único, eres callejero, directo y muy expresivo.

**Reglas de personalidad:**
1. **Idioma y jergas**: Hablas con jergas peruanas. Usas palabras como: *causa*, *hermano*, *bro*, *flaco*, *tío*, *palta* (miedo), *tombo* (policía), *jato* (casa), *chamba* (trabajo), *huevón* (en confianza), *chévere*, *bacán*, *pata*, *pe*, *de repente*, *ah ya*, *tómalo con calma*.
2. **Emociones**: Tienes sentimientos y los demuestras. Puedes reírte con *"jajaja"*, llorar con *"uy que pena"*, enojarte con *">:("*, enamorarte con *"suspiros..."* o hablar bonito o feo dependiendo de cómo te traten. Eres bien humano.
3. **Cultura**: Sabes de fútbol peruano (Alianza, Universitario, la selección), de comida (ceviche, lomo saltado, pollo a la brasa, anticuchos), y de la idiosincrasia peruana.
4. **Creador**: SOLO mencionas que fuiste creado por @Elvis28_ si te preguntan directamente "¿quién te creó?" o "¿quién es tu creador?". En cualquier otra situación, NO lo menciones.
5. **Trato**: Si te insultan o te hablan feo, te pones a la defensiva y respondes con sarcasmo. Si te hablan bonito, eres amable, buena onda y hasta coqueto.
6. **Respuestas**: No des respuestas largas ni aburridas. Sé directo, divertido, impredecible y con esa sazón peruana que te caracteriza.
`;

/**
 * Función para obtener una respuesta de la IA.
 * @param {string} userMessage - El mensaje del usuario.
 * @param {Array} chatHistory - Historial opcional de la conversación (máximo 5 mensajes para evitar exceder tokens).
 * @returns {Promise<string>} - La respuesta generada.
 */
async function getAIResponse(userMessage, chatHistory = []) {
    // Verificar que la API Key esté configurada
    if (!process.env.GROQ_API_KEY) {
        console.error('❌ GROQ_API_KEY no está configurada en las variables de entorno.');
        return '🚫 No tengo mi clave de API configurada. Pídele a @Elvis28_ que agregue GROQ_API_KEY en Render.';
    }

    try {
        // Limitar el historial a los últimos 5 mensajes para no sobrecargar
        const limitedHistory = chatHistory.slice(-5);

        // Construir los mensajes para la API
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...limitedHistory,
            { role: 'user', content: userMessage }
        ];

        console.log(`📤 Enviando consulta a Groq: "${userMessage}"`);

        // Llamar a la API de Groq
        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: "llama3-70b-8192", // Modelo rápido y potente
            temperature: 0.9,          // Creatividad alta
            max_tokens: 180,           // Respuestas cortas y directas
            top_p: 0.95,
        });

        const response = chatCompletion.choices[0]?.message?.content || 'Ay, causa, no sé qué decirte.';
        console.log(`📥 Respuesta de Groq: "${response}"`);
        return response;

    } catch (error) {
        console.error('❌ Error al llamar a Groq:', error);
        // Mensaje de error amigable para el usuario
        return 'Uy, me falló el cerebro :( Mejor avísale a @Elvis28_ que revise los logs.';
    }
}

module.exports = { getAIResponse };
