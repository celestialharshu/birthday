const mongoose = require('mongoose');
const { Schema, model, models } = mongoose;
const ref = (r) => ({ type: Schema.Types.ObjectId, ref: r });

const User = models.User || model('User', new Schema({
  name: String,
  email: { type: String, unique: true },
  passwordHash: String,
  role: { type: String, default: 'member' },
}));

const Event = models.Event || model('Event', new Schema({
  title: String,
  birthdayUser: ref('User'),
  date: Date,
  amount: Number,
  invited: [ref('User')],
}, { timestamps: true }));

// status: pending -> paid | free | revoked
const Pass = models.Pass || model('Pass', new Schema({
  event: ref('Event'),
  user: ref('User'),
  email: String,
  ref: String,          // our payment reference (sent to UPI app as "tr")
  amount: Number,       // amount the user had to pay (after coupon)
  coupon: String,
  utr: String,          // bank reference number the user enters after paying
  status: { type: String, default: 'pending' },
  paidAt: Date,
  code: String,
  used: { type: Boolean, default: false },
}, { timestamps: true }));

module.exports = { User, Event, Pass };
