require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('../api/_models');

const people = [
  ['Harshit', 'harshitsharma@admin.com', 'admin@birthday', 'admin'],
  ['Rohit', 'rohitm@member.com', 'member@rohit'],
  ['Anirudh', 'anirudh@member.com', 'member@anirudh'],
  ['Sudhanshu', 'sudhanshu@member.com', 'member@sudhanshu'],
  ['Akash', 'akash@member.com', 'member@akash'],
  ['Rishav', 'rishav@member.com', 'member@rishav'],
  ['Priyanshu', 'priyanshu@member.com', 'member@priyanshu'],
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const [name, email, pw, role = 'member'] of people) {
    await User.findOneAndUpdate({ email }, { name, email, passwordHash: await bcrypt.hash(pw, 10), role }, { upsert: true });
  }
  console.log('Seeded', people.length, 'users');
  process.exit(0);
})();
