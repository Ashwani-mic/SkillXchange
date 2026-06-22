const nodemailer = require('nodemailer');

// Load environment variables or use defaults
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.example.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || 'user@example.com',
    pass: process.env.SMTP_PASS || 'password'
  }
});

/**
 * Send email verification link to a user.
 * @param {string} toEmail Recipient email address
 * @param {string} link Verification URL
 */
async function sendVerificationEmail(toEmail, link) {
  const mailOptions = {
    from: process.env.SMTP_FROM || 'no-reply@skillxchange.com',
    to: toEmail,
    subject: 'Verify your SkillXchange account',
    html: `<p>Welcome to SkillXchange! Please verify your email by clicking the link below:</p>
           <p><a href="${link}">Verify Email</a></p>
           <p>This link will expire in 24 hours.</p>`
  };
  return transporter.sendMail(mailOptions);
}

module.exports = { sendVerificationEmail };
