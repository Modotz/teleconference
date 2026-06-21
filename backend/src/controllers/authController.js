import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { sendMail, appUrl } from '../lib/mailer.js';

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

const randomToken = () => crypto.randomBytes(32).toString('hex');

async function sendVerifyEmail(email, token) {
  const link = `${appUrl()}/verify-email?token=${token}`;
  await sendMail({
    to: email,
    subject: 'Verify your email — Teleconference',
    text: `Welcome! Confirm your email to activate your account:\n${link}\n\nIf you didn't sign up, ignore this email.`,
    html: `<p>Welcome to <b>Teleconference</b>!</p><p>Confirm your email to activate your account:</p><p><a href="${link}">Verify my email</a></p><p>If you didn't sign up, ignore this email.</p>`,
  });
}

export async function register(req, res) {
  const { email, username, password } = req.body;
  if (!email || !username || !password) {
    return res.status(400).json({ error: 'email, username, password required' });
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    return res.status(409).json({ error: 'Email or username already exists' });
  }

  const hash = await bcrypt.hash(password, 10);
  const verifyToken = randomToken();
  await prisma.user.create({
    data: { email, username, password: hash, verifyToken, emailVerified: false },
  });

  await sendVerifyEmail(email, verifyToken);

  // No auto-login — the user must verify first.
  res.status(201).json({ message: 'verify_email_sent', email });
}

export async function verifyEmail(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  const user = await prisma.user.findFirst({ where: { verifyToken: token } });
  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired verification link' });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, verifyToken: null },
  });
  res.json({ ok: true });
}

export async function resendVerification(req, res) {
  const { email } = req.body;
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) {
      const verifyToken = randomToken();
      await prisma.user.update({
        where: { id: user.id },
        data: { verifyToken },
      });
      await sendVerifyEmail(email, verifyToken);
    }
  }
  // Always succeed — don't reveal whether the email exists.
  res.json({ ok: true });
}

export async function forgotPassword(req, res) {
  const { email } = req.body;
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    // Only accounts with a password can reset one (not Google-only accounts).
    if (user && user.password) {
      const resetToken = randomToken();
      const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExp },
      });
      const link = `${appUrl()}/reset-password?token=${resetToken}`;
      await sendMail({
        to: email,
        subject: 'Reset your password — Teleconference',
        text: `Reset your password (valid for 1 hour):\n${link}\n\nIf you didn't request this, ignore this email.`,
        html: `<p>Reset your <b>Teleconference</b> password (valid for 1 hour):</p><p><a href="${link}">Reset password</a></p><p>If you didn't request this, ignore this email.</p>`,
      });
    }
  }
  res.json({ ok: true });
}

export async function resetPassword(req, res) {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'token and password required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const user = await prisma.user.findFirst({ where: { resetToken: token } });
  if (!user || !user.resetTokenExp || user.resetTokenExp < new Date()) {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }
  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hash,
      resetToken: null,
      resetTokenExp: null,
      emailVerified: true,
    },
  });
  res.json({ ok: true });
}

export async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.emailVerified) {
    return res.status(403).json({
      error: 'Please verify your email before signing in.',
      code: 'unverified',
    });
  }

  const token = signToken(user);
  res.json({
    user: { id: user.id, email: user.email, username: user.username },
    token,
  });
}

export async function googleLogin(req, res) {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Google login is not configured' });
  }

  // Verify the ID token with Google and check it was issued for our client.
  let payload;
  try {
    const r = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!r.ok) throw new Error('verify failed');
    payload = await r.json();
  } catch {
    return res.status(401).json({ error: 'Invalid Google token' });
  }

  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
    return res.status(401).json({ error: 'Token audience mismatch' });
  }
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    return res.status(401).json({ error: 'Google email not verified' });
  }

  const email = payload.email;
  const googleId = payload.sub;
  const displayName = payload.name || (email ? email.split('@')[0] : 'user');

  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId }, { email }] },
  });

  if (!user) {
    // Create a new account with a unique username derived from the name/email.
    const base =
      String(displayName).replace(/\s+/g, '').slice(0, 20).toLowerCase() ||
      'user';
    let username = base;
    let n = 0;
    // eslint-disable-next-line no-await-in-loop
    while (await prisma.user.findUnique({ where: { username } })) {
      n += 1;
      username = `${base}${n}`;
    }
    user = await prisma.user.create({
      data: { email, username, googleId, emailVerified: true },
      select: { id: true, email: true, username: true },
    });
  } else if (!user.googleId) {
    // Link an existing email/password account to this Google identity.
    user = await prisma.user.update({
      where: { id: user.id },
      data: { googleId },
      select: { id: true, email: true, username: true },
    });
  }

  const token = signToken(user);
  res.json({
    user: { id: user.id, email: user.email, username: user.username },
    token,
  });
}

export async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, username: true, createdAt: true },
  });
  res.json({ user });
}
