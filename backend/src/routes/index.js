import { Router } from 'express';
import * as authCtrl from '../controllers/authController.js';
import * as roomCtrl from '../controllers/roomController.js';
import * as userCtrl from '../controllers/userController.js';
import * as convCtrl from '../controllers/conversationController.js';
import { handleUpload } from '../controllers/uploadController.js';
import { authMiddleware, requireAccount } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

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
router.get('/auth/me', authMiddleware, requireAccount, authCtrl.me);

// Rooms (video conference). GET /rooms/:id stays open to guests — the room page
// needs it to tell the host apart from everyone else.
router.post('/rooms', authMiddleware, requireAccount, roomCtrl.createRoom);
router.get('/rooms', authMiddleware, requireAccount, roomCtrl.listRooms);
// Must precede /rooms/:id or "history" is taken as a room id.
router.get('/rooms/history', authMiddleware, requireAccount, roomCtrl.roomHistory);
router.get('/rooms/:id', authMiddleware, roomCtrl.getRoom);
router.post('/rooms/:id/end', authMiddleware, requireAccount, roomCtrl.endRoom);
router.post('/rooms/:id/invite', authMiddleware, requireAccount, roomCtrl.inviteToRoom);

// Users (contact picker)
router.get('/users', authMiddleware, requireAccount, userCtrl.listUsers);

// Conversations (1-on-1 + group chat)
router.get('/conversations', authMiddleware, requireAccount, convCtrl.listConversations);
router.post('/conversations', authMiddleware, requireAccount, convCtrl.createConversation);
router.get('/conversations/:id', authMiddleware, requireAccount, convCtrl.getConversation);
router.get('/conversations/:id/messages', authMiddleware, requireAccount, convCtrl.listMessages);
router.post('/conversations/:id/members', authMiddleware, requireAccount, convCtrl.addMember);
router.delete('/conversations/:id/members/:userId', authMiddleware, requireAccount, convCtrl.removeMember);
router.post('/conversations/:id/read', authMiddleware, requireAccount, convCtrl.markRead);

// Upload (single file, field name "file")
router.post('/upload', authMiddleware, upload.single('file'), handleUpload);

export default router;
