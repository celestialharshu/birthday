# Birthday Pass

A private birthday-event pass system built with **React + Vite**, **Express**, **MongoDB/Mongoose**, **JWT authentication**, **Gmail SMTP**, QR-code passes, and UPI deep links.

## Deployment

This repository is prepared for Vercel. See [`DEPLOY.md`](./DEPLOY.md) for the complete deployment procedure and environment-variable list.

### Architecture

```text
Vercel
├── React/Vite frontend → client/ → client/dist
└── Express API         → api/index.js → Vercel Function
                              └── MongoDB Atlas
                              └── Gmail SMTP
                              └── UPI deep-link / QR generation
```

The browser calls `/api/...`, so the frontend and backend stay on the same Vercel domain.

## Important payment note

UPI payment creation is direct/deep-link based. There is no payment-provider webhook in this codebase. A paid pass is issued after the user returns and confirms the transaction, optionally with a 12-digit UTR when `REQUIRE_UTR=true`.
