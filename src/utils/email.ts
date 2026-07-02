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
    from: `"VaultShare" <${process.env.SMTP_USER}>`,
    to,
    subject: "VaultShare — Password Reset Code",
    text: `Your one-time password reset code is: ${otp}\n\nThis code expires in 10 minutes.`,
  })
}

export const sendGroupAccessEmail = async (
  to: string,
  groupName: string,
  fileName: string,
  sharerName: string,
  role: string,
): Promise<void> => {
  await transporter.sendMail({
    from: `"VaultShare" <${process.env.SMTP_USER}>`,
    to,
    subject: `VaultShare — New file shared in group "${groupName}"`,
    text: `${sharerName} has shared the file "${fileName}" with the group "${groupName}".\n\nYour access level: ${role}.\n\nSign in to VaultShare to view the file.`,
  })
}

export const sendFileSharedEmail = async (
  to: string,
  fileName: string,
  sharerName: string,
  role: string,
): Promise<void> => {
  await transporter.sendMail({
    from: `"VaultShare" <${process.env.SMTP_USER}>`,
    to,
    subject: `VaultShare — "${fileName}" has been shared with you`,
    text: `${sharerName} has shared the file "${fileName}" with you.\n\nYour access level: ${role}.\n\nSign in to VaultShare to view the file.`,
  })
}

export const sendVersionRequestEmail = async (
  to: string,
  fileName: string,
  requesterName: string,
): Promise<void> => {
  await transporter.sendMail({
    from: `"VaultShare" <${process.env.SMTP_USER}>`,
    to,
    subject: `VaultShare — New version upload request for "${fileName}"`,
    text: `${requesterName} has requested to upload a new version of "${fileName}".\n\nSign in to VaultShare to review and approve or reject the request.`,
  })
}

export const sendVersionApprovedEmail = async (
  to: string,
  fileName: string,
  versionNumber: number,
): Promise<void> => {
  await transporter.sendMail({
    from: `"VaultShare" <${process.env.SMTP_USER}>`,
    to,
    subject: `VaultShare — Your version upload for "${fileName}" was approved`,
    text: `Your requested version (v${versionNumber}) of "${fileName}" has been approved and added to the file's version history.`,
  })
}

export const sendSigninOtpEmail = async (to: string, otp: string): Promise<void> => {
  await transporter.sendMail({
    from: `"VaultShare" <${process.env.SMTP_USER}>`,
    to,
    subject: "VaultShare — Your Sign-In Code",
    text: `Your sign-in verification code is: ${otp}\n\nThis code expires in 10 minutes. If you did not attempt to sign in, please change your password immediately.`,
  })
}

export const sendVersionRejectedEmail = async (
  to: string,
  fileName: string,
): Promise<void> => {
  await transporter.sendMail({
    from: `"VaultShare" <${process.env.SMTP_USER}>`,
    to,
    subject: `VaultShare — Your version upload for "${fileName}" was rejected`,
    text: `Your requested version upload for "${fileName}" was rejected by the file owner.`,
  })
}

