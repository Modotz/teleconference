import prisma from '../config/prisma.js';

/**
 * Append to the audit trail (KM-1). Never throws: a failed audit write must
 * not undo the action the user just took — it is logged instead.
 */
export async function audit(actorId, action, targetType, targetId, data) {
  try {
    await prisma.auditLog.create({
      data: { actorId: actorId ?? null, action, targetType, targetId: String(targetId), data: data ?? undefined },
    });
  } catch (err) {
    console.error('[audit] write failed', action, targetType, targetId, err.message);
  }
}
