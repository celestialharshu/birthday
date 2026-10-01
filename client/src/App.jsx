import { useState, useEffect, useRef } from 'react';

const api = async (path, opts = {}) => {
  const token = localStorage.getItem('token');
  const r = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: opts.body && JSON.stringify(opts.body),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { localStorage.clear(); location.reload(); }
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
};
const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const code = location.pathname.startsWith('/verify/') ? location.pathname.split('/')[2] : null;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <div className="wrap">
      <header>
        <h1>Event Pass</h1>
        <div>
          {user.name}{user.role === 'admin' && ' (admin)'}{' '}
          <button className="ghost" onClick={() => { localStorage.clear(); location.href = '/'; }}>Logout</button>
        </div>
      </header>
      {code ? <Verify code={code} /> : <Dashboard user={user} />}
    </div>
  );
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const d = await api('/login', { method: 'POST', body: { email, password } });
      localStorage.setItem('token', d.token);
      localStorage.setItem('user', JSON.stringify(d.user));
      onLogin(d.user);
    } catch (e) { setErr(e.message); }
  };
  return (
    <form className="login" onSubmit={submit}>
      <h1>🎂 Birthday Pass</h1>
      <p className="muted">Members & admin only</p>
      <input type="email" inputMode="email" autoComplete="username" autoCapitalize="none" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <button style={{ width: '100%' }}>Log in</button>
    </form>
  );
}
function Loader() {
  return (
    <div className="loader-wrap">
      <div className="spinner" />
      <p className="muted">Loading events…</p>
    </div>
  );
}

