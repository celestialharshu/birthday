const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const { User, Event, Pass } = require('./_models');

const app = express();
app.use(express.json());

let conn;
app.use(async (req, res, next) => {
  try {
    conn = conn || mongoose.connect(process.env.MONGODB_URI);
    await conn;
    next();
  } catch (e) { conn = null; next(e); }
});

const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
});
const UPI_ID = process.env.UPI_ID || 'harshitsharma3557-1@oksbi';
const UPI_NAME = process.env.UPI_NAME || 'Harshit Sharma';
const REQUIRE_UTR = process.env.REQUIRE_UTR === 'true';
const DONE = ['paid', 'free'];
// Coupons: 100 = no fees
const COUPONS = {
  BIRTHDAYBOY: { percent: 100, label: 'Birthday boy: no fees 🎂' },
  SPECIALMEMBER: { price: 170, label: 'Special member price: ₹170 ⭐' },
};
// Works out what a user must pay for an event
function priceFor(ev, userId, codeRaw) {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (same(ev.birthdayUser, userId)) return { amount: 0, coupon: code || 'BIRTHDAY', label: "It's your birthday, free pass 🎁" };
  if (!code) return { amount: ev.amount, coupon: '', label: '' };
  const c = COUPONS[code];
  if (!c) return { error: 'Invalid coupon code' };
  const amount = c.price !== undefined
    ? Math.min(c.price, ev.amount)                       // fixed price, never higher than the event amount
    : Math.max(0, Math.round(ev.amount * (100 - c.percent) / 100));
  return { amount, coupon: code, label: c.label };
}
const isEmail = (s) => /^\S+@\S+\.\S+$/.test(s);
const same = (a, b) => String(a) === String(b);

const auth = (role) => (req, res, next) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    if (role && req.user.role !== role) return res.status(403).json({ error: 'Admin only' });
    next();
  } catch { res.status(401).json({ error: 'Please log in again' }); }
};

async function present(e, admin = false) {
  const users = await User.find({ _id: { $in: [e.birthdayUser, ...e.invited] } }).select('name');
  const nameOf = (id) => users.find((u) => same(u._id, id))?.name;
  const passes = await Pass.find({ event: e._id, status: { $in: DONE } });
  const st = new Map(passes.map((p) => [String(p.user), p.status]));
  const pm = new Map(passes.map((p) => [String(p.user), p]));
  return {
    id: e._id, title: e.title, date: e.date, amount: e.amount,
    birthdayUserId: e.birthdayUser, birthdayName: nameOf(e.birthdayUser),
    invitedCount: e.invited.length,
    birthdayPassClaimed: st.get(String(e.birthdayUser)) === 'free',
    participants: e.invited.map((id) => {
      const p = pm.get(String(id));
      return {
        id, name: nameOf(id), paid: !!p,
        ...(admin && p && { passId: p._id, email: p.email, utr: p.utr, coupon: p.coupon, paidAmount: p.amount, status: p.status }),
      };
    }),
  };
}

async function issuePass(pass, ev, user, req) {
  if (!pass.code) { pass.code = crypto.randomBytes(12).toString('hex'); await pass.save(); }
  try {
    const configuredUrl = String(process.env.APP_URL || '').replace(/\/$/, '');
    const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const forwardedProto = req?.get?.('x-forwarded-proto') || req?.protocol || 'https';
    const requestUrl = req?.get?.('host') ? `${forwardedProto}://${req.get('host')}` : '';
    const appUrl = configuredUrl || (vercelUrl ? `https://${vercelUrl}` : requestUrl);
    if (!appUrl) throw new Error('APP_URL is not configured');
    const png = await QRCode.toBuffer(`${appUrl}/verify/${pass.code}`, { width: 360, margin: 2 });
    await mailer.sendMail({
      from: `Birthday Pass <${process.env.GMAIL_USER}>`,
      to: pass.email,
      subject: `🎉 Your pass for ${ev.title}`,
      html: `<div style="font-family:sans-serif;text-align:center">
        <h2>🎉 You're in, ${user.name}!</h2>
        <p><b>${ev.title}</b><br>${new Date(ev.date).toDateString()}</p>
        <img src="cid:qr" width="240" alt="QR pass">
        <p>Show this QR code at the entry. It works once.</p></div>`,
      attachments: [{ filename: 'pass.png', content: png, cid: 'qr' }],
    });
    return true;
  } catch (e) { console.error('mail failed', e.message); return false; }
}

app.post('/api/login', async (req, res) => {
  const u = await User.findOne({ email: (req.body.email || '').toLowerCase().trim() });
  if (!u || !(await bcrypt.compare(req.body.password || '', u.passwordHash)))
    return res.status(401).json({ error: 'Wrong email or password' });
  const token = jwt.sign({ id: u._id, role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: u._id, name: u.name, role: u.role } });
});

app.get('/api/users', auth('admin'), async (req, res) => {
  res.json(await User.find().select('name role'));
});

app.get('/api/events', auth(), async (req, res) => {
  const q = req.user.role === 'admin' ? {} : { $or: [{ invited: req.user.id }, { birthdayUser: req.user.id }] };
  const events = await Event.find(q).sort({ date: 1 });
  res.json(await Promise.all(events.map((e) => present(e, req.user.role === 'admin'))));
});

app.post('/api/events', auth('admin'), async (req, res) => {
  const { title, birthdayUser, date, amount, invited } = req.body;
  if (!title || !birthdayUser || !date || !(amount > 0)) return res.status(400).json({ error: 'Fill all fields' });
  const list = (invited || []).filter((id) => !same(id, birthdayUser));
  if (!list.length) return res.status(400).json({ error: 'Invite at least one member' });
  const ev = await Event.create({ title, birthdayUser, date, amount: Math.round(amount), invited: list });
  res.json(await present(ev, true));
});

