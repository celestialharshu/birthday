# Birthday Pass — Vercel Deployment Guide

This project is a Vite + React frontend with an Express + MongoDB API and manual UPI payment confirmation.

## 1. Repository layout

The Git repository root should contain:

- `api/` — Express API deployed as a Vercel Function
- `client/` — React/Vite frontend
- `scripts/seed.js` — one-time database user seeding script
- `vercel.json` — Vercel build, API routing, and SPA fallback
- `package.json` — root build command and backend dependencies

If your Git repository has an outer folder such as `birthday-pass/`, set Vercel's **Root Directory** to that folder. Otherwise keep the Root Directory at `.`.

## 2. Push to GitHub

From the folder containing this `package.json`:

```bash
git init
git add .
git commit -m "Prepare Birthday Pass for Vercel"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

Do not commit `.env`. The repository ignores it.

## 3. Create the Vercel project

In Vercel:

1. **Add New Project** → import the GitHub repository.
2. Make sure **Root Directory** points to the folder containing `package.json`, `api/`, and `client/`.
3. Keep the build settings controlled by `vercel.json`.
4. Deploy after adding the environment variables below.

The project builds the React app into `client/dist`; the Express API stays under `api/` as a Vercel Function.

## 4. Required Vercel environment variables

Add these in **Project → Settings → Environment Variables** for Production (and Preview too if you want preview deployments to work):

```text
MONGODB_URI=your MongoDB Atlas connection string
JWT_SECRET=a long random secret
GMAIL_USER=your Gmail address
GMAIL_APP_PASSWORD=your 16-character Google App Password
UPI_ID=your UPI ID
UPI_NAME=your display/payee name
REQUIRE_UTR=true
```

`APP_URL` is optional with the deployment-ready API code. When present, use the final HTTPS site URL. When absent, the API can fall back to Vercel's production URL system variable.

## 5. MongoDB Atlas

Create a MongoDB Atlas database and use its SRV connection string for `MONGODB_URI`.

Because Vercel Functions do not have one fixed outbound IP for every deployment, your Atlas Network Access rules need to permit the deployment to connect. If you use an allow-all rule (`0.0.0.0/0`), protect the database with a strong username/password and least-privilege database user.

## 6. Gmail setup

For Gmail SMTP, use a Google **App Password** with the Gmail account in `GMAIL_USER`. Do not put your normal Gmail password in Vercel or GitHub.

## 7. UPI payment behavior

The app creates a UPI deep link and QR code for the amount stored on the event. The user pays in Google Pay/PhonePe/Paytm/another UPI app and then returns to the site.

The current application is **not connected to a bank/payment-gateway webhook**. A payment is marked `paid` after the user submits the UTR. Set `REQUIRE_UTR=true` to require a 12-digit UTR, but understand that this is still a manual confirmation flow and does not independently verify the bank transaction.

## 8. Seed the users once

Run the seed script from the project root on a machine that has the real `MONGODB_URI` in a local `.env` file:

```bash
npm install
npm run seed
```

The current `scripts/seed.js` contains demo user credentials. Treat them as temporary and change the credentials before real use; do not expose them in a public repository.

## 9. Verify the deployment

After deployment, test these paths:

```text
https://YOUR-DOMAIN.vercel.app/
https://YOUR-DOMAIN.vercel.app/verify/SOME_CODE
```

Then test the actual flow in this order:

1. Log in.
2. Open an event.
3. Test the free birthday pass.
4. Test a paid UPI flow with `REQUIRE_UTR=true`.
5. Confirm the QR pass email arrives.
6. Log in as admin and test event creation / amount change.
7. Open the QR verification URL and test the one-time check-in.

## 10. If deployment fails

Open **Vercel → Project → Deployments → failed deployment → Build Logs / Function Logs**.

For this project, the first things to check are:

- `MONGODB_URI` is set correctly.
- `JWT_SECRET` is set.
- Gmail App Password is correct.
- `UPI_ID` and `UPI_NAME` are set.
- Vercel Root Directory points to the folder containing `vercel.json`.
- `client/dist` is created during the build.
- MongoDB Atlas Network Access allows the Vercel Function to connect.
