// Configuration module: loads environment variables, validates required secrets, and exports app constants.
require('dotenv').config();

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('\n❌ Configuration Error: SESSION_SECRET environment variable is missing!');
  console.error('👉 Please define SESSION_SECRET in your .env file.\n');
  process.exit(1);
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
