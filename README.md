# Sage PocketBase — Hardware Order Backend

Receives quote requests from [sage.is/hardware](https://sage.is/hardware/).

## Local Development

```bash
# Download PocketBase for your platform from https://pocketbase.io/docs/
# Place the binary in this directory, then:
./pocketbase serve
```

Admin dashboard: `http://127.0.0.1:8090/_/`

The `orders` collection is created automatically via the migration in `pb_migrations/`.

## Email Notifications (Resend)

```bash
export RESEND_API_KEY="re_your_key_here"
./pocketbase serve
```

Update the `from` and `to` addresses in `pb_hooks/main.pb.js` as needed.

To set up Resend: sign up at [resend.com](https://resend.com), verify your domain, create an API key.

## Production (pb.sage.is)

1. Upload this repo to your cluster
2. Download the PocketBase binary for your server's platform (likely `linux_amd64`)
3. Set `RESEND_API_KEY` in your environment
4. Run: `./pocketbase serve --http=0.0.0.0:8090`
5. In admin settings, set Application URL to `https://pb.sage.is`
6. Point `pb.sage.is` DNS to your cluster
7. Set up reverse proxy (Caddy/Nginx) with SSL

## Order Flow

1. User configures hardware at sage.is/hardware
2. Clicks "Request a Quote" and enters name, email, optional org
3. Frontend POSTs to `/api/collections/orders/records`
4. PocketBase saves the order, emails team via Resend
5. Team reviews in PocketBase admin, follows up with a PO/contract

## Roadmap

This PocketBase backend is Phase 1. Phase 2 migrates to Django + Django Ninja with:
- Stripe for Local/Hybrid hardware orders
- Lemon Squeezy for Cloud Managed orders
- Full admin panel for order management
