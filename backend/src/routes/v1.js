import { Router } from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import * as calls from '../controllers/v1/callsController.js';

/**
 * Public Voice Call API (v1).
 *
 * Every endpoint is authenticated with an `X-Api-Key` header — intended to be
 * called from a third-party application's BACKEND, never the browser.
 */
const router = Router();

router.post('/calls', apiKeyAuth, calls.createCall);
router.get('/calls/:id', apiKeyAuth, calls.getCall);
router.post('/calls/:id/token', apiKeyAuth, calls.issueToken);
router.post('/calls/:id/end', apiKeyAuth, calls.endCall);

export default router;
