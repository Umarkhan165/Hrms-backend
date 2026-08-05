const nodemailer = require('nodemailer');

const hasSmtpConfig = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER);

const getTransport = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

const sendMail = async ({ to, subject, html }) => {
  if (!hasSmtpConfig()) {
    console.log(`[mailer] SMTP not configured - would send to ${to}: ${subject}\n${html}`);
    return;
  }
  const transport = getTransport();
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
};

module.exports = { sendMail };


