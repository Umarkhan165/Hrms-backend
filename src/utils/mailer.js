const nodemailer = require("nodemailer");

const hasSmtpConfig = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER);

const getTransport = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

const sendMail = async ({ to, subject, html }) => {
  if (!hasSmtpConfig()) {
    console.log(
      `[mailer] SMTP configuration missing. Mock send to ${to}: ${subject}`,
    );
    return true;
  }

  try {
    const transport = getTransport();
    await transport.sendMail({
      from: process.env.SMTP_FROM || `"HRMS Portal" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    return true;
  } catch (error) {
    console.error("[mailer error]:", error.message);
    throw error;
  }
};

module.exports = { sendMail };
