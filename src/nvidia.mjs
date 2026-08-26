export const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const DEFAULT_MODEL = 'nvidia/llama-3.3-nemotron-super-49b-v1.5';

export function extractOutputText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

export async function generateReply({
  message,
  tone,
  apiKey,
  model = DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  signal,
}) {
  const instructions = [
    'You write polished replies for email, chat, and customer support.',
    `Use a ${tone} tone.`,
    'Return only the reply that the user can send.',
    'Do not invent names, dates, promises, prices, or company policies.',
    'Keep the reply clear, natural, and concise unless the message requires detail.',
  ].join(' ');

  const response = await fetchImpl(NVIDIA_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: message },
      ],
      temperature: 0.2,
      top_p: 0.7,
      max_tokens: 400,
      stream: false,
    }),
    signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = response.status === 410
      ? 'The selected NVIDIA model endpoint is unavailable. Please try again after the deployment model is updated.'
      : (payload?.error?.message || payload?.detail || `NVIDIA request failed (${response.status})`);
    const error = new Error(detail);
    error.statusCode = response.status;
    throw error;
  }

  const reply = extractOutputText(payload);
  if (!reply) {
    throw new Error('NVIDIA returned an empty reply.');
  }

  return { reply, model: payload.model || model };
}
