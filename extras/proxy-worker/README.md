# Optional AI DJ proxy

ADHD MED works without this. The scripted DJ needs no network and no key, and
anyone can paste their own Anthropic key into Settings. Deploy this only if you
want every visitor to your copy to get the conversational DJ on your budget.

## Deploy

```bash
npm install -g wrangler
wrangler login

cd extras/proxy-worker
wrangler deploy
wrangler secret put ANTHROPIC_API_KEY          # paste your key
wrangler secret put ALLOWED_ORIGIN             # e.g. https://you.github.io
```

Optional rate limiting — create a KV namespace and bind it as `RATE`:

```bash
wrangler kv namespace create RATE
# add the returned id to wrangler.toml under [[kv_namespaces]], then redeploy
```

Then put the Worker URL into the app: Settings → AI DJ → **Or a proxy URL**, and
leave the API key field empty.

## What it does and does not do

- Accepts one `POST` of the same body the app would send to the Messages API.
- Rejects anything but an allow-listed model, bodies over 16 kB, and requests
  over the per-IP hourly limit.
- Caps `max_tokens` server-side so a crafted request cannot run up a bill.
- Sets CORS to your origin only.
- Never returns your key, and forwards nothing else anywhere.

Costs land on your Anthropic account, roughly a cent or two per session. Watch
your usage dashboard for the first few days; a public proxy is a public
liability, and this one is forty lines rather than a service.
