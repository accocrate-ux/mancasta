// netlify/functions/cobrar.js
// Procesa el pago con Culqi y envía notificación WhatsApp al dueño vía Twilio

const https = require("https");

/* ─── helper: HTTP POST con promesa ─────────────────────── */
function postJSON(hostname, path, body, auth) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Authorization: "Bearer " + auth,
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/* ─── helper: Twilio WhatsApp (form-encoded) ────────────── */
function sendWhatsApp(accountSid, authToken, from, to, message) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      From: from,
      To: to,
      Body: message,
    }).toString();

    const options = {
      hostname: "api.twilio.com",
      path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        Authorization:
          "Basic " +
          Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* ─── HANDLER PRINCIPAL ─────────────────────────────────── */
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: "JSON inválido" }),
    };
  }

  const { token, amount, email, description, telefono, nombre, pedido, fecha, zona, direccion, modo } = payload;

  // ── 1. Cobrar con Culqi ───────────────────────────────────
  let chargeId = null;
  try {
    const culqiResp = await postJSON(
      "api.culqi.com",
      "/v2/charges",
      {
        amount,
        currency_code: "PEN",
        email,
        source_id: token,
        description: description || "La Empanada Dorada",
      },
      process.env.CULQI_SECRET_KEY
    );

    if (culqiResp.status !== 201 || culqiResp.body.object !== "charge") {
      const msg =
        culqiResp.body?.user_message ||
        culqiResp.body?.merchant_message ||
        "Pago rechazado";
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, error: msg }),
      };
    }

    chargeId = culqiResp.body.id;
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: "Error al procesar el pago: " + e.message }),
    };
  }

  // ── 2. Enviar notificación WhatsApp al dueño via Twilio ───
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_WA_FROM      = process.env.TWILIO_WA_FROM || "whatsapp:+14155238886"; // Sandbox Twilio
  const OWNER_WA_NUMBER     = process.env.OWNER_WA_NUMBER || "whatsapp:+51946703698"; // Tu número

  const amountSoles = (amount / 100).toFixed(2);
  const sep = "─────────────────";

  const lines = [
    "🥟 *NUEVA VENTA — La Empanada Dorada*",
    sep,
    "",
    "✅ *PAGO APROBADO*",
    `   ID Culqi: ${chargeId}`,
    `   Monto: S/ ${amountSoles}`,
    "",
    "📅 *ENTREGA*",
    `   ${fecha || "—"}`,
    "",
    "🛒 *PEDIDO*",
    `   ${pedido || description || "—"}`,
    "",
  ];

  if (modo === "store") {
    lines.push("🏠 *MODO:* Recojo en tienda");
  } else if (zona) {
    lines.push(`🛵 *ZONA:* ${zona}`);
    if (direccion) lines.push(`   📍 ${direccion}`);
  }

  lines.push(
    "",
    sep,
    `👤 ${nombre || "—"}`,
    `📱 ${telefono || "—"}`,
    `📧 ${email}`,
    "",
    "⚡ Este mensaje fue generado automáticamente."
  );

  const waMessage = lines.join("\n");

  try {
    await sendWhatsApp(
      TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN,
      TWILIO_WA_FROM,
      OWNER_WA_NUMBER,
      waMessage
    );
  } catch (e) {
    // No fallamos el pago si WhatsApp falla, solo lo logueamos
    console.error("WhatsApp notification failed:", e.message);
  }

  // ── 3. Responder al frontend ──────────────────────────────
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, charge_id: chargeId }),
  };
};