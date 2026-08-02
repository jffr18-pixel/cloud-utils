'use strict';

// Cobro de citas online con SumUp (Hosted Checkout).
//
// Flujo (servidor a servidor, la tarjeta la gestiona SumUp; el CRM no la toca):
//   1. createHostedCheckout() → crea un checkout con página de pago alojada por
//      SumUp y devuelve { id, url }.
//   2. Se redirige al cliente a esa URL para que pague.
//   3. getCheckout(id) confirma el estado real del pago (PAID/FAILED/PENDING).
//      No hay que fiarse de la simple redirección de vuelta.
//
// Credenciales por variables de entorno (nunca en el código ni en la base):
//   SUMUP_API_KEY        clave secreta de la API (empieza por «sup_sk_…»)
//   SUMUP_MERCHANT_CODE  código de comercio de la cuenta SumUp
// Sin ellas, el cobro con tarjeta se desactiva en silencio (el CRM sigue igual).

const API = 'https://api.sumup.com/v0.1';

function config() {
  return {
    apiKey: process.env.SUMUP_API_KEY || '',
    merchantCode: process.env.SUMUP_MERCHANT_CODE || '',
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.apiKey && c.merchantCode);
}

// Oculta la clave en mensajes de error/logs.
function redact(text) {
  const key = config().apiKey;
  let out = String(text == null ? '' : text);
  if (key) out = out.split(key).join('sup_sk_***');
  return out;
}

async function apiFetch(path, options = {}) {
  const c = config();
  if (!c.apiKey) throw new Error('SumUp no está configurado (falta SUMUP_API_KEY)');
  const res = await fetch(API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${c.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  let data = null;
  const txt = await res.text();
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error_message || data.error_code)) || `HTTP ${res.status}`;
    throw new Error(`SumUp: ${redact(msg)}`);
  }
  return data;
}

// Crea un checkout con página de pago alojada por SumUp.
//   amount    importe en euros (número, p. ej. 40 o 40.50)
//   reference referencia propia del CRM (id de la reserva) para conciliar
//   description  concepto que ve el cliente
//   returnUrl webhook al que SumUp avisa de los cambios de estado (opcional)
//   redirectUrl  página del CRM a la que vuelve el cliente tras pagar (opcional)
// Devuelve { id, url } donde `url` es la página de pago a la que redirigir.
async function createHostedCheckout({ amount, currency = 'EUR', reference, description, returnUrl, redirectUrl }) {
  const c = config();
  const body = {
    checkout_reference: reference,
    amount: Math.round((Number(amount) || 0) * 100) / 100,
    currency,
    merchant_code: c.merchantCode,
    description: description || '',
    hosted_checkout: { enabled: true },
  };
  if (returnUrl) body.return_url = returnUrl;
  if (redirectUrl) body.redirect_url = redirectUrl;
  const data = await apiFetch('/checkouts', { method: 'POST', body: JSON.stringify(body) });
  const url = data && (data.hosted_checkout_url || (data.hosted_checkout && data.hosted_checkout.url));
  if (!url) throw new Error('SumUp: no devolvió la URL de pago (¿pagos online sin activar en la cuenta?)');
  return { id: data.id, url };
}

// Consulta el estado real de un checkout. Normaliza el estado a
// 'PAID' | 'PENDING' | 'FAILED' | 'EXPIRED' (SumUp usa PAID/PENDING/FAILED).
async function getCheckout(id) {
  const data = await apiFetch(`/checkouts/${encodeURIComponent(id)}`);
  const status = String((data && data.status) || '').toUpperCase();
  return { status, raw: data };
}

// True si un estado de checkout equivale a «pagado».
function isPaid(status) {
  return String(status || '').toUpperCase() === 'PAID';
}

module.exports = {
  config,
  isConfigured,
  redact,
  createHostedCheckout,
  getCheckout,
  isPaid,
};
