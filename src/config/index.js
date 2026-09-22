// Configuration module: loads environment variables, validates required secrets, and exports app constants.
require('dotenv').config();

const SESSION_SECRET = process.env.SESSION_SECRET || 'skillxchange-session-secret-key-fallback-2026';
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️ Warning: SESSION_SECRET is not set in environment variables. Using default fallback.');
}

const PORT = parseInt(process.env.PORT, 10) || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

module.exports = {
  PORT,
  SESSION_SECRET,
  NODE_ENV,
  isProduction
};
