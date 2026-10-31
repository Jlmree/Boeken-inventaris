export const CATEGORIES = ['Tops', 'Broeken', 'Jurken & rokken', 'Jassen', 'Schoenen', 'Accessoires', 'Ondergoed & sokken', 'Nachtkleding', 'Sport'];
export const COLORS = ['zwart', 'wit', 'grijs', 'beige', 'bruin', 'rood', 'roze', 'oranje', 'geel', 'groen', 'blauw', 'marineblauw', 'paars', 'multi'];
export const SEASONS = ['alle seizoenen', 'zomer', 'winter', 'lente/herfst'];

const PROMPT = `Dit is een foto van één kledingstuk (of paar schoenen/accessoire). Antwoord alleen met JSON, zonder uitleg, in dit formaat:
{"name": "korte Nederlandse naam, bv. 'Gestreepte trui'", "category": "${CATEGORIES.join(' | ')}", "color": "${COLORS.join(' | ')}", "season": "${SEASONS.join(' | ')}", "material": "vermoedelijk materiaal of leeg", "pattern": "effen | gestreept | geruit | bedrukt | anders", "brand": "merk als het zichtbaar is, anders leeg"}
Kies bij category, color en season exact één van de genoemde opties. Gok niet bij brand en material: laat leeg als je het niet ziet.`;

const pick = (v, list) => (list.includes(String(v).toLowerCase()) ? String(v).toLowerCase() : list.find(x => x.toLowerCase() === String(v).toLowerCase()) || '');
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Laat een Claude-model een kledingfoto beschrijven. Geeft alleen gecontroleerde waarden terug. */
export async function analyze({ apiKey, model, image, fetchImpl = fetch }) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } },
          { type: 'text', text: PROMPT }
        ]
      }]
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error('ai-' + res.status);
  const text = (await res.json()).content?.find(c => c.type === 'text')?.text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('ai-onleesbaar');
  const j = JSON.parse(m[0]);
  return {
    name: str(j.name, 120),
    category: pick(j.category, CATEGORIES),
    color: pick(j.color, COLORS),
    season: pick(j.season, SEASONS),
    material: str(j.material, 60),
    pattern: str(j.pattern, 30),
    brand: str(j.brand, 60)
  };
}
