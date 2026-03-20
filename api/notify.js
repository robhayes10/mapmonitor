import crypto from 'crypto';

function verifyToken(token) {
  const appPassword = process.env.APP_PASSWORD || '';
  const validToken = crypto.createHmac('sha256', appPassword).update(appPassword + 'session').digest('hex');
  return token === validToken;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify auth
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(200).json({ skipped: true, reason: 'No SLACK_WEBHOOK_URL configured' });
  }

  try {
    const { violations, summary } = req.body;

    if (!violations || violations.length === 0) {
      return res.status(200).json({ skipped: true, reason: 'No violations to report' });
    }

    // Build Slack message blocks
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🚨 MAP Violations Detected — ${violations.length} found`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Scan completed:* ${summary.total} combinations scanned\n*Compliant:* ${summary.compliant}  |  *Violations:* ${summary.violations}  |  *Not found:* ${summary.notFound}`,
        },
      },
      { type: 'divider' },
    ];

    // Add each violation (cap at 15 to avoid Slack block limits)
    const displayViolations = violations.slice(0, 15);
    for (const v of displayViolations) {
      const diff = Math.abs(v.difference).toFixed(2);
      const url = v.product_url ? `  <${v.product_url}|View listing>` : '';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${v.product.name}*\n${v.retailer.name} (${v.retailer.domain})\nMAP: $${v.mapPrice.toFixed(2)}  →  Found: *$${v.foundPrice.toFixed(2)}*  (_-$${diff} below MAP_)${url}`,
        },
      });
    }

    if (violations.length > 15) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `_...and ${violations.length - 15} more violations. Open the MAP Monitor for the full report._`,
        },
      });
    }

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Scanned at ${new Date().toLocaleString('en-US', { timeZone: 'America/Denver', dateStyle: 'medium', timeStyle: 'short' })} MT  •  MAP Policy Monitor`,
        },
      ],
    });

    const slackRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });

    if (!slackRes.ok) {
      const errText = await slackRes.text();
      return res.status(500).json({ error: `Slack error: ${errText}` });
    }

    return res.status(200).json({ sent: true, violationCount: violations.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