// Admin: change the amount (affects future payments only)
app.patch('/api/events/:id', auth('admin'), async (req, res) => {
  const amount = Math.round(Number(req.body.amount));
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount' });
  const ev = await Event.findByIdAndUpdate(req.params.id, { amount }, { new: true });
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  res.json(await present(ev, true));
});

async function loadForUser(req, res) {
  const ev = await Event.findById(req.params.id);
  const allowed = ev && (ev.invited.some((i) => same(i, req.user.id)) || same(ev.birthdayUser, req.user.id));
  if (!allowed) { res.status(403).json({ error: 'You are not invited' }); return null; }
  if (await Pass.findOne({ event: ev._id, user: req.user.id, status: { $in: DONE } })) {
    res.status(400).json({ error: 'You already have a pass' }); return null;
  }
  return ev;
}

// Coupon preview
app.post('/api/events/:id/quote', auth(), async (req, res) => {
  const ev = await loadForUser(req, res); if (!ev) return;
  const p = priceFor(ev, req.user.id, req.body.coupon);
  if (p.error) return res.status(400).json({ error: p.error });
  res.json({ amount: p.amount, label: p.label, coupon: p.coupon });
});

// "Make payment": free -> pass issued now; paid -> returns UPI details to open the apps
app.post('/api/events/:id/pay', auth(), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });
  const ev = await loadForUser(req, res); if (!ev) return;
  const p = priceFor(ev, req.user.id, req.body.coupon);
  if (p.error) return res.status(400).json({ error: p.error });

  if (p.amount === 0) {
    const pass = await Pass.findOneAndUpdate(
      { event: ev._id, user: req.user.id, status: { $ne: 'revoked' } },
      { email, status: 'free', amount: 0, coupon: p.coupon, paidAt: new Date() },
      { upsert: true, new: true });
    return res.json({ free: true, emailSent: await issuePass(pass, ev, req.user, req) });
  }

  const txRef = 'BP' + crypto.randomBytes(7).toString('hex').toUpperCase();
  await Pass.findOneAndUpdate(
    { event: ev._id, user: req.user.id, status: 'pending' },
    { email, ref: txRef, amount: p.amount, coupon: p.coupon }, { upsert: true });
  const enc = encodeURIComponent;
  const note = `${ev.title}`.replace(/[^\w\s]/g, '').slice(0, 40) || 'Birthday Pass';
  const query = `pa=${enc(UPI_ID)}&pn=${enc(UPI_NAME)}&am=${p.amount.toFixed(2)}&cu=INR&tn=${enc(note)}&tr=${txRef}`;
  const qr = await QRCode.toDataURL(`upi://pay?${query}`, { width: 280, margin: 1 });
  res.json({ free: false, ref: txRef, amount: p.amount, query, qr, upiId: UPI_ID, payee: UPI_NAME });
});

// User comes back from the UPI app and confirms
app.post('/api/events/:id/confirm', auth(), async (req, res) => {
  const txRef = String(req.body.ref || '');
  const utr = String(req.body.utr || '').trim();
  const pass = await Pass.findOne({ ref: txRef, user: req.user.id, event: req.params.id });
  if (!pass) return res.status(404).json({ error: 'Payment not found, start again' });
  if (DONE.includes(pass.status)) return res.json({ ok: true, emailSent: true });
  if (pass.status !== 'pending') return res.status(400).json({ error: 'This payment is not valid' });
  if (utr && !/^\d{12}$/.test(utr)) return res.status(400).json({ error: 'UTR must be 12 digits' });
  if (REQUIRE_UTR && !utr) return res.status(400).json({ error: 'Enter the 12 digit UTR from your payment app' });
  if (utr && await Pass.findOne({ utr, _id: { $ne: pass._id }, status: { $in: DONE } }))
    return res.status(400).json({ error: 'This UTR was already used' });
  pass.status = 'paid'; pass.utr = utr || undefined; pass.paidAt = new Date();
  await pass.save();
  const ev = await Event.findById(req.params.id);
  res.json({ ok: true, emailSent: await issuePass(pass, ev, req.user, req) });
});

// Admin: cancel a payment that turned out to be fake
app.post('/api/passes/:id/revoke', auth('admin'), async (req, res) => {
  const pass = await Pass.findByIdAndUpdate(req.params.id, { status: 'revoked' });
  if (!pass) return res.status(404).json({ error: 'Pass not found' });
  res.json({ ok: true });
});

app.post('/api/events/:id/resend', auth(), async (req, res) => {
  const pass = await Pass.findOne({ event: req.params.id, user: req.user.id, status: { $in: DONE } });
  if (!pass) return res.status(404).json({ error: 'No pass yet' });
  const ev = await Event.findById(req.params.id);
  res.json({ emailSent: await issuePass(pass, ev, req.user, req) });
});

app.get('/api/verify/:code', auth('admin'), async (req, res) => {
  const pass = await Pass.findOne({ code: req.params.code }).populate('user event');
  if (!pass || !DONE.includes(pass.status)) return res.status(404).json({ error: 'Invalid or cancelled pass' });
  res.json({ name: pass.user.name, event: pass.event.title, type: pass.status, used: pass.used });
});
app.post('/api/verify/:code/checkin', auth('admin'), async (req, res) => {
  const pass = await Pass.findOneAndUpdate({ code: req.params.code, used: false, status: { $in: DONE } }, { used: true });
  if (!pass) return res.status(400).json({ error: 'Invalid or already used' });
  res.json({ ok: true });
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error, try again' }); });

module.exports = app;
