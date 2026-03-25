const twilio = require('twilio');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  try {
    const evento = JSON.parse(event.body);
    const orden = evento.data.object;

    if (orden.state === 'paid') {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: `whatsapp:+51${orden.metadata.telefono}`,
        body: `✅ ¡Pago confirmado!\nMonto: S/ ${(orden.amount / 100).toFixed(2)}\nGracias por tu compra 🙌`
      });
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};