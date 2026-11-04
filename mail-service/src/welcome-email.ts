/**
    AI Assistance Disclosure:
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Mailjet SMTP welcome email sender
    Author review: Pending
**/
import nodemailer, { type SendMailOptions } from "nodemailer";

export interface MailjetConfiguration {
  apiKey: string;
  secretKey: string;
  from: string;
}

export interface WelcomeEmailRecipient {
  email: string;
  name: string;
}

interface MailTransport {
  sendMail(message: SendMailOptions): Promise<unknown>;
}

export function createWelcomeEmailSender(
  settings: MailjetConfiguration,
  transport: MailTransport = nodemailer.createTransport({
    host: "in-v3.mailjet.com",
    port: 587,
    secure: false,
    auth: { user: settings.apiKey, pass: settings.secretKey },
  }),
): (recipient: WelcomeEmailRecipient) => Promise<void> {
  return async ({ email, name }) => {
    await transport.sendMail({
      from: settings.from,
      to: email,
      subject: "Welcome to NUS FOC!",
      text: `Hi ${name},\n\nWelcome to NUS Friends of Campus! Your account is ready. We’re glad to have you with us.\n`,
    });
  };
}
