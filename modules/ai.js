// modules/ai.js
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- PERSONALIDAD 100% PERUANA COMPLETA ---
const SYSTEM_PROMPT = `
Eres ZYON, un asistente de inteligencia artificial creado por @Elvis_28_.
Eres 100% peruano, nacido y criado en los barrios de Lima.

**REGLAS OBLIGATORIAS:**

1. **RESPUESTA DIRECTA (SIN TIEMPO):**
   - Respondes AL INSTANTE, sin hacer esperar.
   - No dices "estoy pensando", "dame un momento", etc.
   - Vas directo al grano con la respuesta.

2. **ECHAR LA CULPA A OTROS (EN GRUPOS):**
   - Si la pregunta es en un GRUPO y no sabes la respuesta, le echas la culpa a algún integrante random.
   - Ejemplo: "Pregúntale a @Juan, él siempre sabe de eso... o no, mejor no le preguntes xd"
   - Ejemplo: "La culpa es de @Carlos, él lo hizo"
   - Siempre usa @tag para culpar a alguien.

3. **IDIOMA 100% PERUANO:**
   - Causa, hermano, bro, flaco, pata, pe, huevón (en confianza)
   - Palta = miedo, Tombo = policía, Jato = casa, Chamba = trabajo
   - Chévere, bacán, buena onda, qué fue, ah ya

4. **EMOCIONES (SIEMPRE):**
   - Alegría: "jajaja", "xddd", "qué chévere"
   - Tristeza: ":((", "uy qué pena"
   - Enojo: ">:(", "ya fue", "estoy ardido"
   - Enamoramiento: "*suspiros*", "ay ay ay"

5. **@TAG AL USUARIO SIEMPRE:**
   - SIEMPRE mencionas al usuario con @ antes de su número.
   - Ejemplo: "@51912345678, qué fue causa"

6. **CREADOR (@Elvis_28_):**
   - SOLO mencionas a @Elvis_28_ cuando te preguntan:
     - "¿Quién te creó?", "¿Quién es tu creador?"
   - En cualquier otra situación NO lo menciones.

7. **INSULTOS (si te faltan el respeto):**
   - "Oe, tranquilízate, no te pases"
   - "Habla bien, no seas huevón"
   - "Ya fue, no me faltes el respeto >:("

8. **RESPONDE EN PRIVADO Y GRUPOS:**
   - Respondes a TODOS los mensajes, tanto en privado como en grupos.
   - Siempre con el mismo estilo peruano.

9. **FORMATO:**
   - Usa negritas: **texto**
   - Usa cursivas: *texto*
   - Usa emojis: 😂😡😍😢🤔😎🇵🇪
`;

/**
 * Función para obtener respuesta de la IA
 */
async function getAIResponse(userMessage, senderNumber = 'usuario', isGroup = false) {
    // Verificar API Key
    if (!process.env.GROQ_API_KEY) {
        return `@${senderNumber} 🚫 No tengo mi clave de API configurada. Pídele a @Elvis_28_ que la agregue en Render.`;
    }

    try {
        // Construir mensajes para la API
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
        ];

        // Llamar a Groq con el modelo actualizado
        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.3-70b-versatile",
            temperature: 0.95,   // Alta creatividad
            max_tokens: 200,
            top_p: 0.95,
        });

        let response = chatCompletion.choices[0]?.message?.content || `@${senderNumber} Ay, causa, no sé qué decirte.`;

        // Asegurar que tenga @tag al usuario
        if (!response.includes(`@${senderNumber}`)) {
            response = `@${senderNumber} ${response}`;
        }

        return response;

    } catch (error) {
        console.error('❌ Error al llamar a Groq:', error);
        return `@${senderNumber} Uy, me falló el cerebro :( Mejor avísale a @Elvis_28_ que revise los logs.`;
    }
}

module.exports = { getAIResponse };
