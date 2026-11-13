/**
 * Express 4 ignores the promise an async handler returns. When one rejects,
 * the rejection goes unhandled and Node kills the whole process — every
 * meeting and chat socket drops, and the request itself is answered by nginx
 * with a 502 that carries no CORS headers, so the browser only sees a bare
 * "network error".
 *
 * Wrapping the route methods passes a rejection to next(err) instead, so it
 * reaches the error handler like any other error.
 */
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'all'];

export function catchAsyncErrors(target) {
  for (const method of METHODS) {
    const original = target[method].bind(target);
    target[method] = (...args) => {
      // app.get('setting') with one argument is a settings getter, not a route.
      if (args.length === 1) return original(...args);
      return original(...args.map(wrap));
    };
  }
  return target;
}

function wrap(handler) {
  if (Array.isArray(handler)) return handler.map(wrap);
  // Leave paths and error middleware (err, req, res, next) untouched.
  if (typeof handler !== 'function' || handler.length === 4) return handler;
  return function asyncSafe(req, res, next) {
    const result = handler(req, res, next);
    if (result && typeof result.catch === 'function') result.catch(next);
    return result;
  };
}
