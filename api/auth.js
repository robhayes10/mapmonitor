import crypto from 'crypto';

// Simple HMAC token generation using the password + a secret
function generateToken(password) {
  const secret = process.env.APP_PASSWORD || '';
  return crypto.createHmac('sha256', secret).update(password + Date.now().toString().slice(0, -5)).digest('hex');
}

export function verifyToken(token) {
  // Re-generate what valid tokens look like for the current ~30s window and nearby windows
  const secret = process.env.APP_PASSWORD || '';
  const password = process.env.APP_PASSWORD || '';
  const now = Date.now().toString().slice(0, -5);
  const prev = (Date.now() - 100000).toString().slice(0, -5);

  // Tokens are valid for a long session, so we just check the HMAC structure
  // For simplicity, we'll use a static token per password that doesn't expire
  const validToken = crypto.createHmac('sha256', secret).update(password + 'session').digest('hex');
  return token === validToken;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return res.status(500).json({ error: 'APP_PASSWORD not configured on server' });
  }

  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  if (password !== appPassword) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Generate a session token
  const token = crypto.createHmac('sha256', appPassword).update(appPassword + 'session').digest('hex');

  return res.status(200).json({ token });
}
