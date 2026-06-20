import { Router } from 'express';
import * as authCtrl from '../controllers/authController.js';
import * as roomCtrl from '../controllers/roomController.js';
import * as userCtrl from '../controllers/userController.js';
import * as convCtrl from '../controllers/conversationController.js';
import { handleUpload } from '../controllers/uploadController.js';
import { authMiddleware } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.get('/health', (_, res) => res.json({ ok: true }));

// Auth
router.post('/auth/register', authCtrl.register);
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', authMiddleware, authCtrl.me);

// Rooms (video conference)
router.post('/rooms', authMiddleware, roomCtrl.createRoom);
router.get('/rooms', authMiddleware, roomCtrl.listRooms);
router.get('/rooms/:id', authMiddleware, roomCtrl.getRoom);
router.post('/rooms/:id/end', authMiddleware, roomCtrl.endRoom);

// Users (contact picker)
router.get('/users', authMiddleware, userCtrl.listUsers);

// Conversations (1-on-1 + group chat)
router.get('/conversations', authMiddleware, convCtrl.listConversations);
router.post('/conversations', authMiddleware, convCtrl.createConversation);
router.get('/conversations/:id', authMiddleware, convCtrl.getConversation);
router.get('/conversations/:id/messages', authMiddleware, convCtrl.listMessages);
router.post('/conversations/:id/members', authMiddleware, convCtrl.addMember);
router.delete('/conversations/:id/members/:userId', authMiddleware, convCtrl.removeMember);
router.post('/conversations/:id/read', authMiddleware, convCtrl.markRead);

// Upload (single file, field name "file")
router.post('/upload', authMiddleware, upload.single('file'), handleUpload);

export default router;
