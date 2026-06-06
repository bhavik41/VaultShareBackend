import nodemailer from "nodemailer"

// In development, we use a JSON transport that just logs to console.
// In production set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS env vars.
function createTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587", 10),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  }
  // Dev fallback — just returns a stub that logs
  return {
    sendMail: async (opts: { to: string; subject: string; text: string }) => {
      console.log(`\n📧  [DEV] Email to: ${opts.to}`)
      console.log(`    Subject: ${opts.subject}`)
      console.log(`    Body:    ${opts.text}\n`)
      return { messageId: "dev-stub" }
    },
  }
}

const transporter = createTransport()

export const sendPasswordResetEmail = async (to: string, otp: string): Promise<void> => {
  await transporter.sendMail({
    to,
    subject: "VaultShare — Password Reset Code",
    text: `Your one-time password reset code is: ${otp}\n\nThis code expires in 10 minutes.`,
  })
}
