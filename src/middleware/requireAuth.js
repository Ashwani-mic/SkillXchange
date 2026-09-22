// Authentication middleware: ensures the requesting user has an active session before proceeding.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }
  next();
}

module.exports = requireAuth;