function Dashboard({ user }) {
  const [events, setEvents] = useState([]);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const load = () => api('/events').then(setEvents).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  useEffect(() => { load(); const p = getPending(); if (p) setOpen(p.eventId); }, []);
  const current = events.find((e) => e.id === open);
  return (
    <>
      {user.role === 'admin' && <button onClick={() => setCreating(true)}>+ Create event</button>}
      {err && <p className="err">{err}</p>}
      {loading && <Loader />}
      {!loading && !events.length && !err && <p className="muted">No events yet.</p>}
      <div className="grid">
        {events.map((e) => (
          <div key={e.id} className="card" onClick={() => setOpen(e.id)}>
            <div className="top"> {e.birthdayName}'s Birthday</div>
            <h3 style={{ margin: '4px 0' }}>{e.title}</h3>
            <p>{fmt(e.date)}</p>
            <p>{e.invitedCount} members invited</p>
            <p>{e.participants.filter((p) => p.paid).length}/{e.invitedCount} paid · ₹{e.amount} each</p>
          </div>
        ))}
      </div>
      {current && <EventModal ev={current} user={user} onClose={() => setOpen(null)} onChange={load} />}
      {creating && <CreateEvent onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
    </>
  );
}

const PENDING = 'pendingPay';
const getPending = () => { try { return JSON.parse(localStorage.getItem(PENDING) || 'null'); } catch { return null; } };
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = isIOS || /Android/i.test(navigator.userAgent);

function EventModal({ ev, user, onClose, onChange }) {
  const pending = getPending();
  const resume = pending && pending.eventId === ev.id ? pending : null;
  const [stage, setStage] = useState(resume ? 'confirm' : 'form'); // form | apps | confirm | done
  const [pay, setPay] = useState(resume);
  const [email, setEmail] = useState(resume?.email || '');
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState(null);
  const [utr, setUtr] = useState('');
  const [amountEdit, setAmountEdit] = useState(String(ev.amount));
  const [done, setDone] = useState(null);
  const [msg, setMsg] = useState({ t: '', ok: false });
  const [busy, setBusy] = useState(false);
  const left = useRef(false);
  const admin = user.role === 'admin';
  const mine = ev.participants.find((p) => p.id === user.id);
  const isBirthday = ev.birthdayUserId === user.id;
  const hasPass = mine?.paid || (isBirthday && ev.birthdayPassClaimed);
  const canPay = (mine && !mine.paid) || (isBirthday && !ev.birthdayPassClaimed);
  const amount = quote ? quote.amount : isBirthday ? 0 : ev.amount;
  const say = (t, ok = false) => setMsg({ t, ok });

  // When the person returns from GPay / PhonePe / Paytm, move to the confirm step
  useEffect(() => {
    if (stage !== 'apps') return;
    const back = () => { if (document.visibilityState === 'visible' && left.current) setStage('confirm'); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('pageshow', back);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('pageshow', back); };
  }, [stage]);

  const applyCoupon = async () => {
    if (!coupon.trim()) return say('Enter a coupon code');
    setBusy(true); say('');
    try {
      const q = await api(`/events/${ev.id}/quote`, { method: 'POST', body: { coupon } });
      setQuote({ ...q, code: coupon.trim().toUpperCase() });
      say(q.label || 'Coupon applied', true);
    } catch (e) { setQuote(null); say(e.message); }
    setBusy(false);
  };
  const removeCoupon = () => { setQuote(null); setCoupon(''); say(''); };

  const makePayment = async () => {
    setBusy(true); say('');
    try {
      const r = await api(`/events/${ev.id}/pay`, { method: 'POST', body: { email, coupon: quote ? quote.code : '' } });
      if (r.free) {
        setDone({ free: true, emailSent: r.emailSent });
        setStage('done'); onChange();
      } else {
        const p = { ...r, eventId: ev.id, email };
        localStorage.setItem(PENDING, JSON.stringify(p));
        left.current = false; setPay(p); setStage('apps');
      }
    } catch (e) { say(e.message); }
    setBusy(false);
  };

  const link = (app) => {
    const q = pay.query;
    if (app === 'gpay') return isIOS ? `gpay://upi/pay?${q}` : `tez://upi/pay?${q}`;
    if (app === 'phonepe') return `phonepe://pay?${q}`;
    if (app === 'paytm') return `paytmmp://pay?${q}`;
    return `upi://pay?${q}`;
  };
  const apps = [['gpay', 'Google Pay', '#4285f4'], ['phonepe', 'PhonePe', '#5f259f'], ['paytm', 'Paytm', '#00b9f1'], ['other', 'Other UPI app', '#3a3d6b']];

  const copy = async (t) => { try { await navigator.clipboard.writeText(t); say('Copied ✅', true); } catch { say('Copy failed, long-press to copy'); } };

  const confirm = async () => {
    setBusy(true); say('');
    try {
      const r = await api(`/events/${ev.id}/confirm`, { method: 'POST', body: { ref: pay.ref, utr } });
      localStorage.removeItem(PENDING);
      setDone({ free: false, emailSent: r.emailSent, amount: pay.amount });
      setStage('done'); onChange();
    } catch (e) { say(e.message); }
    setBusy(false);
  };
  const cancelPay = () => { localStorage.removeItem(PENDING); setPay(null); setUtr(''); say(''); setStage('form'); };

  const resend = async () => {
    try { const v = await api(`/events/${ev.id}/resend`, { method: 'POST' }); say(v.emailSent ? 'Pass re-sent ✅' : 'Email failed, try again', v.emailSent); }
    catch (e) { say(e.message); }
  };
  const saveAmount = async () => {
    try { await api(`/events/${ev.id}`, { method: 'PATCH', body: { amount: Number(amountEdit) } }); say('Amount updated ✅', true); onChange(); }
    catch (e) { say(e.message); }
  };
  const revoke = async (p) => {
    if (!confirmBox(`Cancel ${p.name}'s pass?`)) return;
    try { await api(`/passes/${p.passId}/revoke`, { method: 'POST' }); onChange(); } catch (e) { say(e.message); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="top"> {ev.birthdayName}'s Birthday</div>
        <h2 style={{ margin: '4px 0' }}>{ev.title}</h2>
        <p className="muted">{fmt(ev.date)} · {ev.invitedCount} invited · ₹{ev.amount} each</p>

        {stage === 'done' ? (
          <div className="success">
            <div className="tick">✅</div>
            <h2>{done.free ? 'Free pass confirmed!' : 'Payment successful!'}</h2>
            {!done.free && <p className="big">₹{done.amount} paid</p>}
            <p className="muted">{done.emailSent ? 'Your pass with QR code was sent to your email.' : 'Email failed. Tap "Resend pass" on the event.'}</p>
            <button style={{ width: '100%' }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            {ev.participants.map((p) => (
              <div className="row" key={p.id}>
                <span>{p.name}
                  {admin && p.paid && <small className="muted"> {p.email}{p.utr ? ` · UTR ${p.utr}` : ''}{p.coupon ? ` · ${p.coupon}` : ''}</small>}
                </span>
                <span>
                  <span className={p.paid ? 'paid' : 'pending'}>{p.paid ? (p.paidAmount === 0 ? 'Free ✅' : 'Paid ✅') : 'Pending'}</span>
                  {admin && p.paid && <button className="mini" onClick={() => revoke(p)}>Cancel</button>}
                </span>
              </div>
            ))}

            {admin && (
              <div className="adminbox">
                <p className="muted">Admin: amount per member (₹)</p>
                <div className="inline">
                  <input type="number" inputMode="numeric" value={amountEdit} onChange={(e) => setAmountEdit(e.target.value)} />
                  <button onClick={saveAmount}>Save</button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              {hasPass && <><p className="paid">{mine?.paid ? 'Payment done ✅ Your pass is in your email.' : '🎁 Your free pass is claimed.'}</p><button className="ghost" onClick={resend}>Resend pass</button></>}

              {!hasPass && canPay && stage === 'form' && (
                <>
                  <p>{isBirthday ? "🎁 It's your birthday, your pass is free!" : 'Enter your working email. Your pass and QR code will be sent there.'}</p>
                  <input type="email" inputMode="email" autoComplete="email" placeholder="your.real@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                  {!isBirthday && (
                    <>
                      <label className="lbl">Coupon code</label>
                      <div className="inline">
                        <input placeholder="Have a coupon?" autoCapitalize="characters" autoCorrect="off" spellCheck="false" value={coupon} disabled={!!quote}
                          onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
                        {quote ? <button className="ghost" onClick={removeCoupon}>Remove</button> : <button disabled={busy} onClick={applyCoupon}>Apply</button>}
                      </div>
                    </>
                  )}
                  <div className="total"><span>Total</span><b>{amount === 0 ? 'FREE' : `₹${amount}`}</b></div>
                  <button className="big-btn" disabled={busy} onClick={makePayment}>{amount === 0 ? 'Get my free pass' : `Make payment · ₹${amount}`}</button>
                </>
              )}

              {stage === 'apps' && pay && (
                <>
                  <div className="total"><span>Pay to {pay.payee}</span><b>₹{pay.amount}</b></div>
                  <p className="muted">Choose your app. After paying, come back to this page.</p>
                  <div className="apps">
                    {apps.map(([k, name, c]) => (
                      <a key={k} className="appbtn" style={{ background: c }} href={link(k)} onClick={() => { left.current = true; }}>{name}</a>
                    ))}
                  </div>
                  {!isMobile && <div className="qrbox"><p className="muted">On a computer? Scan with any UPI app</p><img src={pay.qr} alt="UPI QR" /></div>}
                  <div className="row"><span className="muted">UPI ID</span><span>{pay.upiId} <button className="mini" onClick={() => copy(pay.upiId)}>Copy</button></span></div>
                  <button className="ghost full" onClick={() => setStage('confirm')}>I have paid</button>
                  <button className="link" onClick={cancelPay}>← Change details</button>
                </>
              )}

              {stage === 'confirm' && pay && (
                <>
                  <h3 style={{ margin: '0 0 6px' }}>Welcome back 👋</h3>
                  <p>Did your payment of <b>₹{pay.amount}</b> go through?</p>
                  <label className="lbl">UTR / Transaction ID {` (12 digits, from your payment app)`}</label>
                  <input inputMode="numeric" maxLength={12} placeholder="e.g. 412345678901" value={utr} onChange={(e) => setUtr(e.target.value.replace(/\D/g, ''))} />
                  <button className="big-btn" disabled={busy} onClick={confirm}>✅ Yes, I paid</button>
                  <button className="ghost full" onClick={() => { left.current = false; setStage('apps'); }}>No, try again</button>
                  <button className="link" onClick={cancelPay}>Cancel payment</button>
                </>
              )}
              {msg.t && <p className={msg.ok ? 'ok' : 'err'}>{msg.t}</p>}
            </div>
            <button className="ghost full" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
          </>
        )}
      </div>
    </div>
  );
}
const confirmBox = (t) => window.confirm(t);

function CreateEvent({ onClose, onDone }) {
  const [users, setUsers] = useState([]);
  const [f, setF] = useState({ title: '', birthdayUser: '', date: '', amount: '' });
  const [invited, setInvited] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { api('/users').then(setUsers).catch((e) => setErr(e.message)); }, []);
  const others = users.filter((u) => u._id !== f.birthdayUser);
  const toggle = (id) => setInvited((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const save = async () => {
    try {
      await api('/events', { method: 'POST', body: { ...f, amount: Number(f.amount), invited: invited.filter((id) => id !== f.birthdayUser) } });
      onDone();
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create event</h2>
        <input placeholder="Event name (e.g. Anirudh's Birthday)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <select value={f.birthdayUser} onChange={(e) => { setF({ ...f, birthdayUser: e.target.value }); setInvited([]); }}>
          <option value="">Birthday person…</option>
          {users.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
        </select>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <input type="number" inputMode="numeric" placeholder="Amount per member (₹)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <p className="muted">Invite members (birthday person is free):</p>
        {f.birthdayUser && others.map((u) => (
          <label className="chk" key={u._id}>
            <input type="checkbox" checked={invited.includes(u._id)} onChange={() => toggle(u._id)} /> {u.name}
          </label>
        ))}
        {err && <p className="err">{err}</p>}
        <button style={{ marginTop: 12 }} onClick={save}>Create</button>{' '}
        <button className="ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function Verify({ code }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { api('/verify/' + code).then(setInfo).catch((e) => setErr(e.message)); }, [code]);
  const checkin = async () => { try { await api(`/verify/${code}/checkin`, { method: 'POST' }); setDone(true); } catch (e) { setErr(e.message); } };
  return (
    <div className="card" style={{ cursor: 'default', maxWidth: 400 }}>
      <h2>Pass check</h2>
      {err && <p className="err">❌ {err}</p>}
      {info && <>
        <p>👤 {info.name}</p><p> {info.event}</p><p>{info.type === 'free' ? 'Birthday free pass' : 'Paid pass'}</p>
        {info.used || done ? <p className="err">Already checked in</p> : <button onClick={checkin}>✅ Let in</button>}
      </>}
    </div>
  );
}
