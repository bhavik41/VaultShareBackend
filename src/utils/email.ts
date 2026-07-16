import { Resend } from "resend"
import nodemailer from "nodemailer"

// Priority: Resend (HTTPS, works everywhere) → SMTP → console fallback
const FROM = process.env.RESEND_FROM ?? `VaultShare <onboarding@resend.dev>`

async function send(opts: { to: string; subject: string; text: string }): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    })
    if (error) throw new Error(error.message)
    return
  }

  if (process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587", 10),
      secure: parseInt(process.env.SMTP_PORT ?? "587", 10) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    await transporter.sendMail({ from: `"VaultShare" <${process.env.SMTP_USER}>`, ...opts })
    return
  }

  // Dev fallback — prints to terminal
  console.log(`\n📧  [DEV] Email to: ${opts.to}`)
  console.log(`    Subject: ${opts.subject}`)
  console.log(`    Body:    ${opts.text}\n`)
}

export const sendPasswordResetEmail = (to: string, otp: string) =>
  send({
    to,
    subject: "VaultShare — Password Reset Code",
    text: `Your one-time password reset code is: ${otp}\n\nThis code expires in 10 minutes.`,
  })

export const sendSigninOtpEmail = (to: string, otp: string) =>
  send({
    to,
    subject: "VaultShare — Your Sign-In Code",
    text: `Your sign-in verification code is: ${otp}\n\nThis code expires in 10 minutes. If you did not attempt to sign in, please change your password immediately.`,
  })

export const sendReauthOtpEmail = (to: string, otp: string) =>
  send({
    to,
    subject: "VaultShare — Session Unlock Code",
    text: `Your session was locked after a period of inactivity. Your unlock code is: ${otp}\n\nThis code expires in 5 minutes. If this wasn't you, please change your password immediately.`,
  })

export const sendGroupAccessEmail = (
  to: string,
  groupName: string,
  fileName: string,
  sharerName: string,
  role: string,
) =>
  send({
    to,
    subject: `VaultShare — New file shared in group "${groupName}"`,
    text: `${sharerName} has shared the file "${fileName}" with the group "${groupName}".\n\nYour access level: ${role}.\n\nSign in to VaultShare to view the file.`,
  })

export const sendFileSharedEmail = (
  to: string,
  fileName: string,
  sharerName: string,
  role: string,
) =>
  send({
    to,
    subject: `VaultShare — "${fileName}" has been shared with you`,
    text: `${sharerName} has shared the file "${fileName}" with you.\n\nYour access level: ${role}.\n\nSign in to VaultShare to view the file.`,
  })

export const sendVersionRequestEmail = (
  to: string,
  fileName: string,
  requesterName: string,
) =>
  send({
    to,
    subject: `VaultShare — New version upload request for "${fileName}"`,
    text: `${requesterName} has requested to upload a new version of "${fileName}".\n\nSign in to VaultShare to review and approve or reject the request.`,
  })

export const sendVersionApprovedEmail = (to: string, fileName: string, versionNumber: number) =>
  send({
    to,
    subject: `VaultShare — Your version upload for "${fileName}" was approved`,
    text: `Your requested version (v${versionNumber}) of "${fileName}" has been approved and added to the file's version history.`,
  })

export const sendVersionRejectedEmail = (to: string, fileName: string) =>
  send({
    to,
    subject: `VaultShare — Your version upload for "${fileName}" was rejected`,
    text: `Your requested version upload for "${fileName}" was rejected by the file owner.`,
  })
