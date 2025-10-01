// src/lib/bridge.js
const DEFAULT_TIMEOUT_MS = 30_000;

async function sendTemplateViaBridge({ baseUrl, apiKey, to, name, languageCode = "en", components }) {
  if (!apiKey) {
    const err = new Error("missing BRIDGE_API_KEY");
    err.code = "auth";
    throw err;
  }
  const url = `${baseUrl.replace(/\/+$/,"")}/v1/send`;
  const template = { name, language: { code: languageCode } };
  if (components) template.components = components;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("timeout"), DEFAULT_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-key": apiKey },
      body: JSON.stringify({ to, type: "template", template }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const err = new Error(`bridge_fetch_failed: ${e?.message || String(e)}`);
    err.code = "send_failed";
    throw err;
  }
  clearTimeout(t);

  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text }; }

  if (res.status === 401 || res.status === 403) {
    const err = new Error("bridge_auth");
    err.code = "auth"; err.status = res.status; err.body = json;
    throw err;
  }
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`bridge_non_2xx_${res.status}`);
    err.code = "send_failed"; err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

async function sendTextViaBridge({ baseUrl, apiKey, to, text }) {
  if (!apiKey) {
    const err = new Error("missing BRIDGE_API_KEY");
    err.code = "auth";
    throw err;
  }
  const url = `${baseUrl.replace(/\/+$/,"")}/v1/send`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("timeout"), DEFAULT_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-key": apiKey },
      body: JSON.stringify({ to, text }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const err = new Error(`bridge_fetch_failed: ${e?.message || String(e)}`);
    err.code = "send_failed";
    throw err;
  }
  clearTimeout(t);

  const responseText = await res.text();
  let json; try { json = responseText ? JSON.parse(responseText) : {}; } catch (_) { json = { raw: responseText }; }

  if (res.status === 401 || res.status === 403) {
    const err = new Error("bridge_auth");
    err.code = "auth"; err.status = res.status; err.body = json;
    throw err;
  }
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`bridge_non_2xx_${res.status}`);
    err.code = "send_failed"; err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

async function sendInteractiveViaBridge({ baseUrl, apiKey, to, bodyText, buttons }) {
  if (!apiKey) {
    const err = new Error("missing BRIDGE_API_KEY");
    err.code = "auth";
    throw err;
  }
  const url = `${baseUrl.replace(/\/+$/,"")}/api/messages/send`;

  const interactive = {
    type: "button",
    body: { text: bodyText },
    action: { buttons: buttons.map(btn => ({ 
      type: "reply", 
      reply: { id: btn.id, title: btn.title } 
    }))}
  };

  const payload = { to, type: "interactive", interactive };
  console.log('[bridge] Sending interactive message:', JSON.stringify(payload, null, 2));

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort("timeout"), DEFAULT_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const err = new Error(`bridge_fetch_failed: ${e?.message || String(e)}`);
    err.code = "send_failed";
    throw err;
  }
  clearTimeout(t);

  const responseText = await res.text();
  let json; try { json = responseText ? JSON.parse(responseText) : {}; } catch (_) { json = { raw: responseText }; }

  console.log('[bridge] Interactive message API response:', { status: res.status, body: json });

  if (res.status === 401 || res.status === 403) {
    const err = new Error("bridge_auth");
    err.code = "auth"; err.status = res.status; err.body = json;
    console.error('[bridge] Authentication error:', err);
    throw err;
  }
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`bridge_non_2xx_${res.status}`);
    err.code = "send_failed"; err.status = res.status; err.body = json;
    console.error('[bridge] Send failed:', err);
    throw err;
  }
  return json;
}

module.exports = { sendTemplateViaBridge, sendTextViaBridge, sendInteractiveViaBridge };
