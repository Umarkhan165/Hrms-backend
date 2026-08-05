require("dotenv").config();

const { sendMail } = require("./src/utils/mailer");

const test = async () => {
  try {
    await sendMail({
      to: "loginoptions6@gmail.com",
      subject: "HRMS SMTP Test",
      html: `
                <h1>SMTP Working</h1>
                <p>Your HRMS email system is connected successfully.</p>
            `,
    });

    console.log("Mail sent successfully");
  } catch (error) {
    console.log("Mail failed");
    console.error(error);
  }
};

test();
