import crypto from 'crypto';

function verifyToken(token) {
  const appPassword = process.env.APP_PASSWORD || '';
  const validToken = crypto.createHmac('sha256', appPassword).update(appPassword + 'session').digest('hex');
  return token === validToken;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify auth token
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  try {
    const { product, retailer } = req.body;

    if (!product || !retailer) {
      return res.status(400).json({ error: 'Missing product or retailer data' });
    }

    const searchQuery = product.upc
      ? `${product.upc} ${product.name} price site:${retailer.domain}`
      : `"${product.name}" price site:${retailer.domain}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          {
            role: 'user',
            content: `Search for this product on this specific retailer's website and report the current listed price.

Product: ${product.name}
${product.upc ? `UPC: ${product.upc}` : ''}
Retailer domain: ${retailer.domain}

Search for: ${searchQuery}

Respond with ONLY a JSON object (no markdown, no backticks, no explanation):
{
  "found": true/false,
  "price": null or the numeric price as a number (e.g. 129.99),
  "product_url": null or the URL where you found it,
  "listing_title": null or the title of the listing,
  "notes": "brief note about confidence or any caveats"
}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Anthropic API error: ${errText}` });
    }

    const data = await response.json();
    const textContent = data.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    let parsed;
    try {
      const cleaned = textContent.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { found: false, price: null, notes: 'Could not parse AI response' };
    }

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
