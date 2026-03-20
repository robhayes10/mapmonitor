# MAP Policy Monitor

Scan retailer websites for pricing compliance violations against your Minimum Advertised Price (MAP) policy.

## How It Works

1. Upload your product catalog (UPC, product name, MAP price)
2. Upload your retailer list (name, domain)
3. Hit scan — AI-powered web search finds each product on each retailer's site
4. Violations are flagged with the found price, difference, and direct link

## Deploy to Vercel

### Prerequisites
- A [Vercel](https://vercel.com) account (free tier works)
- An [Anthropic API key](https://console.anthropic.com/) (for AI-powered web search)

### Option A: Deploy via GitHub (recommended)

1. Push this repo to a new GitHub repository
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo
3. In the **Environment Variables** section, add:
   - `ANTHROPIC_API_KEY` = your Anthropic API key
   - `APP_PASSWORD` = a shared password for your team (e.g. `mapmonitor2026`)
   - `SLACK_WEBHOOK_URL` = *(optional)* a Slack incoming webhook URL for violation alerts
4. Click **Deploy**

### Setting Up Slack Alerts

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it "MAP Monitor" and pick your workspace
3. Go to **Incoming Webhooks** → Toggle **On** → **Add New Webhook to Workspace**
4. Pick the channel you want alerts in (e.g. `#map-violations`)
5. Copy the webhook URL and add it as `SLACK_WEBHOOK_URL` in Vercel

When a scan finds violations, a formatted summary is automatically posted to your Slack channel with product names, retailer prices, and direct links to the listings.

### Option B: Deploy via Vercel CLI

```bash
npm i -g vercel
cd map-monitor
vercel
# Follow the prompts, then add your env var:
vercel env add ANTHROPIC_API_KEY
# Redeploy:
vercel --prod
```

## Local Development

```bash
npm install
cp .env.example .env   # Then add your API key
npm run dev
```

## CSV Format

### Products CSV
```
upc,name,map
012345678901,Premium Wireless Headphones X500,149.99
012345678902,Bluetooth Speaker ProMax 200,89.99
```

### Retailers CSV
```
name,domain
Amazon,amazon.com
Best Buy,bestbuy.com
```

## Cost

Each product × retailer scan makes one Anthropic API call using Claude Sonnet with web search. A scan of 50 products across 20 retailers = 1,000 API calls per run.
