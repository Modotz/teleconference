import { Router } from 'express';
import * as authCtrl from '../controllers/authController.js';
import * as roomCtrl from '../controllers/roomController.js';
import * as userCtrl from '../controllers/userController.js';
import * as convCtrl from '../controllers/conversationController.js';
import * as msgCtrl from '../controllers/messageController.js';
import * as agendaCtrl from '../controllers/agendaController.js';
import * as bookingCtrl from '../controllers/bookingController.js';
import { handleUpload } from '../controllers/uploadController.js';
import { authMiddleware, requireAccount } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { catchAsyncErrors } from '../lib/catchAsyncErrors.js';

const router = catchAsyncErrors(Router());
const account = [authMiddleware, requireAccount];

router.get('/health', (_, res) => res.json({ ok: true }));

// Auth
router.post('/auth/register', authCtrl.register);
router.post('/auth/login', authCtrl.login);
router.post('/auth/guest', authCtrl.guestLogin);
router.post('/auth/google', authCtrl.googleLogin);
router.post('/auth/verify-email', authCtrl.verifyEmail);
router.post('/auth/resend-verification', authCtrl.resendVerification);
router.post('/auth/forgot-password', authCtrl.forgotPassword);
router.post('/auth/reset-password', authCtrl.resetPassword);
router.get('/auth/me', ...account, authCtrl.me);
// Sessions (AK-4): logout ends this device server-side; list / revoke devices.
router.post('/auth/logout', authMiddleware, authCtrl.logout);
router.get('/auth/sessions', ...account, authCtrl.listSessions);
router.delete('/auth/sessions/:id', ...account, authCtrl.revokeSession);
router.post('/auth/sessions/revoke-others', ...account, authCtrl.revokeOtherSessions);

// Rooms (video conference). GET /rooms/:id stays open to guests — the room page
// needs it to tell the host apart from everyone else.
router.post('/rooms', ...account, roomCtrl.createRoom);
router.get('/rooms', ...account, roomCtrl.listRooms);
// Must precede /rooms/:id or "history" is taken as a room id.
router.get('/rooms/history', ...account, roomCtrl.roomHistory);
router.get('/rooms/:id', authMiddleware, roomCtrl.getRoom);
router.post('/rooms/:id/end', ...account, roomCtrl.endRoom);
router.post('/rooms/:id/invite', ...account, roomCtrl.inviteToRoom);

// Users (directory, same organization only). Fixed paths before /users/:id.
router.get('/users', ...account, userCtrl.listUsers);
router.get('/users/presence', ...account, userCtrl.presence);
router.get('/users/:id', ...account, userCtrl.getUser);

// Admin (HR / IT roles) — employee data and access until HR is integrated.
const admin = [...account, userCtrl.requireAdmin];
router.patch('/admin/users/:id', ...admin, userCtrl.adminUpdateUser);
router.post('/admin/users/:id/active', ...admin, userCtrl.adminSetActive);
router.get('/admin/users/:id/sessions', ...admin, userCtrl.adminListSessions);
router.post('/admin/users/:id/revoke-sessions', ...admin, userCtrl.adminRevokeSessions);

// Conversations (1-on-1 + group chat)
router.get('/conversations', ...account, convCtrl.listConversations);
router.post('/conversations', ...account, convCtrl.createConversation);
router.get('/conversations/:id', ...account, convCtrl.getConversation);
router.patch('/conversations/:id', ...account, convCtrl.updateGroup);
router.get('/conversations/:id/messages', ...account, convCtrl.listMessages);
router.get('/conversations/:id/attachments', ...account, convCtrl.listAttachments);
router.post('/conversations/:id/members', ...account, convCtrl.addMember);
router.delete('/conversations/:id/members/:userId', ...account, convCtrl.removeMember);
router.post('/conversations/:id/admins', ...account, convCtrl.setAdmin);
router.post('/conversations/:id/transfer', ...account, convCtrl.transferOwnership);
router.post('/conversations/:id/mute-member', ...account, convCtrl.muteMember);
router.put('/conversations/:id/preferences', ...account, convCtrl.setPreferences);
router.post('/conversations/:id/pin', ...account, convCtrl.pinMessage);
router.post('/conversations/:id/read', ...account, convCtrl.markRead);

// Message actions. Fixed paths before /messages/:id.
router.get('/messages/search', ...account, msgCtrl.searchMessages);
router.get('/messages/starred', ...account, msgCtrl.listStarred);
router.patch('/messages/:id', ...account, msgCtrl.editMessage);
router.delete('/messages/:id', ...account, msgCtrl.deleteMessage);
router.post('/messages/:id/reaction', ...account, msgCtrl.reactToMessage);
router.post('/messages/:id/star', ...account, msgCtrl.starMessage);
router.post('/messages/:id/forward', ...account, msgCtrl.forwardMessage);
router.get('/messages/:id/receipts', ...account, msgCtrl.messageReceipts);
router.post('/reports', ...account, msgCtrl.createReport);

// Agenda (Tahap 2 scaffold). Fixed paths before /agenda/:id.
router.get('/agenda', ...account, agendaCtrl.listEvents);
router.get('/agenda/free-busy', ...account, agendaCtrl.freeBusy);
router.post('/agenda', ...account, agendaCtrl.createEvent);
router.get('/agenda/:id', ...account, agendaCtrl.getEvent);
router.patch('/agenda/:id', ...account, agendaCtrl.updateEvent);
router.delete('/agenda/:id', ...account, agendaCtrl.cancelEvent);
router.post('/agenda/:id/respond', ...account, agendaCtrl.respondEvent);

// Room booking (Tahap 2 scaffold)
router.get('/sites', ...account, bookingCtrl.listSites);
router.get('/sites/:siteId/rooms', ...account, bookingCtrl.listRooms);
router.get('/sites/:siteId/availability', ...account, bookingCtrl.availability);
router.post('/bookings', ...account, bookingCtrl.book);
router.get('/bookings/mine', ...account, bookingCtrl.myBookings);
router.delete('/bookings/:id', ...account, bookingCtrl.cancelBooking);

// Upload (single file, field name "file")
router.post('/upload', authMiddleware, upload.single('file'), handleUpload);

export default router;
